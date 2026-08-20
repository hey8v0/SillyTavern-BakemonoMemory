export function shouldSanitizeChatState(previousLength, chatLength) {
    return Number.isFinite(previousLength) && chatLength < previousLength;
}

export function createChatStateService({
    defaultState,
    chatMetadata,
    storageKey,
    extensionSettings,
    getContext,
    getFallbackChat,
    applyGlobalActiveConfigToState,
    fillMissingDefaults,
    migrateBuiltInInjectionDefaults,
    legacyInjectionTemplate,
    defaultInjectionTemplate,
    migrateGenerationPrompts,
    defaultStoryGenerationPrompt,
    defaultGenericStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultGenericStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultGenericEpicGenerationPrompt,
    migrateBuiltInStructuredPrompt,
    migrateStagePromptTimeSpan,
    migrateEpicPromptTimeSpan,
    normalizeArrayFields,
    getSummaryLevel,
    blockTypes,
    sortSummariesBySource,
    normalizeInjectionMemoryBody,
    renderInjectionContent,
    saveState,
    getFiniteMessageIds,
    ensureObjectField,
    normalizeWorkflowState,
    defaultAutomation,
    defaultGenerationTargets,
    migrateTurnSummaryPrompt,
    defaultTurnSummaryPrompt,
    tableSchemaScopes,
    ensureGlobalSettings,
    ensureTableProfileForScope,
    mergeScopedTableSchemasIntoState,
    migrateInlineSummaryPrompt,
    defaultInlineSummaryPrompt,
    defaultVectorMemory,
    migrateVectorQueryRewritePrompt,
    unique,
    getActiveCoveredStageHashes,
    getInjectionMemoryParts,
    installCompactStateSerializer,
} = {}) {
    const sanitizedChatLengths = new WeakMap();
    const maxStoredScanPreviewItems = 240;

    function cloneDefaultState() {
        return structuredClone(defaultState);
    }
    
    function sanitizeChatStateWhenStructureChanges(state) {
        const context = getContext();
        const sourceChat = context.chat || getFallbackChat() || [];
        const chatLength = Array.isArray(sourceChat) ? sourceChat.length : 0;
        const previousLength = sanitizedChatLengths.get(state);
        if (previousLength === chatLength) {
            return;
        }
        if (shouldSanitizeChatState(previousLength, chatLength)) {
            sanitizeCurrentChatState(state);
        }
        sanitizedChatLengths.set(state, chatLength);
    }
    
    function ensureState() {
        const isNewChatState = !chatMetadata[storageKey];
        if (!chatMetadata[storageKey]) {
            chatMetadata[storageKey] = cloneDefaultState();
        }
    
        const state = chatMetadata[storageKey];
        installCompactStateSerializer?.(state);
        state.persistenceRevision = Math.max(0, Number(state.persistenceRevision || 0));
        if (isNewChatState) {
            applyGlobalActiveConfigToState(state);
        } else if (state.configInitialized === undefined) {
            state.configInitialized = true;
        }
        fillMissingDefaults(state, defaultState);
        fillMissingDefaults(state.injection, defaultState.injection);
        migrateBuiltInInjectionDefaults(state.injection, legacyInjectionTemplate, defaultInjectionTemplate);
        if (!state.generationPrompts) {
            state.generationPrompts = structuredClone(defaultState.generationPrompts);
        }
        fillMissingDefaults(state.generationPrompts, defaultState.generationPrompts);
        migrateGenerationPrompts(state.generationPrompts, {
            story: defaultStoryGenerationPrompt,
            genericStory: defaultGenericStoryGenerationPrompt,
            missing: defaultMissingSummaryPrompt,
            stage: defaultStageGenerationPrompt,
            genericStage: defaultGenericStageGenerationPrompt,
            epic: defaultEpicGenerationPrompt,
            genericEpic: defaultGenericEpicGenerationPrompt,
        }, {
            migrateBuiltInStructuredPrompt,
            migrateStagePromptTimeSpan,
            migrateEpicPromptTimeSpan,
        });
        for (const key of ['scanRules', 'classificationRules', 'previewLayouts']) {
            if (!state[key]) {
                state[key] = structuredClone(defaultState[key]);
            }
            fillMissingDefaults(state[key], defaultState[key]);
        }
    
        normalizeArrayFields(state, ['blocks', 'storySummaries', 'stageSummaries', 'epicSummaries']);
        state.storySummaries.forEach(summary => { summary.level = getSummaryLevel({ ...summary, type: blockTypes.STORY }); });
        state.stageSummaries.forEach(summary => { summary.level = getSummaryLevel({ ...summary, type: blockTypes.STAGE }); });
        state.epicSummaries.forEach(summary => { summary.level = getSummaryLevel({ ...summary, type: blockTypes.EPIC }); });
        sortSummariesBySource(state.storySummaries);
        sortSummariesBySource(state.stageSummaries);
        sortSummariesBySource(state.epicSummaries);
        normalizeArrayFields(state, ['drafts', 'history', 'taskQueue', 'autoSummaryTransactions', 'memoryRecords']);
        state.scanPreview = (Array.isArray(state.scanPreview) ? state.scanPreview : []).slice(-maxStoredScanPreviewItems);
        const rawGeneratedMemory = String(state.generatedMemory || state.injection?.content || '');
        state.generatedMemory = normalizeInjectionMemoryBody(rawGeneratedMemory, state.injection?.template, defaultInjectionTemplate);
        if (rawGeneratedMemory.trim() && rawGeneratedMemory.trim() !== state.generatedMemory) {
            state.injection.content = renderInjectionContent(state);
            saveState();
        }
        normalizeArrayFields(state, ['coveredBlockHashes', 'coveredStageHashes', 'hiddenMessageIds', 'customHiddenMessageIds']);
        ensureObjectField(state, 'autoHideRecent', defaultState.autoHideRecent);
        fillMissingDefaults(state.autoHideRecent, defaultState.autoHideRecent);
        state.autoHideRecent.preserveRecent = Math.max(0, Number(state.autoHideRecent.preserveRecent ?? defaultState.autoHideRecent.preserveRecent));
        state.autoHideRecent.managedMessageIds = getFiniteMessageIds(state.autoHideRecent.managedMessageIds || []);
        normalizeWorkflowState(state);
        ensureObjectField(state, 'automation', defaultAutomation);
        fillMissingDefaults(state.automation, defaultAutomation);
        ensureObjectField(state.automation, 'customApi', defaultAutomation.customApi);
        fillMissingDefaults(state.automation.customApi, defaultAutomation.customApi);
        ensureObjectField(state, 'generationTargets', defaultGenerationTargets);
        for (const [kind, defaults] of Object.entries(defaultGenerationTargets)) {
            ensureObjectField(state.generationTargets, kind, defaults);
            fillMissingDefaults(state.generationTargets[kind], defaults);
        }
        ensureObjectField(state, 'turnSummary', defaultState.turnSummary);
        fillMissingDefaults(state.turnSummary, defaultState.turnSummary);
        migrateTurnSummaryPrompt(state.turnSummary, defaultTurnSummaryPrompt, migrateBuiltInStructuredPrompt);
        ensureObjectField(state, 'tableDatabase', defaultState.tableDatabase);
        fillMissingDefaults(state.tableDatabase, defaultState.tableDatabase);
        if (!Object.values(tableSchemaScopes).includes(state.tableDatabase.schemaScope)) {
            ensureGlobalSettings();
            state.tableDatabase.schemaScope = extensionSettings[storageKey].defaultTableSchemaScope || tableSchemaScopes.CHAT;
        }
        normalizeArrayFields(state.tableDatabase, ['tables', 'editDrafts', 'history', 'undoStack', 'redoStack', 'rollbackHistory']);
        state.tableDatabase.lastAppliedSourceMessageIds = getFiniteMessageIds(state.tableDatabase.lastAppliedSourceMessageIds || []);
        normalizeArrayFields(state.tableDatabase, ['chatProfiles']);
        ensureObjectField(state.tableDatabase, 'profileRows', {});
        ensureTableProfileForScope(state.tableDatabase.schemaScope, state);
        mergeScopedTableSchemasIntoState(state);
        ensureObjectField(state, 'inlineGeneration', defaultState.inlineGeneration);
        fillMissingDefaults(state.inlineGeneration, defaultState.inlineGeneration);
        migrateInlineSummaryPrompt(state.inlineGeneration, defaultInlineSummaryPrompt, migrateBuiltInStructuredPrompt);
        if (state.inlineGeneration.hideTableEditMigratedToRegex !== true) {
            state.inlineGeneration.hideTableEdit = false;
            state.inlineGeneration.hideTableEditMigratedToRegex = true;
        }
        ensureObjectField(state, 'vectorMemory', defaultVectorMemory);
        fillMissingDefaults(state.vectorMemory, defaultVectorMemory);
        migrateVectorQueryRewritePrompt(state.vectorMemory, defaultVectorMemory.queryRewritePrompt);
        ensureObjectField(state.vectorMemory, 'customApi', defaultVectorMemory.customApi);
        fillMissingDefaults(state.vectorMemory.customApi, defaultVectorMemory.customApi);
        ensureObjectField(state.vectorMemory, 'queryCustomApi', defaultVectorMemory.queryCustomApi);
        fillMissingDefaults(state.vectorMemory.queryCustomApi, defaultVectorMemory.queryCustomApi);
        normalizeArrayFields(state.vectorMemory, ['records', 'lastHits', 'lastEmbeddingCandidates', 'lastRerankCandidates']);
        ensureObjectField(state.vectorMemory, 'embeddingCache', {});
        ensureObjectField(state, 'chatGuard', defaultState.chatGuard);
        sanitizeChatStateWhenStructureChanges(state);
        return state;
    }
    
    function getCurrentChatMessageMap() {
        const context = getContext();
        const sourceChat = context.chat || getFallbackChat() || [];
        if (!Array.isArray(sourceChat) || !sourceChat.length) {
            return null;
        }
        const ids = new Set();
        sourceChat.forEach((message, messageId) => {
            if (message) {
                ids.add(Number(messageId));
            }
        });
        return {
            ids,
            sourceChat,
            maxId: sourceChat.length - 1,
        };
    }
    
    function isCurrentMessageId(messageId, messageMap) {
        const id = Number(messageId);
        if (!Number.isFinite(id)) {
            return true;
        }
        if (id >= Number.MAX_SAFE_INTEGER) {
            return true;
        }
        return messageMap.ids.has(id);
    }
    
    function hasCurrentSourceMessages(item, messageMap) {
        const ids = getFiniteMessageIds(item?.sourceMessageIds || []);
        if (ids.length) {
            return ids.every(id => isCurrentMessageId(id, messageMap));
        }
        if (item?.messageId !== undefined && item.messageId !== null) {
            return isCurrentMessageId(item.messageId, messageMap);
        }
        return true;
    }
    
    function hasExplicitCurrentSourceMessages(item, messageMap) {
        const ids = getFiniteMessageIds(item?.sourceMessageIds || []);
        return ids.length > 0 && ids.every(id => isCurrentMessageId(id, messageMap));
    }
    
    function isAllowedVectorMessage(messageId, role, state, messageMap) {
        if (!isCurrentMessageId(messageId, messageMap)) {
            return false;
        }
        if (state.vectorMemory?.includeUser === true) {
            return true;
        }
        const id = Number(messageId);
        const message = Number.isFinite(id) ? messageMap.sourceChat?.[id] : null;
        if (message?.is_user) {
            return false;
        }
        return String(role || '').toLowerCase() !== 'user';
    }
    
    function filterByHashList(values = [], validHashes = new Set()) {
        return unique((Array.isArray(values) ? values : []).filter(hash => validHashes.has(hash)));
    }
    
    function sanitizeCurrentChatState(state) {
        const messageMap = getCurrentChatMessageMap();
        if (!messageMap) {
            return false;
        }
    
        let prunedCount = 0;
        const countPruned = (before, after) => {
            prunedCount += Math.max(0, before - after);
        };
        const filterArray = (items, predicate) => {
            const source = Array.isArray(items) ? items : [];
            const filtered = source.filter(predicate);
            countPruned(source.length, filtered.length);
            return filtered;
        };
    
        state.blocks = filterArray(state.blocks, block => hasCurrentSourceMessages(block, messageMap));
        state.scanPreview = filterArray(state.scanPreview, item => hasCurrentSourceMessages(item, messageMap));
        state.storySummaries = filterArray(state.storySummaries, summary => hasCurrentSourceMessages(summary, messageMap));
        const validStoryHashes = new Set([
            ...state.blocks.map(block => block.hash).filter(Boolean),
            ...state.storySummaries.map(summary => summary.hash).filter(Boolean),
        ]);
    
        state.stageSummaries = filterArray(state.stageSummaries, summary => {
            if (!hasCurrentSourceMessages(summary, messageMap)) {
                return false;
            }
            if (hasExplicitCurrentSourceMessages(summary, messageMap)) {
                return true;
            }
            const sourceHashes = Array.isArray(summary.sourceHashes) ? summary.sourceHashes.filter(Boolean) : [];
            return !sourceHashes.length || sourceHashes.every(hash => validStoryHashes.has(hash));
        });
        const validStageHashes = new Set(state.stageSummaries.map(summary => summary.hash).filter(Boolean));
    
        state.epicSummaries = filterArray(state.epicSummaries, summary => {
            if (!hasCurrentSourceMessages(summary, messageMap)) {
                return false;
            }
            if (hasExplicitCurrentSourceMessages(summary, messageMap)) {
                return true;
            }
            const sourceStageHashes = Array.isArray(summary.sourceStageHashes) ? summary.sourceStageHashes.filter(Boolean) : [];
            const sourceHashes = Array.isArray(summary.sourceHashes) ? summary.sourceHashes.filter(Boolean) : [];
            const stageOk = !sourceStageHashes.length || sourceStageHashes.every(hash => validStageHashes.has(hash));
            const storyOk = !sourceHashes.length || sourceHashes.every(hash => validStoryHashes.has(hash) || validStageHashes.has(hash));
            return stageOk && storyOk;
        });
        const validEpicHashes = new Set(state.epicSummaries.map(summary => summary.hash).filter(Boolean));
    
        const previousCoveredBlockCount = state.coveredBlockHashes.length;
        state.coveredBlockHashes = filterByHashList(state.coveredBlockHashes, validStoryHashes);
        countPruned(previousCoveredBlockCount, state.coveredBlockHashes.length);
        const previousCoveredStageCount = state.coveredStageHashes.length;
        state.coveredStageHashes = [...getActiveCoveredStageHashes(state)];
        countPruned(previousCoveredStageCount, state.coveredStageHashes.length);
    
        for (const key of ['hiddenMessageIds', 'customHiddenMessageIds']) {
            const previous = Array.isArray(state[key]) ? state[key] : [];
            state[key] = unique(previous.filter(id => isCurrentMessageId(id, messageMap)));
            countPruned(previous.length, state[key].length);
        }
        if (state.autoHideRecent && typeof state.autoHideRecent === 'object') {
            const previous = Array.isArray(state.autoHideRecent.managedMessageIds) ? state.autoHideRecent.managedMessageIds : [];
            state.autoHideRecent.managedMessageIds = unique(previous.filter(id => isCurrentMessageId(id, messageMap)));
            countPruned(previous.length, state.autoHideRecent.managedMessageIds.length);
        }
        if (Array.isArray(state.autoSummaryTransactions)) {
            const previous = state.autoSummaryTransactions;
            state.autoSummaryTransactions = previous
                .map(transaction => ({
                    ...transaction,
                    sourceMessageIds: unique(getFiniteMessageIds(transaction.sourceMessageIds || [])),
                    hiddenMessageIds: unique(getFiniteMessageIds(transaction.hiddenMessageIds || []).filter(id => isCurrentMessageId(id, messageMap))),
                }))
                .filter(transaction => transaction.summaryHash && transaction.status !== 'rolled_back');
            countPruned(previous.length, state.autoSummaryTransactions.length);
        }
    
        if (state.vectorMemory && typeof state.vectorMemory === 'object') {
            const previousRecordCount = Array.isArray(state.vectorMemory.records) ? state.vectorMemory.records.length : 0;
            state.vectorMemory.records = filterArray(state.vectorMemory.records, record => isAllowedVectorMessage(record?.messageId, record?.role, state, messageMap));
            const previousHitCount = Array.isArray(state.vectorMemory.lastHits) ? state.vectorMemory.lastHits.length : 0;
            state.vectorMemory.lastHits = filterArray(state.vectorMemory.lastHits, hit => isAllowedVectorMessage(hit?.messageId, hit?.role, state, messageMap));
            if (previousRecordCount !== state.vectorMemory.records.length) {
                state.vectorMemory.dirty = true;
                state.vectorMemory.dirtyReason = '当前聊天分支已清理越界索引';
                state.vectorMemory.lastIndexedSignature = '';
            }
        }
    
        const validMemoryHashes = new Set([...validStoryHashes, ...validStageHashes, ...validEpicHashes]);
        state.memoryRecords = filterArray(state.memoryRecords, record => !record?.hash || validMemoryHashes.has(record.hash));
    
        if (prunedCount > 0) {
            state.chatGuard = {
                lastPrunedAt: new Date().toISOString(),
                lastPrunedCount: prunedCount,
                lastPrunedReason: '当前聊天缺少部分来源楼层，已清理继承的旧记忆引用',
            };
            const parts = getInjectionMemoryParts(state);
            state.generatedMemory = parts.memory;
            state.injection.content = renderInjectionContent(state);
            saveState();
        }
        return prunedCount > 0;
    }

    return {
        ensureState,
        maxStoredScanPreviewItems,
        sanitizeCurrentChatState,
    };
}
