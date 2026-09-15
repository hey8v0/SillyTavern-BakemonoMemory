import { createLedger, replayLedger, assertLedgerVersion } from './ledger.js';
import { createProjection, applyDomainFact } from './domain.js';
import { prepareExtraction, decideCandidate, refreshCandidateFingerprint } from './extraction.js';
import { readChatSource, findChatSource } from './chat-sources.js';
import { createRpTransactions } from './transaction.js';
import { locateEvidence } from './source.js';
import { deriveTimeViews } from './time-views.js';

export function createRpCoreService({ getState, getChat, saveState, saveChat, makeSourceId }) {
    const transactions = createRpTransactions({ getState, saveState, saveChat });
    const lastFloor = () => Math.max(0, getChat().length - 1);

    function factReducer(state) {
        const sources = new Map();
        return (projection, fact) => {
            if (fact.evidence) {
                const key = fact.evidence.messageId + '|' + fact.evidence.variantId;
                if (!sources.has(key)) sources.set(key, findChatSource(getChat(), state, key));
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
        const result = replayLedger(state.rpCore, options.asOfFloor === undefined ? factReducer(state) : applyDomainFact, options);
        return { ...result, projection: result.projection ? deriveTimeViews(result.projection) : null };
    }
    async function enable({ projection = createProjection() } = {}) {
        const state = getState();
        if (state.rpCore) throw new Error('当前聊天已经启用剧情状态');
        const core = createLedger(projection, lastFloor());
        core.settings = { enabled: true, autoApply: true, inject: true, mode: 'inline' };
        await transactions.commit(state, null, core);
        return core;
    }
    async function ingest(raw, sourceFloor, { manual = false, expectedSource = null, channel = null, inputHash = '' } = {}) {
        const state = getState(), core = state.rpCore;
        if (!core?.settings?.enabled || (channel !== null && core.settings.mode !== channel)) return null;
        assertLedgerVersion(core);
        const message = getChat()[sourceFloor];
        if (!message || message.is_user) throw new Error('提取来源不是助手正文');
        const source = readChatSource(message, state, { allocate: true, makeId: makeSourceId });
        if (expectedSource && (expectedSource.messageId !== source.messageId || expectedSource.variantId !== source.variantId
            || expectedSource.revision !== source.revision)) throw new Error('生成期间正文来源已变化');
        const prepared = prepareExtraction(core, raw, source, {
            floor: lastFloor(), order: sourceFloor,
            autoApply: core.settings.autoApply === true,
            applyFact: factReducer(state),
        });
        if (inputHash) prepared.core.batches.at(-1).inputHash = String(inputHash);
        const key = source.messageId + '|' + source.variantId;
        await transactions.commit(state, core.revision, prepared.core, () => {
            const current = findChatSource(getChat(), state, key);
            return current?.revision === source.revision;
        });
        return prepared;
    }
    function previewReview(candidateId, decision, { replaceFactId = null } = {}) {
        const state = getState(), core = state.rpCore;
        assertLedgerVersion(core);
        const candidate = core.candidates.find(item => item.id === candidateId);
        if (!candidate) throw new Error('候选不存在');
        const source = findChatSource(getChat(), state, candidate.sourceKey);
        if (!source && decision !== 'ignore') throw new Error('候选来源已变化或丢失');
        const next = decideCandidate(core, candidateId, decision, source, {
            floor: lastFloor(), replaceFactId, applyFact: factReducer(state),
        });
        return {
            before: view(state), after: view({ ...state, rpCore: next }),
            revision: core.revision,
            commit: () => transactions.commit(state, core.revision, next, () => decision === 'ignore'
                || findChatSource(getChat(), state, candidate.sourceKey)?.revision === source.revision),
        };
    }
    async function review(candidateId, decision, options) {
        await previewReview(candidateId, decision, options).commit();
        return getState().rpCore;
    }
    function previewEvidenceRepair(candidateId, excerpt) {
        const state = getState(), core = state.rpCore;
        assertLedgerVersion(core);
        const candidate = core.candidates.find(item => item.id === candidateId);
        if (!candidate || candidate.status !== 'pending') throw new Error('只可校正尚未确认的候选');
        const source = findChatSource(getChat(), state, candidate.sourceKey);
        if (!source || source.revision !== candidate.sourceRevision) throw new Error('正文来源已变化，请重新提取');
        if (typeof excerpt !== 'string' || excerpt.length > 6000) throw new Error('正文摘录过长或无效');
        const located = locateEvidence(source, excerpt);
        if (located.status !== 'located') throw new Error(located.status === 'ambiguous'
            ? '正文有多处相同摘录，请再选取一些前后文' : '正文中仍未找到该摘录；不接受摘要或改写作为原文证据');
        const next = structuredClone(core), repaired = next.candidates.find(item => item.id === candidateId);
        repaired.evidence = located.anchor;
        repaired.evidenceStatus = 'located';
        repaired.excerpt = excerpt;
        refreshCandidateFingerprint(repaired);
        repaired.reason = '来源已校正，确认前仍需核对行为与影响。';
        next.decisions.push({ sequence: ++next.revision, floor: lastFloor(), candidateId, action: 'repair_evidence',
            before: { evidence: candidate.evidence, excerpt: candidate.excerpt }, after: { evidence: located.anchor, excerpt }, recordedAt: new Date().toISOString() });
        return { excerpt, floor: source.floor, commit: () => transactions.commit(state, core.revision, next,
            () => findChatSource(getChat(), state, candidate.sourceKey)?.revision === source.revision) };
    }
    async function configure(patch) {
        const state = getState(), core = state.rpCore;
        assertLedgerVersion(core);
        const next = structuredClone(core);
        for (const [key, value] of Object.entries(patch)) {
            if (['enabled', 'autoApply', 'inject'].includes(key) && typeof value === 'boolean') next.settings[key] = value;
            else if (key === 'mode' && ['reuse', 'inline', 'reply', 'independent'].includes(value)) next.settings.mode = value;
            else throw new Error('剧情状态设置无效');
        }
        next.revision++;
        return transactions.commit(state, core.revision, next);
    }
    async function setExtractionJob(job, expectedState = getState()) {
        if (getState() !== expectedState) throw new Error('提取聊天已变化');
        const core = expectedState.rpCore;
        assertLedgerVersion(core);
        if (!job || typeof job.sourceKey !== 'string' || typeof job.sourceRevision !== 'string'
            || !['running', 'done', 'failed', 'paused'].includes(job.status)) throw new Error('提取任务无效');
        const next = structuredClone(core);
        next.extractionJobs = [...(next.extractionJobs || []).filter(item => item.sourceKey !== job.sourceKey),
            { sourceKey: job.sourceKey, sourceRevision: job.sourceRevision, status: job.status, recordedAt: new Date().toISOString() }];
        next.revision++;
        return transactions.commit(expectedState, core.revision, next);
    }
    function memoryView(state = getState()) {
        // An unsupported ledger remains untouched; legacy memories must still work.
        try { return view(state); } catch { return null; }
    }
    return { enable, ingest, review, previewReview, previewEvidenceRepair, configure, setExtractionJob, view, memoryView };
}
