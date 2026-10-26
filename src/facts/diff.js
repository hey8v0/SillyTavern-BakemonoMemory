/**
 * One 整理 as the user reads it: per card, which fields changed from what to what. Shared by the 剧情事实 page
 * (history) and 待确认 (a result held for review). Returns HTML; `esc` escapes text.
 */
import { factFields, factKindLabels } from './model.js';

export function describeChange(change) {
    if (change.created) return { verb: '新建', fields: factFields[change.kind].filter(key => change.after?.[key]).map(key => ({ key, before: '', after: change.after[key] })) };
    if (change.statusAfter === 'retired' && change.statusBefore !== 'retired') return { verb: '结束', fields: [] };
    const fields = factFields[change.kind].filter(key => (change.before?.[key] || '') !== (change.after?.[key] || ''))
        .map(key => ({ key, before: change.before?.[key] || '', after: change.after?.[key] || '' }));
    return { verb: change.statusBefore === 'retired' ? '恢复' : '修改', fields };
}

export function renderFactsChanges(entry, esc = value => String(value ?? '')) {
    const changes = entry?.changes || [];
    const parts = changes.map(change => {
        const { verb, fields } = describeChange(change);
        const rows = fields.map(({ key, before, after }) => `<div class="rp-event"><div class="rp-row-main"><strong>${esc(key)}</strong>${before ? `<small class="rp-diff-before">${esc(before)}</small>` : ''}<small>${after ? esc(after) : '（已清除）'}</small></div></div>`).join('');
        const kept = change.kept?.length ? `<p class="rp-note">保留了你改过的：${esc(change.kept.join('、'))}</p>` : '';
        return `<section class="rp-entry-sec"><h4><span class="rp-verb">${esc(verb)}</span> ${esc(factKindLabels[change.kind] || change.kind)} · ${esc(change.name)}</h4>${rows}${kept}</section>`;
    });
    if (entry?.reflectionAfter) {
        const lines = [['mainline', '主线'], ['threads', '伏笔与约定'], ['arcs', '人物弧线']]
            .filter(([key]) => (entry.reflectionAfter[key] || '') !== (entry.reflectionBefore?.[key] || ''))
            .map(([key, label]) => `<div class="rp-event"><div class="rp-row-main"><strong>${esc(label)}</strong><small>${esc(entry.reflectionAfter[key])}</small></div></div>`).join('');
        if (lines) parts.push(`<section class="rp-entry-sec"><h4>反思</h4>${lines}</section>`);
    }
    if (entry?.warnings?.length) parts.push(`<p class="rp-note">${esc(entry.warnings.join('；'))}</p>`);
    return parts.join('') || '<p class="rp-empty">没有变化</p>';
}

export function summarizeFactsChanges(entry) {
    const changes = entry?.changes || [];
    const created = changes.filter(change => change.created).length;
    const retired = changes.filter(change => change.statusAfter === 'retired' && change.statusBefore !== 'retired').length;
    const edited = changes.length - created - retired;
    const bits = [created ? `新建 ${created} 张` : '', edited ? `修改 ${edited} 张` : '', retired ? `结束 ${retired} 张` : '', entry?.reflectionAfter ? '反思更新' : '',
        entry?.conflicts?.length ? `${entry.conflicts.length} 处待裁决` : ''].filter(Boolean);
    return bits.join('，') || '没有变化';
}
