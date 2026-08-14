export function createConfigurationController({
    getState,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
    defaultPromptPreset,
    defaultGenericPromptPreset,
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    defaultGenerationTargets,
    defaultInjectionTemplate,
    defaultAutomation,
    defaultState,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    turnProcessingModes,
    mergeSharedInlineGenerationConfig,
    mergeSharedVectorConfig,
    createAutomationBehaviorConfig,
    mergeAutomationBehaviorConfig,
    defaultVectorMemory,
    tableSchemaScopes,
    normalizeImportedTablesFromJson,
    setTableSchemaScope,
    syncInlineGenerationPrompts,
    scheduleVectorAutoIndex,
    scanBlocks,
    updateInjectionFromSummaries,
    syncInjection,
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    getPromptPresets,
    getCurrentPromptPresetPayload,
    setSelectedPromptPresetId,
    saveGlobalSettings,
    setActiveGlobalConfig,
    markActiveConfigApplied,
    areaPresetScopes,
    makeAreaPresetId,
    readRuleFieldsFromUi,
    readAutomationFieldsFromUi,
    readCustomApiFieldsFromUi,
    readPromptFieldsFromUi,
    readTurnSummaryFieldsFromUi,
    readInjectionFieldsFromUi,
    readVectorMemoryFieldsFromUi,
    createSharedInlineGenerationConfig,
    createSharedVectorConfig,
    persistSharedConfigurationFromState,
    getAreaPresets,
    setSelectedAreaPresetId,
}) {
    function applyPromptPresetToState(preset, options = {}) {
        const state = options.state || getState();
        state.generationPrompts.story = preset.story || defaultStoryGenerationPrompt;
        state.generationPrompts.missing = preset.missing || defaultMissingSummaryPrompt;
        state.generationPrompts.stage = preset.stage || defaultStageGenerationPrompt;
        state.generationPrompts.epic = preset.epic || defaultEpicGenerationPrompt;
        if (preset.scanRules) {
            state.scanRules = { ...structuredClone(defaultScanRules), ...structuredClone(preset.scanRules) };
        }
        if (preset.classificationRules) {
            state.classificationRules = { ...structuredClone(defaultClassificationRules), ...structuredClone(preset.classificationRules) };
        }
        if (preset.previewLayouts) {
            state.previewLayouts = { ...structuredClone(defaultPreviewLayouts), ...structuredClone(preset.previewLayouts) };
        }
        if (Object.values(memoryStrategies).includes(preset.memoryStrategy)) {
            state.memoryStrategy = preset.memoryStrategy;
        } else if (preset.id === defaultGenericPromptPreset.id) {
            state.memoryStrategy = memoryStrategies.GENERIC;
        } else if (preset.id === defaultPromptPreset.id) {
            state.memoryStrategy = memoryStrategies.BAKEMONO;
        }
        if (Object.values(workflowModes).includes(preset.workflowMode)) {
            state.workflowMode = preset.workflowMode;
        } else if (preset.id === defaultGenericPromptPreset.id) {
            state.workflowMode = workflowModes.GENERIC;
        } else if (preset.id === defaultPromptPreset.id) {
            state.workflowMode = workflowModes.BAKEMONO;
        }
        if (Object.values(stageSourceModes).includes(preset.stageSourceMode)) {
            state.stageSourceMode = preset.stageSourceMode;
        } else {
            state.stageSourceMode = state.workflowMode === workflowModes.GENERIC ? stageSourceModes.BACKFILL : stageSourceModes.SUMMARIES;
        }
        state.outputMode = ['bakemono', 'plain', 'custom'].includes(preset.outputMode)
            ? preset.outputMode
            : (state.workflowMode === workflowModes.GENERIC ? 'plain' : 'bakemono');
        if (preset.generationTargets) {
            state.generationTargets = {
                ...structuredClone(defaultGenerationTargets),
                ...structuredClone(preset.generationTargets),
            };
        }
        if (preset.injection) {
            state.injection = {
                ...state.injection,
                enabled: preset.injection.enabled ?? state.injection.enabled,
                depth: Math.max(0, Number(preset.injection.depth ?? state.injection.depth)),
                role: Number(preset.injection.role ?? state.injection.role),
                template: String(preset.injection.template || state.injection.template || defaultInjectionTemplate),
            };
        }
        if (preset.automation) {
            state.automation = {
                ...structuredClone(defaultAutomation),
                ...structuredClone(preset.automation),
                lastSignature: state.automation.lastSignature || '',
                lastAutoAt: state.automation.lastAutoAt || null,
            };
        }
        if (preset.turnSummary) {
            state.turnSummary = {
                ...state.turnSummary,
                enabled: !!preset.turnSummary.enabled,
                auto: !!preset.turnSummary.auto,
                triggerTiming: preset.turnSummary.triggerTiming === 'next_user' ? 'next_user' : 'immediate',
                processingMode: preset.turnSummary.processingMode || state.turnSummary.processingMode || turnProcessingModes.BOTH,
                saveMode: preset.turnSummary.saveMode === 'commit' ? 'commit' : 'draft',
                includeUserMessage: preset.turnSummary.includeUserMessage !== false,
                includeCharacterContext: preset.turnSummary.includeCharacterContext !== false,
                includeWorldInfo: !!preset.turnSummary.includeWorldInfo,
                worldInfoMaxContext: Math.max(1024, Number(preset.turnSummary.worldInfoMaxContext || state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext)),
                referenceContext: String(preset.turnSummary.referenceContext || ''),
                prompt: String(preset.turnSummary.prompt || state.turnSummary.prompt || defaultTurnSummaryPrompt),
                tablePrompt: String(preset.turnSummary.tablePrompt || state.turnSummary.tablePrompt || defaultTableEditPrompt),
            };
        }
        if (preset.inlineGeneration) {
            state.inlineGeneration = mergeSharedInlineGenerationConfig(
                state.inlineGeneration,
                preset.inlineGeneration,
                defaultState.inlineGeneration,
            );
            syncInlineGenerationPrompts(state);
        }
        if (preset.vectorMemory) {
            state.vectorMemory = {
                ...mergeSharedVectorConfig(state.vectorMemory, preset.vectorMemory, defaultVectorMemory),
                dirty: true,
                dirtyReason: '载入全局配置',
            };
            if (!options.skipVectorSchedule) {
                scheduleVectorAutoIndex('载入全局配置');
            }
        }
        if (preset.tableDatabase) {
            state.tableDatabase = {
                ...state.tableDatabase,
                enabled: !!preset.tableDatabase.enabled,
                injectMemory: preset.tableDatabase.injectMemory !== false,
                autoApply: !!preset.tableDatabase.autoApply,
                schemaScope: Object.values(tableSchemaScopes).includes(preset.tableDatabase.schemaScope)
                    ? preset.tableDatabase.schemaScope
                    : state.tableDatabase.schemaScope,
                tables: Array.isArray(preset.tableDatabase.tables)
                    ? normalizeImportedTablesFromJson({ tables: preset.tableDatabase.tables })
                    : state.tableDatabase.tables,
                editDrafts: state.tableDatabase.editDrafts || [],
                history: state.tableDatabase.history || [],
            };
            setTableSchemaScope(state.tableDatabase.schemaScope, state);
        }
        state.activeConfigId = preset.id || state.activeConfigId || '';
        state.configInitialized = true;
        if (!options.skipScan) {
            scanBlocks({ persist: false });
        }
        updateInjectionFromSummaries();
        if (!options.skipSave) {
            saveState();
        }
        if (!options.silent && !options.skipRender) {
            renderWorkbenchScope(workbenchRenderScopes.CONFIG, `已使用配置：${preset.name || '未命名预设'}`);
            toastr.success('配置已使用。');
        }
    }

    function saveCurrentConfigPreset(name, options = {}) {
        const presets = getPromptPresets();
        const replaceId = options.replaceId || '';
        const existing = replaceId ? presets.find(preset => preset.id === replaceId) : null;
        const preset = getCurrentPromptPresetPayload(name);
        if (existing) {
            preset.id = existing.id;
            preset.createdAt = existing.createdAt || preset.createdAt;
            const index = presets.findIndex(item => item.id === existing.id);
            presets[index] = preset;
        } else {
            presets.push(preset);
        }
        setSelectedPromptPresetId(preset.id);
        saveGlobalSettings();
        saveState();
        if (!options.skipRender) {
            renderWorkbenchScope(workbenchRenderScopes.CONFIG, existing ? `已覆盖配置：${preset.name}` : `已保存配置：${preset.name}`);
        }
        toastr.success(existing ? '配置预设已覆盖。' : '配置预设已保存。');
        return preset;
    }

    function usePromptPresetAsGlobalDefault(preset, options = {}) {
        if (!preset) {
            toastr.warning('请先选择配置。');
            return false;
        }
        const state = getState();
        applyPromptPresetToState(preset, { state, silent: true });
        const config = setActiveGlobalConfig(preset);
        markActiveConfigApplied(state, config);
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.CONFIG, options.message || `已使用并同步到所有角色卡：${preset.name || '未命名配置'}`);
        toastr.success('已切换配置，并同步到所有角色卡。');
        return true;
    }

    function getAreaPresetPayload(scope, name) {
        const state = getState();
        const base = {
            id: makeAreaPresetId(scope, name),
            scope,
            name: name || '未命名配置',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        if (scope === areaPresetScopes.SCAN) {
            readRuleFieldsFromUi(state);
            return {
                ...base,
                scanRules: structuredClone(state.scanRules),
                classificationRules: structuredClone(state.classificationRules),
                previewLayouts: structuredClone(state.previewLayouts),
            };
        }
        if (scope === areaPresetScopes.AUTOMATION) {
            readAutomationFieldsFromUi(state);
            return {
                ...base,
                automation: {
                    ...createAutomationBehaviorConfig(state.automation),
                    lastSignature: '',
                    lastAutoAt: null,
                },
            };
        }
        if (scope === areaPresetScopes.API) {
            readCustomApiFieldsFromUi(state);
            return {
                ...base,
                apiProvider: state.automation.apiProvider || defaultAutomation.apiProvider,
                customApi: structuredClone(state.automation.customApi || defaultAutomation.customApi),
            };
        }
        if (scope === areaPresetScopes.PROMPTS) {
            readPromptFieldsFromUi(state);
            readTurnSummaryFieldsFromUi(state);
            return {
                ...base,
                story: String(state.generationPrompts.story || defaultStoryGenerationPrompt),
                missing: String(state.generationPrompts.missing || defaultMissingSummaryPrompt),
                stage: String(state.generationPrompts.stage || defaultStageGenerationPrompt),
                epic: String(state.generationPrompts.epic || defaultEpicGenerationPrompt),
                turnSummary: {
                    includeCharacterContext: state.turnSummary.includeCharacterContext !== false,
                    includeWorldInfo: !!state.turnSummary.includeWorldInfo,
                    worldInfoMaxContext: Math.max(1024, Number(state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext)),
                    referenceContext: String(state.turnSummary.referenceContext || ''),
                    prompt: String(state.turnSummary.prompt || defaultTurnSummaryPrompt),
                    tablePrompt: String(state.turnSummary.tablePrompt || defaultTableEditPrompt),
                },
                inlineGeneration: createSharedInlineGenerationConfig(state.inlineGeneration || defaultState.inlineGeneration),
            };
        }
        if (scope === areaPresetScopes.TURN) {
            readTurnSummaryFieldsFromUi(state);
            return {
                ...base,
                turnSummary: {
                    enabled: !!state.turnSummary.enabled,
                    auto: !!state.turnSummary.auto,
                    triggerTiming: state.turnSummary.triggerTiming === 'next_user' ? 'next_user' : 'immediate',
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
            };
        }
        if (scope === areaPresetScopes.INJECTION) {
            readInjectionFieldsFromUi(state);
            return {
                ...base,
                injection: {
                    enabled: !!state.injection.enabled,
                    depth: Math.max(0, Number(state.injection.depth ?? defaultState.injection.depth)),
                    role: Number(state.injection.role ?? defaultState.injection.role),
                    template: String(state.injection.template || defaultInjectionTemplate),
                },
            };
        }
        if (scope === areaPresetScopes.VECTOR) {
            readVectorMemoryFieldsFromUi(state);
            return {
                ...base,
                vectorMemory: createSharedVectorConfig(state.vectorMemory),
            };
        }
        return base;
    }

    function renderAreaPresetChange(scope, statusText) {
        const renderScope = {
            [areaPresetScopes.SCAN]: workbenchRenderScopes.SCAN,
            [areaPresetScopes.AUTOMATION]: workbenchRenderScopes.AUTOMATION,
            [areaPresetScopes.API]: workbenchRenderScopes.GENERATION,
            [areaPresetScopes.PROMPTS]: workbenchRenderScopes.PROMPTS,
            [areaPresetScopes.TURN]: workbenchRenderScopes.TABLES,
            [areaPresetScopes.INJECTION]: workbenchRenderScopes.INJECTION,
            [areaPresetScopes.VECTOR]: workbenchRenderScopes.VECTOR,
        }[scope] || workbenchRenderScopes.SETTINGS;
        renderWorkbenchScope(renderScope, statusText);
    }

    function applyAreaPresetToState(scope, preset) {
        const state = getState();
        if (scope === areaPresetScopes.SCAN) {
            if (preset.scanRules) {
                state.scanRules = { ...structuredClone(defaultScanRules), ...structuredClone(preset.scanRules) };
            }
            if (preset.classificationRules) {
                state.classificationRules = { ...structuredClone(defaultClassificationRules), ...structuredClone(preset.classificationRules) };
            }
            if (preset.previewLayouts) {
                state.previewLayouts = { ...structuredClone(defaultPreviewLayouts), ...structuredClone(preset.previewLayouts) };
            }
            scanBlocks({ persist: false });
        } else if (scope === areaPresetScopes.AUTOMATION && preset.automation) {
            state.automation = {
                ...mergeAutomationBehaviorConfig(state.automation, preset.automation, defaultAutomation),
                lastSignature: state.automation.lastSignature || '',
                lastAutoAt: state.automation.lastAutoAt || null,
            };
        } else if (scope === areaPresetScopes.API) {
            state.automation = {
                ...structuredClone(defaultAutomation),
                ...state.automation,
                apiProvider: preset.apiProvider || state.automation.apiProvider || defaultAutomation.apiProvider,
                customApi: {
                    ...structuredClone(defaultAutomation.customApi),
                    ...(preset.customApi || {}),
                },
            };
        } else if (scope === areaPresetScopes.PROMPTS) {
            state.generationPrompts.story = preset.story || defaultStoryGenerationPrompt;
            state.generationPrompts.missing = preset.missing || defaultMissingSummaryPrompt;
            state.generationPrompts.stage = preset.stage || defaultStageGenerationPrompt;
            state.generationPrompts.epic = preset.epic || defaultEpicGenerationPrompt;
            if (preset.turnSummary) {
                state.turnSummary.includeCharacterContext = preset.turnSummary.includeCharacterContext !== false;
                state.turnSummary.includeWorldInfo = !!preset.turnSummary.includeWorldInfo;
                state.turnSummary.worldInfoMaxContext = Math.max(1024, Number(preset.turnSummary.worldInfoMaxContext || state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext));
                state.turnSummary.referenceContext = String(preset.turnSummary.referenceContext || state.turnSummary.referenceContext || '');
                state.turnSummary.prompt = preset.turnSummary.prompt || state.turnSummary.prompt || defaultTurnSummaryPrompt;
                state.turnSummary.tablePrompt = preset.turnSummary.tablePrompt || state.turnSummary.tablePrompt || defaultTableEditPrompt;
            }
            if (preset.inlineGeneration) {
                state.inlineGeneration = mergeSharedInlineGenerationConfig(state.inlineGeneration, preset.inlineGeneration, defaultState.inlineGeneration);
                syncInlineGenerationPrompts(state);
            }
        } else if (scope === areaPresetScopes.TURN && preset.turnSummary) {
            state.turnSummary = {
                ...state.turnSummary,
                enabled: preset.turnSummary.enabled ?? state.turnSummary.enabled,
                auto: preset.turnSummary.auto ?? state.turnSummary.auto,
                triggerTiming: preset.turnSummary.triggerTiming === 'next_user' ? 'next_user' : 'immediate',
                processingMode: preset.turnSummary.processingMode || state.turnSummary.processingMode || turnProcessingModes.BOTH,
                saveMode: preset.turnSummary.saveMode === 'commit' ? 'commit' : state.turnSummary.saveMode || 'draft',
                includeUserMessage: preset.turnSummary.includeUserMessage !== false,
                includeCharacterContext: preset.turnSummary.includeCharacterContext !== false,
                includeWorldInfo: !!preset.turnSummary.includeWorldInfo,
                worldInfoMaxContext: Math.max(1024, Number(preset.turnSummary.worldInfoMaxContext || state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext)),
                referenceContext: String(preset.turnSummary.referenceContext || ''),
                prompt: String(preset.turnSummary.prompt || state.turnSummary.prompt || defaultTurnSummaryPrompt),
                tablePrompt: String(preset.turnSummary.tablePrompt || state.turnSummary.tablePrompt || defaultTableEditPrompt),
            };
            if (preset.inlineGeneration) {
                state.inlineGeneration = mergeSharedInlineGenerationConfig(state.inlineGeneration, preset.inlineGeneration, defaultState.inlineGeneration);
                syncInlineGenerationPrompts(state);
            }
        } else if (scope === areaPresetScopes.INJECTION && preset.injection) {
            state.injection = {
                ...state.injection,
                enabled: preset.injection.enabled ?? state.injection.enabled,
                depth: Math.max(0, Number(preset.injection.depth ?? state.injection.depth)),
                role: Number(preset.injection.role ?? state.injection.role),
                template: String(preset.injection.template || state.injection.template || defaultInjectionTemplate),
            };
            syncInjection();
        } else if (scope === areaPresetScopes.VECTOR && preset.vectorMemory) {
            state.vectorMemory = {
                ...mergeSharedVectorConfig(state.vectorMemory, preset.vectorMemory, defaultVectorMemory),
                dirty: true,
                dirtyReason: '载入向量配置',
            };
            scheduleVectorAutoIndex('载入向量配置');
        }
        persistSharedConfigurationFromState(state);
        renderAreaPresetChange(scope, `已载入并同步到所有角色卡：${preset.name || '未命名配置'}`);
        toastr.success('配置已载入，并同步到所有角色卡。');
    }

    function saveAreaPreset(scope, name, options = {}) {
        const presets = getAreaPresets(scope);
        const replaceId = options.replaceId || '';
        const existing = replaceId ? presets.find(preset => preset.id === replaceId) : null;
        const preset = getAreaPresetPayload(scope, name);
        if (existing) {
            preset.id = existing.id;
            preset.createdAt = existing.createdAt || preset.createdAt;
            const index = presets.findIndex(item => item.id === existing.id);
            presets[index] = preset;
        } else {
            presets.push(preset);
        }
        setSelectedAreaPresetId(scope, preset.id);
        saveGlobalSettings();
        persistSharedConfigurationFromState(getState());
        renderAreaPresetChange(scope, existing ? `已覆盖并同步到所有角色卡：${preset.name}` : `已保存并同步到所有角色卡：${preset.name}`);
        toastr.success(existing ? '配置已覆盖，并同步到所有角色卡。' : '配置已保存，并同步到所有角色卡。');
        return preset;
    }

    return {
        applyAreaPresetToState,
        applyPromptPresetToState,
        getAreaPresetPayload,
        renderAreaPresetChange,
        saveAreaPreset,
        saveCurrentConfigPreset,
        usePromptPresetAsGlobalDefault,
    };
}
