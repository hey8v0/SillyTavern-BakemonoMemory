import test from 'node:test';
import { seedLegacyExtraction } from './helpers/legacy-rp-extraction.mjs';
import assert from 'node:assert/strict';
import { createRpCoreService } from '../src/rp-core/service.js';
import { createRpExtractionFlow } from '../src/rp-core/extraction-flow.js';
import { readChatSource } from '../src/rp-core/chat-sources.js';
import { exportRpBackup } from '../src/rp-core/backup.js';
import { normalizeEntityIdentities } from '../src/rp-core/identity.js';
import { renderRpStateMemory } from '../src/rp-core/memory.js';

async function fixture(mes, settings = {}) {
    const state = { turnSummary: {}, scanRules: {}, ...settings }, chat = [{ mes }];
    let id = 0, requests = 0;
    const service = createRpCoreService({ getState: () => state, getChat: () => chat,
        saveState() {}, saveChat: async () => {}, makeSourceId: () => String(++id) });
    await service.enable();
    const flow = createRpExtractionFlow({ getState: () => state, getChat: () => chat, service,
        callGenerationModel: async () => { requests++; return '<rpEvents>{"version":1,"events":[]}</rpEvents>'; } });
    return { state, chat, service, flow, requests: () => requests };
}
const summary = '<bakemono><details><summary>剧情摘要</summary>【当前时间：1889年10月15日 20:00★当前地点：宅邸客厅★在场角色：夏尔、Nana】\n➤【场记】\n两人在看信。\n➤【第四面墙】\n明天他们要结婚了。</details></bakemono>';
const protocol = events => '<rpEvents>' + JSON.stringify({ version: 1, events }) + '</rpEvents>';

test('I06 summary-only headers never create facts or advance processing progress', async () => {
    const f = await fixture('两人在看信。' + summary);
    assert.equal((await f.flow.captureInline({ detailed: true })).status, 'missing');
    assert.equal(f.service.view().projection.clock.date, null);
    assert.equal(f.state.rpCore.facts.length, 0);
    assert.equal(f.state.rpCore.batches.length, 0);
    assert.equal(f.requests(), 0);
});

test('summary evidence is separate: metadata edits do not invalidate existing body evidence', async () => {
    const f = await fixture('Nana微笑了。' + summary + protocol([{ track: 'facts', action: 'person_created', data: { id: 'n', name: 'Nana' }, excerpt: 'Nana微笑了。' }]));
    await f.flow.captureInline();
    const source = readChatSource(f.chat[0], f.state), bodyFact = f.state.rpCore.facts.find(item => !item.evidence.sourceKind);
    assert.equal(f.service.view().projection.people.filter(p => p.name === 'Nana').length, 1);
    f.chat[0].mes = f.chat[0].mes.replace('20:00', '21:00');
    assert.equal(readChatSource(f.chat[0], f.state).revision, source.revision);
    assert.equal(f.service.view().sourceStates[bodyFact.id], 'current');
    assert.equal(f.service.view().projection.clock.date, null);
    const restored = JSON.parse(JSON.stringify(f.state));
    assert.doesNotThrow(() => exportRpBackup(restored.rpCore));
});

test('ranges, hypothetical headers and mere mentioned people do not become current state', async () => {
    for (const header of ['时间跨度：1889年10月15日至18日★地点：客厅 → 庭院★提及人物：夏尔', '梦境★当前时间：1889年10月15日★当前地点：宫殿']) {
        const f = await fixture('她回忆往事。<bakemono>【' + header + '】</bakemono>');
        await f.flow.captureInline();
        const view = f.service.view().projection;
        assert.equal(view.clock.date, null);
        assert.equal(view.people.length, 0);
        assert.equal(view.scene?.location ?? null, null);
    }
});

test('I05 independent filter snapshot excludes widgets and ignores later summary settings', async () => {
    const f = await fixture('Nana微笑。<widget>旧组件</widget>' + summary + protocol([{ track: 'claims', data: { description: '微笑' } }]));
    await f.service.configure({ excludeTags: 'widget' }); await f.flow.captureInline();
    const before = f.service.view().applied;
    f.state.scanRules = { includeTags: 'memo', excludeTags: 'p' }; f.state.turnSummary.includeTags = 'nothing';
    f.chat[0].mes = f.chat[0].mes.replace('旧组件', '新的文尾组件').replace('20:00', '21:00');
    assert.deepEqual(f.service.view().applied, before);
    assert.equal(f.service.view().sourceStates[f.state.rpCore.claims[0].id], 'current');
});

test('I07 omitted state survives summary changes and serialization', async () => {
    const f = await fixture('她在客厅看信。' + protocol([{ track: 'facts', action: 'clock_set', data: { date: '1889-10-15T20:00' } }]));
    await f.flow.captureInline(); const before = structuredClone(f.service.view().projection);
    f.chat.push({ mes: summary }); await f.flow.captureInline();
    assert.deepEqual(f.service.view().projection, before);
    const savedState = JSON.parse(JSON.stringify(f.state)), savedChat = JSON.parse(JSON.stringify(f.chat));
    const reloaded = createRpCoreService({ getState: () => savedState, getChat: () => savedChat, saveState() {}, saveChat: async () => {} });
    assert.deepEqual(reloaded.view().projection, before); assert.doesNotThrow(() => exportRpBackup(savedState.rpCore));
});

test('same-source automatic additions do not duplicate summary facts or revive ignored results', async () => {
    const first = { track: 'claims', action: 'claim_made', data: { description: '她说好' }, excerpt: '她说好。' };
    const f = await fixture('她说好。她看信。' + summary + protocol([first]));
    await f.flow.captureInline();
    const count = f.state.rpCore.facts.length;
    const addition = { track: 'observations', action: 'observation', data: { description: '她看信' }, excerpt: '她看信。' };
    await f.service.configure({ autoApply: false });
    f.chat[0].mes = '她说好。她看信。' + summary + protocol([first, addition]);
    seedLegacyExtraction(f.state, f.chat, JSON.stringify({ version: 1, events: [addition] }), 0);
    assert.equal(f.state.rpCore.facts.length, count);
    const candidate = f.state.rpCore.candidates.find(c => c.track === 'observations');
    await f.service.review(candidate.id, 'ignore');
    await f.service.configure({ autoApply: true });
    await f.flow.captureInline();
    assert.equal(f.state.rpCore.observations.length, 0);
    assert.equal(f.state.rpCore.candidates.find(c => c.id === candidate.id).status, 'ignored');
});

test('S02 imprecise new clock description does not clear a date when date is omitted', async () => {
    const f = await fixture('夜晚。' + protocol([{ track: 'facts', action: 'clock_set', data: { date: '1889-10-15T20:00' } }]));
    await f.flow.captureInline(); f.chat.push({ mes: '仍是夜晚。' + protocol([{ track: 'facts', action: 'clock_set', data: { description: '夜晚' } }]) });
    await f.flow.captureInline(); assert.equal(f.service.view().projection.clock.date, '1889-10-15T20:00');
});

test('automatic recording remains model-owned but does not synthesize summary candidates', async () => {
    const f = await fixture('Nana微笑。' + summary + protocol([{ track: 'facts', action: 'person_created', data: { id: 'n', name: 'Nana' } }]));
    await f.service.configure({ autoApply: false }); await f.flow.captureInline();
    assert.equal(f.service.view().projection.people.length, 1);
    assert.equal(f.state.rpCore.facts.length, 1); assert.equal(f.service.view().projection.clock.date, null);
});

test('known relationship IDs stay stable across output order and temporary aliases', async () => {
    const f = await fixture('夏尔与Nana原本就是恋人。');
    const source = readChatSource(f.chat[0], f.state, { allocate: true, makeId: () => 'fixed' });
    const events = (a, b, r) => [
        { track: 'facts', action: 'relationship_recorded', data: { id: r, from: a, to: b, kind: 'romantic', mutual: true }, excerpt: '夏尔与Nana原本就是恋人。' },
        { track: 'facts', action: 'person_registered', data: { id: a, name: '夏尔' }, excerpt: '夏尔' },
        { track: 'facts', action: 'person_registered', data: { id: b, name: 'Nana' }, excerpt: 'Nana' },
    ];
    const first = normalizeEntityIdentities(events('a', 'b', 'r'), source);
    const second = normalizeEntityIdentities(events('x', 'y', 'pair').reverse(), source);
    assert.deepEqual(first.find(e => e.action === 'relationship_recorded').data, second.find(e => e.action === 'relationship_recorded').data);
});

test('independent requests receive body and reference context without summary facts', async () => {
    const f = await fixture('两人在看信。' + summary); let sent;
    const flow = createRpExtractionFlow({ getState: () => f.state, getChat: () => f.chat, service: f.service,
        getReferenceContext: async () => '设定参考', callGenerationModel: async request => { sent = request; return protocol([]); } });
    await flow.runIndependent({ manual: true });
    assert.equal(sent.prompt, '两人在看信。'); assert.match(sent.systemPrompt, /不作为本轮新事实/);
    assert.equal(f.state.rpCore.settings.mode, 'inline'); assert.equal(f.service.view().projection.people.length, 0);
    assert.equal(f.state.turnSummary.enabled, undefined);
});

test('summary-only changes during an independent request leave the body ticket valid', async () => {
    const f = await fixture('正文。' + summary); await f.service.configure({ mode: 'independent' }); let requests = 0;
    const flow = createRpExtractionFlow({ getState: () => f.state, getChat: () => f.chat, service: f.service,
        getReferenceContext: async () => { f.chat[0].mes = '正文。' + summary.replace('20:00', '21:00'); return ''; },
        callGenerationModel: async () => { requests++; return protocol([]); } });
    await flow.runIndependent(); assert.equal(requests, 1); assert.equal(f.state.rpCore.facts.length, 0);
});

test('invalid candidate is isolated without admitting summary headers as fallback facts', async () => {
    const f = await fixture(summary + protocol([null]));
    assert.equal(await f.flow.captureInline(), true);
    assert.equal(f.service.view().projection.clock.date, null);
    assert.equal(f.service.view().projection.locations.length, 0);
    assert.deepEqual(f.state.rpCore.batches[0].protocolIssues.map(issue => issue.index), [1]);
});

test('I06 canonical and labelled summary headers remain narrative-only in new records', async () => {
    for (const header of ['★1889年10月15日-星期二-20:00★地点：客厅★在场角色：夏尔、Nana', '当前时间：1889年10月15日 20:00 当前地点：客厅']) {
        const f = await fixture('<bakemono>' + header + '</bakemono>');
        await f.flow.captureInline(); assert.equal(f.service.view().projection.clock.date, null); assert.equal(f.state.rpCore.batches.length, 0);
    }
});

test('multiple summary headers or a date range cannot silently choose the current scene or date', async () => {
    for (const content of [
        summary + summary.replace('20:00', '21:00').replace('宅邸客厅', '庭院'),
        '<bakemono>【时间：1889年10月15日—1889年10月18日★地点：客厅】</bakemono>',
    ]) {
        const f = await fixture(content);
        await f.flow.captureInline();
        assert.equal(f.service.view().projection.clock.date, null);
        assert.equal(f.service.view().projection.scene?.location ?? null, null);
    }
});

test('name-based current-state events register objects and known relationships without inventing a new romance date', async () => {
    const f = await fixture('夏尔与Nana是一对恋人，此刻他们在客厅。' + protocol([
        { track: 'facts', action: 'person_moved', data: { id: '夏尔', location: '客厅' }, excerpt: '夏尔与Nana是一对恋人，此刻他们在客厅。' },
        { track: 'facts', action: 'relationship_recorded', data: { id: 'pair', from: '夏尔', to: 'Nana', kind: 'romantic', mutual: true }, excerpt: '夏尔与Nana是一对恋人' },
    ]));
    await f.flow.captureInline();
    const view = f.service.view().projection;
    assert.equal(view.people.length, 2);
    assert.equal(view.locations.length, 1);
    assert.equal(view.relationships.length, 1);
    assert.equal(view.relationships[0].since, null);
    assert.equal(f.state.rpCore.candidates.filter(c => c.status === 'pending').length, 0);
});

test('missing opaque IDs and ambiguous names are not silently merged or invented', async () => {
    const f = await fixture('她来到客厅。' + protocol([{ track: 'facts', action: 'person_moved', data: { id: 'char_9', location: '客厅' }, excerpt: '她来到客厅。' }]));
    await f.flow.captureInline();
    assert.equal(f.service.view().projection.people.length, 0);
    assert.ok(f.state.rpCore.candidates.some(c => c.status === 'rejected'));
});

test('S12 truncated protocol never falls back to summary facts or marks success', async () => {
    const f = await fixture(summary + '<rpEvents>{"version":1,"events":[{"action":"item_consumed"');
    assert.equal((await f.flow.captureInline({ detailed: true })).status, 'incomplete');
    assert.equal(f.state.rpCore.facts.length, 0); assert.equal(f.state.rpCore.batches.length, 0);
    assert.equal(f.state.rpCore.extractionJobs[0].status, 'failed');
});
