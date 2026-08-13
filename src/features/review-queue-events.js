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
    rollbackAutoSummaryTransaction,
    changeHistoryPage,
    renderHistory,
} = {}) {
    function bind(rootSelector = '#bakemono-workbench-root') {
        const root = query(rootSelector);
        root.off('click.bakemonoReviewView').on('click.bakemonoReviewView', '[data-bakemono-review-view]', function () {
            const nextView = String(this.dataset.bakemonoReviewView || 'drafts');
            if (!['drafts', 'tasks', 'history'].includes(nextView)) return;
            setReviewPanelView(nextView);
            renderReviewPanelTabs();
            stabilizeMobileWorkbenchScroll('drafts');
        });
        root.off('click.bakemonoDraftEditorToggle').on('click.bakemonoDraftEditorToggle', '[data-bakemono-draft-editor-toggle]', function () {
            const details = this.closest('.bakemono-memory-draft-card')?.querySelector('.bakemono-memory-draft-editor-disclosure');
            if (!details) return;
            details.open = true;
            globalRef.requestAnimationFrame?.(() => details.querySelector('.bakemono-memory-draft-editor')?.focus());
        });
        root.off('click.bakemonoDraftAction').on('click.bakemonoDraftAction', '[data-bakemono-draft-action]', async function () {
            if (getIsBusy()) {
                toastr.info('已有总结任务正在进行，请稍等。');
                return;
            }
            const card = this.closest('.bakemono-memory-draft-card');
            const draftId = card?.dataset.draftId;
            if (!draftId) return;
            const action = this.dataset.bakemonoDraftAction;
            const draft = getState().drafts.find(item => item.id === draftId);
            if (draft) draft.title = String(card.querySelector('.bakemono-memory-draft-title')?.value || draft.title || '').trim();
            if (action === 'commit') {
                renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '正在保存草稿...');
                await commitDraft(draftId, card.querySelector('.bakemono-memory-draft-editor')?.value || '');
            } else if (action === 'regenerate') {
                this.disabled = true;
                renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '正在重新总结草稿，请稍等...');
                await regenerateDraft(draftId);
            } else if (action === 'discard') {
                renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '正在丢弃草稿...');
                discardDraft(draftId);
            }
        });
        root.off('input.bakemonoDraftTitle').on('input.bakemonoDraftTitle', '.bakemono-memory-draft-title', function () {
            const draftId = this.closest('.bakemono-memory-draft-card')?.dataset.draftId;
            const draft = getState().drafts.find(item => item.id === draftId);
            if (!draft) return;
            draft.title = String(this.value || '').trim();
            saveState();
        });
        root.off('click.bakemonoTaskAction').on('click.bakemonoTaskAction', '[data-bakemono-task-action]', function () {
            const taskId = this.closest('.bakemono-memory-task-item')?.dataset.taskId;
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
