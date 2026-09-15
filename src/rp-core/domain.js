import { readStoryDate, advanceStoryDate } from './clock.js';
import { classifyCandidate } from './validation.js';
import { applyStateUpdate } from './state-update.js';

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

export function applyDomainFact(projection, event) {
    const classification = classifyCandidate({ ...event, track: 'facts' });
    requireValue(classification.status === 'valid', classification.reason);
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
        insert(person.states, { id: data.stateId, description: text(data.description, '状态'),
            startedAt: state.clock.date, expiresAt: dateOrNull(data.expiresAt) });
    } else if (action === 'person_state_ended') {
        const temporary = find(find(state.people, data.id).states, data.stateId);
        requireValue(!temporary.ended && temporary.endedAt == null, '临时状态已经结束');
        temporary.ended = true;
        temporary.endedAt = state.clock.date;
    } else if (action === 'scene_recorded') {
        find(state.locations, data.location);
        state.scene = { location: data.location };
    } else if (action === 'relationship_established' || action === 'relationship_recorded') {
        find(state.people, data.from); find(state.people, data.to);
        const kind = text(data.kind, '关系类型');
        requireValue(!['romantic', 'partner', 'married'].includes(kind) || data.mutual === true, '关系尚缺双方确认');
        requireValue(!state.relationships.some(item => item.from === data.from && item.to === data.to
            && item.kind === kind && item.status === 'active'), '关系已经建立');
        insert(state.relationships, { id: data.id, from: data.from, to: data.to, kind,
            mutual: data.mutual === true, status: 'active', since: action === 'relationship_recorded' ? null : state.clock.date, milestones: [], conflicts: [], recordedExisting: action === 'relationship_recorded' });
    } else if (action === 'relationship_ended') {
        const relation = find(state.relationships, data.id);
        requireValue(relation.status === 'active', '关系并未处于持续状态');
        relation.status = 'ended'; relation.endedAt = state.clock.date;
    } else if (action === 'relationship_conflict' || action === 'relationship_milestone') {
        const relation = find(state.relationships, data.id);
        relation[action === 'relationship_conflict' ? 'conflicts' : 'milestones']
            .push({ description: text(data.description, '关系事件'), date: state.clock.date, factId: event.id || null });
    } else if (action === 'plan_proposed' || action === 'promise_created') {
        requireValue(Array.isArray(data.participants) && data.participants.length > 0, '参与者不明确');
        data.participants.forEach(id => find(state.people, id));
        insert(state.plans, { id: data.id, title: text(data.title, '约定'),
            participants: [...new Set(data.participants)], status: action === 'promise_created' ? 'accepted' : 'proposed',
            createdAt: state.clock.date, due: dateOrNull(data.due), outcome: '' });
    } else if (['plan_accepted', 'plan_completed', 'plan_cancelled', 'plan_failed', 'plan_modified'].includes(action)) {
        const plan = find(state.plans, data.id);
        requireValue(['proposed', 'accepted'].includes(plan.status), '约定已经结束');
        if (action === 'plan_accepted') {
            requireValue(plan.status === 'proposed', '约定已经接受');
            plan.status = 'accepted';
        } else if (action === 'plan_modified') {
            if (data.title !== undefined) plan.title = text(data.title, '约定');
            if (data.due !== undefined) plan.due = dateOrNull(data.due);
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
            requireValue(Number.isFinite(item.quantity) && Number.isFinite(delta)
                && (action !== 'item_consumed' || data.quantity > 0) && item.quantity + delta >= 0, '物品数量不足或不明确');
            item.quantity += delta;
        } else if (action === 'item_destroyed') {
            item.status = 'destroyed'; item.quantity = 0;
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
    } else if (action === 'clock_set') {
        state.clock = { date: dateOrNull(data.date), description: String(data.description || '') };
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
