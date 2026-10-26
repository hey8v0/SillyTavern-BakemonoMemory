import { applyFactsUpdate, createCard, editCard, mergeCards, normalizeFacts, removeCard, undoFactsUpdate } from '../facts/model.js';
import { parseFactCards } from '../facts/parser.js';
import { summarizeFactsChanges } from '../facts/diff.js';
import { buildLegacyImport, importCards } from '../facts/migration.js';
import { buildFactsPrompt, defaultFactsPrompt } from '../facts/prompt.js';
import { storyTimeContext as defaultStoryTimeContext } from '../memory/story-state.js';

// 整理事实 runs on its own cadence, not the chapter's: once `everySummaries` new 剧情摘要 have gathered, or after
// the chat has been idle for `idleMinutes` with anything pending. Each run reads the summaries past
// `lastIntegratedFloor` (the latest reply left out while it can still be rerolled), rewrites the cards they touch,
// and moves the cursor. Results go through the summary task queue; the diff lands in facts.history for undo.
export function createFactsController({
    getState,
    getChat = () => [],
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
    isChatReady = () => true,
    // The older 剧情状态 projection and 表格 rows of the chat, for the one-time import.
    getLegacy = () => ({ projection: null, information: [], tables: [] }),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
    now = () => new Date().toISOString(),
} = {}) {
    const maxBatch = 20;
    let idleTimer = null;

    function facts(state = getState()) {
        if (!state.facts || state.facts.version !== 1 || !Array.isArray(state.facts.cards)) state.facts = normalizeFacts(state.facts);
        const current = state.facts;
        // Chats consolidated per stage (v1.29–v1.33) carry the stages done, not a floor: the cursor starts after them.
        if (current.lastIntegratedFloor < 0 && current.doneStages.length) {
            const done = new Set(current.doneStages);
            const ends = (state.stageSummaries || []).filter(stage => done.has(stage.hash))
                .flatMap(stage => (stage.sourceMessageIds || []).map(Number).filter(Number.isInteger));
            if (ends.length) current.lastIntegratedFloor = Math.max(...ends);
        }
        return current;
    }

    const floorsOf = item => [...new Set([...(Array.isArray(item.sourceMessageIds) ? item.sourceMessageIds : []), item.messageId]
        .map(Number).filter(value => Number.isInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER))];
    // The last reply can still be rerolled (SillyTavern swipes only the last message), so its summary waits.
    function openFloor(state) {
        const chat = getChat() || [];
        const last = chat.length - 1;
        return last > 0 && chat[last] && !chat[last].is_user ? last : -1;
    }

    // 剧情摘要 not yet consolidated, oldest first: saved summaries and the summary blocks read from replies.
    function pendingSummaries(state = getState()) {
        const current = facts(state);
        const open = openFloor(state);
        const queuedTo = Math.max(-1, ...(state.taskQueue || []).filter(task => task.kind === blockTypes.FACTS && ['queued', 'running'].includes(task.status)).map(task => Number(task.metadata?.factsFloorTo ?? -1)),
            ...(state.drafts || []).filter(draft => draft.kind === blockTypes.FACTS).map(draft => Number(draft.metadata?.factsFloorTo ?? -1)));
        const cursor = Math.max(current.lastIntegratedFloor, queuedTo);
        const seen = new Set();
        return [...(state.storySummaries || []), ...(state.blocks || []).filter(block => block.type === blockTypes.STORY && !block.isGeneratedSummary && block.sourceKind !== 'raw')]
            .filter(item => item?.hash && item.content && !seen.has(item.hash) && seen.add(item.hash))
            .map(item => { const floors = floorsOf(item); return { item, floors, floorStart: Math.min(...floors), floorEnd: Math.max(...floors) }; })
            .filter(entry => entry.floors.length && entry.floorEnd > cursor && entry.floorEnd !== open)
            .sort((a, b) => a.floorEnd - b.floorEnd || a.floorStart - b.floorStart);
    }

    // `exceptTaskId`: the task whose result is being written is still marked running while the next batch is decided.
    function hasOpenTask(state = getState(), exceptTaskId = null) {
        return (state.taskQueue || []).some(task => task.kind === blockTypes.FACTS && task.id !== exceptTaskId && ['queued', 'running'].includes(task.status));
    }

    // What one result would change, computed on a copy; shown in 待确认 when results are held for review.
    function previewUpdate(current, parsed, { floorTo = null, taskId = null } = {}) {
        const copy = structuredClone(current);
        return applyFactsUpdate(copy, parsed, { trigger: 'review', floorTo, taskId, now: now() }) || { changes: [], warnings: [], reflectionAfter: null, floorTo };
    }

    // One request over a run of pending summaries. Material longer than the budget is cut at a summary boundary.
    function enqueueBatch(entries, { trigger = 'auto' } = {}) {
        const state = getState();
        const settings = facts(state).settings;
        const taken = [];
        let text = '';
        for (const entry of entries.slice(0, maxBatch)) {
            const plain = getBlockPlainText(entry.item.content).trim();
            if (!plain) continue;
            if (taken.length && text.length + plain.length + 2 > settings.materialChars) break;
            text += (text ? '\n\n' : '') + plain;
            taken.push(entry);
        }
        if (!taken.length) return null;
        const floorFrom = Math.min(...taken.map(entry => entry.floorStart)), floorTo = Math.max(...taken.map(entry => entry.floorEnd));
        const { prompt, systemPrompt, cardIds } = buildFactsPrompt(facts(state), text, {
            template: state.generationPrompts?.facts || defaultFactsPrompt, timeContext: storyTimeContext(state) });
        return enqueueSummaryTask({
            kind: blockTypes.FACTS,
            label: `整理事实 · 第 ${floorFrom === floorTo ? floorFrom : `${floorFrom}–${floorTo}`} 楼 · ${taken.length} 条摘要`,
            prompt, systemPrompt,
            sourceHashes: taken.map(entry => entry.item.hash),
            sourceMessageIds: [...new Set(taken.flatMap(entry => entry.floors))].sort((a, b) => a - b),
            trigger: `facts_${trigger}`,
            metadata: { factsFloorFrom: floorFrom, factsFloorTo: floorTo, factsCount: taken.length, factsCardIds: cardIds },
            silent: trigger !== 'manual',
        });
    }

    // The automatic cadence: enough new summaries (auto), or anything pending once the chat went quiet (idle).
    function maybeRun({ trigger = 'auto', exceptTaskId = null } = {}) {
        if (!isChatReady()) return null;
        const state = getState();
        const settings = facts(state).settings;
        if (!settings.enabled || !settings.auto || hasOpenTask(state, exceptTaskId)) return null;
        const pending = pendingSummaries(state);
        if (!pending.length) return null;
        if (trigger === 'auto' && pending.length < settings.everySummaries) return null;
        const task = enqueueBatch(trigger === 'auto' ? pending.slice(0, Math.max(settings.everySummaries, 1)) : pending, { trigger });
        if (task && getState() === state) saveState();
        return task;
    }

    // Any message is activity: the idle timer starts over, and fires only for the chat it was set in.
    function noteActivity() {
        if (idleTimer != null) { clearTimer(idleTimer); idleTimer = null; }
        const state = getState();
        const settings = facts(state).settings;
        if (!settings.enabled || !settings.auto || !(settings.idleMinutes > 0)) return;
        idleTimer = setTimer(() => {
            idleTimer = null;
            if (getState() !== state) return;
            maybeRun({ trigger: 'idle' });
        }, settings.idleMinutes * 60 * 1000);
    }

    // A summary saved through the plugin (per-turn, inline, backfill, stage) may complete a batch.
    function onSummaryCommitted() {
        return maybeRun({ trigger: 'auto' });
    }

    async function runManual() {
        const state = getState();
        if (!facts(state).settings.enabled) {
            toastr.info?.('先在这一页打开"记录剧情事实"。', '剧情剪辑台');
            return null;
        }
        if (hasOpenTask(state)) { toastr.info?.('已经有一个整理任务在队列里。', '剧情剪辑台'); return null; }
        const pending = pendingSummaries(state);
        if (!pending.length) {
            toastr.info?.('没有新的剧情摘要要整理；最新一楼会等下一条消息后再算。', '剧情剪辑台');
            return null;
        }
        const task = enqueueBatch(pending, { trigger: 'manual' });
        if (task && getState() === state) {
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `已加入整理事实任务：${task.metadata.factsCount} 条摘要。`);
        }
        return task;
    }

    // The queue hands the model's reply here; a parse failure fails the task and changes nothing.
    async function handleTaskResult(rawResult, task) {
        const state = getState();
        const parsed = parseFactCards(rawResult);
        const current = facts(state);
        const floorTo = Number.isInteger(task.metadata?.factsFloorTo) ? task.metadata.factsFloorTo : null;
        if (current.settings.review && createDraft) {
            const preview = previewUpdate(current, parsed, { floorTo, taskId: task.id });
            const draft = createDraft({ kind: blockTypes.FACTS, content: rawResult, sourceHashes: task.sourceHashes || [], sourceMessageIds: [], prompt: task.prompt,
                trigger: task.trigger, metadata: { factsFloorFrom: task.metadata?.factsFloorFrom ?? null, factsFloorTo: floorTo, factsPreview: preview, suggestedTitle: task.label, lockTitle: true } });
            task.metadata = { ...(task.metadata || {}), factsDraftId: draft.id, factsChanges: preview.changes.length };
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `整理结果已进入待确认：${summarizeFactsChanges(preview)}。`);
            return draft;
        }
        const entry = applyFactsUpdate(current, parsed, { trigger: task.trigger === 'facts_manual' ? 'manual' : 'facts', floorTo, taskId: task.id, now: now() });
        task.metadata = { ...(task.metadata || {}), factsChanges: entry?.changes.length || 0, factsWarnings: entry?.warnings || [] };
        saveState();
        syncInjection();
        const changed = entry?.changes.length || 0;
        const created = entry?.changes.filter(change => change.created).length || 0;
        const message = !entry ? '整理完成：卡片没有变化。'
            : `整理完成：${created ? `新建 ${created} 张，` : ''}改动 ${changed - created} 张${entry.reflectionAfter ? '，反思已更新' : ''}。`;
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, message);
        if (entry?.warnings.length) toastr.warning?.(entry.warnings.slice(0, 3).join('；'), '整理事实');
        // A backlog (an older chat, a long run with 整理 off) is worked through one batch at a time.
        if (task.trigger !== 'facts_manual') maybeRun({ trigger: 'auto', exceptTaskId: task.id });
        return entry;
    }

    async function undoLast() {
        const state = getState();
        const latest = [...facts(state).history].reverse().find(item => !item.undone);
        if (!latest) { toastr.info?.('没有可以撤回的整理。', '剧情剪辑台'); return null; }
        const summary = `${latest.changes.length} 张卡片${latest.reflectionAfter ? '和反思' : ''}会回到整理前的样子`;
        if (!await confirm('撤回上一次整理？', [summary + '。', latest.floorTo != null ? '这些摘要会重新算作没整理。' : ''])) return null;
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
        const floorTo = Number.isInteger(draft.metadata?.factsFloorTo) ? draft.metadata.factsFloorTo : null;
        const entry = applyFactsUpdate(facts(state), parsed, { trigger: 'review', floorTo, taskId: null, now: now() });
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
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '整理结果已丢弃；这些摘要可以重新整理。');
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
        noteActivity();
        return current.settings;
    }

    return { facts, pendingSummaries, enqueueBatch, maybeRun, noteActivity, onSummaryCommitted, runManual, handleTaskResult, previewUpdate, applyDraft, discardDraft,
        undoLast, updateSettings, saveCard, addCard, mergeInto, deleteCard, cardHistory, legacySummary, importLegacy };
}
