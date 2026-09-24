import {refreshMemoryLinks} from '../memory/story-state.js';
import {resolveSummaryGraph, getSummaryStatus, summarySourceFloors} from '../memory/summary-provenance.js';
import {inspectSummaryMaterials} from '../summary/material-quality.js';
export function createSummarySelectors({
    getState,
    getChat,
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

    function getUnsummarizedStoryBlocks({includeCovered = false} = {}) {
        const state = getState();
        if(getChat)refreshMemoryLinks(state,getChat());
        const graph = resolveSummaryGraph(state);
        const covered = graph.coveredStoryHashes;
        return getStoryMaterialBlocks().filter(block => (includeCovered || !covered.has(block.hash))
            && !inspectSummaryMaterials([block]).invalid.length && getSummaryStatus(state, block, graph).valid)
            .map(block => {
                const ids = summarySourceFloors(state, block, graph);
                return ids.length ? { ...block, messageId: ids[0], sourceMessageIds: ids,
                    sourceStart: ids[0], sourceEnd: ids.at(-1), sourceSortKey: ids[0] } : block;
            });
    }

    function getStageMaterialOverview() {
        const targets = getUnsummarizedStoryBlocks();
        const materials = getStoryMaterialBlocks();
        const selected = new Set(materials.map(block => block.hash));
        const excludedCount = getStoryMaterialBlocks(stageSourceModes.MIXED).filter(block => !selected.has(block.hash)).length;
        const graph = resolveSummaryGraph(getState());
        const issues = materials.filter(block => !graph.coveredStoryHashes.has(block.hash)).flatMap(block => {
            const content = inspectSummaryMaterials([block]).invalid;
            const status = getSummaryStatus(getState(), block, graph);
            if (!content.length && status.valid) return [];
            return [{ key: block.id || block.hash, type: block.type || 'story', title: block.title || '剧情摘要',
                floors: summarySourceFloors(getState(), block, graph),
                reason: content.length ? content.join('、') + '只有标题或没有有效剧情内容' : status.reason }];
        });
        const invalid = issues.map(issue => issue.reason);
        return { sourceMode: getStageSourceMode(), targets, totalCount: materials.length,
            coveredCount: materials.length - targets.length - invalid.length, excludedCount, invalid, issues };
    }

    function getUnsummarizedStageBlocks({includeCovered = false} = {}) {
        const state = getState();
        if(getChat)refreshMemoryLinks(state,getChat());
        const covered = resolveSummaryGraph(state).coveredStageHashes;
        return dedupeByHash([
            ...getBlocksByType(blockTypes.STAGE),
            ...state.stageSummaries.map(summaryToBlock),
        ]).filter(block => includeCovered || !covered.has(block.hash));
    }

    function getUnsummarizedMultiSummaryBlocks({includeCovered = false} = {}) {
        const state = getState();
        if(getChat)refreshMemoryLinks(state,getChat());
        const covered = resolveSummaryGraph(state).coveredEpicHashes;
        return dedupeByHash([
            ...getBlocksByType(blockTypes.EPIC),
            ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
        ]).filter(block => includeCovered || !covered.has(block.hash));
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
        getStageMaterialOverview,
        getStoryBlocks,
        getStoryMaterialBlocks,
        getUnsummarizedMultiSummaryBlocks,
        getUnsummarizedStageBlocks,
        getUnsummarizedStoryBlocks,
        isBackfillSummary,
        isRawSourceBlock,
    };
}
