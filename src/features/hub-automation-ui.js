export function createHubAutomationUi({
    documentRef,
    query,
    getState,
    getCurrentFloorMemoryIndex,
    getInjectionHeaderStatus,
    getAppearanceSettings,
    getActiveGlobalConfig,
    getPromptPresets,
    getSelectedPromptPresetId,
    getWorkflowModeLabel,
    getUnsummarizedStoryBlocks,
    defaultAutomation,
    defaultScanRules,
}) {
    function renderHubPanels(state = getState()) {
        const floorStats = getCurrentFloorMemoryIndex(state).aggregates;
        const turnEnabled = !!state.turnSummary?.enabled;
        const automationEnabled = !!state.automation?.enabled;
        const tableEnabled = !!state.tableDatabase?.enabled;
        const vectorEnabled = !!state.vectorMemory?.enabled;
        const enabledCount = [turnEnabled, automationEnabled, tableEnabled, vectorEnabled].filter(Boolean).length;
        const tableCount = Array.isArray(state.tableDatabase?.tables) ? state.tableDatabase.tables.length : 0;
        const vectorCount = Array.isArray(state.vectorMemory?.records) ? state.vectorMemory.records.length : 0;
        const triggerType = state.automation?.triggerType || defaultAutomation.triggerType;
        const triggerValue = triggerType === 'chars'
            ? Number(state.automation?.charInterval || defaultAutomation.charInterval)
            : Number(state.automation?.floorInterval || defaultAutomation.floorInterval);
        const automationMode = state.automation?.mode || defaultAutomation.mode;
        const automationModeLabel = automationMode === 'commit_hide' ? '自动保存' : automationMode === 'draft' ? '生成草稿' : '仅提醒';
        const injectionStatus = getInjectionHeaderStatus(state);
        const scanMode = state.scanRules?.mode || defaultScanRules.mode;
        const themeMode = getAppearanceSettings().themeMode;
        const apiProvider = state.automation?.apiProvider || defaultAutomation.apiProvider;
        const selectedConfig = getActiveGlobalConfig() || getPromptPresets().find(item => item.id === getSelectedPromptPresetId());

        const orchestrationTitle = floorStats.pendingDraftCount
            ? `${floorStats.pendingDraftCount.toLocaleString()} 条内容待确认`
            : floorStats.activeTaskCount
                ? '正在整理记忆'
                : floorStats.missing
                    ? `${floorStats.missing.toLocaleString()} 楼等待识别`
                    : enabledCount ? '记忆编排正常' : '等待启用后台工具';
        query('#bakemono-memory-data-hub-title').text(orchestrationTitle);
        query('#bakemono-memory-data-hub-enabled').text(`${enabledCount} 项开启`);
        query('#bakemono-memory-data-hub-turn-state').text(turnEnabled ? '已开启' : '未开启').toggleClass('is-on', turnEnabled);
        query('#bakemono-memory-data-hub-auto-state').text(automationEnabled ? automationModeLabel : '未开启').toggleClass('is-on', automationEnabled);
        query('#bakemono-memory-data-hub-auto-copy').text(automationEnabled
            ? `每 ${triggerValue.toLocaleString()} ${triggerType === 'chars' ? '字' : '条摘要'}`
            : '后台整理规则');
        query('#bakemono-memory-data-hub-table-count').text(tableCount.toLocaleString());
        query('#bakemono-memory-data-hub-vector-count').text(vectorCount.toLocaleString());
        query('#bakemono-memory-data-hub-vector-copy').text(vectorEnabled
            ? (vectorCount ? '索引健康' : '等待建立索引')
            : '尚未开启');
        query('#bakemono-memory-settings-hub-workflow').text(getWorkflowModeLabel(state.workflowMode));
        query('#bakemono-memory-settings-hub-scan').text(scanMode === 'full' ? '全文管线' : '标签块');
        query('#bakemono-memory-settings-hub-injection').text(injectionStatus.short);
        query('#bakemono-memory-settings-hub-generation').text(apiProvider === 'custom'
            ? (String(state.automation?.customApi?.model || '').trim() || '自定义接口')
            : '酒馆主模型');
        query('#bakemono-memory-settings-hub-theme').text(themeMode === 'custom' ? '自定义' : '跟随酒馆');
        query('#bakemono-memory-settings-hub-config').text(selectedConfig?.name || '导入导出');
    }

    function renderAutomationOverview(state = getState()) {
        const targets = getUnsummarizedStoryBlocks();
        const triggerType = state.automation.triggerType || defaultAutomation.triggerType;
        const currentValue = triggerType === 'chars'
            ? targets.reduce((sum, block) => sum + String(block.content || '').length, 0)
            : targets.length;
        const threshold = triggerType === 'chars'
            ? Math.max(100, Number(state.automation.charInterval || defaultAutomation.charInterval))
            : Math.max(1, Number(state.automation.floorInterval || defaultAutomation.floorInterval));
        const remaining = Math.max(0, threshold - currentValue);
        const progress = Math.max(0, Math.min(100, Math.round((currentValue / threshold) * 100)));
        const enabled = !!state.automation.enabled;
        const ready = enabled && currentValue >= threshold;
        const mode = state.automation.mode || defaultAutomation.mode;
        const modeLabel = mode === 'commit_hide' ? '自动保存' : mode === 'draft' ? '生成草稿' : '仅提醒';
        const triggerLabel = triggerType === 'chars' ? '字数' : '片段';
        const unit = triggerType === 'chars' ? '字' : '条摘要';
        const title = !enabled ? '等待开启自动规则' : ready ? '已达到触发条件' : `还差 ${remaining.toLocaleString()} ${unit}`;
        const destination = mode === 'commit_hide'
            ? `达到阈值后自动保存阶段总结，并保留最近 ${state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent} 楼正文。`
            : mode === 'draft'
                ? '达到阈值后生成阶段总结草稿，先进入待确认，不直接覆盖正文。'
                : '达到阈值后只提醒你整理，不会自动生成或保存。';
        query('#bakemono-memory-automation-runtime-label').text(enabled ? '自动总结运行中' : '自动总结未开启');
        query('#bakemono-memory-automation-mode-badge').text(modeLabel);
        query('#bakemono-memory-automation-runtime-title').text(title);
        query('#bakemono-memory-automation-runtime-description').text(destination);
        query('#bakemono-memory-automation-progress-bar').css('width', `${enabled ? progress : 0}%`);
        query('#bakemono-memory-automation-rule-status').text(enabled ? `按${triggerLabel} · ${currentValue.toLocaleString()} / ${threshold.toLocaleString()}` : '尚未启用');
        query('#bakemono-memory-automation-floor-hint').text(`每 ${Number(state.automation.floorInterval || defaultAutomation.floorInterval).toLocaleString()} 个未整理片段`);
        query('#bakemono-memory-automation-char-hint').text(`每 ${Number(state.automation.charInterval || defaultAutomation.charInterval).toLocaleString()} 字`);
        query('#bakemono-memory-automation-preserve-hint').text(`最近 ${Number(state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent).toLocaleString()} 楼`);
        query('.bakemono-memory-automation-hero').toggleClass('is-running', enabled).toggleClass('is-ready', ready);
        documentRef.querySelectorAll('[data-bakemono-auto-rule]').forEach(row => {
            row.hidden = row.dataset.bakemonoAutoRule !== triggerType;
        });
    }

    return { renderAutomationOverview, renderHubPanels };
}
