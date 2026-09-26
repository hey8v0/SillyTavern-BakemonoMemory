import { currentInformation, informationName } from './current-information.js';

export const trackLabels = { facts: '事实', claims: '角色说法', observations: '观察', pending: '未采用' };
export const stateLabels = { active: '持续中', ended: '已结束', proposed: '提议中', accepted: '已接受', completed: '已完成', cancelled: '已取消', failed: '明确失败', available: '可用', damaged: '损坏', destroyed: '已销毁', pending: '待确认', ignored: '已忽略', rejected: '已拒绝' };
export const actionLabels = {
    person_registered: '登记人物', relationship_recorded: '记录已有关系', scene_recorded: '当前场景',
    person_created: '登记人物', person_renamed: '人物改名', person_trait_recorded: '记录特征', person_age_recorded: '记录年龄', person_moved: '人物移动',
    person_state_started: '开始临时状态', person_state_ended: '结束临时状态',
    relationship_established: '建立关系', relationship_ended: '结束关系', relationship_conflict: '发生冲突', relationship_milestone: '关系节点',
    plan_proposed: '提出计划', promise_created: '作出承诺', plan_accepted: '接受约定', plan_reopened: '重新开启约定', item_restored: '恢复物品', person_state_revised: '修订临时状态', person_trait_removed: '移除特征', plan_modified: '修改约定', plan_completed: '履行约定', plan_cancelled: '取消约定', plan_failed: '约定失败',
    item_acquired: '获得物品', item_registered: '登记物品', item_lent: '借出物品', item_returned: '归还物品', item_gifted: '赠送物品', item_placed: '放置物品', item_consumed: '消耗物品', item_quantity_changed: '数量变化', item_damaged: '物品损坏', item_destroyed: '物品销毁',
    location_created: '登记地点', location_reparented: '调整地点层级', clock_set: '设置剧情时间', clock_advanced: '推进剧情时间',
    claim_made: '角色说法', observation_recorded: '推测',
};
const kinds = { romantic: '恋爱', partner: '伴侣', married: '婚姻' };
export function entityName(projection, id) {
    for (const key of ['people', 'items', 'locations', 'plans']) {
        const entity = projection[key]?.find(item => item.id === id);
        if (entity) return entity.name || entity.title || '未命名';
    }
    return id == null ? '未知' : '对象待确定';
}
export function relationshipName(projection, relation) {
    return `${entityName(projection, relation.from)} → ${entityName(projection, relation.to)} · ${kinds[relation.kind] || relation.kind || '关系'}`;
}
export function describeRecord(record, projection) {
    if (record.action === 'state_updated') {
        const { collection, id, values } = record.data;
        const label = ({ people: '人物', relationships: '关系', plans: '约定', items: '物品', locations: '地点', clock: '剧情时间', scene: '当前场景' })[collection] || '状态';
        const title = values.name || values.title || (collection === 'clock' ? values.date || values.description : collection === 'scene' ? entityName(projection, values.location) : collection === 'relationships' ? values.kind : entityName(projection, id));
        return (record.origin?.kind === 'user' ? '修改' : '记录') + label + (title ? ' · ' + title : '');
    }
    const data = record.data || {}, relation = projection.relationships?.find(item => item.id === data.id);
    const subject = relation ? relationshipName(projection, relation) : data.name || data.title
        || (data.id ? entityName(projection, data.id) : record.action === 'scene_recorded' ? entityName(projection, data.location) : '');
    const speaker = ['claims', 'observations'].includes(record.track) && data.speaker ? informationName(projection, data.speaker) : '';
    const destination = record.action === 'person_moved' && data.location ? '→ ' + entityName(projection, data.location) : '';
    return [actionLabels[record.action] || '信息记录', subject || speaker, destination || data.description || data.trait || data.date || ''].filter(Boolean).join(' · ');
}
export function describeStateValues(data, projection) {
    const labels = { name: '名称', title: '标题', location: '位置', parent: '上级地点', from: '人物', to: '关联人物', owner: '所有者', holder: '持有者', quantity: '数量', status: '状态', kind: '关系', mutual: '双向', since: '开始日期', endedAt: '结束日期', due: '约定日期', date: '剧情日期', description: '描述', birthDate: '出生日期', states: '临时状态', participants: '参与者', aliases: '别名', traits: '特征', outcome: '结果', milestones: '共同经历', conflicts: '冲突' };
    return Object.entries(data.values || {}).filter(([field]) => !['id', 'stateId', 'locationConfirmedAt'].includes(field)).map(([field, value]) => {
        const readable = item => item == null ? '未知 / 无' : typeof item === 'boolean' ? item ? '是' : '否'
            : typeof item === 'object' ? item.description || (item.years != null ? item.years + '岁' : '')
                : ['location', 'parent', 'from', 'to', 'owner', 'holder', 'participants'].includes(field) ? entityName(projection, item)
                    : field === 'status' ? stateLabels[item] || item : String(item);
        return `${labels[field] || field}：${(Array.isArray(value) ? value.slice(0, 20).map(readable).join('、') || '无' : readable(value)).slice(0, 2000)}`;
    });
}
export function createStateNavigation() {
    const chats = new WeakMap();
    function get(state) {
        if (!chats.has(state)) chats.set(state, { tab: 'overview', filter: '', page: 0, search: '', selected: null, floor: null, scroll: 0 });
        return chats.get(state);
    }
    return { get, update(state, patch) { Object.assign(get(state), patch); return get(state); } };
}

export function isCurrentRpRecord(view, item) {
    return !view?.sourceStates?.[item.id] || view.sourceStates[item.id] === 'current';
}

export function buildStatePage(core, view, navigation = {}) {
    const projection = view.projection, { tab = 'overview', filter = '', search = '' } = navigation;
    let rows = [];
    const entityRows = (key, values) => values.map(item => ({ kind: key, id: item.id,
        title: key === 'relationships' ? relationshipName(projection, item) : item.name || item.title || '未命名',
        status: stateLabels[item.status] || '', detail: key === 'items'
            ? `持有：${entityName(projection, item.holder)} · 数量：${item.quantity ?? '未知'}`
            : key === 'plans' ? `期限：${item.due || item.dueDescription || '未定'}${item.timing?.status === 'overdue' ? ' · 已逾期' : ''}`
                : key === 'people' ? `最近确认位置：${entityName(projection, item.location)}` : '', record: item }));
    if (tab === 'directory') {
        rows = ['people', 'relationships', 'items', 'plans', 'locations'].filter(kind => !filter || filter === kind).flatMap(kind => entityRows(kind, projection[kind]));
        for (const row of rows.filter(row => row.kind === 'people')) row.detail = (row.record.states || []).filter(state => state.active !== false && !state.ended && !state.endedAt).map(state => state.description).filter(Boolean).join('；')
            || (projection.scene?.present?.includes(row.id) ? '在场' : row.record.location ? '最近位置：' + entityName(projection, row.record.location) : '');
        rows.push(...currentInformation(core, view, { floor: navigation.floor }).filter(item => !filter || filter === item.track).map(item => ({ kind: item.track, id: item.id,
            title: informationName(projection, item.data.speaker) + (item.data.subject ? ' → ' + informationName(projection, item.data.subject) : '') + '：' + item.data.description, status: trackLabels[item.track], detail: '第 ' + item.floor + ' 楼', record: item })));
        const order = ['people', 'relationships', 'claims', 'observations', 'items', 'plans', 'locations'];
        rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    }
    else if (tab === 'people') rows = [...(filter !== 'relationships' ? entityRows('people', projection.people) : []), ...(filter !== 'people' ? entityRows('relationships', projection.relationships) : [])];
    else if (tab === 'world') {
        const selected = ['plans', 'items', 'locations'].includes(filter) ? filter : 'plans';
        rows = entityRows(selected, projection[selected]);
    } else if (tab === 'history') {
        const visible = item => navigation.floor == null || item.floor <= navigation.floor;
        const retracted = new Set(core.decisions.filter(visible).filter(item => ['retract', 'supersede'].includes(item.action)).map(item => item.factId));
        if (filter === 'pending') rows = core.candidates.filter(item => visible(item) && isCurrentRpRecord(view, item) && !item.superseded && ['pending', 'rejected'].includes(item.status)).map(item => ({ kind: 'candidate', id: item.id,
            title: describeRecord(item, projection), status: '未采用', detail: item.reason || '参数不足，本次未记录', record: item, track: item.track }));
        if (filter === 'pending') {
            for (const pending of view.pending) {
                const item = core.facts.find(fact => fact.id === pending.factId);
                if (item && visible(item) && isCurrentRpRecord(view, item)) rows.push({ kind: 'facts', id: item.id, title: describeRecord(item, projection), status: '待重新提取', detail: pending.reason, record: item, track: 'facts' });
            }
        }
        else {
            const applied = new Set(view.applied);
            for (const track of ['facts', 'claims', 'observations']) {
                if (filter && filter !== 'source-history' && filter !== track) continue;
                for (const item of core[track].filter(visible).filter(item => filter === 'source-history' ? !isCurrentRpRecord(view, item) : isCurrentRpRecord(view, item))) rows.push({ kind: track, id: item.id, title: describeRecord(item, projection),
                    status: filter === 'source-history' ? '旧回复记录' : track === 'facts' ? retracted.has(item.id) ? '已撤回' : !applied.has(item.id) ? '待复核' : trackLabels[track] : trackLabels[track],
                    detail: `第 ${item.order ?? item.floor} 楼`, record: item, track });
            }
            if (filter === 'source-history') rows.push(...core.candidates.filter(item => visible(item) && item.status === 'pending' && !isCurrentRpRecord(view, item)).map(item => ({ kind: 'candidate', id: item.id,
                title: describeRecord(item, projection), status: '旧回复候选', detail: '不参与当前审核', record: item, track: item.track })));
            rows.sort((a, b) => b.record.sequence - a.record.sequence);
        }
    } else {
        rows = [...entityRows('relationships', projection.relationships.filter(item => item.status === 'active').slice(0, 3)),
            ...entityRows('plans', projection.plans.filter(item => ['proposed', 'accepted'].includes(item.status)).slice(0, 3))];
    }
    const terms = String(search).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) rows = rows.filter(row => terms.every(term => `${row.title} ${row.status} ${row.detail}`.toLocaleLowerCase().includes(term)));
    const total = rows.length, pages = Math.max(1, Math.ceil(total / 20));
    const page = Math.min(Math.max(0, Number.isSafeInteger(navigation.page) ? navigation.page : 0), pages - 1);
    return { rows: rows.slice(page * 20, page * 20 + 20), total, page, pages };
}
