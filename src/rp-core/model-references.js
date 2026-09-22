import { entityReferences, setReference, resolveKnownReferences } from './references.js';

const prefixes = { people: 'P', locations: 'L', items: 'I', relationships: 'R', plans: 'A', states: 'S', loans: 'B' };
const collections = { person: 'people', location: 'locations', item: 'items', relationship: 'relationships', plan: 'plans', promise: 'plans' };
const key = (kind, id, owner = '') => JSON.stringify([kind, owner, id]);
// Transport-only handles. Unlike array positions they survive sorting, renaming
// and insertion; they never replace saved identities. Collisions fail closed.
function handle(value) {
    let hash = 14695981039346656037n;
    for (const character of value) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0))) * 1099511628211n);
    return hash.toString(36);
}
export function createModelReferences(projection) {
    const forward = new Map(), reverse = new Map();
    function add(kind, id, owner = '') {
        if (typeof id !== 'string' || !id) return;
        const identity = key(kind, id, owner), token = '@rp' + prefixes[kind] + handle(identity);
        if (reverse.has(token) && reverse.get(token).identity !== identity) throw new Error('剧情对象短引用冲突，暂缓维护');
        forward.set(identity, token); reverse.set(token, { identity, kind, id, owner });
    }
    for (const kind of Object.keys(prefixes).slice(0, 5)) for (const item of projection[kind] || []) add(kind, item.id);
    for (const person of projection.people || []) for (const state of person.states || []) add('states', state.id, person.id);
    for (const item of projection.items || []) if (item.loan) add('loans', item.loan.id, item.id);
    return { ref: (kind, id, owner = '') => forward.get(key(kind, id, owner)),
        resolve(token, kind, owner = '') {
            if (typeof token !== 'string' || !token.startsWith('@rp')) return token;
            const found = reverse.get(token);
            if (!found || kind && found.kind !== kind || owner && found.owner !== owner) throw new Error('剧情对象短引用已失效或类型不匹配');
            return found.id;
        } };
}
export function resolveModelReferences(events, projection) {
    const refs = createModelReferences(projection);
    return events.map(original => {
        const event = structuredClone(original), data = event.data;
        if (!data) return event;
        try {
            const kind = collections[String(event.action).split('_')[0]];
            if (kind && data.id != null) data.id = refs.resolve(data.id, kind);
            for (const reference of entityReferences(event)) setReference(data, reference.field, refs.resolve(reference.value, reference.collection));
            resolveKnownReferences(event, projection);
            if (kind === 'people' && data.stateId != null) data.stateId = refs.resolve(data.stateId, 'states', data.id);
            if (kind === 'items' && data.loanId != null) data.loanId = refs.resolve(data.loanId, 'loans', data.id);
            if (event.track !== 'facts') {
                if (data.speaker != null) data.speaker = refs.resolve(data.speaker, 'people');
                if (data.subject != null) data.subject = refs.resolve(data.subject);
                if (Array.isArray(data.heardBy)) data.heardBy = data.heardBy.map(value => refs.resolve(value, 'people'));
            }
        } catch (error) { event.resolutionIssue = error.message; }
        return event;
    });
}
