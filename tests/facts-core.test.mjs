import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFactsUpdate, createCard, createDefaultFacts, editCard, findCard, mergeCards, normalizeFacts, selectRelevantCards, undoFactsUpdate } from '../src/facts/model.js';
import { parseFactCards } from '../src/facts/parser.js';
import { buildFactsPrompt, defaultFactsPrompt } from '../src/facts/prompt.js';
import { renderFactsSection } from '../src/facts/injection.js';
import { renderFactsChanges, summarizeFactsChanges } from '../src/facts/diff.js';
import { getHash } from '../src/shared/text.js';

import { factsRuntime as runtime, blockTypes, reply, lin } from './helpers/facts-runtime.mjs';

function seeded() {
    const facts = createDefaultFacts();
    facts.settings.enabled = true;
    applyFactsUpdate(facts, { cards: [lin(), { kind: 'thread', name: '码头之约', fields: { 内容: '明天去码头见乙', 状态: '未了', 参与者: '林晚、沈砚' } },
        { kind: 'item', name: '旧铜钥匙', fields: { 持有者: '林晚', 描述: '书店后门的钥匙' } }], reflection: { mainline: '林晚追查旧信' } }, { stageHash: 'stage-1', now: '2026-10-26T00:00:00.000Z' });
    return facts;
}

test('整理 rewrites named cards, keeps omitted fields, protects user edits and retires what ended', () => {
    const facts = seeded();
    assert.equal(facts.cards.length, 3);
    assert.deepEqual(facts.doneStages, ['stage-1']);
    editCard(facts, findCard(facts.cards, '林晚').id, { fields: { 性格: '倔强' } });
    const entry = applyFactsUpdate(facts, {
        cards: [{ kind: 'person', name: '小晚', aliases: ['林晚'], fields: { 处境: '在码头', 性格: '温和', 持有: '' } },
            { kind: 'person', name: '沈砚', fields: { 处境: '在码头等人' } },
            { kind: 'note', name: '便签', fields: { 内容: '不该改' } },
            { kind: 'mystery', name: '雾', fields: {} }],
        retired: ['旧铜钥匙'],
        reflection: { threads: '码头之约已赴' },
    }, { stageHash: 'stage-2', now: '2026-10-26T01:00:00.000Z' });
    const linwan = findCard(facts.cards, '林晚');
    assert.equal(linwan.fields.处境, '在码头', 'rewritten by name through an alias');
    assert.equal(linwan.fields.目标, '找到旧信的主人', 'omitted field kept');
    assert.equal(linwan.fields.性格, '倔强', 'user-edited field kept');
    assert.ok(linwan.aliases.includes('小晚'));
    assert.equal(findCard(facts.cards, '沈砚').kind, 'person');
    assert.equal(findCard(facts.cards, '旧铜钥匙').status, 'retired');
    assert.equal(facts.reflection.threads, '码头之约已赴');
    assert.equal(facts.reflection.mainline, '林晚追查旧信', 'reflection parts the model left out stay');
    assert.equal(entry.changes.length, 3);
    assert.deepEqual(entry.changes.find(change => change.name === '林晚').kept, ['性格']);
    assert.match(entry.warnings.join(' '), /便签/);
    assert.match(entry.warnings.join(' '), /雾/);
    assert.deepEqual(facts.doneStages, ['stage-1', 'stage-2']);
});

test('undo puts the cards back and reopens the stage; a second undo goes one entry further', () => {
    const facts = seeded();
    const before = JSON.stringify(facts.cards);
    applyFactsUpdate(facts, { cards: [lin('在码头'), { kind: 'person', name: '沈砚', fields: { 处境: '在码头' } }], retired: ['旧铜钥匙'] }, { stageHash: 'stage-2' });
    assert.equal(facts.cards.length, 4);
    const undone = undoFactsUpdate(facts);
    assert.equal(undone.stageHash, 'stage-2');
    assert.equal(JSON.stringify(facts.cards), before);
    assert.deepEqual(facts.doneStages, ['stage-1']);
    assert.equal(undoFactsUpdate(facts).stageHash, 'stage-1');
    assert.equal(facts.cards.length, 0);
    assert.equal(undoFactsUpdate(facts), null);
});

test('normalize drops broken cards, unknown fields and bad settings', () => {
    const facts = normalizeFacts({ cards: [{ kind: 'person', name: ' 林晚 ', fields: { 处境: 'x', 不存在: 'y' }, userFields: ['处境', '不存在'] }, { kind: 'ghost', name: 'a' }, { kind: 'item' }],
        settings: { enabled: 'yes', budgetChars: -5, maxCards: 'many' }, history: [{ id: 'h1' }, null, 'x'] });
    assert.equal(facts.cards.length, 1);
    assert.equal(facts.cards[0].name, '林晚');
    assert.deepEqual(Object.keys(facts.cards[0].fields), ['处境', '目标', '持有', '性格', '外貌', '备注']);
    assert.deepEqual(facts.cards[0].userFields, ['处境']);
    assert.equal(facts.settings.enabled, true);
    assert.equal(facts.settings.budgetChars, 500);
    assert.equal(facts.settings.maxCards, 40);
    assert.equal(facts.history.length, 1);
});

test('merging two cards keeps names as aliases and fills empty fields; user cards are protected on every field', () => {
    const facts = seeded();
    const full = createCard(facts, { kind: 'person', name: '林晚晚', fields: { 外貌: '短发' } });
    assert.deepEqual(full.userFields, ['外貌']);
    const kept = mergeCards(facts, findCard(facts.cards, '林晚').id, full.id);
    assert.ok(kept.aliases.includes('林晚晚'));
    assert.equal(kept.fields.外貌, '短发');
    assert.equal(facts.cards.length, 3);
    assert.equal(mergeCards(facts, kept.id, findCard(facts.cards, '码头之约').id), null, 'kinds must match');
});

test('relevant cards are the ones the text names, plus pinned, open threads and notes', () => {
    const facts = seeded();
    createCard(facts, { kind: 'note', name: '写作要求', fields: { 内容: '少写环境描写' } });
    createCard(facts, { kind: 'rule', name: '雾都', fields: { 说明: '常年有雾' } });
    const picked = selectRelevantCards(facts.cards, '沈砚在码头等林晚。').map(card => card.name);
    assert.deepEqual(picked, ['写作要求', '码头之约', '林晚']);
    findCard(facts.cards, '雾都').pinned = true;
    assert.ok(selectRelevantCards(facts.cards, '无关文字').map(card => card.name).includes('雾都'));
});

test('the parser takes the tagged JSON through fences and loose syntax, and refuses garbage', () => {
    assert.equal(parseFactCards('```json\n<factCards>{"cards":[{"kind":"person","name":"甲","fields":{}},],}</factCards>\n```').cards.length, 1);
    assert.equal(parseFactCards("<factCards>{cards: [{kind: 'person', name: '甲', fields: {处境: '在家'}}], retired: ['乙']}</factCards>").retired[0], '乙');
    assert.deepEqual(parseFactCards('{"reflection":{"mainline":"x"}}').reflection, { mainline: 'x' });
    assert.throws(() => parseFactCards('好的，我来整理。'), /没有找到/);
    assert.throws(() => parseFactCards('<factCards>{"cards": [}</factCards>'), /无法解析/);
    assert.throws(() => parseFactCards('<factCards>{"note":1}</factCards>'), /cards/);
});

test('the prompt carries only the cards the material names, the notes, the reflection and the material', () => {
    const facts = seeded();
    createCard(facts, { kind: 'note', name: '写作要求', fields: { 内容: '少写环境描写' } });
    createCard(facts, { kind: 'rule', name: '雾都', fields: { 说明: '常年有雾' } });
    editCard(facts, findCard(facts.cards, '林晚').id, { fields: { 性格: '倔强' } });
    const { prompt, systemPrompt, cardIds } = buildFactsPrompt(facts, '林晚赴了码头之约。', { timeContext: '当前剧情时间：3月1日' });
    assert.ok(prompt.startsWith('当前剧情时间：3月1日'));
    assert.match(prompt, /"name": "林晚"/);
    assert.match(prompt, /"用户填写": \[\s*"性格"\s*\]/);
    assert.match(prompt, /码头之约/);
    assert.doesNotMatch(prompt, /雾都/);
    assert.match(prompt, /写作要求：少写环境描写/);
    assert.match(prompt, /主线：林晚追查旧信/);
    assert.match(prompt, /材料：\n林晚赴了码头之约。/);
    assert.ok(!prompt.includes('{{'));
    assert.equal(cardIds.length, 2);
    assert.match(systemPrompt, /factCards/);
    assert.match(defaultFactsPrompt, /目标=想要什么|\{\{fields\}\}/);
});

test('the injected section fits the budget, names what the recent floors name, and carries the reflection', () => {
    const facts = seeded();
    const full = renderFactsSection(facts, '林晚在码头。', { budgetChars: 6000 });
    assert.match(full.text, /^## 剧情事实\n/);
    assert.match(full.text, /人物 林晚：处境 在书店；目标 找到旧信的主人/);
    assert.match(full.text, /线索 码头之约/);
    assert.doesNotMatch(full.text, /旧铜钥匙/, 'not named, not pinned');
    assert.match(full.text, /## 主线与伏笔\n主线：林晚追查旧信/);
    const tight = renderFactsSection(facts, '林晚在码头。', { budgetChars: 80 });
    assert.ok(tight.omitted >= 1);
    assert.ok(tight.text.length <= 80 + 40);
    facts.settings.enabled = false;
    assert.equal(renderFactsSection(facts, '林晚').text, '');
});


test('整理 waits for a batch of new 剧情摘要, reads them oldest first and leaves the open reply out', async () => {
    const r = runtime({ every: 3, summaries: 2, floors: 13 });
    assert.equal(r.controller.pendingSummaries().length, 2);
    assert.equal(r.controller.maybeRun(), null, 'two of three: not yet');
    r.addSummary(6);
    const task = r.controller.onSummaryCommitted();
    assert.equal(task.kind, 'facts');
    assert.equal(task.label, '整理事实 · 第 2–6 楼 · 3 条摘要');
    assert.deepEqual([task.metadata.factsFloorFrom, task.metadata.factsFloorTo, task.metadata.factsCount], [2, 6, 3]);
    assert.match(task.prompt, /第 2 楼：林晚去码头。\n\n第 4 楼：林晚去码头。\n\n第 6 楼：林晚去码头。/);
    assert.doesNotMatch(task.prompt, /<bakemono>/);
    assert.equal(r.controller.pendingSummaries().length, 0, 'queued floors are not pending');
    assert.equal(r.controller.maybeRun(), null, 'one task at a time');
    r.setResult(reply([lin('在码头')], { reflection: { mainline: '旧信之谜' } }));
    await r.queue.processTaskQueue();
    assert.equal(task.status, 'done');
    assert.equal(r.state.facts.lastIntegratedFloor, 6);
    assert.equal(r.state.facts.cards.length, 1);
    assert.ok(r.scopes.some(text => /整理完成：新建 1 张/.test(text)));
    // The open reply's summary waits for the next message.
    r.addSummary(12);
    assert.equal(r.controller.pendingSummaries().length, 0, 'floor 12 is the reply that can still be rerolled');
    r.chat.push({ mes: '去吧。', is_user: true });
    assert.equal(r.controller.pendingSummaries().length, 1);
});

test('a backlog is worked through one batch at a time; manual 整理 takes everything pending in one request', async () => {
    const r = runtime({ every: 2, summaries: 5, floors: 14 });
    assert.equal(r.controller.pendingSummaries().length, 5);
    const first = r.controller.maybeRun();
    assert.equal(first.metadata.factsCount, 2);
    r.setResult(reply([lin()]));
    await r.queue.processTaskQueue();
    const queued = r.state.taskQueue.filter(task => task.kind === 'facts');
    assert.equal(queued.length, 2, 'the next batch is queued when the first lands');
    assert.deepEqual([queued[1].metadata.factsFloorFrom, queued[1].metadata.factsFloorTo], [6, 8]);
    await r.queue.processTaskQueue();
    assert.equal(r.state.facts.lastIntegratedFloor, 8);
    assert.equal(r.controller.pendingSummaries().length, 1, 'one left, below the batch size');
    assert.equal(r.controller.maybeRun(), null);
    const manual = await r.controller.runManual();
    assert.equal(manual.trigger, 'facts_manual');
    assert.equal(manual.metadata.factsCount, 1);
    await r.queue.processTaskQueue();
    assert.equal(r.state.facts.lastIntegratedFloor, 10);
    assert.equal(await r.controller.runManual(), null);
    assert.match(r.toasts.at(-1)[1], /没有新的剧情摘要/);
});

test('after the chat goes idle, whatever is pending is consolidated even below the batch size', async () => {
    const r = runtime({ every: 6, summaries: 2, idleMinutes: 10 });
    r.controller.noteActivity();
    assert.equal(r.timers.length, 1);
    assert.equal(r.timers[0].ms, 10 * 60 * 1000);
    r.controller.noteActivity();
    assert.equal(r.timers[0].cleared, true, 'a new message restarts the timer');
    r.timers[1].fn();
    const task = r.state.taskQueue.find(item => item.kind === 'facts');
    assert.equal(task.trigger, 'facts_idle');
    assert.equal(task.metadata.factsCount, 2);
    // A timer set in another chat does nothing when it fires.
    const other = runtime({ every: 6, summaries: 2 });
    other.controller.noteActivity();
    other.switchChat();
    other.timers[0].fn();
    assert.equal(other.state.taskQueue.length, 0);
    // idleMinutes 0 sets no timer.
    const off = runtime({ idleMinutes: 0 });
    off.controller.noteActivity();
    assert.equal(off.timers.length, 0);
});

test('an unreadable reply fails only that task: cards untouched, cursor unmoved, queue not paused', async () => {
    const r = runtime({ every: 3, summaries: 3 });
    const task = r.controller.maybeRun();
    r.setResult('抱歉，我无法整理。');
    await r.queue.processTaskQueue();
    assert.equal(task.status, 'failed');
    assert.match(task.error, /没有找到/);
    assert.equal(r.state.facts.cards.length, 0);
    assert.equal(r.state.facts.lastIntegratedFloor, -1);
    assert.ok(!r.state.taskQueuePaused);
    assert.equal(r.controller.pendingSummaries().length, 3);
});

test('undoLast reverts the latest 整理 and moves the cursor back so the summaries count as pending again', async () => {
    const r = runtime({ every: 3, summaries: 3 });
    r.controller.maybeRun();
    r.setResult(reply([lin()]));
    await r.queue.processTaskQueue();
    assert.equal(r.state.facts.lastIntegratedFloor, 6);
    const entry = await r.controller.undoLast();
    assert.equal(entry.floorTo, 6);
    assert.equal(r.state.facts.lastIntegratedFloor, -1);
    assert.equal(r.state.facts.cards.length, 0);
    assert.equal(r.controller.pendingSummaries().length, 3);
    assert.equal(await r.controller.undoLast(), null);
});

test('with 先审再用 the result waits in 待确认 as a diff; applying it moves the cursor, discarding reopens the summaries', async () => {
    const r = runtime({ review: true, every: 3, summaries: 3 });
    const task = r.controller.maybeRun();
    r.setResult(reply([lin()], { reflection: { mainline: '旧信之谜' } }));
    await r.queue.processTaskQueue();
    assert.equal(task.status, 'done');
    assert.equal(r.state.facts.cards.length, 0, 'nothing applied yet');
    assert.equal(r.state.facts.lastIntegratedFloor, -1);
    const draft = r.state.drafts[0];
    assert.equal(draft.kind, 'facts');
    assert.equal(draft.metadata.factsFloorTo, 6);
    assert.equal(summarizeFactsChanges(draft.metadata.factsPreview), '新建 1 张，反思更新');
    assert.match(renderFactsChanges(draft.metadata.factsPreview), /新建<\/span> 人物 · 林晚/);
    assert.equal(r.controller.pendingSummaries().length, 0, 'held summaries are not queued again');
    const entry = await r.controller.applyDraft(draft.id);
    assert.equal(entry.changes.length, 1);
    assert.equal(r.state.drafts.length, 0);
    assert.equal(r.state.facts.lastIntegratedFloor, 6);
    assert.equal(r.state.facts.reflection.mainline, '旧信之谜');
    // Held then discarded: pending again.
    r.state.facts.lastIntegratedFloor = -1; r.state.facts.integrated = {};
    r.controller.maybeRun();
    await r.queue.processTaskQueue();
    assert.equal(r.state.drafts.length, 1);
    assert.equal(r.controller.discardDraft(r.state.drafts[0].id), true);
    assert.equal(r.controller.pendingSummaries().length, 3);
});

test('a chat consolidated per stage before v1.34 starts its cursor after the stages already done', () => {
    const r = runtime({ summaries: 3 });
    r.state.facts.doneStages = ['st1'];
    delete r.state.facts.integrated; // a chat from before v1.34.1 has no per-summary record yet
    r.state.stageSummaries = [{ hash: 'st1', sourceMessageIds: [1, 2, 3, 4] }];
    assert.equal(r.controller.facts().lastIntegratedFloor, 4);
    assert.deepEqual(r.controller.pendingSummaries().map(entry => entry.floorEnd), [6]);
});

test('card actions through the controller: edit protects fields, pin, retire, merge, delete, history per card', async () => {
    const r = runtime({ every: 1, summaries: 1 });
    r.controller.maybeRun();
    r.setResult(reply([lin(), { kind: 'person', name: '林小晚', fields: { 外貌: '短发' } }]));
    await r.queue.processTaskQueue();
    const facts = r.state.facts;
    const linwan = facts.cards.find(card => card.name === '林晚'), twin = facts.cards.find(card => card.name === '林小晚');
    r.controller.saveCard(linwan.id, { fields: { 处境: '在码头', 目标: '找到旧信的主人' }, aliases: ['小晚'] });
    assert.deepEqual(linwan.userFields, ['处境']);
    assert.deepEqual(linwan.aliases, ['小晚']);
    r.controller.saveCard(linwan.id, { pinned: true });
    assert.equal(linwan.pinned, true);
    r.controller.saveCard(linwan.id, { status: 'retired' });
    assert.equal(linwan.status, 'retired');
    r.controller.saveCard(linwan.id, { status: 'active' });
    assert.equal(r.controller.cardHistory(linwan.id).length, 5, 'the 整理 that created the card, then four edits');
    assert.ok(r.controller.cardHistory(linwan.id).every(entry => entry.changes.every(change => change.cardId === linwan.id)));
    assert.equal(r.controller.mergeInto(linwan.id, twin.id).fields.外貌, '短发');
    assert.ok(linwan.aliases.includes('林小晚'));
    assert.equal(facts.cards.length, 1);
    const note = r.controller.addCard({ kind: 'note', name: '写作要求', fields: { 内容: '少写环境' } });
    assert.equal(note.kind, 'note');
    assert.equal(await r.controller.deleteCard(note.id), true);
    assert.equal(facts.cards.length, 1);
    assert.equal(await r.controller.deleteCard('missing'), false);
});

test('settings saved before v1.32.0 get the new default (on) once; a deliberate off afterwards stays off', () => {
    assert.equal(normalizeFacts({ settings: { enabled: false } }).settings.enabled, true, 'no version: pre-1.32 defaults');
    assert.equal(normalizeFacts({ settings: { version: 2, enabled: false } }).settings.enabled, false);
    assert.equal(normalizeFacts({}).settings.enabled, true);
    assert.equal(normalizeFacts(createDefaultFacts()).settings.version, 2);
    assert.deepEqual([normalizeFacts({}).settings.everySummaries, normalizeFacts({}).settings.idleMinutes], [6, 10]);
    assert.deepEqual([normalizeFacts({ settings: { everySummaries: 0, idleMinutes: -5 } }).settings.everySummaries, normalizeFacts({ settings: { idleMinutes: 0 } }).settings.idleMinutes], [6, 0], '0 批次大小回到默认；0 分钟是关');
});
