import { missingReferences, setReference } from './references.js';
import { normalizeEntityIdentities } from './identity.js';
import { prepareExtraction, refreshCandidateFingerprint, decideCandidate } from './extraction.js';
import { atomicCandidateGroups } from './groups.js';
import { locateEvidence } from './source.js';

export function prepareReferenceRepair(original, candidateId, updates, source, { floor, applyFact, projection }) {
    const candidate = original.candidates.find(item => item.id === candidateId);
    if (!candidate || candidate.status !== 'pending') throw new Error('只可校正尚未确认的候选');
    if (!Array.isArray(updates) || !updates.length) throw new Error('请先选择需要校正的对象');
    const refs = missingReferences(candidate, projection), seen = new Set(), registrations = [], descriptions = [];
    const updated = structuredClone(candidate), assignments = new Map();
    for (const update of updates) {
        const ref = refs.find(ref => ref.field === update.field);
        if (!ref || seen.has(ref.field)) throw new Error('对象字段已变化，请重新预览');
        seen.add(ref.field);
        if (update.id) {
            const entity = projection[ref.collection].find(item => item.id === update.id);
            if (!entity) throw new Error('所选对象不存在');
            assignments.set(ref.field, entity.id);
            descriptions.push({ label: ref.label, name: entity.name || entity.title || '已登记关系' });
        } else {
            const action = { people: 'person_created', locations: 'location_created', items: 'item_registered' }[ref.collection];
            if (!action) throw new Error('请先选择已有关系或约定，不能凭对象名称补建行为');
            if (typeof update.name !== 'string' || !update.name.trim() || update.name.length > 200) throw new Error('请填写对象名称');
            if (typeof update.excerpt !== 'string' || update.excerpt.length > 6000
                || locateEvidence(source, update.excerpt).status !== 'located') throw new Error('新对象的来源摘录无法唯一定位');
            const id = `repair-${original.revision}-${registrations.length}`;
            assignments.set(ref.field, id);
            registrations.push({ track: 'facts', action, data: { id, name: update.name.trim() }, excerpt: update.excerpt, field: ref.field });
            descriptions.push({ label: '登记' + ref.label, name: update.name.trim(), excerpt: update.excerpt });
        }
    }
    for (const registration of registrations.filter(item => item.action === 'item_registered')) {
        const update = updates.find(item => item.field === registration.field);
        if (update.holder) {
            const holder = update.holder.startsWith('@') ? assignments.get(update.holder.slice(1)) : update.holder;
            const ref = update.holder.startsWith('@') && refs.find(ref => ref.field === update.holder.slice(1));
            if (!holder || (ref ? ref.collection !== 'people' : !projection.people.some(item => item.id === holder))) throw new Error('请选择已核实的物品持有者');
            registration.data.holder = holder;
        }
    }
    for (const [field, id] of assignments) setReference(updated.data, field, id);
    const normalized = normalizeEntityIdentities([...registrations, updated], source, projection);
    const initial = registrations.length ? prepareExtraction(original, JSON.stringify({ version: 1, events: normalized.slice(0, -1) }), source,
        { floor, order: candidate.order, autoApply: false, applyFact }).core : structuredClone(original);
    const nextCandidate = initial.candidates.find(item => item.id === candidateId);
    nextCandidate.data = normalized.at(-1).data;
    refreshCandidateFingerprint(nextCandidate);
    const oldIds = new Set(original.candidates.map(item => item.id));
    const newCandidates = initial.candidates.filter(item => !oldIds.has(item.id));
    const group = original.candidates.filter(item => item.id === candidateId || (candidate.atomicGroup && item.atomicGroup === candidate.atomicGroup));
    if (group.some(item => item.status !== 'pending')) throw new Error('同组存在已处理项，请重新核对候选');
    const all = [...group.map(item => initial.candidates.find(value => value.id === item.id)), ...newCandidates];
    const groupId = `repair-group-${original.revision}`;
    all.forEach(item => { item.group = groupId; item.atomicGroup = groupId; });
    const sorted = atomicCandidateGroups(all)[0];
    if (sorted.cyclic) throw new Error('对象登记存在循环依赖');
    sorted.candidates.forEach((item, index) => { item.groupOrder = index; });
    initial.decisions.push({ sequence: ++initial.revision, floor, action: 'repair_references', candidateId,
        before: structuredClone(candidate.data), after: structuredClone(nextCandidate.data),
        addedCandidateIds: newCandidates.map(item => item.id), recordedAt: new Date().toISOString() });
    const core = decideCandidate(initial, candidateId, 'accept', source, { floor, applyFact });
    return { core, descriptions };
}
