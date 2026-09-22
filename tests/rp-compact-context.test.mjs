import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjection } from '../src/rp-core/domain.js';
import { compileRpContext } from '../src/rp-core/context.js';
import { createModelReferences, resolveModelReferences } from '../src/rp-core/model-references.js';
import { createRpCoreService } from '../src/rp-core/service.js';
import { createRpExtractionFlow } from '../src/rp-core/extraction-flow.js';
import { normalizeProtocolEvents } from '../src/rp-core/protocol.js';
import { parsePayload } from '../src/rp-core/extraction.js';

const long = name => 'entity:person:8556feca-b2bc-420f-a51b-84570718f0f7:7446c412-f9b2-4577-b14a-44a66fb13870:' + name;
function fixture() {
    const p = createProjection(), a = long('a'), b = long('b'), place = long('place');
    p.people = [{ id: a, name: 'Kuroha', location: place, states: [{ id: long('pain'), description: '胃痛，尚未恢复', active: true, visibility: 'private' }] }, { id: b, name: 'Nana', states: [] }];
    p.locations = [{ id: place, name: '二楼卧室' }];
    p.scene = { location: place, present: [a, b] }; p.clock = { date: '2024-04-12T23:45' };
    p.relationships = [{ id: long('relation'), from: a, to: b, kind: '同住', status: 'active', mutual: true }];
    p.items = [{ id: long('key'), name: '钥匙', owner: a, holder: b, quantity: 1, status: 'available', loan: { id: long('loan'), from: a, to: b } }];
    const claim = { id: 'claim-1', sequence: 1, floor: 0, data: { speaker: 'Kuroha', subject: 'Kuroha', description: '我没事' } };
    return { p, core: { revision: 1, settings: { enabled: true, inject: true, contextBudget: 4000 }, facts: [], claims: [claim], observations: [], decisions: [] } };
}
test('one compact current state replaces raw IDs, projection JSON and duplicated ledger', () => {
    const { p, core } = fixture();
    const c = compileRpContext(core, { projection: p }, { maintenance: true, guide: '规则' });
    assert.equal(c.blocked, false);
    assert.doesNotMatch(c.brief + c.maintenance, /entity:|8556feca|temporary:|"people"|近期已结算/);
    assert.match(c.brief, /胃痛/); assert.match(c.brief, /角色说法.*我没事/);
    assert.doesNotMatch(c.brief, /@rp/);
    assert.match(c.maintenance, /@rp/);
    assert.equal((c.brief + c.maintenance).split('胃痛').length - 1, 1);
    assert.ok(c.used <= c.budget);
    assert.equal(c.used, [c.brief, c.maintenance].filter(Boolean).join('\n\n').length);
});
test('reference identity is stable across sorting, insertion, renaming and same names', () => {
    const { p } = fixture(), first = createModelReferences(p), id = p.people[0].id;
    const token = first.ref('people', id);
    p.people.reverse(); p.people.push({ id: long('another'), name: 'Kuroha' }); p.people.find(x => x.id === id).name = '改名';
    assert.equal(createModelReferences(p).ref('people', id), token);
    const events = resolveModelReferences([{ track: 'facts', action: 'person_state_revised', data: { id: token, stateId: first.ref('states', long('pain'), id), description: '缓解但仍痛' } }], p);
    assert.equal(events[0].data.id, id); assert.equal(events[0].data.stateId, long('pain'));
    const byName = resolveModelReferences([{ track: 'facts', action: 'person_state_revised', data: { id: '改名', stateId: first.ref('states', long('pain'), id), description: '好转' } }], p);
    assert.equal(byName[0].resolutionIssue, undefined); assert.equal(byName[0].data.id, id);
    const wrong = resolveModelReferences([{ track: 'facts', action: 'person_moved', data: { id: first.ref('locations', p.locations[0].id), location: '@rpLmissing' } }], p);
    assert.ok(wrong[0].resolutionIssue);
});
test('ended, superseded and old-variant claims stay out; a small budget still supplies relevant state', () => {
    const { p, core } = fixture();
    core.claims.push({ id: 'old', sequence: 2, data: { speaker: 'Nana', description: '旧分支秘密' } }, { id: 'sup', superseded: true, sequence: 3, data: { description: '已替换' } });
    p.people.push(...Array.from({ length: 300 }, (_, i) => ({ id: long('extra' + i), name: '路人' + i, states: [] })));
    const c = compileRpContext(core, { projection: p, sourceStates: { old: 'stale' } }, { maintenance: true, guide: '规则', availableBudget: 1500 });
    assert.equal(c.blocked, false); assert.ok(c.used <= 1500); assert.match(c.brief, /Kuroha/);
    assert.doesNotMatch(c.brief + c.maintenance, /旧分支秘密|已替换/);
    assert.ok(c.omitted > 0);
});
test('compact person/state/loan references ingest through the real service without changing saved identities', async () => {
    const state = {}, chat = [{ mes: '二人在房间，胃痛，借了钥匙。' }]; let serial = 0;
    const service = createRpCoreService({ getState: () => state, getChat: () => chat, makeSourceId: () => long('source' + ++serial), saveState() {}, saveChat: async () => {} });
    await service.enable(); const { p } = fixture(); state.rpCore.baseline.projection = p;
    const refs = createModelReferences(p), a = p.people[0].id, key = p.items[0];
    const block = events => '<rpEvents>' + JSON.stringify({ version: 2, events }) + '</rpEvents>';
    await service.ingest(block([{ action: 'person_state_revised', data: { id: refs.ref('people', a), stateId: refs.ref('states', long('pain'), a), description: '缓解但仍痛' } },
        { action: 'item_returned', data: { id: refs.ref('items', key.id), loanId: refs.ref('loans', key.loan.id, key.id) } }]), 0);
    const actual = service.view().projection;
    assert.equal(actual.people[0].id, a); assert.equal(actual.people[0].states[0].description, '缓解但仍痛');
    assert.equal(actual.items[0].loan, null); assert.equal(actual.items[0].holder, a);
    const before = actual.people.length;
    chat.push({ mes: '未知引用不能制造人物。' });
    await service.ingest(block([{ action: 'person_moved', data: { id: '@rpPmissing', location: refs.ref('locations', p.locations[0].id) } }]), 1);
    assert.equal(service.view().projection.people.length, before);
    assert.equal(state.rpCore.candidates.at(-1).status, 'rejected');
});
test('short-reference reroll removes obsolete claims and loan changes, retains user corrections and survives reload', async () => {
    let state = {}, chat = [{ mes: '旧场景' }], serial = 0;
    const service = createRpCoreService({ getState: () => state, getChat: () => chat, makeSourceId: () => long('source' + ++serial), saveState() {}, saveChat: async () => {} });
    await service.enable(); const { p } = fixture(); state.rpCore.baseline.projection = p;
    const refs = createModelReferences(p), a = p.people[0].id, key = p.items[0];
    const block = events => '<rpEvents>' + JSON.stringify({ version: 2, events }) + '</rpEvents>';
    const flow = createRpExtractionFlow({ getState: () => state, getChat: () => chat, service });
    const answerA = '疼痛缓解，钥匙归还。' + block([{ action: 'person_state_revised', data: { id: refs.ref('people', a), stateId: refs.ref('states', long('pain'), a), description: '疼痛缓解' } },
        { action: 'item_returned', data: { id: refs.ref('items', key.id), loanId: refs.ref('loans', key.loan.id, key.id) } },
        { track: 'claims', data: { speaker: refs.ref('people', a), description: '我没事' } }]);
    chat[0] = { mes: answerA, swipe_id: 0, swipes: [answerA], swipe_info: [{ extra: {} }, { extra: {} }] };
    await flow.captureInline(); assert.equal(service.view().projection.items[0].loan, null);
    const revision = state.rpCore.revision; await flow.captureInline(); assert.equal(state.rpCore.revision, revision);
    await service.editTemporary(a, long('pain'), { description: '人工修正：仍然疼痛' }, { expectedRevision: state.rpCore.revision });
    chat[0].mes = '没有归还钥匙。' + block([]); chat[0].swipe_id = 1; chat[0].extra = {};
    await flow.captureInline();
    assert.equal(service.view().projection.items[0].loan.id, key.loan.id);
    assert.match(flow.context().brief, /人工修正：仍然疼痛/); assert.doesNotMatch(flow.context().brief, /我没事/);
    state = JSON.parse(JSON.stringify(state)); chat = JSON.parse(JSON.stringify(chat));
    assert.equal(createModelReferences(service.view().projection).ref('people', a), refs.ref('people', a));
    assert.match(flow.context().brief, /人工修正：仍然疼痛/);
});
test('independent requests reserve the current body and compact state before optional older context', async () => {
    const state = {}, chat = [{ mes: '较早对话'.repeat(500) }, { is_user: true, mes: '上一轮输入'.repeat(300) }, { mes: '当前正文：Nana进入房间。' }];
    const service = createRpCoreService({ getState: () => state, getChat: () => chat, saveState() {}, saveChat: async () => {} });
    await service.enable(); state.rpCore.baseline.projection = fixture().p;
    await service.configure({ mode: 'independent', contextBudget: 5000 }); let request;
    const flow = createRpExtractionFlow({ getState: () => state, getChat: () => chat, service, getReferenceContext: async () => '很长的参考设定。'.repeat(2000),
        callGenerationModel: async value => { request = value; return '<rpEvents>{"version":2,"events":[]}</rpEvents>'; } });
    assert.equal(await flow.runIndependent(), true);
    assert.equal(request.prompt, '当前正文：Nana进入房间。');
    assert.match(request.systemPrompt, /胃痛/); assert.doesNotMatch(request.systemPrompt, /entity:|temporary:/);
    assert.ok(request.prompt.length + request.systemPrompt.length <= 5000);
});
test('malformed knowledge scopes cannot poison valid neighbouring records', () => {
    const events = parsePayload(JSON.stringify({ version: 2, events: [{ track: 'claims', data: { speaker: {}, description: '错误' } },
        { track: 'claims', data: { speaker: '甲', description: '错误', heardBy: '所有人' } }, { action: 'clock_set', data: { description: '晚上' } }] }));
    const result = normalizeProtocolEvents(events);
    assert.equal(result.events.length, 1); assert.equal(result.issues.length, 2); assert.equal(result.events[0].action, 'clock_set');
});
