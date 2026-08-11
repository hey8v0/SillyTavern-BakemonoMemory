export function createSummaryMemoryModel({
    blockTypes,
    memoryStrategies,
    memoryRecordStatuses,
    dedupeByHash,
    getSummarySortKey,
    getSummaryLevel,
    getFiniteMessageIds,
    unique,
    getBlockTitle,
    formatSourceRange,
    getBlockSortKey,
    getKindLabel,
    getDefaultDraftTitle,
    getSourceStart,
} = {}) {
    function summaryToBlock(summary) {
        const sourceSortKey = getSummarySortKey(summary);
        return {
            hash: summary.hash,
            type: summary.type || blockTypes.STAGE,
            messageId: summary.messageId ?? (sourceSortKey < Number.MAX_SAFE_INTEGER ? sourceSortKey : Number.MAX_SAFE_INTEGER),
            blockIndex: 0,
            title: summary.title,
            content: summary.content,
            sourceHashes: summary.sourceHashes || [],
            sourceStageHashes: summary.sourceStageHashes || [],
            sourceMessageIds: summary.sourceMessageIds || [],
            sourceStart: summary.sourceStart,
            sourceEnd: summary.sourceEnd,
            sourceSortKey,
            sourceKind: summary.sourceKind || summary.metadata?.sourceKind || summary.metadata?.trigger || 'summary',
            metadata: summary.metadata || {},
            level: getSummaryLevel(summary),
            isGeneratedSummary: true,
            createdAt: summary.createdAt,
            isHidden: false,
        };
    }

    function getEpicMemoryBlocks(state) {
        return dedupeByHash([
            ...(state.epicSummaries || []).map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
            ...(state.blocks || []).filter(block => block.type === blockTypes.EPIC),
        ]);
    }

    function getActiveEpicMemoryBlocks(state) {
        const epicBlocks = getEpicMemoryBlocks(state);
        const epicHashes = new Set(epicBlocks.map(summary => summary.hash).filter(Boolean));
        const coveredEpicHashes = new Set();
        for (const epic of epicBlocks) {
            for (const hash of [...(epic.sourceStageHashes || []), ...(epic.sourceHashes || [])]) {
                if (epicHashes.has(hash)) coveredEpicHashes.add(hash);
            }
        }
        return epicBlocks
            .filter(summary => !coveredEpicHashes.has(summary.hash))
            .sort((a, b) => (
                getSummarySortKey(a) - getSummarySortKey(b)
                || getSummaryLevel(a) - getSummaryLevel(b)
                || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
                || String(a.hash || '').localeCompare(String(b.hash || ''))
            ));
    }

    function getCoveredStageHashesFromEpic(epic, epicByHash, stageHashes, visited = new Set()) {
        const covered = new Set();
        if (!epic?.hash || visited.has(epic.hash)) return covered;
        visited.add(epic.hash);
        for (const hash of [...(epic.sourceStageHashes || []), ...(epic.sourceHashes || [])]) {
            if (stageHashes.has(hash)) {
                covered.add(hash);
                continue;
            }
            const childEpic = epicByHash.get(hash);
            if (childEpic) {
                for (const childHash of getCoveredStageHashesFromEpic(childEpic, epicByHash, stageHashes, visited)) covered.add(childHash);
            }
        }
        return covered;
    }

    function getStageMemoryBlocks(state) {
        return dedupeByHash([
            ...(state.stageSummaries || []).map(summary => ({ ...summaryToBlock(summary), type: blockTypes.STAGE })),
            ...(state.blocks || []).filter(block => block.type === blockTypes.STAGE),
        ]);
    }

    function getActiveCoveredStageHashes(state) {
        const existingStageHashes = new Set(getStageMemoryBlocks(state).map(summary => summary.hash).filter(Boolean));
        const covered = new Set();
        const epicBlocks = getEpicMemoryBlocks(state);
        const epicByHash = new Map(epicBlocks.map(epic => [epic.hash, epic]).filter(([hash]) => hash));
        for (const epic of getActiveEpicMemoryBlocks(state)) {
            for (const hash of getCoveredStageHashesFromEpic(epic, epicByHash, existingStageHashes)) covered.add(hash);
        }
        return covered;
    }

    function buildMemoryRecords(state) {
        const records = new Map();
        const coveredStoryHashes = new Set(state.coveredBlockHashes || []);
        const coveredStageHashes = getActiveCoveredStageHashes(state);
        const activeEpicHashes = new Set(getActiveEpicMemoryBlocks(state).map(summary => summary.hash).filter(Boolean));
        const epicCoveredStageHashes = getActiveCoveredStageHashes(state);
        const stageInjectedHashes = new Set(state.stageSummaries
            .filter(summary => !epicCoveredStageHashes.has(summary.hash))
            .map(summary => summary.hash));
        const storyInjectedHashes = new Set(state.memoryStrategy === memoryStrategies.GENERIC
            ? state.storySummaries.filter(summary => !coveredStoryHashes.has(summary.hash)).map(summary => summary.hash)
            : []);

        const upsert = record => {
            if (!record?.hash) return;
            const previous = records.get(record.hash) || {};
            records.set(record.hash, {
                ...previous,
                ...record,
                sourceMessageIds: unique([...(previous.sourceMessageIds || []), ...(record.sourceMessageIds || [])]),
            });
        };

        for (const block of state.blocks || []) {
            if (!block?.hash || block.isGeneratedSummary) continue;
            const sourceMessageIds = getFiniteMessageIds([block.messageId, ...(block.sourceMessageIds || [])]);
            const isCovered = block.type === blockTypes.STAGE
                ? coveredStageHashes.has(block.hash)
                : coveredStoryHashes.has(block.hash);
            upsert({
                id: `scan:${block.hash}`,
                hash: block.hash,
                kind: block.type || blockTypes.STORY,
                title: block.title || getBlockTitle(block.content, '未命名片段'),
                status: isCovered ? memoryRecordStatuses.COVERED : memoryRecordStatuses.SOURCE,
                source: block.sourceKind === 'raw' ? '全文扫描' : `标签 <${block.matchedTag || 'unknown'}>`,
                sourceMessageIds,
                sourceRange: formatSourceRange(sourceMessageIds),
                contentLength: String(block.content || '').length,
                sourceHashes: block.sourceHashes || [],
                sourceStageHashes: block.sourceStageHashes || [],
                sortKey: getBlockSortKey(block),
                updatedAt: block.createdAt || state.lastScanAt || '',
            });
        }

        const addSummaryRecord = (summary, kind) => {
            const sourceMessageIds = getFiniteMessageIds(summary.sourceMessageIds || []);
            let status = memoryRecordStatuses.SAVED;
            if (kind === blockTypes.STORY) {
                status = storyInjectedHashes.has(summary.hash)
                    ? memoryRecordStatuses.INJECTED
                    : coveredStoryHashes.has(summary.hash) ? memoryRecordStatuses.COVERED : memoryRecordStatuses.SAVED;
            } else if (kind === blockTypes.STAGE) {
                status = stageInjectedHashes.has(summary.hash)
                    ? memoryRecordStatuses.INJECTED
                    : coveredStageHashes.has(summary.hash) ? memoryRecordStatuses.ARCHIVED : memoryRecordStatuses.SAVED;
            } else if (kind === blockTypes.EPIC) {
                status = activeEpicHashes.has(summary.hash) ? memoryRecordStatuses.INJECTED : memoryRecordStatuses.ARCHIVED;
            }
            upsert({
                id: `summary:${summary.hash}`,
                hash: summary.hash,
                kind,
                title: summary.title || getBlockTitle(summary.content, getKindLabel(kind)),
                status,
                source: summary.sourceKind === 'backfill' ? '插件补课' : '已保存摘要',
                sourceMessageIds,
                sourceRange: formatSourceRange(sourceMessageIds),
                contentLength: String(summary.content || '').length,
                sourceHashes: summary.sourceHashes || [],
                sourceStageHashes: summary.sourceStageHashes || [],
                sortKey: getSummarySortKey(summary),
                updatedAt: summary.createdAt || '',
            });
        };

        (state.storySummaries || []).forEach(summary => addSummaryRecord(summary, blockTypes.STORY));
        (state.stageSummaries || []).forEach(summary => addSummaryRecord(summary, blockTypes.STAGE));
        (state.epicSummaries || []).forEach(summary => addSummaryRecord(summary, blockTypes.EPIC));

        for (const draft of state.drafts || []) {
            const sourceMessageIds = getFiniteMessageIds(draft.sourceMessageIds || []);
            upsert({
                id: `draft:${draft.id}`,
                hash: draft.id,
                kind: draft.kind || blockTypes.STAGE,
                title: draft.title || getDefaultDraftTitle(draft.kind || blockTypes.STAGE, state),
                status: memoryRecordStatuses.DRAFT,
                source: draft.trigger === 'auto' ? '自动草稿' : '草稿箱',
                sourceMessageIds,
                sourceRange: formatSourceRange(sourceMessageIds),
                contentLength: String(draft.content || '').length,
                sourceHashes: draft.sourceHashes || [],
                sourceStageHashes: draft.sourceStageHashes || [],
                sortKey: getSourceStart(sourceMessageIds),
                updatedAt: draft.createdAt || '',
            });
        }

        return [...records.values()].sort((a, b) => (
            Number(a.sortKey ?? Number.MAX_SAFE_INTEGER) - Number(b.sortKey ?? Number.MAX_SAFE_INTEGER)
            || String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))
            || String(a.hash || '').localeCompare(String(b.hash || ''))
        ));
    }

    return {
        buildMemoryRecords,
        getActiveCoveredStageHashes,
        getActiveEpicMemoryBlocks,
        getCoveredStageHashesFromEpic,
        getEpicMemoryBlocks,
        getStageMemoryBlocks,
        summaryToBlock,
    };
}
