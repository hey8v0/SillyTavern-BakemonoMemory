import { applyFactsUpdate, createCard, editCard, mergeCards, normalizeFacts, removeCard, undoFactsUpdate } from '../facts/model.js';
import { parseFactCards } from '../facts/parser.js';
import { summarizeFactsChanges } from '../facts/diff.js';
import { buildLegacyImport, importCards } from '../facts/migration.js';
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
    createDraft = null,
    // The older 剧情状态 projection and 表格 rows of the chat, for the one-time import.
    getLegacy = () => ({ projection: null, information: [], tables: [] }),
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
        const held = new Set((state.drafts || []).filter(draft => draft.kind === blockTypes.FACTS).map(draft => draft.metadata?.factsStageHash));
        return [...(state.stageSummaries || [])]
            .sort((a, b) => (a.sourceSortKey ?? 0) - (b.sourceSortKey ?? 0))
            .filter(stage => stage?.hash && !done.has(stage.hash) && !queued.has(stage.hash) && !held.has(stage.hash));
    }

    // What one result would change, computed on a copy; shown in 待确认 when results are held for review.
    function previewUpdate(current, parsed, { stageHash = null, taskId = null } = {}) {
        const copy = structuredClone(current);
        return applyFactsUpdate(copy, parsed, { trigger: 'review', stageHash, taskId, now: now() }) || { changes: [], warnings: [], reflectionAfter: null, stageHash };
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
        const current = facts(state);
        const stageHash = task.metadata?.factsStageHash || null;
        if (current.settings.review && createDraft) {
            const preview = previewUpdate(current, parsed, { stageHash, taskId: task.id });
            const draft = createDraft({ kind: blockTypes.FACTS, content: rawResult, sourceHashes: task.sourceHashes || [], sourceMessageIds: [], prompt: task.prompt,
                trigger: task.trigger, metadata: { factsStageHash: stageHash, factsPreview: preview, suggestedTitle: task.label, lockTitle: true } });
            task.metadata = { ...(task.metadata || {}), factsDraftId: draft.id, factsChanges: preview.changes.length };
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `整理结果已进入待确认：${summarizeFactsChanges(preview)}。`);
            return draft;
        }
        const entry = applyFactsUpdate(current, parsed, { trigger: task.trigger === 'facts_manual' ? 'manual' : 'facts', stageHash, taskId: task.id, now: now() });
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

    // 待确认 → 应用到卡片. The cards may have moved on since the preview, so the result is applied afresh.
    async function applyDraft(draftId, options = {}) {
        const state = getState();
        const index = (state.drafts || []).findIndex(draft => draft.id === draftId && draft.kind === blockTypes.FACTS);
        if (index < 0) return null;
        const draft = state.drafts[index];
        let parsed;
        try { parsed = parseFactCards(draft.content); }
        catch (error) { toastr.warning?.(error.message, '整理事实'); return null; }
        const entry = applyFactsUpdate(facts(state), parsed, { trigger: 'review', stageHash: draft.metadata?.factsStageHash || null, taskId: null, now: now() });
        state.drafts.splice(index, 1);
        saveState();
        syncInjection();
        if (!options.silent) {
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `已应用到卡片：${summarizeFactsChanges(entry)}。`);
            toastr.success?.(`已应用到卡片：${summarizeFactsChanges(entry)}。`, '剧情剪辑台');
        }
        return entry || { changes: [] };
    }

    function discardDraft(draftId) {
        const state = getState();
        const before = (state.drafts || []).length;
        state.drafts = (state.drafts || []).filter(draft => !(draft.id === draftId && draft.kind === blockTypes.FACTS));
        if (state.drafts.length === before) return false;
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '整理结果已丢弃；那个阶段可以重新整理。');
        return true;
    }

    function afterCardChange(message) {
        saveState();
        syncInjection();
        if (message) renderWorkbenchScope(workbenchRenderScopes.DRAFTS, message);
    }
    function saveCard(cardId, patch) {
        const card = editCard(facts(getState()), cardId, patch, now());
        if (card) afterCardChange(`已保存「${card.name}」。`);
        return card;
    }
    function addCard(data) {
        const card = createCard(facts(getState()), data, now());
        if (card) afterCardChange(`已添加「${card.name}」。`);
        return card;
    }
    function mergeInto(keepId, removeId) {
        const card = mergeCards(facts(getState()), keepId, removeId, now());
        if (card) afterCardChange(`已合并到「${card.name}」。`);
        return card;
    }
    async function deleteCard(cardId) {
        const current = facts(getState());
        const card = current.cards.find(item => item.id === cardId);
        if (!card) return false;
        if (!await confirm(`删除「${card.name}」？`, ['这张卡片会从剧情事实里去掉，之后的整理可能会按材料重新建一张。', '想暂时不注入的话，用"标记结束"就够了。'])) return false;
        const removed = removeCard(current, cardId);
        if (removed) afterCardChange(`已删除「${card.name}」。`);
        return removed;
    }
    function cardHistory(cardId, state = getState()) {
        return [...facts(state).history].reverse().filter(entry => entry.changes?.some(change => change.cardId === cardId))
            .map(entry => ({ ...entry, changes: entry.changes.filter(change => change.cardId === cardId) }));
    }

    function legacySummary(state = getState()) {
        let legacy;
        try { legacy = getLegacy(state) || {}; } catch { legacy = {}; }
        const people = legacy.projection?.people?.length || 0;
        const rows = (legacy.tables || []).reduce((sum, table) => sum + (table.rows || []).filter(row => Array.isArray(row) && row.some(value => String(value ?? '').trim())).length, 0);
        return { people, rows, available: people > 0 || rows > 0, legacy };
    }

    async function importLegacy() {
        const state = getState();
        const { people, rows, available, legacy } = legacySummary(state);
        if (!available) { toastr.info?.('这个聊天没有旧的剧情状态或表格内容可以导入。', '剧情剪辑台'); return null; }
        const cards = buildLegacyImport(legacy);
        if (!cards.length) { toastr.info?.('旧数据里没有能变成卡片的内容。', '剧情剪辑台'); return null; }
        const ok = await confirm(`把旧的剧情状态和表格导入成 ${cards.length} 张卡片？`, [
            [people ? `剧情状态里有 ${people} 个人物` : '', rows ? `表格里有 ${rows} 行` : ''].filter(Boolean).join('，') + '。',
            '已有同名卡片只补上空着的字段，不会覆盖。旧的剧情状态和表格本身不动。',
            '自定义表格每行变成一张设定卡，列名和内容逐项写在说明里。']);
        if (!ok) return null;
        const entry = importCards(facts(state), cards, now());
        saveState();
        syncInjection();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, entry ? `已导入：${summarizeFactsChanges(entry)}。` : '没有新内容需要导入。');
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

    return { facts, stageMaterial, stagesToIntegrate, enqueueStage, onSummaryCommitted, runManual, handleTaskResult, previewUpdate, applyDraft, discardDraft,
        undoLast, updateSettings, saveCard, addCard, mergeInto, deleteCard, cardHistory, legacySummary, importLegacy };
}
