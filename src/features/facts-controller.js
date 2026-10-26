import { applyFactsUpdate, createCard, editCard, mergeCards, normalizeFacts, pruneIntegrated, removeCard, undoFactsUpdate } from '../facts/model.js';
import { parseFactCards } from '../facts/parser.js';
import { summarizeFactsChanges } from '../facts/diff.js';
import { buildLegacyImport, importCards } from '../facts/migration.js';
import { buildFactsPrompt, defaultFactsPrompt } from '../facts/prompt.js';
import { storyTimeContext as defaultStoryTimeContext } from '../memory/story-state.js';
import { getHash } from '../shared/text.js';

// 整理事实 runs on its own cadence, not the chapter's: once `everySummaries` new 剧情摘要 have gathered, or after
// the chat has been idle for `idleMinutes` with anything pending. Each run reads a batch of summaries not yet
// integrated (by summary id and text version, so a backfilled or edited summary gets its turn; the latest reply is
// left out while it can still be rerolled), rewrites the cards they touch, and records them as read. Results go
// through the summary task queue; the diff lands in facts.history for undo.
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
    // Whether a summary's source floors are still the ones it was written from (summary-provenance); a stale one
    // is left for the user to rebuild rather than read into the cards.
    summaryStatus = () => ({ valid: true }),
    // The older 剧情状态 projection and 表格 rows of the chat, for the one-time import.
    getLegacy = () => ({ projection: null, information: [], tables: [] }),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
    now = () => new Date().toISOString(),
} = {}) {
    // One request reads at most this many summaries; a longer backlog is worked through batch by batch.
    const maxBatch = 20;
    // An automatic batch that failed this often on the same material waits for the user instead of costing a request per message.
    const maxAutoFailures = 2;
    let idleTimer = null;
    const revisions = new WeakMap();
    // The text version of a summary: saved ones carry it; a block read from a reply is hashed once per object.
    const revisionOf = item => {
        if (typeof item.contentHash === 'string' && item.contentHash) return item.contentHash;
        let revision = revisions.get(item);
        if (!revision) { revision = getHash(String(item.content || '')); revisions.set(item, revision); }
        return revision;
    };
    const ms = value => { const parsed = Date.parse(String(value || '')); return Number.isFinite(parsed) ? parsed : NaN; };

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
        // Chats from before v1.34.1 know only how far they got. Once the chat is loaded, every summary up to there is
        // recorded as integrated at its current text; while the chat is still loading nothing is judged, because an
        // empty chat would record nothing and then read everything again.
        if (current.integrated == null && isChatReady()) {
            current.integrated = {};
            if (current.lastIntegratedFloor >= 0) {
                for (const entry of summaryEntries(state)) if (entry.floorEnd <= current.lastIntegratedFloor) current.integrated[entry.item.hash] = entry.revision;
            }
        }
        return current;
    }

    const floorsOf = item => [...new Set([...(Array.isArray(item.sourceMessageIds) ? item.sourceMessageIds : []), item.messageId]
        .map(Number).filter(value => Number.isInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER))];
    // The last reply can still be rerolled (SillyTavern swipes only the last message), so its summary waits.
    function openFloor() {
        const chat = getChat() || [];
        const last = chat.length - 1;
        return last > 0 && chat[last] && !chat[last].is_user ? last : -1;
    }

    // Every 剧情摘要 of the chat with its floors and text version: saved summaries and the summary blocks read from replies.
    function summaryEntries(state) {
        const seen = new Set();
        return [...(state.storySummaries || []), ...(state.blocks || []).filter(block => block.type === blockTypes.STORY && !block.isGeneratedSummary && block.sourceKind !== 'raw')]
            .filter(item => item?.hash && item.content && !seen.has(item.hash) && seen.add(item.hash))
            .map(item => { const floors = floorsOf(item); return { item, floors, floorStart: Math.min(...floors), floorEnd: Math.max(...floors), revision: revisionOf(item) }; })
            .filter(entry => entry.floors.length);
    }

    // Summaries a queued or running 整理 is reading, or a result held in 待确认 covers: not pending until that settles.
    function heldHashes(state) {
        const held = new Set();
        for (const task of state.taskQueue || []) {
            if (task.kind === blockTypes.FACTS && ['queued', 'running'].includes(task.status)) for (const hash of task.sourceHashes || []) held.add(hash);
        }
        for (const draft of state.drafts || []) if (draft.kind === blockTypes.FACTS) for (const hash of draft.sourceHashes || []) held.add(hash);
        return held;
    }

    // 剧情摘要 not yet consolidated, oldest first. A summary counts as integrated only at the text version that was
    // read: one edited since, or written later for an older floor, comes back; one whose source floors went stale
    // is left out until it is rebuilt.
    function pendingSummaries(state = getState()) {
        const current = facts(state);
        if (!current.integrated) return [];
        const open = openFloor(), held = heldHashes(state), cursor = current.lastIntegratedFloor;
        const candidates = summaryEntries(state)
            .filter(entry => entry.floorEnd !== open && !held.has(entry.item.hash) && current.integrated[entry.item.hash] !== entry.revision);
        return candidates.filter(entry => summaryStatus(state, entry.item)?.valid !== false)
            .map(entry => ({ ...entry, revised: entry.item.hash in current.integrated, backfill: entry.floorEnd <= cursor }))
            .sort((a, b) => a.floorEnd - b.floorEnd || a.floorStart - b.floorStart);
    }

    // `exceptTaskId`: the task whose result is being written is still marked running while the next batch is decided.
    function hasOpenTask(state = getState(), exceptTaskId = null) {
        return (state.taskQueue || []).some(task => task.kind === blockTypes.FACTS && task.id !== exceptTaskId && ['queued', 'running'].includes(task.status));
    }

    const batchSignature = entries => JSON.stringify(entries.map(entry => [entry.item.hash, entry.revision]));
    // What the task queue compares before and after the request: the summaries the task read, at their text version.
    // A summary edited or removed meanwhile makes the result stale.
    function sourceSignature(task, state = getState()) {
        const byHash = new Map(summaryEntries(state).map(entry => [entry.item.hash, entry.revision]));
        return JSON.stringify((task.sourceHashes || []).map(hash => [hash, byHash.get(hash) ?? null]));
    }
    function failures(state, signature) {
        return (state.taskQueue || []).filter(task => task.kind === blockTypes.FACTS && task.status === 'failed' && task.metadata?.factsBatch === signature).length;
    }
    const selectBatch = (trigger, pending, every) => trigger === 'auto' ? pending.slice(0, Math.max(1, every)) : pending.slice(0, maxBatch);
    // The automatic batch that is due but was given up on after repeated failures, for the page to explain.
    function blockedBatch(state = getState()) {
        const current = facts(state);
        if (!current.integrated) return null;
        const pending = pendingSummaries(state);
        if (!pending.length || pending.length < current.settings.everySummaries) return null;
        const batch = selectBatch('auto', pending, current.settings.everySummaries);
        const count = failures(state, batchSignature(batch));
        return count >= maxAutoFailures ? { failures: count, summaries: batch.length, floorFrom: batch[0].floorStart, floorTo: batch.at(-1).floorEnd } : null;
    }
    // A branch or deleted floors left the chat shorter than the consolidation got: the cards may hold what happened after.
    function chatShorterThanProgress(state = getState()) {
        const current = facts(state);
        const lastFloor = (getChat() || []).length - 1;
        return isChatReady() && lastFloor >= 0 && current.lastIntegratedFloor > lastFloor ? { cursor: current.lastIntegratedFloor, lastFloor } : null;
    }

    // What one result would change, computed on a copy; shown in 待确认 when results are held for review.
    function previewUpdate(current, parsed, { floorTo = null, taskId = null, sources = [] } = {}) {
        const copy = structuredClone(current);
        return applyFactsUpdate(copy, parsed, { trigger: 'review', floorTo, taskId, sources, now: now() }) || { changes: [], warnings: [], reflectionAfter: null, floorTo, sources };
    }

    // One request over a run of pending summaries. Material longer than the budget is cut at a summary boundary;
    // `pendingTotal` is how many were pending, so the task can say how many are left. Each summary is labelled with
    // its floors; one older than the cursor (backfilled, or edited since it was read) is marked, and the model is
    // told not to turn the current state back to that time.
    function enqueueBatch(entries, { trigger = 'auto', pendingTotal = entries.length } = {}) {
        const state = getState();
        const current = facts(state), settings = current.settings;
        const taken = [];
        let length = 0;
        for (const entry of entries.slice(0, maxBatch)) {
            const plain = getBlockPlainText(entry.item.content).trim();
            if (taken.length && length + plain.length + 2 > settings.materialChars) break;
            length += plain.length + 2;
            taken.push({ ...entry, plain });
        }
        if (!taken.some(entry => entry.plain)) return null;
        const floorFrom = Math.min(...taken.map(entry => entry.floorStart)), floorTo = Math.max(...taken.map(entry => entry.floorEnd));
        const range = entry => entry.floorStart === entry.floorEnd ? `${entry.floorStart}` : `${entry.floorStart}–${entry.floorEnd}`;
        const older = taken.filter(entry => entry.floorEnd <= current.lastIntegratedFloor);
        const note = older.length
            ? `（注意：标了“补写”或“改过”的 ${older.length} 条摘要早于已整理到的第 ${current.lastIntegratedFloor} 楼。卡片记的是截至第 ${current.lastIntegratedFloor} 楼的现状，这些材料只用来补充当时的信息或改正记错的地方，不要把处境、持有者等现状改回更早的样子。）\n\n`
            : '';
        const material = note + taken.filter(entry => entry.plain)
            .map(entry => `第 ${range(entry)} 楼${entry.revised ? '（改过）' : entry.backfill ? '（补写）' : ''}：${entry.plain}`).join('\n\n');
        const { prompt, systemPrompt, cardIds } = buildFactsPrompt(current, material, {
            template: state.generationPrompts?.facts || defaultFactsPrompt, timeContext: storyTimeContext(state) });
        const sources = taken.map(entry => ({ hash: entry.item.hash, revision: entry.revision, floorEnd: entry.floorEnd }));
        const remaining = Math.max(0, pendingTotal - taken.length);
        return enqueueSummaryTask({
            kind: blockTypes.FACTS,
            label: `整理事实 · 第 ${floorFrom === floorTo ? floorFrom : `${floorFrom}–${floorTo}`} 楼 · ${taken.length} 条摘要${remaining ? ` · 还剩 ${remaining} 条` : ''}`,
            prompt, systemPrompt,
            sourceHashes: sources.map(source => source.hash),
            sourceMessageIds: [...new Set(taken.flatMap(entry => entry.floors))].sort((a, b) => a - b),
            trigger: `facts_${trigger}`,
            metadata: { factsFloorFrom: floorFrom, factsFloorTo: floorTo, factsCount: taken.length, factsRemaining: remaining, factsCardIds: cardIds, factsSources: sources, factsBatch: batchSignature(taken) },
            silent: trigger !== 'manual',
        });
    }

    // Sends one batch of what is pending: `auto` exactly everySummaries of them, idle and manual up to maxBatch.
    function runBatch(trigger, { state = getState(), exceptTaskId = null, pending = null } = {}) {
        if (hasOpenTask(state, exceptTaskId)) return null;
        const list = pending || pendingSummaries(state);
        if (!list.length) return null;
        const task = enqueueBatch(selectBatch(trigger, list, facts(state).settings.everySummaries), { trigger, pendingTotal: list.length });
        if (task && getState() === state) saveState();
        return task;
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
        if (failures(state, batchSignature(selectBatch(trigger, pending, settings.everySummaries))) >= maxAutoFailures) return null;
        return runBatch(trigger, { state, exceptTaskId, pending });
    }

    function clearIdle() {
        if (idleTimer != null) { clearTimer(idleTimer); idleTimer = null; }
    }
    // The idle timer fires only for the chat it was set in; `delay` shortens the wait after a resume.
    function armIdle(state, delay = null) {
        clearIdle();
        const settings = facts(state).settings;
        if (!settings.enabled || !settings.auto || !(settings.idleMinutes > 0)) return;
        const wait = Number.isFinite(delay) ? Math.max(1000, delay) : settings.idleMinutes * 60 * 1000;
        idleTimer = setTimer(() => {
            idleTimer = null;
            if (getState() !== state) return;
            maybeRun({ trigger: 'idle' });
        }, wait);
    }
    // A message sent or received is activity: the time is kept, and the idle timer starts over.
    function noteActivity() {
        const state = getState();
        facts(state).lastActivityAt = now();
        armIdle(state);
    }
    // After a reload, a chat switch or a return to the foreground. The browser timer may never have fired (phones
    // freeze background pages), so the idle check is made against the time of the last message instead; coming back
    // is not activity. Nothing runs while the chat is still loading.
    function resume() {
        if (!isChatReady()) return null;
        const state = getState();
        const current = facts(state), settings = current.settings;
        if (!settings.enabled || !settings.auto || !(settings.idleMinutes > 0)) { clearIdle(); return null; }
        const wait = settings.idleMinutes * 60 * 1000;
        const since = ms(current.lastActivityAt);
        if (!Number.isFinite(since)) { armIdle(state); return null; }
        const elapsed = ms(now()) - since;
        if (elapsed < wait) { armIdle(state, wait - elapsed); return null; }
        clearIdle();
        return maybeRun({ trigger: 'idle' });
    }

    // A summary saved through the plugin (per-turn, inline, backfill, stage) may complete a batch.
    function onSummaryCommitted() {
        return maybeRun({ trigger: 'auto' });
    }

    // 整理事实 by hand: up to maxBatch now; the rest follows batch by batch through the queue (pause the queue to stop),
    // except with 先审再用, where the next batch waits until this one is applied or discarded.
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
        const task = runBatch('manual', { state, pending });
        if (task && getState() === state) {
            const { factsCount: count, factsRemaining: remaining } = task.metadata;
            const message = !remaining ? `已加入整理：${count} 条摘要。`
                : facts(state).settings.review ? `已加入整理：本次 ${count} 条，还剩 ${remaining} 条。先审再用时一次只整理一批，这批确认后再点一次。`
                : `已加入整理：本次 ${count} 条，还剩 ${remaining} 条会接着排；想停就在队列里暂停。`;
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, message);
            toastr.info?.(message, '剧情剪辑台');
        }
        return task;
    }

    // The queue hands the model's reply here; a parse failure fails the task and changes nothing.
    async function handleTaskResult(rawResult, task) {
        const state = getState();
        const parsed = parseFactCards(rawResult);
        const current = facts(state);
        const floorTo = Number.isInteger(task.metadata?.factsFloorTo) ? task.metadata.factsFloorTo : null;
        const sources = Array.isArray(task.metadata?.factsSources) ? task.metadata.factsSources : [];
        const remaining = Number(task.metadata?.factsRemaining) || 0;
        if (current.settings.review && createDraft) {
            const preview = previewUpdate(current, parsed, { floorTo, taskId: task.id, sources });
            const draft = createDraft({ kind: blockTypes.FACTS, content: rawResult, sourceHashes: task.sourceHashes || [], sourceMessageIds: [], prompt: task.prompt,
                trigger: task.trigger, metadata: { factsFloorFrom: task.metadata?.factsFloorFrom ?? null, factsFloorTo: floorTo, factsSources: sources, factsPreview: preview, suggestedTitle: task.label, lockTitle: true } });
            task.metadata = { ...(task.metadata || {}), factsDraftId: draft.id, factsChanges: preview.changes.length };
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `整理结果已进入待确认：${summarizeFactsChanges(preview)}。${remaining ? `还有 ${remaining} 条摘要等这批确认后再整理。` : ''}`);
            return draft;
        }
        const entry = applyFactsUpdate(current, parsed, { trigger: task.trigger === 'facts_manual' ? 'manual' : 'facts', floorTo, taskId: task.id, sources, now: now() });
        pruneIntegrated(current, summaryEntries(state).map(item => item.item.hash));
        task.metadata = { ...(task.metadata || {}), factsChanges: entry?.changes.length || 0, factsWarnings: entry?.warnings || [] };
        saveState();
        syncInjection();
        const changed = entry?.changes.length || 0;
        const created = entry?.changes.filter(change => change.created).length || 0;
        const message = !changed && !entry?.reflectionAfter ? `整理完成：卡片没有变化（${sources.length} 条摘要已记为整理过）。`
            : `整理完成：${created ? `新建 ${created} 张，` : ''}改动 ${changed - created} 张${entry.reflectionAfter ? '，反思已更新' : ''}。`;
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, message);
        if (entry?.warnings.length) toastr.warning?.(entry.warnings.slice(0, 3).join('；'), '整理事实');
        // A backlog (an older chat, a long run with 整理 off) is worked through batch by batch, the way this one started.
        if (getState() !== state) return entry;
        if (task.trigger === 'facts_manual') { if (remaining > 0) runBatch('manual', { state, exceptTaskId: task.id }); }
        else maybeRun({ trigger: task.trigger === 'facts_idle' ? 'idle' : 'auto', exceptTaskId: task.id });
        return entry;
    }

    async function undoLast() {
        const state = getState();
        const latest = [...facts(state).history].reverse().find(item => !item.undone && item.trigger !== 'user');
        if (!latest) { toastr.info?.('没有可以撤回的整理。', '剧情剪辑台'); return null; }
        const summary = `${latest.changes.length} 张卡片${latest.reflectionAfter ? '和反思' : ''}会回到整理前的样子（你后来改过的字段保留）`;
        const reopened = latest.sources?.length ? `这 ${latest.sources.length} 条摘要会重新算作没整理。` : latest.floorTo != null ? '这些摘要会重新算作没整理。' : '';
        if (!await confirm('撤回上一次整理？', [summary + '。', reopened])) return null;
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
        const sources = Array.isArray(draft.metadata?.factsSources) ? draft.metadata.factsSources : [];
        const current = facts(state);
        const entry = applyFactsUpdate(current, parsed, { trigger: 'review', floorTo, taskId: null, sources, now: now() });
        pruneIntegrated(current, summaryEntries(state).map(item => item.item.hash));
        state.drafts.splice(index, 1);
        saveState();
        syncInjection();
        if (!options.silent) {
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `已应用到卡片：${summarizeFactsChanges(entry)}。`);
            toastr.success?.(`已应用到卡片：${summarizeFactsChanges(entry)}。`, '剧情剪辑台');
        }
        return entry || { changes: [], sources };
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
        resume();
        return current.settings;
    }

    return { facts, pendingSummaries, enqueueBatch, runBatch, maybeRun, noteActivity, resume, onSummaryCommitted, runManual, handleTaskResult, previewUpdate, applyDraft, discardDraft,
        undoLast, updateSettings, saveCard, addCard, mergeInto, deleteCard, cardHistory, legacySummary, importLegacy, sourceSignature, blockedBatch, chatShorterThanProgress };
}
