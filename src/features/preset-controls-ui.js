export function createPresetControlsUi({
    documentRef,
    query,
    areaPresetScopes,
    getSelectedPromptPresetId,
    getPromptPresets,
    getActiveGlobalConfig,
    getSelectedAreaPresetId,
    getAreaPresets,
    unique,
}) {
    function renderPresetControlPair(selectSelector, nameSelector) {
        const select = documentRef.querySelector(selectSelector);
        if (!select) return;
        const selectedId = getSelectedPromptPresetId();
        const presets = getPromptPresets();
        select.innerHTML = '';
        for (const preset of presets) {
            const option = documentRef.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name || '未命名预设';
            select.append(option);
        }
        select.value = presets.some(preset => preset.id === selectedId) ? selectedId : (presets[0]?.id || '');
        const selected = presets.find(preset => preset.id === select.value);
        query(nameSelector).val(selected?.name || '');
        const active = getActiveGlobalConfig();
        query('#bakemono-memory-active-config-status').text(
            `当前共用设置：“${active?.name || '未设置'}”。所有角色卡在打开或切换时自动同步；剧情摘要、草稿、表格行和向量索引仍按聊天单独保存。`,
        );
    }

    function renderAreaPresetControl(scope, selectSelector, nameSelector) {
        const select = documentRef.querySelector(selectSelector);
        if (!select) return;
        const selectedId = getSelectedAreaPresetId(scope);
        select.innerHTML = '';
        const placeholder = documentRef.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '选择已保存配置';
        select.append(placeholder);
        for (const preset of getAreaPresets(scope)) {
            const option = documentRef.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name || '未命名配置';
            select.append(option);
        }
        select.value = selectedId;
        const selected = getAreaPresets(scope).find(preset => preset.id === select.value);
        query(nameSelector).val(selected?.name || '');
    }

    function renderAll() {
        renderPresetControlPair('#bakemono-memory-preset-select', '#bakemono-memory-preset-name');
        renderAreaPresetControl(areaPresetScopes.SCAN, '#bakemono-memory-scan-preset-select', '#bakemono-memory-scan-preset-name');
        renderAreaPresetControl(areaPresetScopes.AUTOMATION, '#bakemono-memory-automation-preset-select', '#bakemono-memory-automation-preset-name');
        renderAreaPresetControl(areaPresetScopes.API, '#bakemono-memory-api-preset-select', '#bakemono-memory-api-preset-name');
        renderAreaPresetControl(areaPresetScopes.PROMPTS, '#bakemono-memory-prompts-preset-select', '#bakemono-memory-prompts-preset-name');
        renderAreaPresetControl(areaPresetScopes.TURN, '#bakemono-memory-turn-preset-select', '#bakemono-memory-turn-preset-name');
        renderAreaPresetControl(areaPresetScopes.INJECTION, '#bakemono-memory-injection-preset-select', '#bakemono-memory-injection-preset-name');
        renderAreaPresetControl(areaPresetScopes.VECTOR, '#bakemono-memory-vector-preset-select', '#bakemono-memory-vector-preset-name');
    }

    function renderCustomModelOptions(models = []) {
        const list = documentRef.querySelector('#bakemono-memory-custom-model-options');
        if (!list) return;
        list.innerHTML = '';
        for (const model of unique(models.map(item => String(item || '').trim()).filter(Boolean)).sort()) {
            const option = documentRef.createElement('option');
            option.value = model;
            list.append(option);
        }
    }

    return { renderAll, renderAreaPresetControl, renderCustomModelOptions, renderPresetControlPair };
}
