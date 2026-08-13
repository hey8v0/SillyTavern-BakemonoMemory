export function createWorkbenchActionController({
    workbenchRenderScopes,
    scanBakemonoBlocks,
    chooseStageGenerationMode,
    generateStageBatchTasks,
    chooseEpicGenerationMode,
    generateEpicBatchTasks,
    generateBackfillQueue,
    generateBatchSummaryQueue,
    commitAllMissingSummaryDrafts,
    removeMissingSummaryDraftsAndTasks,
    clearStuckQueueTasks,
    clearStuckMissingSummaryTasks,
    readTurnSummaryFieldsFromUi,
    processLatestTurnSummary,
    processLatestTableEdit,
    undoLastCommit,
    clearFinishedQueueTasks,
    clearHistoryRecords,
    hideCoveredMessages,
    restoreHiddenMessages,
    previewMessageRange,
    setMessageRangeHidden,
    previewPreserveRecentMessages,
    hideBeforeRecentMessages,
    applyAutoHideRecentSettings,
    restoreAutoHiddenMessages,
    applyVectorMemorySettings,
    buildVectorMemoryIndex,
    testVectorMemoryRetrieval,
    persistVectorMemoryFieldsFromUi,
    fetchVectorEmbeddingModels,
    fetchVectorQueryModels,
    clearVectorMemoryIndex,
    runVisibleOperation,
} = {}) {
    async function run(action) {
        if (action === 'scan') {
            scanBakemonoBlocks();
        } else if (action === 'generate-stage') {
            await chooseStageGenerationMode();
        } else if (action === 'generate-stage-batch') {
            await generateStageBatchTasks();
        } else if (action === 'generate-epic') {
            await chooseEpicGenerationMode();
        } else if (action === 'generate-epic-batch') {
            await generateEpicBatchTasks();
        } else if (action === 'backfill') {
            await generateBackfillQueue();
        } else if (action === 'batch-summary') {
            await generateBatchSummaryQueue();
        } else if (action === 'commit-missing-all') {
            await commitAllMissingSummaryDrafts();
        } else if (action === 'remove-missing-all') {
            removeMissingSummaryDraftsAndTasks();
        } else if (action === 'clear-stuck-tasks') {
            clearStuckQueueTasks();
        } else if (action === 'clear-stuck-missing') {
            clearStuckMissingSummaryTasks();
        } else if (action === 'process-latest-turn') {
            readTurnSummaryFieldsFromUi();
            await processLatestTurnSummary({ manual: true });
        } else if (action === 'process-latest-table') {
            readTurnSummaryFieldsFromUi();
            await processLatestTableEdit({ manual: true });
        } else if (action === 'undo') {
            undoLastCommit();
        } else if (action === 'clear-queue') {
            clearFinishedQueueTasks();
        } else if (action === 'clear-history') {
            clearHistoryRecords();
        } else if (action === 'hide') {
            await hideCoveredMessages();
        } else if (action === 'restore') {
            await restoreHiddenMessages();
        } else if (action === 'preview-range') {
            previewMessageRange();
        } else if (action === 'hide-range') {
            await setMessageRangeHidden(false);
        } else if (action === 'restore-range') {
            await setMessageRangeHidden(true);
        } else if (action === 'preview-preserve-recent') {
            previewPreserveRecentMessages();
        } else if (action === 'hide-before-recent') {
            await hideBeforeRecentMessages();
        } else if (action === 'apply-auto-hide-recent') {
            await applyAutoHideRecentSettings();
        } else if (action === 'restore-auto-hidden') {
            await restoreAutoHiddenMessages();
        } else if (action === 'vector-apply') {
            await applyVectorMemorySettings();
        } else if (action === 'vector-index') {
            await runVisibleOperation('正在建立/刷新向量索引...', () => buildVectorMemoryIndex(), '向量索引已刷新');
        } else if (action === 'vector-test') {
            await runVisibleOperation('正在测试向量召回...', () => testVectorMemoryRetrieval(), '召回测试已完成');
        } else if (action === 'vector-fetch-models') {
            persistVectorMemoryFieldsFromUi();
            await runVisibleOperation('正在拉取嵌入向量模型...', () => fetchVectorEmbeddingModels(), '嵌入模型列表已更新');
        } else if (action === 'vector-fetch-query-models') {
            persistVectorMemoryFieldsFromUi();
            await runVisibleOperation('正在拉取查询改写模型...', () => fetchVectorQueryModels(), '查询模型列表已更新');
        } else if (action === 'vector-clear') {
            clearVectorMemoryIndex();
        }
    }

    function getRenderScope(action) {
        if (String(action || '').startsWith('vector-')) return workbenchRenderScopes.VECTOR;
        if (action === 'scan') return workbenchRenderScopes.SCAN;
        if ([
            'generate-stage',
            'generate-stage-batch',
            'generate-epic',
            'generate-epic-batch',
            'backfill',
            'batch-summary',
        ].includes(action)) return workbenchRenderScopes.SUMMARY;
        if ([
            'commit-missing-all',
            'remove-missing-all',
            'clear-stuck-tasks',
            'clear-stuck-missing',
            'undo',
            'clear-queue',
            'clear-history',
        ].includes(action)) return workbenchRenderScopes.DRAFTS;
        if (action === 'process-latest-turn' || action === 'process-latest-table') return workbenchRenderScopes.TABLES;
        if ([
            'hide',
            'restore',
            'preview-range',
            'hide-range',
            'restore-range',
            'preview-preserve-recent',
            'hide-before-recent',
            'apply-auto-hide-recent',
            'restore-auto-hidden',
        ].includes(action)) return workbenchRenderScopes.ARCHIVE;
        return workbenchRenderScopes.SETTINGS;
    }

    return { getRenderScope, run };
}
