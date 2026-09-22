import { createModelReferences } from './model-references.js';
import { currentInformation } from './current-information.js';

const internalId = value => /^(?:entity:|temporary:|state:|user-|[0-9a-f]{8}-[0-9a-f-]{27,})/i.test(value);
export function compileRpContext(core, view, { query = '', guide = '', maintenance = false, availableBudget = Infinity, includeBrief = true } = {}) {
    const empty = { brief: '', maintenance: '', units: [], omitted: 0, revision: core?.revision ?? null, budget: 0, used: 0, blocked: false };
    if (!core?.settings?.enabled || !view?.projection) return empty;
    const p = view.projection, budget = Math.max(0, Math.min(availableBudget, Math.max(1000, Math.min(60000, Number(core.settings.contextBudget) || 16000))));
    const refs = createModelReferences(p);
    const recent = (core.facts || []).filter(item => view.applied?.includes(item.id)).sort((a, b) => b.sequence - a.sequence).slice(0, 6);
    const changed = new Set(recent.flatMap(item => [item.data.id, item.data.from, item.data.to, ...(item.data.participants || [])]));
    const names = new Map(), kinds = new Map();
    for (const kind of ['people', 'locations', 'items', 'plans']) {
        const groups = new Map();
        for (const item of p[kind] || []) {
            const label = item.name || item.title || '未命名';
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(item);
        }
        for (const [label, same] of groups) same.sort((a, b) => a.id.localeCompare(b.id)).forEach((item, i) => {
            names.set(item.id, label + (same.length > 1 ? '（' + (i + 1) + '）' : '')); kinds.set(item.id, kind);
        });
    }
    const name = id => id == null ? '未知' : names.get(id) || (internalId(String(id)) || String(id).startsWith('@rp') ? '未知对象' : String(id));
    const present = new Set(p.scene?.present || []), q = String(query).toLocaleLowerCase();
    const relevance = item => (present.has(item.id) ? 100 : 0) + (item.location && item.location === p.scene?.location ? 50 : 0)
        + ([item.name, item.title, ...(item.aliases || [])].some(value => value && q.includes(value.toLocaleLowerCase())) ? 200 : 0) + (changed.has(item.id) ? 40 : 0);
    const people = [...(p.people || [])].sort((a, b) => relevance(b) - relevance(a));
    const selectedPeople = new Set(people.slice(0, 8).map(item => item.id));
    const related = item => [item.from, item.to, item.owner, item.holder, ...(item.participants || [])].some(id => selectedPeople.has(id));
    const units = [];
    const reference = (kind, id, label = name(id), owner = '') => refs.ref(kind, id, owner) ? [refs.ref(kind, id, owner), label] : null;
    const known = ids => ids.filter(Boolean).map(id => reference(kinds.get(id), id)).filter(Boolean);
    const add = (kind, id, text, score, reason, handles = []) => units.push({ kind, id, text, score, reason, handles: handles.filter(Boolean) });
    add('scene', 'scene', '剧情时间：' + (p.clock?.date || p.clock?.description || '未知') + '；当前场景：' + name(p.scene?.location)
        + '；明确在场：' + (p.scene?.present?.map(name).join('、') || '尚未记录'), 1000, '当前场景', known([p.scene?.location, ...(p.scene?.present || [])]));
    for (const item of people) {
        const active = (item.states || []).filter(state => state.active !== false && !state.ended && !state.endedAt);
        const handles = known([item.id, item.location, ...active.map(state => state.target)]);
        active.forEach((state, i) => handles.push(reference('states', state.id, name(item.id) + '/状态' + (i + 1), item.id)));
        add('person', item.id, name(item.id) + '：' + (item.location ? '最近位置 ' + name(item.location) : '位置未记录')
            + (item.traits?.length ? '；特征 ' + item.traits.join('、') : '')
            + active.map((state, i) => '；状态' + (i + 1) + '（' + ({ private: '内心，非公开知识', author: '作者信息，非公开知识', observable: '可观察' }[state.visibility] || '可见性未知') + '）'
                + (state.target ? '→' + name(state.target) : '') + '：' + state.description).join(''), relevance(item) + (active.length ? 90 : 20), present.has(item.id) ? '明确在场' : '人物现状', handles);
    }
    for (const item of (p.relationships || []).filter(item => item.status === 'active')) {
        const label = name(item.from) + (item.mutual ? ' ↔ ' : ' → ') + name(item.to) + '：' + item.kind;
        add('relationship', item.id, '关系 ' + label, related(item) ? 160 : 10, '已成立关系', [reference('relationships', item.id, label), ...known([item.from, item.to])]);
    }
    for (const item of (p.plans || []).filter(item => ['proposed', 'accepted'].includes(item.status))) add('plan', item.id, '约定 ' + item.title + '（' + (item.status === 'accepted' ? '已接受' : '仅提议') + '）：' + (item.participants || []).map(name).join('、')
        + '；时间 ' + (item.due || item.dueDescription || '未定'), relevance(item) + (related(item) ? 130 : 10), '尚未结束的约定', [reference('plans', item.id), ...known(item.participants || [])]);
    for (const item of p.items || []) add('item', item.id, '物品 ' + item.name + '：' + ({ available: '可用', damaged: '损坏', destroyed: '已销毁，不可继续使用' }[item.status] || item.status || '状态未知')
        + '；所有者 ' + name(item.owner) + '；持有者 ' + name(item.holder) + (item.location ? '；存放 ' + name(item.location) : '') + '；数量 ' + (item.quantity ?? '未知')
        + (item.loan ? '；借用中，未转移所有权' : ''), relevance(item) + (related(item) ? 140 : 0), '物品约束', [reference('items', item.id), ...known([item.owner, item.holder, item.location]), item.loan && reference('loans', item.loan.id, item.name + '/当前借用', item.id)]);
    // Keep only recent relevant statements, never promote dialogue into world facts.
    for (const item of currentInformation(core, view).slice(0, 20)) {
        const data = item.data, mentioned = [data.speaker, data.subject].some(id => selectedPeople.has(id) || people.slice(0, 8).some(person => [person.name, ...(person.aliases || [])].includes(id)));
        if (!mentioned && !(data.subject && q.includes(String(data.subject).toLocaleLowerCase()))) continue;
        add(item.track, item.id, (item.track === 'claims' ? '角色说法（非事实）' : '主观观察（非事实）') + ' ' + name(data.speaker) + ' → ' + name(data.subject) + '：' + data.description
            + (data.heardBy?.length ? '；明确知情者 ' + data.heardBy.map(name).join('、') : '；知情范围未记录'), 110, '相关说法', known([data.speaker, data.subject, ...(data.heardBy || [])]));
    }
    units.sort((a, b) => b.score - a.score);
    const wantsBrief = core.settings.inject !== false && includeBrief;
    const header = '## 当前剧情状态\n';
    const referenceHeader = '已有状态参考·短引用（未列出不等于不存在；新对象用名称，禁止猜测短引用）：\n';
    function pack(selectedUnits) {
        const state = selectedUnits.length ? header + selectedUnits.map(item => item.text).join('\n') : '';
        const handles = new Map(selectedUnits.flatMap(item => item.handles));
        const index = [...handles].map(([token, label]) => label + '=' + token).join('\n');
        const brief = wantsBrief ? state : '';
        const maintain = maintenance ? [guide, !wantsBrief ? state : '', index ? referenceHeader + index : ''].filter(Boolean).join('\n\n') : '';
        return { brief, maintenance: maintain, used: [brief, maintain].filter(Boolean).join('\n\n').length };
    }
    if (pack([]).used > budget) return { ...empty, budget, blocked: true, warning: '维护提示词超出状态预算，自动维护已暂缓；请精简提示词或提高预算。', omitted: units.length };
    const selectedUnits = [];
    if (wantsBrief || maintenance) for (const unit of units) if (selectedUnits.length < 24 && pack([...selectedUnits, unit]).used <= budget) selectedUnits.push(unit);
    const packed = pack(selectedUnits), omitted = units.length - selectedUnits.length;
    return { ...packed, warning: (wantsBrief || maintenance) && units.some(unit => unit.score >= 100 && !selectedUnits.includes(unit)) ? '状态预算不足，部分相关现状未注入。' : '',
        units: selectedUnits.map(({ handles, ...unit }) => unit), omitted, revision: core.revision, budget, blocked: false };
}
