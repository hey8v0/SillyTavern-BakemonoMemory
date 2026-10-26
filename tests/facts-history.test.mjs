import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFactsUpdate, createDefaultFacts, editCard, findCard, normalizeFacts, resolveConflict, seedTimelines, selectRelevantCards, undoFactsUpdate } from '../src/facts/model.js';
import { renderFactCardLine, renderFactsSection, renderReflection } from '../src/facts/injection.js';
import { buildFactsPrompt, cardForPrompt, defaultFactsPrompt } from '../src/facts/prompt.js';
import { parseFactCards } from '../src/facts/parser.js';
import { factsRuntime, reply } from './helpers/facts-runtime.mjs';

// Offline RP memory scenarios for batch 2: key transitions are kept per card (timeline), the current state stays
// current, and what ended leaves the reminders but can still be found.
const at = n => `2026-10-26T11:${String(n).padStart(2, '0')}:00.000Z`;
const step = (facts, cards, floorTo, n, extra = {}) => applyFactsUpdate(facts, { cards, ...extra }, { floorTo, sources: [{ hash: `h${floorTo}`, revision: '1' }], now: at(n) });

function world() {
    const facts = createDefaultFacts();
    step(facts, [
        { kind: 'person', name: '林晚', fields: { 处境: '在书店', 目标: '寻找失踪的姐姐', 持有: '旧铜钥匙' } },
        { kind: 'person', name: '沈砚', fields: { 处境: '在码头' } },
        { kind: 'item', name: '旧铜钥匙', fields: { 持有者: '林晚', 描述: '书店后门的钥匙' } },
        { kind: 'relationship', name: '林晚与沈砚', fields: { 双方: '林晚 与 沈砚', 当前关系: '陌生人', 基础关系: '同乡' } },
        { kind: 'thread', name: '码头之约', fields: { 内容: '明晚码头见', 状态: '未了', 参与者: '林晚、沈砚' } },
    ], 10, 0);
    return facts;
}

test('场景 3 物品转移：持有者每次换手都留在经过里，现状只有最后一位，注入时带一句曾经', () => {
    const facts = world();
    step(facts, [{ kind: 'item', name: '旧铜钥匙', fields: { 持有者: '沈砚' } }, { kind: 'person', name: '林晚', fields: { 持有: null } }], 24, 1);
    step(facts, [{ kind: 'item', name: '旧铜钥匙', fields: { 持有者: '阿砚' } }], 51, 2);
    step(facts, [{ kind: 'item', name: '旧铜钥匙', fields: { 描述: '书店后门的钥匙，齿已磨平' } }], 60, 3);
    const key = findCard(facts.cards, '旧铜钥匙');
    assert.equal(key.fields.持有者, '阿砚');
    assert.deepEqual(key.timeline.map(item => [item.field, item.from, item.to, item.floor]), [['持有者', '林晚', '沈砚', 24], ['持有者', '沈砚', '阿砚', 51]], 'a description edit is not a transition');
    assert.deepEqual(findCard(facts.cards, '林晚').timeline.map(item => [item.field, item.from, item.to]), [['持有', '旧铜钥匙', '']]);
    const line = renderFactCardLine(key);
    assert.match(line, /^物品 旧铜钥匙：持有者 阿砚；/);
    assert.match(line, /曾经：持有者 林晚（到第 24 楼）、沈砚（到第 51 楼）/);
    assert.match(JSON.stringify(cardForPrompt(key)), /经过/);
    // Undo takes the transition with it; the one before stays.
    undoFactsUpdate(facts, facts.history.at(-2).id, at(4));
    assert.equal(key.fields.持有者, '沈砚');
    assert.deepEqual(key.timeline.map(item => item.to), ['沈砚']);
});

test('场景 4 关系演变：当前关系换了几次，最近的转折还能找回；上限之外最旧的让位', () => {
    const facts = world();
    const stages = ['点头之交', '互相试探', '秘密恋人', '冷战中'];
    stages.forEach((value, index) => step(facts, [{ kind: 'relationship', name: '林晚与沈砚', fields: { 当前关系: value } }], 20 + index * 10, index + 1));
    const card = findCard(facts.cards, '林晚与沈砚');
    assert.equal(card.fields.当前关系, '冷战中');
    assert.deepEqual(card.timeline.map(item => item.from), ['陌生人', ...stages.slice(0, 3)]);
    assert.match(renderFactCardLine(card), /曾经：当前关系 互相试探（到第 40 楼）、秘密恋人（到第 50 楼）/, 'the two most recent transitions');
    for (let index = 0; index < 15; index++) step(facts, [{ kind: 'relationship', name: '林晚与沈砚', fields: { 当前关系: `阶段${index}` } }], 100 + index, 10 + index);
    assert.equal(card.timeline.length, 12, 'capped per card');
    assert.equal(card.timeline[0].from, '阶段2');
});

test('场景 6 人物死亡：结束的卡不再主动注入，但最近楼层点名时仍带出来并标明已结束', () => {
    const facts = world();
    step(facts, [{ kind: 'person', name: '沈砚', fields: { 处境: '死于码头的雨夜' } }], 70, 1, { retired: ['沈砚'] });
    const shen = findCard(facts.cards, '沈砚');
    assert.equal(shen.status, 'retired');
    assert.ok(shen.timeline.some(item => item.field === '已结束' && item.floor === 70));
    assert.deepEqual(selectRelevantCards(facts.cards, '林晚独自回到书店。').map(card => card.name).includes('沈砚'), false);
    assert.ok(selectRelevantCards(facts.cards, '她想起沈砚。').some(card => card.name === '沈砚'), 'named: recalled');
    assert.match(renderFactsSection(facts, '她想起沈砚。').text, /人物 沈砚（已结束）：处境 死于码头的雨夜/);
    assert.doesNotMatch(renderFactsSection(facts, '林晚独自回到书店。').text, /沈砚（已结束）/);
});

test('场景 7 伏笔回收：伏笔与约定从线索卡派生，了结的退出提醒但卡片还在、点名能找回', () => {
    const facts = world();
    assert.match(renderReflection(facts.reflection, facts.cards), /伏笔与约定：码头之约（未了；林晚、沈砚）/);
    step(facts, [{ kind: 'thread', name: '码头之约', fields: { 状态: '已了，两人见了面' } }], 30, 1, { reflection: { mainline: '林晚追查旧信', threads: '模型自己写的伏笔，不再注入' } });
    const reflection = renderReflection(facts.reflection, facts.cards);
    assert.doesNotMatch(reflection, /码头之约/);
    assert.doesNotMatch(reflection, /模型自己写的伏笔/);
    assert.match(reflection, /主线：林晚追查旧信/);
    const thread = findCard(facts.cards, '码头之约');
    assert.equal(thread.status, 'active');
    assert.deepEqual(thread.timeline.map(item => [item.field, item.to]), [['状态', '已了，两人见了面']]);
    assert.ok(!selectRelevantCards(facts.cards, '林晚翻着日记。').some(card => card.name === '码头之约'), 'closed: no longer a standing reminder');
    assert.ok(selectRelevantCards(facts.cards, '她想起码头之约。').some(card => card.name === '码头之约'));
    // A chat without thread cards still shows what the model wrote before (older chats).
    const legacy = createDefaultFacts();
    legacy.reflection.threads = '旧档里的伏笔';
    assert.match(renderReflection(legacy.reflection, legacy.cards), /伏笔与约定：旧档里的伏笔/);
    assert.ok(!defaultFactsPrompt.includes('threads 未回收'), 'the model is no longer asked to rewrite the threads text');
    assert.match(defaultFactsPrompt, /thread/);
});

test('older chats get their timelines from the history they already have, once', () => {
    const facts = world();
    step(facts, [{ kind: 'person', name: '林晚', fields: { 处境: '在码头' } }], 20, 1);
    step(facts, [{ kind: 'person', name: '林晚', fields: { 处境: '在北方' } }], 40, 2);
    for (const card of facts.cards) delete card.timeline;
    delete facts.timelineVersion;
    const normalized = normalizeFacts(facts);
    assert.deepEqual(normalized.cards.map(card => card.timeline), normalized.cards.map(() => []));
    assert.equal(seedTimelines(normalized), 2, 'two moves; the first state of a field is not a transition');
    assert.deepEqual(findCard(normalized.cards, '林晚').timeline.map(item => [item.from, item.to, item.floor]), [['在书店', '在码头', 20], ['在码头', '在北方', 40]]);
    assert.equal(normalized.timelineVersion, 1);
    assert.equal(seedTimelines(normalized), 0, 'not twice');
});

test('a conflict the user accepts is a transition; a plain user correction is not; the card page data carries 经过', async () => {
    const facts = world();
    editCard(facts, findCard(facts.cards, '林晚').id, { fields: { 处境: '在书店二楼' } }, at(1));
    assert.deepEqual(findCard(facts.cards, '林晚').timeline, []);
    step(facts, [], 44, 2, { conflicts: [{ name: '林晚', field: '处境', says: '在北方矿山' }] });
    resolveConflict(facts, facts.conflicts[0].id, 'accept', at(3));
    assert.deepEqual(findCard(facts.cards, '林晚').timeline.map(item => [item.from, item.to, item.floor]), [['在书店二楼', '在北方矿山', 44]]);
    const r = factsRuntime({ every: 3, summaries: 3 });
    r.controller.maybeRun();
    r.setResult(reply([{ kind: 'person', name: '林晚', fields: { 处境: '在码头' } }]));
    await r.queue.processTaskQueue();
    assert.equal(r.controller.facts().timelineVersion, 1);
    assert.deepEqual(parseFactCards('<factCards>{"cards":[],"reflection":{"mainline":"x","threads":"y"}}</factCards>').reflection, { mainline: 'x', threads: 'y' });
    const { prompt } = buildFactsPrompt(facts, '林晚');
    assert.match(prompt, /未了的线索/);
});
