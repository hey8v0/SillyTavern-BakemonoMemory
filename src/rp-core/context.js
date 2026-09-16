export function compileRpContext(core, view, { query = '', guide = '', maintenance = false, availableBudget = Infinity, includeBrief = true } = {}) {
    const empty = { brief: '', maintenance: '', units: [], omitted: 0, revision: core?.revision ?? null, budget: 0, blocked: false };
    if (!core?.settings?.enabled || !view?.projection) return empty;
    const p = view.projection, budget = Math.max(0, Math.min(availableBudget, Math.max(1000, Math.min(60000, Number(core.settings.contextBudget) || 16000))));
    const recent = (core.facts || []).filter(item => view.applied?.includes(item.id)).sort((a, b) => b.sequence - a.sequence).slice(0, 6);
    const changed = new Set(recent.flatMap(item => [item.data.id, item.data.from, item.data.to, ...(item.data.participants || [])]));
    const names = new Map(['people', 'locations', 'items'].flatMap(key => p[key].map(item => [item.id, item.name])));
    const name = id => id == null ? '未知' : names.get(id) || id;
    const present = new Set(p.scene?.present || []), q = String(query).toLocaleLowerCase();
    const relevance = item => (present.has(item.id) ? 100 : 0) + (item.location && item.location === p.scene?.location ? 50 : 0)
        + ([item.name, item.title, ...(item.aliases || [])].some(value => value && q.includes(value.toLocaleLowerCase())) ? 200 : 0) + (changed.has(item.id) ? 40 : 0);
    const people = [...p.people].sort((a, b) => relevance(b) - relevance(a));
    const selected = new Set(people.slice(0, 8).map(item => item.id));
    const related = item => [item.from, item.to, item.owner, item.holder, ...(item.participants || [])].some(id => selected.has(id));
    const units = [];
    const add = (kind, id, text, score, reason) => units.push({ kind, id, text, score, reason });
    add('scene', 'scene', '剧情时间：' + (p.clock?.date || p.clock?.description || '未知') + '；当前场景：' + name(p.scene?.location)
        + '；明确在场：' + (p.scene?.present?.map(name).join('、') || '尚未记录'), 1000, '当前场景');
    for (const item of people) {
        const active = (item.states || []).filter(state => state.active !== false && !state.ended && !state.endedAt);
        add('person', item.id, name(item.id) + '：最近确认位置 ' + name(item.location) + (item.traits?.length ? '；稳定特征 ' + item.traits.join('、') : '')
            + active.map(state => '；' + ({ private: '内心（其他角色未必知道）', author: '作者信息', observable: '可观察状态' }[state.visibility] || '状态')
                + (state.target ? '→' + name(state.target) : '') + '：' + state.description).join(''), relevance(item) + (active.length ? 90 : 20), present.has(item.id) ? '明确在场' : relevance(item) >= 200 ? '查询提及' : active.length ? '持续中的状态限制' : '近期位置');
    }
    for (const item of p.relationships.filter(item => item.status === 'active')) add('relationship', item.id, name(item.from) + (item.mutual ? ' ↔ ' : ' → ') + name(item.to) + '：' + item.kind, related(item) ? 160 : 10, '人物关系');
    for (const item of p.plans.filter(item => ['proposed', 'accepted'].includes(item.status))) add('plan', item.id, '约定 ' + item.title + '：' + item.status + '；时间 ' + (item.due || item.dueDescription || '未知'), relevance(item) + (related(item) ? 130 : 10), '尚未结束的约定');
    for (const item of p.items) add('item', item.id, '物品 ' + item.name + '：' + ({ available: '可用', damaged: '损坏', destroyed: '已销毁，不可继续使用' }[item.status] || item.status)
        + '；所有者 ' + name(item.owner) + '；持有者 ' + name(item.holder) + '；存放地点 ' + name(item.location) + '；数量 ' + (item.quantity ?? '未知')
        + (item.loan ? '；借用中 ' + name(item.loan.from) + ' → ' + name(item.loan.to) + '，未转移所有权' : ''), relevance(item) + (related(item) ? 140 : 0), '物品约束');
    units.sort((a, b) => b.score - a.score);
    const maintenanceText = maintenance ? guide + '\n\n已有状态参考（仅引用，不是本轮新事实）：\n' + JSON.stringify(p)
        + (recent.length ? '\n近期已结算（旧记录，不得再次结算）：\n' + JSON.stringify(recent.map(({action,data,order}) => ({action,data,sourceFloor:order}))) : '') : '';
    // Reference state is indivisible: dropping objects would make omission look
    // like permission to recreate them. An undersized budget stops maintenance.
    if (maintenanceText.length > budget) return { ...empty, budget, blocked: true, warning: '剧情状态参考超出预算，自动维护已暂缓；请提高状态上下文预算或精简提示词', omitted: units.length, revision: core.revision };
    const prefix = '## 当前剧情状态\n';
    let used = maintenanceText.length, selectedUnits = [];
    if (core.settings.inject !== false && includeBrief) for (const unit of units) {
        const extra = selectedUnits.length ? 1 : prefix.length + (maintenanceText ? 2 : 0);
        if (selectedUnits.length >= 24 || used + unit.text.length + extra > budget) continue;
        selectedUnits.push(unit); used += unit.text.length + extra;
    }
    const omittedImportant = core.settings.inject !== false && includeBrief && units.some(unit => unit.score >= 100 && !selectedUnits.includes(unit));
    return { brief: selectedUnits.length ? '## 当前剧情状态\n' + selectedUnits.map(item => item.text).join('\n') : '', maintenance: maintenanceText,
        warning: omittedImportant ? '状态预算不足，部分相关限制未进入续写简报；请提高预算或精简提示词。' : '',
        units: selectedUnits, omitted: units.length - selectedUnits.length, revision: core.revision, budget, used, blocked: false };
}
