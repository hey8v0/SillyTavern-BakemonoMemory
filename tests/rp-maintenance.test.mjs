import test from 'node:test';
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

test('inline summary-only metadata automatically records clock and scene with no additional request', async () => {
    const f = await fixture('两人在看信。' + summary);
    const result = await f.flow.captureInline({ detailed: true });
    assert.equal(result.status, 'processed');
    const view = f.service.view().projection;
    assert.equal(view.clock.date, '1889-10-15T20:00');
    assert.equal(view.locations.find(p => p.id === view.scene.location).name, '宅邸客厅');
    assert.deepEqual(view.people.map(p => p.name).sort(), ['Nana', '夏尔']);
    assert.ok(view.people.every(p => p.location === view.scene.location));
    assert.equal(view.relationships.length, 0);
    assert.equal(f.state.rpCore.candidates.filter(c => c.status === 'pending').length, 0);
    assert.ok(f.state.rpCore.facts.every(fact => fact.evidence.sourceKind === 'summary'));
    assert.equal(f.requests(), 0);
    assert.equal((await f.flow.captureInline({ detailed: true })).status, 'unchanged');
    assert.doesNotThrow(() => exportRpBackup(f.state.rpCore));
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

test('configured summary tags work and excluded footer changes do not alter summary evidence', async () => {
    const f = await fixture(summary.replaceAll('bakemono', 'memo'), { scanRules: { includeTags: 'memo' } });
    await f.flow.captureInline();
    const before = f.service.view().applied;
    assert.ok(before.length > 0);
    f.chat[0].mes = f.chat[0].mes.replace('明天他们要结婚了。', '新小剧场。') + '<widget>状态组件</widget>';
    assert.deepEqual(f.service.view().applied, before);
});

test('the next reply preserves unmentioned state and summary objects do not multiply', async () => {
    const f = await fixture(summary);
    await f.flow.captureInline();
    const before = structuredClone(f.service.view().projection);
    f.chat.push({ is_user: true, mes: '继续' }, { mes: '她继续看信。' });
    await f.flow.captureInline();
    assert.deepEqual(f.service.view().projection, before);
    f.chat.push({ mes: summary.replace('20:00', '21:00') });
    await f.flow.captureInline();
    const view = f.service.view().projection;
    assert.equal(view.clock.date, '1889-10-15T21:00');
    assert.equal(view.people.length, 2);
    assert.equal(view.locations.length, 1);
    assert.match(renderRpStateMemory(f.state, f.service.view()), /当前场景：宅邸客厅/);
    assert.equal(f.state.rpCore.candidates.filter(c => c.status === 'pending').length, 0);
    const savedState = JSON.parse(JSON.stringify(f.state)), savedChat = JSON.parse(JSON.stringify(f.chat));
    const reloaded = createRpCoreService({ getState: () => savedState, getChat: () => savedChat, saveState() {}, saveChat: async () => {} });
    assert.deepEqual(reloaded.view().projection, view);
    assert.deepEqual(exportRpBackup(savedState.rpCore).facts, f.state.rpCore.facts);
});

test('same-source automatic additions do not duplicate summary facts or revive ignored results', async () => {
    const first = { track: 'claims', action: 'claim_made', data: { description: '她说好' }, excerpt: '她说好。' };
    const f = await fixture('她说好。她看信。' + summary + protocol([first]));
    await f.flow.captureInline();
    const count = f.state.rpCore.facts.length;
    const addition = { track: 'observations', action: 'observation', data: { description: '她看信' }, excerpt: '她看信。' };
    await f.service.configure({ autoApply: false });
    f.chat[0].mes = '她说好。她看信。' + summary + protocol([first, addition]);
    await f.flow.captureInline();
    assert.equal(f.state.rpCore.facts.length, count);
    const candidate = f.state.rpCore.candidates.find(c => c.track === 'observations');
    await f.service.review(candidate.id, 'ignore');
    await f.service.configure({ autoApply: true });
    await f.flow.captureInline();
    assert.equal(f.state.rpCore.observations.length, 0);
    assert.equal(f.state.rpCore.candidates.find(c => c.id === candidate.id).status, 'ignored');
});

test('an imprecise time in a later summary does not erase an already known date', async () => {
    const f = await fixture(summary);
    await f.flow.captureInline();
    f.chat.push({ mes: '<bakemono>【时间：傍晚★地点：宅邸客厅】</bakemono>' });
    await f.flow.captureInline();
    assert.equal(f.service.view().projection.clock.date, '1889-10-15T20:00');
});

test('manual review can atomically accept a group with both body and summary evidence', async () => {
    const f = await fixture('Nana微笑。' + summary + protocol([{ track: 'facts', action: 'person_created', data: { id: 'n', name: 'Nana' }, excerpt: 'Nana微笑。' }]));
    await f.service.configure({ autoApply: false });
    await f.flow.captureInline();
    const candidate = f.state.rpCore.candidates.find(c => c.action === 'person_moved' && c.data.id.includes('person'));
    await f.service.review(candidate.id, 'accept');
    assert.ok(f.service.view().projection.people.some(p => p.location));
    assert.ok(!f.service.view().pending.length);
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

test('independent requests get bounded summaries and references without changing inline mode', async () => {
    const f = await fixture('两人在看信。' + summary);
    await f.service.configure({ mode: 'independent' });
    let sent;
    const flow = createRpExtractionFlow({ getState: () => f.state, getChat: () => f.chat, service: f.service,
        getReferenceContext: async () => '设定参考'.repeat(5000),
        callGenerationModel: async request => { sent = request; return protocol([]); } });
    await flow.runIndependent();
    assert.match(sent.prompt, /宅邸客厅/);
    assert.match(sent.systemPrompt, /非本轮新证据/);
    assert.ok(sent.systemPrompt.length < 20000);
    assert.equal(f.service.view().projection.people.length, 2);
    assert.equal(f.state.turnSummary.enabled, undefined);
});

test('summary changes during reference preparation reject a stale independent request', async () => {
    const f = await fixture(summary);
    await f.service.configure({ mode: 'independent' });
    let requests = 0;
    const flow = createRpExtractionFlow({ getState: () => f.state, getChat: () => f.chat, service: f.service,
        getReferenceContext: async () => { f.chat[0].mes = summary.replace('20:00', '21:00'); return ''; },
        callGenerationModel: async () => { requests++; return protocol([]); } });
    await assert.rejects(flow.runIndependent(), /来源已变化/);
    assert.equal(requests, 0);
    assert.equal(f.state.rpCore.facts.length, 0);
});

test('invalid candidate structure cannot partially apply the metadata fallback', async () => {
    const f = await fixture(summary + protocol([null]));
    await assert.rejects(f.flow.captureInline(), /结构无效/);
    assert.equal(f.state.rpCore.facts.length, 0);
});

test('summary headers accept canonical date lines and newline-separated labels without reading narrative guesses', async () => {
    for (const header of [
        '★1889年10月15日-星期二-20:00★地点：客厅★在场角色：夏尔、Nana',
        '当前时间：1889年10月15日 20:00\n当前地点：客厅\n在场角色：夏尔、Nana',
    ]) {
        const f = await fixture('<bakemono>【' + header + '】\n➤【场记】正文。</bakemono>');
        await f.flow.captureInline();
        const p = f.service.view().projection;
        assert.equal(p.clock.date, '1889-10-15T20:00');
        assert.equal(p.locations[0].name, '客厅');
        assert.equal(p.people.length, 2);
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
    assert.ok(f.state.rpCore.candidates.some(c => c.status === 'pending'));
});

test('incomplete protocol preserves independent explicit summary updates, but never applies a partial JSON event', async () => {
    const f = await fixture(summary + '<rpEvents>{"version":1,"events":[{"action":"item_consumed"');
    const result = await f.flow.captureInline({ detailed: true });
    assert.equal(result.status, 'processed');
    assert.equal(result.protocolStatus, 'incomplete');
    assert.equal(f.service.view().projection.clock.date, '1889-10-15T20:00');
    assert.equal(f.state.rpCore.facts.some(f => f.action === 'item_consumed'), false);
});
