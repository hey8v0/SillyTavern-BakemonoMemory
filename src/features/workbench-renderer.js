export const workbenchRenderScopes = Object.freeze({
    VECTOR: 'vector',
    DRAFTS: 'drafts',
    TABLES: 'tables',
    SUMMARY: 'summary',
    SCAN: 'scan',
    ARCHIVE: 'archive',
    INJECTION: 'injection',
    AUTOMATION: 'automation',
    PROMPTS: 'prompts',
    GENERATION: 'generation',
    CONFIG: 'config',
    SETTINGS: 'settings',
});

export function createWorkbenchRenderer({
    documentRef,
    globalRef,
    query,
    getState,
    isWorkbenchOpen,
    getActiveTab,
    areaPresetScopes,
    renderPresetControlPair,
    renderAreaPresetControl,
    renderWorkflowGuide,
    renderMemoryDatabaseSummary,
    renderPromptInspector,
    renderHubPanels,
    renderSummaryGenerationPanel,
    renderPreviewSections,
    renderMemoryRecordList,
    renderTimeline,
    renderDrafts,
    renderHistory,
    renderTaskQueue,
    renderTurnSummaryPanel,
    renderInjectionOverview,
    renderPromptOverview,
    renderAutomationOverview,
    renderVectorMemoryPanel,
    renderScanOverview,
    renderScanPreview,
    renderCustomModelOptions,
    renderAppearanceSettings,
    renderAutoHideRecentPanel,
    renderMaintenanceOverview,
    renderHelp,
    getStoryBlocks,
    getBlocksByType,
    blockTypes,
    dedupeByHash,
    summaryToBlock,
    memoryStrategies,
    workflowModes,
    getStageSourceMode,
    getMemoryStrategyLabel,
    getWorkflowModeLabel,
    getStageSourceModeLabel,
    getInjectionMemoryParts,
    getWorkflowStatusText,
    defaultInjectionTemplate,
    renderInjectionContent,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
    defaultAutomation,
    defaultGenerationTargets,
    buildMemoryRecords,
    renderHeaderContext,
    captureFeedback,
}) {
    let scheduledHandle = null;
    let scheduledStatus = '';

    function renderActivePresetControls(tabName) {
        if (tabName === 'config') {
            renderPresetControlPair('#bakemono-memory-preset-select', '#bakemono-memory-preset-name');
        } else if (tabName === 'scan') {
            renderAreaPresetControl(areaPresetScopes.SCAN, '#bakemono-memory-scan-preset-select', '#bakemono-memory-scan-preset-name');
        } else if (tabName === 'automation') {
            renderAreaPresetControl(areaPresetScopes.AUTOMATION, '#bakemono-memory-automation-preset-select', '#bakemono-memory-automation-preset-name');
        } else if (tabName === 'generation') {
            renderAreaPresetControl(areaPresetScopes.API, '#bakemono-memory-api-preset-select', '#bakemono-memory-api-preset-name');
        } else if (tabName === 'prompts') {
            renderAreaPresetControl(areaPresetScopes.PROMPTS, '#bakemono-memory-prompts-preset-select', '#bakemono-memory-prompts-preset-name');
        } else if (tabName === 'turn-summary' || tabName === 'tables') {
            renderAreaPresetControl(areaPresetScopes.TURN, '#bakemono-memory-turn-preset-select', '#bakemono-memory-turn-preset-name');
        } else if (tabName === 'injection') {
            renderAreaPresetControl(areaPresetScopes.INJECTION, '#bakemono-memory-injection-preset-select', '#bakemono-memory-injection-preset-name');
        } else if (tabName === 'vector') {
            renderAreaPresetControl(areaPresetScopes.VECTOR, '#bakemono-memory-vector-preset-select', '#bakemono-memory-vector-preset-name');
        }
    }

    function buildBlockBundle(state = getState()) {
        const story = getStoryBlocks();
        const stage = dedupeByHash([
            ...getBlocksByType(blockTypes.STAGE),
            ...state.stageSummaries.map(summaryToBlock),
        ]);
        const epic = dedupeByHash([
            ...getBlocksByType(blockTypes.EPIC),
            ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
        ]);
        return { story, stage, epic };
    }

    function syncActiveFormFields(activeTab, state = getState()) {
        if (activeTab === 'settings') {
            query('#bakemono-memory-memory-strategy').val(state.memoryStrategy || memoryStrategies.BAKEMONO);
            query('#bakemono-memory-workflow-mode').val(state.workflowMode || workflowModes.BAKEMONO);
            query('#bakemono-memory-stage-source-mode').val(getStageSourceMode(state));
            query('#bakemono-memory-output-mode').val(state.outputMode || 'bakemono');
            query('#bakemono-memory-strategy-label').text(getMemoryStrategyLabel(state.memoryStrategy));
            query('#bakemono-memory-workflow-label').text(`${getWorkflowModeLabel(state.workflowMode)} / ${getStageSourceModeLabel(getStageSourceMode(state))}`);
            const injectionParts = getInjectionMemoryParts(state);
            const uncoveredStory = state.storySummaries.filter(item => !(state.coveredBlockHashes || []).includes(item.hash)).length;
            query('#bakemono-memory-injection-stats').text(`注入：多次 ${injectionParts.stats.epic} / 阶段 ${injectionParts.stats.stage} / 普通 ${injectionParts.stats.story} / 表格 ${injectionParts.stats.table || 0} / 向量 ${injectionParts.stats.vector || 0}`);
            query('#bakemono-memory-memory-warning').text(getWorkflowStatusText(state, injectionParts.stats, uncoveredStory));
        } else if (activeTab === 'injection') {
            query('#bakemono-memory-injection-enabled').prop('checked', !!state.injection.enabled);
            query('#bakemono-memory-depth').val(state.injection.depth);
            query('#bakemono-memory-role').val(String(state.injection.role));
            query('#bakemono-memory-source-content').val(state.generatedMemory || '');
            query('#bakemono-memory-injection-template').val(state.injection.template || defaultInjectionTemplate);
            query('#bakemono-memory-injection-content').val(renderInjectionContent(state));
        } else if (activeTab === 'prompts') {
            query('#bakemono-memory-story-prompt').val(state.generationPrompts.story || defaultStoryGenerationPrompt);
            query('#bakemono-memory-missing-prompt').val(state.generationPrompts.missing || defaultMissingSummaryPrompt);
            query('#bakemono-memory-stage-prompt').val(state.generationPrompts.stage || defaultStageGenerationPrompt);
            query('#bakemono-memory-epic-prompt').val(state.generationPrompts.epic || defaultEpicGenerationPrompt);
        } else if (activeTab === 'scan') {
            query('#bakemono-memory-scan-mode').val(state.scanRules.mode || defaultScanRules.mode);
            query('#bakemono-memory-include-tags').val(state.scanRules.includeTags || defaultScanRules.includeTags);
            query('#bakemono-memory-exclude-tags').val(state.scanRules.excludeTags || defaultScanRules.excludeTags);
            query('#bakemono-memory-full-min-length').val(state.scanRules.fullTextMinLength ?? defaultScanRules.fullTextMinLength);
            query('#bakemono-memory-include-hidden').prop('checked', state.scanRules.includeHidden !== false);
            query('#bakemono-memory-class-story').val(state.classificationRules.story || defaultClassificationRules.story);
            query('#bakemono-memory-class-stage').val(state.classificationRules.stage || defaultClassificationRules.stage);
            query('#bakemono-memory-class-epic').val(state.classificationRules.epic || defaultClassificationRules.epic);
            query('#bakemono-memory-layout-story').val(state.previewLayouts.story || defaultPreviewLayouts.story);
            query('#bakemono-memory-layout-stage').val(state.previewLayouts.stage || defaultPreviewLayouts.stage);
            query('#bakemono-memory-layout-epic').val(state.previewLayouts.epic || defaultPreviewLayouts.epic);
        } else if (activeTab === 'automation') {
            query('#bakemono-memory-auto-enabled').prop('checked', !!state.automation.enabled);
            query('#bakemono-memory-auto-mode').val(state.automation.mode || defaultAutomation.mode);
            query('#bakemono-memory-auto-trigger').val(state.automation.triggerType || defaultAutomation.triggerType);
            query('#bakemono-memory-auto-floor-interval').val(state.automation.floorInterval ?? defaultAutomation.floorInterval);
            query('#bakemono-memory-auto-char-interval').val(state.automation.charInterval ?? defaultAutomation.charInterval);
            query('#bakemono-memory-auto-hide-preserve-recent').val(state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent);
        } else if (activeTab === 'preview') {
            query('#bakemono-memory-batch-summary-size').val(state.automation.backfillBatchSize ?? defaultAutomation.backfillBatchSize);
            query('#bakemono-memory-stage-target-mode').val(state.generationTargets.stage.mode || defaultGenerationTargets.stage.mode);
            query('#bakemono-memory-stage-target-count').val(state.generationTargets.stage.count ?? defaultGenerationTargets.stage.count);
            query('#bakemono-memory-stage-target-range').val(state.generationTargets.stage.range || '');
            query('#bakemono-memory-epic-target-mode').val(state.generationTargets.epic.mode || defaultGenerationTargets.epic.mode);
            query('#bakemono-memory-epic-target-count').val(state.generationTargets.epic.count ?? defaultGenerationTargets.epic.count);
            query('#bakemono-memory-epic-target-range').val(state.generationTargets.epic.range || '');
        } else if (activeTab === 'generation') {
            query('#bakemono-memory-api-provider').val(state.automation.apiProvider || defaultAutomation.apiProvider);
            query('#bakemono-memory-custom-base-url').val(state.automation.customApi?.baseUrl || '');
            query('#bakemono-memory-custom-api-key').val(state.automation.customApi?.apiKey || '');
            query('#bakemono-memory-custom-model').val(state.automation.customApi?.model || '');
            query('#bakemono-memory-custom-temperature').val(state.automation.customApi?.temperature ?? defaultAutomation.customApi.temperature);
            query('#bakemono-memory-custom-max-tokens').val(state.automation.customApi?.maxTokens ?? defaultAutomation.customApi.maxTokens);
            query('#bakemono-memory-custom-stream').val(String(!!state.automation.customApi?.stream));
        }
    }

    function renderActivePanel(tabName, state, blocks) {
        renderActivePresetControls(tabName);
        if (tabName === 'overview') {
            renderWorkflowGuide(state);
            renderMemoryDatabaseSummary(state);
        } else if (tabName === 'prompt-inspector') {
            void renderPromptInspector();
        } else if (tabName === 'data-hub') {
            renderHubPanels(state);
            renderMemoryDatabaseSummary(state);
        } else if (tabName === 'settings-hub') renderHubPanels(state);
        else if (tabName === 'settings') renderWorkflowGuide(state);
        else if (tabName === 'preview') {
            renderSummaryGenerationPanel(state, blocks);
            renderPreviewSections(blocks.story, blocks.stage, blocks.epic);
        } else if (tabName === 'records') renderMemoryRecordList();
        else if (tabName === 'timeline') renderTimeline();
        else if (tabName === 'drafts') {
            renderDrafts(); renderHistory(); renderTaskQueue();
        } else if (tabName === 'turn-summary' || tabName === 'tables') renderTurnSummaryPanel(state);
        else if (tabName === 'injection') renderInjectionOverview(state);
        else if (tabName === 'prompts') renderPromptOverview(state);
        else if (tabName === 'vector') renderVectorMemoryPanel(state);
        else if (tabName === 'scan') { renderScanOverview(state); renderScanPreview(); }
        else if (tabName === 'generation') renderCustomModelOptions(state.automation.customApi?.models || []);
        else if (tabName === 'appearance') renderAppearanceSettings();
        else if (tabName === 'maintenance') { renderAutoHideRecentPanel(state); renderMaintenanceOverview(state); }
        else if (tabName === 'help') renderHelp();
    }

    function renderSharedChrome(activeTab, state, statusText = '', options = {}) {
        query('#bakemono-memory-count-drafts').text(state.drafts.length);
        query('#bakemono-memory-menu-draft-count').text(state.drafts.length.toLocaleString());
        if (statusText) query('#bakemono-memory-status-line').text(statusText);
        renderHeaderContext(activeTab, state);
        if (statusText && options.feedback !== false) captureFeedback(statusText);
    }

    function renderDataHubMemory(state) {
        const blocks = buildBlockBundle(state);
        state.memoryRecords = buildMemoryRecords(state);
        query('#bakemono-memory-count-story').text(blocks.story.length);
        query('#bakemono-memory-count-stage').text(blocks.stage.length);
        query('#bakemono-memory-count-epic').text(blocks.epic.length);
        renderHubPanels(state);
        renderMemoryDatabaseSummary(state);
    }

    function renderOverviewMemory(state) {
        state.memoryRecords = buildMemoryRecords(state);
        renderWorkflowGuide(state);
        renderMemoryDatabaseSummary(state);
    }

    function renderSummarySurface(activeTab, state) {
        if (activeTab === 'preview') {
            const blocks = buildBlockBundle(state);
            query('#bakemono-memory-tab-count-story').text(blocks.story.length);
            query('#bakemono-memory-tab-count-stage').text(blocks.stage.length);
            query('#bakemono-memory-tab-count-epic').text(blocks.epic.length);
            renderSummaryGenerationPanel(state, blocks);
            renderPreviewSections(blocks.story, blocks.stage, blocks.epic);
        } else if (activeTab === 'overview') renderOverviewMemory(state);
        else if (activeTab === 'data-hub') renderDataHubMemory(state);
        else if (activeTab === 'records') { state.memoryRecords = buildMemoryRecords(state); renderMemoryRecordList(); }
        else if (activeTab === 'timeline') renderTimeline();
        else if (activeTab === 'drafts') { renderDrafts(); renderHistory(); renderTaskQueue(); }
        else if (activeTab === 'maintenance') renderMaintenanceOverview(state);
        else if (activeTab === 'turn-summary' || activeTab === 'tables') { renderActivePresetControls(activeTab); renderTurnSummaryPanel(state); }
    }

    function renderScope(scope, statusText = '', options = {}) {
        if (!isWorkbenchOpen()) return false;
        const state = getState();
        const activeTab = getActiveTab();
        if (scope === workbenchRenderScopes.VECTOR) {
            if (activeTab === 'vector') { renderActivePresetControls(activeTab); renderVectorMemoryPanel(state); }
            else if (activeTab === 'data-hub') renderHubPanels(state);
        } else if (scope === workbenchRenderScopes.DRAFTS) {
            if (activeTab === 'drafts') { renderDrafts(); renderHistory(); renderTaskQueue(); }
            else if (activeTab === 'maintenance') renderMaintenanceOverview(state);
            else if (activeTab === 'data-hub' && options.refreshDataHub !== false) renderDataHubMemory(state);
        } else if (scope === workbenchRenderScopes.TABLES) {
            if (activeTab === 'turn-summary' || activeTab === 'tables') { renderActivePresetControls(activeTab); renderTurnSummaryPanel(state); }
            else if (activeTab === 'data-hub') renderDataHubMemory(state);
        } else if (scope === workbenchRenderScopes.SUMMARY) renderSummarySurface(activeTab, state);
        else if (scope === workbenchRenderScopes.SCAN) {
            if (activeTab === 'scan') { syncActiveFormFields(activeTab, state); renderActivePresetControls(activeTab); renderScanOverview(state); renderScanPreview(); }
            else renderSummarySurface(activeTab, state);
        } else if (scope === workbenchRenderScopes.ARCHIVE) {
            if (activeTab === 'maintenance') { renderAutoHideRecentPanel(state); renderMaintenanceOverview(state); }
            else if (activeTab === 'overview') renderOverviewMemory(state);
            else if (activeTab === 'data-hub') renderDataHubMemory(state);
            else if (activeTab === 'records') { state.memoryRecords = buildMemoryRecords(state); renderMemoryRecordList(); }
            else if (activeTab === 'vector') renderVectorMemoryPanel(state);
        } else if (scope === workbenchRenderScopes.INJECTION) {
            if (activeTab === 'injection') { syncActiveFormFields(activeTab, state); renderActivePresetControls(activeTab); renderInjectionOverview(state); }
            else if (activeTab === 'settings') { syncActiveFormFields(activeTab, state); renderWorkflowGuide(state); }
            else if (activeTab === 'settings-hub' || activeTab === 'data-hub') renderHubPanels(state);
        } else if (scope === workbenchRenderScopes.AUTOMATION) {
            if (activeTab === 'automation') { syncActiveFormFields(activeTab, state); renderActivePresetControls(activeTab); renderAutomationOverview(state); }
            else if (activeTab === 'data-hub' || activeTab === 'settings-hub') renderHubPanels(state);
            else if (activeTab === 'overview') renderWorkflowGuide(state);
            else if (activeTab === 'maintenance') renderMaintenanceOverview(state);
        } else if (scope === workbenchRenderScopes.PROMPTS) {
            if (activeTab === 'prompts') { syncActiveFormFields(activeTab, state); renderActivePresetControls(activeTab); renderPromptOverview(state); syncPromptHintButtons(); }
        } else if (scope === workbenchRenderScopes.GENERATION) {
            if (activeTab === 'generation') { syncActiveFormFields(activeTab, state); renderActivePresetControls(activeTab); renderCustomModelOptions(state.automation.customApi?.models || []); }
            else if (activeTab === 'settings-hub') renderHubPanels(state);
        } else if (scope === workbenchRenderScopes.CONFIG) {
            if (activeTab === 'config') renderActivePresetControls(activeTab);
            else if (activeTab === 'settings-hub' || activeTab === 'data-hub') renderHubPanels(state);
        } else if (scope === workbenchRenderScopes.SETTINGS) {
            if (activeTab === 'settings') { syncActiveFormFields(activeTab, state); renderWorkflowGuide(state); }
            else if (activeTab === 'overview') renderWorkflowGuide(state);
            else if (activeTab === 'settings-hub' || activeTab === 'data-hub') renderHubPanels(state);
        } else return false;
        renderSharedChrome(activeTab, state, statusText, options);
        return true;
    }

    function syncPromptHintButtons() {
        documentRef.querySelectorAll('.bakemono-memory-card-panel > h4 + .bakemono-memory-prompt-hint').forEach(hint => {
            const title = hint.previousElementSibling;
            if (title?.matches('h4')) title.append(hint);
        });
    }

    function renderAll(statusText = '') {
        if (scheduledHandle !== null) {
            if (typeof globalRef.cancelAnimationFrame === 'function') globalRef.cancelAnimationFrame(scheduledHandle);
            else globalRef.clearTimeout(scheduledHandle);
            scheduledHandle = null;
            scheduledStatus = '';
        }
        const state = getState();
        if (!isWorkbenchOpen()) return;
        const activeTab = getActiveTab();
        if (activeTab === 'overview' || activeTab === 'records' || activeTab === 'data-hub') state.memoryRecords = buildMemoryRecords(state);
        const blocks = activeTab === 'preview' || activeTab === 'data-hub' ? buildBlockBundle(state) : null;
        query('#bakemono-memory-count-drafts').text(state.drafts.length);
        query('#bakemono-memory-menu-draft-count').text(state.drafts.length.toLocaleString());
        if (activeTab === 'data-hub' && blocks) {
            query('#bakemono-memory-count-story').text(blocks.story.length);
            query('#bakemono-memory-count-stage').text(blocks.stage.length);
            query('#bakemono-memory-count-epic').text(blocks.epic.length);
        } else if (activeTab === 'preview' && blocks) {
            query('#bakemono-memory-tab-count-story').text(blocks.story.length);
            query('#bakemono-memory-tab-count-stage').text(blocks.stage.length);
            query('#bakemono-memory-tab-count-epic').text(blocks.epic.length);
        }
        syncActiveFormFields(activeTab, state);
        if (activeTab === 'automation') renderAutomationOverview(state);
        renderActivePanel(activeTab, state, blocks);
        const injected = state.injection.enabled && renderInjectionContent(state) ? '注入开启' : '注入为空或关闭';
        query('#bakemono-memory-status-line').text(statusText || `${injected}。上次扫描：${state.lastScanAt ? new Date(state.lastScanAt).toLocaleString() : '尚未扫描'}。`);
        renderHeaderContext(activeTab, state);
        syncPromptHintButtons();
        captureFeedback(statusText);
    }

    function scheduleRenderAll(statusText = '') {
        if (statusText) scheduledStatus = statusText;
        if (scheduledHandle !== null) return;
        const flush = () => {
            scheduledHandle = null;
            const nextStatus = scheduledStatus;
            scheduledStatus = '';
            renderAll(nextStatus);
        };
        scheduledHandle = typeof globalRef.requestAnimationFrame === 'function'
            ? globalRef.requestAnimationFrame(flush)
            : globalRef.setTimeout(flush, 16);
    }

    function renderTaskQueueProgress(statusText = '') {
        renderScope(workbenchRenderScopes.DRAFTS, statusText, { feedback: false, refreshDataHub: false });
    }

    return {
        buildBlockBundle,
        renderActivePanel,
        renderActivePresetControls,
        renderAll,
        renderDataHubMemory,
        renderOverviewMemory,
        renderScope,
        renderSharedChrome,
        renderSummarySurface,
        renderTaskQueueProgress,
        scheduleRenderAll,
        syncActiveFormFields,
        syncPromptHintButtons,
    };
}
