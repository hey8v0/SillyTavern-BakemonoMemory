import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeHost } from './helpers/rp-runtime-host.mjs';
import { openingFloors, isFirstReplyTurn } from '../src/shared/opening.js';
import { buildFloorMemoryIndex } from '../src/memory/floor-memory-index.js';
import { splitClockText } from '../src/features/rp-state-presentation.js';
import { sameShortName, likelyDuplicatePeople, findPeopleByName } from '../src/rp-core/references.js';
import { createProjection, applyDomainFact } from '../src/rp-core/domain.js';
import { entityName } from '../src/rp-core/state-view.js';
import { createSummarySourceService } from '../src/features/summary-source-service.js';

const block = events => '<rpEvents>' + JSON.stringify({ version: 2, events }) + '</rpEvents>';
const e = (action, data) => ({ action, data });

test('开场白 is the character text before the first user message, only once the user has written', () => {
    assert.deepEqual(openingFloors([{ mes: '开场白' }]), [], 'a lone reply is not a 开场白 yet');
    const chat = [{ mes: '开场白' }, { mes: '你好', is_user: true }];
    assert.deepEqual(openingFloors(chat), [0]);
    assert.equal(isFirstReplyTurn(chat), true, 'the first reply is about to be written');
    chat.push({ mes: '第一条回复' });
    assert.equal(isFirstReplyTurn(chat), true, 're-rolling the first reply still covers the 开场白');
    chat.push({ mes: '继续', is_user: true });
    assert.equal(isFirstReplyTurn(chat), false);
});

test('开场白 is never a missing summary; it takes the first reply’s state', () => {
    const messages = [{ mes: '开场白' }, { mes: '你好', is_user: true }, { mes: '回复' }];
    const empty = buildFloorMemoryIndex({ messages, state: {} });
    assert.deepEqual(empty.records.map(record => [record.id, record.summaryState]), [[2, 'missing']]);
    const saved = buildFloorMemoryIndex({ messages, state: { blocks: [{ hash: 'h', type: 'story', messageId: 2, content: '摘要' }] } });
    assert.deepEqual(saved.records.map(record => [record.id, record.summaryState]), [[0, 'saved'], [2, 'saved']]);
    assert.ok(saved.records[0].summarySources.includes('随第一轮记下'));
});

test('the first reply asks for the 开场白 in its summary, table and state instructions', async () => {
    const h = runtimeHost(); await h.service.enable();
    h.chat.length = 0; h.chat.push({ mes: '雨夜，书店里只有甲。' }, { mes: '推门进去', is_user: true });
    Object.assign(h.state.inlineGeneration, { summaryEnabled: true, tableEnabled: true });
    h.injection.syncInjection();
    for (const slot of ['summary', 'table', 'rp']) assert.match(h.prompts.get(slot), /开场白/, slot);
    h.chat.push({ mes: '回复' + block([e('person_registered', { id: '甲', name: '甲' })]) }, { mes: '继续', is_user: true });
    h.injection.syncInjection();
    for (const slot of ['summary', 'table', 'rp']) assert.doesNotMatch(h.prompts.get(slot), /开场白/, slot);
});

test('剧情状态 does not fail or wait on the 开场白', async () => {
    const h = runtimeHost(); await h.service.enable();
    h.chat.length = 0; h.chat.push({ mes: '开场白，没有事件块。' }, { mes: '你好', is_user: true });
    assert.equal((await h.flow.captureInline({ detailed: true })).status, 'opening');
    assert.equal(h.state.rpCore.extractionJobs?.length || 0, 0);
    assert.equal(h.service.progress().missingCount, 0);
});

test('a time written into the clock description goes to TIME, not DATE', () => {
    assert.deepEqual(splitClockText('1889年3月14日 下午 15:20'), { date: '1889年3月14日', time: '15:20' });
    assert.deepEqual(splitClockText('1889年3月14日 下午3:20'), { date: '1889年3月14日', time: '下午 3:20' });
    assert.deepEqual(splitClockText('第二天 下午三点半'), { date: '第二天', time: '下午三点半' });
    assert.deepEqual(splitClockText('第三天傍晚'), { date: '第三天', time: '傍晚' });
    assert.deepEqual(splitClockText('夏末'), { date: '夏末', time: '' });
});

test('a given name alone finds the full name, but different given names stay apart', () => {
    assert.equal(sameShortName('夏尔', '夏尔·凡多姆海恩'), true);
    assert.equal(sameShortName('文森特·凡多姆海恩', '夏尔·凡多姆海恩'), false);
    const people = [{ id: 'a', name: '夏尔·凡多姆海恩', aliases: [] }, { id: 'b', name: '塞巴斯蒂安·米卡利斯', aliases: [] }];
    assert.deepEqual(findPeopleByName(people, '夏尔').map(item => item.id), ['a']);
    assert.deepEqual(likelyDuplicatePeople([...people, { id: 'c', name: '夏尔', aliases: [] }]).map(pair => [pair.drop.id, pair.keep.id]), [['c', 'a']]);
});

test('merging a duplicate moves its relationships, plans, items and presence onto the kept person', () => {
    let p = createProjection();
    const fact = (action, data) => { p = applyDomainFact(p, { track: 'facts', action, data, ruleVersion: 3 }); };
    fact('person_registered', { id: 'full', name: '夏尔·凡多姆海恩' });
    fact('person_registered', { id: 'short', name: '夏尔' });
    fact('person_registered', { id: 'seb', name: '塞巴斯蒂安' });
    fact('location_created', { id: 'study', name: '书房' });
    fact('scene_recorded', { location: 'study', present: ['short', 'seb'] });
    fact('relationship_established', { id: 'r1', from: 'seb', to: 'short', kind: '主仆' });
    fact('plan_proposed', { id: 'p1', title: '调查', participants: ['short', 'full'] });
    fact('item_registered', { id: 'ring', name: '戒指', owner: 'short', holder: 'short' });
    fact('person_merged', { id: 'short', into: 'full' });
    assert.deepEqual(p.people.map(item => item.name), ['夏尔·凡多姆海恩', '塞巴斯蒂安']);
    assert.deepEqual(p.people[0].aliases, ['夏尔']);
    assert.deepEqual(p.scene.present, ['full', 'seb']);
    assert.deepEqual([p.relationships[0].from, p.relationships[0].to], ['seb', 'full']);
    assert.deepEqual(p.plans[0].participants, ['full']);
    assert.deepEqual([p.items[0].owner, p.items[0].holder], ['full', 'full']);
    assert.equal(entityName(p, 'short'), '夏尔·凡多姆海恩', 'older history still names the merged person');
    assert.throws(() => applyDomainFact(p, { track: 'facts', action: 'person_merged', data: { id: 'full', into: 'full' }, ruleVersion: 3 }), /自己/);
});

test('the service records a merge in the ledger', async () => {
    const h = runtimeHost(); await h.service.enable();
    h.chat[0].mes += block([e('person_registered', { id: '夏尔·凡多姆海恩', name: '夏尔·凡多姆海恩' }), e('person_registered', { id: '塞巴斯蒂安', name: '塞巴斯蒂安' })]);
    await h.flow.captureInline();
    const [full, seb] = h.service.view().projection.people;
    await h.service.mergePeople(seb.id, full.id);
    assert.deepEqual(h.service.view().projection.people.map(item => item.name), ['夏尔·凡多姆海恩']);
    assert.equal(h.state.rpCore.facts.at(-1).action, 'person_merged');
    h.service.validateRestore(h.service.backup());
    assert.deepEqual(h.service.view().projection.people[0].aliases, ['塞巴斯蒂安'], 'a replay after reload gives the same result');
});

test('queuing many batches checks the chat sources once', () => {
    let reads = 0;
    const state = { storySummaries: [], stageSummaries: [], epicSummaries: [], blocks: [], tableDatabase: { tables: [] } };
    const service = createSummarySourceService({ getState: () => state, getChat: () => { reads++; return []; } });
    service.once(() => { service.refresh(); service.refresh(); service.refresh(); });
    const inside = reads;
    service.refresh();
    assert.ok(reads > inside, 'outside once() every refresh reads the chat again');
    assert.equal(inside, 2, 'one refresh reads the chat twice (chronicle + links)');
});
