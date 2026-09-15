import { describeRecord, entityName, relationshipName, stateLabels, trackLabels, isCurrentRpRecord } from './state-view.js';
import { evidenceHash } from './source.js';

export function rpMemorySources(state, view) {
    if (!state.rpCore || !view?.projection) return [];
    const projection = view.projection, applied = new Set(view.applied);
    const retracted = new Set(state.rpCore.decisions.filter(item => item.action === 'retract').map(item => item.factId));
    const result = [];
    for (const track of ['facts', 'claims', 'observations']) {
        for (const record of state.rpCore[track]) {
            if (!isCurrentRpRecord(view, record)) continue;
            const validity = track === 'facts' ? retracted.has(record.id) ? '已撤回，不是当前事实' : applied.has(record.id) ? '有效事实' : '待复核，不作为当前事实'
                : track === 'claims' ? '角色说法，未作为事实确认' : '主观观察，不作为世界事实';
            const title = `${trackLabels[track]} · ${describeRecord(record, projection)}`;
            const text = `[${validity}] ${title}\n${record.data.description || ''}\n来源：第 ${record.floor} 楼${record.context && record.context !== 'current' ? ' · ' + record.context : ''}\n摘录：${record.evidence?.excerpt || '无正文摘录'}`;
            result.push({ id: `vec-rp-${track}-${record.id}`, hash: `rp:${track}:${record.id}:${evidenceHash(text)}`,
                type: `rp-${track}`, messageId: record.floor, sourceStart: record.floor, sourceEnd: record.floor,
                sourceMessageIds: [record.floor], title, text, preview: text.slice(0, 180), createdAt: record.recordedAt || '' });
        }
    }
    return result;
}

export function renderRpStateMemory(state, view, query = '', budget = 2400) {
    if (!state.rpCore?.settings?.inject || !view?.projection) return '';
    const p = view.projection;
    const relevant = list => list.map((value, index) => ({ value, index, score: query.includes(value.name || value.title || '\u0000') ? 1 : 0 }))
        .sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.value);
    const people = relevant(p.people).slice(0, 8), ids = new Set(people.map(item => item.id));
    const lines = [`剧情时间：${p.clock.date || p.clock.description || '未知'}`];
    for (const person of people) lines.push(`人物：${person.name}；位置：${entityName(p, person.location)}${person.age?.value != null ? `；年龄：${person.age.value}（${person.age.basis === 'reported' ? '正文年龄依据，非推算生日' : '按生日计算'}）` : ''}`);
    for (const relation of p.relationships.filter(item => ids.has(item.from) || ids.has(item.to)).slice(0, 8)) lines.push(`关系：${relationshipName(p, relation)}；${stateLabels[relation.status] || relation.status}`);
    for (const plan of relevant(p.plans.filter(item => ['proposed', 'accepted'].includes(item.status))).slice(0, 6)) lines.push(`约定：${plan.title}；${stateLabels[plan.status]}；期限：${plan.due || '未定'}${plan.timing?.status === 'overdue' ? '（逾期不代表已失败）' : ''}`);
    for (const item of relevant(p.items.filter(item => item.status !== 'destroyed')).slice(0, 6)) lines.push(`物品：${item.name}；所有者：${entityName(p, item.owner)}；持有者：${entityName(p, item.holder)}；数量：${item.quantity ?? '未知'}`);
    const accepted = []; let used = 0;
    for (const line of lines) {
        if (used + line.length + 1 > budget) continue;
        accepted.push(line); used += line.length + 1;
    }
    return accepted.length ? '## 当前剧情状态（确认基线与有效事实；说法、观察不改变此状态）\n' + accepted.join('\n') : '';
}
