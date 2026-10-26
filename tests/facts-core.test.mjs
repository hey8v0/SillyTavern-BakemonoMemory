import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFactsUpdate, createCard, createDefaultFacts, editCard, findCard, mergeCards, normalizeFacts, selectRelevantCards, undoFactsUpdate } from '../src/facts/model.js';
import { parseFactCards } from '../src/facts/parser.js';
import { buildFactsPrompt, defaultFactsPrompt } from '../src/facts/prompt.js';
import { renderFactsSection } from '../src/facts/injection.js';
import { renderFactsChanges, summarizeFactsChanges } from '../src/facts/diff.js';
import { createFactsController } from '../src/features/facts-controller.js';
import { createSummaryTaskQueue } from '../src/features/summary-task-queue.js';
import { getHash } from '../src/shared/text.js';

const blockTypes = { STORY: 'story', STAGE: 'stage', EPIC: 'epic', FACTS: 'facts' };
const reply = (cards, extra = {}) => `好的。\n<factCards>\n${JSON.stringify({ cards, retired: [], reflection: {}, ...extra })}\n</factCards>`;
const lin = (处境 = '在书店') => ({ kind: 'person', name: '林晚', fields: { 处境, 目标: '找到旧信的主人' } });

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

function runtime({ enabled = true, auto = true, review = false } = {}) {
    const stage = (hash, title, floors, sourceHashes) => ({ hash, type: 'stage', title, content: `阶段 ${title}`, sourceMessageIds: floors, sourceSortKey: floors[0], sourceHashes });
    const state = { facts: { ...createDefaultFacts(), settings: { ...createDefaultFacts().settings, enabled, auto, review } }, generationPrompts: {}, taskQueue: [], drafts: [],
        storySummaries: [{ hash: 's1', content: '<bakemono>林晚在书店找到旧信。</bakemono>' }, { hash: 's2', content: '林晚约沈砚明天去码头。' }],
        blocks: [{ hash: 's3', type: 'story', content: '沈砚答应了。' }], stageSummaries: [stage('st1', '第一章', [1, 2, 3], ['s1', 's2', 's3']), stage('st2', '第二章', [4, 5], ['s9'])],
        storyRecords: [], epicSummaries: [], automation: {} };
    const toasts = [], scopes = [];
    const toastr = { info: m => toasts.push(['info', m]), warning: m => toasts.push(['warning', m]), error: m => toasts.push(['error', m]), success: () => {}, clear: () => {} };
    let result = '';
    const queue = createSummaryTaskQueue({ getState: () => state, getHash, getKindLabel: k => k, saveState: () => {}, renderWorkbenchScope: (s, t) => scopes.push(t), renderTaskQueueProgress: () => {},
        workbenchRenderScopes: { DRAFTS: 'drafts' }, getIsBusy: () => false, setBusy: () => {}, toastr, callGenerationModel: async () => result, normalizeGeneratedBakemono: v => v,
        createDraft: () => { throw Error('facts never become drafts'); }, commitDraft: async () => null, blockTypes, defaultAutomation: {}, switchWorkbenchTab: () => {},
        resultHandlers: { facts: (...args) => controller.handleTaskResult(...args) } });
    const controller = createFactsController({ getState: () => state, saveState: () => {}, enqueueSummaryTask: task => queue.enqueueSummaryTask({ ...task, autoStart: false }),
        blockTypes, getBlockPlainText: text => String(text).replace(/<[^>]+>/g, ''), toastr, renderWorkbenchScope: (s, t) => scopes.push(t), workbenchRenderScopes: { DRAFTS: 'drafts' },
        confirm: async () => true, storyTimeContext: () => '',
        createDraft: data => { const draft = { id: 'draft-' + state.drafts.length, title: data.metadata?.suggestedTitle || '', ...data }; state.drafts.unshift(draft); return draft; } });
    return { state, queue, controller, toasts, scopes, setResult: value => { result = value; } };
}

test('with 先审再用 the result waits in 待确认 as a diff; applying it changes the cards, discarding reopens the stage', async () => {
    const r = runtime({ review: true });
    const task = r.controller.onSummaryCommitted(r.state.stageSummaries[0]);
    r.setResult(reply([lin()], { reflection: { mainline: '旧信之谜' } }));
    await r.queue.processTaskQueue();
    assert.equal(task.status, 'done');
    assert.equal(r.state.facts.cards.length, 0, 'nothing applied yet');
    assert.equal(r.state.drafts.length, 1);
    const draft = r.state.drafts[0];
    assert.equal(draft.kind, 'facts');
    assert.equal(draft.title, '整理事实 · 第一章');
    assert.deepEqual(draft.sourceMessageIds, []);
    assert.equal(draft.metadata.factsPreview.changes.length, 1);
    assert.equal(summarizeFactsChanges(draft.metadata.factsPreview), '新建 1 张，反思更新');
    assert.match(renderFactsChanges(draft.metadata.factsPreview), /新建<\/span> 人物 · 林晚/);
    assert.deepEqual(r.controller.stagesToIntegrate().map(stage => stage.hash), ['st2'], 'a held stage is not queued again');
    assert.equal(r.controller.onSummaryCommitted(r.state.stageSummaries[0]), null);
    const entry = await r.controller.applyDraft(draft.id);
    assert.equal(entry.changes.length, 1);
    assert.equal(r.state.drafts.length, 0);
    assert.equal(r.state.facts.cards[0].name, '林晚');
    assert.equal(r.state.facts.reflection.mainline, '旧信之谜');
    assert.deepEqual(r.state.facts.doneStages, ['st1']);
    // A second result held, then discarded: the stage is pending again.
    r.state.facts.doneStages = [];
    r.controller.onSummaryCommitted(r.state.stageSummaries[0]);
    await r.queue.processTaskQueue();
    assert.equal(r.state.drafts.length, 1);
    assert.equal(r.controller.discardDraft(r.state.drafts[0].id), true);
    assert.deepEqual(r.controller.stagesToIntegrate().map(stage => stage.hash), ['st1', 'st2']);
});

test('card actions through the controller: edit protects fields, pin, retire, merge, delete, history per card', async () => {
    const r = runtime();
    r.controller.onSummaryCommitted(r.state.stageSummaries[0]);
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

test('a saved stage summary queues one 整理 task whose material is the stage\'s own story summaries', async () => {
    const r = runtime();
    const task = r.controller.onSummaryCommitted(r.state.stageSummaries[0]);
    assert.equal(task.kind, 'facts');
    assert.equal(task.label, '整理事实 · 第一章');
    assert.equal(task.metadata.factsStageHash, 'st1');
    assert.equal(task.metadata.factsMaterial, 'story');
    assert.equal(task.metadata.factsMaterialCount, 3);
    assert.match(task.prompt, /林晚在书店找到旧信。\n\n林晚约沈砚明天去码头。\n\n沈砚答应了。/);
    assert.doesNotMatch(task.prompt, /<bakemono>/);
    assert.equal(r.controller.onSummaryCommitted(r.state.stageSummaries[0]), null, 'queued stages are not queued twice');
    assert.equal(r.controller.onSummaryCommitted({ ...r.state.stageSummaries[1], type: 'epic' }), null, 'only stage summaries');
    r.setResult(reply([lin('在书店，拿着旧信'), { kind: 'thread', name: '码头之约', fields: { 内容: '明天去码头见沈砚', 状态: '未了' } }], { reflection: { mainline: '旧信之谜' } }));
    await r.queue.processTaskQueue();
    assert.equal(task.status, 'done');
    assert.equal(r.state.facts.cards.length, 2);
    assert.deepEqual(r.state.facts.doneStages, ['st1']);
    assert.equal(task.metadata.factsChanges, 2);
    assert.ok(r.scopes.some(text => /整理完成：新建 2 张/.test(text)));
    assert.equal(r.state.drafts.length, 0);
});

test('manual 整理 takes the stages not yet integrated in story order; off or done means nothing is queued', async () => {
    const r = runtime({ auto: false });
    assert.equal(r.controller.onSummaryCommitted(r.state.stageSummaries[0]), null, 'auto off');
    const tasks = await r.controller.runManual();
    assert.deepEqual(tasks.map(task => task.metadata.factsStageHash), ['st1', 'st2']);
    assert.equal(tasks[1].metadata.factsMaterial, 'stage', 'a stage whose summaries are gone uses its own text');
    assert.deepEqual(await r.controller.runManual(), [], 'already queued');
    r.state.facts.settings.enabled = false;
    assert.deepEqual(await r.controller.runManual(), []);
    assert.match(r.toasts.at(-1)[1], /打开/);
});

test('an unreadable reply fails only that task: cards untouched, queue not paused, stage still pending', async () => {
    const r = runtime();
    const task = r.controller.onSummaryCommitted(r.state.stageSummaries[0]);
    r.setResult('抱歉，我无法整理。');
    await r.queue.processTaskQueue();
    assert.equal(task.status, 'failed');
    assert.match(task.error, /没有找到/);
    assert.equal(r.state.facts.cards.length, 0);
    assert.ok(!r.state.taskQueuePaused);
    assert.deepEqual(r.controller.stagesToIntegrate().map(stage => stage.hash), ['st1', 'st2']);
});

test('undoLast reverts the latest 整理 after confirmation and reopens its stage', async () => {
    const r = runtime();
    r.controller.onSummaryCommitted(r.state.stageSummaries[0]);
    r.setResult(reply([lin()]));
    await r.queue.processTaskQueue();
    assert.equal(r.state.facts.cards.length, 1);
    const entry = await r.controller.undoLast();
    assert.equal(entry.stageHash, 'st1');
    assert.equal(r.state.facts.cards.length, 0);
    assert.deepEqual(r.controller.stagesToIntegrate().map(stage => stage.hash), ['st1', 'st2']);
    assert.equal(await r.controller.undoLast(), null);
});
