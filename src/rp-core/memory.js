import { describeRecord, describeStateValues, entityName, relationshipName, stateLabels, trackLabels, isCurrentRpRecord } from './state-view.js';
import { compileRpContext } from './context.js';
import { evidenceHash } from './source.js';
import { removeRpVectorCache } from '../vector/source-policy.js';

function historicalValidity(record, projection) {
    const data = record.data;
    if (record.action === 'item_lent' && projection.items.find(item => item.id === data.id)?.loan?.id !== data.loanId) return '借用已结束的历史经历，不代表仍在借用';
    if (record.action === 'person_state_started' && projection.people.find(item => item.id === data.id)?.states?.find(item => item.id === data.stateId)?.active === false) return '已结束的历史状态，不是当前状态';
    if (record.action.startsWith('relationship_') && projection.relationships.find(item => item.id === data.id)?.status === 'ended') return '关系已结束的历史经历，不是当前关系';
    if (record.action.startsWith('item_') && record.action !== 'item_destroyed' && projection.items.find(item => item.id === data.id)?.status === 'destroyed') return '物品已销毁的历史经历，不代表仍可使用';
    return '历史事实，当前状态以剧情状态视图为准';
}

export function rpMemorySources(state, view) {
    if (!state.rpCore || state.rpCore.settings?.enabled === false || state.rpCore.settings?.inject === false || !view?.projection) return [];
    const projection = view.projection, applied = new Set(view.applied);
    const retracted = new Set(state.rpCore.decisions.filter(item => ['retract', 'supersede'].includes(item.action)).map(item => item.factId));
    const corrected = new Set(state.rpCore.facts.flatMap(item => item.origin?.kind === 'user' && item.origin.intent === 'correction' ? item.origin.corrects || [] : []));
    const result = [];
    for (const track of ['facts', 'claims', 'observations']) {
        for (const record of state.rpCore[track]) {
            if (!isCurrentRpRecord(view, record)) continue;
            const validity = track === 'facts' ? corrected.has(record.id) ? '已被人工纠正，旧结论需要复核，不是当前事实' : retracted.has(record.id) ? '已撤回，不是当前事实' : applied.has(record.id) ? historicalValidity(record, projection) : '待复核，不作为当前事实'
                : track === 'claims' ? '角色说法，未作为事实确认' : '主观观察，不作为世界事实';
            const title = `${trackLabels[track]} · ${describeRecord(record, projection)}`;
            const detail = record.action === 'state_updated' ? describeStateValues(record.data, projection).join('\n') : record.data.description || '';
            const text = `[${validity}] ${title}\n${detail}\n来源：第 ${(record.order ?? record.floor)} 楼${record.context && record.context !== 'current' ? ' · ' + record.context : ''}\n${record.evidence?.excerpt ? '摘录：' + record.evidence.excerpt : record.origin?.kind === 'model' ? '由模型根据所属回复整理' : record.origin?.kind === 'user' ? '用户修改' : '无正文摘录'}`;
            result.push({ id: `vec-rp-${track}-${record.id}`, hash: `rp:${track}:${record.id}:${evidenceHash(text)}`,
                type: `rp-${track}`, messageId: record.order ?? record.floor, sourceStart: record.order ?? record.floor, sourceEnd: record.order ?? record.floor,
                sourceMessageIds: [record.order ?? record.floor], title, text, preview: text.slice(0, 180), createdAt: record.recordedAt || '' });
        }
    }
    return result;
}

export function renderRpStateMemory(state, view, query = '', budget = null) {
    const core = state.rpCore;
    return compileRpContext(budget && core ? { ...core, settings: { ...core.settings, contextBudget: budget } } : core, view, { query }).brief;
}

// Derived RP vectors can be discarded without touching body/summary vectors or configuration.
export function clearRpDerivedCache(state) {
    removeRpVectorCache(state.vectorMemory);
}
