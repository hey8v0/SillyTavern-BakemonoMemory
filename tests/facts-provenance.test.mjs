import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFactsUpdate, createDefaultFacts, findCard, reportedSpeech } from '../src/facts/model.js';
import { renderFactsSection } from '../src/facts/injection.js';
import { defaultFactsPrompt } from '../src/facts/prompt.js';
import { factsRecallHints } from '../src/facts/recall.js';
import { factsRuntime, reply } from './helpers/facts-runtime.mjs';

// Batch 2 after v1.38.1: where a card's facts come from (floors, not copied text), hearsay caught without the
// model's markers, and recall of old events the current line does not name.

test('a card remembers the floors whose summaries mention it, and each change in 经过 says which floors it rests on', async () => {
    const r = factsRuntime({ every: 3, summaries: 0, floors: 20 });
    r.addSummary(2, '林晚在书店看书。');
    r.addSummary(4, '林晚在后门捡到铜钥匙。');
    r.addSummary(6, '雨下了一整夜。');
    r.controller.maybeRun();
    r.setResult(reply([{ kind: 'item', name: '铜钥匙', fields: { 持有者: '林晚' } }, { kind: 'person', name: '林晚', fields: { 处境: '在书店' } }]));
    await r.queue.processTaskQueue();
    const key = r.state.facts.cards.find(card => card.name === '铜钥匙');
    const lin = r.state.facts.cards.find(card => card.name === '林晚');
    assert.deepEqual(key.floors, [4], 'only the summary that mentions it');
    assert.deepEqual(lin.floors, [2, 4]);
    r.addSummary(8, '林晚把铜钥匙交给了阿砚。');
    r.addSummary(10, '阿砚收好钥匙。');
    r.addSummary(12, '天亮了。');
    r.chat.push({ mes: '继续。', is_user: true });
    r.controller.maybeRun();
    r.setResult(reply([{ kind: 'item', name: '铜钥匙', aliases: ['钥匙'], fields: { 持有者: '阿砚' } }]));
    await r.queue.processTaskQueue();
    assert.deepEqual(key.floors, [4, 8, 10], 'floor 10 says 钥匙, an alias this very result added: it counts');
    const moved = key.timeline.at(-1);
    assert.deepEqual([moved.from, moved.to, moved.floors], ['林晚', '阿砚', [8, 10]]);
    // Undo takes the floors of that 整理 back off the card.
    await r.controller.undoLast();
    assert.deepEqual(key.floors, [4]);
});

test('reported speech in a current-state field is caught even without a marker; ordinary actions are not', () => {
    const people = ['沈砚', '林晚', '阿砚'];
    assert.equal(reportedSpeech('沈砚说自己从没进过矿坑', people), '【声称】');
    assert.equal(reportedSpeech('林晚以为钥匙丢了', people), '【林晚认为】');
    assert.equal(reportedSpeech('据说去了北方', people), '【传闻】');
    assert.equal(reportedSpeech('可能在阿砚手里', people), '【猜测】');
    assert.equal(reportedSpeech('在酒馆听说了矿坑的事', people), '', 'where she is, and what she heard there');
    assert.equal(reportedSpeech('沈砚说服了船长，正在船上', people), '', '说服 is an action');
    assert.equal(reportedSpeech('在码头说话', people), '');
    assert.equal(reportedSpeech('莉娜说她要走', people), '', 'only known people count as a speaker');
    const facts = createDefaultFacts();
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '沈砚', fields: { 处境: '在码头' } }, { kind: 'person', name: '林晚', fields: { 处境: '在书店' } }] }, { floorTo: 10 });
    const entry = applyFactsUpdate(facts, { cards: [
        { kind: 'person', name: '沈砚', fields: { 处境: '沈砚说自己一年前离开了青石镇' } },
        { kind: 'item', name: '铜钥匙', fields: { 持有者: '林晚以为钥匙丢了', 描述: '刻着青字' } },
    ] }, { floorTo: 20 });
    const shen = findCard(facts.cards, '沈砚');
    assert.equal(shen.fields.处境, '在码头');
    assert.match(shen.fields.备注, /【声称】沈砚说自己一年前离开了青石镇/);
    const key = findCard(facts.cards, '铜钥匙');
    assert.equal(key.fields.持有者, '');
    assert.match(key.fields.描述, /【林晚认为】林晚以为钥匙丢了/);
    assert.match(entry.warnings.join(' '), /沈砚.*处境.*传闻或猜测/);
});

test('what only some characters know stays in the notes, and the injected section says what the marks mean', () => {
    const facts = createDefaultFacts();
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '林霜', fields: { 处境: '在矿坑里养伤', 备注: '【只有林霜知道】带走她的人是沈砚的父亲' } },
        { kind: 'person', name: '林晚', fields: { 目标: '【秘密】想离开青石镇' } }] }, { floorTo: 10 });
    assert.equal(findCard(facts.cards, '林晚').fields.目标, '');
    assert.match(findCard(facts.cards, '林晚').fields.备注, /【秘密】想离开青石镇/);
    const text = renderFactsSection(facts, '林霜和林晚').text;
    assert.match(text, /【】里是传闻、推测或只有部分人物知道的事/);
    assert.doesNotMatch(renderFactsSection(createDefaultFacts(), '').text, /【】里/);
    for (const needle of ['【只有某某知道】', '【秘密】']) assert.ok(defaultFactsPrompt.includes(needle), needle);
});

test('“那天晚上你答应过我的事”: a callback without names brings the floors of the promises; plain talk brings none', () => {
    const facts = createDefaultFacts();
    applyFactsUpdate(facts, { cards: [
        { kind: 'person', name: '沈砚', fields: { 处境: '在客栈' } },
        { kind: 'thread', name: '码头之约', fields: { 内容: '沈砚答应带林晚去看海', 状态: '已了', 参与者: '林晚、沈砚' } },
        { kind: 'thread', name: '还钥匙', fields: { 内容: '阿砚答应三天内还钥匙', 状态: '未了', 参与者: '阿砚、林晚' } },
        { kind: 'item', name: '铜钥匙', fields: { 持有者: '阿砚' } },
    ] }, { floorTo: 40 });
    facts.cards.find(card => card.name === '码头之约').floors = [20, 26];
    facts.cards.find(card => card.name === '还钥匙').floors = [44];
    facts.cards.find(card => card.name === '铜钥匙').floors = [4, 44];
    const callback = factsRecallHints(facts, '那天晚上你答应过我的事情，还记得吗？');
    assert.deepEqual(callback.floors.sort((a, b) => a - b), [20, 26, 44], 'every promise, closed ones too');
    assert.deepEqual(callback.keywords, []);
    const withName = factsRecallHints(facts, '沈砚，那天晚上你答应过我的事情。');
    assert.deepEqual(withName.floors.sort((a, b) => a - b), [20, 26], 'the promises he is part of');
    assert.deepEqual(withName.keywords, ['沈砚']);
    assert.deepEqual(factsRecallHints(facts, '今天的天气不错。').floors, []);
    assert.deepEqual(factsRecallHints(facts, '铜钥匙在哪？').floors, [], 'a named card already brings its summaries by name');
    facts.settings.enabled = false;
    assert.deepEqual(factsRecallHints(facts, '那天晚上你答应过我的事情'), { keywords: [], floors: [] });
});
