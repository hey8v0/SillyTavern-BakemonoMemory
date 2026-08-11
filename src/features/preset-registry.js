export function createPresetRegistry({
    ensureGlobalSettings,
    extensionSettings,
    storageKey,
    saveGlobalSettings,
    defaultPromptPreset,
    defaultGenericPromptPreset,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    getHash,
    readActiveConfig,
    createSharedVectorConfig,
    createSharedInlineGenerationConfig,
    sharedConfigVersion,
    markActiveConfigApplied,
    shouldSyncActiveConfig,
    applyPromptPresetToState,
    saveState,
} = {}) {
    function getPromptPresets() {
        ensureGlobalSettings();
        return extensionSettings[storageKey].promptPresets;
    }
    
    function getSelectedPromptPresetId() {
        ensureGlobalSettings();
        return extensionSettings[storageKey].selectedPromptPresetId || defaultPromptPreset.id;
    }
    
    function setSelectedPromptPresetId(id) {
        ensureGlobalSettings();
        extensionSettings[storageKey].selectedPromptPresetId = id;
        saveGlobalSettings();
    }
    
    function getAreaPresets(scope) {
        ensureGlobalSettings();
        return extensionSettings[storageKey].areaPresets[scope] || [];
    }
    
    function getSelectedAreaPresetId(scope) {
        ensureGlobalSettings();
        return extensionSettings[storageKey].selectedAreaPresetIds[scope] || '';
    }
    
    function setSelectedAreaPresetId(scope, id) {
        ensureGlobalSettings();
        extensionSettings[storageKey].selectedAreaPresetIds[scope] = id || '';
        saveGlobalSettings();
    }
    
    function getTablePromptPresets() {
        ensureGlobalSettings();
        return extensionSettings[storageKey].tablePromptPresets || [];
    }
    
    function getSelectedTablePromptPresetId() {
        ensureGlobalSettings();
        return extensionSettings[storageKey].selectedTablePromptPresetId || getTablePromptPresets()[0]?.id || '';
    }
    
    function setSelectedTablePromptPresetId(id) {
        ensureGlobalSettings();
        extensionSettings[storageKey].selectedTablePromptPresetId = id || '';
        saveGlobalSettings();
    }
    
    function makeTablePromptPreset(name, prompt) {
        const now = new Date().toISOString();
        return {
            id: `table-prompt-${getHash(`${now}|${name || 'table'}`)}`,
            name: String(name || '未命名表格提示词'),
            prompt: String(prompt || defaultTableEditPrompt),
            createdAt: now,
            updatedAt: now,
        };
    }
    
    function getInlinePromptPresets(type) {
        ensureGlobalSettings();
        return (extensionSettings[storageKey].inlinePromptPresets || []).filter(preset => preset.type === type);
    }
    
    function getSelectedInlinePromptPresetId(type) {
        ensureGlobalSettings();
        const selected = extensionSettings[storageKey].selectedInlinePromptPresetIds || {};
        return selected[type] || getInlinePromptPresets(type)[0]?.id || '';
    }
    
    function setSelectedInlinePromptPresetId(type, id) {
        ensureGlobalSettings();
        if (!extensionSettings[storageKey].selectedInlinePromptPresetIds || typeof extensionSettings[storageKey].selectedInlinePromptPresetIds !== 'object') {
            extensionSettings[storageKey].selectedInlinePromptPresetIds = {};
        }
        extensionSettings[storageKey].selectedInlinePromptPresetIds[type] = id || '';
        saveGlobalSettings();
    }
    
    function makeInlinePromptPreset(type, name, prompt) {
        const now = new Date().toISOString();
        return {
            id: `inline-${type}-${getHash(`${now}|${name || type}`)}`,
            type,
            name: String(name || (type === 'summary' ? '未命名随正文摘要' : '未命名随正文填表')),
            prompt: String(prompt || (type === 'summary' ? defaultInlineSummaryPrompt : defaultInlineTablePrompt)),
            createdAt: now,
            updatedAt: now,
        };
    }
    
    function isBuiltInPresetId(id) {
        return id === defaultPromptPreset.id || id === defaultGenericPromptPreset.id;
    }
    
    function makePresetId(name) {
        return `preset-${getHash(`${Date.now()}|${name || 'prompt'}`)}`;
    }
    
    function getActiveGlobalConfig() {
        ensureGlobalSettings();
        return readActiveConfig(extensionSettings[storageKey]);
    }
    
    function setActiveGlobalConfig(preset) {
        ensureGlobalSettings();
        const settings = extensionSettings[storageKey];
        const presets = settings.promptPresets || [];
        const normalizedPreset = structuredClone(preset);
        if (normalizedPreset.vectorMemory) {
            normalizedPreset.vectorMemory = createSharedVectorConfig(normalizedPreset.vectorMemory);
        }
        if (normalizedPreset.inlineGeneration) {
            normalizedPreset.inlineGeneration = createSharedInlineGenerationConfig(normalizedPreset.inlineGeneration);
        }
        const config = {
            ...normalizedPreset,
            id: preset.id || makePresetId(preset.name || 'active'),
            name: preset.name || '未命名全局配置',
            updatedAt: new Date().toISOString(),
        };
        settings.activeConfig = config;
        settings.sharedConfigVersion = sharedConfigVersion;
        if (config.id && presets.some(item => item.id === config.id)) {
            settings.selectedPromptPresetId = config.id;
        }
        saveGlobalSettings();
        return config;
    }
    
    function applyGlobalActiveConfigToState(state) {
        const config = getActiveGlobalConfig();
        if (!config) {
            markActiveConfigApplied(state, null);
            return;
        }
        applyPromptPresetToState(config, {
            state,
            silent: true,
            skipScan: true,
            skipInjection: true,
            skipVectorSchedule: true,
            skipRender: true,
            skipSave: true,
        });
        markActiveConfigApplied(state, config);
    }
    
    function syncGlobalActiveConfigToState(state, options = {}) {
        const config = getActiveGlobalConfig();
        if (!shouldSyncActiveConfig(state, config, options)) {
            return false;
        }
        applyGlobalActiveConfigToState(state);
        if (!options.skipSave) {
            saveState();
        }
        return true;
    }
    
    function makeAreaPresetId(scope, name) {
        return `${scope}-${getHash(`${Date.now()}|${scope}|${name || 'preset'}`)}`;
    }

    return {
        applyGlobalActiveConfigToState,
        getActiveGlobalConfig,
        getAreaPresets,
        getInlinePromptPresets,
        getPromptPresets,
        getSelectedAreaPresetId,
        getSelectedInlinePromptPresetId,
        getSelectedPromptPresetId,
        getSelectedTablePromptPresetId,
        getTablePromptPresets,
        isBuiltInPresetId,
        makeAreaPresetId,
        makeInlinePromptPreset,
        makePresetId,
        makeTablePromptPreset,
        setActiveGlobalConfig,
        setSelectedAreaPresetId,
        setSelectedInlinePromptPresetId,
        setSelectedPromptPresetId,
        setSelectedTablePromptPresetId,
        syncGlobalActiveConfigToState,
    };
}
