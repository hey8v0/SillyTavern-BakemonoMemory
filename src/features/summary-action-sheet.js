import { sheetAction, sheetConfirm } from '../ui/action-sheet.js';

// The one place per-summary actions live: “⋯” beside an open summary opens this sheet.
// Delete asks again inside the sheet, so a stray tap never removes anything.
export function createSummaryActionSheet({
    sheet,
    escapeHtml,
    findSavedSummaryByHash,
    getSummaryDependents,
    startEdit,
    locateFloor,
    deleteSummary,
}) {
    function describe(item) {
        const data = item.dataset;
        const saved = data.summaryHash ? findSavedSummaryByHash(data.summaryHash) : null;
        return {
            item,
            hash: data.summaryHash,
            type: data.summaryType || 'story',
            name: data.summaryName || '这条摘要',
            range: data.summaryRange || '',
            floor: data.summaryFloor === '' ? null : Number(data.summaryFloor),
            saved,
            dependents: saved ? getSummaryDependents(saved.kind, data.summaryHash) : [],
        };
    }

    function consequence(info) {
        if (info.type === 'stage') {
            const count = info.saved?.summary.sourceHashes?.length || 0;
            return `删除后，它收录的${count ? ` ${count} 条` : ''}剧情摘要会回到“待整理”。聊天正文不受影响。`;
        }
        if (info.type === 'epic') return '删除后，它收录的阶段总结会回到“未收进多次总结”。聊天正文不受影响。';
        return '只删除插件里保存的这条剧情摘要，聊天正文不受影响。';
    }

    function menu(info) {
        const rows = [];
        const opts = { escapeHtml };
        if (info.saved) rows.push(sheetAction('edit', '编辑文字', '直接改原文', opts));
        if (Number.isFinite(info.floor)) rows.push(sheetAction('locate', '定位原文', `跳到第 ${info.floor} 楼 ›`, opts));
        if (!info.saved) rows.push(`<p class="bk-sheet-note">这条摘要写在第 ${Number.isFinite(info.floor) ? info.floor : '?'} 楼的聊天正文里，要改请在聊天里编辑那一楼。</p>`);
        if (info.saved) {
            rows.push(info.dependents.length
                ? sheetAction('delete', '删除', '已被上层总结收录，先删上层', { ...opts, danger: true, disabled: true })
                : sheetAction('delete', '删除', '会再确认一次', { ...opts, danger: true, view: true }));
        }
        return rows.join('');
    }

    function open(item, trigger) {
        const info = describe(item);
        sheet.open({
            title: info.name,
            subtitle: info.range,
            trigger,
            keepFocus: ['edit'],
            render: view => view === 'delete' ? sheetConfirm(consequence(info), 'delete', '删除', { escapeHtml }) : menu(info),
            run: async name => {
                if (name === 'edit') startEdit(info.item);
                else if (name === 'locate') locateFloor(info.floor);
                else if (name === 'delete') await deleteSummary(info.hash);
            },
        });
    }

    return { open };
}
