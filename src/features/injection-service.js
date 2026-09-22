import { isMemoryCurrent, storyTimeContext, refreshMemoryLinks, activeStoryCoverage } from '../memory/story-state.js';
import { storyStateEditGuide } from './table-memory-model.js';
import {resolveSummaryGraph} from '../memory/summary-provenance.js';

export function createInjectionService({
    ensureState,
    getChat,
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
    rpExtractionFlow,
    renderRpStateMemory = () => '',
} = {}) {
    function updateInjectionFromSummaries() {
        const state = ensureState();
        const { memory } = getInjectionMemoryParts(state);
        state.generatedMemory = memory;
        syncInjection();
    }
    
    function getInjectionMemoryParts(state = ensureState()) {
        if (getChat && state.chronicle) refreshMemoryLinks(state, getChat());
        const graph=resolveSummaryGraph(state);
        const coveredStories = activeStoryCoverage(state);
        const activeEpicBlocks = getActiveEpicMemoryBlocks?.(state) || [];
        const epicContents = activeEpicBlocks.map(item => `## ${getMultiSummaryLabel(item)}\n${item.content}`);
        const epicCoveredStageHashes = getActiveCoveredStageHashes?.(state) || new Set();
        const stageContents = (getStageMemoryBlocks?.(state) || [])
            .filter(item => !epicCoveredStageHashes.has(item.hash))
            .map(item => item.content);
        const shouldInjectStory = state.memoryStrategy === memoryStrategies?.GENERIC;
        const storyContents = shouldInjectStory
            ? (state.storySummaries || [])
                .filter(item => isMemoryCurrent(state, item,graph))
                .filter(item => !coveredStories.has(item.hash))
                .map(item => item.content)
            : [];
    
        const sources = {
            summary: [
                epicContents.length ? epicContents.join('\n\n') : '',
                stageContents.length ? '## 阶段总结\n' + stageContents.join('\n\n') : '',
            ].filter(Boolean).join('\n\n'),
            memory: storyContents.length ? '## 普通剧情摘要\n' + storyContents.join('\n\n') : '',
            rpState: '',
            table: [storyTimeContext(state), renderInjectedTablesSection?.(state)].filter(Boolean).join('\n\n'),
            vector: renderVectorMemorySection?.(state) || '',
        };
        const memoryBudget = Number(state.injection?.memoryBudgetChars) > 0 ? Number(state.injection.memoryBudgetChars) : 60000;
        const otherMemory = state.injection?.enabled === false ? '' : [sources.summary, sources.memory, sources.table, sources.vector].filter(Boolean).join('\n\n');
        const inlineValues = getInlinePromptValues(state);
        const template = String(state.injection?.template || defaultInjectionTemplate);
        const copies = Math.max(1, (template.match(/\{\{memory\}\}/g) || []).length);
        const rules = [inlineValues.summaryValue, inlineValues.tableValue,
            state.injection?.enabled === false ? '' : template.replaceAll('{{memory}}', '')].join('\n\n');
        const rpContext = rpExtractionFlow?.context?.(state, { query: getChat?.().at(-1)?.mes || '', includeBrief: state.injection?.enabled !== false,
            availableBudget: Math.max(0, Math.floor((memoryBudget - otherMemory.length * copies - rules.length - 8 * copies) / copies)) });
        sources.rpState = rpContext?.brief ?? renderRpStateMemory(state);
        const sections = [sources.summary, sources.memory, sources.rpState, sources.table, sources.vector].filter(Boolean);
        const memory = sections.join('\n\n').trim();
        const savedSummaries = (state.stageSummaries?.length || 0) + (state.epicSummaries?.length || 0);
        const diagnostic = state.injection?.enabled === false ? '长期记忆注入已关闭。'
            : memory ? '当前有效记忆已组装；是否进入模型上下文，以“查看上一轮”核对为准。'
            : savedSummaries ? `已有 ${savedSummaries} 条阶段／多次总结，但没有有效可选内容。请到记忆库查看来源失效、空内容或覆盖状态；无需先删除总结。`
            : !shouldInjectStory && state.storySummaries?.length ? '已有摘要模式不直接注入普通摘要；当前没有有效的阶段／多次总结。'
            : '当前没有可注入的记忆内容。';
    
        return {
            memory, diagnostic,
            sources,
            rpMaintenance: rpContext?.maintenance ?? rpExtractionFlow?.prompt('inline', state) ?? '',
            rpContext,
            inlineValues,
            stats: {
                epic: epicContents.length,
                stage: stageContents.length,
                story: storyContents.length,
                table: state.tableDatabase?.injectMemory === false ? 0 : (state.tableDatabase?.tables || []).length,
                vector: state.vectorMemory?.lastHits?.length || 0,
                rpState: sources.rpState ? 1 : 0,
            },
        };
    }
    
    function syncInjection() {
        const state = ensureState();
        const parts = getInjectionMemoryParts(state);
        state.generatedMemory = parts.memory;
        const content = renderInjectionContent(state, parts);
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
        syncInlineGenerationPrompts(state, parts);
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
    
    function getInlinePromptValues(state) {
        const summaryValue = state.inlineGeneration?.summaryEnabled
            ? renderInlinePrompt(state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt, state)
            : '';
        let tableValue = state.inlineGeneration?.tableEnabled
            ? renderInlinePrompt(state.inlineGeneration.tablePrompt || defaultInlineTablePrompt, state)
            : '';
        if (tableValue && !tableValue.includes(storyStateEditGuide)) tableValue += '\n\n' + [storyTimeContext(state), storyStateEditGuide].filter(Boolean).join('\n\n');
        return { summaryValue, tableValue };
    }

    function syncInlineGenerationPrompts(state = ensureState(), parts = getInjectionMemoryParts(state)) {
        const depth = Math.max(0, Number(state.inlineGeneration?.depth ?? 1));
        const role = Number(state.inlineGeneration?.role ?? extensionPromptRoles.SYSTEM);
        const { summaryValue, tableValue } = parts.inlineValues || getInlinePromptValues(state);
        const rpPrompt = parts.rpMaintenance;
        setExtensionPrompt(inlinePromptKeys.RP_STATE || 'bakemono-rp-state-maintenance', rpPrompt, extensionPromptTypes.IN_CHAT, depth, false, role);
        setExtensionPrompt(inlinePromptKeys.SUMMARY, summaryValue, extensionPromptTypes.IN_CHAT, depth, false, role);
        setExtensionPrompt(inlinePromptKeys.TABLE, tableValue, extensionPromptTypes.IN_CHAT, depth, false, role);
    }
    
    function renderInjectionContent(state = ensureState(), parts = getInjectionMemoryParts(state)) {
        const template = String(state.injection.template || defaultInjectionTemplate);
        return renderInjectionTemplate(parts.memory || '', template, defaultInjectionTemplate);
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
