import { locateEventEvidence, evidenceHash } from './source.js';
import { resolveKnownReferences } from './references.js';

const creations = {
    person_created: 'person', person_registered: 'person', relationship_established: 'relationship', relationship_recorded: 'relationship',
    plan_proposed: 'plan', promise_created: 'plan', item_acquired: 'item', item_registered: 'item', location_created: 'location',
};

// Model IDs are aliases within one response, never permanent entity identities.
export function normalizeEntityIdentities(events, source, projection = null) {
    const copies = structuredClone(events), aliases = new Map();
    // Resolve person aliases first so relationship identities never depend on model temporary IDs.
    const ordered = [...copies].sort((a, b) => Number(creations[a?.action] === 'relationship') - Number(creations[b?.action] === 'relationship'));
    for (const event of ordered) {
        const kind = creations[event?.action];
        if (!kind || event.track !== 'facts') continue;
        const temporaryId = event.data?.id;
        if (typeof temporaryId !== 'string' || !temporaryId.trim()) throw new Error('新对象缺少临时身份');
        const key = kind + ':' + temporaryId;
        if (aliases.has(key)) throw new Error('同批对象的临时身份重复，请重新提取');
        const anchor = locateEventEvidence(source, event).anchor;
        const needsName = ['person_registered', 'relationship_recorded'].includes(event.action)
            || (event.data.name && copies.some(other => other !== event && creations[other.action] === kind
                && other.data?.name !== event.data.name && locateEventEvidence(source, other).anchor?.start === anchor?.start
                && locateEventEvidence(source, other).anchor?.end === anchor?.end));
        const identityName = event.data.name || [event.data.kind, aliases.get('person:' + event.data.from) || event.data.from, aliases.get('person:' + event.data.to) || event.data.to].join('|');
        const permanentId = anchor
            ? ['entity', kind, anchor.messageId, anchor.variantId, anchor.start, anchor.end, ...(needsName ? [evidenceHash(identityName)] : [])].map(value => encodeURIComponent(String(value))).join(':')
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
