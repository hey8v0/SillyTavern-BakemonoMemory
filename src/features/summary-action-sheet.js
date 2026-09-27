// The one place per-summary actions live: “⋯” beside an open summary opens this sheet.
// Delete asks again inside the sheet, so a stray tap never removes anything.
export function createSummaryActionSheet({
    documentRef,
    escapeHtml,
    findSavedSummaryByHash,
    getSummaryDependents,
    startEdit,
    locateFloor,
    deleteSummary,
}) {
    let sheet = null, current = null, returnFocus = null;

    function host() {
        const root = documentRef.getElementById('bakemono-workbench-root');
        return root?.querySelector('.bakemono-workbench') || root || documentRef.body;
    }

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

    function action(name, label, note, extra = '') {
        return `<button type="button" class="bk-sum-act${extra}" data-summary-sheet-do="${name}"><span>${label}</span><small>${escapeHtml(note)}</small></button>`;
    }

    function menuView(info) {
        const rows = [];
        if (info.saved) rows.push(action('edit', '编辑文字', '直接改原文'));
        if (Number.isFinite(info.floor)) rows.push(action('locate', '定位原文', `跳到第 ${info.floor} 楼 ›`));
        if (!info.saved) rows.push(`<p class="bk-sum-sheet-note">这条摘要写在第 ${Number.isFinite(info.floor) ? info.floor : '?'} 楼的聊天正文里，要改请在聊天里编辑那一楼。</p>`);
        if (info.saved) {
            rows.push(info.dependents.length
                ? `<button type="button" class="bk-sum-act is-danger" disabled><span>删除</span><small>已被上层总结收录，先删上层</small></button>`
                : `<button type="button" class="bk-sum-act is-danger" data-summary-sheet-view="delete"><span>删除</span><small>会再确认一次</small></button>`);
        }
        return rows.join('');
    }

    function deleteView(info) {
        return `<div class="bk-sum-confirm"><p>${escapeHtml(consequence(info))}</p>
            <div class="bk-sum-confirm-actions"><button type="button" class="bk-sum-link" data-summary-sheet-view="menu">‹ 返回</button>
            <button type="button" class="menu_button bk-sum-danger" data-summary-sheet-do="delete">删除</button></div></div>`;
    }

    function render(view = 'menu') {
        sheet.querySelector('.bk-sum-sheet-body').innerHTML = view === 'delete' ? deleteView(current) : menuView(current);
        sheet.querySelector('.bk-sum-sheet-body button:not([disabled])')?.focus({ preventScroll: true });
    }

    function build() {
        const wrap = documentRef.createElement('div');
        wrap.className = 'bk-sum-sheet-wrap';
        wrap.hidden = true;
        wrap.innerHTML = `<div class="bk-sum-sheet-scrim" data-summary-sheet-close></div>
            <div class="bk-sum-sheet" role="dialog" aria-modal="true" aria-labelledby="bk-sum-sheet-title">
                <div class="bk-sum-sheet-h"><div><strong id="bk-sum-sheet-title"></strong><small></small></div>
                <button type="button" class="bk-sum-link" data-summary-sheet-close>关闭</button></div>
                <div class="bk-sum-sheet-body"></div>
            </div>`;
        wrap.addEventListener('click', event => {
            const target = event.target.closest('button, [data-summary-sheet-close]');
            if (!target || target.disabled) return;
            if (target.hasAttribute('data-summary-sheet-close')) return close();
            if (target.dataset.summarySheetView) return render(target.dataset.summarySheetView);
            run(target.dataset.summarySheetDo);
        });
        wrap.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); close(); }
            if (event.key !== 'Tab') return;
            const buttons = [...wrap.querySelectorAll('.bk-sum-sheet button:not([disabled])')];
            const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
            if (documentRef.activeElement === edge) { event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus(); }
        });
        return wrap;
    }

    async function run(name) {
        const info = current;
        close({ restore: name !== 'edit' });
        if (!info) return;
        if (name === 'edit') startEdit(info.item);
        else if (name === 'locate') locateFloor(info.floor);
        else if (name === 'delete') await deleteSummary(info.hash);
    }

    function open(item, trigger) {
        if (!sheet || !sheet.isConnected) { sheet = build(); host().append(sheet); }
        current = describe(item);
        returnFocus = trigger || null;
        sheet.querySelector('#bk-sum-sheet-title').textContent = current.name;
        sheet.querySelector('.bk-sum-sheet-h small').textContent = current.range;
        sheet.hidden = false;
        render('menu');
    }

    function close({ restore = true } = {}) {
        if (!sheet || sheet.hidden) return;
        sheet.hidden = true;
        current = null;
        if (restore && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        returnFocus = null;
    }

    return { open, close };
}
