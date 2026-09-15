import { assertLedgerVersion, appendRecord, retractFact, replayLedger } from './ledger.js';
import { applyDomainFact } from './domain.js';
import { locateEvidence, evidenceHash, normalizeEvidenceText } from './source.js';
import { normalizeEntityIdentities } from './identity.js';
import { classifyCandidate } from './validation.js';
import { atomicCandidateGroups } from './groups.js';

function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(typeof value === 'string' ? normalizeEvidenceText(value).text : value);
}
function inspect(value, depth = 0) {
    if (depth > 20) throw new Error('事件数据嵌套过深');
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('事件包含不允许的字段');
        inspect(value[key], depth + 1);
    }
}
function parsePayload(value) {
    if (typeof value !== 'string' || value.length > 200000) throw new Error('事件响应过大或无效');
    const wrapped = /<rpEvents\b[^>]*>\s*([\s\S]*?)\s*<\/rpEvents\s*>/i.exec(value);
    const parsed = JSON.parse(wrapped ? wrapped[1] : value);
    inspect(parsed);
    if (parsed.version !== 1) throw new Error('不支持的事件协议版本');
    if (!Array.isArray(parsed.events) || parsed.events.length > 100) throw new Error('事件列表无效');
    return parsed.events;
}
const sourceKey = source => source.messageId + '|' + source.variantId;

export function refreshCandidateFingerprint(candidate) {
    candidate.matchKey = canonical([candidate.sourceKey, candidate.track, candidate.action,
        candidate.evidence?.start ?? null, candidate.evidence?.end ?? null]);
    candidate.fingerprint = canonical([candidate.matchKey, candidate.data, candidate.context]);
}

function normalizeCandidate(event, source) {
    if (!['facts', 'claims', 'observations'].includes(event?.track) || typeof event.action !== 'string'
        || !event.action || event.action.length > 100 || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
        throw new Error('候选事件结构无效');
    }
    const located = locateEvidence(source, event.excerpt, event.span);
    if (event.group != null && (typeof event.group !== 'string' || event.group.length > 100)) throw new Error('同批事件组无效');
    const candidate = {
        track: event.track, action: event.action, data: structuredClone(event.data),
        context: event.context ?? 'current',
        group: event.group || '',
        sourceKey: sourceKey(source), sourceRevision: source.revision,
        evidence: located.anchor || null, evidenceStatus: located.status,
        excerpt: String(event.excerpt || ''), status: 'pending',
    };
    if (located.status !== 'located') candidate.reason = located.status === 'ambiguous'
        ? '正文中有多处相同摘录，请补充前后文后重新定位。'
        : '正文中未找到这段摘录；请引用原正文，而不是摘要或改写后的句子。';
    refreshCandidateFingerprint(candidate);
    return candidate;
}

export function prepareExtraction(original, raw, source, { floor, order = floor, autoApply = false, applyFact = applyDomainFact } = {}) {
    assertLedgerVersion(original);
    if (!Number.isSafeInteger(floor) || floor < original.baseline.floor || !Number.isFinite(order)) throw new Error('提取记录位置无效');
    const events = normalizeEntityIdentities(parsePayload(raw), source, replayLedger(original, applyFact).projection);
    let core = structuredClone(original);
    const previous = original.candidates.filter(item => item.sourceKey === sourceKey(source));
    const repeat = original.batches.some(batch => batch.sourceKey === sourceKey(source));
    const items = [], seen = new Set();
    const matched = new Set();
    for (const event of events) {
        const candidate = normalizeCandidate(event, source);
        if (seen.has(candidate.fingerprint)) continue;
        seen.add(candidate.fingerprint);
        const exact = previous.find(item => item.fingerprint === candidate.fingerprint && item.sourceRevision === source.revision);
        if (exact) {
            matched.add(exact.id);
            items.push({ change: 'unchanged', candidate: structuredClone(exact) });
            continue;
        }
        const similar = previous.filter(item => item.matchKey === candidate.matchKey);
        const change = similar.length === 1 ? 'modified' : similar.length > 1 ? 'ambiguous' : 'added';
        similar.forEach(item => matched.add(item.id));
        candidate.id = 'candidate-' + (++core.revision);
        candidate.change = change;
        candidate.previousIds = similar.map(item => item.id);
        candidate.floor = floor;
        candidate.order = order;
        core.candidates.push(candidate);
        const classification = classifyCandidate(candidate);
        if (classification.status !== 'valid') {
            candidate.reason = classification.reason;
            if (classification.status === 'rejected') {
                candidate.status = 'rejected';
                core.decisions.push({ sequence: ++core.revision, floor, action: 'reject', candidateId: candidate.id, reason: classification.reason });
            }
        }
        items.push({ change, candidate: structuredClone(core.candidates.find(item => item.id === candidate.id)) });
    }
    const added = items.filter(item => item.change !== 'unchanged').map(item => core.candidates.find(candidate => candidate.id === item.candidate.id));
    const groups = atomicCandidateGroups(added);
    groups.forEach((group, index) => {
        group.candidates.forEach((candidate, position) => {
            candidate.atomicGroup = `group-${original.revision}-${index}`;
            candidate.groupOrder = position;
            if (group.cyclic && candidate.status === 'pending') candidate.reason = '同批行为前提形成循环，请修改候选';
        });
    });
    if (autoApply && !repeat) {
        for (const group of groups) {
            if (group.cyclic || group.candidates.some(candidate => candidate.status !== 'pending' || !candidate.evidence || classifyCandidate(candidate).status !== 'valid')) continue;
            try { core = decideCandidate(core, group.candidates[0].id, 'accept', source, { floor, applyFact }); }
            catch (error) {
                for (const candidate of group.candidates) core.candidates.find(item => item.id === candidate.id).reason = String(error?.message || error);
            }
        }
    }
    for (const item of items) item.candidate = structuredClone(core.candidates.find(candidate => candidate.id === item.candidate.id));
    for (const candidate of previous) {
        if (!matched.has(candidate.id)) items.push({ change: 'not_detected', candidate: structuredClone(candidate) });
    }
    core.batches.push({ id: 'batch-' + (++core.revision), sourceKey: sourceKey(source), sourceRevision: source.revision,
        floor, candidateIds: items.filter(item => item.change !== 'not_detected').map(item => item.candidate.id) });
    return { core, baseRevision: original.revision, sourceRevision: source.revision, repeat, items,
        projection: replayLedger(core, applyFact) };
}

export function decideCandidate(original, candidateId, decision, source, options = {}) {
    const candidate = original.candidates.find(item => item.id === candidateId);
    if (!candidate || candidate.status !== 'pending') throw new Error('候选已处理或不存在');
    let members = candidate.atomicGroup ? original.candidates.filter(item => item.atomicGroup === candidate.atomicGroup) : [candidate];
    if (decision === 'ignore') members = members.filter(item => item.status === 'pending');
    if (members.some(item => item.status !== 'pending')) throw new Error('同组候选包含已拒绝或已处理项，请修改后重新预览');
    if (decision !== 'ignore' && atomicCandidateGroups(members).some(group => group.cyclic)) throw new Error('同批行为前提形成循环');
    let next = original;
    for (const member of members.sort((a, b) => (a.groupOrder || 0) - (b.groupOrder || 0))) {
        next = decideSingleCandidate(next, member.id, decision, source, { ...options, replaceFactId: member.id === candidateId ? options.replaceFactId : null });
    }
    return next;
}

function decideSingleCandidate(original, candidateId, decision, source, { floor, replaceFactId = null, applyFact = applyDomainFact } = {}) {
    assertLedgerVersion(original);
    if (!Number.isSafeInteger(floor) || floor < original.baseline.floor) throw new Error('审核记录位置无效');
    const core = structuredClone(original);
    const candidate = core.candidates.find(item => item.id === candidateId);
    if (!candidate || candidate.status !== 'pending') throw new Error('候选已处理或不存在');
    if (decision === 'ignore') {
        candidate.status = 'ignored';
        core.decisions.push({ sequence: ++core.revision, floor, action: 'ignore', candidateId });
        return core;
    }
    if (decision !== 'accept') throw new Error('未知审核决定');
    const classification = classifyCandidate(candidate);
    if (classification.status !== 'valid') throw new Error(classification.reason);
    if (candidate.sourceKey !== sourceKey(source) || candidate.sourceRevision !== source.revision) throw new Error('正文来源已变化，请重新提取');
    const located = locateEvidence(source, candidate.excerpt, candidate.evidence);
    if (located.status !== 'located' || !candidate.evidence
        || evidenceHash(source.text.slice(candidate.evidence.start, candidate.evidence.end)) !== candidate.evidence.spanHash) {
        throw new Error('正文来源无法唯一定位，请校正证据');
    }
    const previousFacts = candidate.previousIds.map(id => core.candidates.find(item => item.id === id)?.factId).filter(Boolean);
    if (previousFacts.length && (!replaceFactId || !previousFacts.includes(replaceFactId))) throw new Error('需要明确确认替代原事实');
    if (replaceFactId) {
        if (!previousFacts.includes(replaceFactId)) throw new Error('替代目标不匹配');
        retractFact(core, replaceFactId, { floor, reason: '重新提取后确认替代' });
    }
    const record = appendRecord(core, candidate, { floor, order: candidate.order });
    if (candidate.track === 'facts') {
        const view = replayLedger(core, applyFact);
        const failure = view.pending.find(item => item.factId === record.id);
        if (failure) throw new Error(failure.reason);
    }
    candidate.status = 'accepted';
    candidate.factId = candidate.track === 'facts' ? record.id : null;
    candidate.recordId = record.id;
    core.decisions.push({ sequence: ++core.revision, floor, action: 'accept', candidateId, recordId: record.id });
    return core;
}
