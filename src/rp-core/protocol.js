import { atomicCandidateGroups } from './groups.js';

const creations = {
    person_created: 'person', person_registered: 'person', relationship_established: 'relationship', relationship_recorded: 'relationship',
    plan_proposed: 'plan', promise_created: 'plan', item_acquired: 'item', item_registered: 'item', location_created: 'location',
};
const informationActions = { claims: 'claim_made', observations: 'observation_recorded' };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);

// Called only after the complete payload has passed version, size and unsafe-key checks.
export function normalizeProtocolEvents(events, { preserveOccurrences = false } = {}) {
    const entries = events.map((value, offset) => ({ index: offset + 1, event: structuredClone(value), issue: null }));
    const repairs = [];
    const fail = (entry, code, field, reason) => { entry.issue ||= { index: entry.index, code, field, reason }; };
    for (const entry of entries) {
        const event = entry.event;
        if (!object(event)) { fail(entry, 'invalid_event', '', '每项事件必须是 JSON 对象'); continue; }
        if (typeof event.track === 'string') event.track = event.track.trim().toLowerCase();
        if (!['facts', 'claims', 'observations'].includes(event.track)) fail(entry, 'invalid_track', 'track', 'track 需明确为 facts、claims 或 observations');
        if (typeof event.action === 'string') event.action = event.action.trim();
        if (Object.hasOwn(informationActions, event.track) && (event.action == null || event.action === '')) {
            event.action = informationActions[event.track];
            repairs.push({ index: entry.index, field: 'action', code: 'default_information_action' });
        }
        if (typeof event.action !== 'string' || !event.action || event.action.length > 100) fail(entry, 'invalid_action', 'action', 'action 缺失或无效；事实行为不能猜填');
        if (!object(event.data)) fail(entry, 'invalid_data', 'data', 'data 必须是 JSON 对象');
        if (event.group != null && (typeof event.group !== 'string' || event.group.length > 100)) fail(entry, 'invalid_group', 'group', 'group 必须是长度不超过 100 的字符串');
        if (event.excerpt != null && typeof event.excerpt !== 'string') fail(entry, 'invalid_excerpt', 'excerpt', 'excerpt 必须是原文摘录字符串');
        if (object(event.data) && Object.hasOwn(informationActions, event.track)
            && (typeof event.data.description !== 'string' || !event.data.description.trim() || event.data.description.length > 4000)) {
            fail(entry, 'invalid_description', 'data.description', '说法或观察需要非空 description，长度不超过 4000');
        }
        if (object(event.data) && Object.hasOwn(informationActions, event.track)) {
            for (const field of ['speaker', 'subject']) if (event.data[field] != null && (typeof event.data[field] !== 'string' || event.data[field].length > 4000)) fail(entry, 'invalid_reference', field, '说法对象需为名称或引用');
            if (event.data.heardBy != null && (!Array.isArray(event.data.heardBy) || event.data.heardBy.length > 100 || event.data.heardBy.some(value => typeof value !== 'string' || !value || value.length > 4000))) fail(entry, 'invalid_audience', 'heardBy', '知情者需为名称或引用数组');
        }
        if (event.track === 'facts' && Object.hasOwn(creations, event.action) && object(event.data)
            && (typeof event.data.id !== 'string' || !event.data.id.trim() || event.data.id.length > 4000)) {
            fail(entry, 'invalid_identity', 'data.id', '登记对象需要明确 id，可使用唯一名称');
        }
    }
    const seen = new Set(), identities = new Map();
    for (const entry of entries) {
        if (entry.issue) continue;
        const key = canonical(entry.event);
        if (seen.has(key) && (!preserveOccurrences || !['item_consumed', 'item_quantity_changed'].includes(entry.event.action))) { entry.duplicate = true; continue; }
        seen.add(key);
        const event = entry.event;
        if (event.track !== 'facts' || !Object.hasOwn(creations, event.action)) continue;
        const identity = creations[event.action] + ':' + event.data.id;
        const related = identities.get(identity) || [];
        related.push(entry); identities.set(identity, related);
    }
    for (const related of identities.values()) if (related.length > 1) {
        for (const entry of related) fail(entry, 'duplicate_identity', 'data.id', '同批多个不同登记使用了相同 id，请区分对象后重新提取');
    }
    // Keep business dependencies atomic even when one envelope is malformed.
    const grouped = entries.filter(entry => !entry.duplicate).map(entry => ({
        entry, track: entry.event?.track, action: entry.event?.action,
        data: object(entry.event?.data) ? entry.event.data : {},
        group: typeof entry.event?.group === 'string' ? entry.event.group : '',
    }));
    for (const group of atomicCandidateGroups(grouped)) {
        if (group.candidates.some(candidate => candidate.entry.issue)) {
            for (const { entry } of group.candidates) fail(entry, 'invalid_dependency', '', '关联事件存在格式问题，本组暂不处理；请重新提取');
        }
    }
    return {
        events: entries.filter(entry => !entry.issue && !entry.duplicate).map(entry => entry.event),
        issues: entries.filter(entry => entry.issue).map(entry => entry.issue),
        repairs: repairs.filter(repair => !entries[repair.index - 1].issue),
    };
}
