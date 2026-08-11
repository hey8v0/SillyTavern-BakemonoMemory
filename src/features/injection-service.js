export function createInjectionService({
    ensureState,
    getActiveEpicMemoryBlocks,
    getMultiSummaryLabel,
    getActiveCoveredStageHashes,
    getStageMemoryBlocks,
    memoryStrategies,
    renderInjectedTablesSection,
    renderVectorMemorySection,
    setExtensionPrompt,
    injectionKey,
    extensionPromptTypes,
    extensionPromptRoles,
    defaultState,
    formatTableDataForPrompt,
    formatTableGuideForPrompt,
    formatSpecificTablesForPrompt,
    getReadonlyTables,
    getWritableTables,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    inlinePromptKeys,
    defaultInjectionTemplate,
    renderInjectionTemplate,
} = {}) {
    function updateInjectionFromSummaries() {
        const state = ensureState();
        const { memory } = getInjectionMemoryParts(state);
        state.generatedMemory = memory;
        syncInjection();
    }
    
    function getInjectionMemoryParts(state = ensureState()) {
        const activeEpicBlocks = getActiveEpicMemoryBlocks(state);
        const epicContents = activeEpicBlocks.map(item => `## ${getMultiSummaryLabel(item)}\n${item.content}`);
        const epicCoveredStageHashes = getActiveCoveredStageHashes(state);
        const stageContents = getStageMemoryBlocks(state)
            .filter(item => !epicCoveredStageHashes.has(item.hash))
            .map(item => item.content);
        const shouldInjectStory = state.memoryStrategy === memoryStrategies.GENERIC;
        const storyContents = shouldInjectStory
            ? state.storySummaries
                .filter(item => !(state.coveredBlockHashes || []).includes(item.hash))
                .map(item => item.content)
            : [];
    
        const sources = {
            summary: [
                epicContents.length ? epicContents.join('\n\n') : '',
                stageContents.length ? '## 阶段总结\n' + stageContents.join('\n\n') : '',
            ].filter(Boolean).join('\n\n'),
            memory: storyContents.length ? '## 普通剧情摘要\n' + storyContents.join('\n\n') : '',
            table: renderInjectedTablesSection(state),
            vector: renderVectorMemorySection(state),
        };
        const sections = [sources.summary, sources.memory, sources.table, sources.vector].filter(Boolean);
    
        return {
            memory: sections.join('\n\n').trim(),
            sources,
            stats: {
                epic: epicContents.length,
                stage: stageContents.length,
                story: storyContents.length,
                table: state.tableDatabase.injectMemory === false ? 0 : (state.tableDatabase.tables || []).length,
                vector: state.vectorMemory?.lastHits?.length || 0,
            },
        };
    }
    
    function syncInjection() {
        const state = ensureState();
        const content = renderInjectionContent(state);
        state.injection.content = content;
        const value = state.injection.enabled ? content : '';
        setExtensionPrompt(
            injectionKey,
            value,
            extensionPromptTypes.IN_CHAT,
            Number(state.injection.depth ?? defaultState.injection.depth),
            false,
            Number(state.injection.role ?? extensionPromptRoles.SYSTEM),
        );
        syncInlineGenerationPrompts(state);
    }
    
    function renderInlinePrompt(template, state = ensureState()) {
        const includeRows = true;
        const tableData = formatTableDataForPrompt(state);
        return String(template || '')
            .replaceAll('{{tableData}}', tableData)
            .replaceAll('{{tableGuide}}', formatTableGuideForPrompt(state))
            .replaceAll('{{readonlyTables}}', formatSpecificTablesForPrompt(getReadonlyTables(state), { includeRows }))
            .replaceAll('{{writableTables}}', formatSpecificTablesForPrompt(getWritableTables(state), { includeRows }));
    }
    
    function syncInlineGenerationPrompts(state = ensureState()) {
        const depth = Math.max(0, Number(state.inlineGeneration?.depth ?? 1));
        const role = Number(state.inlineGeneration?.role ?? extensionPromptRoles.SYSTEM);
        const summaryValue = state.inlineGeneration?.summaryEnabled
            ? renderInlinePrompt(state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt, state)
            : '';
        const tableValue = state.inlineGeneration?.tableEnabled
            ? renderInlinePrompt(state.inlineGeneration.tablePrompt || defaultInlineTablePrompt, state)
            : '';
        setExtensionPrompt(inlinePromptKeys.SUMMARY, summaryValue, extensionPromptTypes.IN_CHAT, depth, false, role);
        setExtensionPrompt(inlinePromptKeys.TABLE, tableValue, extensionPromptTypes.IN_CHAT, depth, false, role);
    }
    
    function renderInjectionContent(state = ensureState()) {
        const template = String(state.injection.template || defaultInjectionTemplate);
        return renderInjectionTemplate(state.generatedMemory || '', template, defaultInjectionTemplate);
    }

    return {
        getInjectionMemoryParts,
        renderInjectionContent,
        renderInlinePrompt,
        syncInjection,
        syncInlineGenerationPrompts,
        updateInjectionFromSummaries,
    };
}
