import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpCoreService } from '../src/rp-core/service.js';
import { createRpExtractionFlow } from '../src/rp-core/extraction-flow.js';
import { exportRpBackup, importRpBackup } from '../src/rp-core/backup.js';
import { seedLegacyExtraction } from './helpers/legacy-rp-extraction.mjs';
import { rpMemorySources, renderRpStateMemory } from '../src/rp-core/memory.js';
const raw = events => JSON.stringify({ version: 1, events });
async function fixture() {
    let state = {}, fail = false, id = 0;
    const chat = [{ mes: '她来到书店。甲因饮酒而胃痛。她否认交往。' }];
    const service = createRpCoreService({ getState: () => state, getChat: () => chat, makeSourceId: () => String(++id), saveState() {}, saveChat: async () => { if (fail) throw Error('save failed'); } });
    await service.enable();
    return { service, chat, get state() { return state; }, fail: value => { fail = value; }, switch: () => { state = {}; } };
}
const simple = { version: 1, state: { clock: { date: '2024-04-12T23:45' }, scene: { location: '书店' },
    people: [{ name: '甲', location: '书店', states: [{ id: 'pain', description: '胃痛' }] }, { name: '乙' }],
    relationships: [{ from: '甲', to: '乙', kind: 'friend' }], items: [{ name: '钥匙', holder: '甲', quantity: 1 }],
    plans: [{ title: '一起看海', participants: ['甲', '乙'], status: 'accepted' }] }, claims: [{ speaker: '乙', description: '否认交往' }] };
test('model records state without quotations or repeated user confirmation', async () => {
    const f = await fixture(); await f.service.ingest(JSON.stringify(simple), 0);
    const p = f.service.view().projection;
    assert.equal(p.clock.date, '2024-04-12T23:45');
    assert.equal(p.people.length, 2); assert.equal(p.locations.length, 1);
    assert.equal(p.relationships[0].kind, 'friend'); assert.equal(p.items[0].quantity, 1);
    assert.equal(p.plans[0].status, 'accepted'); assert.equal(f.state.rpCore.claims.length, 1);
    assert.equal(f.state.rpCore.candidates.filter(x => x.status === 'pending').length, 0);
    assert.ok(f.state.rpCore.facts.every(x => x.origin?.kind === 'model'));
    const count = f.state.rpCore.facts.length;
    await f.service.ingest(JSON.stringify(simple), 0);
    assert.equal(f.state.rpCore.facts.length, count);
    const copy = JSON.parse(JSON.stringify(exportRpBackup(f.state.rpCore)));
    assert.ok(importRpBackup(copy).facts.every(x => x.origin.kind === 'model'));
});
test('legacy rpEvents with rewritten evidence also auto-record, but do not claim exact quotation', async () => {
    const f = await fixture(); await f.service.ingest(raw([
        { track: 'facts', action: 'scene_recorded', data: { location: '书店' }, excerpt: '本轮位于书店。' },
        { track: 'facts', action: 'person_state_started', data: { id: '甲', stateId: 'pain', description: '因饮酒胃痛' }, excerpt: '他喝酒后肚子痛' },
        { track: 'claims', data: { speaker: '乙', description: '否认交往' }, excerpt: '改写的否认句' },
    ]), 0);
    assert.equal(f.service.view().projection.people[0].states[0].description, '因饮酒胃痛');
    assert.equal(f.state.rpCore.claims.length, 1);
    assert.equal(f.state.rpCore.candidates.filter(x => x.status === 'pending').length, 0);
    assert.equal(f.state.rpCore.claims[0].evidence, null);
});
test('source changes invalidate model records and late results do not cross chats', async () => {
    const f = await fixture(); await f.service.ingest(JSON.stringify(simple), 0);
    f.chat[0].mes = '重生成后的另一段故事';
    assert.equal(f.service.view().projection.people.length, 0);
    const flow = createRpExtractionFlow({ getState: () => f.state, getChat: () => f.chat, service: f.service });
    const ticket = flow.capture(0, 'inline'); f.switch();
    await assert.rejects(flow.consume(ticket, '<rpEvents>' + JSON.stringify(simple) + '</rpEvents>'), /变化/);
});
test('user edits state directly, persist as corrections, and survive same-source re-extraction', async () => {
    const f = await fixture(); await f.service.ingest(JSON.stringify(simple), 0);
    const person = f.service.view().projection.people[0], revision = f.state.rpCore.revision;
    await f.service.editEntity('people', person.id, { name: '甲的新名字', location: null }, { expectedRevision: revision });
    assert.equal(f.service.view().projection.people[0].name, '甲的新名字');
    await f.service.ingest(JSON.stringify(simple), 0);
    assert.equal(f.service.view().projection.people[0].name, '甲的新名字');
    assert.ok(f.state.rpCore.facts.some(x => x.origin?.kind === 'user'));
    await assert.rejects(f.service.editEntity('people', person.id, { name: '迟到覆盖' }, { expectedRevision: revision }), /变化/);
});
test('editing failure, invalid quantity and hierarchy cycles cannot corrupt stored state', async () => {
    const f = await fixture(); await f.service.ingest(JSON.stringify(simple), 0);
    const p = f.service.view().projection, before = JSON.stringify(f.state.rpCore);
    await assert.rejects(f.service.editEntity('items', p.items[0].id, { quantity: -1 }), /数量/);
    await assert.rejects(f.service.editEntity('locations', p.locations[0].id, { parent: p.locations[0].id }), /循环/);
    f.fail(true); await assert.rejects(f.service.editEntity('people', p.people[0].id, { name: '保存失败的名字' }), /save failed/);
    assert.equal(JSON.stringify(f.state.rpCore), before);
});
test('malformed records are skipped with reasons, not sent to a human review queue', async () => {
    const f = await fixture();
    await f.service.ingest(raw([{ track: 'facts', action: 'item_consumed', data: { id: '钥匙', quantity: -2 } }, { track: 'claims', data: { description: '有效说法' } }]), 0);
    assert.equal(f.state.rpCore.claims.length, 1);
    assert.equal(f.state.rpCore.candidates.filter(x => x.status === 'pending').length, 0);
    assert.ok(f.state.rpCore.candidates.some(x => x.status === 'rejected'));
});
test('pre-upgrade pending entries are automatically retried once, ignored decisions remain ignored', async () => {
    const f = await fixture(); await f.service.configure({ autoApply: false });
    const events = [{ track: 'facts', action: 'person_created', data: { id: 'a', name: '甲' }, excerpt: '改写的胃痛描写' },
        { track: 'claims', data: { description: '明确拒绝的旧说法' } }];
    seedLegacyExtraction(f.state, f.chat, raw(events), 0);
    await f.service.review(f.state.rpCore.candidates.find(c => c.track === 'claims').id, 'ignore');
    assert.equal(await f.service.reconcilePending(), true);
    assert.equal(f.service.view().projection.people[0].name, '甲');
    assert.equal(f.state.rpCore.candidates.filter(c => c.status === 'pending').length, 0);
    assert.equal(await f.service.reconcilePending(), false);
    await f.service.ingest(raw(events), 0);
    assert.equal(f.state.rpCore.claims.length, 0);
    assert.doesNotThrow(() => exportRpBackup(f.state.rpCore));
});
test('information edits retain the audit but only current replacement enters memory', async () => {
    const f = await fixture(); await f.service.ingest(JSON.stringify(simple), 0);
    const old = f.state.rpCore.claims[0];
    await f.service.editInformation('claims', old.id, { description: '用户修正的说法' });
    assert.equal(f.state.rpCore.claims.length, 2);
    assert.equal(f.service.view().sourceStates[old.id], 'replaced');
    assert.equal(f.state.rpCore.claims[1].replaces, old.id);
    assert.equal(importRpBackup(exportRpBackup(f.state.rpCore)).claims[1].replaces, old.id);
});
test('state updates use stable references across rounds and preserve omitted fields', async () => {
    const f = await fixture(); await f.service.ingest(JSON.stringify(simple), 0);
    const before = f.service.view().projection;
    f.chat.push({ mes: '她把钥匙放进书店。甲的胃痛好了。' });
    await f.service.ingest(JSON.stringify({ version: 1, state: { people: [{ name: '甲', states: [] }], items: [{ name: '钥匙', holder: null, location: '书店' }] } }), 1);
    const after = f.service.view().projection;
    assert.equal(after.people.length, 2); assert.equal(after.people[0].states[0].description, '胃痛');
    assert.ok(f.state.rpCore.candidates.some(item => item.status === 'rejected' && /覆盖/.test(item.reason)));
    assert.equal(after.people[0].location, before.people[0].location);
    assert.equal(after.items.length, 1); assert.equal(after.items[0].quantity, 1);
    assert.equal(after.items[0].holder, null);
});
test('relationship name and ID references update the same relationship, not a new copy', async () => {
    const f = await fixture(); await f.service.ingest(JSON.stringify(simple), 0);
    const before = f.service.view().projection;
    f.chat.push({ mes: '甲与乙结束了朋友关系。' });
    await f.service.ingest(JSON.stringify({ version: 1, state: { relationships: [{ from: before.people[0].id, to: before.people[1].id, kind: 'friend', status: 'ended' }] } }), 1);
    const after = f.service.view().projection;
    assert.equal(after.relationships.length, 1); assert.equal(after.relationships[0].id, before.relationships[0].id);
    assert.equal(after.relationships[0].status, 'ended');
});
test('automatic state details enter typed memory and active person states enter injection', async () => {
    const f = await fixture(); await f.service.ingest(JSON.stringify(simple), 0);
    assert.match(renderRpStateMemory(f.state, f.service.view()), /胃痛/);
    assert.ok(rpMemorySources(f.state, f.service.view()).some(item => /临时状态：胃痛/.test(item.text)));
    assert.ok(rpMemorySources(f.state, f.service.view()).some(item => /数量：1/.test(item.text)));
});

test('I07 summary edits do not invalidate body-owned state or trigger re-ingestion', async () => {
    const f = await fixture(); const body = f.chat[0].mes;
    f.chat[0].mes = body + '<bakemono>2024-04-12 书店</bakemono>';
    await f.service.ingest(JSON.stringify(simple), 0);
    const revision = f.state.rpCore.revision;
    f.chat[0].mes = body + '<bakemono>2024-04-13 书店</bakemono>';
    assert.equal(f.service.view().projection.clock.date, '2024-04-12T23:45');
    await f.service.ingest(JSON.stringify({ ...simple, state: { ...simple.state, clock: { date: '2024-04-13T23:45' } } }), 0);
    assert.equal(f.state.rpCore.revision, revision);
    assert.equal(f.service.view().projection.clock.date, '2024-04-12T23:45');
});
