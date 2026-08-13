export function createConfigurationService({
    query,
    getState,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
    defaultAutomation,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    defaultInjectionTemplate,
    defaultGenerationTargets,
    defaultVectorMemory,
    defaultState,
    turnProcessingModes,
    tableSchemaScopes,
    extensionPromptRoles,
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    makePresetId,
    getStageSourceMode,
    setTableSchemaScope,
    readVectorMemoryFieldsFromUi,
    createSharedInlineGenerationConfig,
    createSharedVectorConfig,
    getTableSchemasForPreset,
    getActiveGlobalConfig,
    setActiveGlobalConfig,
    markActiveConfigApplied,
    saveState,
    ensureGlobalSettings,
    extensionSettings,
    storageKey,
    getContext,
    shouldBootstrapSharedConfig,
}) {
    const sharedGlobalConfigId = 'bakemono-shared-settings';

    function readRuleFieldsFromUi(state = getState()) {
        if (!query('#bakemono-memory-scan-mode').length) {
            return state;
        }
        state.scanRules = {
            mode: String(query('#bakemono-memory-scan-mode').val() || defaultScanRules.mode),
            includeTags: String(query('#bakemono-memory-include-tags').val() || ''),
            excludeTags: String(query('#bakemono-memory-exclude-tags').val() || ''),
            fullTextMinLength: Math.max(0, Number(query('#bakemono-memory-full-min-length').val() || defaultScanRules.fullTextMinLength)),
            includeHidden: query('#bakemono-memory-include-hidden').prop('checked'),
        };
        state.classificationRules = {
            story: String(query('#bakemono-memory-class-story').val() || defaultClassificationRules.story),
            stage: String(query('#bakemono-memory-class-stage').val() || defaultClassificationRules.stage),
            epic: String(query('#bakemono-memory-class-epic').val() || defaultClassificationRules.epic),
        };
        state.previewLayouts = {
            story: String(query('#bakemono-memory-layout-story').val() || defaultPreviewLayouts.story),
            stage: String(query('#bakemono-memory-layout-stage').val() || defaultPreviewLayouts.stage),
            epic: String(query('#bakemono-memory-layout-epic').val() || defaultPreviewLayouts.epic),
        };
        return state;
    }

    function readCustomApiFieldsFromUi(state = getState()) {
        if (!query('#bakemono-memory-api-provider').length) {
            return state;
        }
        state.automation = state.automation && typeof state.automation === 'object'
            ? state.automation
            : structuredClone(defaultAutomation);
        const currentModels = Array.isArray(state.automation.customApi?.models)
            ? state.automation.customApi.models
            : [];
        state.automation.apiProvider = String(query('#bakemono-memory-api-provider').val() || defaultAutomation.apiProvider);
        state.automation.customApi = {
            ...structuredClone(defaultAutomation.customApi),
            ...(state.automation.customApi || {}),
            baseUrl: String(query('#bakemono-memory-custom-base-url').val() || '').trim(),
            apiKey: String(query('#bakemono-memory-custom-api-key').val() || '').trim(),
            model: String(query('#bakemono-memory-custom-model').val() || '').trim(),
            temperature: Number(query('#bakemono-memory-custom-temperature').val() || defaultAutomation.customApi.temperature),
            maxTokens: Number(query('#bakemono-memory-custom-max-tokens').val() || defaultAutomation.customApi.maxTokens),
            stream: String(query('#bakemono-memory-custom-stream').val() || 'false') === 'true',
            models: currentModels,
        };
        return state;
    }

    function readAutomationFieldsFromUi(state = getState()) {
        if (!query('#bakemono-memory-auto-mode').length) {
            return state;
        }
        readCustomApiFieldsFromUi(state);
        state.automation = {
            ...state.automation,
            enabled: query('#bakemono-memory-auto-enabled').prop('checked'),
            mode: String(query('#bakemono-memory-auto-mode').val() || defaultAutomation.mode),
            triggerType: String(query('#bakemono-memory-auto-trigger').val() || defaultAutomation.triggerType),
            floorInterval: Math.max(1, Number(query('#bakemono-memory-auto-floor-interval').val() || defaultAutomation.floorInterval)),
            charInterval: Math.max(100, Number(query('#bakemono-memory-auto-char-interval').val() || defaultAutomation.charInterval)),
            backfillBatchSize: query('#bakemono-memory-backfill-batch-size').length
                ? Math.max(1, Number(query('#bakemono-memory-backfill-batch-size').val() || state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize))
                : Math.max(1, Number(state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize)),
            autoHidePreserveRecent: Math.max(0, Number(query('#bakemono-memory-auto-hide-preserve-recent').val() || defaultAutomation.autoHidePreserveRecent)),
        };
        return state;
    }

    function readPromptFieldsFromUi(state = getState()) {
        if (!query('#bakemono-memory-stage-prompt').length) {
            return state;
        }
        state.generationPrompts.story = String(query('#bakemono-memory-story-prompt').val() || defaultStoryGenerationPrompt);
        state.generationPrompts.missing = String(query('#bakemono-memory-missing-prompt').val() || defaultMissingSummaryPrompt);
        state.generationPrompts.stage = String(query('#bakemono-memory-stage-prompt').val() || defaultStageGenerationPrompt);
        state.generationPrompts.epic = String(query('#bakemono-memory-epic-prompt').val() || defaultEpicGenerationPrompt);
        return state;
    }

    function readTurnSummaryFieldsFromUi(state = getState()) {
        if (!query('#bakemono-memory-turn-enabled').length) {
            return state;
        }
        state.turnSummary = {
            ...state.turnSummary,
            enabled: query('#bakemono-memory-turn-enabled').prop('checked'),
            auto: query('#bakemono-memory-turn-auto').prop('checked'),
            processingMode: String(query('#bakemono-memory-turn-processing-mode').val() || turnProcessingModes.BOTH),
            saveMode: query('#bakemono-memory-turn-auto-save').prop('checked') ? 'commit' : 'draft',
            includeUserMessage: query('#bakemono-memory-turn-include-user').prop('checked'),
            includeCharacterContext: query('#bakemono-memory-turn-include-character').prop('checked'),
            includeWorldInfo: query('#bakemono-memory-turn-include-world-info').prop('checked'),
            worldInfoMaxContext: Math.max(1024, Number(query('#bakemono-memory-turn-world-max-context').val() || defaultState.turnSummary.worldInfoMaxContext)),
            referenceContext: String(query('#bakemono-memory-turn-reference').val() || ''),
            prompt: String(query('#bakemono-memory-turn-prompt').val() || defaultTurnSummaryPrompt),
            tablePrompt: String(query('#bakemono-memory-table-prompt').val() || defaultTableEditPrompt),
        };
        state.tableDatabase = {
            ...state.tableDatabase,
            enabled: query('#bakemono-memory-table-enabled').prop('checked'),
            injectMemory: query('#bakemono-memory-table-inject-memory').length
                ? query('#bakemono-memory-table-inject-memory').prop('checked')
                : state.tableDatabase.injectMemory !== false,
            autoApply: query('#bakemono-memory-table-auto-apply').prop('checked'),
            schemaScope: String(query('#bakemono-memory-table-schema-scope').val() || state.tableDatabase.schemaScope || tableSchemaScopes.CHAT),
        };
        state.inlineGeneration = {
            ...state.inlineGeneration,
            summaryEnabled: query('#bakemono-memory-inline-summary-enabled').prop('checked'),
            tableEnabled: query('#bakemono-memory-inline-table-enabled').prop('checked'),
            hideTableEdit: query('#bakemono-memory-inline-hide-table').prop('checked'),
            summaryPrompt: String(query('#bakemono-memory-inline-summary-prompt').val() || defaultInlineSummaryPrompt),
            tablePrompt: String(query('#bakemono-memory-inline-table-prompt').val() || defaultInlineTablePrompt),
        };
        setTableSchemaScope(state.tableDatabase.schemaScope, state);
        return state;
    }

    function readInjectionFieldsFromUi(state = getState()) {
        if (!query('#bakemono-memory-injection-template').length) {
            return state;
        }
        state.injection = {
            ...state.injection,
            enabled: query('#bakemono-memory-injection-enabled').prop('checked'),
            depth: Math.max(0, Number(query('#bakemono-memory-depth').val() || defaultState.injection.depth)),
            role: Number(query('#bakemono-memory-role').val() || extensionPromptRoles.SYSTEM),
            template: String(query('#bakemono-memory-injection-template').val() || defaultInjectionTemplate),
        };
        return state;
    }

    function readConfigFieldsFromUi(state = getState()) {
        readRuleFieldsFromUi(state);
        readAutomationFieldsFromUi(state);
        readPromptFieldsFromUi(state);
        readTurnSummaryFieldsFromUi(state);
        readInjectionFieldsFromUi(state);
        readVectorMemoryFieldsFromUi(state);
        return state;
    }

    function getConfigPayloadFromState(state = getState(), name = '', options = {}) {
        const now = new Date().toISOString();
        return {
            id: options.id || makePresetId(name),
            name: name || '未命名预设',
            story: String(state.generationPrompts.story || defaultStoryGenerationPrompt),
            missing: String(state.generationPrompts.missing || defaultMissingSummaryPrompt),
            stage: String(state.generationPrompts.stage || defaultStageGenerationPrompt),
            epic: String(state.generationPrompts.epic || defaultEpicGenerationPrompt),
            scanRules: structuredClone(state.scanRules),
            classificationRules: structuredClone(state.classificationRules),
            previewLayouts: structuredClone(state.previewLayouts),
            memoryStrategy: state.memoryStrategy || memoryStrategies.BAKEMONO,
            workflowMode: state.workflowMode || workflowModes.BAKEMONO,
            stageSourceMode: getStageSourceMode(state),
            outputMode: state.outputMode || 'bakemono',
            generationTargets: structuredClone(state.generationTargets || defaultGenerationTargets),
            injection: {
                enabled: !!state.injection.enabled,
                depth: Math.max(0, Number(state.injection.depth ?? defaultState.injection.depth)),
                role: Number(state.injection.role ?? extensionPromptRoles.SYSTEM),
                template: String(state.injection.template || defaultInjectionTemplate),
            },
            automation: {
                ...structuredClone(state.automation),
                lastSignature: '',
                lastAutoAt: null,
            },
            turnSummary: {
                enabled: !!state.turnSummary.enabled,
                auto: !!state.turnSummary.auto,
                processingMode: state.turnSummary.processingMode || turnProcessingModes.BOTH,
                saveMode: state.turnSummary.saveMode === 'commit' ? 'commit' : 'draft',
                includeUserMessage: state.turnSummary.includeUserMessage !== false,
                includeCharacterContext: state.turnSummary.includeCharacterContext !== false,
                includeWorldInfo: !!state.turnSummary.includeWorldInfo,
                worldInfoMaxContext: Math.max(1024, Number(state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext)),
                referenceContext: String(state.turnSummary.referenceContext || ''),
                prompt: String(state.turnSummary.prompt || defaultTurnSummaryPrompt),
                tablePrompt: String(state.turnSummary.tablePrompt || defaultTableEditPrompt),
            },
            inlineGeneration: createSharedInlineGenerationConfig(state.inlineGeneration || defaultState.inlineGeneration),
            vectorMemory: createSharedVectorConfig(state.vectorMemory || defaultVectorMemory),
            tableDatabase: {
                enabled: !!state.tableDatabase.enabled,
                injectMemory: state.tableDatabase.injectMemory !== false,
                autoApply: !!state.tableDatabase.autoApply,
                schemaScope: state.tableDatabase.schemaScope || tableSchemaScopes.CHAT,
                tables: getTableSchemasForPreset(state),
            },
            createdAt: options.createdAt || now,
            updatedAt: now,
        };
    }

    function getCurrentPromptPresetPayload(name = '') {
        const state = readConfigFieldsFromUi(getState());
        return getConfigPayloadFromState(state, name);
    }

    function persistSharedConfigurationFromState(state = getState(), options = {}) {
        const current = getActiveGlobalConfig();
        const currentShared = current?.id === sharedGlobalConfigId ? current : null;
        const payload = getConfigPayloadFromState(
            state,
            options.name || currentShared?.name || '所有角色卡设置',
            {
                id: sharedGlobalConfigId,
                createdAt: currentShared?.createdAt,
            },
        );
        const config = setActiveGlobalConfig(payload);
        markActiveConfigApplied(state, config);
        if (options.skipChatSave !== true) {
            saveState();
        }
        return config;
    }

    function bootstrapSharedConfigurationFromCurrentChat(state = getState()) {
        ensureGlobalSettings();
        const settings = extensionSettings[storageKey];
        const hasActiveChat = !!String(getContext()?.chatId || '').trim();
        if (!shouldBootstrapSharedConfig(settings, hasActiveChat)) {
            return false;
        }
        persistSharedConfigurationFromState(state, { skipChatSave: true });
        return true;
    }

    function normalizeImportedPreset(value) {
        const parsed = JSON.parse(value);
        const preset = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!preset || typeof preset !== 'object') {
            throw new Error('导入内容不是有效的预设对象。');
        }
        if (!preset.stage || !preset.epic) {
            throw new Error('预设需要包含 stage 和 epic 两段提示词。');
        }
        const name = String(preset.name || '导入预设');
        return {
            id: makePresetId(name),
            name,
            story: String(preset.story || defaultStoryGenerationPrompt),
            missing: String(preset.missing || defaultMissingSummaryPrompt),
            stage: String(preset.stage),
            epic: String(preset.epic),
            scanRules: preset.scanRules && typeof preset.scanRules === 'object' ? preset.scanRules : null,
            classificationRules: preset.classificationRules && typeof preset.classificationRules === 'object' ? preset.classificationRules : null,
            previewLayouts: preset.previewLayouts && typeof preset.previewLayouts === 'object' ? preset.previewLayouts : null,
            memoryStrategy: Object.values(memoryStrategies).includes(preset.memoryStrategy) ? preset.memoryStrategy : memoryStrategies.BAKEMONO,
            workflowMode: Object.values(workflowModes).includes(preset.workflowMode) ? preset.workflowMode : workflowModes.BAKEMONO,
            stageSourceMode: Object.values(stageSourceModes).includes(preset.stageSourceMode) ? preset.stageSourceMode : stageSourceModes.SUMMARIES,
            outputMode: ['bakemono', 'plain', 'custom'].includes(preset.outputMode) ? preset.outputMode : 'bakemono',
            generationTargets: preset.generationTargets && typeof preset.generationTargets === 'object' ? preset.generationTargets : null,
            injection: preset.injection && typeof preset.injection === 'object' ? preset.injection : null,
            automation: preset.automation && typeof preset.automation === 'object' ? preset.automation : null,
            turnSummary: preset.turnSummary && typeof preset.turnSummary === 'object' ? preset.turnSummary : null,
            inlineGeneration: preset.inlineGeneration && typeof preset.inlineGeneration === 'object' ? preset.inlineGeneration : null,
            vectorMemory: preset.vectorMemory && typeof preset.vectorMemory === 'object' ? preset.vectorMemory : null,
            tableDatabase: preset.tableDatabase && typeof preset.tableDatabase === 'object' ? preset.tableDatabase : null,
            createdAt: preset.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    }

    return {
        bootstrapSharedConfigurationFromCurrentChat,
        getConfigPayloadFromState,
        getCurrentPromptPresetPayload,
        normalizeImportedPreset,
        persistSharedConfigurationFromState,
        readAutomationFieldsFromUi,
        readConfigFieldsFromUi,
        readCustomApiFieldsFromUi,
        readInjectionFieldsFromUi,
        readPromptFieldsFromUi,
        readRuleFieldsFromUi,
        readTurnSummaryFieldsFromUi,
    };
}
