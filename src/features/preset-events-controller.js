export function createPresetEventsController({
    query,
    documentRef,
    toastr,
    confirmDanger,
    extensionSettings,
    storageKey,
    getAreaPresets,
    getSelectedAreaPresetId,
    setSelectedAreaPresetId,
    renderPromptPresetControls,
    applyAreaPresetToState,
    saveAreaPreset,
    saveGlobalSettings,
    renderAreaPresetChange,
    getInlinePromptPresets,
    getSelectedInlinePromptPresetId,
    setSelectedInlinePromptPresetId,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    getState,
    syncInlineGenerationPrompts,
    persistSharedConfigurationFromState,
    makeInlinePromptPreset,
    renderWorkbenchScope,
    workbenchRenderScopes,
} = {}) {
    function renderInlinePromptPresetControls(type, selectSelector, nameSelector) {
        const select = documentRef.querySelector(selectSelector);
        if (!select) return;
        const presets = getInlinePromptPresets(type);
        select.innerHTML = '';
        for (const preset of presets) {
            const option = documentRef.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name || '未命名提示词';
            select.append(option);
        }
        select.value = getSelectedInlinePromptPresetId(type);
        const selected = presets.find(preset => preset.id === select.value);
        query(nameSelector).val(selected?.name || '');
    }

    function bindAreaPresetControls(scope, ids) {
        query(ids.select).off('change').on('change', function () {
            const previousId = getSelectedAreaPresetId(scope);
            const selectedId = String(this.value || '');
            setSelectedAreaPresetId(scope, selectedId);
            renderPromptPresetControls();
            if (!selectedId) return;
            const preset = getAreaPresets(scope).find(item => item.id === selectedId);
            if (!preset) return;
            const confirmed = confirmDanger(
                `使用配置「${preset.name || '未命名配置'}」？`,
                ['会立即应用这个区域，并作为所有角色卡共用的设置。'],
            );
            if (!confirmed) {
                setSelectedAreaPresetId(scope, previousId);
                renderPromptPresetControls();
                return;
            }
            applyAreaPresetToState(scope, preset);
        });
        query(ids.load).off('click').on('click', () => {
            const selectedId = getSelectedAreaPresetId(scope);
            const preset = getAreaPresets(scope).find(item => item.id === selectedId);
            if (!preset) {
                toastr.warning('请先选择已保存的配置。');
                return;
            }
            const confirmed = confirmDanger(
                `载入配置「${preset.name || '未命名配置'}」？`,
                ['只覆盖当前区域的设置，并同步到所有角色卡；其他区域保持不变。'],
            );
            if (confirmed) applyAreaPresetToState(scope, preset);
        });
        query(ids.save).off('click').on('click', () => {
            const name = String(query(ids.name).val() || '').trim();
            if (!name) {
                toastr.warning('请先填写配置名称。');
                return;
            }
            const selectedId = getSelectedAreaPresetId(scope);
            const selected = getAreaPresets(scope).find(item => item.id === selectedId);
            saveAreaPreset(scope, name, selected ? { replaceId: selectedId } : undefined);
        });
        query(ids.update).off('click').on('click', () => {
            const selectedId = getSelectedAreaPresetId(scope);
            const selected = getAreaPresets(scope).find(item => item.id === selectedId);
            if (!selected) {
                toastr.warning('请先选择要覆盖的配置。');
                return;
            }
            const name = String(query(ids.name).val() || selected.name || '').trim();
            if (!name) {
                toastr.warning('请先填写配置名称。');
                return;
            }
            const confirmed = confirmDanger(`覆盖配置「${selected.name || '未命名配置'}」？`, ['会用当前区域界面里的设置覆盖它。']);
            if (confirmed) saveAreaPreset(scope, name, { replaceId: selectedId });
        });
        query(ids.delete).off('click').on('click', () => {
            const selectedId = getSelectedAreaPresetId(scope);
            const selected = getAreaPresets(scope).find(item => item.id === selectedId);
            if (!selected) {
                toastr.warning('请先选择要删除的配置。');
                return;
            }
            const confirmed = confirmDanger(
                `删除配置「${selected.name || '未命名配置'}」？`,
                ['删除后无法从列表里恢复，但不会影响当前聊天已经应用的设置。'],
            );
            if (!confirmed) return;
            extensionSettings[storageKey].areaPresets[scope] = getAreaPresets(scope).filter(item => item.id !== selectedId);
            setSelectedAreaPresetId(scope, '');
            saveGlobalSettings();
            renderAreaPresetChange(scope, '配置已删除。');
        });
    }

    function renderInlinePromptPresetChange(statusText) {
        renderWorkbenchScope(workbenchRenderScopes.TABLES, statusText);
    }

    function bindInlinePromptPresetControls(type, ids) {
        const defaultId = type === 'summary' ? 'default-inline-summary' : 'default-inline-table';
        const promptSelector = type === 'summary' ? '#bakemono-memory-inline-summary-prompt' : '#bakemono-memory-inline-table-prompt';
        const defaultPrompt = type === 'summary' ? defaultInlineSummaryPrompt : defaultInlineTablePrompt;
        const label = type === 'summary' ? '随正文摘要提示词' : '随正文填表提示词';

        query(ids.select).off('change').on('change', function () {
            const previousId = getSelectedInlinePromptPresetId(type);
            const selectedId = String(this.value || '');
            setSelectedInlinePromptPresetId(type, selectedId);
            renderInlinePromptPresetControls(type, ids.select, ids.name);
            const preset = getInlinePromptPresets(type).find(item => item.id === selectedId);
            if (!preset) return;
            const confirmed = confirmDanger(`使用「${preset.name || '未命名'}」？`, ['当前编辑框里的提示词会被覆盖。']);
            if (!confirmed) {
                setSelectedInlinePromptPresetId(type, previousId);
                renderInlinePromptPresetControls(type, ids.select, ids.name);
                return;
            }
            const state = getState();
            if (type === 'summary') state.inlineGeneration.summaryPrompt = preset.prompt || defaultPrompt;
            else state.inlineGeneration.tablePrompt = preset.prompt || defaultPrompt;
            syncInlineGenerationPrompts(state);
            persistSharedConfigurationFromState(state);
            renderInlinePromptPresetChange(`已使用并同步到所有角色卡的${label}：${preset.name}`);
        });
        query(ids.load).off('click').on('click', () => {
            const preset = getInlinePromptPresets(type).find(item => item.id === getSelectedInlinePromptPresetId(type));
            if (!preset) {
                toastr.warning(`请先选择${label}预设。`);
                return;
            }
            const confirmed = confirmDanger(`载入「${preset.name || '未命名'}」？`, ['当前编辑框里的提示词会被覆盖。']);
            if (!confirmed) return;
            const state = getState();
            if (type === 'summary') state.inlineGeneration.summaryPrompt = preset.prompt || defaultPrompt;
            else state.inlineGeneration.tablePrompt = preset.prompt || defaultPrompt;
            syncInlineGenerationPrompts(state);
            persistSharedConfigurationFromState(state);
            renderInlinePromptPresetChange(`已载入并同步到所有角色卡的${label}：${preset.name}`);
        });
        query(ids.save).off('click').on('click', () => {
            const name = String(query(ids.name).val() || '').trim();
            if (!name) {
                toastr.warning('请先填写预设名称。');
                return;
            }
            let preset = getInlinePromptPresets(type).find(item => item.id === getSelectedInlinePromptPresetId(type));
            if (preset && preset.id !== defaultId) {
                preset.name = name;
                preset.prompt = String(query(promptSelector).val() || defaultPrompt);
                preset.updatedAt = new Date().toISOString();
            } else {
                preset = makeInlinePromptPreset(type, name, query(promptSelector).val());
                extensionSettings[storageKey].inlinePromptPresets.push(preset);
                setSelectedInlinePromptPresetId(type, preset.id);
            }
            saveGlobalSettings();
            renderInlinePromptPresetChange(`已保存${label}：${preset.name}`);
        });
        query(ids.update).off('click').on('click', () => {
            const preset = getInlinePromptPresets(type).find(item => item.id === getSelectedInlinePromptPresetId(type));
            if (!preset) {
                toastr.warning(`请先选择${label}预设。`);
                return;
            }
            if (preset.id === defaultId) {
                toastr.warning('默认预设不能覆盖，请另存为新预设。');
                return;
            }
            const confirmed = confirmDanger(`覆盖「${preset.name || '未命名'}」？`, ['覆盖后无法自动恢复旧版本。']);
            if (!confirmed) return;
            preset.name = String(query(ids.name).val() || preset.name || '').trim() || preset.name;
            preset.prompt = String(query(promptSelector).val() || defaultPrompt);
            preset.updatedAt = new Date().toISOString();
            saveGlobalSettings();
            renderInlinePromptPresetChange(`已覆盖${label}：${preset.name}`);
        });
        query(ids.delete).off('click').on('click', () => {
            const preset = getInlinePromptPresets(type).find(item => item.id === getSelectedInlinePromptPresetId(type));
            if (!preset) {
                toastr.warning(`请先选择${label}预设。`);
                return;
            }
            if (preset.id === defaultId) {
                toastr.warning('默认预设不能删除。');
                return;
            }
            const confirmed = confirmDanger(`删除「${preset.name || '未命名'}」？`, ['删除后不能从预设列表恢复。']);
            if (!confirmed) return;
            extensionSettings[storageKey].inlinePromptPresets = (extensionSettings[storageKey].inlinePromptPresets || []).filter(item => item.id !== preset.id);
            setSelectedInlinePromptPresetId(type, getInlinePromptPresets(type)[0]?.id || '');
            saveGlobalSettings();
            renderInlinePromptPresetChange(`${label}预设已删除。`);
        });
    }

    return { bindAreaPresetControls, bindInlinePromptPresetControls, renderInlinePromptPresetControls };
}
