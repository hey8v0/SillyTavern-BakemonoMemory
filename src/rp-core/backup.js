import { assertLedgerVersion } from './ledger.js';

const fields = ['schemaVersion', 'ruleVersion', 'revision', 'baseline', 'facts', 'claims', 'observations', 'candidates', 'batches', 'decisions', 'extractionJobs'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = () => { throw new Error('剧情账本恢复数据无效'); };

export function validateRpBackup(core) {
    assertLedgerVersion(core);
    if (!integer(core.revision) || !integer(core.baseline.floor)
        || !['candidates', 'batches'].every(key => Array.isArray(core[key]))) fail();
    const projection = core.baseline.projection;
    if (!object(projection) || !object(projection.clock)
        || !['people', 'relationships', 'plans', 'items', 'locations'].every(key => Array.isArray(projection[key]))) fail();
    for (const key of ['people', 'relationships', 'plans', 'items', 'locations']) {
        const ids = new Set();
        for (const entity of projection[key]) {
            if (!object(entity) || typeof entity.id !== 'string' || !entity.id || ids.has(entity.id)) fail();
            ids.add(entity.id);
        }
    }
    const ids = new Set(), sequences = new Set();
    const position = record => {
        if (!integer(record.floor) || record.floor < core.baseline.floor
            || !integer(record.sequence) || !record.sequence || record.sequence > core.revision
            || sequences.has(record.sequence)) fail();
        sequences.add(record.sequence);
    };
    for (const track of ['facts', 'claims', 'observations']) {
        for (const record of core[track]) {
            if (!object(record) || typeof record.id !== 'string' || !record.id || ids.has(record.id)
                || typeof record.action !== 'string' || !record.action || !object(record.data)
                || !Number.isFinite(record.order)) fail();
            position(record);
            ids.add(record.id);
            if (record.evidence != null) {
                const evidence = record.evidence;
                if (!object(evidence) || !['messageId', 'variantId', 'revision', 'spanHash', 'excerpt'].every(key => typeof evidence[key] === 'string')
                    || evidence.normalizationVersion !== 1 || !integer(evidence.start) || !integer(evidence.end) || evidence.end <= evidence.start) fail();
            }
        }
    }
    const candidates = new Set();
    for (const candidate of core.candidates) {
        if (!object(candidate) || typeof candidate.id !== 'string' || candidates.has(candidate.id)
            || !['pending', 'accepted', 'ignored', 'rejected'].includes(candidate.status)
            || !['facts', 'claims', 'observations'].includes(candidate.track)
            || typeof candidate.action !== 'string' || !object(candidate.data)
            || typeof candidate.sourceKey !== 'string' || typeof candidate.sourceRevision !== 'string'
            || !Array.isArray(candidate.previousIds)) fail();
        if (candidate.status === 'accepted' && !ids.has(candidate.recordId)) fail();
        candidates.add(candidate.id);
    }
    for (const candidate of core.candidates) if (candidate.previousIds.some(id => !candidates.has(id))) fail();
    for (const decision of core.decisions) {
        if (!object(decision) || !['accept', 'ignore', 'reject', 'retract', 'repair_evidence'].includes(decision.action)) fail();
        position(decision);
        if (decision.action === 'retract' ? !core.facts.some(fact => fact.id === decision.factId) : !candidates.has(decision.candidateId)) fail();
    }
    for (const batch of core.batches) {
        if (!object(batch) || typeof batch.sourceKey !== 'string' || typeof batch.sourceRevision !== 'string'
            || !Array.isArray(batch.candidateIds) || batch.candidateIds.some(id => !candidates.has(id))) fail();
    }
    if (core.extractionJobs !== undefined) {
        if (!Array.isArray(core.extractionJobs)) fail();
        const sources = new Set();
        for (const job of core.extractionJobs) {
            if (!object(job) || typeof job.sourceKey !== 'string' || !job.sourceKey || sources.has(job.sourceKey)
                || typeof job.sourceRevision !== 'string' || !job.sourceRevision
                || !['running', 'done', 'failed', 'paused'].includes(job.status)
                || typeof job.recordedAt !== 'string' || !Number.isFinite(Date.parse(job.recordedAt))) fail();
            sources.add(job.sourceKey);
        }
    }
    return core;
}

export function exportRpBackup(core) {
    validateRpBackup(core);
    return structuredClone({ ...pick(core, fields), settings: pick(core.settings, ['enabled', 'autoApply', 'inject', 'mode']) });
}

export function importRpBackup(core) {
    const restored = exportRpBackup(core);
    restored.settings = { ...restored.settings, enabled: false, autoApply: false };
    if (restored.extractionJobs) restored.extractionJobs = restored.extractionJobs.map(job => ({ ...job, status: job.status === 'running' ? 'paused' : job.status }));
    return restored;
}
