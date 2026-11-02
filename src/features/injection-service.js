import { isMemoryCurrent, storyTimeContext, refreshMemoryLinks, activeStoryCoverage } from '../memory/story-state.js';
import {resolveSummaryGraph} from '../memory/summary-provenance.js';
import { isFirstReplyTurn, openingFloors, openingNote } from '../shared/opening.js';
import { recallText } from '../facts/recall.js';
import { wrapFactsInjection } from '../facts/injection.js';
import { planStageInjection, recentStageCount, stageIndexLine, stageOnDemandConfigured } from '../memory/stage-on-demand.js';

export function createInjectionService({
    ensureState,
    getChat,
    getActiveEpicMemoryBlocks,
    getMultiSummaryLabel,
    getActiveCoveredStageHashes,
    getStageMemoryBlocks,
    memoryStrategies,
    renderVectorMemorySection,
    setExtensionPrompt,
    injectionKey,
    extensionPromptTypes,
    extensionPromptRoles,
    defaultState,
    defaultInlineSummaryPrompt,
    inlinePromptKeys,
    defaultInjectionTemplate,
    renderInjectionTemplate,
    renderFactsSection = () => ({ text: '' }),
    // Whether recall can stand in this round for the chapters it replaces (see stage-on-demand.js).
    isRecallReady = () => false,
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
        const stageBlocks = (getStageMemoryBlocks?.(state) || []).filter(item => !epicCoveredStageHashes.has(item.hash));
        // Recall first: rendering it may find the saved hits out of date, and then it did not work this round.
        const vectorSection = renderVectorMemorySection?.(state) || '';
        const stagePlan = planStageInjection(state, stageBlocks);
        const onDemandNow = stagePlan.onDemand.length > 0 && !!isRecallReady(state);
        const stageContents = (onDemandNow ? stagePlan.always : stageBlocks).map(item => item.content);
        const stageIndex = onDemandNow ? stageIndexLine(stagePlan.onDemand) : '';
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
                stageContents.length || stageIndex ? '## 阶段总结\n' + [stageIndex, ...stageContents].filter(Boolean).join('\n\n') : '',
            ].filter(Boolean).join('\n\n'),
            memory: storyContents.length ? '## 普通剧情摘要\n' + storyContents.join('\n\n') : '',
            facts: '',
            time: storyTimeContext(state),
            vector: vectorSection,
        };
        const memoryBudget = Number(state.injection?.memoryBudgetChars) > 0 ? Number(state.injection.memoryBudgetChars) : 60000;
        const otherMemory = state.injection?.enabled === false ? '' : [sources.summary, sources.memory, sources.time, sources.vector].filter(Boolean).join('\n\n');
        const inlineValues = getInlinePromptValues(state);
        const template = String(state.injection?.template || defaultInjectionTemplate);
        const copies = Math.max(1, (template.match(/\{\{memory\}\}/g) || []).length);
        const rules = [inlineValues.summaryValue,
            state.injection?.enabled === false ? '' : template.replaceAll('{{memory}}', '')].join('\n\n');
        // 剧情事实: cards the recent floors name, and the ones the recalled old summaries name (so a memory the
        // vector recall brought back comes with who and what it is about). Not budgeted against the summaries;
        // it has its own character budget.
        // The scene is the latest two floors (full cards); a few floors back and the recalled text bring one-line cards.
        const recentFloors = Math.max(1, Number(state.facts?.settings?.recentFloors) || 6);
        const messages = getChat?.() || [];
        const join = list => list.map(message => String(message?.mes || '')).join('\n');
        // A chapter that came with a recalled floor is context: it does not name cards or point at every 线索 in it.
        const floorHits = state.vectorMemory?.enabled ? (state.vectorMemory.lastHits || []).filter(hit => hit.recallTier !== 'event') : [];
        const recentParts = { scene: join(messages.slice(-2)), recent: join(messages.slice(-recentFloors)), recalled: recallText(floorHits),
            recalledFloors: floorHits.filter(hit => !hit.memoryHash && Number.isInteger(hit.messageId)).map(hit => hit.messageId) };
        // It goes near the latest message on its own (see syncInjection), so it is not part of `memory`.
        sources.facts = state.injection?.enabled === false ? '' : wrapFactsInjection(renderFactsSection(state, recentParts)?.text || '');
        const sections = [sources.summary, sources.memory, sources.time, sources.vector].filter(Boolean);
        const memory = sections.join('\n\n').trim();
        const savedSummaries = (state.stageSummaries?.length || 0) + (state.epicSummaries?.length || 0);
        const diagnostic = state.injection?.enabled === false ? '长期记忆注入已关闭。'
            : memory || sources.facts ? '当前有效记忆已组装；是否进入模型上下文，以“查看上一轮”核对为准。'
            : savedSummaries ? `已有 ${savedSummaries} 条阶段／多次总结，但没有有效可选内容。请到“总结”页查看来源失效、空内容或覆盖状态；无需先删除总结。`
            : !shouldInjectStory && state.storySummaries?.length ? '摘要写在回复里时不单独注入普通摘要；当前没有有效的阶段／多次总结。'
            : '当前没有可注入的记忆内容。';
    
        return {
            memory, diagnostic,
            sources,
            inlineValues,
            stats: {
                epic: epicContents.length,
                stage: stageContents.length,
                story: storyContents.length,
                vector: state.vectorMemory?.lastHits?.length || 0,
                facts: sources.facts ? 1 : 0,
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
        const role = Number(state.injection.role ?? extensionPromptRoles.SYSTEM);
        setExtensionPrompt(
            injectionKey,
            value,
            extensionPromptTypes.IN_CHAT,
            Number(state.injection.depth ?? defaultState.injection.depth),
            false,
            role,
        );
        // 剧情事实 changes with the scene, every round. Near the latest message the model reads it as what is going on now,
        // and the summaries and the chat in front of it stay the same from round to round.
        setExtensionPrompt(
            `${injectionKey}_facts`,
            state.injection.enabled ? parts.sources.facts : '',
            extensionPromptTypes.IN_CHAT,
            Number(state.facts?.settings?.injectDepth ?? 2),
            false,
            role,
        );
        syncInlineGenerationPrompts(state, parts);
    }
    
    // For the injection page: what the chapters are doing this round, and what turning this on would do.
    function getStageOnDemandStatus(state = ensureState()) {
        const covered = getActiveCoveredStageHashes?.(state) || new Set();
        const stages = (getStageMemoryBlocks?.(state) || []).filter(item => !covered.has(item.hash));
        const chars = list => list.reduce((sum, item) => sum + String(item.content || '').length, 0).toLocaleString('en-US');
        const count = recentStageCount(state);
        if (state.injection?.stageOnDemand !== true) {
            const preview = planStageInjection({ ...state, injection: { ...state.injection, stageOnDemand: true }, vectorMemory: { ...state.vectorMemory, enabled: true, embeddingProvider: 'custom-openai' } }, stages);
            return preview.onDemand.length
                ? `现在 ${stages.length} 段全部常驻，约 ${chars(stages)} 字。打开后常驻最近 ${count} 段，约 ${chars(preview.always)} 字，更早的 ${preview.onDemand.length} 段靠向量召回。`
                : `现在 ${stages.length} 段都常驻。段数超过 ${count} 段后，打开这个可以只留最近几段。`;
        }
        if (!stageOnDemandConfigured(state)) {
            return state.vectorMemory?.enabled ? '要接上向量记忆的嵌入接口才生效，本地哈希向量只认相同的字词。现在阶段总结全部常驻。'
                : '要打开向量记忆并接上嵌入接口才生效。现在阶段总结全部常驻。';
        }
        const plan = planStageInjection(state, stages);
        if (!plan.onDemand.length) return `阶段总结没超过 ${count} 段，都常驻。`;
        if (!isRecallReady(state)) return `索引还没就绪，或者这一轮召回没成功，这一轮 ${stages.length} 段全部带上了。`;
        const waiting = new Set(plan.onDemand.map(item => item.hash));
        const brought = new Set((state.vectorMemory?.lastHits || []).filter(hit => waiting.has(hit.memoryHash)).map(hit => hit.memoryHash)).size;
        return `常驻最近 ${plan.always.length} 段，更早的 ${plan.onDemand.length} 段按需带上，这一轮带上了 ${brought} 段。`;
    }

    function renderInlinePrompt(template, state = ensureState()) {
        return String(template || '')
    }
    
    // On the first reply the 开场白 is still unrecorded; ask for it in the same reply instead of a request of its own.
    function withOpeningNote(value, part, state = ensureState()) {
        if (!value || !getChat || !isFirstReplyTurn(getChat())) return value;
        if (part === '摘要') {
            const floors = openingFloors(getChat());
            if ((state.blocks || []).some(block => floors.includes(block.messageId) && block.sourceKind !== 'raw' && !block.isGeneratedSummary)) return value;
        }
        return value + '\n\n' + openingNote(part);
    }

    function getInlinePromptValues(state) {
        const summaryValue = state.inlineGeneration?.summaryEnabled
            ? withOpeningNote(renderInlinePrompt(state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt, state), '摘要', state)
            : '';
        return { summaryValue, tableValue: '' };
    }

    function syncInlineGenerationPrompts(state = ensureState(), parts = getInjectionMemoryParts(state)) {
        const depth = Math.max(0, Number(state.inlineGeneration?.depth ?? 1));
        const role = Number(state.inlineGeneration?.role ?? extensionPromptRoles.SYSTEM);
        const { summaryValue, tableValue } = parts.inlineValues || getInlinePromptValues(state);
        // Cleared every time: older versions injected 剧情状态 upkeep and table instructions under these keys.
        const rpPrompt = '';
        setExtensionPrompt(inlinePromptKeys.RP_STATE || 'bakemono-rp-state-maintenance', rpPrompt, extensionPromptTypes.IN_CHAT, depth, false, role);
        setExtensionPrompt(inlinePromptKeys.SUMMARY, summaryValue, extensionPromptTypes.IN_CHAT, depth, false, role);
        setExtensionPrompt(inlinePromptKeys.TABLE, tableValue, extensionPromptTypes.IN_CHAT, depth, false, role);
    }
    
    function renderInjectionContent(state = ensureState(), parts = getInjectionMemoryParts(state)) {
        const template = String(state.injection.template || defaultInjectionTemplate);
        return renderInjectionTemplate(parts.memory || '', template, defaultInjectionTemplate);
    }

    // What the pages show and count: both blocks. A preview passes only the memory it renders.
    function renderInjectionDisplay(state = ensureState(), parts = getInjectionMemoryParts(state)) {
        const facts = (parts.sources ? parts : getInjectionMemoryParts(state)).sources.facts;
        return [renderInjectionContent(state, parts), facts].filter(Boolean).join('\n\n');
    }

    return {
        getInjectionMemoryParts,
        renderInjectionContent,
        renderInjectionDisplay,
        getStageOnDemandStatus,
        renderInlinePrompt,
        syncInjection,
        syncInlineGenerationPrompts,
        updateInjectionFromSummaries,
    };
}
