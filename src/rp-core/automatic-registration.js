import { locateEventEvidence, normalizeEvidenceText } from './source.js';
import { entityReferences, resolveKnownReferences } from './references.js';

const registrations = { people: 'person_registered', locations: 'location_created', items: 'item_registered' };
const creationCollections = { person_created: 'people', person_registered: 'people', location_created: 'locations', item_registered: 'items', item_acquired: 'items' };

// Only literal names can be registered automatically. An invented opaque ID is not a name.
export function prepareAutomaticRegistration(events, source, projection, { modelOwned = false } = {}) {
    const copies = structuredClone(events), created = new Map(), before = [], after = [];
    if (copies.some(event => !event || typeof event !== 'object' || !event.data || typeof event.data !== 'object' || Array.isArray(event.data))) throw new Error('候选事件结构无效');
    const existing = (kind, value) => (projection[kind] || []).filter(item => item.id === value || [item.name, ...(item.aliases || [])].includes(value));
    for (const event of copies) {
        const kind = creationCollections[event.action];
        if (kind && event.track === 'facts') created.set(kind + ':' + event.data?.id, event);
    }
    for (const event of copies) {
        if (event.track !== 'facts' || (event.context && event.context !== 'current')) { after.push(event); continue; }
        resolveKnownReferences(event, projection);
        // A partial summary time such as “evening” cannot erase a known date.
        if (event.source === 'summary' && event.action === 'clock_set' && !event.data.date && projection.clock.date) continue;
        if (event.action === 'relationship_recorded' && projection.relationships.some(item => item.status === 'active'
            && item.from === event.data.from && item.to === event.data.to && item.kind === event.data.kind
            && item.mutual === (event.data.mutual === true))) continue;
        const kind = creationCollections[event.action];
        if (kind && ['person_registered', 'item_registered', 'location_created'].includes(event.action)) {
            const explicitNew = source.policy?.version === 2 && event.data.id !== event.data.name && !projection[kind].some(item => item.id === event.data.id);
            const matches = explicitNew ? [] : existing(kind, event.data?.name);
            const sameBatch = explicitNew ? [] : copies.filter(other => other !== event && other.track === 'facts' && creationCollections[other.action] === kind
                && other.data?.name === event.data?.name && (other.action !== event.action || copies.indexOf(other) < copies.indexOf(event)));
            if (matches.length > 1 || (!matches.length && sameBatch.length > 1)) {
                event.resolutionIssue = '存在同名对象，暂保留原状态；请选择对应人物或地点。';
            } else if (matches.length === 1 || sameBatch.length === 1) {
                const targetId = matches[0]?.id || sameBatch[0].data.id;
                // Existing-state declarations do not re-create objects or overwrite their attributes.
                for (const other of copies) for (const ref of entityReferences(other)) {
                    if (ref.collection === kind && ref.value === event.data.id) {
                        if (ref.field.startsWith('present.')) other.data.present[Number(ref.field.split('.')[1])] = targetId;
                        else if (ref.field.startsWith('participants.')) other.data.participants[Number(ref.field.split('.')[1])] = targetId;
                        else other.data[ref.field] = targetId;
                    }
                }
                continue;
            }
        }
        const evidence = locateEventEvidence(source, event);
        if (modelOwned || evidence.status === 'located') {
            for (const ref of entityReferences(event)) {
                if (!registrations[ref.collection] || created.has(ref.collection + ':' + ref.value) || existing(ref.collection, ref.value).length) continue;
                const name = typeof ref.value === 'string' ? ref.value.trim() : '';
                if (!name || name.length > 100 || !/^[\p{L}\p{N}·・ -]+$/u.test(name)
                    || !modelOwned && !normalizeEvidenceText(event.excerpt).text.includes(name)) continue;
                const registration = { track: 'facts', action: registrations[ref.collection], data: { id: name, name },
                    excerpt: event.excerpt, ...(event.source ? { source: event.source } : {}) };
                created.set(ref.collection + ':' + name, registration);
                before.push(registration);
            }
        }
        after.push(event);
    }
    return [...before, ...after];
}
