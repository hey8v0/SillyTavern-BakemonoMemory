import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpCoreService } from '../src/rp-core/service.js';
import { createRpExtractionFlow } from '../src/rp-core/extraction-flow.js';
import { applyDomainFact, createProjection } from '../src/rp-core/domain.js';
import { compileRpContext } from '../src/rp-core/context.js';
const block = events => '<rpEvents>' + JSON.stringify({ version: 2, events }) + '</rpEvents>';
const event = (action, data) => ({ track: 'facts', action, data });
async function fixture() {
    let state = {}, serial = 0, fail = false;
    const chat = [{ mes: '甲进门，喝了两口水。<bakemono>2024-04-12 书店</bakemono>' }];
    const service = createRpCoreService({ getState: () => state, getChat: () => chat, makeSourceId: () => 'id-' + ++serial,
        getChatIdentity: () => 'chat-A', saveState: () => ({}), saveChat: async () => { if (fail) throw new Error('save failed'); } });
    await service.enable();
    const flow = createRpExtractionFlow({ getState: () => state, getChat: () => chat, service,
        callGenerationModel: async () => block([]) });
    return { service, flow, chat, get state() { return state; }, fail: () => { fail = true; }, switchChat: () => { state = structuredClone(state); } };
}
test('I01 I03 I04 I05 I06: independent activation and body-only policy', async () => {
    const f = await fixture();
    assert.equal(f.state.rpCore.baseline.projection.people.length, 0);
    assert.equal((await f.flow.captureInline({ detailed: true })).status, 'missing');
    assert.equal(f.state.rpCore.batches.length, 0);
    const source = f.flow.capture(0, 'inline').source;
    f.state.turnSummary = { triggerTiming: 'next_user', includeTags: 'missing', excludeTags: 'p' };
    f.state.scanRules = { includeTags: 'different' }; f.state.tableDatabase = { tables: [{ rows: [[1]] }] };
    assert.equal(f.flow.capture(0, 'inline').source.revision, source.revision);
    assert.equal(f.flow.capture(0, 'inline').source.text.includes('2024'), false);
});
test('S08 S09 S12: empty success, missing/truncated not success, automatic source idempotence', async () => {
    const f = await fixture();
    assert.equal((await f.flow.consume(f.flow.capture(0, 'inline'), '<rpEvents>{')).status, 'incomplete');
    await f.flow.consume(f.flow.capture(0, 'inline'), block([]));
    const rev = f.state.rpCore.revision;
    assert.equal((await f.flow.consume(f.flow.capture(0, 'inline'), block([event('clock_set', { date: '2024-01-01' })]))).status, 'unchanged');
    assert.equal(f.state.rpCore.revision, rev);
});
test('I08: manual extraction works in paused inline without changing automatic settings', async () => {
    const f = await fixture(); await f.service.configure({ automatic: false });
    assert.equal(await f.flow.runIndependent({ manual: true }), true);
    assert.equal(f.state.rpCore.settings.mode, 'inline'); assert.equal(f.state.rpCore.settings.automatic, false);
});
test('S01 S02 S04 S05 S06: local state rules preserve omissions and guard explicit transitions', () => {
    let p = createProjection();
    const apply = (action, data) => { p = applyDomainFact(p, { ...event(action, data), ruleVersion: 3, origin: { kind: 'model' } }); };
    apply('person_created', { id: 'a', name: '甲' });
    apply('person_state_started', { id: 'a', stateId: 'injury', description: '受伤' });
    apply('person_state_started', { id: 'a', stateId: 'fatigue', description: '疲劳' });
    apply('person_state_ended', { id: 'a', stateId: 'fatigue' });
    assert.equal(p.people[0].states[0].ended, undefined);
    assert.throws(() => apply('state_updated', { collection: 'people', id: 'a', values: { states: [] } }), /覆盖/);
    apply('item_registered', { id: 'key', name: '钥匙' }); apply('item_destroyed', { id: 'key' });
    assert.throws(() => apply('state_updated', { collection: 'items', id: 'key', values: { status: 'available' } }), /恢复/);
    apply('item_restored', { id: 'key' }); assert.equal(p.items[0].quantity, null);
    apply('item_consumed', { id: 'key', quantity: 1 }); assert.equal(p.items[0].quantity, null);
});
test('P01 P02 P03 P08: all-entity relevance and indivisible budgets', () => {
    const p = createProjection();
    p.people = Array.from({ length: 101 }, (_, i) => ({ id: 'p' + i, name: '人物' + i, states: [], traits: [] }));
    p.scene = { present: ['p100'] }; p.items = [{ id: 'k', name: '钥匙', owner: 'p100', holder: null, location: '远方', status: 'destroyed', quantity: 0 }];
    const core = { revision: 9, settings: { enabled: true, inject: true, contextBudget: 1000 } };
    const result = compileRpContext(core, { projection: p }, { query: '继续' });
    assert.match(result.brief, /人物100/); assert.match(result.brief, /已销毁，不可继续使用/); assert.match(result.brief, /远方/);
    assert.equal(compileRpContext(core, { projection: p }, { guide: '规则', maintenance: true }).blocked, true);
});
test('R01 R05: stale ticket and failed save cannot alter RP or other data', async () => {
    const f = await fixture(), ticket = f.flow.capture(0, 'inline');
    f.chat[0].mes = '另一条正文'; await assert.rejects(f.flow.consume(ticket, block([])), /变化/);
    f.state.storySummaries = [{ content: '保持' }]; const old = JSON.stringify(f.state.rpCore); f.fail();
    await assert.rejects(f.service.editEntity('people', '', { name: '手动人物' }, { create: true }));
    assert.equal(JSON.stringify(f.state.rpCore), old); assert.equal(f.state.storySummaries[0].content, '保持');
});
