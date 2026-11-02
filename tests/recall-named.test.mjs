import test from 'node:test';
import assert from 'node:assert/strict';
import { factsRecallHints } from '../src/facts/recall.js';
import { applyFactsUpdate, createDefaultFacts, findCard } from '../src/facts/model.js';
import { groupRecallCandidates, markNamedRecords, selectRecallPlan } from '../src/vector/recall-plan.js';
import { selectHybridCandidates } from '../src/vector/hybrid-retrieval.js';
import { latestUserLines } from '../src/vector/query-split.js';
import { recallFixture } from './helpers/recall-fixture.mjs';

// A line that names someone the visible chat has not mentioned lately reaches for something old. The floors on their
// card are known, so that does not depend on how alike the words happen to be.
function world() {
    const facts = createDefaultFacts();
    applyFactsUpdate(facts, { cards: [
        { kind: 'person', name: '老周', aliases: ['周叔'], fields: { 处境: '在南城开了间茶铺' } },
        { kind: 'person', name: '林晚', fields: { 处境: '在书店' } },
        { kind: 'item', name: '铜钥匙', fields: { 持有者: '林晚' } },
        { kind: 'note', name: '写作要求', fields: { 内容: '少写环境' } },
    ] }, { floorFrom: 2, floorTo: 40, mentionFloors: card => card.name === '老周' ? [4, 8, 12] : card.name === '铜钥匙' ? [6] : [20, 40] });
    return facts;
}

test('a name in the line that the visible chat has not mentioned: its floors are named; one that is around is not', () => {
    const facts = world();
    const named = (line, visible = '') => factsRecallHints(facts, line, { line, visible }).named;
    assert.deepEqual(named('老周后来怎么样了？'), [{ name: '老周', floors: [4, 8, 12] }]);
    assert.deepEqual(named('周叔还在吗'), [{ name: '老周', floors: [4, 8, 12] }], 'by an alias too');
    assert.deepEqual(named('林晚，你来了。', '林晚推开门走了进来。'), [], 'she is in the scene: nothing to reach back for');
    assert.deepEqual(named('周叔还在吗', '老周昨天来过。'), [], 'another name of the same card counts as around');
    assert.deepEqual(named('写作要求是什么'), [], 'a note has no floors to bring');
    assert.deepEqual(named('今天天气不错'), []);
    assert.deepEqual(factsRecallHints(facts, '老周', { line: '' }).named, [], 'without a line nothing is named');
    assert.deepEqual(named('老周和铜钥匙和林晚', '').map(item => item.name).sort(), ['老周', '林晚', '铜钥匙'].sort());
    assert.equal(factsRecallHints(facts, 'a', { line: '老周和铜钥匙和林晚', maxNamed: 2 }).named.length, 2);
    facts.settings.enabled = false;
    assert.deepEqual(named('老周后来怎么样了？'), []);
});

test('a card from before floors were kept goes by the floors of its changes; a card ended long ago can still be named', () => {
    const facts = world();
    const card = findCard(facts.cards, '老周');
    card.floors = [];
    card.asOf = { 处境: 8 };
    card.timeline = [{ field: '处境', from: '在码头', to: '在南城', floor: 14 }];
    card.status = 'retired';
    const [hit] = factsRecallHints(facts, '老周', { line: '老周' }).named;
    assert.deepEqual([...hit.floors].sort((a, b) => a - b), [8, 14]);
});

test('the latest user lines are the trailing run; a reply after them does not hide them', () => {
    const user = text => ({ isUser: true, text }), reply = text => ({ isUser: false, text });
    assert.deepEqual(latestUserLines([reply('门开了。'), user('老周呢'), user('他还好吗')]), { lines: ['老周呢', '他还好吗'], before: ['门开了。'] });
    assert.deepEqual(latestUserLines([user('老周呢'), reply('门开了。')]), { lines: ['老周呢'], before: ['门开了。'] });
    assert.deepEqual(latestUserLines([reply('门开了。')]), { lines: [], before: ['门开了。'] });
});

const record = (id, messageId, embeddingScore, extra = {}) => ({ id, messageId, kind: 'message', text: `第${messageId}楼`, embeddingScore, ...extra });

test('per card the closest floors are marked, with a limit per card and in all; a saved summary counts as one source', () => {
    const records = [record('a', 4, .1), record('b', 8, .3), record('c', 12, .2), record('d', 30, .9),
        record('s', 8, .05, { kind: 'summary' }), record('m', 2, .4, { kind: 'summary', memoryHash: 'stage1', sourceMessageIds: [2, 4, 6] })];
    markNamedRecords(records, [{ name: '老周', floors: [4, 8, 12] }]);
    const marked = records.filter(item => item.guaranteed).map(item => item.id);
    assert.deepEqual(marked.sort(), ['b', 'm'].sort(), 'the two closest sources: a stage summary holding floor 4, and floor 8');
    assert.equal(records.find(item => item.id === 'b').guaranteed, '老周');
    const capped = [record('x', 1, .5), record('y', 2, .5), record('z', 3, .5), record('w', 4, .5)];
    markNamedRecords(capped, [{ name: '甲', floors: [1, 2] }, { name: '乙', floors: [3, 4] }], { total: 3 });
    assert.equal(capped.filter(item => item.guaranteed).length, 3);
});

test('a marked floor goes through however little it looks like the line, first, and within the counts', () => {
    const records = [record('far', 4, 0.01, { guaranteed: '老周', summary: '' }), ...Array.from({ length: 30 }, (_, i) => record(`n${i}`, 100 + i, .8 - i * .01))];
    const candidates = selectHybridCandidates(records, ['查询'], [], { candidateCount: 5, embeddingThreshold: 0.22 });
    assert.equal(candidates[0].id, 'far', 'below the threshold and past the candidate count');
    const bodies = new Map(records.map(item => [item.messageId, item.text]));
    const groups = groupRecallCandidates(candidates, records, bodies, 5);
    assert.equal(groups[0].id, 'far');
    assert.equal(groups.length, 5);
    const plan = selectRecallPlan(groups, { fullRecallCount: 1, maxSummaryRecall: 0 });
    assert.deepEqual(plan.hits.map(hit => hit.id), ['far'], 'it has no summary, so its body goes; the one full-text slot is its');
    assert.match(plan.hits[0].decisionReason, /点名.*老周/);
    const none = selectRecallPlan(groups, { fullRecallCount: 0, maxSummaryRecall: 0 });
    assert.equal(none.hits.length, 0, 'the counts the user set still hold');
    // Not marked: the same floor stays out.
    const plain = selectRecallPlan(groupRecallCandidates([{ ...records[0], guaranteed: '' }], records, bodies, 5), { fullRecallCount: 1, maxSummaryRecall: 0, rerankThreshold: .45 });
    assert.equal(plain.hits.length, 0);
});

test('through the service: a floor that hardly resembles the line comes back because the line names its card', async () => {
    const facts = createDefaultFacts();
    const chat = [{ is_user: false, mes: '开场。' }, { is_user: true, mes: '继续。' }, { is_user: false, mes: '码头上风很大，货船靠了岸。' }, { is_user: true, mes: '嗯。' },
        ...Array.from({ length: 6 }, (_, i) => ({ is_user: i % 2 === 1, mes: `后来的第${i}段，和前面没有关系的日常。` })),
        { is_user: true, mes: '老周呢？' }];
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '老周', fields: { 处境: '不知去向' } }] }, { floorFrom: 2, floorTo: 2, mentionFloors: () => [2] });
    const hints = (state, text, options) => factsRecallHints(facts, text, options);
    const f = recallFixture(chat, { contextWindowMessages: 7, embeddingThreshold: 0.5, rerankThreshold: 0.9 }, { getFactsHints: hints });
    await f.service.buildVectorMemoryIndex();
    const hits = await f.recall();
    const floor2 = hits.find(hit => hit.messageId === 2);
    assert.ok(floor2, 'the floor on the card');
    assert.equal(floor2.guaranteed, '老周');
    assert.match(floor2.decisionReason, /点名/);
    assert.ok(floor2.similarity < 0.5, `相似度 ${floor2.similarity} 本来进不了`);
    // Named again in the visible chat: nothing to reach back for, and the floor stays out by the same thresholds.
    chat.splice(-1, 0, { is_user: false, mes: '老周刚才还在门口。' });
    f.dependencies.saveState?.();
    await f.service.buildVectorMemoryIndex();
    const again = await f.recall();
    assert.ok(!again.some(hit => hit.guaranteed), 'around, so not marked');
});
