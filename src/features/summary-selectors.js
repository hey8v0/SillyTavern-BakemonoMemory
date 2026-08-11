export function createSummarySelectors({
    getState,
    getBlocksByType,
    blockTypes,
    stageSourceModes,
    workflowModes,
    defaultAutomation,
    dedupeByHash,
    summaryToBlock,
    getSortedTargetBlocks,
} = {}) {
    function getStoryBlocks() {
        const state = getState();
        return dedupeByHash([
            ...getBlocksByType(blockTypes.STORY),
            ...state.storySummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.STORY })),
        ]);
    }

    function getStageSourceMode(state = getState()) {
        if (Object.values(stageSourceModes).includes(state.stageSourceMode)) return state.stageSourceMode;
        return state.workflowMode === workflowModes.GENERIC ? stageSourceModes.BACKFILL : stageSourceModes.SUMMARIES;
    }

    function isRawSourceBlock(block) {
        return block?.sourceKind === 'raw'
            || (block?.scanMode === 'full' && !block?.isGeneratedSummary && !block?.matchedTag);
    }

    function isBackfillSummary(block) {
        return !!block?.isGeneratedSummary
            && (block?.metadata?.sourceKind === 'backfill'
                || block?.metadata?.trigger === 'backfill'
                || block?.trigger === 'backfill');
    }

    function getStoryMaterialBlocks(mode = getStageSourceMode()) {
        const state = getState();
        const scanned = getBlocksByType(blockTypes.STORY);
        const saved = state.storySummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.STORY }));
        const summaryLikeScanned = scanned.filter(block => !isRawSourceBlock(block));
        const rawScanned = scanned.filter(isRawSourceBlock);
        if (mode === stageSourceModes.BACKFILL) return dedupeByHash(saved);
        if (mode === stageSourceModes.RAW) return dedupeByHash(rawScanned);
        if (mode === stageSourceModes.MIXED) return dedupeByHash([...summaryLikeScanned, ...saved, ...rawScanned]);
        if (mode === stageSourceModes.AUTO) {
            const summaryBlocks = dedupeByHash([...summaryLikeScanned, ...saved]);
            return summaryBlocks.length ? summaryBlocks : dedupeByHash(rawScanned);
        }
        return dedupeByHash([...summaryLikeScanned, ...saved]);
    }

    function getUnsummarizedStoryBlocks() {
        const state = getState();
        const covered = new Set(state.coveredBlockHashes);
        return getStoryMaterialBlocks().filter(block => !covered.has(block.hash));
    }

    function getUnsummarizedStageBlocks() {
        const state = getState();
        const covered = new Set(state.coveredStageHashes);
        return dedupeByHash([
            ...getBlocksByType(blockTypes.STAGE),
            ...state.stageSummaries.map(summaryToBlock),
        ]).filter(block => !covered.has(block.hash));
    }

    function getUnsummarizedMultiSummaryBlocks() {
        const state = getState();
        const covered = new Set(state.coveredStageHashes || []);
        return dedupeByHash([
            ...getBlocksByType(blockTypes.EPIC),
            ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
        ]).filter(block => !covered.has(block.hash));
    }

    function getAutoStageTargets(targets = []) {
        const state = getState();
        const sorted = getSortedTargetBlocks(targets);
        if (state.automation.triggerType === 'chars') {
            const limit = Math.max(100, Number(state.automation.charInterval || defaultAutomation.charInterval));
            const selected = [];
            let totalLength = 0;
            for (const block of sorted) {
                selected.push(block);
                totalLength += String(block.content || '').length;
                if (totalLength >= limit) break;
            }
            return selected.length ? selected : sorted.slice(0, 1);
        }
        const count = Math.max(1, Number(state.automation.floorInterval || defaultAutomation.floorInterval));
        return sorted.slice(0, count);
    }

    return {
        getAutoStageTargets,
        getStageSourceMode,
        getStoryBlocks,
        getStoryMaterialBlocks,
        getUnsummarizedMultiSummaryBlocks,
        getUnsummarizedStageBlocks,
        getUnsummarizedStoryBlocks,
        isBackfillSummary,
        isRawSourceBlock,
    };
}
