import { createProjection } from './domain.js';
import { readStoryDate } from './clock.js';

export const migrationFields = {
    people: { name: '姓名', traits: '特征', birthDate: '出生日期' },
    relationships: { from: '关系发起人', to: '关系对象', kind: '关系类型' },
    plans: { title: '约定内容', participants: '参与者', due: '期限', status: '履约状态' },
    items: { name: '物品名称', owner: '所有者', holder: '持有者', quantity: '数量' },
    locations: { name: '地点名称', parent: '上级地点' },
};
export const migrationLabels = { people: '人物', relationships: '关系', plans: '约定', items: '物品', locations: '地点' };
const aliases = { name: ['角色名', '姓名', '物品名', '地点名', '名称'], title: ['任务/约定内容', '约定内容', '标题'], owner: ['拥有人', '所有者'], holder: ['持有人', '持有者'], participants: ['参与者', '双方角色名'], due: ['日期', '期限'], status: ['完成/待完成', '履约状态'], from: ['发起人'], to: ['关系对象'], kind: ['关系类型'], traits: ['性别/年龄/身高/外貌', '特征'], birthDate: ['出生日期'], quantity: ['数量'], parent: ['上级地点'] };
export function suggestBaselineMappings(state) {
    return (state.tableDatabase?.tables || []).map((table, tableIndex) => {
        const kind = /角色特征|人物档案/.test(table.name) ? 'people' : /人物关系/.test(table.name) ? 'relationships'
            : /重要物品/.test(table.name) ? 'items' : /约定/.test(table.name) ? 'plans' : /地点/.test(table.name) ? 'locations' : '';
        const fields = {};
        for (const key of Object.keys(migrationFields[kind] || {})) {
            const indexes = table.columns.map((name, i) => aliases[key]?.includes(name) ? i : -1).filter(i => i >= 0);
            if (indexes.length === 1) fields[key] = indexes[0];
        }
        return { tableIndex, kind, fields };
    });
}
export function buildBaselinePreview(state, mappings, { skipRows = [], makeId = () => crypto.randomUUID() } = {}) {
    const projection = createProjection(), issues = [], imported = [], skipped = new Set(skipRows), pending = [];
    const tables = state.tableDatabase?.tables || [];
    for (const mapping of mappings) {
        if (!mapping.kind) continue;
        if (!Object.hasOwn(migrationFields, mapping.kind) || !Number.isInteger(mapping.tableIndex) || !tables[mapping.tableIndex]) throw new Error('表格映射无效');
        const table = tables[mapping.tableIndex];
        for (const [field, index] of Object.entries(mapping.fields)) {
            if (!Object.hasOwn(migrationFields[mapping.kind], field) || !Number.isInteger(index) || index < 0 || index >= table.columns.length) throw new Error('字段映射无效');
        }
        table.rows.forEach((row, rowIndex) => {
            const rowKey = `${mapping.tableIndex}:${rowIndex}`;
            if (skipped.has(rowKey)) return;
            const data = Object.fromEntries(Object.entries(mapping.fields).map(([field, index]) => [field, String(row[index] ?? '').trim()]));
            const source = { table: table.name, tableIndex: mapping.tableIndex, row: rowIndex + 1, rowKey };
            pending.push({ kind: mapping.kind, data, source, id: 'baseline-' + makeId() });
        });
    }
    const problem = (entry, reason) => issues.push({ ...entry.source, reason });
    const uniquePerson = name => {
        const matches = projection.people.filter(person => person.name === name);
        if (matches.length !== 1) throw new Error('人物名称缺失、重名或尚未映射：' + (name || '未填写'));
        return matches[0].id;
    };
    for (const entry of pending.filter(item => ['people', 'locations'].includes(item.kind))) {
        const { data, kind, id, source } = entry;
        if (!data.name) { problem(entry, '缺少明确名称'); continue; }
        if (pending.filter(item => item.kind === kind && item.data.name === data.name).length > 1) { problem(entry, '同名对象需先区分，不能自动合并'); continue; }
        if (data.birthDate && !readStoryDate(data.birthDate)) { problem(entry, '出生日期不明确'); continue; }
        projection[kind].push(kind === 'people' ? { id, name: data.name, aliases: [], location: null, birthDate: data.birthDate || null, ageEvidence: null, traits: data.traits ? [data.traits] : [], states: [], baselineSource: source }
            : { id, name: data.name, parent: null, baselineSource: source });
        imported.push(source);
    }
    for (const entry of pending.filter(item => !['people', 'locations'].includes(item.kind))) {
        const { data: d, kind, id, source } = entry;
        try {
            let entity;
            if (kind === 'relationships') {
                if (!d.kind) throw new Error('关系类型不明确');
                entity = { id, from: uniquePerson(d.from), to: uniquePerson(d.to), kind: d.kind, mutual: false, status: 'active', since: null, milestones: [], conflicts: [] };
            } else if (kind === 'items') {
                if (!d.name) throw new Error('缺少物品名称');
                const quantity = d.quantity ? Number(d.quantity) : null;
                if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) throw new Error('数量不明确或非法');
                entity = { id, name: d.name, owner: d.owner ? uniquePerson(d.owner) : null, holder: d.holder ? uniquePerson(d.holder) : null, quantity, location: null, loan: null, status: 'available' };
            } else {
                if (!d.title || !d.participants) throw new Error('缺少约定内容或参与者');
                const status = ({ '待完成': 'accepted', '已接受': 'accepted', '提议': 'proposed', '完成': 'completed', '已完成': 'completed', '取消': 'cancelled', '失败': 'failed' })[d.status];
                if (!status) throw new Error('履约状态不明确，请映射明确的状态列');
                if (d.due && !readStoryDate(d.due)) throw new Error('期限不是明确公历日期');
                entity = { id, title: d.title, participants: d.participants.split(/[、,，;；]/).map(name => uniquePerson(name.trim())), status, due: d.due || null, createdAt: null, outcome: '' };
            }
            projection[kind].push({ ...entity, baselineSource: source }); imported.push(source);
        } catch (error) { problem(entry, error.message); }
    }
    for (const entry of pending.filter(item => item.kind === 'locations' && item.data.parent)) {
        const entity = projection.locations.find(item => item.id === entry.id);
        if (!entity) continue;
        const parents = projection.locations.filter(item => item.name === entry.data.parent);
        if (parents.length !== 1 || parents[0].id === entity.id) { problem(entry, '上级地点不明确或构成循环'); continue; }
        entity.parent = parents[0].id;
    }
    for (const entity of projection.locations) {
        const visited = new Set([entity.id]); let cursor = entity.parent;
        while (cursor) {
            if (visited.has(cursor)) { issues.push({ ...entity.baselineSource, reason: '地点层级循环' }); break; }
            visited.add(cursor); cursor = projection.locations.find(item => item.id === cursor)?.parent;
        }
    }
    return { projection, issues, imported, sourceSignature: JSON.stringify(tables), mappings: structuredClone(mappings), skipRows: [...skipped] };
}
