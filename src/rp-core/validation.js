const requirements = {
    person_created: ['id', 'name'], person_renamed: ['id', 'name'], person_trait_recorded: ['id', 'trait'],
    person_registered: ['id', 'name'], relationship_recorded: ['id', 'from', 'to', 'kind'], scene_recorded: ['location'],
    person_age_recorded: ['id', 'age'], person_moved: ['id', 'location'],
    person_state_started: ['id', 'stateId', 'description'], person_state_ended: ['id', 'stateId'],
    relationship_established: ['id', 'from', 'to', 'kind'], relationship_ended: ['id'],
    relationship_conflict: ['id', 'description'], relationship_milestone: ['id', 'description'],
    plan_proposed: ['id', 'title', 'participants'], promise_created: ['id', 'title', 'participants'],
    plan_accepted: ['id'], plan_modified: ['id'], plan_completed: ['id'], plan_cancelled: ['id'], plan_failed: ['id'],
    item_acquired: ['id', 'name'], item_registered: ['id', 'name'], item_lent: ['id', 'from', 'to', 'loanId'], item_gifted: ['id', 'from', 'to'],
    item_returned: ['id', 'loanId'], item_placed: ['id', 'from', 'location'], item_consumed: ['id', 'quantity'],
    item_quantity_changed: ['id', 'delta'], item_damaged: ['id'], item_destroyed: ['id'],
    location_created: ['id', 'name'], location_reparented: ['id', 'parent'],
    clock_set: [], clock_advanced: ['from', 'days', 'to'],
};
const contexts = new Set(['current', 'dream', 'hypothetical', 'flashback']);
const strings = ['id', 'name', 'trait', 'stateId', 'description', 'from', 'to', 'kind', 'title', 'loanId', 'owner', 'holder', 'location', 'parent', 'outcome'];
const reject = reason => ({ status: 'rejected', reason });
const pending = reason => ({ status: 'pending', reason });

// Structural rejection is separate from replay-time business prerequisites.
export function classifyCandidate(event) {
    const context = event.context ?? 'current';
    if (!contexts.has(context)) return reject('不支持的叙事上下文');
    if (event.track !== 'facts') return { status: 'valid' };
    if (context !== 'current') return reject('梦境、假设或回忆不能直接成为当前事实；请保留为观察资料');
    if (event.action === 'state_updated') return ['model', 'user'].includes(event.origin?.kind) && event.data?.values && typeof event.data.values === 'object'
        ? { status: 'valid' } : reject('状态更新缺少受控写入来源');
    if (!Object.hasOwn(requirements, event.action)) return reject('不支持的事实行为');
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return reject('行为参数结构无效');
    for (const key of strings) {
        if (data[key] != null && (typeof data[key] !== 'string' || data[key].length > 4000)) return reject('行为参数类型无效：' + key);
    }
    for (const key of ['quantity', 'delta', 'days', 'age']) {
        if (data[key] != null && !Number.isFinite(data[key])) return reject('行为数值无效：' + key);
    }
    if (data.quantity != null && (data.quantity < 0 || (event.action === 'item_consumed' && data.quantity === 0))) return reject('物品数量必须合法且消耗量大于零');
    if (data.age != null && (!Number.isSafeInteger(data.age) || data.age < 0)) return reject('年龄必须为非负整数');
    if (data.days != null && !Number.isSafeInteger(data.days)) return reject('相对天数必须为整数');
    if (data.mutual != null && typeof data.mutual !== 'boolean') return reject('双方确认字段类型无效');
    if (data.participants != null && (!Array.isArray(data.participants) || data.participants.some(id => typeof id !== 'string' || !id.trim()))) return reject('参与者结构无效');
    const nullable = new Set(event.action === 'person_moved' ? ['location'] : event.action === 'location_reparented' ? ['parent'] : []);
    for (const key of requirements[event.action]) {
        if (!Object.hasOwn(data, key) || (!nullable.has(key) && (data[key] == null || data[key] === '' || (Array.isArray(data[key]) && !data[key].length)))) return pending('缺少明确的行为信息：' + key);
    }
    return { status: 'valid' };
}
