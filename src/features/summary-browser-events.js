import { scrollIntoMain } from '../ui/scroll-into-main.js';

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
    memoryRecordStatuses,
    saveEditedSummary,
    focusSummaryRecord,
    toggleSummaryOpen,
    openSummaryActions,
    toggleTimeline,
    setTimelineFilter,
    toggleTimelineOrder,
} = {}) {
    function bind(rootSelector = '#bakemono-workbench-root') {
        const root = query(rootSelector);
        root.off('click.bakemonoSummaryFocus').on('click.bakemonoSummaryFocus', '[data-bakemono-summary-focus]', function () {
            focusSummaryRecord?.(this.dataset.bakemonoSummaryFocus, this.dataset.summaryType);
        });
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
        root.off('click.bakemonoSummaryToggle').on('click.bakemonoSummaryToggle', '[data-bakemono-summary-toggle]', function () {
            const item = this.closest('[data-bakemono-summary-key]');
            if (!item || item.classList.contains('is-editing')) return;
            const open = toggleSummaryOpen?.(item);
            // Folding a long item from its end would leave the reader far below it.
            if (!open) scrollIntoMain(item, { block: 'nearest' });
            stabilizeMobilePreviewScroll?.();
        });
        root.off('click.bakemonoSummaryMenu').on('click.bakemonoSummaryMenu', '[data-bakemono-summary-menu]', function () {
            const item = this.closest('[data-bakemono-summary-key]');
            if (item) openSummaryActions?.(item, this);
        });
        root.off('click.bakemonoTimelinePage').on('click.bakemonoTimelinePage', '[data-bakemono-timeline-page]', function () {
            changeTimelinePage(this.dataset.bakemonoTimelinePage === 'next' ? 1 : -1);
            renderTimeline();
        });
        root.off('click.bakemonoTreeToggle').on('click.bakemonoTreeToggle', '[data-bakemono-tree-toggle]', function () {
            toggleTimeline?.(this.dataset.bakemonoTreeToggle, this.dataset.treeKey);
            renderTimeline();
            const key = this.dataset.treeKey, kind = this.dataset.bakemonoTreeToggle;
            [...root[0]?.querySelectorAll?.('[data-bakemono-tree-toggle]') || []].find(node => node.dataset.treeKey === key && node.dataset.bakemonoTreeToggle === kind)?.focus({ preventScroll: true });
        });
        root.off('click.bakemonoTreeFilter').on('click.bakemonoTreeFilter', '[data-bakemono-tree-filter], #bakemono-memory-timeline-order', function () {
            if (this.dataset.bakemonoTreeFilter) setTimelineFilter?.(this.dataset.bakemonoTreeFilter);
            else toggleTimelineOrder?.();
            renderTimeline();
        });
        root.off('click.bakemonoSummaryAction').on('click.bakemonoSummaryAction', '[data-bakemono-summary-action]', async function () {
            const tools = this.closest('.bakemono-memory-summary-tools');
            const hash = tools?.dataset.summaryHash;
            if (!tools || !hash) return;
            const action = this.dataset.bakemonoSummaryAction;
            if (action === 'cancel') {
                tools.hidden = true;
                tools.closest('[data-bakemono-summary-key]')?.classList.remove('is-editing');
            } else if (action === 'save') {
                await saveEditedSummary(
                    hash,
                    tools.querySelector('.bakemono-summary-title')?.value || '',
                    tools.querySelector('.bakemono-summary-content')?.value || '',
                );
            }
        });
    }

    return { bind };
}
