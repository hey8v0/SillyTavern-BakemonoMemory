export function createTableManagementEvents({
    query,
    getState,
    tableSchemaScopes,
    getTableProfileScopeLabel,
    confirmDanger,
    renderWorkbenchScope,
    workbenchRenderScopes,
    setTableSchemaScope,
    saveState,
    getTableSchemaScopeLabel,
    toastr,
    switchTableProfile,
    getActiveTableProfile,
    createTableProfileForCurrentScope,
    syncCurrentTableSchemas,
    saveGlobalSettings,
    deleteActiveTableProfile,
    saveCurrentTableProfileRows,
    loadActiveTableProfileRows,
    readTurnSummaryFieldsFromUi,
    syncInlineGenerationPrompts,
    persistSharedConfigurationFromState,
    updateInjectionFromSummaries,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    getSelectedTablePromptPresetId,
    setSelectedTablePromptPresetId,
    getTablePromptPresets,
    renderPromptPresetControls,
    makeTablePromptPreset,
    importTablesFromText,
    getScopedTableSchemas,
} = {}) {
    function bindProfileEvents() {
        query('#bakemono-memory-table-schema-scope').off('change').on('change', function () {
            const state = getState();
            const nextScope = String(this.value || tableSchemaScopes.CHAT);
            const confirmed = confirmDanger(
                `切换到${getTableProfileScopeLabel(nextScope)}表格作用域？`,
                ['当前表格行数据会先保存到原表格组，再载入目标作用域的当前表格组。'],
            );
            if (!confirmed) {
                renderWorkbenchScope(workbenchRenderScopes.TABLES);
                return;
            }
            setTableSchemaScope(nextScope, state);
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `表格框架已切换：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
            toastr.success(`已切换表格框架：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
        });
        query('#bakemono-memory-switch-table-profile').off('click').on('click', () => {
            const state = getState();
            const scope = state.tableDatabase.schemaScope || tableSchemaScopes.CHAT;
            const profileId = String(query('#bakemono-memory-table-profile-select').val() || '');
            if (switchTableProfile(scope, profileId, state)) {
                renderWorkbenchScope(workbenchRenderScopes.TABLES, `已切换表格组：${getActiveTableProfile(state)?.name || ''}`);
            }
        });
        query('#bakemono-memory-new-table-profile').off('click').on('click', () => {
            const state = getState();
            const name = String(query('#bakemono-memory-table-profile-name').val() || '').trim() || `表格组 ${new Date().toLocaleString()}`;
            const profile = createTableProfileForCurrentScope(name, state);
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已新建表格组：${profile.name}`);
            toastr.success('表格组已创建。');
        });
        query('#bakemono-memory-save-table-profile').off('click').on('click', () => {
            const state = getState();
            const profile = getActiveTableProfile(state);
            if (profile) {
                profile.name = String(query('#bakemono-memory-table-profile-name').val() || profile.name || '').trim() || profile.name;
            }
            syncCurrentTableSchemas(state);
            saveGlobalSettings();
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已保存表格组：${profile?.name || ''}`);
            toastr.success('表格组已保存。');
        });
        query('#bakemono-memory-delete-table-profile').off('click').on('click', () => {
            const state = getState();
            if (deleteActiveTableProfile(state)) {
                renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格组已删除。');
                toastr.success('表格组已删除。');
            }
        });
        query('#bakemono-memory-save-table-schema').off('click').on('click', () => {
            const state = getState();
            syncCurrentTableSchemas(state);
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `表格框架已保存：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
            toastr.success(`已保存表格框架：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
        });
        query('#bakemono-memory-load-table-schema').off('click').on('click', () => {
            const state = getState();
            saveCurrentTableProfileRows(state);
            loadActiveTableProfileRows(state);
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `表格框架已拉取：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
            toastr.success(`已拉取表格框架：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
        });
    }

    function bindPromptEvents() {
        query('#bakemono-memory-apply-turn-settings').off('click').on('click', () => {
            const state = getState();
            readTurnSummaryFieldsFromUi(state);
            syncInlineGenerationPrompts(state);
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.TABLES, '正文摘要设置已应用，并同步到所有角色卡。');
            toastr.success('正文摘要设置已全局保存。');
        });
        query('#bakemono-memory-table-inject-memory').off('change.bakemonoTableInjection').on('change.bakemonoTableInjection', function () {
            const state = getState();
            state.tableDatabase.injectMemory = !!this.checked;
            updateInjectionFromSummaries();
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.TABLES);
        });
        query('#bakemono-memory-reset-turn-prompt').off('click').on('click', () => {
            const confirmed = confirmDanger(
                '恢复默认正文摘要提示词？',
                ['当前正文摘要提示词会被默认模板覆盖。'],
            );
            if (!confirmed) return;
            const state = getState();
            state.turnSummary.prompt = defaultTurnSummaryPrompt;
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.TABLES, '正文摘要提示词已恢复默认。');
        });
        query('#bakemono-memory-reset-table-prompt').off('click').on('click', () => {
            const confirmed = confirmDanger(
                '恢复默认表格修改提示词？',
                ['当前表格修改提示词会被默认模板覆盖。'],
            );
            if (!confirmed) return;
            const state = getState();
            state.turnSummary.tablePrompt = defaultTableEditPrompt;
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格修改提示词已恢复默认。');
        });
        query('#bakemono-memory-table-preset-select').off('change').on('change', function () {
            const previousId = getSelectedTablePromptPresetId();
            const selectedId = String(this.value || '');
            setSelectedTablePromptPresetId(selectedId);
            const preset = getTablePromptPresets().find(item => item.id === selectedId);
            if (!preset) return;
            const confirmed = confirmDanger(`使用表格提示词「${preset.name}」？`, ['当前编辑框里的表格提示词会被覆盖。']);
            if (!confirmed) {
                setSelectedTablePromptPresetId(previousId);
                renderPromptPresetControls();
                return;
            }
            const state = getState();
            state.turnSummary.tablePrompt = preset.prompt || defaultTableEditPrompt;
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已使用并同步到所有角色卡的表格提示词：${preset.name}`);
        });
        query('#bakemono-memory-load-table-preset').off('click').on('click', () => {
            const preset = getTablePromptPresets().find(item => item.id === getSelectedTablePromptPresetId());
            if (!preset) {
                toastr.warning('没有找到表格提示词预设。');
                return;
            }
            const confirmed = confirmDanger(`载入表格提示词「${preset.name}」？`, ['当前编辑框里的表格提示词会被覆盖。']);
            if (!confirmed) return;
            const state = getState();
            state.turnSummary.tablePrompt = preset.prompt || defaultTableEditPrompt;
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已载入并同步到所有角色卡的表格提示词：${preset.name}`);
        });
        query('#bakemono-memory-save-table-preset').off('click').on('click', () => {
            const name = String(query('#bakemono-memory-table-preset-name').val() || '').trim();
            if (!name) {
                toastr.warning('请先填写表格提示词预设名称。');
                return;
            }
            let preset = getTablePromptPresets().find(item => item.id === getSelectedTablePromptPresetId());
            if (preset && preset.id !== 'default-table-prompt') {
                preset.name = name;
                preset.prompt = String(query('#bakemono-memory-table-prompt').val() || defaultTableEditPrompt);
                preset.updatedAt = new Date().toISOString();
            } else {
                preset = makeTablePromptPreset(name, query('#bakemono-memory-table-prompt').val());
                getTablePromptPresets().push(preset);
                setSelectedTablePromptPresetId(preset.id);
            }
            saveGlobalSettings();
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已保存表格提示词：${preset.name}`);
        });
        query('#bakemono-memory-update-table-preset').off('click').on('click', () => {
            const presets = getTablePromptPresets();
            const preset = presets.find(item => item.id === getSelectedTablePromptPresetId());
            if (!preset) {
                toastr.warning('没有找到表格提示词预设。');
                return;
            }
            if (preset.id === 'default-table-prompt') {
                toastr.warning('默认表格提示词不能覆盖，请另存为新预设。');
                return;
            }
            const confirmed = confirmDanger(`覆盖表格提示词「${preset.name}」？`, ['覆盖后无法自动恢复旧版本。']);
            if (!confirmed) return;
            preset.name = String(query('#bakemono-memory-table-preset-name').val() || preset.name || '').trim() || preset.name;
            preset.prompt = String(query('#bakemono-memory-table-prompt').val() || defaultTableEditPrompt);
            preset.updatedAt = new Date().toISOString();
            saveGlobalSettings();
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已覆盖表格提示词：${preset.name}`);
        });
        query('#bakemono-memory-delete-table-preset').off('click').on('click', () => {
            const presets = getTablePromptPresets();
            const preset = presets.find(item => item.id === getSelectedTablePromptPresetId());
            if (!preset) {
                toastr.warning('没有找到表格提示词预设。');
                return;
            }
            if (preset.id === 'default-table-prompt') {
                toastr.warning('默认表格提示词不能删除。');
                return;
            }
            const confirmed = confirmDanger(`删除表格提示词「${preset.name}」？`, ['删除后不能从预设列表恢复。']);
            if (!confirmed) return;
            const index = presets.findIndex(item => item.id === preset.id);
            if (index >= 0) presets.splice(index, 1);
            setSelectedTablePromptPresetId(presets[0]?.id || '');
            saveGlobalSettings();
            renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格提示词预设已删除。');
        });
    }

    function bindTransferEvents() {
        query('#bakemono-memory-pick-table-file').off('click').on('click', () => {
            query('#bakemono-memory-table-file').trigger('click');
        });
        query('#bakemono-memory-table-file').off('change').on('change', async function () {
            const file = this.files?.[0];
            if (!file) return;
            try {
                const raw = await file.text();
                query('#bakemono-memory-table-json').val(raw);
                importTablesFromText(raw, file.name || '本地文件');
            } catch (error) {
                toastr.error(`读取文件失败：${error?.message || error}`);
            } finally {
                this.value = '';
            }
        });
        query('#bakemono-memory-import-table-json').off('click').on('click', () => {
            importTablesFromText(query('#bakemono-memory-table-json').val(), '文本框');
        });
        query('#bakemono-memory-export-table-json').off('click').on('click', () => {
            const state = getState();
            query('#bakemono-memory-table-json').val(JSON.stringify({
                version: 1,
                tables: state.tableDatabase.tables || [],
            }, null, 2));
            toastr.success('当前表格已导出到文本框。');
        });
        query('#bakemono-memory-clear-table-db').off('click').on('click', () => {
            const state = getState();
            if (!state.tableDatabase.tables.length && !state.tableDatabase.editDrafts.length) {
                toastr.info('当前没有表格可清空。');
                return;
            }
            const confirmed = confirmDanger(
                '清空当前聊天的表格数据库？',
                ['这会删除表格结构、表格数据和未应用的表格草稿。摘要不会被删除。'],
            );
            if (!confirmed) return;
            state.tableDatabase.tables = [];
            state.tableDatabase.editDrafts = [];
            state.tableDatabase.history = [];
            if ((state.tableDatabase.schemaScope || tableSchemaScopes.CHAT) !== tableSchemaScopes.CHAT) {
                state.tableDatabase.tables = getScopedTableSchemas(state.tableDatabase.schemaScope).map(schema => ({ ...schema, rows: [] }));
            }
            saveCurrentTableProfileRows(state);
            updateInjectionFromSummaries();
            renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格数据库已清空。');
        });
    }

    function bind() {
        bindProfileEvents();
        bindPromptEvents();
        bindTransferEvents();
    }

    return { bind };
}
