export function createTableStateService({
    tableSchemaScopes,
    getContext,
    ensureGlobalSettings,
    extensionSettings,
    storageKey,
    getChatState,
    getHash,
    normalizeTableSchemas,
    getState: ensureState,
    saveGlobalSettings,
    findMatchingTable,
    mergeTableSchemaWithRows,
    updateInjectionFromSummaries,
    saveState,
    getFiniteMessageIds,
    toastr,
    confirmDanger,
    renderWorkbenchScope,
    workbenchRenderScopes,
    buildTableRollbackPlan,
    scheduleRenderAll,
    baseStoryLedgerPreset,
    createBaseStoryLedgerTables,
} = {}) {
    function getTableSchemaScopeLabel(scope) {
        if (scope === tableSchemaScopes.GLOBAL) return '全局表格框架';
        if (scope === tableSchemaScopes.CHARACTER) return '当前角色表格框架';
        return '当前聊天表格';
    }
    
    function getTableProfileScopeLabel(scope) {
        if (scope === tableSchemaScopes.GLOBAL) return '全局';
        if (scope === tableSchemaScopes.CHARACTER) return '当前角色';
        return '当前聊天';
    }
    
    function getCurrentCharacterSchemaKey() {
        const context = getContext();
        const character = context.characters?.[context.characterId] || {};
        return String(character.avatar || character.name || context.characterId || context.name2 || 'unknown-character');
    }
    
    function getCurrentCharacterSchemaLabel() {
        const context = getContext();
        const character = context.characters?.[context.characterId] || {};
        return String(character.name || context.name2 || getCurrentCharacterSchemaKey());
    }
    
    function getTableSchemaLibrary() {
        ensureGlobalSettings();
        return extensionSettings[storageKey].tableSchemaLibrary;
    }
    
    function createTableProfile(name = '未命名表格组', tables = []) {
        const now = new Date().toISOString();
        return {
            id: `table-profile-${getHash(`${now}|${name}|${Math.random()}`)}`,
            name: String(name || '未命名表格组'),
            tables: normalizeTableSchemas(tables),
            createdAt: now,
            updatedAt: now,
        };
    }
    
    function getScopedTableSchemas(scope = tableSchemaScopes.CHAT, state = getChatState()) {
        if (!state?.tableDatabase) {
            return [];
        }
        return normalizeTableSchemas(getActiveTableProfile(state)?.tables || state.tableDatabase.tables || []);
    }
    
    function saveScopedTableSchemas(tables = [], scope = tableSchemaScopes.CHAT) {
        const schemas = normalizeTableSchemas(tables);
        const state = ensureState();
        if (scope === tableSchemaScopes.CHAT) {
            const profiles = ensureChatTableProfiles(state);
            const profile = profiles.find(item => item.id === state.tableDatabase.activeProfileId) || profiles[0];
            if (profile) {
                profile.tables = schemas;
                profile.updatedAt = new Date().toISOString();
            }
            return;
        }
        const library = getTableProfileLibrary();
        if (scope === tableSchemaScopes.GLOBAL) {
            const profile = getActiveTableProfile(state);
            if (profile) {
                profile.tables = schemas;
                profile.updatedAt = new Date().toISOString();
            }
        } else if (scope === tableSchemaScopes.CHARACTER) {
            const key = getCurrentCharacterSchemaKey();
            const profile = getActiveTableProfile(state);
            if (profile) {
                if (!Array.isArray(library.characters[key])) {
                    library.characters[key] = [];
                }
                const index = library.characters[key].findIndex(item => item.id === profile.id);
                if (index >= 0) {
                    library.characters[key][index] = { ...profile, tables: schemas, updatedAt: new Date().toISOString() };
                }
            }
        }
        saveGlobalSettings();
    }
    
    function getTableProfileLibrary() {
        ensureGlobalSettings();
        return extensionSettings[storageKey].tableProfileLibrary;
    }
    
    function ensureChatTableProfiles(state = ensureState()) {
        state.tableDatabase.chatProfiles = Array.isArray(state.tableDatabase.chatProfiles) ? state.tableDatabase.chatProfiles : [];
        if (!state.tableDatabase.chatProfiles.length) {
            state.tableDatabase.chatProfiles.push(createTableProfile('当前聊天默认表格', state.tableDatabase.tables || []));
        }
        if (!state.tableDatabase.activeProfileId) {
            state.tableDatabase.activeProfileId = state.tableDatabase.chatProfiles[0]?.id || '';
        }
        return state.tableDatabase.chatProfiles;
    }
    
    function getTableProfilesForScope(scope = tableSchemaScopes.CHAT, state = ensureState()) {
        if (scope === tableSchemaScopes.CHAT) {
            return ensureChatTableProfiles(state);
        }
        const library = getTableProfileLibrary();
        if (scope === tableSchemaScopes.GLOBAL) {
            return library.global;
        }
        const key = getCurrentCharacterSchemaKey();
        if (!Array.isArray(library.characters[key])) {
            library.characters[key] = [];
        }
        return library.characters[key];
    }
    
    function ensureTableProfileForScope(scope = tableSchemaScopes.CHAT, state = ensureState()) {
        const profiles = getTableProfilesForScope(scope, state);
        if (!profiles.length) {
            profiles.push(createTableProfile(`${getTableProfileScopeLabel(scope)}默认表格`, state.tableDatabase.tables || []));
        }
        if (!state.tableDatabase.activeProfileId || !profiles.some(profile => profile.id === state.tableDatabase.activeProfileId)) {
            state.tableDatabase.activeProfileId = profiles[0]?.id || '';
        }
        return profiles.find(profile => profile.id === state.tableDatabase.activeProfileId) || profiles[0] || null;
    }
    
    function getActiveTableProfile(state = ensureState()) {
        const scope = state.tableDatabase?.schemaScope || tableSchemaScopes.CHAT;
        return ensureTableProfileForScope(scope, state);
    }
    
    function getActiveTableProfileKey(state = ensureState()) {
        const scope = state.tableDatabase?.schemaScope || tableSchemaScopes.CHAT;
        const profile = getActiveTableProfile(state);
        return `${scope}:${scope === tableSchemaScopes.CHARACTER ? getCurrentCharacterSchemaKey() : 'default'}:${profile?.id || 'default'}`;
    }
    
    function saveCurrentTableProfileRows(state = ensureState()) {
        state.tableDatabase.profileRows = state.tableDatabase.profileRows && typeof state.tableDatabase.profileRows === 'object'
            ? state.tableDatabase.profileRows
            : {};
        state.tableDatabase.profileRows[getActiveTableProfileKey(state)] = structuredClone(state.tableDatabase.tables || []);
    }
    
    function loadActiveTableProfileRows(state = ensureState()) {
        const profile = getActiveTableProfile(state);
        const key = getActiveTableProfileKey(state);
        const savedTables = state.tableDatabase.profileRows?.[key] || [];
        const schemas = normalizeTableSchemas(profile?.tables || []);
        state.tableDatabase.tables = schemas.map(schema => mergeTableSchemaWithRows(schema, findMatchingTable(schema, savedTables)));
    }
    
    function mergeScopedTableSchemasIntoState(state) {
        const scope = state?.tableDatabase?.schemaScope || tableSchemaScopes.CHAT;
        const schemas = getScopedTableSchemas(scope, state);
        if (!schemas.length) {
            return;
        }
        const currentTables = Array.isArray(state.tableDatabase.tables) ? state.tableDatabase.tables : [];
        const merged = schemas.map(schema => mergeTableSchemaWithRows(schema, findMatchingTable(schema, currentTables)));
        const extraLocalTables = currentTables.filter(table => !schemas.some(schema => findMatchingTable(schema, [table])));
        state.tableDatabase.tables = [...merged, ...extraLocalTables];
    }
    
    function setTableSchemaScope(scope, state = ensureState()) {
        const nextScope = Object.values(tableSchemaScopes).includes(scope) ? scope : tableSchemaScopes.CHAT;
        const previousScope = state.tableDatabase.schemaScope || tableSchemaScopes.CHAT;
        saveCurrentTableProfileRows(state);
        state.tableDatabase.schemaScope = nextScope;
        ensureGlobalSettings();
        extensionSettings[storageKey].defaultTableSchemaScope = nextScope;
        ensureTableProfileForScope(nextScope, state);
        loadActiveTableProfileRows(state);
        if (previousScope !== nextScope) {
            saveGlobalSettings();
        }
    }
    
    function syncCurrentTableSchemas(state = ensureState()) {
        const scope = state.tableDatabase?.schemaScope || tableSchemaScopes.CHAT;
        saveCurrentTableProfileRows(state);
        saveScopedTableSchemas(state.tableDatabase?.tables || [], scope);
    }
    
    function persistCurrentTableDatabase(state = ensureState()) {
        syncCurrentTableSchemas(state);
        updateInjectionFromSummaries();
        saveState();
        if ([tableSchemaScopes.GLOBAL, tableSchemaScopes.CHARACTER].includes(state.tableDatabase?.schemaScope)) {
            saveGlobalSettings();
        }
    }
    
    function pushTableUndoSnapshot(label = '表格操作', state = ensureState(), options = {}) {
        state.tableDatabase.undoStack = Array.isArray(state.tableDatabase.undoStack) ? state.tableDatabase.undoStack : [];
        const snapshot = {
            id: `table-undo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            label: String(label || '表格操作'),
            createdAt: new Date().toISOString(),
            schemaScope: state.tableDatabase.schemaScope || tableSchemaScopes.CHAT,
            activeProfileId: state.tableDatabase.activeProfileId || '',
            profileKey: getActiveTableProfileKey(state),
            sourceMessageIds: getFiniteMessageIds(options.sourceMessageIds || []),
            tables: structuredClone(state.tableDatabase.tables || []),
        };
        state.tableDatabase.undoStack.unshift(snapshot);
        state.tableDatabase.undoStack = state.tableDatabase.undoStack.slice(0, 20);
        if (options.clearRedo !== false) {
            state.tableDatabase.redoStack = [];
        }
        return snapshot;
    }
    
    function undoLastTableOperation(state = ensureState()) {
        state.tableDatabase.undoStack = Array.isArray(state.tableDatabase.undoStack) ? state.tableDatabase.undoStack : [];
        const snapshot = state.tableDatabase.undoStack[0];
        if (!snapshot) {
            toastr.info('没有可撤销的表格操作。');
            return false;
        }
        const confirmed = confirmDanger(
            `撤销上次表格操作「${snapshot.label || '表格操作'}」？`,
            [
                snapshot.createdAt ? `记录时间：${new Date(snapshot.createdAt).toLocaleString()}` : '',
                '这会把当前表格恢复到该操作之前的状态。',
            ],
        );
        if (!confirmed) {
            return false;
        }
        state.tableDatabase.undoStack.shift();
        state.tableDatabase.redoStack = Array.isArray(state.tableDatabase.redoStack) ? state.tableDatabase.redoStack : [];
        state.tableDatabase.redoStack.unshift({
            ...snapshot,
            redoTables: structuredClone(state.tableDatabase.tables || []),
            undoneAt: new Date().toISOString(),
        });
        state.tableDatabase.redoStack = state.tableDatabase.redoStack.slice(0, 20);
        state.tableDatabase.tables = structuredClone(snapshot.tables || []);
        persistCurrentTableDatabase(state);
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已撤销表格操作：${snapshot.label || '表格操作'}`);
        toastr.success('已撤销上次表格操作。');
        return true;
    }
    
    function redoLastTableOperation(state = ensureState()) {
        state.tableDatabase.redoStack = Array.isArray(state.tableDatabase.redoStack) ? state.tableDatabase.redoStack : [];
        const snapshot = state.tableDatabase.redoStack[0];
        if (!snapshot) {
            toastr.info('没有可重做的表格操作。');
            return false;
        }
        const confirmed = confirmDanger(
            `重做表格操作「${snapshot.label || '表格操作'}」？`,
            [
                snapshot.undoneAt ? `撤销时间：${new Date(snapshot.undoneAt).toLocaleString()}` : '',
                '这会把表格恢复到撤销前的状态。',
            ],
        );
        if (!confirmed) {
            return false;
        }
        state.tableDatabase.redoStack.shift();
        state.tableDatabase.undoStack = Array.isArray(state.tableDatabase.undoStack) ? state.tableDatabase.undoStack : [];
        state.tableDatabase.undoStack.unshift({
            ...snapshot,
            redoTables: undefined,
            redoneAt: new Date().toISOString(),
        });
        state.tableDatabase.undoStack = state.tableDatabase.undoStack.slice(0, 20);
        state.tableDatabase.tables = structuredClone(snapshot.redoTables || []);
        persistCurrentTableDatabase(state);
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已重做表格操作：${snapshot.label || '表格操作'}`);
        toastr.success('已重做上次表格操作。');
        return true;
    }
    
    function getAppliedTableHistoriesForMessage(messageId, state = ensureState()) {
        const id = Number(messageId);
        if (!Number.isFinite(id)) {
            return [];
        }
        return (state.tableDatabase.history || []).filter(item => (
            item?.appliedAt && getFiniteMessageIds(item.sourceMessageIds || []).includes(id)
        ));
    }
    
    function hasAppliedTableEditForMessage(messageId, state = ensureState()) {
        return getAppliedTableHistoriesForMessage(messageId, state).length > 0;
    }
    
    function rollbackTableOperationsForMessages(messageIds = [], state = ensureState(), options = {}) {
        const affectedIds = getFiniteMessageIds(messageIds);
        const profileKey = getActiveTableProfileKey(state);
        const plan = buildTableRollbackPlan(state.tableDatabase.undoStack || [], affectedIds, profileKey);
        if (!plan) {
            return false;
        }
        const rollbackIds = new Set(plan.rollbackSnapshotIds);
        state.tableDatabase.undoStack = (state.tableDatabase.undoStack || []).filter(snapshot => !rollbackIds.has(snapshot.id));
        state.tableDatabase.redoStack = [];
        state.tableDatabase.tables = structuredClone(plan.restoreSnapshot.tables || []);
        state.tableDatabase.history = (state.tableDatabase.history || []).filter(item => !rollbackIds.has(item.undoSnapshotId));
        state.tableDatabase.editDrafts = (state.tableDatabase.editDrafts || []).filter(draft => (
            !getFiniteMessageIds(draft.sourceMessageIds || []).some(id => affectedIds.includes(id))
        ));
        state.tableDatabase.lastAppliedSourceMessageIds = [];
        state.tableDatabase.rollbackHistory = Array.isArray(state.tableDatabase.rollbackHistory) ? state.tableDatabase.rollbackHistory : [];
        state.tableDatabase.rollbackHistory.unshift({
            id: `table-rollback-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            reason: String(options.reason || '来源消息变更'),
            affectedMessageIds: affectedIds,
            cascadedSnapshotIds: plan.cascadedSnapshotIds,
            cascadedSourceMessageIds: plan.cascadedSourceMessageIds,
            rollbackSnapshotIds: plan.rollbackSnapshotIds,
            restoredSnapshotId: plan.restoreSnapshot.id,
            createdAt: new Date().toISOString(),
        });
        state.tableDatabase.rollbackHistory = state.tableDatabase.rollbackHistory.slice(0, 20);
        persistCurrentTableDatabase(state);
        const cascadeText = plan.cascadedSnapshotIds.length
            ? `；同时安全回退其后的 ${plan.cascadedSnapshotIds.length} 组依赖修改`
            : '';
        scheduleRenderAll(`已回退受影响的表格事务${cascadeText}。`);
        toastr.info(`${options.toast || '已检测到来源楼层变更并回退表格事务'}${cascadeText}。`);
        return plan;
    }
    
    function rollbackLatestTableOperationForDeletedMessages(messageIds = [], state = ensureState()) {
        return !!rollbackTableOperationsForMessages(messageIds, state, {
            reason: '来源楼层删除',
            toast: '已检测到来源楼层被删除，并恢复到对应表格事务之前',
        });
    }
    
    function rollbackLatestTableOperationForChangedMessages(messageIds = [], state = ensureState()) {
        return !!rollbackTableOperationsForMessages(messageIds, state, {
            reason: '来源楼层更新或重 roll',
            toast: '已检测到来源楼层变更，撤销旧表格事务并等待重新捕获',
        });
    }
    
    function collectMessageIdsFromEventArgs(args = []) {
        const ids = new Set();
        const visit = (value) => {
            if (value === null || value === undefined) {
                return;
            }
            if (typeof value === 'number' || typeof value === 'string') {
                const id = Number(value);
                if (Number.isInteger(id) && id >= 0) {
                    ids.add(id);
                }
                return;
            }
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            if (typeof value === 'object') {
                for (const key of ['messageId', 'message_id', 'id', 'index', 'mesId', 'mes_id']) {
                    if (value[key] !== undefined) {
                        visit(value[key]);
                    }
                }
            }
        };
        args.forEach(visit);
        return [...ids];
    }
    
    function switchTableProfile(scope, profileId, state = ensureState(), options = {}) {
        const nextScope = Object.values(tableSchemaScopes).includes(scope) ? scope : tableSchemaScopes.CHAT;
        const profiles = getTableProfilesForScope(nextScope, state);
        const target = profiles.find(profile => profile.id === profileId) || profiles[0];
        if (!target) {
            toastr.warning('没有可切换的表格组。');
            return false;
        }
        if (options.confirm !== false) {
            const rows = (state.tableDatabase.tables || []).reduce((sum, table) => sum + (table.rows?.length || 0), 0);
            const confirmed = confirmDanger(
                `切换到表格组「${target.name}」？`,
                [
                    `当前表格组：${getActiveTableProfile(state)?.name || '未命名'}`,
                    `当前行数：${rows}，未应用草稿：${state.tableDatabase.editDrafts?.length || 0}`,
                    '当前行数据会先保存到原表格组；切换后，上下文会使用目标表格组。',
                ],
            );
            if (!confirmed) {
                return false;
            }
        }
        saveCurrentTableProfileRows(state);
        state.tableDatabase.schemaScope = nextScope;
        state.tableDatabase.activeProfileId = target.id;
        loadActiveTableProfileRows(state);
        saveGlobalSettings();
        saveState();
        return true;
    }
    
    function createTableProfileForCurrentScope(name, state = ensureState()) {
        saveCurrentTableProfileRows(state);
        const scope = state.tableDatabase.schemaScope || tableSchemaScopes.CHAT;
        const profiles = getTableProfilesForScope(scope, state);
        const profile = createTableProfile(name || `${getTableProfileScopeLabel(scope)}表格组 ${profiles.length + 1}`, []);
        profiles.push(profile);
        state.tableDatabase.activeProfileId = profile.id;
        state.tableDatabase.tables = [];
        saveCurrentTableProfileRows(state);
        saveGlobalSettings();
        saveState();
        return profile;
    }
    
    function createBaseStoryLedgerProfile(state = ensureState()) {
        const scope = state.tableDatabase.schemaScope || tableSchemaScopes.CHAT;
        const profiles = getTableProfilesForScope(scope, state);
        const existing = profiles.find(profile => [baseStoryLedgerPreset.name, '剧情基础台账'].includes(profile.name));
        if (existing) {
            const switched = switchTableProfile(scope, existing.id, state);
            if (!switched) return null;
            existing.name = baseStoryLedgerPreset.name;
            existing.updatedAt = new Date().toISOString();
            state.tableDatabase.enabled = true;
            persistCurrentTableDatabase(state);
            return existing;
        }
    
        const confirmed = confirmDanger(
            `创建表格组「${baseStoryLedgerPreset.name}」？`,
            ['会保留当前表格组，并新建 6 张基础表；不会创建事件摘要或大总结表。'],
        );
        if (!confirmed) return null;
    
        saveCurrentTableProfileRows(state);
        const profile = createTableProfile(baseStoryLedgerPreset.name, createBaseStoryLedgerTables());
        profiles.push(profile);
        state.tableDatabase.activeProfileId = profile.id;
        state.tableDatabase.tables = normalizeTableSchemas(profile.tables);
        state.tableDatabase.enabled = true;
        saveCurrentTableProfileRows(state);
        persistCurrentTableDatabase(state);
        return profile;
    }
    
    function deleteActiveTableProfile(state = ensureState()) {
        const scope = state.tableDatabase.schemaScope || tableSchemaScopes.CHAT;
        const profiles = getTableProfilesForScope(scope, state);
        if (profiles.length <= 1) {
            toastr.warning('至少需要保留一个表格组。');
            return false;
        }
        const active = getActiveTableProfile(state);
        const confirmed = confirmDanger(
            `删除表格组「${active?.name || '未命名'}」？`,
            ['这会删除这个表格组的框架和当前聊天里对应的行数据；不会删除摘要。'],
        );
        if (!confirmed) {
            return false;
        }
        const key = getActiveTableProfileKey(state);
        const index = profiles.findIndex(profile => profile.id === active?.id);
        if (index >= 0) {
            profiles.splice(index, 1);
        }
        delete state.tableDatabase.profileRows[key];
        state.tableDatabase.activeProfileId = profiles[0]?.id || '';
        loadActiveTableProfileRows(state);
        saveGlobalSettings();
        saveState();
        return true;
    }
    

    return {
        getTableSchemaScopeLabel,
        getTableProfileScopeLabel,
        getCurrentCharacterSchemaKey,
        getCurrentCharacterSchemaLabel,
        getTableSchemaLibrary,
        createTableProfile,
        getScopedTableSchemas,
        saveScopedTableSchemas,
        getTableProfileLibrary,
        ensureChatTableProfiles,
        getTableProfilesForScope,
        ensureTableProfileForScope,
        getActiveTableProfile,
        getActiveTableProfileKey,
        saveCurrentTableProfileRows,
        loadActiveTableProfileRows,
        mergeScopedTableSchemasIntoState,
        setTableSchemaScope,
        syncCurrentTableSchemas,
        persistCurrentTableDatabase,
        pushTableUndoSnapshot,
        undoLastTableOperation,
        redoLastTableOperation,
        getAppliedTableHistoriesForMessage,
        hasAppliedTableEditForMessage,
        rollbackTableOperationsForMessages,
        rollbackLatestTableOperationForDeletedMessages,
        rollbackLatestTableOperationForChangedMessages,
        collectMessageIdsFromEventArgs,
        switchTableProfile,
        createTableProfileForCurrentScope,
        createBaseStoryLedgerProfile,
        deleteActiveTableProfile,
    };
}
