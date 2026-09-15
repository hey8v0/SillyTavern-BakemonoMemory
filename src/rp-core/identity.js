import { locateEvidence } from './source.js';
import { resolveKnownReferences } from './references.js';

const creations = {
    person_created: 'person', relationship_established: 'relationship',
    plan_proposed: 'plan', promise_created: 'plan', item_acquired: 'item', item_registered: 'item', location_created: 'location',
};

// Model IDs are aliases within one response, never permanent entity identities.
export function normalizeEntityIdentities(events, source, projection = null) {
    const copies = structuredClone(events), aliases = new Map();
    for (const event of copies) {
        const kind = creations[event?.action];
        if (!kind || event.track !== 'facts') continue;
        const temporaryId = event.data?.id;
        if (typeof temporaryId !== 'string' || !temporaryId.trim()) throw new Error('新对象缺少临时身份');
        const key = kind + ':' + temporaryId;
        if (aliases.has(key)) throw new Error('同批对象的临时身份重复，请重新提取');
        const anchor = locateEvidence(source, event.excerpt, event.span).anchor;
        const permanentId = anchor
            ? ['entity', kind, source.messageId, source.variantId, anchor.start, anchor.end].map(value => encodeURIComponent(String(value))).join(':')
            : temporaryId;
        aliases.set(key, permanentId);
        event.data.id = permanentId;
    }
    const resolve = (kind, value) => typeof value === 'string' ? aliases.get(kind + ':' + value) ?? value : value;
    for (const event of copies) {
        if (!event?.data || typeof event.data !== 'object' || Array.isArray(event.data)) continue;
        const data = event.data, action = String(event.action || '');
        const kind = creations[action] || action.split('_')[0];
        if (!creations[action] && data.id !== undefined) data.id = resolve(kind, data.id);
        if (kind === 'relationship') {
            if (data.from !== undefined) data.from = resolve('person', data.from);
            if (data.to !== undefined) data.to = resolve('person', data.to);
        }
        if (kind === 'plan' && Array.isArray(data.participants)) data.participants = data.participants.map(id => resolve('person', id));
        if (kind === 'item') {
            for (const key of ['owner', 'holder', 'from', 'to']) if (data[key] !== undefined) data[key] = resolve('person', data[key]);
        }
        if (data.location !== undefined) data.location = resolve('location', data.location);
        if (kind === 'location' && data.parent !== undefined) data.parent = resolve('location', data.parent);
        if (projection) resolveKnownReferences(event, projection);
    }
    return copies;
}
