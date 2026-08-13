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
    navigatorRef,
    defaultPromptPreset,
    getSelectedPromptPresetId,
    setSelectedPromptPresetId,
    getPromptPresets,
    usePromptPresetAsGlobalDefault,
    isBuiltInPresetId,
    saveCurrentConfigPreset,
    setActiveGlobalConfig,
    markActiveConfigApplied,
    saveState,
    getActiveGlobalConfig,
    applyGlobalActiveConfigToState,
    getCurrentPromptPresetPayload,
    normalizeImportedPreset,
    areaPresetScopes,
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

    function bindGlobalPresetControls() {
        query('#bakemono-memory-preset-select').off('change').on('change', function () {
            const previousId = getSelectedPromptPresetId();
            const selectedId = String(this.value || defaultPromptPreset.id);
            setSelectedPromptPresetId(selectedId);
            renderPromptPresetControls();
            const preset = getPromptPresets().find(item => item.id === selectedId);
            if (!preset) return;
            const confirmed = confirmDanger(
                `使用配置「${preset.name || '未命名配置'}」？`,
                ['会覆盖工作流、扫描、自动、提示词、注入和向量等设置，并同步到所有角色卡。', '摘要、草稿、表格行与向量索引不会跨聊天复制。'],
            );
            if (!confirmed) {
                setSelectedPromptPresetId(previousId);
                renderPromptPresetControls();
                return;
            }
            usePromptPresetAsGlobalDefault(preset);
        });
        query('#bakemono-memory-load-preset').off('click').on('click', () => {
            const preset = getPromptPresets().find(item => item.id === getSelectedPromptPresetId());
            if (!preset) {
                toastr.warning('没有找到选中的预设。');
                return;
            }
            const confirmed = confirmDanger(
                `使用并设为全局默认「${preset.name || '未命名预设'}」？`,
                ['会覆盖当前设置，并让所有角色卡在打开或切换时自动使用这套配置。'],
            );
            if (confirmed) usePromptPresetAsGlobalDefault(preset);
        });
        query('#bakemono-memory-save-preset').off('click').on('click', () => {
            const name = String(query('#bakemono-memory-preset-name').val() || '').trim();
            if (!name) {
                toastr.warning('请先填写预设名称。');
                return;
            }
            const selectedId = getSelectedPromptPresetId();
            const selected = getPromptPresets().find(preset => preset.id === selectedId);
            const preset = isBuiltInPresetId(selectedId) || !selected
                ? saveCurrentConfigPreset(name, { skipRender: true })
                : saveCurrentConfigPreset(name, { replaceId: selectedId, skipRender: true });
            const config = setActiveGlobalConfig(preset);
            markActiveConfigApplied(getState(), config);
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.CONFIG, isBuiltInPresetId(selectedId) || !selected ? `已另存并设为全局默认：${preset.name}` : `已覆盖并设为全局默认：${preset.name}`);
        });
        query('#bakemono-memory-save-as-preset').off('click').on('click', () => {
            const name = String(query('#bakemono-memory-preset-name').val() || '').trim();
            if (!name) {
                toastr.warning('请先填写预设名称。');
                return;
            }
            const preset = saveCurrentConfigPreset(name, { skipRender: true });
            const config = setActiveGlobalConfig(preset);
            markActiveConfigApplied(getState(), config);
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.CONFIG, `已另存并设为全局默认：${preset.name}`);
        });
        query('#bakemono-memory-delete-preset').off('click').on('click', () => {
            const selectedId = getSelectedPromptPresetId();
            if (isBuiltInPresetId(selectedId)) {
                toastr.warning('默认预设不能删除。');
                return;
            }
            const selected = getPromptPresets().find(preset => preset.id === selectedId);
            const confirmed = confirmDanger(
                `删除预设「${selected?.name || '未命名预设'}」？`,
                ['删除后不会影响已保存摘要，但这个预设无法从列表里恢复。'],
            );
            if (!confirmed) return;
            extensionSettings[storageKey].promptPresets = getPromptPresets().filter(preset => preset.id !== selectedId);
            if (getActiveGlobalConfig()?.id === selectedId) {
                const fallback = extensionSettings[storageKey].promptPresets.find(preset => preset.id === defaultPromptPreset.id)
                    || extensionSettings[storageKey].promptPresets[0]
                    || structuredClone(defaultPromptPreset);
                const config = setActiveGlobalConfig(fallback);
                applyGlobalActiveConfigToState(getState());
                markActiveConfigApplied(getState(), config);
                saveState();
            }
            setSelectedPromptPresetId(defaultPromptPreset.id);
            saveGlobalSettings();
            renderWorkbenchScope(workbenchRenderScopes.CONFIG, '预设已删除。');
        });
        query('#bakemono-memory-export-preset').off('click').on('click', () => {
            const selected = getPromptPresets().find(item => item.id === getSelectedPromptPresetId());
            const preset = getCurrentPromptPresetPayload(query('#bakemono-memory-preset-name').val() || selected?.name || '当前工作流');
            query('#bakemono-memory-preset-json').val(JSON.stringify(preset, null, 2));
            toastr.success('预设数据已写入导出框。');
        });
        query('#bakemono-memory-copy-preset').off('click').on('click', async () => {
            let value = String(query('#bakemono-memory-preset-json').val() || '');
            if (!value) {
                const selected = getPromptPresets().find(item => item.id === getSelectedPromptPresetId());
                const preset = getCurrentPromptPresetPayload(query('#bakemono-memory-preset-name').val() || selected?.name || '当前工作流');
                value = JSON.stringify(preset, null, 2);
                query('#bakemono-memory-preset-json').val(value);
            }
            await navigatorRef.clipboard.writeText(value);
            toastr.success('预设数据已复制。');
        });
        query('#bakemono-memory-import-preset').off('click').on('click', () => {
            try {
                const preset = normalizeImportedPreset(String(query('#bakemono-memory-preset-json').val() || ''));
                getPromptPresets().push(preset);
                setSelectedPromptPresetId(preset.id);
                saveGlobalSettings();
                renderWorkbenchScope(workbenchRenderScopes.CONFIG, `已导入预设：${preset.name}`);
                toastr.success('提示词预设已导入。');
            } catch (error) {
                toastr.error(error?.message || String(error), '导入失败');
            }
        });
    }

    function bind() {
        bindGlobalPresetControls();
        const areas = [
            [areaPresetScopes.SCAN, 'scan'],
            [areaPresetScopes.AUTOMATION, 'automation'],
            [areaPresetScopes.API, 'api'],
            [areaPresetScopes.PROMPTS, 'prompts'],
            [areaPresetScopes.TURN, 'turn'],
            [areaPresetScopes.INJECTION, 'injection'],
            [areaPresetScopes.VECTOR, 'vector'],
        ];
        for (const [scope, key] of areas) {
            bindAreaPresetControls(scope, {
                select: `#bakemono-memory-${key}-preset-select`,
                name: `#bakemono-memory-${key}-preset-name`,
                load: `#bakemono-memory-load-${key}-preset`,
                save: `#bakemono-memory-save-${key}-preset`,
                update: `#bakemono-memory-update-${key}-preset`,
                delete: `#bakemono-memory-delete-${key}-preset`,
            });
        }
        for (const type of ['summary', 'table']) {
            bindInlinePromptPresetControls(type, {
                select: `#bakemono-memory-inline-${type}-preset-select`,
                name: `#bakemono-memory-inline-${type}-preset-name`,
                load: `#bakemono-memory-load-inline-${type}-preset`,
                save: `#bakemono-memory-save-inline-${type}-preset`,
                update: `#bakemono-memory-update-inline-${type}-preset`,
                delete: `#bakemono-memory-delete-inline-${type}-preset`,
            });
        }
    }

    return { bind, bindAreaPresetControls, bindInlinePromptPresetControls, renderInlinePromptPresetControls };
}
