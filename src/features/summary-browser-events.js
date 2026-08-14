export function createSummaryBrowserEvents({
    query,
    getSummaryBrowserActiveType,
    setSummaryBrowserActiveType,
    changeSummaryBrowserPage,
    renderPreviewSections,
    resetSummaryBrowserPages,
    stabilizeMobilePreviewScroll,
    changeTimelinePage,
    renderTimeline,
    memoryRecordState,
    memoryRecordStatuses,
    renderMemoryRecordList,
    saveEditedSummary,
    deleteSavedSummary,
    removeScannedSummaryBlock,
} = {}) {
    function bind(rootSelector = '#bakemono-workbench-root') {
        const root = query(rootSelector);
        query('#bakemono-memory-preview-filter').off('input').on('input', () => {
            resetSummaryBrowserPages();
            renderPreviewSections();
        });
        query('#bakemono-memory-preview-order').off('change').on('change', () => {
            resetSummaryBrowserPages();
            renderPreviewSections();
        });
        query('#bakemono-memory-clear-preview-filter').off('click').on('click', () => {
            query('#bakemono-memory-preview-filter').val('');
            resetSummaryBrowserPages();
            renderPreviewSections();
        });
        query('#bakemono-memory-record-filter, #bakemono-memory-record-kind, #bakemono-memory-record-status').off('input change').on('input change', () => {
            memoryRecordState.page = 0;
            renderMemoryRecordList();
        });
        query('#bakemono-memory-clear-record-filter').off('click').on('click', () => {
            query('#bakemono-memory-record-filter').val('');
            query('#bakemono-memory-record-kind').val('all');
            query('#bakemono-memory-record-status').val('all');
            memoryRecordState.page = 0;
            renderMemoryRecordList();
        });
        root.off('click.bakemonoPreviewType').on('click.bakemonoPreviewType', '[data-bakemono-preview-type]', function () {
            setSummaryBrowserActiveType(this.dataset.bakemonoPreviewType || 'story');
            renderPreviewSections();
        });
        root.off('click.bakemonoPreviewPage').on('click.bakemonoPreviewPage', '[data-bakemono-preview-page]', function () {
            const type = this.dataset.bakemonoPreviewType || getSummaryBrowserActiveType();
            changeSummaryBrowserPage(type, this.dataset.bakemonoPreviewPage === 'next' ? 1 : -1);
            renderPreviewSections();
            stabilizeMobilePreviewScroll();
        });
        root.off('click.bakemonoPreviewNotebookScroll').on('click.bakemonoPreviewNotebookScroll', '.bakemono-memory-notebook > summary, .bakemono-memory-card > summary', stabilizeMobilePreviewScroll);
        root.off('click.bakemonoTimelinePage').on('click.bakemonoTimelinePage', '[data-bakemono-timeline-page]', function () {
            changeTimelinePage(this.dataset.bakemonoTimelinePage === 'next' ? 1 : -1);
            renderTimeline();
        });
        root.off('click.bakemonoRecordPage').on('click.bakemonoRecordPage', '[data-bakemono-record-page]', function () {
            memoryRecordState.page = Math.max(0, (memoryRecordState.page || 0) + (this.dataset.bakemonoRecordPage === 'next' ? 1 : -1));
            renderMemoryRecordList();
        });
        root.off('click.bakemonoRecordQuickFilter').on('click.bakemonoRecordQuickFilter', '[data-bakemono-record-status]', function () {
            const status = String(this.dataset.bakemonoRecordStatus || 'all');
            if (!['all', ...Object.values(memoryRecordStatuses)].includes(status)) return;
            query('#bakemono-memory-record-status').val(status);
            memoryRecordState.page = 0;
            renderMemoryRecordList();
        });
        root.off('click.bakemonoNotebook').on('click.bakemonoNotebook', '.bk-tab-label', function () {
            const layout = this.closest('.bk-tabs-layout');
            if (!layout) return;
            const panelId = this.dataset.bakemonoPanel;
            layout.querySelectorAll('.bk-tab-label').forEach(tab => tab.classList.toggle('is-active', tab === this));
            layout.querySelectorAll('.bk-tab-panel').forEach(panel => panel.classList.toggle('is-active', panel.dataset.bakemonoPanel === panelId));
        });
        root.off('click.bakemonoSummaryAction').on('click.bakemonoSummaryAction', '[data-bakemono-summary-action]', async function () {
            const tools = this.closest('.bakemono-memory-summary-tools');
            const hash = tools?.dataset.summaryHash;
            if (!tools || !hash) return;
            const action = this.dataset.bakemonoSummaryAction;
            const editor = tools.querySelector('.bakemono-memory-summary-editor');
            const danger = tools.querySelector('.bakemono-memory-danger-zone');
            if (action === 'edit') editor.hidden = false;
            else if (action === 'more') danger.hidden = !danger.hidden;
            else if (action === 'cancel') editor.hidden = true;
            else if (action === 'save') {
                await saveEditedSummary(
                    hash,
                    tools.querySelector('.bakemono-summary-title')?.value || '',
                    tools.querySelector('.bakemono-summary-content')?.value || '',
                );
            } else if (action === 'delete') await deleteSavedSummary(hash);
            else if (action === 'delete-source') await removeScannedSummaryBlock(hash);
        });
    }

    return { bind };
}
