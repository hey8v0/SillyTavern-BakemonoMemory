export function createSummaryTimelineUi({
    documentRef,
    getState,
    getStoryBlocks,
    getBlocksByType,
    blockTypes,
    dedupeByHash,
    summaryToBlock,
    unique,
    getMultiSummaryLabel,
    getKindLabel,
    getBlockTitle,
    pageSize = 25,
}) {
    const pageState = { page: 0 };

    function changePage(direction) {
        pageState.page = Math.max(0, (pageState.page || 0) + direction);
    }

    function isVirtualMessageId(messageId) {
        return !Number.isFinite(messageId) || messageId >= Number.MAX_SAFE_INTEGER;
    }

    function formatMessageIdRange(messageIds = []) {
        const ids = unique(messageIds.filter(id => Number.isFinite(id) && !isVirtualMessageId(id)).map(Number)).sort((a, b) => a - b);
        if (!ids.length) return '';
        if (ids.length === 1) return `楼层 ${ids[0]}`;
        return `楼层 ${ids[0]}-${ids.at(-1)}`;
    }

    function getMetaText(item, sourceCount = 0) {
        if (sourceCount) {
            const sourceRange = formatMessageIdRange(item.sourceMessageIds || []);
            return sourceRange ? `覆盖 ${sourceCount} 个片段 · 来源${sourceRange}` : `覆盖 ${sourceCount} 个片段`;
        }
        if (item.sourceMessageIds?.length) return `来源${formatMessageIdRange(item.sourceMessageIds)}`;
        if (isVirtualMessageId(item.messageId)) {
            return item.createdAt ? `记忆摘要 · ${new Date(item.createdAt).toLocaleString()}` : '记忆摘要';
        }
        return `楼层 ${item.messageId}`;
    }

    function createNode(item, kind, children = []) {
        const details = documentRef.createElement('details');
        details.className = `bakemono-memory-timeline-node is-${kind}`;
        if (kind === 'epic') details.open = true;
        const summary = documentRef.createElement('summary');
        const marker = documentRef.createElement('span');
        marker.className = 'bakemono-memory-timeline-dot';
        marker.setAttribute('aria-hidden', 'true');
        const copy = documentRef.createElement('span');
        copy.className = 'bakemono-memory-timeline-copy';
        const kindLabel = documentRef.createElement('small');
        const label = documentRef.createElement('strong');
        kindLabel.textContent = kind === blockTypes.EPIC || kind === 'epic' ? getMultiSummaryLabel(item) : getKindLabel(kind);
        label.textContent = item.title || getBlockTitle(item.content, '未命名');
        const meta = documentRef.createElement('span');
        meta.className = 'bakemono-memory-timeline-meta';
        meta.textContent = getMetaText(item, Array.isArray(item.sourceHashes) ? item.sourceHashes.length : 0);
        copy.append(kindLabel, label, meta);
        const toggle = documentRef.createElement('i');
        toggle.className = 'fa-solid fa-chevron-right bakemono-memory-timeline-toggle';
        toggle.setAttribute('aria-hidden', 'true');
        summary.append(marker, copy, toggle);
        details.append(summary);
        if (children.length) {
            const childWrap = documentRef.createElement('div');
            childWrap.className = 'bakemono-memory-timeline-children';
            children.forEach(child => childWrap.append(child));
            details.append(childWrap);
        }
        return details;
    }

    function createPager(start, total, pageCount) {
        const controls = documentRef.createElement('div');
        controls.className = 'bakemono-memory-preview-pager bakemono-memory-timeline-pager';
        const prev = documentRef.createElement('button');
        prev.type = 'button';
        prev.className = 'menu_button bakemono-preview-page-button';
        prev.dataset.bakemonoTimelinePage = 'prev';
        prev.disabled = pageState.page <= 0;
        prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i><span>上一页</span>';
        const info = documentRef.createElement('span');
        info.className = 'bakemono-memory-preview-page-info';
        info.textContent = `${total ? start + 1 : 0}-${Math.min(start + pageSize, total)} / ${total}`;
        const next = documentRef.createElement('button');
        next.type = 'button';
        next.className = 'menu_button bakemono-preview-page-button';
        next.dataset.bakemonoTimelinePage = 'next';
        next.disabled = pageState.page >= pageCount - 1;
        next.innerHTML = '<span>下一页</span><i class="fa-solid fa-chevron-right"></i>';
        controls.append(prev, info, next);
        return controls;
    }

    function render(state = getState()) {
        const container = documentRef.querySelector('#bakemono-memory-timeline');
        if (!container) return;
        const storyBlocks = getStoryBlocks();
        const stageBlocks = dedupeByHash([...getBlocksByType(blockTypes.STAGE), ...state.stageSummaries.map(summaryToBlock)]);
        const epicBlocks = dedupeByHash([...getBlocksByType(blockTypes.EPIC), ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC }))]);
        const byHash = new Map([...storyBlocks, ...stageBlocks, ...epicBlocks].map(block => [block.hash, block]));
        documentRef.querySelector('#bakemono-memory-timeline-story-count').textContent = storyBlocks.length;
        documentRef.querySelector('#bakemono-memory-timeline-stage-count').textContent = stageBlocks.length;
        documentRef.querySelector('#bakemono-memory-timeline-epic-count').textContent = epicBlocks.length;
        container.innerHTML = '';
        if (!storyBlocks.length && !stageBlocks.length && !epicBlocks.length) {
            const empty = documentRef.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无摘要树。扫描或保存草稿后会显示覆盖关系。';
            container.append(empty);
            return;
        }

        const makeStoryNode = story => createNode(story, 'story');
        const makeStageNode = stage => createNode(stage, 'stage', (stage.sourceHashes || []).map(hash => byHash.get(hash)).filter(Boolean).map(makeStoryNode));
        const makeEpicNode = epic => {
            const sourceHashes = unique([...(epic.sourceStageHashes || []), ...(epic.sourceHashes || [])]);
            const children = sourceHashes.map(hash => {
                const block = byHash.get(hash);
                if (!block) return null;
                if (block.type === blockTypes.EPIC || block.kind === blockTypes.EPIC) return makeEpicNode(block);
                if (block.type === blockTypes.STAGE || block.kind === blockTypes.STAGE) return makeStageNode(block);
                return makeStoryNode(block);
            }).filter(Boolean);
            return createNode(epic, 'epic', children);
        };

        const rootFactories = [];
        const epicCoveredStage = new Set(state.epicSummaries.flatMap(summary => [...(summary.sourceStageHashes || []), ...(summary.sourceHashes || [])]));
        for (const epic of state.epicSummaries.filter(summary => !epicCoveredStage.has(summary.hash))) {
            rootFactories.push(() => makeEpicNode({ ...summaryToBlock(epic), type: blockTypes.EPIC }));
        }
        for (const stage of state.stageSummaries.filter(summary => !epicCoveredStage.has(summary.hash))) rootFactories.push(() => makeStageNode(stage));
        const coveredStory = new Set([
            ...state.stageSummaries.flatMap(summary => summary.sourceHashes || []),
            ...state.epicSummaries.flatMap(summary => (summary.sourceHashes || []).filter(hash => byHash.get(hash)?.type === blockTypes.STORY)),
        ]);
        for (const story of storyBlocks.filter(block => !coveredStory.has(block.hash))) rootFactories.push(() => createNode(story, 'story'));

        const pageCount = Math.max(1, Math.ceil(rootFactories.length / pageSize));
        pageState.page = Math.min(Math.max(0, pageState.page || 0), pageCount - 1);
        const start = pageState.page * pageSize;
        const visibleRoots = rootFactories.slice(start, start + pageSize).map(createRoot => createRoot());
        const pager = createPager(start, rootFactories.length, pageCount);
        container.append(pager.cloneNode(true), ...visibleRoots, pager);
    }

    return { changePage, render };
}
