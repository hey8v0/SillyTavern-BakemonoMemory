import { readStoryDate, advanceStoryDate } from './clock.js';
import { classifyCandidate } from './validation.js';
import { applyStateUpdate } from './state-update.js';
import { applyLocalEvent } from './local-events.js';

export function createProjection() {
    return { people: [], relationships: [], plans: [], items: [], locations: [],
        clock: { date: null, description: '' } };
}
function requireValue(condition, message) {
    if (!condition) throw new Error(message);
}
function text(value, label) {
    requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= 4000, label + '无效');
    return value.trim();
}
function find(list, id) {
    const result = list.find(item => item.id === id);
    requireValue(result, '对象尚未确定：' + String(id));
    return result;
}
function insert(list, value) {
    text(value.id, '对象身份');
    requireValue(!list.some(item => item.id === value.id), '对象身份已存在');
    list.push(value);
}
// A relationship keeps the ids it was re-described under, so later events naming any of them still find it.
export function findRelationship(list, id) {
    return (list || []).find(item => item.id === id) || (list || []).find(item => item.aliases?.includes(id));
}
function relationOf(state, id) {
    const result = findRelationship(state.relationships, id);
    requireValue(result, '对象尚未确定：' + String(id));
    return result;
}
const samePair = (relation, from, to, mutual) => relation.status === 'active'
    && ((relation.from === from && relation.to === to) || ((relation.mutual || mutual) && relation.from === to && relation.to === from));
// The model re-describes a relationship almost every turn (饲主与小猫 → 看戏执事与幼猫 …). There is one current
// relationship per pair and direction; a new description replaces the old kind, which moves to `history`.
function redescribe(current, { id, kind, mutual, milestones = [], conflicts = [] }, date) {
    current.history = [...(current.history || []), { kind: current.kind, until: date ?? null }].slice(-20);
    current.kind = kind;
    current.mutual = mutual;
    if (id && id !== current.id) current.aliases = [...new Set([...(current.aliases || []), id])];
    current.milestones = [...current.milestones, ...milestones];
    current.conflicts = [...current.conflicts, ...conflicts];
}
// Folds relationships that describe the same pair into the first one (older records, merged people).
export function collapseRelationships(state) {
    const kept = [];
    for (const item of state.relationships || []) {
        if (item.from === item.to) continue;
        const earlier = item.status === 'active' && kept.find(other => samePair(other, item.from, item.to, item.mutual));
        if (!earlier) { kept.push(item); continue; }
        if (earlier.kind !== item.kind || earlier.mutual !== item.mutual) redescribe(earlier, item, item.since);
        else earlier.milestones = [...earlier.milestones, ...(item.milestones || [])], earlier.conflicts = [...earlier.conflicts, ...(item.conflicts || [])];
        earlier.aliases = [...new Set([...(earlier.aliases || []), item.id, ...(item.aliases || [])])].filter(id => id !== earlier.id);
    }
    state.relationships = kept;
    return state;
}
function optionalPerson(state, id) {
    if (id != null) find(state.people, id);
    return id ?? null;
}
function dateOrNull(value) {
    if (value == null || value === '') return null;
    requireValue(readStoryDate(value), '剧情日期无效或不明确');
    return value;
}
function ageEvidence(data, clock) {
    if (data.age == null) return null;
    requireValue(Number.isSafeInteger(data.age) && data.age >= 0, '年龄依据无效');
    return { years: data.age, asOf: dateOrNull(data.ageDate ?? clock) };
}
function setParent(state, location, parent) {
    const seen = new Set([location.id]);
    let next = parent;
    while (next != null) {
        requireValue(!seen.has(next), '地点层级存在循环');
        seen.add(next);
        next = find(state.locations, next).parent;
    }
    location.parent = parent ?? null;
}

// Two records turned out to be one person (夏尔 / 夏尔·凡多姆海恩): everything that pointed at the duplicate now
// points at the kept person, whose aliases gain the duplicate's names. Older history still names the duplicate
// through `merged`.
function mergePerson(state, fromId, intoId) {
    requireValue(fromId !== intoId, '不能合并到自己');
    const from = find(state.people, fromId), into = find(state.people, intoId);
    const swap = id => id === fromId ? intoId : id;
    into.aliases = [...new Set([...into.aliases, from.name, ...from.aliases])].filter(name => name !== into.name);
    into.traits = [...new Set([...into.traits, ...from.traits])];
    const stateIds = new Set(into.states.map(item => item.id));
    into.states.push(...from.states.map(item => ({ ...item, id: stateIds.has(item.id) ? item.id + '~' + fromId : item.id })));
    into.location ??= from.location;
    into.birthDate ??= from.birthDate;
    into.ageEvidence ??= from.ageEvidence;
    state.people = state.people.filter(person => person.id !== fromId);
    for (const person of state.people) for (const item of person.states) if (item.target != null) item.target = swap(item.target);
    for (const relation of state.relationships) { relation.from = swap(relation.from); relation.to = swap(relation.to); }
    collapseRelationships(state);
    for (const plan of state.plans) plan.participants = [...new Set(plan.participants.map(swap))];
    for (const item of state.items) {
        item.owner = swap(item.owner); item.holder = swap(item.holder);
        if (item.loan) { item.loan.from = swap(item.loan.from); item.loan.to = swap(item.loan.to); }
    }
    if (state.scene?.present) state.scene.present = [...new Set(state.scene.present.map(swap))];
    state.merged = { ...(state.merged || {}), [fromId]: intoId };
    for (const [old, target] of Object.entries(state.merged)) if (target === fromId) state.merged[old] = intoId;
}

export function applyDomainFact(projection, event) {
    const classification = classifyCandidate({ ...event, track: 'facts' });
    requireValue(classification.status === 'valid', classification.reason);
    const local = event.ruleVersion >= 3;
    if (local) { const result = applyLocalEvent(projection, event); if (result) return result; }
    if (event.action === 'state_updated') return applyStateUpdate(projection, event.data);
    const state = structuredClone(projection);
    const data = event.data || {};
    const action = event.action;
    if (action === 'person_created' || action === 'person_registered') {
        insert(state.people, { id: data.id, name: text(data.name, '姓名'), aliases: [], location: null,
            birthDate: dateOrNull(data.birthDate), ageEvidence: ageEvidence(data, state.clock.date), traits: [], states: [] });
    } else if (action === 'person_age_recorded') {
        const evidence = ageEvidence(data, state.clock.date);
        requireValue(evidence, '缺少年龄依据');
        find(state.people, data.id).ageEvidence = evidence;
    } else if (action === 'person_renamed') {
        const person = find(state.people, data.id);
        person.aliases = [...new Set([...person.aliases, person.name])];
        person.name = text(data.name, '姓名');
    } else if (action === 'person_trait_recorded') {
        const person = find(state.people, data.id);
        const trait = text(data.trait, '特征');
        if (!person.traits.includes(trait)) person.traits.push(trait);
    } else if (action === 'person_state_started') {
        const person = find(state.people, data.id);
        if (local && data.target != null) find(state.people, data.target);
        insert(person.states, { id: data.stateId, description: text(data.description, '状态'),
            ...(local ? { visibility: data.visibility || 'observable', target: data.target ?? null } : {}),
            startedAt: state.clock.date, expiresAt: dateOrNull(data.expiresAt) });
    } else if (action === 'person_state_ended') {
        const temporary = find(find(state.people, data.id).states, data.stateId);
        requireValue(!temporary.ended && temporary.endedAt == null, '临时状态已经结束');
        temporary.ended = true;
        temporary.endedAt = state.clock.date;
    } else if (action === 'person_merged') {
        mergePerson(state, data.id, data.into);
    } else if (action === 'scene_recorded') {
        find(state.locations, data.location);
        if (local && data.present) data.present.forEach(id => find(state.people, id));
        state.scene = { ...state.scene, location: data.location, ...(local && data.present ? { present: [...new Set(data.present)] } : {}) };
    } else if (action === 'relationship_established' || action === 'relationship_recorded') {
        find(state.people, data.from); find(state.people, data.to);
        const kind = text(data.kind, '关系类型');
        requireValue(local || !['romantic', 'partner', 'married'].includes(kind) || data.mutual === true, '关系尚缺双方确认');
        const current = state.relationships.find(item => samePair(item, data.from, data.to, data.mutual === true));
        if (current) {
            const mutual = data.mutual == null ? current.mutual : data.mutual === true;
            requireValue(current.kind !== kind || current.mutual !== mutual, '关系已经建立');
            redescribe(current, { id: data.id, kind, mutual }, state.clock.date);
        } else {
            insert(state.relationships, { id: data.id, from: data.from, to: data.to, kind,
                mutual: data.mutual === true, status: 'active', since: action === 'relationship_recorded' ? null : state.clock.date, milestones: [], conflicts: [], recordedExisting: action === 'relationship_recorded' });
        }
    } else if (action === 'relationship_ended') {
        const relation = relationOf(state, data.id);
        requireValue(relation.status === 'active', '关系并未处于持续状态');
        relation.status = 'ended'; relation.endedAt = state.clock.date;
    } else if (action === 'relationship_conflict' || action === 'relationship_milestone') {
        const relation = relationOf(state, data.id);
        relation[action === 'relationship_conflict' ? 'conflicts' : 'milestones']
            .push({ description: text(data.description, '关系事件'), date: state.clock.date, factId: event.id || null });
    } else if (action === 'plan_proposed' || action === 'promise_created') {
        requireValue(Array.isArray(data.participants) && data.participants.length > 0, '参与者不明确');
        data.participants.forEach(id => find(state.people, id));
        insert(state.plans, { id: data.id, title: text(data.title, '约定'),
            participants: [...new Set(data.participants)], status: action === 'promise_created' ? 'accepted' : 'proposed',
            createdAt: state.clock.date, due: dateOrNull(data.due), ...(local ? { dueDescription: data.dueDescription || '' } : {}), outcome: '' });
    } else if (['plan_accepted', 'plan_completed', 'plan_cancelled', 'plan_failed', 'plan_modified'].includes(action)) {
        const plan = find(state.plans, data.id);
        requireValue(['proposed', 'accepted'].includes(plan.status), '约定已经结束');
        if (action === 'plan_accepted') {
            requireValue(plan.status === 'proposed', '约定已经接受');
            plan.status = 'accepted';
        } else if (action === 'plan_modified') {
            if (data.title !== undefined) plan.title = text(data.title, '约定');
            if (data.due !== undefined) plan.due = dateOrNull(data.due);
            if (local && data.dueDescription !== undefined) plan.dueDescription = String(data.dueDescription);
        } else {
            requireValue(action === 'plan_cancelled' || plan.status === 'accepted', '约定尚未接受');
            plan.status = action.slice(5);
            plan.outcome = typeof data.outcome === 'string' ? data.outcome : '';
            plan.endedAt = state.clock.date;
        }
    } else if (action === 'item_acquired' || action === 'item_registered') {
        requireValue(data.quantity == null || (Number.isFinite(data.quantity) && data.quantity >= 0), '物品数量无效');
        if (data.location != null) find(state.locations, data.location);
        insert(state.items, { id: data.id, name: text(data.name, '物品名称'),
            owner: optionalPerson(state, data.owner), holder: optionalPerson(state, data.holder),
            location: data.location ?? null, quantity: data.quantity ?? null, status: 'available', loan: null });
    } else if (action.startsWith('item_')) {
        const item = find(state.items, data.id);
        requireValue(item.status !== 'destroyed', '物品已经销毁');
        if (action === 'item_lent' || action === 'item_gifted') {
            find(state.people, data.from); find(state.people, data.to);
            requireValue(data.from !== data.to && item.holder === data.from && !item.loan, '持有状态不满足转交条件');
            if (action === 'item_gifted') {
                requireValue(item.owner === data.from, '赠送者的所有权不明确');
                item.owner = data.to;
            } else {
                item.loan = { id: text(data.loanId, '借用记录'), from: data.from, to: data.to };
            }
            item.holder = data.to; item.location = null;
        } else if (action === 'item_returned') {
            requireValue(item.loan && item.loan.id === data.loanId && item.holder === item.loan.to, '借用记录或当前持有人不匹配');
            item.holder = item.loan.from; item.loan = null; item.location = null;
        } else if (action === 'item_placed') {
            find(state.locations, data.location);
            requireValue(data.from != null && item.holder === data.from && !item.loan, '持有状态不满足放置条件');
            item.location = data.location; item.holder = null;
        } else if (action === 'item_consumed' || action === 'item_quantity_changed') {
            const delta = action === 'item_consumed' ? -data.quantity : data.delta;
            if (local && item.quantity === null && Number.isFinite(delta)) return state;
            requireValue(Number.isFinite(item.quantity) && Number.isFinite(delta)
                && (action !== 'item_consumed' || data.quantity > 0) && item.quantity + delta >= 0, '物品数量不足或不明确');
            item.quantity += delta;
        } else if (action === 'item_destroyed') {
            item.status = 'destroyed'; item.quantity = 0;
            if (local) { item.holder = null; item.loan = null; }
        } else if (action === 'item_damaged') {
            item.status = 'damaged';
        } else throw new Error('未知物品行为');
    } else if (action === 'location_created') {
        const location = { id: data.id, name: text(data.name, '地点名称'), parent: null };
        insert(state.locations, location);
        setParent(state, location, data.parent);
    } else if (action === 'location_reparented') {
        setParent(state, find(state.locations, data.id), data.parent);
    } else if (action === 'person_moved') {
        if (data.location != null) find(state.locations, data.location);
        find(state.people, data.id).location = data.location ?? null;
        if (local) find(state.people, data.id).locationConfirmedAt = { floor: event.order ?? event.floor, date: state.clock.date };
    } else if (action === 'clock_set') {
        state.clock = { date: local && !Object.hasOwn(data, 'date') ? state.clock.date : dateOrNull(data.date),
            description: local && !Object.hasOwn(data, 'description') ? state.clock.description : String(data.description || '') };
        requireValue(state.clock.date || state.clock.description.trim(), '剧情时间不明确');
    } else if (action === 'clock_advanced') {
        requireValue(state.clock.date === data.from && readStoryDate(data.from), '剧情时间依据已变化');
        requireValue(advanceStoryDate(data.from, data.days) === data.to && data.to, '相对时间结果无效');
        state.clock = { date: data.to, description: '' };
    } else {
        throw new Error('未知事实行为：' + String(action));
    }
    return state;
}
