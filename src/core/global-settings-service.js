export function createGlobalSettingsService({
    extensionSettings,
    storageKey,
    sanitizeCustomTheme,
    normalizeCustomThemePreset,
    builtInCustomThemeDefinitions,
    defaultPromptPreset,
    defaultGenericPromptPreset,
    migrateBuiltInInjectionDefaults,
    legacyInjectionTemplate,
    defaultInjectionTemplate,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    migratePromptPresetTimelines,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    migrateStagePromptTimeSpan,
    migrateEpicPromptTimeSpan,
    defaultGenericStoryGenerationPrompt,
    defaultGenericStageGenerationPrompt,
    defaultGenericEpicGenerationPrompt,
    createSharedVectorConfig,
    createSharedInlineGenerationConfig,
    areaPresetScopes,
    tableSchemaScopes,
    createTableProfile,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
} = {}) {
    function ensureGlobalSettings() {
        if (!extensionSettings[storageKey]) {
            extensionSettings[storageKey] = {};
        }
        const settings = extensionSettings[storageKey];
        if (!settings.ui || typeof settings.ui !== 'object') {
            settings.ui = {};
        }
        if (settings.ui.showTopNavButton === undefined) {
            settings.ui.showTopNavButton = false;
        }
        if (!['tavern', 'custom'].includes(settings.ui.themeMode)) {
            settings.ui.themeMode = 'tavern';
        }
        const storedCustomTheme = settings.ui.customTheme && typeof settings.ui.customTheme === 'object'
            ? structuredClone(settings.ui.customTheme)
            : null;
        settings.ui.customTheme = sanitizeCustomTheme(settings.ui.customTheme);
        settings.ui.themePresets = Array.isArray(settings.ui.themePresets)
            ? settings.ui.themePresets.map(normalizeCustomThemePreset)
            : storedCustomTheme
                ? [normalizeCustomThemePreset({ ...storedCustomTheme, id: storedCustomTheme.id || 'bakemono-legacy-custom-theme' })]
                : [];
        for (const builtInTheme of [...builtInCustomThemeDefinitions].reverse()) {
            if (!settings.ui.themePresets.some(preset => preset.id === builtInTheme.id)) {
                settings.ui.themePresets.unshift(normalizeCustomThemePreset(builtInTheme));
            }
        }
        if (!settings.ui.selectedThemePresetId || !settings.ui.themePresets.some(preset => preset.id === settings.ui.selectedThemePresetId)) {
            settings.ui.selectedThemePresetId = 'bakemono-warm-paper-day';
        }
        if (!Array.isArray(extensionSettings[storageKey].promptPresets)) {
            extensionSettings[storageKey].promptPresets = [structuredClone(defaultPromptPreset), structuredClone(defaultGenericPromptPreset)];
        }
        if (!extensionSettings[storageKey].promptPresets.some(preset => preset.id === defaultPromptPreset.id)) {
            extensionSettings[storageKey].promptPresets.unshift(structuredClone(defaultPromptPreset));
        }
        if (!extensionSettings[storageKey].promptPresets.some(preset => preset.id === defaultGenericPromptPreset.id)) {
            extensionSettings[storageKey].promptPresets.push(structuredClone(defaultGenericPromptPreset));
        }
        for (const preset of extensionSettings[storageKey].promptPresets) {
            migrateBuiltInInjectionDefaults(preset.injection, legacyInjectionTemplate, defaultInjectionTemplate);
            if (preset.story === undefined) {
                preset.story = defaultStoryGenerationPrompt;
            }
            if (preset.missing === undefined) {
                preset.missing = defaultMissingSummaryPrompt;
            }
            migratePromptPresetTimelines(preset, {
                stage: defaultStageGenerationPrompt,
                epic: defaultEpicGenerationPrompt,
            }, {
                migrateStagePromptTimeSpan,
                migrateEpicPromptTimeSpan,
            });
            if (preset.id === defaultGenericPromptPreset.id) {
                preset.story = defaultGenericStoryGenerationPrompt;
                preset.missing = defaultMissingSummaryPrompt;
                preset.stage = defaultGenericStageGenerationPrompt;
                preset.epic = defaultGenericEpicGenerationPrompt;
                preset.scanRules = structuredClone(defaultGenericPromptPreset.scanRules);
                preset.classificationRules = structuredClone(defaultGenericPromptPreset.classificationRules);
                preset.previewLayouts = structuredClone(defaultGenericPromptPreset.previewLayouts);
                preset.automation = structuredClone(defaultGenericPromptPreset.automation);
                preset.outputMode = defaultGenericPromptPreset.outputMode;
                preset.memoryStrategy = defaultGenericPromptPreset.memoryStrategy;
                preset.workflowMode = defaultGenericPromptPreset.workflowMode;
                preset.stageSourceMode = defaultGenericPromptPreset.stageSourceMode;
            }
            if (preset.id === defaultPromptPreset.id) {
                preset.story = defaultStoryGenerationPrompt;
                preset.missing = defaultMissingSummaryPrompt;
                preset.stage = defaultStageGenerationPrompt;
                preset.epic = defaultEpicGenerationPrompt;
                preset.memoryStrategy = defaultPromptPreset.memoryStrategy;
                preset.scanRules = structuredClone(defaultPromptPreset.scanRules);
                preset.outputMode = defaultPromptPreset.outputMode;
                preset.workflowMode = defaultPromptPreset.workflowMode;
                preset.stageSourceMode = defaultPromptPreset.stageSourceMode;
            }
        }
        if (!extensionSettings[storageKey].selectedPromptPresetId) {
            extensionSettings[storageKey].selectedPromptPresetId = defaultPromptPreset.id;
        }
        if (!settings.activeConfig || typeof settings.activeConfig !== 'object') {
            const selectedPreset = extensionSettings[storageKey].promptPresets.find(preset => preset.id === extensionSettings[storageKey].selectedPromptPresetId)
                || structuredClone(defaultPromptPreset);
            settings.activeConfig = {
                ...structuredClone(selectedPreset),
                id: selectedPreset.id || defaultPromptPreset.id,
                name: selectedPreset.name || '默认摘要手账',
                updatedAt: new Date().toISOString(),
            };
        }
        if (settings.activeConfig.vectorMemory) {
            settings.activeConfig.vectorMemory = createSharedVectorConfig(settings.activeConfig.vectorMemory);
        }
        if (settings.activeConfig.inlineGeneration) {
            settings.activeConfig.inlineGeneration = createSharedInlineGenerationConfig(settings.activeConfig.inlineGeneration);
        }
        migrateBuiltInInjectionDefaults(settings.activeConfig.injection, legacyInjectionTemplate, defaultInjectionTemplate);
        if (!extensionSettings[storageKey].areaPresets || typeof extensionSettings[storageKey].areaPresets !== 'object') {
            extensionSettings[storageKey].areaPresets = {};
        }
        for (const scope of Object.values(areaPresetScopes)) {
            if (!Array.isArray(extensionSettings[storageKey].areaPresets[scope])) {
                extensionSettings[storageKey].areaPresets[scope] = [];
            }
        }
        for (const preset of extensionSettings[storageKey].areaPresets[areaPresetScopes.INJECTION]) {
            migrateBuiltInInjectionDefaults(preset.injection, legacyInjectionTemplate, defaultInjectionTemplate);
        }
        if (!extensionSettings[storageKey].selectedAreaPresetIds || typeof extensionSettings[storageKey].selectedAreaPresetIds !== 'object') {
            extensionSettings[storageKey].selectedAreaPresetIds = {};
        }
        if (!Object.values(tableSchemaScopes).includes(settings.defaultTableSchemaScope)) {
            settings.defaultTableSchemaScope = tableSchemaScopes.CHAT;
        }
        if (!settings.tableSchemaLibrary || typeof settings.tableSchemaLibrary !== 'object') {
            settings.tableSchemaLibrary = { global: [], characters: {} };
        }
        if (!Array.isArray(settings.tableSchemaLibrary.global)) {
            settings.tableSchemaLibrary.global = [];
        }
        if (!settings.tableSchemaLibrary.characters || typeof settings.tableSchemaLibrary.characters !== 'object') {
            settings.tableSchemaLibrary.characters = {};
        }
        if (!settings.tableProfileLibrary || typeof settings.tableProfileLibrary !== 'object') {
            settings.tableProfileLibrary = { global: [], characters: {}, selectedGlobalProfileId: '', selectedCharacterProfileIds: {} };
        }
        if (!Array.isArray(settings.tableProfileLibrary.global)) {
            settings.tableProfileLibrary.global = [];
        }
        if (!settings.tableProfileLibrary.characters || typeof settings.tableProfileLibrary.characters !== 'object') {
            settings.tableProfileLibrary.characters = {};
        }
        if (!settings.tableProfileLibrary.selectedCharacterProfileIds || typeof settings.tableProfileLibrary.selectedCharacterProfileIds !== 'object') {
            settings.tableProfileLibrary.selectedCharacterProfileIds = {};
        }
        if (!settings.tableProfileLibrary.global.length && settings.tableSchemaLibrary.global.length) {
            settings.tableProfileLibrary.global.push(createTableProfile('全局默认表格', settings.tableSchemaLibrary.global));
        }
        for (const [characterKey, schemas] of Object.entries(settings.tableSchemaLibrary.characters || {})) {
            if (Array.isArray(schemas) && schemas.length && !Array.isArray(settings.tableProfileLibrary.characters[characterKey])) {
                settings.tableProfileLibrary.characters[characterKey] = [createTableProfile('角色默认表格', schemas)];
            }
        }
        if (!Array.isArray(settings.tablePromptPresets)) {
            settings.tablePromptPresets = [{
                id: 'default-table-prompt',
                name: '默认表格修改提示词',
                prompt: defaultTableEditPrompt,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }];
        }
        if (!settings.selectedTablePromptPresetId) {
            settings.selectedTablePromptPresetId = settings.tablePromptPresets[0]?.id || '';
        }
        if (!Array.isArray(settings.inlinePromptPresets)) {
            settings.inlinePromptPresets = [
                {
                    id: 'default-inline-summary',
                    type: 'summary',
                    name: '默认随正文摘要',
                    prompt: defaultInlineSummaryPrompt,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
                {
                    id: 'default-inline-table',
                    type: 'table',
                    name: '默认随正文填表',
                    prompt: defaultInlineTablePrompt,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ];
        }
        const defaultInlineSummaryPreset = settings.inlinePromptPresets.find(preset => preset.id === 'default-inline-summary');
        if (defaultInlineSummaryPreset && defaultInlineSummaryPreset.prompt !== defaultInlineSummaryPrompt) {
            defaultInlineSummaryPreset.prompt = defaultInlineSummaryPrompt;
            defaultInlineSummaryPreset.updatedAt = new Date().toISOString();
        }
        if (!settings.selectedInlinePromptPresetIds || typeof settings.selectedInlinePromptPresetIds !== 'object') {
            settings.selectedInlinePromptPresetIds = {};
        }
        if (!settings.selectedInlinePromptPresetIds.summary) {
            settings.selectedInlinePromptPresetIds.summary = settings.inlinePromptPresets.find(preset => preset.type === 'summary')?.id || '';
        }
        if (!settings.selectedInlinePromptPresetIds.table) {
            settings.selectedInlinePromptPresetIds.table = settings.inlinePromptPresets.find(preset => preset.type === 'table')?.id || '';
        }
    }

    return { ensureGlobalSettings };
}
