import { assertLedgerVersion, appendRecord, retractFact, replayLedger } from './ledger.js';
import { applyDomainFact } from './domain.js';
import { locateEvidence, evidenceHash, normalizeEvidenceText, locateEventEvidence, evidenceSource, sourceStamp } from './source.js';
import { expandStatePayload, resolveStateEvents } from './state-update.js';
import { prepareAutomaticRegistration } from './automatic-registration.js';
import { normalizeEntityIdentities } from './identity.js';
import { classifyCandidate } from './validation.js';
import { atomicCandidateGroups } from './groups.js';
import { normalizeProtocolEvents } from './protocol.js';

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
export function parsePayload(value) {
    if (typeof value !== 'string' || value.length > 200000) throw new Error('事件响应过大或无效');
    const wrapped = /<rpEvents\b[^>]*>\s*([\s\S]*?)\s*<\/rpEvents\s*>/i.exec(value);
    let parsed;
    try { parsed = JSON.parse(wrapped ? wrapped[1] : value); }
    catch { throw new Error('剧情事件 JSON 格式不完整或无效；请重新生成完整事件块'); }
    inspect(parsed);
    if (!parsed || Array.isArray(parsed) || parsed.version !== 1) throw new Error('不支持的事件协议版本');
    const events = expandStatePayload(parsed);
    if (events.length > 100) throw new Error('事件列表无效');
    return events;
}
const sourceKey = source => source.messageId + '|' + source.variantId;

export function refreshCandidateFingerprint(candidate) {
    const { create, ...semanticData } = candidate.data;
    candidate.matchKey = canonical([candidate.sourceKey, candidate.track, candidate.action,
        ...(candidate.origin ? [candidate.data.collection || '', candidate.data.id || candidate.data.speaker || '', candidate.data.subject || ''] : []),
        candidate.action === 'state_updated' ? null : candidate.evidence?.start ?? null, candidate.action === 'state_updated' ? null : candidate.evidence?.end ?? null]);
    candidate.fingerprint = canonical([candidate.matchKey, semanticData, candidate.context]);
}

function normalizeCandidate(event, source, modelOwned = false) {
    if (!['facts', 'claims', 'observations'].includes(event?.track) || typeof event.action !== 'string'
        || !event.action || event.action.length > 100 || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
        throw new Error('候选事件结构无效');
    }
    const located = locateEventEvidence(source, event);
    const origin = !modelOwned && located.anchor ? evidenceSource(source, located.anchor) : source;
    const basis = located.anchor && evidenceSource(source, located.anchor);
    if (event.group != null && (typeof event.group !== 'string' || event.group.length > 100)) throw new Error('同批事件组无效');
    const candidate = {
        track: event.track, action: event.action, data: structuredClone(event.data),
        context: event.context ?? 'current',
        group: event.group || '',
        sourceKey: sourceKey(origin), sourceRevision: origin.revision, originSourceKey: sourceKey(source),
        evidence: located.anchor || null, evidenceStatus: located.status,
        excerpt: String(event.excerpt || ''), status: 'pending',
        ...(modelOwned ? { origin: { kind: 'model', messageId: (basis || source).messageId, variantId: (basis || source).variantId,
            revision: (basis || source).revision, scope: basis ? 'part' : 'reply', stamp: basis ? basis.revision : sourceStamp(source) } } : {}),
        ...(event.resolutionIssue ? { blockedReason: event.resolutionIssue, reason: event.resolutionIssue } : {}),
    };
    if (!modelOwned && located.status !== 'located') candidate.reason = located.status === 'ambiguous'
        ? '正文中有多处相同摘录，请补充前后文后重新定位。'
        : '正文与已识别摘要中未找到这段摘录；请选择连续原句，不要拼接或改写。';
    refreshCandidateFingerprint(candidate);
    return candidate;
}

export function prepareExtraction(original, raw, source, { floor, order = floor, autoApply = false, automaticRegistration = false, allowNewOnRepeat = false, modelOwned = false, applyFact = applyDomainFact } = {}) {
    assertLedgerVersion(original);
    if (!Number.isSafeInteger(floor) || floor < original.baseline.floor || !Number.isFinite(order)) throw new Error('提取记录位置无效');
    const projection = replayLedger(original, applyFact).projection;
    const protocol = normalizeProtocolEvents(parsePayload(raw));
    const parsed = modelOwned ? resolveStateEvents(protocol.events, projection) : protocol.events;
    const events = normalizeEntityIdentities(automaticRegistration ? prepareAutomaticRegistration(parsed, source, projection, { modelOwned }) : parsed, source, projection);
    let core = structuredClone(original);
    if (modelOwned) for (const item of core.candidates.filter(item => item.status === 'pending' && (item.originSourceKey || item.sourceKey) === sourceKey(source))) {
        item.status = 'ignored'; item.reason = '由自动记录流程重新处理';
        core.decisions.push({ sequence: ++core.revision, floor, action: 'ignore', actor: 'system', candidateId: item.id });
    }
    const stillCurrent = item => {
        if (item.sourceRevision !== source.revision) return false;
        if (item.status !== 'accepted' || item.origin?.kind !== 'model') return true;
        const basis = item.origin.scope === 'part' ? evidenceSource(source, item.origin) : source;
        return item.origin.stamp === (item.origin.scope === 'part' ? basis?.revision : sourceStamp(basis));
    };
    const previous = original.candidates.filter(item => (item.originSourceKey || item.sourceKey) === sourceKey(source)
        && (!modelOwned || item.status !== 'pending' && stillCurrent(item)));
    const repeat = original.batches.some(batch => batch.sourceKey === sourceKey(source));
    const items = [], seen = new Set(), seenCandidates = [];
    const matched = new Set();
    for (const event of events) {
        const candidate = normalizeCandidate(event, source, modelOwned);
        const sameInterpretation = item => item.track === candidate.track && item.action === candidate.action && item.context === candidate.context
            && canonical(item.data) === canonical(candidate.data) && (!item.evidence || !candidate.evidence
                || item.evidence.start === candidate.evidence.start && item.evidence.end === candidate.evidence.end);
        if (modelOwned && seenCandidates.some(sameInterpretation)) continue;
        seenCandidates.push(candidate);
        if (seen.has(candidate.fingerprint)) continue;
        seen.add(candidate.fingerprint);
        const exact = previous.find(item => (item.fingerprint === candidate.fingerprint || modelOwned && sameInterpretation(item)) && item.sourceRevision === candidate.sourceRevision);
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
    if (autoApply && (!repeat || allowNewOnRepeat)) {
        for (const group of groups) {
            if (repeat && group.candidates.some(candidate => candidate.change !== 'added' || candidate.previousIds.length)) continue;
            if (group.cyclic || group.candidates.some(candidate => candidate.status !== 'pending' || candidate.blockedReason || !candidate.evidence && !candidate.origin || classifyCandidate(candidate).status !== 'valid')) continue;
            try { core = decideCandidate(core, group.candidates[0].id, 'accept', source, { floor, applyFact }); }
            catch (error) {
                for (const candidate of group.candidates) core.candidates.find(item => item.id === candidate.id).reason = String(error?.message || error);
            }
        }
    }
    if (modelOwned) for (const item of core.candidates.filter(item => item.status === 'pending' && (item.originSourceKey || item.sourceKey) === sourceKey(source))) {
        item.status = 'rejected'; item.reason ||= '本次内容与已有记录重复或缺少有效参数，未采用';
        core.decisions.push({ sequence: ++core.revision, floor, action: 'reject', actor: 'system', candidateId: item.id, reason: item.reason });
    }
    for (const item of items) item.candidate = structuredClone(core.candidates.find(candidate => candidate.id === item.candidate.id));
    for (const candidate of previous) {
        if (!matched.has(candidate.id)) items.push({ change: 'not_detected', candidate: structuredClone(candidate) });
    }
    core.batches.push({ id: 'batch-' + (++core.revision), sourceKey: sourceKey(source), sourceRevision: source.revision,
        floor, candidateIds: items.filter(item => item.change !== 'not_detected').map(item => item.candidate.id),
        protocolIssues: protocol.issues, protocolRepairs: protocol.repairs, ...(modelOwned ? { recordingPolicy: 'model' } : {}) });
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
    if (candidate.blockedReason) throw new Error(candidate.blockedReason);
    const classification = classifyCandidate(candidate);
    if (classification.status !== 'valid') throw new Error(classification.reason);
    source = candidate.origin ? source : evidenceSource(source, candidate.evidence) || source;
    if (candidate.sourceKey !== sourceKey(source) || candidate.sourceRevision !== source.revision) throw new Error('正文来源已变化，请重新提取');
    const located = locateEvidence(source, candidate.excerpt, candidate.evidence);
    const modelBasis = candidate.origin?.scope === 'part' ? evidenceSource(source, candidate.origin) : source;
    if (candidate.origin ? candidate.origin.stamp !== (candidate.origin.scope === 'part' ? modelBasis?.revision : sourceStamp(source)) : located.status !== 'located' || !candidate.evidence
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
