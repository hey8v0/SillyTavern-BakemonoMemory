import { applyFactsUpdate, normalizeFacts, undoFactsUpdate } from '../facts/model.js';
import { parseFactCards } from '../facts/parser.js';
import { buildFactsPrompt, defaultFactsPrompt } from '../facts/prompt.js';
import { storyTimeContext as defaultStoryTimeContext } from '../memory/story-state.js';

// 整理事实: one request per saved stage summary, run through the summary task queue. The result rewrites the
// cards the stage touched; the diff goes into facts.history so it can be undone.
export function createFactsController({
    getState,
    saveState,
    enqueueSummaryTask,
    blockTypes,
    getBlockPlainText = value => String(value || ''),
    storyTimeContext = defaultStoryTimeContext,
    toastr = {},
    renderWorkbenchScope = () => {},
    workbenchRenderScopes = {},
    syncInjection = () => {},
    confirm = async () => true,
    persistSharedConfigurationFromState = () => {},
    now = () => new Date().toISOString(),
} = {}) {
    function facts(state = getState()) {
        if (!state.facts || state.facts.version !== 1 || !Array.isArray(state.facts.cards)) state.facts = normalizeFacts(state.facts);
        return state.facts;
    }

    // The stage's own material: the story summaries it was made from. Longer than the budget, the stage text stands in.
    function stageMaterial(state, stage) {
        const hashes = new Set(stage.sourceHashes || []);
        const sources = [...(state.storySummaries || []), ...(state.blocks || []).filter(block => block.type === blockTypes.STORY)]
            .filter(item => hashes.has(item.hash));
        const seen = new Set();
        const texts = sources.filter(item => !seen.has(item.hash) && seen.add(item.hash)).map(item => getBlockPlainText(item.content)).filter(Boolean);
        const joined = texts.join('\n\n');
        if (texts.length && joined.length <= facts(state).settings.materialChars) return { text: joined, kind: 'story', count: texts.length };
        return { text: getBlockPlainText(stage.content), kind: 'stage', count: 1 };
    }

    function stagesToIntegrate(state = getState()) {
        const done = new Set(facts(state).doneStages);
        const queued = new Set((state.taskQueue || []).filter(task => task.kind === blockTypes.FACTS && ['queued', 'running'].includes(task.status)).map(task => task.metadata?.factsStageHash));
        return [...(state.stageSummaries || [])]
            .sort((a, b) => (a.sourceSortKey ?? 0) - (b.sourceSortKey ?? 0))
            .filter(stage => stage?.hash && !done.has(stage.hash) && !queued.has(stage.hash));
    }

    function enqueueStage(stage, { trigger = 'auto', silent = trigger === 'auto' } = {}) {
        const state = getState();
        const material = stageMaterial(state, stage);
        if (!material.text.trim()) return null;
        const { prompt, systemPrompt, cardIds } = buildFactsPrompt(facts(state), material.text, {
            template: state.generationPrompts?.facts || defaultFactsPrompt, timeContext: storyTimeContext(state) });
        return enqueueSummaryTask({
            kind: blockTypes.FACTS,
            label: `整理事实 · ${stage.title || '阶段总结'}`,
            prompt, systemPrompt,
            sourceHashes: [stage.hash],
            sourceMessageIds: Array.isArray(stage.sourceMessageIds) ? [...stage.sourceMessageIds] : [],
            trigger: trigger === 'auto' ? 'facts_auto' : 'facts_manual',
            metadata: { factsStageHash: stage.hash, factsCardIds: cardIds, factsMaterial: material.kind, factsMaterialCount: material.count },
            silent,
        });
    }

    // Called after a stage summary is saved; nothing happens unless 自动整理事实 is on.
    function onSummaryCommitted(summary) {
        const state = getState();
        const settings = facts(state).settings;
        if (summary?.type !== blockTypes.STAGE || !settings.enabled || !settings.auto) return null;
        if (!stagesToIntegrate(state).some(stage => stage.hash === summary.hash)) return null;
        return enqueueStage(summary, { trigger: 'auto' });
    }

    async function runManual({ stageHash = null } = {}) {
        const state = getState();
        if (!facts(state).settings.enabled) {
            toastr.info?.('先在这一页打开"记录剧情事实"。', '剧情剪辑台');
            return [];
        }
        const pending = stageHash ? (state.stageSummaries || []).filter(stage => stage.hash === stageHash) : stagesToIntegrate(state);
        if (!pending.length) {
            toastr.info?.(stageHash ? '这个阶段已经整理过。' : '所有阶段总结都已经整理过了；保存新的阶段总结后会自动整理。', '剧情剪辑台');
            return [];
        }
        if (pending.length > 1 && !await confirm(`整理 ${pending.length} 个阶段的事实？`, [`每个阶段 1 次请求，共 ${pending.length} 次。`, '会按阶段先后顺序逐个整理，结果直接写入卡片，可以撤回。'])) return [];
        const tasks = pending.map(stage => enqueueStage(stage, { trigger: 'manual', silent: true })).filter(Boolean);
        if (getState() === state) {
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `已加入 ${tasks.length} 个整理事实任务。`);
        }
        return tasks;
    }

    // The queue hands the model's reply here; a parse failure fails the task and changes nothing.
    async function handleTaskResult(rawResult, task) {
        const state = getState();
        const parsed = parseFactCards(rawResult);
        const entry = applyFactsUpdate(facts(state), parsed, { trigger: task.trigger === 'facts_manual' ? 'manual' : 'facts',
            stageHash: task.metadata?.factsStageHash || null, taskId: task.id, now: now() });
        task.metadata = { ...(task.metadata || {}), factsChanges: entry?.changes.length || 0, factsWarnings: entry?.warnings || [] };
        saveState();
        syncInjection();
        const changed = entry?.changes.length || 0;
        const created = entry?.changes.filter(change => change.created).length || 0;
        const message = !entry ? '整理完成：卡片没有变化。'
            : `整理完成：${created ? `新建 ${created} 张，` : ''}改动 ${changed - created} 张${entry.reflectionAfter ? '，反思已更新' : ''}。`;
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, message);
        if (entry?.warnings.length) toastr.warning?.(entry.warnings.slice(0, 3).join('；'), '整理事实');
        return entry;
    }

    async function undoLast() {
        const state = getState();
        const latest = [...facts(state).history].reverse().find(item => !item.undone);
        if (!latest) { toastr.info?.('没有可以撤回的整理。', '剧情剪辑台'); return null; }
        const summary = `${latest.changes.length} 张卡片${latest.reflectionAfter ? '和反思' : ''}会回到整理前的样子`;
        if (!await confirm('撤回上一次整理？', [summary + '。', latest.stageHash ? '这个阶段会重新算作未整理。' : ''])) return null;
        const entry = undoFactsUpdate(facts(state), latest.id, now());
        if (!entry) return null;
        saveState();
        syncInjection();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '已撤回上一次整理。');
        return entry;
    }

    function updateSettings(patch) {
        const state = getState();
        const current = facts(state);
        current.settings = normalizeFacts({ ...current, settings: { ...current.settings, ...patch } }).settings;
        saveState();
        persistSharedConfigurationFromState(state);
        syncInjection();
        return current.settings;
    }

    return { facts, stageMaterial, stagesToIntegrate, enqueueStage, onSummaryCommitted, runManual, handleTaskResult, undoLast, updateSettings };
}
