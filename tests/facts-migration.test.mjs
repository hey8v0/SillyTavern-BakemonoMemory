import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacyImport, cardsFromProjection, cardsFromTables, classifyTable, importCards, mergeImportedCards } from '../src/facts/migration.js';
import { createDefaultFacts, findCard } from '../src/facts/model.js';
import { createBaseStoryLedgerTables } from '../src/tables/builtin-presets.js';
import { createMemoryBackup, validateMemoryBackup, restoreMemoryBackup, previewMemoryBackup } from '../src/memory/backup-package.js';
import { getHash } from '../src/shared/text.js';

const projection = {
    people: [{ id: 'p1', name: '林晚', aliases: ['小晚'], traits: ['倔强'], location: 'l1', states: [{ id: 's1', description: '左手受伤', active: true }, { id: 's2', description: '发烧', ended: true }] },
        { id: 'p2', name: '沈砚', aliases: [], traits: [], location: null, states: [] }],
    relationships: [{ id: 'r1', from: 'p1', to: 'p2', kind: '搭档', mutual: true, status: 'active', milestones: [{ description: '码头初见' }] }, { id: 'r2', from: 'p1', to: 'p2', kind: '仇人', status: 'ended' }],
    locations: [{ id: 'l1', name: '书店', parent: 'l2' }, { id: 'l2', name: '旧城区', parent: null }],
    items: [{ id: 'i1', name: '旧铜钥匙', owner: 'p2', holder: 'p1', location: null, quantity: 1, status: 'available', loan: { id: 'loan1' } }, { id: 'i2', name: '破伞', status: 'destroyed' }],
    plans: [{ id: 'pl1', title: '码头之约', participants: ['p1', 'p2'], status: 'accepted', dueDescription: '明天傍晚' }, { id: 'pl2', title: '还书', participants: ['p1'], status: 'completed' }],
};
const information = [{ track: 'claims', data: { speaker: 'p2', subject: 'p1', description: '她没受伤' } }];

test('the 剧情状态 projection becomes cards of every kind, with ended things retired', () => {
    const cards = cardsFromProjection(projection, information);
    const lin = cards.find(card => card.name === '林晚');
    assert.equal(lin.fields.处境, '在 书店；左手受伤');
    assert.equal(lin.fields.性格, '倔强');
    assert.match(lin.fields.备注, /沈砚说：她没受伤/);
    assert.deepEqual(lin.aliases, ['小晚']);
    const relation = cards.filter(card => card.kind === 'relationship');
    assert.equal(relation.length, 1, 'ended relationships are not imported');
    assert.equal(relation[0].name, '林晚 与 沈砚');
    assert.equal(relation[0].fields.当前关系, '搭档');
    assert.equal(relation[0].fields.态度, '码头初见');
    assert.equal(cards.find(card => card.name === '书店').fields.描述, '属于 旧城区');
    assert.equal(cards.find(card => card.name === '书店').fields.常在此处, '林晚');
    const key = cards.find(card => card.name === '旧铜钥匙');
    assert.equal(key.fields.持有者, '林晚手上；归 沈砚 所有；借用中');
    assert.equal(cards.find(card => card.name === '破伞').status, 'retired');
    const plan = cards.find(card => card.name === '码头之约');
    assert.equal(plan.kind, 'thread');
    assert.equal(plan.fields.状态, '未了');
    assert.equal(plan.fields.参与者, '林晚、沈砚');
    assert.equal(plan.fields.期限, '明天傍晚');
    assert.equal(cards.find(card => card.name === '还书').status, 'retired');
});

test('the built-in tables map by column names; a custom table becomes one 设定 card per row', () => {
    const tables = createBaseStoryLedgerTables();
    tables[0].rows = [['林晚', '女，二十出头，短发', '倔强', '怕黑', '左手受伤', '灰色风衣']];
    tables[1].rows = [['林晚、沈砚', '同僚', '搭档', '林晚信任沈砚 / 沈砚观察林晚']];
    tables[2].rows = [['雾都', '地点', '常年有雾', '全城']];
    tables[3].rows = [['林晚', '旧铜钥匙', '书店后门的钥匙', '开启密室', '沈砚所赠']];
    tables[4].rows = [['明天', '林晚、沈砚', '去码头', '待完成', ''], ['昨天', '林晚', '还书', '已完成', '顺利']];
    tables[5].rows = [['少写环境描写']];
    tables.push({ name: '战力表', columns: ['角色', '等级', '技能'], rows: [['林晚', '3', '潜行'], ['', '', '']] });
    assert.deepEqual(tables.map(classifyTable), ['person', 'relationship', 'rule', 'item', 'thread', 'note', 'custom']);
    const cards = cardsFromTables(tables);
    const lin = cards.find(card => card.kind === 'person');
    assert.equal(lin.name, '林晚');
    assert.equal(lin.fields.外貌, '女，二十出头，短发；灰色风衣');
    assert.equal(lin.fields.处境, '左手受伤');
    assert.equal(lin.fields.备注, '怕黑');
    const relation = cards.find(card => card.kind === 'relationship');
    assert.equal(relation.fields.基础关系, '同僚');
    assert.equal(relation.fields.态度, '林晚信任沈砚 / 沈砚观察林晚');
    assert.equal(cards.find(card => card.name === '雾都').fields.说明, '地点；常年有雾');
    assert.equal(cards.find(card => card.name === '旧铜钥匙').fields.意义, '开启密室；沈砚所赠');
    const threads = cards.filter(card => card.kind === 'thread');
    assert.deepEqual(threads.map(card => [card.fields.状态, card.status]), [['未了', 'active'], ['已了', 'retired']]);
    assert.equal(threads[0].fields.期限, '明天');
    assert.equal(cards.find(card => card.kind === 'note').fields.内容, '少写环境描写');
    const custom = cards.filter(card => card.name.startsWith('战力表'));
    assert.equal(custom.length, 1, 'empty rows are skipped');
    assert.equal(custom[0].fields.说明, '角色：林晚；等级：3；技能：潜行');
});

test('the same person from both sources folds into one card, and import only fills what an existing card lacks', () => {
    const tables = createBaseStoryLedgerTables();
    tables[0].rows = [['小晚', '短发', '', '', '', '']];
    const cards = buildLegacyImport({ projection, information, tables });
    const lin = cards.filter(card => card.kind === 'person' && card.name === '林晚');
    assert.equal(lin.length, 1);
    assert.equal(lin[0].fields.外貌, '短发', 'folded through the alias');
    assert.equal(cards.filter(card => card.name === '小晚').length, 0);
    const facts = createDefaultFacts();
    facts.cards.push({ id: 'existing', kind: 'person', name: '林晚', aliases: [], fields: { 处境: '用户写的', 目标: '', 持有: '', 性格: '', 外貌: '', 备注: '' }, status: 'active', pinned: false, userFields: ['处境'], updatedAt: null, updatedBy: 'user', sourceStage: null });
    const entry = importCards(facts, cards, '2026-10-26T00:00:00.000Z');
    const existing = findCard(facts.cards, '林晚');
    assert.equal(existing.id, 'existing');
    assert.equal(existing.fields.处境, '用户写的', 'not overwritten');
    assert.equal(existing.fields.性格, '倔强', 'empty field filled');
    assert.ok(existing.aliases.includes('小晚'));
    assert.equal(entry.trigger, 'import');
    assert.ok(facts.cards.filter(card => card.updatedBy === 'import').length >= 6);
    assert.equal(importCards(facts, cards, '2026-10-26T00:00:01.000Z'), null, 'a second import adds nothing');
});

test('a memory backup carries the cards and history; restore keeps the chat\'s own settings', () => {
    const state = { storySummaries: [], stageSummaries: [], epicSummaries: [], drafts: [], coveredBlockHashes: [], coveredStageHashes: [], tableDatabase: { tables: [] },
        facts: { ...createDefaultFacts(), settings: { ...createDefaultFacts().settings, enabled: true } } };
    importCards(state.facts, buildLegacyImport({ projection }), '2026-10-26T00:00:00.000Z');
    const backup = createMemoryBackup(state, { chatKey: 'chat' });
    assert.equal(previewMemoryBackup(backup, { chatKey: 'chat' }).factCards, state.facts.cards.length);
    const target = { storySummaries: [], stageSummaries: [], epicSummaries: [], drafts: [], coveredBlockHashes: [], coveredStageHashes: [], tableDatabase: { tables: [] }, facts: createDefaultFacts() };
    restoreMemoryBackup(target, validateMemoryBackup(JSON.parse(JSON.stringify(backup))));
    assert.equal(target.facts.cards.length, state.facts.cards.length);
    assert.equal(target.facts.history.length, 1);
    assert.equal(target.facts.settings.enabled, false, 'settings are configuration, not memory');
    const { checksum, ...payload } = JSON.parse(JSON.stringify(backup));
    payload.memory.facts = { cards: [{ name: 1 }] };
    assert.throws(() => validateMemoryBackup({ ...payload, checksum: getHash(JSON.stringify(payload)) }), /剧情事实/);
});
