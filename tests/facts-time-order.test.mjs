import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFactsUpdate, createDefaultFacts, editCard, findCard, resolveConflict, undoFactsUpdate } from '../src/facts/model.js';
import { renderFactsSection } from '../src/facts/injection.js';
import { buildFactsPrompt, defaultFactsPrompt } from '../src/facts/prompt.js';
import { parseFactCards } from '../src/facts/parser.js';
import { factsRuntime, reply } from './helpers/facts-runtime.mjs';

// Reliability batch after v1.38.0: an ended card is not brought back by a mention, a held result whose material
// changed is not applied blindly, and material older than a card's current state does not replace it.
const at = n => `2026-10-27T09:${String(n).padStart(2, '0')}:00.000Z`;
const step = (facts, cards, floorFrom, floorTo, n, extra = {}) => applyFactsUpdate(facts, { cards, ...extra },
    { floorFrom, floorTo, sources: [{ hash: `h${floorFrom}-${floorTo}`, revision: '1', floorEnd: floorTo }], now: at(n) });

function world() {
    const facts = createDefaultFacts();
    step(facts, [
        { kind: 'person', name: '林晚', fields: { 处境: '在书店', 目标: '寻找姐姐', 持有: '铜钥匙' } },
        { kind: 'person', name: '老看守', fields: { 处境: '守在矿坑门口' } },
        { kind: 'item', name: '铜钥匙', fields: { 持有者: '林晚', 描述: '刻着青字' } },
        { kind: 'thread', name: '码头之约', fields: { 内容: '明晚码头见', 状态: '未了' } },
    ], 2, 20, 0);
    step(facts, [{ kind: 'person', name: '老看守', fields: { 处境: '死于塌方' } }], 50, 60, 1, { retired: ['老看守'] });
    step(facts, [{ kind: 'item', name: '铜钥匙', fields: { 持有者: '阿砚' } }, { kind: 'person', name: '林晚', fields: { 持有: null } }], 98, 108, 2);
    return facts;
}

// 1. Ended cards.
test('an ended card mentioned again keeps its end: the fields may be filled in, the status stays', () => {
    const facts = world();
    const entry = step(facts, [{ kind: 'person', name: '老看守', fields: { 备注: '生前把另一把钥匙交给了林晚' } }], 110, 120, 3);
    const keeper = findCard(facts.cards, '老看守');
    assert.equal(keeper.status, 'retired', 'v1.38.0 set every touched card back to active');
    assert.equal(keeper.fields.备注, '生前把另一把钥匙交给了林晚');
    assert.equal(entry.changes[0].statusAfter, 'retired');
    assert.doesNotMatch(renderFactsSection(facts, '林晚在铺子里。').text, /老看守/, 'still not injected unless named');
    // A backfilled floor from when he was alive does not bring him back either.
    step(facts, [{ kind: 'person', name: '老看守', fields: { 处境: '在矿坑门口打盹' } }], 30, 30, 4);
    assert.equal(keeper.status, 'retired');
    assert.equal(keeper.fields.处境, '死于塌方', 'older material does not replace the state at his death');
});

test('a card comes back only when the result says so (revived) and the material is newer than its end', () => {
    const facts = world();
    const older = step(facts, [], 40, 48, 3, { revived: ['老看守'] });
    assert.equal(findCard(facts.cards, '老看守').status, 'retired', 'material from before the death cannot revive');
    assert.match(older.warnings.join(' '), /老看守.*早于/);
    const entry = step(facts, [{ kind: 'person', name: '老看守', fields: { 处境: '被巫医救活，躺在客栈' } }], 130, 140, 4, { revived: ['老看守'] });
    const keeper = findCard(facts.cards, '老看守');
    assert.equal(keeper.status, 'active');
    assert.ok(keeper.timeline.some(item => item.field === '恢复' && item.floor === 140));
    assert.equal(entry.changes.find(change => change.name === '老看守').statusAfter, 'active');
    undoFactsUpdate(facts, entry.id, at(5));
    assert.equal(keeper.status, 'retired', 'undo ends him again');
    assert.ok(!keeper.timeline.some(item => item.field === '恢复'));
    // The parser and the prompt know about revived.
    assert.deepEqual(parseFactCards('<factCards>{"cards":[],"revived":["老看守",{"name":"码头之约"}]}</factCards>').revived, ['老看守', '码头之约']);
    assert.match(defaultFactsPrompt, /revived/);
    const { prompt } = buildFactsPrompt(facts, '老看守又出现了。');
    assert.match(prompt, /"已结束": true/, 'the model sees which cards ended');
});

test('a card the user ended by hand is not revived by the model: it becomes a conflict for the user', () => {
    const facts = world();
    const thread = findCard(facts.cards, '码头之约');
    editCard(facts, thread.id, { status: 'retired' }, at(3));
    const entry = step(facts, [{ kind: 'thread', name: '码头之约', fields: { 状态: '未了，改到后天' } }], 110, 120, 4, { revived: ['码头之约'] });
    assert.equal(thread.status, 'retired');
    assert.equal(facts.conflicts.length, 1);
    assert.equal(facts.conflicts[0].field, '恢复');
    assert.deepEqual(entry.conflicts, [facts.conflicts[0].id]);
    resolveConflict(facts, facts.conflicts[0].id, 'accept', at(5));
    assert.equal(thread.status, 'active', 'the user may accept it');
});

// 3. Older material against the current state.
test('a backfilled old floor keeps the current holder: the old value goes into 经过 as what was true then', () => {
    const facts = world();
    const entry = step(facts, [{ kind: 'item', name: '铜钥匙', fields: { 持有者: '林晚', 描述: '刻着青字，齿已磨平' } }, { kind: 'person', name: '林晚', fields: { 持有: '铜钥匙' } }], 12, 12, 3);
    const key = findCard(facts.cards, '铜钥匙');
    assert.equal(key.fields.持有者, '阿砚', 'floor 12 cannot undo the handover at floor 98–108');
    assert.equal(key.fields.描述, '刻着青字，齿已磨平', 'a non-state field is still filled in');
    assert.equal(findCard(facts.cards, '林晚').fields.持有, '', 'the cleared 持有 stays cleared');
    assert.ok(key.timeline.some(item => item.past && item.field === '持有者' && item.from === '林晚' && item.floor === 12));
    assert.match(entry.warnings.join(' '), /铜钥匙.*持有者.*第 12 楼/);
    const line = renderFactsSection(facts, '铜钥匙').text;
    assert.match(line, /物品 铜钥匙：持有者 阿砚/);
    assert.match(line, /曾经：持有者 林晚（第 12 楼时）/, 'the old value reads as what held then, not as a new change');
    assert.match(JSON.stringify(buildFactsPrompt(facts, '铜钥匙').prompt), /第 12 楼 持有者：林晚（当时）/);
});

test('a rerolled or corrected floor inside the batch that set the state may still correct it', () => {
    const facts = world();
    step(facts, [{ kind: 'person', name: '林晚', fields: { 处境: '商量春天去领主府' } }], 110, 120, 3);
    step(facts, [{ kind: 'person', name: '林晚', fields: { 处境: '决定明天一早去领主府' } }], 118, 118, 4);
    assert.equal(findCard(facts.cards, '林晚').fields.处境, '决定明天一早去领主府');
});

test('cards from before this version: the floor a field was set at comes from the history', () => {
    const facts = world();
    for (const card of facts.cards) delete card.asOf;
    step(facts, [{ kind: 'item', name: '铜钥匙', fields: { 持有者: '林晚' } }], 12, 12, 3);
    assert.equal(findCard(facts.cards, '铜钥匙').fields.持有者, '阿砚');
});

test('undo puts the state floors back with the fields', () => {
    const facts = world();
    const later = step(facts, [{ kind: 'item', name: '铜钥匙', fields: { 持有者: '领主' } }], 130, 140, 3);
    undoFactsUpdate(facts, later.id, at(4));
    const key = findCard(facts.cards, '铜钥匙');
    assert.equal(key.fields.持有者, '阿砚');
    step(facts, [{ kind: 'item', name: '铜钥匙', fields: { 持有者: '沈砚' } }], 100, 100, 5);
    assert.equal(key.fields.持有者, '沈砚', 'floor 100 is inside the batch that set 阿砚 (98–108): it may correct it');
});

// The controller keeps older material in batches of its own, so the floors above mean what they say.
test('backfilled summaries are consolidated in a batch of their own, apart from new ones', async () => {
    const r = factsRuntime({ every: 3, summaries: 0, floors: 30 });
    [6, 8, 10].forEach(floor => r.addSummary(floor));
    r.controller.maybeRun();
    r.setResult(reply([]));
    await r.queue.processTaskQueue();
    r.addSummary(2, '补写的第 2 楼。');
    [12, 14, 16].forEach(floor => r.addSummary(floor));
    r.chat.push({ mes: '继续。', is_user: true });
    const task = await r.controller.runManual();
    assert.deepEqual([task.metadata.factsFloorFrom, task.metadata.factsFloorTo, task.metadata.factsCount], [2, 2, 1]);
    assert.equal(task.metadata.factsRemaining, 3);
    await r.queue.processTaskQueue();
    const next = r.factsTasks().at(-1);
    assert.deepEqual([next.metadata.factsFloorFrom, next.metadata.factsFloorTo], [12, 16]);
});

// 2. Held results whose material moved on.
test('a held result whose summaries changed is not applied: cards untouched, the draft says why, discarding reopens', async () => {
    const r = factsRuntime({ review: true, every: 3, summaries: 3 });
    r.controller.maybeRun();
    r.setResult(reply([{ kind: 'person', name: '林晚', fields: { 处境: '在码头' } }]));
    await r.queue.processTaskQueue();
    const draft = r.state.drafts[0];
    r.editSummary(4, '林晚其实一直在书店。');
    const result = await r.controller.applyDraft(draft.id);
    assert.equal(result, null);
    assert.equal(r.state.facts.cards.length, 0);
    assert.deepEqual(r.state.facts.integrated, {});
    assert.equal(r.state.drafts.length, 1, 'kept, so the user can read it');
    assert.match(draft.metadata.inputError, /第 4 楼.*改/, "a reply block rewritten by an edit or a reroll");
    assert.match(r.toasts.at(-1)[1], /没有应用/);
    r.controller.discardDraft(draft.id);
    assert.deepEqual(r.pendingFloors(), [2, 4, 6]);
});

test('a held result whose summary was deleted, or that was made in another chat, is refused too', async () => {
    const r = factsRuntime({ review: true, every: 3, summaries: 3 });
    r.controller.maybeRun();
    r.setResult(reply([{ kind: 'person', name: '林晚', fields: { 处境: '在码头' } }]));
    await r.queue.processTaskQueue();
    r.removeSummary(2);
    assert.equal(await r.controller.applyDraft(r.state.drafts[0].id), null);
    assert.match(r.state.drafts[0].metadata.inputError, /第 2 楼.*删除/);
    assert.equal(r.state.facts.cards.length, 0);
});

test('a held result applied after the cards moved on is applied afresh and says so; an older held result cannot undo a newer one', async () => {
    const r = factsRuntime({ review: true, every: 3, summaries: 6, floors: 16 });
    r.controller.maybeRun();
    r.setResult(reply([{ kind: 'item', name: '铜钥匙', fields: { 持有者: '林晚' } }]));
    await r.queue.processTaskQueue();
    r.controller.maybeRun();
    r.setResult(reply([{ kind: 'item', name: '铜钥匙', fields: { 持有者: '阿砚' } }]));
    await r.queue.processTaskQueue();
    assert.equal(r.state.drafts.length, 2, 'two held results, floors 2–6 and 8–12');
    const [newer, older] = r.state.drafts;
    assert.equal(newer.metadata.factsFloorFrom, 8);
    await r.controller.applyDraft(newer.id);
    const entry = await r.controller.applyDraft(older.id);
    const key = r.state.facts.cards.find(card => card.name === '铜钥匙');
    assert.equal(key.fields.持有者, '阿砚', 'floors 2–6 cannot replace what floors 8–12 set');
    assert.match(entry.warnings.join(' '), /卡片在审阅期间有改动/);
    assert.equal(Object.keys(r.state.facts.integrated).length, 6);
});

test('a held result whose saved summary was edited in place says so', async () => {
    const r = factsRuntime({ review: true, every: 3, summaries: 3 });
    r.controller.maybeRun();
    r.setResult(reply([{ kind: 'person', name: '林晚', fields: { 处境: '在码头' } }]));
    await r.queue.processTaskQueue();
    r.editSummary(2, '第 2 楼改过的摘要。');
    assert.equal(await r.controller.applyDraft(r.state.drafts[0].id), null);
    assert.match(r.state.drafts[0].metadata.inputError, /第 2 楼的摘要在整理之后改过/);
});
