export function createSummaryBrowserUi({
    documentRef,
    query,
    getState,
    getStoryBlocks,
    getBlocksByType,
    blockTypes,
    dedupeByHash,
    summaryToBlock,
    normalizeSearchText,
    getPreviewSummaryText,
    parsePreviewMeta,
    stripHtml,
    getBlockSortKey,
    createNotebook,
    pageSize = 8,
}) {
    const uiState = {
        activeType: 'story',
        pages: { story: 0, stage: 0, epic: 0 },
    };

    function getActiveType() {
        return uiState.activeType;
    }

    function setActiveType(type) {
        uiState.activeType = ['story', 'stage', 'epic'].includes(type) ? type : 'story';
    }

    function resetPages() {
        uiState.pages = { story: 0, stage: 0, epic: 0 };
    }

    function changePage(type, direction) {
        const targetType = ['story', 'stage', 'epic'].includes(type) ? type : uiState.activeType;
        uiState.pages[targetType] = Math.max(0, (uiState.pages[targetType] || 0) + direction);
        uiState.activeType = targetType;
    }

    function prepareBlocks(blocks) {
        const filter = normalizeSearchText(query('#bakemono-memory-preview-filter').val() || '');
        const order = String(query('#bakemono-memory-preview-order').val() || 'desc');
        const filtered = filter
            ? blocks.filter(block => {
                const meta = parsePreviewMeta(block);
                return normalizeSearchText(`${getPreviewSummaryText(block)}\n${block.title}\n${meta.meta}\n${meta.submeta}\n${stripHtml(block.content)}`).includes(filter);
            })
            : [...blocks];
        filtered.sort((a, b) => (getBlockSortKey(a) - getBlockSortKey(b)) || (a.blockIndex - b.blockIndex));
        if (order === 'desc') filtered.reverse();
        return filtered;
    }

    function syncTypeUi() {
        if (!['story', 'stage', 'epic'].includes(uiState.activeType)) uiState.activeType = 'story';
        documentRef.querySelectorAll('.bakemono-preview-type-button').forEach(button => {
            button.classList.toggle('is-active', button.dataset.bakemonoPreviewType === uiState.activeType);
        });
        documentRef.querySelector('.bakemono-memory-preview-grid')?.setAttribute('data-bakemono-active-preview', uiState.activeType);
        documentRef.querySelectorAll('.bakemono-memory-preview-column').forEach(column => {
            column.classList.toggle('is-active', column.dataset.bakemonoPreviewColumn === uiState.activeType);
        });
    }

    function renderList(selector, blocks, type) {
        const container = documentRef.querySelector(selector);
        if (!container) return;
        container.innerHTML = '';
        if (!blocks.length) {
            const empty = documentRef.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无内容';
            container.append(empty);
            return;
        }

        const pageCount = Math.max(1, Math.ceil(blocks.length / pageSize));
        uiState.pages[type] = Math.min(Math.max(0, uiState.pages[type] || 0), pageCount - 1);
        const page = uiState.pages[type];
        const start = page * pageSize;
        const visibleBlocks = blocks.slice(start, start + pageSize);
        const controls = documentRef.createElement('div');
        controls.className = 'bakemono-memory-preview-pager';

        const prev = documentRef.createElement('button');
        prev.type = 'button';
        prev.className = 'menu_button bakemono-preview-page-button';
        prev.dataset.bakemonoPreviewPage = 'prev';
        prev.dataset.bakemonoPreviewType = type;
        prev.disabled = page <= 0;
        prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i><span>上一组</span>';

        const info = documentRef.createElement('span');
        info.className = 'bakemono-memory-preview-page-info';
        info.textContent = `${start + 1}-${Math.min(start + pageSize, blocks.length)} / ${blocks.length}`;

        const next = documentRef.createElement('button');
        next.type = 'button';
        next.className = 'menu_button bakemono-preview-page-button';
        next.dataset.bakemonoPreviewPage = 'next';
        next.dataset.bakemonoPreviewType = type;
        next.disabled = page >= pageCount - 1;
        next.innerHTML = '<span>下一组</span><i class="fa-solid fa-chevron-right"></i>';
        controls.append(prev, info, next);
        container.append(controls);

        const fragment = documentRef.createDocumentFragment();
        visibleBlocks.forEach((block, index) => fragment.append(createNotebook(block, start + index)));
        container.append(fragment);
    }

    function renderSections(storyBlocks = getStoryBlocks(), stageBlocks = null, epicBlocks = null) {
        const state = getState();
        const stages = stageBlocks || dedupeByHash([
            ...getBlocksByType(blockTypes.STAGE),
            ...state.stageSummaries.map(summaryToBlock),
        ]);
        const epics = epicBlocks || dedupeByHash([
            ...getBlocksByType(blockTypes.EPIC),
            ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
        ]);
        syncTypeUi();
        renderList('#bakemono-memory-preview-story', prepareBlocks(storyBlocks), 'story');
        renderList('#bakemono-memory-preview-stage', prepareBlocks(stages), 'stage');
        renderList('#bakemono-memory-preview-epic', prepareBlocks(epics), 'epic');
    }

    return { changePage, getActiveType, renderSections, resetPages, setActiveType };
}
