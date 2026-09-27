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
    getSummaryGroup,
    setSummaryOpen,
    pageSize = 10,
}) {
    const uiState = {
        activeType: 'stage',
        pages: { story: 0, stage: 0, epic: 0 },
        open: new Set(),
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
        documentRef.querySelectorAll('[data-bakemono-preview-type]').forEach(button => {
            const active = button.dataset.bakemonoPreviewType === uiState.activeType;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
        });
        documentRef.querySelector('.bakemono-memory-preview-grid')?.setAttribute('data-bakemono-active-preview', uiState.activeType);
        documentRef.querySelectorAll('.bakemono-memory-preview-column').forEach(column => {
            const active = column.dataset.bakemonoPreviewColumn === uiState.activeType;
            column.classList.toggle('is-active', active);
            column.hidden = !active;
        });
    }

    const emptyText = {
        story: '还没有剧情摘要。',
        stage: '还没有阶段总结。',
        epic: '还没有多次总结。',
    };

    function pageButton(type, direction, label, disabled) {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'bk-sum-link bakemono-preview-page-button';
        button.dataset.bakemonoPreviewPage = direction;
        button.dataset.bakemonoPreviewType = type;
        button.disabled = disabled;
        button.textContent = label;
        return button;
    }

    function groupHeader(group) {
        const section = documentRef.createElement('section');
        section.className = `bk-sum-group${group.pending ? ' is-pending' : ''}`;
        const head = documentRef.createElement('div');
        head.className = 'bk-sum-group-h';
        const title = documentRef.createElement('h4');
        title.textContent = group.name;
        const note = documentRef.createElement('span');
        note.textContent = group.pending ? '还没进入阶段总结' : '已收入这一章';
        head.append(title, note);
        section.append(head);
        return section;
    }

    function renderList(selector, blocks, type) {
        const container = documentRef.querySelector(selector);
        if (!container) return;
        container.innerHTML = '';
        if (!blocks.length) {
            const empty = documentRef.createElement('p');
            empty.className = 'bakemono-memory-empty bk-sum-empty';
            empty.textContent = query('#bakemono-memory-preview-filter').val() ? '没有找到符合搜索的内容。' : emptyText[type];
            container.append(empty);
            return;
        }

        const pageCount = Math.max(1, Math.ceil(blocks.length / pageSize));
        uiState.pages[type] = Math.min(Math.max(0, uiState.pages[type] || 0), pageCount - 1);
        const page = uiState.pages[type];
        const start = page * pageSize;
        const visibleBlocks = blocks.slice(start, start + pageSize);

        const timeline = documentRef.createElement('div');
        timeline.className = 'bk-sum-timeline';
        let group = null, groupKey = null;
        visibleBlocks.forEach((block, index) => {
            const key = block.id || block.hash;
            const notebook = createNotebook(block, start + index, uiState.open.has(key));
            notebook.dataset.bakemonoSummaryKey = key;
            if (type === 'story' && getSummaryGroup) {
                const next = getSummaryGroup(block);
                if (!group || next.key !== groupKey) {
                    group = groupHeader(next);
                    groupKey = next.key;
                    timeline.append(group);
                }
                group.append(notebook);
            } else timeline.append(notebook);
        });
        container.append(timeline);

        if (pageCount > 1) {
            const newestFirst = String(query('#bakemono-memory-preview-order').val() || 'desc') === 'desc';
            const controls = documentRef.createElement('div');
            controls.className = 'bakemono-memory-preview-pager bk-sum-pager';
            const info = documentRef.createElement('span');
            info.className = 'bakemono-memory-preview-page-info';
            info.textContent = `${start + 1}-${Math.min(start + pageSize, blocks.length)} / ${blocks.length}`;
            controls.append(
                pageButton(type, 'prev', newestFirst ? '‹ 较新' : '‹ 较早', page <= 0),
                info,
                pageButton(type, 'next', newestFirst ? '较早 ›' : '较新 ›', page >= pageCount - 1),
            );
            container.append(controls);
        }
    }

    function toggleOpen(item, open = !item?.classList.contains('is-open')) {
        const key = item?.dataset.bakemonoSummaryKey;
        if (!key) return false;
        if (open) uiState.open.add(key); else uiState.open.delete(key);
        setSummaryOpen?.(item, open);
        return open;
    }

    function findRendered(key) {
        return [...documentRef.querySelectorAll('[data-bakemono-summary-key]')].find(element => element.dataset.bakemonoSummaryKey === key) || null;
    }

    // Show the saved-summary editor in place of the document.
    function startEdit(item) {
        const editor = item?.querySelector(':scope > .bk-sum-editor');
        if (!editor) return false;
        toggleOpen(item, true);
        item.classList.add('is-editing');
        editor.hidden = false;
        editor.querySelector('textarea')?.focus({ preventScroll: true });
        return true;
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

    function focusRecord(key, type = 'story') {
        setActiveType(type);
        query('#bakemono-memory-preview-filter').val('');
        const state = getState();
        const blocks = uiState.activeType === 'story' ? getStoryBlocks() : dedupeByHash([
            ...getBlocksByType(uiState.activeType),
            ...(uiState.activeType === 'epic' ? state.epicSummaries : state.stageSummaries)
                .map(summary => ({ ...summaryToBlock(summary), type: uiState.activeType })),
        ]);
        const index = prepareBlocks(blocks).findIndex(block => (block.id || block.hash) === key);
        if (index < 0) return false;
        uiState.pages[uiState.activeType] = Math.floor(index / pageSize);
        uiState.open.add(key);
        renderSections();
        const container = documentRef.querySelector('#bakemono-memory-preview-' + uiState.activeType);
        const notebook = [...(container?.querySelectorAll('[data-bakemono-summary-key]') || [])]
            .find(element => element.dataset.bakemonoSummaryKey === key);
        if (notebook) {
            notebook.tabIndex = -1;
            notebook.focus?.({ preventScroll: true });
            notebook.scrollIntoView?.({ block: 'start' });
        }
        return !!notebook;
    }

    return { changePage, findRendered, getActiveType, renderSections, resetPages, setActiveType, startEdit, toggleOpen, focusRecord };
}
