import { sheetAction, sheetConfirm } from '../ui/action-sheet.js';

export function createReviewQueueEvents({
    query,
    globalRef,
    getIsBusy,
    toastr,
    getState,
    saveState,
    setReviewPanelView,
    renderReviewPanelTabs,
    stabilizeMobileWorkbenchScroll,
    renderWorkbenchScope,
    workbenchRenderScopes,
    commitDraft,
    regenerateDraft,
    discardDraft,
    retryQueueTask,
    removeQueueTask,
    pauseQueue,
    resumeQueue,
    stopCurrentTask,
    rollbackAutoSummaryTransaction,
    changeHistoryPage,
    renderHistory,
    sheet,
    escapeHtml = String,
    toggleDraft,
    startDraftEdit,
    stopDraftEdit,
    locateFloor,
} = {}) {
    // Everything but 保存 lives behind a draft's “⋯”; 重新总结 and 丢弃 each ask once more inside the sheet.
    function openDraftActions(item, trigger) {
        const draftId = item.dataset.draftId;
        const draft = getState().drafts.find(entry => entry.id === draftId);
        if (!draft || !sheet) return;
        const floor = item.dataset.draftFloor === '' ? null : Number(item.dataset.draftFloor);
        const missing = draft.metadata?.appendMode === 'missing_summary';
        const opts = { escapeHtml };
        sheet.open({
            title: item.dataset.draftName || '草稿',
            subtitle: item.dataset.draftWhere || '',
            trigger,
            keepFocus: ['edit'],
            render: view => {
                if (view === 'regen') return sheetConfirm('用同样的材料再生成一次，会多一次模型请求。新结果替换这条草稿，还是放在这里等你确认。', 'regen', '重新总结', { ...opts, danger: false });
                if (view === 'discard') return sheetConfirm(`丢弃后这条草稿不会保存${missing ? '，那一楼仍然没有摘要' : ''}。提示里可以撤回。`, 'discard', '丢弃', opts);
                return [
                    sheetAction('edit', '编辑文字', '改完再保存', opts),
                    sheetAction('regen', '重新总结', '+1 次请求 · 会再确认', { ...opts, view: true }),
                    Number.isFinite(floor) ? sheetAction('locate', '定位原文', `跳到第 ${floor} 楼 ›`, opts) : '',
                    sheetAction('discard', '丢弃', '会再确认一次', { ...opts, danger: true, view: true }),
                ].join('');
            },
            run: async name => {
                if (name === 'edit') return startDraftEdit?.(item);
                if (name === 'locate') return locateFloor?.(floor);
                if (getIsBusy()) {
                    toastr.info('已有总结任务正在进行，请稍等。');
                    return;
                }
                if (name === 'regen') {
                    renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '正在重新总结草稿，请稍等...');
                    await regenerateDraft(draftId);
                } else if (name === 'discard') discardDraft(draftId, { confirmed: true });
            },
        });
    }

    function bind(rootSelector = '#bakemono-workbench-root') {
        const root = query(rootSelector);
        root.off('click.bakemonoQueueControl').on('click.bakemonoQueueControl', '[data-bakemono-queue-control]', async function () {
            try {
            if (this.dataset.bakemonoQueueControl === 'pause') pauseQueue();
            else if (this.dataset.bakemonoQueueControl === 'resume') await resumeQueue();
            else if (this.dataset.bakemonoQueueControl === 'stop'
                && (globalRef.confirm?.('停止当前任务？这一批会立刻停下，还没生成完的部分不保存，后面的任务暂停。') ?? true)) stopCurrentTask();
            } catch (error) { toastr.error(error?.message || String(error)); }
        });
        root.off('click.bakemonoReviewView').on('click.bakemonoReviewView', '[data-bakemono-review-view]', function () {
            const nextView = String(this.dataset.bakemonoReviewView || 'drafts');
            if (!['drafts', 'tasks', 'history'].includes(nextView)) return;
            setReviewPanelView(nextView);
            renderReviewPanelTabs();
            stabilizeMobileWorkbenchScroll('drafts');
        });
        root.off('click.bakemonoDraftToggle').on('click.bakemonoDraftToggle', '[data-bakemono-draft-toggle]', function () {
            const item = this.closest('.bk-rev-draft');
            if (!item || item.classList.contains('is-editing')) return;
            if (!toggleDraft?.(item)) item.scrollIntoView?.({ block: 'nearest' });
        });
        root.off('click.bakemonoDraftMenu').on('click.bakemonoDraftMenu', '[data-bakemono-draft-menu]', function () {
            const item = this.closest('.bk-rev-draft');
            if (item) openDraftActions(item, this);
        });
        root.off('click.bakemonoDraftEdit').on('click.bakemonoDraftEdit', '[data-bakemono-draft-edit]', function () {
            const item = this.closest('.bk-rev-draft');
            const draft = getState().drafts.find(entry => entry.id === item?.dataset.draftId);
            if (!item || !draft) return;
            if (this.dataset.bakemonoDraftEdit === 'save') {
                draft.title = String(item.querySelector('.bakemono-memory-draft-title')?.value || draft.title || '').trim();
                draft.content = item.querySelector('.bakemono-memory-draft-editor')?.value ?? draft.content;
                saveState();
                renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '草稿已修改，还在这里等你确认。');
            } else {
                item.querySelector('.bakemono-memory-draft-title').value = draft.title || '';
                item.querySelector('.bakemono-memory-draft-editor').value = draft.content || '';
                stopDraftEdit?.(item);
            }
        });
        root.off('click.bakemonoDraftAction').on('click.bakemonoDraftAction', '[data-bakemono-draft-action]', async function () {
            if (getIsBusy()) {
                toastr.info('已有总结任务正在进行，请稍等。');
                return;
            }
            const card = this.closest('.bk-rev-draft');
            const draftId = card?.dataset.draftId;
            if (!draftId) return;
            const action = this.dataset.bakemonoDraftAction;
            const draft = getState().drafts.find(item => item.id === draftId);
            if (draft) draft.title = String(card.querySelector('.bakemono-memory-draft-title')?.value || draft.title || '').trim();
            if (action === 'commit') {
                renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '正在保存草稿...');
                await commitDraft(draftId, card.querySelector('.bakemono-memory-draft-editor')?.value || '');
                // A refused save leaves the draft here; end the “正在保存” notice instead of leaving it spinning.
                if (getState().drafts.some(item => item.id === draftId)) renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '保存失败，草稿已保留。');
            }
        });
        root.off('input.bakemonoDraftTitle').on('input.bakemonoDraftTitle', '.bakemono-memory-draft-title', function () {
            const draftId = this.closest('.bk-rev-draft')?.dataset.draftId;
            const draft = getState().drafts.find(item => item.id === draftId);
            if (!draft) return;
            draft.title = String(this.value || '').trim();
            saveState();
        });
        root.off('click.bakemonoTaskAction').on('click.bakemonoTaskAction', '[data-bakemono-task-action]', function () {
            const taskId = this.dataset.taskId || this.closest('[data-task-id]')?.dataset.taskId;
            if (!taskId) return;
            if (this.dataset.bakemonoTaskAction === 'retry') retryQueueTask(taskId);
            else if (this.dataset.bakemonoTaskAction === 'remove') removeQueueTask(taskId);
        });
        root.off('click.bakemonoAutoTransaction').on('click.bakemonoAutoTransaction', '[data-bakemono-auto-tx-action]', async function () {
            const transactionId = this.closest('.bakemono-memory-auto-tx-item')?.dataset.transactionId;
            if (transactionId && this.dataset.bakemonoAutoTxAction === 'rollback') await rollbackAutoSummaryTransaction(transactionId);
        });
        root.off('click.bakemonoHistoryPage').on('click.bakemonoHistoryPage', '[data-bakemono-history-page]', function () {
            changeHistoryPage(this.dataset.bakemonoHistoryPage === 'next' ? 1 : -1);
            renderHistory();
        });
    }

    return { bind };
}
