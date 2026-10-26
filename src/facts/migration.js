/**
 * One-time import of the older 剧情状态 projection and 表格 rows into fact cards. Pure: takes the data, returns
 * cards to add; the controller merges them into the chat's facts.
 */
import { factFields, findCard, normalizeName } from './model.js';

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const join = (...parts) => parts.map(text).filter(Boolean).join('；');

function nameIndex(projection) {
    const names = new Map();
    for (const kind of ['people', 'locations', 'items', 'plans']) for (const item of projection?.[kind] || []) names.set(item.id, text(item.name || item.title) || String(item.id));
    return id => id == null ? '' : names.get(id) || (/^(entity:|temporary:|state:|user-|@rp|[0-9a-f]{8}-)/i.test(String(id)) ? '' : String(id));
}

export function cardsFromProjection(projection, information = []) {
    if (!projection) return [];
    const name = nameIndex(projection);
    const cards = [];
    const aboutPerson = person => (information || []).filter(item => [item.data?.subject, item.data?.speaker].some(value => value === person.id || value === person.name || person.aliases?.includes(value)))
        .map(item => `${name(item.data.speaker) || item.data.speaker || '有人'}${item.track === 'claims' ? '说' : '觉得'}：${text(item.data.description)}`).slice(0, 6);
    for (const person of projection.people || []) {
        const states = (person.states || []).filter(state => state.active !== false && !state.ended && !state.endedAt).map(state => text(state.description));
        cards.push({ kind: 'person', name: text(person.name), aliases: person.aliases || [], fields: {
            处境: join(person.location ? `在 ${name(person.location)}` : '', ...states),
            性格: (person.traits || []).map(text).filter(Boolean).join('、'),
            备注: join(person.birthDate ? `生日 ${person.birthDate}` : '', ...aboutPerson(person)),
        } });
    }
    for (const relation of (projection.relationships || []).filter(item => item.status === 'active')) {
        const from = name(relation.from), to = name(relation.to);
        if (!from || !to) continue;
        cards.push({ kind: 'relationship', name: `${from} 与 ${to}`, aliases: [`${to} 与 ${from}`], fields: {
            双方: `${from}、${to}`, 当前关系: text(relation.kind),
            态度: join(...(relation.milestones || []).map(item => text(item.description || item)).slice(-3)),
        } });
    }
    for (const place of projection.locations || []) {
        cards.push({ kind: 'place', name: text(place.name), aliases: [], fields: { 描述: place.parent ? `属于 ${name(place.parent)}` : '',
            常在此处: (projection.people || []).filter(person => person.location === place.id).map(person => text(person.name)).join('、') } });
    }
    for (const item of projection.items || []) {
        const where = [item.holder ? `${name(item.holder)}手上` : '', item.owner && item.owner !== item.holder ? `归 ${name(item.owner)} 所有` : '', item.location ? `放在 ${name(item.location)}` : '', item.loan ? '借用中' : ''];
        const status = { available: '', damaged: '已损坏', destroyed: '已销毁' }[item.status] || '';
        cards.push({ kind: 'item', name: text(item.name), aliases: [], status: item.status === 'destroyed' ? 'retired' : 'active',
            fields: { 持有者: join(...where), 描述: join(status, item.quantity != null ? `数量 ${item.quantity}` : '') } });
    }
    for (const plan of projection.plans || []) {
        const done = ['completed'].includes(plan.status), dead = ['cancelled', 'failed'].includes(plan.status);
        cards.push({ kind: 'thread', name: text(plan.title), aliases: [], status: done || dead ? 'retired' : 'active', fields: {
            内容: text(plan.title), 状态: done ? '已了' : dead ? '失效' : '未了',
            参与者: (plan.participants || []).map(name).filter(Boolean).join('、'), 期限: text(plan.due || plan.dueDescription) } });
    }
    return cards.filter(card => card.name);
}

// Which card kind a table holds, read from its columns so renamed tables still map.
export function classifyTable(table) {
    const columns = (table?.columns || []).map(text);
    const has = (...needles) => needles.every(needle => columns.some(column => column.includes(needle)));
    if (table?.readOnly && columns.length === 1) return 'note';
    if (has('角色名') && (has('性格') || has('外貌'))) return 'person';
    if (has('约定') || has('任务')) return 'thread';
    if (has('双方') || (has('关系') && columns.length >= 2 && !has('设定'))) return 'relationship';
    if (has('设定')) return 'rule';
    if (has('物品')) return 'item';
    if (has('地点') && columns.length <= 3) return 'place';
    return 'custom';
}

const pickColumn = (table, ...needles) => {
    const columns = (table.columns || []).map(text);
    const index = columns.findIndex(column => needles.some(needle => column.includes(needle)));
    return index;
};
const cell = (row, index) => index >= 0 ? text(row?.[index]) : '';

export function cardsFromTables(tables = []) {
    const cards = [];
    for (const table of tables) {
        const kind = classifyTable(table);
        const rows = (table.rows || []).filter(row => Array.isArray(row) && row.some(value => text(value)));
        const col = (...needles) => pickColumn(table, ...needles);
        const title = text(table.name) || '表格';
        rows.forEach((row, index) => {
            if (kind === 'note') { cards.push({ kind: 'note', name: rows.length > 1 ? `${title} ${index + 1}` : title, aliases: [], fields: { 内容: text(row[0]) } }); return; }
            if (kind === 'person') {
                const look = col('外貌', '性别'), dress = col('衣着'), buff = col('BUFF', '临时', '状态');
                cards.push({ kind, name: cell(row, col('角色名', '姓名', '名字')), aliases: [], fields: { 外貌: join(cell(row, look), cell(row, dress)), 性格: cell(row, col('性格')),
                    处境: cell(row, buff), 备注: cell(row, col('备注')) } });
                return;
            }
            if (kind === 'relationship') {
                const pair = cell(row, col('双方', '角色'));
                cards.push({ kind, name: pair, aliases: [], fields: { 双方: pair, 基础关系: cell(row, col('基础')), 当前关系: cell(row, col('当前')), 态度: cell(row, col('态度', '情感')) } });
                return;
            }
            if (kind === 'rule') {
                cards.push({ kind, name: cell(row, col('设定名', '名')), aliases: [], fields: { 说明: join(cell(row, col('类型')), cell(row, col('说明', '详细'))), 影响范围: cell(row, col('影响', '范围')) } });
                return;
            }
            if (kind === 'item') {
                cards.push({ kind, name: cell(row, col('物品名', '物品')), aliases: [], fields: { 持有者: cell(row, col('拥有', '持有')), 描述: cell(row, col('描述')),
                    意义: join(cell(row, col('效果', '意义')), cell(row, col('来源'))) } });
                return;
            }
            if (kind === 'thread') {
                const content = cell(row, col('内容', '约定', '任务')), state = cell(row, col('完成', '状态'));
                // "待完成" / "未完成" are open; "已完成" / "完成" / "已了" are done.
                const done = /已完成|已了|^完成$/.test(state) && !/待|未/.test(state), dead = /失效|取消|作废/.test(state);
                cards.push({ kind, name: content.slice(0, 40), aliases: [], status: done || dead ? 'retired' : 'active', fields: { 内容: join(content, cell(row, col('结果'))),
                    状态: done ? '已了' : dead ? '失效' : '未了', 参与者: cell(row, col('角色', '双方')), 期限: cell(row, col('日期', '期限', '时间')) } });
                return;
            }
            if (kind === 'place') {
                cards.push({ kind, name: cell(row, col('地点', '名')), aliases: [], fields: { 描述: (table.columns || []).map((column, i) => i === col('地点', '名') ? '' : cell(row, i) ? `${text(column)}：${cell(row, i)}` : '').filter(Boolean).join('；') } });
                return;
            }
            // A table the user designed: one 设定 card per row, every column spelled out.
            const first = row.findIndex(value => text(value));
            cards.push({ kind: 'rule', name: `${title} · ${cell(row, first)}`.slice(0, 80), aliases: [], fields: {
                说明: (table.columns || []).map((column, i) => cell(row, i) ? `${text(column)}：${cell(row, i)}` : '').filter(Boolean).join('；'), 影响范围: '' } });
        });
    }
    return cards.filter(card => card.name);
}

// Cards the same thing produced twice (a person in the projection and in a table) fold into one: the first
// non-empty value of a field wins, the rest are kept after it.
export function mergeImportedCards(cards) {
    const result = [];
    for (const card of cards) {
        const same = result.find(item => item.kind === card.kind && (normalizeName(item.name) === normalizeName(card.name) || item.aliases.some(alias => normalizeName(alias) === normalizeName(card.name))));
        if (!same) { result.push({ ...card, aliases: [...card.aliases], fields: { ...card.fields } }); continue; }
        for (const key of factFields[card.kind]) {
            const value = text(card.fields[key]);
            if (value && !text(same.fields[key])) same.fields[key] = value;
            else if (value && !same.fields[key].includes(value)) same.fields[key] = `${same.fields[key]}；${value}`;
        }
        same.aliases = [...new Set([...same.aliases, ...card.aliases])];
        if (card.status === 'retired') same.status = 'retired';
    }
    return result;
}

export function buildLegacyImport({ projection = null, information = [], tables = [] } = {}) {
    return mergeImportedCards([...cardsFromProjection(projection, information), ...cardsFromTables(tables)]);
}

// Adds imported cards to the facts: an existing card with that name only gains the fields it lacked.
export function importCards(facts, cards, now = new Date().toISOString()) {
    const changes = [];
    for (const incoming of cards) {
        const fields = {};
        for (const key of factFields[incoming.kind]) fields[key] = text(incoming.fields?.[key]).slice(0, 4000);
        const existing = findCard(facts.cards, incoming.name, incoming.kind);
        if (existing) {
            const before = { ...existing.fields };
            let changed = false;
            for (const key of factFields[existing.kind]) if (fields[key] && !existing.fields[key]) { existing.fields[key] = fields[key]; changed = true; }
            const aliases = (incoming.aliases || []).filter(alias => normalizeName(alias) !== normalizeName(existing.name) && !existing.aliases.includes(alias));
            if (aliases.length) { existing.aliases.push(...aliases); changed = true; }
            if (changed) { existing.updatedAt = now; changes.push({ cardId: existing.id, kind: existing.kind, name: existing.name, created: false, before, after: { ...existing.fields }, statusBefore: existing.status, statusAfter: existing.status, kept: [] }); }
            continue;
        }
        if (!Object.values(fields).some(Boolean)) continue;
        const id = `fact-import-${facts.cards.length}-${normalizeName(incoming.name).slice(0, 24)}`;
        const card = { id, kind: incoming.kind, name: text(incoming.name).slice(0, 200), aliases: [...new Set((incoming.aliases || []).map(text).filter(Boolean))], fields,
            status: incoming.status === 'retired' ? 'retired' : 'active', pinned: false, userFields: [], updatedAt: now, updatedBy: 'import', sourceStage: null };
        facts.cards.push(card);
        changes.push({ cardId: card.id, kind: card.kind, name: card.name, created: true, before: null, after: { ...card.fields }, statusBefore: null, statusAfter: card.status, kept: [] });
    }
    if (!changes.length) return null;
    facts.revision += 1;
    const entry = { id: `facts-import-${now}`, at: now, trigger: 'import', stageHash: null, taskId: null, changes, reflectionBefore: { ...facts.reflection }, reflectionAfter: null, warnings: [], undone: false };
    facts.history.push(entry);
    facts.history = facts.history.slice(-60);
    return entry;
}
