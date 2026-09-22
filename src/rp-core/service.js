import { createLedger, replayLedger, assertLedgerVersion, appendRecord } from './ledger.js';
import { RP_SETTINGS, migrateRpCore } from './policy.js';
import { exportRpBackup, importRpBackup } from './backup.js';
import { createProjection, applyDomainFact } from './domain.js';
import { prepareExtraction, decideCandidate, refreshCandidateFingerprint } from './extraction.js';
import { readChatSource, findChatSource, currentChatSources } from './chat-sources.js';
import { createRpTransactions } from './transaction.js';
import { locateEvidence, suggestEvidenceRepair, sourceStamp } from './source.js';
import { deriveTimeViews } from './time-views.js';
import { missingReferences } from './references.js';
import { prepareReferenceRepair } from './reference-repair.js';

export function createRpCoreService({ getState, getChat, saveState, saveChat, makeSourceId, getChatIdentity = () => getState().chatIdentity || getState().chatId || '' }) {
    const transactions = createRpTransactions({ getState, saveState, saveChat });
    const lastFloor = () => Math.max(0, getChat().length - 1);

    function factReducer(state, currentSources = null) {
        const activeSources = currentSources || currentChatSources(getChat(), state);
        const policySources = new Map();
        let invalidFrom = Infinity;
        const sources = new Map();
        return (projection, fact) => {
            if (fact.origin?.kind === 'model') {
                const policy = fact.origin.policy || { version: 1 }, key = JSON.stringify(policy);
                if (!policySources.has(key)) policySources.set(key, currentChatSources(getChat(), state, policy));
                const source = policySources.get(key).get(fact.origin.messageId + '|' + fact.origin.variantId);
                if (!source || (fact.origin.scope === 'part' ? source.revision : sourceStamp(source)) !== fact.origin.stamp) { invalidFrom = Math.min(invalidFrom, fact.order); throw new Error('所属回复已改变，本条记录不再用于当前状态'); }
                if (fact.ruleVersion >= 3 && ['state_updated', 'clock_set', 'scene_recorded', 'person_moved'].includes(fact.action)
                    && (fact.order > invalidFrom || state.rpCore.invalidations?.some(item => item.floor < fact.order && item.revision > (fact.origin.baseRevision ?? 0)))) throw new Error('较早来源已改变，本条绝对状态需重新提取');
            } else if (fact.evidence && fact.origin?.kind !== 'user') {
                const key = fact.evidence.messageId + '|' + fact.evidence.variantId;
                if (!policySources.has('legacy')) policySources.set('legacy', currentChatSources(getChat(), state, { version: 1 }));
                if (!sources.has(key)) sources.set(key, policySources.get('legacy').get(key));
                const source = sources.get(key);
                if (!source || source.revision !== fact.evidence.revision) throw new Error('事实来源已变化，需要重新确认');
                const anchor = locateEvidence(source, fact.evidence.excerpt, fact.evidence).anchor;
                if (!anchor || anchor.normalizationVersion !== fact.evidence.normalizationVersion
                    || anchor.start !== fact.evidence.start || anchor.end !== fact.evidence.end
                    || anchor.spanHash !== fact.evidence.spanHash) throw new Error('事实证据无法核对，需要重新确认');
            }
            return applyDomainFact(projection, fact);
        };
    }
    function view(state = getState(), options = {}) {
        if (!state.rpCore) return null;
        const sources = options.asOfFloor === undefined ? currentChatSources(getChat(), state) : null;
        const result = replayLedger(state.rpCore, options.asOfFloor === undefined ? factReducer(state, sources) : applyDomainFact, options);
        const sourceStates = {};
        const policies = new Map();
        if (options.asOfFloor === undefined) {
            for (const item of ['facts', 'claims', 'observations', 'candidates'].flatMap(track => state.rpCore[track])) {
                const key = item.origin?.kind === 'model' ? item.origin.messageId + '|' + item.origin.variantId : item.sourceKey || (item.evidence && item.evidence.messageId + '|' + item.evidence.variantId);
                if (!key) continue;
                const policy = item.origin?.policy || { version: 1 }, policyKey = JSON.stringify(policy);
                if (!policies.has(policyKey)) policies.set(policyKey, currentChatSources(getChat(), state, policy));
                const source = policies.get(policyKey).get(key), revision = item.sourceRevision || item.evidence?.revision;
                sourceStates[item.id] = !source ? 'inactive' : (item.origin?.kind === 'model' ? (item.origin.scope === 'part' ? source.revision : sourceStamp(source)) !== item.origin.stamp : source.revision !== revision) ? 'changed' : 'current';
            }
        }
        for (const track of ['claims', 'observations']) for (const item of state.rpCore[track]) {
            if (item.superseded) sourceStates[item.id] = 'replaced';
            if (item.replaces && (options.asOfFloor === undefined || item.floor <= options.asOfFloor)) sourceStates[item.replaces] = 'replaced';
        }
        return { ...result, sourceStates, projection: result.projection ? deriveTimeViews(result.projection) : null };
    }
    async function enable() {
        const state = getState();
        if (state.rpCore) throw new Error('当前聊天已经启用剧情状态');
        const core = createLedger(createProjection(), lastFloor());
        core.ruleVersion = 3;
        core.settings = { ...RP_SETTINGS, excludeTags: state.scanRules?.includeTags || '' };
        await transactions.commit(state, null, core);
        return core;
    }
    async function migrate() {
        const state = getState(), core = state.rpCore;
        if (!core || core.ruleVersion === 3) return false;
        assertLedgerVersion(core);
        await transactions.commit(state, core.revision, migrateRpCore(core, state));
        return true;
    }
    function backup() {
        const state = getState();
        const identity = String(getChatIdentity() || '');
        if (!identity) throw new Error('无法确认当前聊天身份，暂不能导出恢复包');
        return { format: 'bakemono-rp-state', version: 1, chatIdentity: identity, core: exportRpBackup(state.rpCore) };
    }
    function validateRestore(payload) {
        if (payload?.format !== 'bakemono-rp-state' || payload.version !== 1 || !payload.chatIdentity || payload.chatIdentity !== String(getChatIdentity() || '')) throw new Error('恢复包版本或所属聊天不匹配');
        return importRpBackup(payload.core);
    }
    async function restore(payload, { expectedState = getState(), expectedRevision = expectedState.rpCore?.revision ?? null } = {}) {
        const state = getState(), core = state.rpCore;
        if (state !== expectedState || (core?.revision ?? null) !== expectedRevision) throw new Error('聊天或状态已变化，请重新导入');
        const restored = validateRestore(payload);
        restored.settings.automatic = false;
        restored.revision = Math.max(restored.revision, core?.revision || 0) + 1;
        await transactions.commit(state, core?.revision ?? null, restored, () => true, { clearCache: true });
        return view(state);
    }
    async function clear(expectedRevision, expectedState = getState()) {
        const state = getState(), core = state.rpCore;
        assertLedgerVersion(core);
        if (state !== expectedState || core.revision !== expectedRevision) throw new Error('状态已变化，请重新操作');
        const next = createLedger(createProjection(), lastFloor());
        next.ruleVersion = 3; next.revision = core.revision + 1;
        next.settings = { ...core.settings, enabled: false, automatic: false };
        await transactions.commit(state, core.revision, next, () => true, { clearCache: true });
    }
    async function ingest(raw, sourceFloor, { manual = false, expectedSource = null, channel = null, inputHash = '', protocolStatus = null, taskId = '' } = {}) {
        const state = getState(), core = state.rpCore;
        if (!core?.settings?.enabled || (channel !== null && core.settings.mode !== channel)) return null;
        assertLedgerVersion(core);
        const message = getChat()[sourceFloor];
        if (!message || message.is_user) throw new Error('提取来源不是助手正文');
        const source = readChatSource(message, state, { allocate: true, makeId: makeSourceId });
        if (expectedSource && (expectedSource.messageId !== source.messageId || expectedSource.variantId !== source.variantId
            || sourceStamp(expectedSource) !== sourceStamp(source))) throw new Error('生成期间正文来源已变化');
        const original = structuredClone(core), key = source.messageId + '|' + source.variantId;
        if (core.ruleVersion >= 3) {
            const oldBatches = original.batches.filter(batch => batch.sourceKey === key && !batch.superseded);
            if (!manual && oldBatches.some(batch => batch.sourceStamp === sourceStamp(source))) return { core, unchanged: true };
            if (oldBatches.length) (original.invalidations ||= []).push({ floor: sourceFloor, revision: ++original.revision, sourceKey: key });
            for (const batch of oldBatches) {
                batch.superseded = true;
                for (const candidate of original.candidates.filter(item => batch.candidateIds.includes(item.id) && item.status === 'accepted')) {
                    const recordId = candidate.recordId || candidate.factId;
                    original.decisions.push({ sequence: ++original.revision, floor: lastFloor(), action: 'supersede', factId: recordId });
                    for (const track of ['claims', 'observations']) {
                        const record = original[track].find(item => item.id === recordId);
                        if (record) record.superseded = true;
                    }
                    candidate.superseded = true;
                }
            }
        }
        const prepared = prepareExtraction(original, raw, source, {
            floor: lastFloor(), order: sourceFloor,
            autoApply: true, modelOwned: true,
            automaticRegistration: true,
            allowNewOnRepeat: true,
            applyFact: factReducer(state),
        });
        if (inputHash) prepared.core.batches.at(-1).inputHash = String(inputHash);
        prepared.core.batches.at(-1).sourceStamp = sourceStamp(source);
        if (['complete', 'missing', 'incomplete'].includes(protocolStatus)) prepared.core.batches.at(-1).protocolStatus = protocolStatus;
        prepared.core.batches.at(-1).sourceFloor = sourceFloor;
        prepared.core.batches.at(-1).taskId = taskId;
        prepared.core.extractionJobs = [...(prepared.core.extractionJobs || []).filter(job => job.sourceKey !== key), { sourceKey: key,
            sourceRevision: source.revision, sourceStamp: sourceStamp(source), sourceFloor, status: 'done', recordedAt: new Date().toISOString() }];
        await transactions.commit(state, core.revision, prepared.core, () => {
            const current = findChatSource(getChat(), state, key, source.policy);
            return sourceStamp(current) === sourceStamp(source);
        });
        return prepared;
    }
    async function editEntity(collection, id, values, { expectedRevision = getState().rpCore?.revision, create = false, intent = 'change' } = {}) {
        const state = getState(), core = state.rpCore;
        assertLedgerVersion(core);
        if (core.revision !== expectedRevision) throw new Error('状态已变化，请重新打开编辑');
        const projection = view(state).projection;
        if (!create && !['clock', 'scene'].includes(collection) && !projection[collection]?.some(item => item.id === id)) throw new Error('对象已变化或不存在');
        if (!['change', 'correction'].includes(intent)) throw new Error('修改意图无效');
        if (create && !['people', 'locations', 'items', 'plans', 'relationships'].includes(collection)) throw new Error('对象类型无效');
        if (create) id = 'user-' + (makeSourceId?.() || globalThis.crypto.randomUUID());
        const event = { track: 'facts', action: 'state_updated', ruleVersion: 3, protocolVersion: 2,
            data: { collection, id, values, ...(create ? { create: true } : {}) }, origin: { kind: 'user', intent } };
        const after = applyDomainFact(projection, event);
        const previous = ['clock', 'scene'].includes(collection) ? projection[collection] : projection[collection]?.find(item => item.id === id);
        const changed = ['clock', 'scene'].includes(collection) ? after[collection] : after[collection]?.find(item => item.id === id);
        event.change = { before: Object.fromEntries(Object.keys(values).map(key => [key, previous?.[key] ?? null])), after: Object.fromEntries(Object.keys(values).map(key => [key, changed?.[key] ?? null])) };
        if (intent === 'correction') event.origin.corrects = core.facts.filter(item => item.data.id === id || item.data.collection === collection && ['clock', 'scene'].includes(collection)).map(item => item.id);
        const next = structuredClone(core); next.ruleVersion = 3;
        appendRecord(next, event, { floor: lastFloor() });
        await transactions.commit(state, expectedRevision, next);
        return view(state);
    }
    async function editTemporary(personId, stateId, values, { expectedRevision, end = false } = {}) {
        const state = getState(), core = state.rpCore;
        if (core?.revision !== expectedRevision) throw new Error('状态已变化，请重新打开编辑');
        const action = end ? 'person_state_ended' : stateId ? 'person_state_revised' : 'person_state_started';
        const event = { track: 'facts', action, ruleVersion: 3, protocolVersion: 2,
            data: { ...values, id: personId, stateId: stateId || 'state-' + (makeSourceId?.() || globalThis.crypto.randomUUID()) }, origin: { kind: 'user', intent: 'change' } };
        applyDomainFact(view(state).projection, event);
        const next = structuredClone(core); next.ruleVersion = 3;
        appendRecord(next, event, { floor: lastFloor() });
        await transactions.commit(state, core.revision, next);
    }
    async function lifecycle(action, id, expectedRevision) {
        const state = getState(), core = state.rpCore;
        if (core?.revision !== expectedRevision || !['item_restored', 'plan_reopened'].includes(action)) throw new Error('状态或操作已变化');
        const event = { track: 'facts', action, ruleVersion: 3, protocolVersion: 2, data: { id }, origin: { kind: 'user', intent: 'change' } };
        applyDomainFact(view(state).projection, event);
        const next = structuredClone(core); next.ruleVersion = 3;
        appendRecord(next, event, { floor: lastFloor() });
        await transactions.commit(state, expectedRevision, next);
    }
    async function editInformation(track, id, values, { expectedRevision = getState().rpCore?.revision } = {}) {
        const state = getState(), core = state.rpCore;
        assertLedgerVersion(core);
        if (!['claims', 'observations'].includes(track) || core.revision !== expectedRevision) throw new Error('记录已变化，请重新打开编辑');
        const record = core[track].find(item => item.id === id);
        if (!record || Object.keys(values).some(key => !['speaker', 'subject', 'description', 'heardBy'].includes(key))
            || Object.entries(values).some(([key, value]) => key === 'heardBy' ? !Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 4000) : typeof value !== 'string' || value.length > 4000)
            || !(values.description ?? record.data.description)?.trim()) throw new Error('信息记录格式无效');
        const next = structuredClone(core); next.ruleVersion = Math.max(2, core.ruleVersion);
        const people = view(state).projection.people;
        const resolve = value => { const matches = people.filter(item => item.id === value || [item.name, ...(item.aliases || [])].includes(value)); return matches.length === 1 ? matches[0].id : value; };
        const data = { ...record.data, ...values };
        for (const field of ['speaker', 'subject']) if (data[field]) data[field] = resolve(data[field]);
        if (Array.isArray(data.heardBy)) data.heardBy = data.heardBy.map(resolve);
        const added = appendRecord(next, { track, action: record.action, data, origin: { kind: 'user' } }, { floor: lastFloor() });
        next[track].find(item => item.id === added.id).replaces = id;
        await transactions.commit(state, expectedRevision, next);
        return view(state);
    }
    async function reconcilePending() {
        const state = getState(), core = state.rpCore;
        if (!core?.settings?.enabled || !core.candidates.some(item => item.status === 'pending')) return false;
        assertLedgerVersion(core);
        let next = structuredClone(core); next.ruleVersion = Math.max(2, core.ruleVersion);
        const keys = [...new Set(core.candidates.filter(item => item.status === 'pending').map(item => item.originSourceKey || item.sourceKey))];
        const stamps = new Map();
        for (const key of keys) {
            const source = findChatSource(getChat(), state, key);
            const candidates = core.candidates.filter(item => item.status === 'pending' && (item.originSourceKey || item.sourceKey) === key);
            const current = candidates.filter(item => source && item.sourceRevision === findChatSource(getChat(), state, item.sourceKey)?.revision);
            if (current.length) {
                stamps.set(key, sourceStamp(source));
                const events = current.map(({ track, action, data, context, excerpt, group }) => ({ track, action, data, context, excerpt, group }));
                next = prepareExtraction(next, JSON.stringify({ version: 1, events }), source, { floor: lastFloor(), order: source.floor,
                    autoApply: true, modelOwned: true, automaticRegistration: true, allowNewOnRepeat: true, applyFact: factReducer(state) }).core;
            }
            for (const candidate of next.candidates.filter(item => item.status === 'pending' && (item.originSourceKey || item.sourceKey) === key)) {
                candidate.status = 'ignored'; candidate.reason = '旧回复已变化，本条不用于当前状态';
                next.decisions.push({ sequence: ++next.revision, floor: lastFloor(), action: 'ignore', actor: 'system', candidateId: candidate.id });
            }
        }
        await transactions.commit(state, core.revision, next, () => [...stamps].every(([key, stamp]) => sourceStamp(findChatSource(getChat(), state, key)) === stamp));
        return true;
    }
    function previewReview(candidateId, decision, { replaceFactId = null } = {}) {
        const state = getState(), core = state.rpCore;
        assertLedgerVersion(core);
        const candidate = core.candidates.find(item => item.id === candidateId);
        if (!candidate) throw new Error('候选不存在');
        const source = findChatSource(getChat(), state, candidate.originSourceKey || candidate.sourceKey);
        if (!source && decision !== 'ignore') throw new Error('候选来源已变化或丢失');
        const next = decideCandidate(core, candidateId, decision, source, {
            floor: lastFloor(), replaceFactId, applyFact: factReducer(state),
        });
        return {
            before: view(state), after: view({ ...state, rpCore: next }),
            revision: core.revision,
            commit: () => transactions.commit(state, core.revision, next, () => decision === 'ignore'
                || sourceStamp(findChatSource(getChat(), state, candidate.originSourceKey || candidate.sourceKey)) === sourceStamp(source)),
        };
    }
    async function review(candidateId, decision, options) {
        await previewReview(candidateId, decision, options).commit();
        return getState().rpCore;
    }
    function previewEvidenceRepair(candidateId, excerpt, { accept = false } = {}) {
        const state = getState(), core = state.rpCore;
        assertLedgerVersion(core);
        const candidate = core.candidates.find(item => item.id === candidateId);
        if (!candidate || candidate.status !== 'pending') throw new Error('只可校正尚未确认的候选');
        const source = findChatSource(getChat(), state, candidate.sourceKey);
        if (!source || source.revision !== candidate.sourceRevision) throw new Error('正文来源已变化，请重新提取');
        if (typeof excerpt !== 'string' || excerpt.length > 6000) throw new Error('正文摘录过长或无效');
        const located = locateEvidence(source, excerpt);
        if (located.status !== 'located') throw new Error(located.status === 'ambiguous'
            ? '正文有多处相同摘录，请再选取一些前后文' : '未找到该摘录；请选择原正文或已识别摘要中的原句');
        let next = structuredClone(core);
        const repaired = next.candidates.find(item => item.id === candidateId);
        repaired.evidence = located.anchor;
        repaired.sourceKey = located.anchor.messageId + '|' + located.anchor.variantId;
        repaired.sourceRevision = located.anchor.revision;
        repaired.evidenceStatus = 'located';
        repaired.excerpt = excerpt;
        refreshCandidateFingerprint(repaired);
        repaired.reason = '来源已校正，确认前仍需核对行为与影响。';
        next.decisions.push({ sequence: ++next.revision, floor: lastFloor(), candidateId, action: 'repair_evidence',
            before: { evidence: candidate.evidence, excerpt: candidate.excerpt }, after: { evidence: located.anchor, excerpt }, recordedAt: new Date().toISOString() });
        const groupSource = findChatSource(getChat(), state, candidate.originSourceKey || candidate.sourceKey);
        if (accept) next = decideCandidate(next, candidateId, 'accept', groupSource, { floor: lastFloor(), applyFact: factReducer(state) });
        return { excerpt, floor: source.floor, commit: () => transactions.commit(state, core.revision, next,
            () => sourceStamp(findChatSource(getChat(), state, candidate.originSourceKey || candidate.sourceKey)) === sourceStamp(groupSource)) };
    }
    function evidenceChoices(candidateId) {
        const state = getState(), candidate = state.rpCore?.candidates.find(item => item.id === candidateId);
        const source = candidate && findChatSource(getChat(), state, candidate.sourceKey);
        if (!source || source.revision !== candidate.sourceRevision) return [];
        const pieces = source.text.match(/[^。！？\n]{1,800}[。！？]?/gu) || [];
        const keywords = [...new Set(String(candidate.excerpt || '').match(/[\p{L}\p{N}]{2,}/gu) || [])];
        return [...new Set(pieces)].filter(text => locateEvidence(source, text).status === 'located')
            .map((text, index) => ({ text, index, score: keywords.filter(word => text.includes(word)).length }))
            .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 20).map(item => item.text);
    }
    function evidenceSuggestion(candidateId) {
        const state = getState(), candidate = state.rpCore?.candidates.find(item => item.id === candidateId);
        if (!candidate || candidate.status !== 'pending') return null;
        const source = findChatSource(getChat(), state, candidate.sourceKey);
        if (!source || source.revision !== candidate.sourceRevision) return null;
        return suggestEvidenceRepair(source, candidate.excerpt);
    }
    function referenceIssues(candidateId, state = getState()) {
        const candidate = state.rpCore?.candidates.find(item => item.id === candidateId);
        return candidate ? missingReferences(candidate, view(state).projection) : [];
    }
    function previewReferenceRepair(candidateId, updates) {
        const state = getState(), core = state.rpCore;
        assertLedgerVersion(core);
        const candidate = core.candidates.find(item => item.id === candidateId);
        const source = candidate && findChatSource(getChat(), state, candidate.sourceKey);
        if (!source || source.revision !== candidate.sourceRevision) throw new Error('正文来源已变化，请回到当前回复处理');
        const groupSource = findChatSource(getChat(), state, candidate.originSourceKey || candidate.sourceKey);
        const before = view(state);
        const repaired = prepareReferenceRepair(core, candidateId, updates, groupSource, { floor: lastFloor(), applyFact: factReducer(state), projection: before.projection });
        return { descriptions: repaired.descriptions, before, after: view({ ...state, rpCore: repaired.core }),
            commit: () => transactions.commit(state, core.revision, repaired.core,
                () => sourceStamp(findChatSource(getChat(), state, candidate.originSourceKey || candidate.sourceKey)) === sourceStamp(groupSource)) };
    }
    async function configure(patch) {
        await migrate();
        const state = getState(), core = state.rpCore;
        assertLedgerVersion(core);
        const next = structuredClone(core);
        for (const [key, value] of Object.entries(patch)) {
            if (['enabled', 'automatic', 'autoApply', 'inject', 'includeCharacterContext', 'includeWorldInfo'].includes(key) && typeof value === 'boolean') next.settings[key] = value;
            else if (key === 'mode' && ['inline', 'independent'].includes(value)) { next.settings.mode = value; next.settings.modeNeedsChoice = false; }
            else if (key === 'triggerTiming' && ['immediate', 'next_user'].includes(value)) next.settings[key] = value;
            else if (['includeTags', 'excludeTags'].includes(key) && typeof value === 'string' && value.length <= 2000) next.settings[key] = value;
            else if (key === 'contextBudget' && Number.isSafeInteger(value) && value >= 1000 && value <= 60000) next.settings[key] = value;
            else throw new Error('剧情状态设置无效');
        }
        next.revision++;
        return transactions.commit(state, core.revision, next);
    }
    async function setExtractionJob(job, expectedState = getState()) {
        if (getState() !== expectedState) throw new Error('提取聊天已变化');
        const core = expectedState.rpCore;
        assertLedgerVersion(core);
        if (core.extractionJobs?.some(item => item.sourceKey === job.sourceKey && item.sourceStamp === job.sourceStamp && item.status === job.status)) return { status: 'unchanged' };
        if (!job || typeof job.sourceKey !== 'string' || typeof job.sourceRevision !== 'string'
            || !['running', 'done', 'failed', 'paused'].includes(job.status)) throw new Error('提取任务无效');
        const next = structuredClone(core);
        next.extractionJobs = [...(next.extractionJobs || []).filter(item => item.sourceKey !== job.sourceKey),
            { sourceKey: job.sourceKey, sourceRevision: job.sourceRevision, ...(typeof job.sourceStamp === 'string' ? { sourceStamp: job.sourceStamp } : {}), status: job.status, ...(Number.isSafeInteger(job.sourceFloor) ? { sourceFloor: job.sourceFloor } : {}), ...(job.errorClass ? { errorClass: job.errorClass } : {}), recordedAt: new Date().toISOString() }];
        next.revision++;
        return transactions.commit(expectedState, core.revision, next);
    }
    function memoryView(state = getState()) {
        // An unsupported ledger remains untouched; legacy memories must still work.
        try { return view(state); } catch { return null; }
    }
    function progress(state = getState()) {
        const core = state.rpCore;
        if (!core) return null;
        const sources = currentChatSources(getChat(), state), missing = [];
        let latest = null;
        getChat().forEach((message, floor) => {
            if (!message || message.is_user || message.is_system || floor < core.baseline.floor) return;
            const source = readChatSource(message, state), key = source && source.messageId + '|' + source.variantId;
            const processed = key && sources.get(key) && core.batches.some(batch => !batch.superseded && batch.sourceKey === key && batch.sourceStamp === sourceStamp(source));
            if (processed) latest = floor; else missing.push(floor);
        });
        return { start: core.baseline.floor, latest, missingCount: missing.length, missingFrom: missing[0], missingTo: missing.at(-1) };
    }
    return { enable, migrate, backup, validateRestore, restore, clear, progress, ingest, editEntity, editTemporary, lifecycle, editInformation, reconcilePending, review, previewReview, previewEvidenceRepair, evidenceChoices, evidenceSuggestion, referenceIssues, previewReferenceRepair, configure, setExtractionJob, view, memoryView };
}
