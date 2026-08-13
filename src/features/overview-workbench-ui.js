export function createOverviewWorkbenchUi({
    query,
    getState,
    getActiveGlobalConfig,
    defaultAutomation,
    defaultScanRules,
    defaultState,
    getWorkflowModeLabel,
    getCurrentFloorMemoryIndex,
    getOverviewHealth,
    getActiveTab,
    renderTokenManifest,
}) {
    function renderOverviewConfigManifest(state = getState()) {
        const activeConfig = getActiveGlobalConfig();
        const scanMode = state.scanRules?.mode || defaultScanRules.mode;
        const apiProvider = state.automation?.apiProvider || defaultAutomation.apiProvider;
        const backgroundFeatures = [];
        if (state.turnSummary?.auto) backgroundFeatures.push('自动记忆');
        if (state.automation?.enabled) backgroundFeatures.push('自动总结');
        if (state.autoHideRecent?.enabled) backgroundFeatures.push('楼层收纳');
        const vectorProvider = state.vectorMemory?.embeddingProvider === 'custom-openai' ? '外部语义检索' : '本地轻量检索';

        query('#bakemono-memory-overview-config-scope').text(activeConfig ? '全部聊天' : '当前聊天');
        query('#bakemono-memory-overview-config-name').text(activeConfig?.name || '当前聊天配置');
        query('#bakemono-memory-overview-config-workflow').text(getWorkflowModeLabel(state.workflowMode));
        query('#bakemono-memory-overview-config-scan').text(scanMode === 'full' ? '全文管线' : '标签块模式');
        query('#bakemono-memory-overview-config-model').text(apiProvider === 'custom'
            ? (String(state.automation?.customApi?.model || '').trim() || '自定义接口')
            : '酒馆主模型');
        query('#bakemono-memory-overview-config-auto').text(backgroundFeatures.length ? backgroundFeatures.join(' · ') : '全部关闭');
        query('#bakemono-memory-overview-config-injection').text(state.injection?.enabled
            ? `开启 · 深度 ${Number(state.injection?.depth ?? defaultState.injection.depth).toLocaleString()}`
            : '关闭');
        query('#bakemono-memory-overview-config-vector').text(state.vectorMemory?.enabled ? vectorProvider : '未开启');
    }

    function renderWorkflowGuide(state = getState()) {
        const floorStats = getCurrentFloorMemoryIndex(state).aggregates;
        const health = getOverviewHealth(floorStats, state);
        const coverageProgress = floorStats.total
            ? Math.max(0, Math.min(100, Math.round((floorStats.summarized / floorStats.total) * 100)))
            : 0;
        const stageCount = Array.isArray(state.stageSummaries) ? state.stageSummaries.length : 0;
        const epicCount = Array.isArray(state.epicSummaries) ? state.epicSummaries.length : 0;

        query('#bakemono-memory-overview-status-label').text(health.badge);
        query('#bakemono-memory-workflow-title').text(health.title);
        query('#bakemono-memory-overview-next-copy').text(health.copy);
        query('#bakemono-memory-index-ready-floor').text(floorStats.summarized.toLocaleString());
        query('#bakemono-memory-index-pending-count').text(floorStats.missing.toLocaleString());
        query('#bakemono-memory-count-drafts').text(floorStats.pendingDraftCount.toLocaleString());
        query('#bakemono-memory-scene-code').text(`SC. ${String(stageCount).padStart(2, '0')} / TK. ${String(epicCount).padStart(2, '0')}`);
        query('#bakemono-memory-scene-progress-fill').css('width', `${coverageProgress}%`);
        query('.bakemono-memory-health-board').attr('data-health-tone', health.tone);
        renderOverviewConfigManifest(state);
        if (getActiveTab() === 'overview') void renderTokenManifest(state);
    }

    return { renderOverviewConfigManifest, renderWorkflowGuide };
}
