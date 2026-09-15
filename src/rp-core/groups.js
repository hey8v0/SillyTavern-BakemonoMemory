const created = event => {
    if (event.track !== 'facts') return null;
    if (['person_created', 'person_registered', 'relationship_established', 'relationship_recorded', 'plan_proposed', 'promise_created', 'item_acquired', 'item_registered', 'location_created'].includes(event.action)) return event.data.id;
    if (event.action === 'item_lent') return event.data.loanId;
    if (event.action === 'person_state_started') return event.data.stateId;
    return null;
};
const refs = event => ['id', 'from', 'to', 'owner', 'holder', 'location', 'parent', 'loanId', 'stateId']
    .flatMap(key => event.data[key] == null ? [] : [event.data[key]]).concat(event.data.participants || []);

// Dependencies are derived within this extraction batch, not persisted as a history-wide graph.
export function atomicCandidateGroups(candidates) {
    const parents = candidates.map((_, index) => index);
    const root = index => parents[index] === index ? index : (parents[index] = root(parents[index]));
    const join = (a, b) => { parents[root(a)] = root(b); };
    const owners = new Map(), declared = new Map();
    candidates.forEach((event, index) => {
        const id = created(event);
        if (id) owners.set(id, index);
        if (event.group) {
            if (declared.has(event.group)) join(index, declared.get(event.group));
            else declared.set(event.group, index);
        }
    });
    const dependencies = candidates.map((event, index) => new Set(refs(event).filter(id => owners.has(id) && owners.get(id) !== index).map(id => owners.get(id))));
    dependencies.forEach((ids, index) => ids.forEach(owner => join(index, owner)));
    const groups = new Map();
    candidates.forEach((_, index) => { const key = root(index); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(index); });
    return [...groups.values()].map(indexes => {
        const remaining = new Set(indexes), ordered = [];
        while (remaining.size) {
            const ready = [...remaining].find(index => [...dependencies[index]].every(id => !remaining.has(id)));
            if (ready === undefined) return { candidates: indexes.map(index => candidates[index]), cyclic: true };
            remaining.delete(ready); ordered.push(candidates[ready]);
        }
        return { candidates: ordered, cyclic: false };
    });
}
