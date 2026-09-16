import { applyStateUpdate, validateStateFields } from './state-update.js';
import { readStoryDate } from './clock.js';
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
export function guardLocalUpdate(projection, event) {
    const { collection, id, values } = event.data;
    validateStateFields(collection, values);
    const old = projection[collection]?.find?.(item => item.id === id);
    if (!old) return;
    const correction = event.origin?.kind === 'user' && event.origin.intent === 'correction';
    if (!correction) {
        for (const field of ['states', 'traits', 'milestones', 'conflicts']) if (Object.hasOwn(values, field)) {
            requireValue(Array.isArray(values[field]) && (old[field] || []).every(item => values[field].some(next =>
                typeof item === 'string' ? next === item : next.id === item.id && JSON.stringify(next) === JSON.stringify(item))),
            '旧格式会覆盖已有' + field + '；请使用逐项开始、修订或结束事件');
        }
        if (collection === 'items') {
            requireValue(old.status !== 'destroyed' || !Object.keys(values).some(key => ['status', 'quantity', 'holder', 'owner'].includes(key)), '已销毁物品需要明确恢复事件');
            requireValue(!old.loan || !['owner', 'holder', 'loan'].some(key => Object.hasOwn(values, key) && JSON.stringify(values[key]) !== JSON.stringify(old[key])), '借用中的物品需要归还或明确更正');
        }
        if (collection === 'plans' && ['completed', 'cancelled', 'failed'].includes(old.status)) requireValue(!values.status || values.status === old.status, '已结束约定需要明确重新开启事件');
    }
}
export function applyLocalEvent(projection, event) {
    const data = event.data, state = structuredClone(projection);
    const person = () => { const result = state.people.find(item => item.id === data.id); requireValue(result, '人物不存在'); return result; };
    if (event.action === 'state_updated') {
        guardLocalUpdate(state, event);
        const result = applyStateUpdate(state, data);
        if (data.collection === 'items' && data.values.status === 'destroyed') {
            const item = result.items.find(item => item.id === data.id); item.quantity = 0; item.loan = null; item.holder = null;
        }
        return result;
    }
    if (event.action === 'person_state_revised') {
        const temporary = person().states.find(item => item.id === data.stateId);
        requireValue(temporary && !temporary.ended && !temporary.endedAt, '临时状态不存在或已结束');
        if (data.description !== undefined) requireValue(typeof data.description === 'string' && data.description.trim(), '状态描述不能为空');
        if (data.target != null) requireValue(state.people.some(item => item.id === data.target), '状态指向人物不存在');
        if (data.expiresAt != null) requireValue(readStoryDate(data.expiresAt), '到期时间无效');
        for (const field of ['description', 'visibility', 'target', 'expiresAt']) if (Object.hasOwn(data, field)) temporary[field] = data[field];
        return state;
    }
    if (event.action === 'person_trait_removed') {
        const target = person(); requireValue(target.traits.includes(data.trait), '特征不存在');
        target.traits = target.traits.filter(value => value !== data.trait); return state;
    }
    if (event.action === 'plan_reopened') {
        const plan = state.plans.find(item => item.id === data.id);
        requireValue(plan && ['completed', 'cancelled', 'failed'].includes(plan.status), '约定尚未结束');
        plan.status = 'proposed'; plan.outcome = ''; plan.endedAt = null; return state;
    }
    if (event.action === 'item_restored') {
        const item = state.items.find(item => item.id === data.id);
        requireValue(item?.status === 'destroyed', '物品并未销毁');
        requireValue(data.quantity == null || Number.isFinite(data.quantity) && data.quantity >= 0, '恢复数量无效');
        item.status = 'available'; item.quantity = data.quantity ?? null; item.loan = null; item.holder = null; return state;
    }
    return null;
}
