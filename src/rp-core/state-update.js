import { readStoryDate } from './clock.js';

export const stateFields = {
    people: ['name', 'aliases', 'location', 'birthDate', 'ageEvidence', 'traits', 'states'],
    relationships: ['from', 'to', 'kind', 'mutual', 'status', 'since', 'endedAt', 'milestones', 'conflicts'],
    plans: ['title', 'participants', 'status', 'due', 'outcome'],
    items: ['name', 'owner', 'holder', 'location', 'quantity', 'status'],
    locations: ['name', 'parent'], clock: ['date', 'description'], scene: ['location'],
};
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const defaults = {
    people: () => ({ name: '', aliases: [], location: null, birthDate: null, ageEvidence: null, traits: [], states: [] }),
    relationships: () => ({ from: null, to: null, kind: '', mutual: false, status: 'active', since: null, milestones: [], conflicts: [] }),
    plans: () => ({ title: '', participants: [], status: 'proposed', due: null, outcome: '' }),
    items: () => ({ name: '', owner: null, holder: null, location: null, quantity: null, status: 'available', loan: null }),
    locations: () => ({ name: '', parent: null }), clock: () => ({ date: null, description: '' }), scene: () => ({ location: null }),
};
export function applyStateUpdate(projection, data) {
    const { collection, id, values } = data || {};
    requireValue(Object.hasOwn(stateFields, collection) && object(values), '状态字段格式无效');
    requireValue(Object.keys(values).every(key => stateFields[collection].includes(key)), '状态包含不支持的字段');
    const state = structuredClone(projection), singleton = ['clock', 'scene'].includes(collection);
    if (!singleton) requireValue(typeof id === 'string' && !!id.trim() && id.length <= 4000, '状态对象身份无效');
    let entity = singleton ? state[collection] : state[collection].find(item => item.id === id);
    if (!entity) {
        entity = { ...defaults[collection](), ...(!singleton ? { id } : {}) };
        if (singleton) state[collection] = entity; else state[collection].push(entity);
    }
    const oldName = entity.name;
    Object.assign(entity, structuredClone(values));
    const string = (value, required = false) => requireValue(value == null ? !required : typeof value === 'string' && value.length <= 4000 && (!required || !!value.trim()), '状态文字无效');
    for (const key of ['name', 'title', 'kind', 'outcome', 'description']) if (Object.hasOwn(entity, key)) string(entity[key], ['name', 'title', 'kind'].includes(key));
    const date = value => requireValue(value == null || value === '' || readStoryDate(value), '剧情日期无效');
    for (const key of ['date', 'birthDate', 'since', 'endedAt', 'due']) if (Object.hasOwn(entity, key)) date(entity[key]);
    const ref = (key, target, required = false) => { string(entity[key], required); if (entity[key] != null) requireValue(state[target].some(item => item.id === entity[key]), '引用对象不存在：' + key); };
    for (const key of ['aliases', 'traits']) if (Object.hasOwn(entity, key)) requireValue(Array.isArray(entity[key]) && entity[key].length <= 100 && entity[key].every(item => typeof item === 'string' && item.length <= 4000), '状态列表无效');
    if (collection === 'people') {
        ref('location', 'locations');
        if (oldName && oldName !== entity.name) entity.aliases = [...new Set([...entity.aliases, oldName])];
        if (entity.ageEvidence != null) { requireValue(object(entity.ageEvidence) && Number.isSafeInteger(entity.ageEvidence.years) && entity.ageEvidence.years >= 0, '年龄无效'); date(entity.ageEvidence.asOf); }
        requireValue(Array.isArray(entity.states) && entity.states.length <= 100, '人物状态无效');
        const ids = new Set();
        for (const item of entity.states) {
            requireValue(object(item), '人物状态无效'); string(item.id, true); string(item.description, true);
            requireValue(!ids.has(item.id), '人物状态身份重复'); ids.add(item.id);
            date(item.startedAt); date(item.expiresAt); date(item.endedAt);
            if (item.ended != null) requireValue(typeof item.ended === 'boolean', '人物状态结束标记无效');
        }
    }
    if (collection === 'relationships') {
        ref('from', 'people', true); ref('to', 'people', true);
        requireValue(typeof entity.mutual === 'boolean' && ['active', 'ended'].includes(entity.status), '关系状态无效');
        for (const key of ['milestones', 'conflicts']) requireValue(Array.isArray(entity[key]) && entity[key].length <= 100 && entity[key].every(item => object(item) && typeof item.description === 'string' && item.description.length <= 4000), '关系经历无效');
    }
    if (collection === 'plans') {
        requireValue(Array.isArray(entity.participants) && entity.participants.length > 0 && entity.participants.length <= 100
            && entity.participants.every(id => typeof id === 'string' && state.people.some(person => person.id === id)), '约定参与者无效');
        requireValue(['proposed', 'accepted', 'completed', 'cancelled', 'failed'].includes(entity.status), '约定状态无效');
    }
    if (collection === 'items') {
        ref('owner', 'people'); ref('holder', 'people'); ref('location', 'locations');
        requireValue(entity.quantity == null || Number.isFinite(entity.quantity) && entity.quantity >= 0, '物品数量无效');
        requireValue(['available', 'damaged', 'destroyed'].includes(entity.status), '物品状态无效');
        // Explicit current holder/location updates close a previously recorded loan only when its holder changes.
        if (entity.loan && Object.hasOwn(values, 'holder') && entity.holder !== entity.loan.to) entity.loan = null;
    }
    if (collection === 'locations') {
        ref('parent', 'locations');
        const seen = new Set([entity.id]); let next = entity.parent;
        while (next != null) { requireValue(!seen.has(next), '地点层级存在循环'); seen.add(next); next = state.locations.find(item => item.id === next)?.parent; }
    }
    if (collection === 'scene') ref('location', 'locations');
    return state;
}

export function expandStatePayload(payload) {
    const events = payload.events === undefined ? [] : payload.events;
    if (!Array.isArray(events)) throw new Error('事件列表无效');
    const result = [...events];
    if (payload.state !== undefined) {
        if (!object(payload.state) || Object.keys(payload.state).some(key => !Object.hasOwn(stateFields, key))) throw new Error('状态列表无效');
        for (const collection of ['clock', 'locations', 'people', 'relationships', 'items', 'plans', 'scene']) {
            if (!Object.hasOwn(payload.state, collection)) continue;
            const value = payload.state[collection], list = ['clock', 'scene'].includes(collection) ? [value] : value;
            if (!Array.isArray(list) || list.length > 100) throw new Error('状态列表无效');
            for (const values of list) {
                if (!object(values)) { result.push(null); continue; }
                const { id, ...fields } = values;
                result.push({ track: 'facts', action: 'state_updated', data: { collection, id: id || fields.name || fields.title || (collection === 'relationships' ? [fields.from, fields.to, fields.kind].join('|') : collection), values: fields } });
            }
        }
    }
    for (const track of ['claims', 'observations']) if (payload[track] !== undefined) {
        if (!Array.isArray(payload[track]) || payload[track].length > 100) throw new Error('信息列表无效');
        result.push(...payload[track].map(data => ({ track, data })));
    }
    if (payload.events === undefined && payload.state === undefined && payload.claims === undefined && payload.observations === undefined) throw new Error('事件列表无效');
    return result;
}

// Names in model state output are references, not proof quotations. Resolve them before replay.
export function resolveStateEvents(events, projection) {
    const result = structuredClone(events), aliases = new Map(), implicit = new Map();
    const key = (kind, value) => kind + ':' + value;
    const known = (kind, token) => token == null ? [] : (Array.isArray(projection[kind]) ? projection[kind] : []).filter(item => item.id === token || [item.name, item.title, ...(item.aliases || [])].includes(token));
    const stableId = (kind, token) => 'state:' + kind + ':' + encodeURIComponent(token);
    for (const event of result.filter(event => event.action === 'state_updated')) {
        const { collection, id, values } = event.data;
        if (!Object.hasOwn(stateFields, collection) || !object(values) || typeof id !== 'string') continue;
        let matches = known(collection, id).length ? known(collection, id) : known(collection, values.name || values.title);
        if (!matches.length && collection === 'relationships') {
            const personId = token => known('people', token)[0]?.id || aliases.get(key('people', token)) || token;
            matches = projection.relationships.filter(item => item.from === personId(values.from) && item.to === personId(values.to) && item.kind === values.kind);
        }
        if (matches.length > 1) { event.resolutionIssue = '同名对象无法区分，本次未采用'; continue; }
        const resolved = matches[0]?.id || stableId(collection, id);
        for (const token of [id, values.name, values.title].filter(Boolean)) {
            const previous = aliases.get(key(collection, token));
            aliases.set(key(collection, token), aliases.has(key(collection, token)) && previous !== resolved ? null : resolved);
        }
        event.data.id = resolved;
        event.data.create = !matches.length;
    }
    const resolve = (kind, token) => {
        if (token == null) return token;
        if (typeof token !== 'string' || !token.trim() || token.length > 4000) throw Error('引用名称无效');
        const matches = known(kind, token);
        if (matches.length > 1 || aliases.has(key(kind, token)) && !aliases.get(key(kind, token))) throw Error('同名对象无法区分');
        if (matches.length) return matches[0].id;
        if (aliases.has(key(kind, token))) return aliases.get(key(kind, token));
        const id = stableId(kind, token);
        if (!implicit.has(id)) implicit.set(id, { track: 'facts', action: 'state_updated', data: { collection: kind, id, create: true, values: { name: token } } });
        return id;
    };
    for (const event of result.filter(event => event.action === 'state_updated')) {
        const { collection, values } = event.data;
        if (!object(values)) continue;
        try {
            for (const field of collection === 'relationships' ? ['from', 'to'] : collection === 'items' ? ['owner', 'holder'] : []) if (Object.hasOwn(values, field)) values[field] = resolve('people', values[field]);
            if (Array.isArray(values.participants)) values.participants = values.participants.map(token => resolve('people', token));
            if (Object.hasOwn(values, 'location')) values.location = resolve('locations', values.location);
            if (collection === 'locations' && Object.hasOwn(values, 'parent')) values.parent = resolve('locations', values.parent);
        } catch (error) { event.resolutionIssue = error.message; }
    }
    return [...implicit.values(), ...result];
}
