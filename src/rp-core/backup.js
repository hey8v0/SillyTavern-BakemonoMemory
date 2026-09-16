import { assertLedgerVersion } from './ledger.js';
import { classifyCandidate } from './validation.js';
import { readStoryDate } from './clock.js';
import { applyStateUpdate, stateFields, validateStateFields } from './state-update.js';
import { entityReferences } from './references.js';

const fields = ['schemaVersion', 'ruleVersion', 'revision', 'baseline', 'facts', 'claims', 'observations', 'candidates', 'batches', 'decisions', 'extractionJobs', 'invalidations', 'legacySourceSettings', 'upgradeSnapshot'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = () => { throw new Error('剧情账本恢复数据无效'); };

export function validateRpBackup(core) {
    const inspect = (value, depth = 0) => {
        if (depth > 32) fail();
        if (!value || typeof value !== 'object') return;
        for (const key of Object.keys(value)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(); inspect(value[key], depth + 1); }
    };
    inspect(core);
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
            if (entity.name != null && (typeof entity.name !== 'string' || entity.name.length > 4000)) fail();
            if (entity.quantity != null && (!Number.isFinite(entity.quantity) || entity.quantity < 0)) fail();
            if (entity.birthDate != null && !readStoryDate(entity.birthDate)) fail();
            if (entity.states != null) {
                if (!Array.isArray(entity.states)) fail();
                const stateIds = new Set();
                for (const item of entity.states) {
                    if (!object(item) || typeof item.id !== 'string' || !item.id || stateIds.has(item.id) || typeof item.description !== 'string'
                        || item.visibility != null && !['observable', 'private', 'author'].includes(item.visibility)) fail();
                    stateIds.add(item.id);
                }
            }
        }
    }
    const ids = new Set(), sequences = new Set();
    if (projection.clock.date != null && !readStoryDate(projection.clock.date)) fail();
    if (core.ruleVersion >= 3) {
        const normalized = structuredClone(projection);
        normalized.people = normalized.people.map(item => ({ aliases: [], traits: [], states: [], location: null, ...item }));
        for (const kind of ['clock', 'scene', 'people', 'relationships', 'plans', 'items', 'locations']) {
            for (const entity of Array.isArray(normalized[kind]) ? normalized[kind] : normalized[kind] ? [normalized[kind]] : []) {
                try { applyStateUpdate(normalized, { collection: kind, id: entity.id, values: pick(entity, stateFields[kind]) }); } catch { fail(); }
                if (kind === 'items' && entity.loan != null && (!object(entity.loan) || typeof entity.loan.id !== 'string'
                    || !normalized.people.some(person => person.id === entity.loan.from) || !normalized.people.some(person => person.id === entity.loan.to) || entity.holder !== entity.loan.to)) fail();
            }
        }
    }
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
            if (record.origin != null) {
                if (!object(record.origin) || !['model', 'user'].includes(record.origin.kind) || core.ruleVersion < 2) fail();
                if (record.origin.kind === 'model' && !['messageId', 'variantId', 'revision', 'stamp'].every(key => typeof record.origin[key] === 'string' && record.origin[key])) fail();
            }
            if (record.action === 'state_updated' && (!record.origin || core.ruleVersion < 2)) fail();
            if (record.action === 'state_updated' && (!Object.hasOwn(stateFields, record.data.collection) || !object(record.data.values)
                || Object.keys(record.data.values).some(key => !stateFields[record.data.collection].includes(key)))) fail();
            if (record.ruleVersion >= 3 && record.action === 'state_updated') {
                try { validateStateFields(record.data.collection, record.data.values); } catch { fail(); }
            }
            if (track !== 'facts' && ['description', 'speaker', 'subject'].some(key => record.data[key] != null && (typeof record.data[key] !== 'string' || record.data[key].length > 4000))) fail();
            if (record.origin?.baseRevision != null && (!integer(record.origin.baseRevision) || record.origin.baseRevision >= record.sequence)) fail();
            if (record.change != null && (!object(record.change) || !Object.hasOwn(record.change, 'before') || !Object.hasOwn(record.change, 'after'))) fail();
            if (record.ruleVersion != null && ![1, 2, 3].includes(record.ruleVersion)) fail();
            if (record.protocolVersion != null && ![1, 2].includes(record.protocolVersion)) fail();
            if (track === 'facts' && record.ruleVersion >= 3 && classifyCandidate({ ...record, track }).status !== 'valid') fail();
            if (record.origin?.policy && (![1, 2].includes(record.origin.policy.version) || ['includeTags', 'excludeTags'].some(key => record.origin.policy[key] != null && typeof record.origin.policy[key] !== 'string'))) fail();
            if (record.replaces != null && (track === 'facts' || !core[track].some(item => item.id === record.replaces && item.sequence < record.sequence))) fail();
            if (record.evidence != null) {
                const evidence = record.evidence;
                if (!object(evidence) || !['messageId', 'variantId', 'revision', 'spanHash', 'excerpt'].every(key => typeof evidence[key] === 'string')
                    || evidence.normalizationVersion !== 1 || !integer(evidence.start) || !integer(evidence.end) || evidence.end <= evidence.start) fail();
            }
        }
    }
    const candidates = new Set();
    const known = Object.fromEntries(['people', 'relationships', 'plans', 'items', 'locations'].map(kind => [kind, new Set(projection[kind].map(item => item.id))]));
    const createdKinds = { person_created: 'people', person_registered: 'people', relationship_established: 'relationships', relationship_recorded: 'relationships',
        plan_proposed: 'plans', promise_created: 'plans', item_acquired: 'items', item_registered: 'items', location_created: 'locations' };
    for (const record of core.facts) {
        const kind = record.action === 'state_updated' ? record.data.collection : createdKinds[record.action];
        if (known[kind]) known[kind].add(record.data.id);
    }
    for (const record of core.facts.filter(item => item.ruleVersion >= 3)) {
        const refs = entityReferences({ ...record, track: 'facts' });
        if (record.action === 'state_updated') {
            const values = record.data.values, collection = record.data.collection;
            for (const [field, kind] of Object.entries({ location: 'locations', parent: 'locations', owner: 'people', holder: 'people', from: 'people', to: 'people' })) {
                if (values[field] != null) refs.push({ collection: kind, value: values[field] });
            }
            for (const id of [...(values.participants || []), ...(values.present || []), ...(values.states || []).map(item => item.target).filter(Boolean)]) refs.push({ collection: 'people', value: id });
            if (!Object.hasOwn(stateFields, collection)) fail();
        }
        if (refs.some(ref => !known[ref.collection]?.has(ref.value))) fail();
    }
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
        if (!object(decision) || !['accept', 'ignore', 'reject', 'retract', 'supersede', 'repair_evidence', 'repair_references'].includes(decision.action)) fail();
        position(decision);
        if (['retract', 'supersede'].includes(decision.action) ? !ids.has(decision.factId) : !candidates.has(decision.candidateId)) fail();
    }
    for (const batch of core.batches) {
        if (!object(batch) || typeof batch.sourceKey !== 'string' || typeof batch.sourceRevision !== 'string'
            || !Array.isArray(batch.candidateIds) || batch.candidateIds.some(id => !candidates.has(id))) fail();
        for (const field of ['protocolIssues', 'protocolRepairs']) {
            if (batch[field] === undefined) continue;
            if (!Array.isArray(batch[field]) || batch[field].length > 100) fail();
            for (const item of batch[field]) {
                if (!object(item) || !integer(item.index) || item.index < 1 || item.index > 100
                    || typeof item.code !== 'string' || !/^[a-z_]{1,100}$/.test(item.code)
                    || typeof item.field !== 'string' || item.field.length > 100
                    || field === 'protocolIssues' && (typeof item.reason !== 'string' || item.reason.length > 300)) fail();
            }
        }
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
    if (core.settings != null) {
        if (!object(core.settings)) fail();
        for (const key of ['enabled', 'automatic', 'inject', 'autoApply']) if (core.settings[key] != null && typeof core.settings[key] !== 'boolean') fail();
        if (core.settings.contextBudget != null && (!Number.isSafeInteger(core.settings.contextBudget) || core.settings.contextBudget < 1000 || core.settings.contextBudget > 60000)) fail();
        if (core.settings.mode != null && !['inline', 'independent', 'reply', 'reuse'].includes(core.settings.mode)) fail();
        if (core.settings.triggerTiming != null && !['immediate', 'next_user'].includes(core.settings.triggerTiming)) fail();
        for (const key of ['includeTags', 'excludeTags']) if (core.settings[key] != null && (typeof core.settings[key] !== 'string' || core.settings[key].length > 2000)) fail();
    }
    if (core.invalidations != null && (!Array.isArray(core.invalidations) || core.invalidations.some(item => !object(item) || !integer(item.floor) || !integer(item.revision) || item.revision > core.revision || typeof item.sourceKey !== 'string'))) fail();
    if (core.upgradeSnapshot) { if (core.upgradeSnapshot.upgradeSnapshot || core.upgradeSnapshot.ruleVersion >= 3) fail(); validateRpBackup(core.upgradeSnapshot); }
    return core;
}

export function exportRpBackup(core) {
    validateRpBackup(core);
    return structuredClone({ ...pick(core, fields), ...(core.upgradeSnapshot ? { upgradeSnapshot: exportRpBackup(core.upgradeSnapshot) } : {}), settings: pick(core.settings, ['enabled', 'automatic', 'autoApply', 'inject', 'mode', 'modeNeedsChoice', 'triggerTiming', 'includeTags', 'excludeTags', 'contextBudget', 'includeCharacterContext', 'includeWorldInfo']) });
}

export function importRpBackup(core) {
    const restored = exportRpBackup(core);
    restored.settings = { ...restored.settings, enabled: false, automatic: false, autoApply: false };
    if (restored.extractionJobs) restored.extractionJobs = restored.extractionJobs.map(job => ({ ...job, status: job.status === 'running' ? 'paused' : job.status }));
    return restored;
}
