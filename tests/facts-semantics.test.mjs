import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFactsUpdate, createDefaultFacts, findCard, undoFactsUpdate } from '../src/facts/model.js';
import { parseFactCards } from '../src/facts/parser.js';
import { renderFactsSection } from '../src/facts/injection.js';
import { describeChange, summarizeFactsChanges } from '../src/facts/diff.js';
import { defaultFactsPrompt } from '../src/facts/prompt.js';
import { factsRuntime, reply, lin } from './helpers/facts-runtime.mjs';

// Offline RP memory scenarios (第三阶段 1–10, the ones batch 1 of 第二阶段 addresses): the model's reply is scripted,
// the assertions are about what the cards and the injected text end up saying.
const at = n => `2026-10-26T10:${String(n).padStart(2, '0')}:00.000Z`;

function world() {
    const facts = createDefaultFacts();
    applyFactsUpdate(facts, { cards: [
        { kind: 'person', name: '林晚', aliases: ['小晚'], fields: { 处境: '在书店', 目标: '寻找失踪的姐姐', 持有: '旧铜钥匙' } },
        { kind: 'person', name: '沈砚', fields: { 处境: '在码头等人' } },
        { kind: 'item', name: '旧铜钥匙', fields: { 持有者: '林晚', 描述: '书店后门的钥匙' } },
    ] }, { floorTo: 20, sources: [{ hash: 'a', revision: '1' }], now: at(0) });
    return facts;
}

test('场景 2 事实变化：目标完成后 null 清空字段，省略或空串保持，注入里不再有旧目标', () => {
    const facts = world();
    const entry = applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '林晚', fields: { 目标: null, 备注: '曾经：寻找失踪的姐姐（第 40 楼找到）', 处境: '' } }] },
        { floorTo: 40, sources: [{ hash: 'b', revision: '1' }], now: at(1) });
    const card = findCard(facts.cards, '林晚');
    assert.equal(card.fields.目标, '', 'null clears');
    assert.equal(card.fields.处境, '在书店', 'an empty string still means unchanged');
    assert.match(card.fields.备注, /曾经：寻找失踪的姐姐/);
    const change = entry.changes.find(item => item.name === '林晚');
    assert.deepEqual(describeChange(change).fields.map(field => [field.key, field.after]), [['目标', ''], ['备注', '曾经：寻找失踪的姐姐（第 40 楼找到）']]);
    assert.match(summarizeFactsChanges(entry), /修改 1 张/);
    const injected = renderFactsSection(facts, '林晚').text;
    assert.doesNotMatch(injected, /目标 寻找失踪的姐姐/);
    assert.match(injected, /备注 曾经：寻找失踪的姐姐/);
    undoFactsUpdate(facts, entry.id, at(2));
    assert.equal(findCard(facts.cards, '林晚').fields.目标, '寻找失踪的姐姐', 'undo brings a cleared field back');
    // The literal marker works too, and a user-edited field is not cleared.
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '林晚', fields: { 持有: '【清除】' } }] }, { now: at(3) });
    assert.equal(findCard(facts.cards, '林晚').fields.持有, '');
});

test('场景 5 不可靠叙事：带【声称】【猜测】的内容不进现状字段，移到备注并提醒', () => {
    const facts = world();
    const entry = applyFactsUpdate(facts, { cards: [
        { kind: 'person', name: '沈砚', fields: { 处境: '【声称】去了北方矿山', 备注: '【猜测】可能欠了赌债' } },
        { kind: 'item', name: '旧铜钥匙', fields: { 持有者: '【沈砚认为】钥匙在林晚手里' } },
    ] }, { floorTo: 42, now: at(1) });
    const shen = findCard(facts.cards, '沈砚'), key = findCard(facts.cards, '旧铜钥匙');
    assert.equal(shen.fields.处境, '在码头等人', 'a claim does not become where he is');
    assert.match(shen.fields.备注, /【声称】去了北方矿山/);
    assert.match(shen.fields.备注, /【猜测】可能欠了赌债/);
    assert.equal(key.fields.持有者, '林晚');
    assert.match(key.fields.描述, /【沈砚认为】钥匙在林晚手里/);
    assert.match(entry.warnings.join(' '), /沈砚.*处境.*备注/);
    assert.match(renderFactsSection(facts, '沈砚').text, /【声称】去了北方矿山/, 'the model still sees the claim, marked as one');
    // A plain statement of fact still lands.
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '沈砚', fields: { 处境: '在北方矿山' } }] }, { now: at(2) });
    assert.equal(findCard(facts.cards, '沈砚').fields.处境, '在北方矿山');
});

test('场景 8 同名实体：人物、地点、物品同名是三张卡；线索和设定同名仍是一张', () => {
    const facts = world();
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '青石', fields: { 处境: '在酒馆' } }] }, { now: at(1) });
    applyFactsUpdate(facts, { cards: [{ kind: 'place', name: '青石', fields: { 描述: '山下的镇子' } }, { kind: 'item', name: '青石', fields: { 描述: '一块青色的石头' } }] }, { now: at(2) });
    const named = facts.cards.filter(card => card.name === '青石');
    assert.deepEqual(named.map(card => card.kind).sort(), ['item', 'person', 'place']);
    assert.equal(named.find(card => card.kind === 'person').fields.处境, '在酒馆');
    applyFactsUpdate(facts, { cards: [{ kind: 'thread', name: '码头之约', fields: { 内容: '明天去码头', 状态: '未了' } }] }, { now: at(3) });
    applyFactsUpdate(facts, { cards: [{ kind: 'rule', name: '码头之约', fields: { 说明: '改成后天' } }] }, { now: at(4) });
    const threads = facts.cards.filter(card => card.name === '码头之约');
    assert.equal(threads.length, 1);
    assert.equal(threads[0].kind, 'thread');
    assert.equal(threads[0].fields.内容, '明天去码头', 'a rule field has no place on a thread card, the card stays');
    // A kind the model made up with a name that exists elsewhere is still skipped, not merged into the wrong thing.
    const entry = applyFactsUpdate(facts, { cards: [{ kind: 'ghost', name: '青石', fields: {} }] }, { now: at(5) });
    assert.match((entry?.warnings || []).join(' '), /青石/);
});

test('身份不明确时不合并：一个称呼对上两张卡、或名字和别名指向不同的卡，记成待裁决的冲突', () => {
    const facts = world();
    const entry = applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '小晚', aliases: ['沈砚'], fields: { 处境: '在北方' } }] }, { floorTo: 44, now: at(1) });
    assert.equal(findCard(facts.cards, '林晚').fields.处境, '在书店');
    assert.equal(findCard(facts.cards, '沈砚').fields.处境, '在码头等人');
    assert.equal(facts.conflicts.length, 1);
    assert.equal(facts.conflicts[0].field, '身份');
    assert.match(facts.conflicts[0].says, /小晚.*沈砚/);
    assert.deepEqual(entry.conflicts, [facts.conflicts[0].id]);
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '阿砚', fields: { 处境: '在船上' } }, { kind: 'person', name: '阿晚', fields: { 处境: '在家' } }] }, { now: at(2) });
    facts.cards.find(card => card.name === '阿砚').aliases.push('小砚');
    facts.cards.find(card => card.name === '沈砚').aliases.push('小砚');
    const second = applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '小砚', fields: { 处境: '在山上' } }] }, { now: at(3) });
    assert.equal(facts.conflicts.length, 2);
    assert.match(second.warnings.join(' '), /小砚/);
    assert.ok(facts.cards.every(card => card.fields.处境 !== '在山上'));
});

test('conflicts：材料与现状矛盾时模型交给用户裁决；采用或忽略；撤回那批整理会连冲突一起撤掉', async () => {
    const r = factsRuntime({ every: 3, summaries: 3 });
    r.controller.maybeRun();
    r.setResult(reply([lin('在书店')], { conflicts: [{ name: '林晚', field: '处境', says: '第 4 楼说她在北方矿山' }, { name: '无此人', field: '处境', says: 'x' },
        { name: '林晚', field: '处境', says: '第 4 楼说她在北方矿山' }] }));
    await r.queue.processTaskQueue();
    const facts = r.state.facts;
    assert.equal(facts.conflicts.length, 1, 'duplicates fold, an unknown name is a warning');
    const conflict = facts.conflicts[0];
    assert.deepEqual([conflict.field, conflict.current, conflict.says, conflict.status], ['处境', '在书店', '第 4 楼说她在北方矿山', 'open']);
    assert.match(r.state.taskQueue[0].metadata.factsWarnings.join(' '), /无此人/);
    assert.match(summarizeFactsChanges(facts.history.at(-1)), /1 处待裁决/);
    const card = facts.cards[0];
    assert.equal(r.controller.resolveConflict(conflict.id, 'accept').status, 'accepted');
    assert.equal(card.fields.处境, '第 4 楼说她在北方矿山');
    assert.ok(card.userFields.includes('处境'), 'what the user decided is protected like an edit');
    assert.equal(r.controller.openConflicts().length, 0);
    r.controller.maybeRun();
    r.addSummary(8);
    r.chat.push({ mes: '继续。', is_user: true });
    const second = r.controller.runManual ? await r.controller.runManual() : null;
    r.setResult(reply([], { conflicts: [{ name: '林晚', field: '目标', says: '她说不找了' }] }));
    await r.queue.processTaskQueue();
    assert.equal(r.controller.openConflicts().length, 1);
    assert.equal(r.controller.resolveConflict(r.controller.openConflicts()[0].id, 'dismiss').status, 'dismissed');
    assert.equal(r.controller.openConflicts().length, 0);
    assert.ok(second);
    r.setResult(reply([], { conflicts: [{ name: '林晚', field: '持有', says: '钥匙丢了' }] }));
    r.addSummary(10);
    r.chat.push({ mes: '继续。', is_user: true });
    await r.controller.runManual();
    await r.queue.processTaskQueue();
    assert.equal(r.controller.openConflicts().length, 1);
    await r.controller.undoLast();
    assert.equal(r.controller.openConflicts().length, 0, 'undo takes the batch’s conflicts with it');
});

test('the parser keeps null field values and reads conflicts; the prompt explains null, the markers and conflicts', () => {
    const parsed = parseFactCards('<factCards>{"cards":[{"kind":"person","name":"林晚","fields":{"目标":null,"处境":"在家"}}],"retired":[],"reflection":{},"conflicts":[{"name":"林晚","field":"处境","says":"材料说在北方"},{"bad":1}]}</factCards>');
    assert.equal(parsed.cards[0].fields.目标, null);
    assert.deepEqual(parsed.conflicts, [{ name: '林晚', field: '处境', says: '材料说在北方' }]);
    assert.deepEqual(parseFactCards('<factCards>{"cards":[]}</factCards>').conflicts, []);
    for (const needle of ['null', '【声称】', '【猜测】', '【已推翻】', 'conflicts', '曾经', '同名']) assert.ok(defaultFactsPrompt.includes(needle), needle);
});
