const collections = { person: 'people', relationship: 'relationships', plan: 'plans', promise: 'plans', item: 'items', location: 'locations' };
export const referenceLabels = { people: '人物', relationships: '关系', plans: '约定', items: '物品', locations: '地点' };
const creationActions = new Set(['person_created', 'relationship_established', 'plan_proposed', 'promise_created', 'item_acquired', 'item_registered', 'location_created']);

export function entityReferences(event) {
    if (event.track !== 'facts') return [];
    const kind = event.action.split('_')[0], data = event.data || {}, refs = [];
    const add = (field, collection, label) => { if (data[field] != null) refs.push({ field, collection, label, value: data[field] }); };
    if (!creationActions.has(event.action) && collections[kind]) add('id', collections[kind], referenceLabels[collections[kind]]);
    if (kind === 'relationship') { add('from', 'people', '关系发起方'); add('to', 'people', '关系另一方'); }
    if (kind === 'item') for (const field of ['owner', 'holder', 'from', 'to']) add(field, 'people', ({ owner: '所有者', holder: '持有者', from: '原持有者', to: '接收者' })[field]);
    if (kind === 'person' || kind === 'item') add('location', 'locations', '地点');
    if (kind === 'location') add('parent', 'locations', '上级地点');
    if ((kind === 'plan' || kind === 'promise') && Array.isArray(data.participants)) data.participants.forEach((value, index) => refs.push({ field: 'participants.' + index, collection: 'people', label: '参与者', value }));
    return refs;
}
export function setReference(data, field, value) {
    if (field.startsWith('participants.')) data.participants[Number(field.split('.')[1])] = value;
    else data[field] = value;
}
export function resolveKnownReferences(event, projection) {
    for (const ref of entityReferences(event)) {
        const values = projection?.[ref.collection] || [];
        if (values.some(item => item.id === ref.value)) continue;
        const matches = values.filter(item => [item.name, item.title, ...(item.aliases || [])].includes(ref.value));
        if (matches.length === 1) setReference(event.data, ref.field, matches[0].id);
    }
    return event;
}
export function missingReferences(event, projection) {
    return entityReferences(event).filter(ref => !(projection[ref.collection] || []).some(item => item.id === ref.value));
}
