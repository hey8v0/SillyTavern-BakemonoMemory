import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeHost } from './helpers/rp-runtime-host.mjs';
import { createRpCoreService } from '../src/rp-core/service.js';
import { createRpExtractionFlow } from '../src/rp-core/extraction-flow.js';
import { createLedger, replayLedger, appendRecord } from '../src/rp-core/ledger.js';
import { createProjection, applyDomainFact } from '../src/rp-core/domain.js';
import { exportRpBackup, validateRpBackup } from '../src/rp-core/backup.js';
import { rpMemorySources } from '../src/rp-core/memory.js';
import { buildStatePage } from '../src/rp-core/state-view.js';
import { RP_EVENT_GUIDE } from '../src/rp-core/prompt.js';
const block = events => '<rpEvents>' + JSON.stringify({ version: 2, events }) + '</rpEvents>';
const e = (action, data, extra = {}) => ({ action, data, ...extra });
async function fixture() { const h = runtimeHost(); await h.service.enable(); return h; }
async function append(h, text, events) { h.chat.push({ mes: text + block(events) }); await h.flow.captureInline(); }

test('I02 P04 P05: production service→flow→orchestrator→injection with summary and tables disabled', async () => {
    const h = await fixture(); h.state.tableDatabase = { enabled: false, injectMemory: false, tables: [] };
    h.chat[0].mes += block([e('person_registered', { id: '甲', name: '甲' }), e('scene_recorded', { location: '书店', present: ['甲'] })]);
    await h.orchestrator.runMemoryOrchestrator('正文完成', { scan: false });
    assert.equal(h.service.view().projection.people[0].name, '甲');
    assert.match(h.prompts.get('rp'), /变化记录/); assert.match(h.prompts.get('memory'), /当前剧情状态/);
    assert.equal(h.prompts.get('summary'), ''); assert.equal(h.prompts.get('table'), '');
    const parts = h.injection.getInjectionMemoryParts(); assert.equal(parts.sources.table, ''); assert.match(parts.sources.rpState, /甲/);
    assert.equal([...h.prompts.values()].filter(text => text.includes('<rpEvents>')).length, 1);
    assert.ok(parts.rpContext.used <= parts.rpContext.budget);
    h.state.inlineGeneration.tableEnabled = true; h.state.inlineGeneration.tablePrompt = '旧表规则'.repeat(50);
    h.state.injection.template = '{{memory}}\n{{memory}}'; h.state.injection.memoryBudgetChars = 7000;
    h.injection.syncInjection();
    assert.ok([...h.prompts.values()].reduce((sum, text) => sum + text.length, 0) <= 7000, 'actual slots include appended table rules and repeated memory template');
    h.state.inlineGeneration.tableEnabled = false; h.state.injection.template = '{{memory}}';
    h.state.injection.memoryBudgetChars = 100; h.injection.syncInjection();
    assert.equal(h.prompts.get('rp'), ''); assert.ok(h.injection.getInjectionMemoryParts().rpContext.blocked);
    h.state.injection.memoryBudgetChars = 60000; h.state.tableDatabase.injectMemory = true;
    await h.service.configure({ enabled: false }); h.injection.syncInjection();
    assert.equal(h.prompts.get('rp'), ''); assert.doesNotMatch(h.prompts.get('memory'), /当前剧情状态/); assert.match(h.prompts.get('memory'), /旧表独立/);
});

test('I05: actual MESSAGE_SENT callback honors RP delayed timing with legacy delayed processing disabled', async () => {
    const h = await fixture(); await h.service.configure({ triggerTiming: 'next_user' });
    h.chat[0].mes += block([e('clock_set', { description: '傍晚' })]);
    assert.equal(await h.flow.captureInline(), false);
    h.chat.push({ is_user: true, mes: '继续' }); await h.sendUser();
    assert.equal(h.service.view().projection.clock.description, '傍晚'); assert.equal(h.state.rpCore.facts[0].order, 0);
});

test('I09 I11 R07: migration preserves legacy baseline, prompt and paused choice, and is idempotent', async () => {
    const h = runtimeHost(), p = createProjection(); p.people.push({ id: 'old', name: '旧人物', aliases: [], traits: [], states: [], location: null });
    const old = createLedger(p); old.ruleVersion = 2; old.settings = { enabled: true, mode: 'reply', automatic: true, inject: true };
    h.state.rpCore = old; h.state.turnSummary.excludeTags = 'footer';
    await h.library.commit('apply', { ...h.library.draft(), prompt: '我的旧提示词' });
    await h.service.migrate(); assert.deepEqual(h.state.rpCore.upgradeSnapshot, old);
    assert.equal(h.state.rpCore.settings.automatic, false); assert.equal(h.state.rpCore.settings.modeNeedsChoice, true);
    assert.equal(h.service.view().projection.people[0].id, 'old'); assert.equal(h.library.current(), '我的旧提示词');
    const saved = JSON.stringify(h.state.rpCore); await h.service.migrate(); assert.equal(JSON.stringify(h.state.rpCore), saved);
    h.state.rpCore.ruleVersion = 99; assert.throws(() => h.service.view(), /不支持/); assert.equal(h.service.memoryView(), null);
});

test('S01 S10 S13: same-looking temporary states have separate stable IDs and directed visibility', async () => {
    const h = await fixture();
    await h.service.ingest(block([e('person_registered', { id: 'a', name: '甲' }), e('person_registered', { id: 'b', name: '乙' }),
        e('person_state_started', { id: 'a', stateId: 'left', description: '左臂受伤' }), e('person_state_started', { id: 'a', stateId: 'right', description: '右臂受伤' }),
        e('person_state_started', { id: 'a', stateId: 'worried', description: '担心乙', visibility: 'private', target: 'b' })]), 0);
    const person = h.service.view().projection.people[0], ids = person.states.map(item => item.id);
    assert.equal(new Set(ids).size, 3); assert.equal(person.traits.length, 0); assert.notEqual(ids[0], 'left');
    await append(h, '甲的左臂康复。', [e('person_state_ended', { id: person.id, stateId: ids[0] })]);
    const current = h.service.view().projection.people[0]; assert.equal(current.states[0].active, false); assert.equal(current.states[1].active, true);
    assert.match(h.flow.context().brief, /内心，非公开知识/); assert.equal(current.states[2].target, h.service.view().projection.people[1].id);
    await h.service.editTemporary(person.id, ids[1], { description: '右臂正在恢复' }, { expectedRevision: h.state.rpCore.revision });
    assert.equal(h.service.view().projection.people[0].states[1].id, ids[1]);
});

test('S03 S04 S05 S06: loans, terminal plans and one-way relationships use explicit transitions', () => {
    let p = createProjection(); const apply = (action, data, origin = { kind: 'model' }) => p = applyDomainFact(p, { track: 'facts', action, data, ruleVersion: 3, origin });
    apply('person_registered', { id: 'a', name: '甲' }); apply('person_registered', { id: 'b', name: '乙' });
    apply('relationship_established', { id: 'r', from: 'a', to: 'b', kind: 'romantic', mutual: false }); assert.equal(p.relationships[0].mutual, false);
    apply('item_registered', { id: 'k', name: '钥匙', owner: 'a', holder: 'a', quantity: 1 }); apply('item_lent', { id: 'k', from: 'a', to: 'b', loanId: 'loan' });
    assert.equal(p.items[0].owner, 'a'); assert.throws(() => apply('state_updated', { collection: 'items', id: 'k', values: { holder: 'a' } }), /归还/);
    apply('item_returned', { id: 'k', loanId: 'loan' }); apply('item_destroyed', { id: 'k' }); assert.equal(p.items[0].quantity, 0); assert.equal(p.items[0].holder, null);
    apply('item_restored', { id: 'k' }); assert.equal(p.items[0].quantity, null);
    apply('promise_created', { id: 'plan', title: '看海', participants: ['a', 'b'], dueDescription: '三天后' }); apply('plan_completed', { id: 'plan' });
    assert.throws(() => apply('state_updated', { collection: 'plans', id: 'plan', values: { status: 'accepted' } }), /重新开启/);
    apply('plan_reopened', { id: 'plan' }); assert.equal(p.plans[0].status, 'proposed'); assert.equal(p.plans[0].due, null);
});

test('S08 S09: two real consumes, callback retry, manual replacement and user correction', async () => {
    const h = await fixture(); await h.service.editEntity('items', '', { name: '药', quantity: 10 }, { create: true });
    const id = h.service.view().projection.items[0].id, events = [e('item_consumed', { id, quantity: 1 }), e('item_consumed', { id, quantity: 1 })];
    await append(h, '先喝一次，稍后又喝一次。', events); assert.equal(h.service.view().projection.items[0].quantity, 8);
    await h.flow.captureInline(); assert.equal(h.service.view().projection.items[0].quantity, 8);
    await h.service.ingest(block(events), 1, { manual: true }); assert.equal(h.service.view().projection.items[0].quantity, 8);
    await h.service.editEntity('items', id, { quantity: 12 }, { intent: 'correction' });
    await h.service.ingest(block(events), 1, { manual: true }); assert.equal(h.service.view().projection.items[0].quantity, 12);
    await append(h, '回忆昨天喝药。', [e('item_consumed', { id, quantity: 1 }, { context: 'flashback' })]); assert.equal(h.service.view().projection.items[0].quantity, 12);
    assert.equal(h.state.rpCore.candidates.at(-1).status, 'rejected');
});

test('R03 R04: earlier edit invalidates later absolute assertions while relative deltas replay safely', async () => {
    for (const absolute of [false, true]) {
        const h = await fixture(); await h.service.editEntity('items', '', { name: '药', quantity: 10 }, { create: true }); const id = h.service.view().projection.items[0].id;
        await append(h, '喝一瓶。', [e('item_consumed', { id, quantity: 1 })]);
        await append(h, '再喝一瓶。', absolute ? [e('state_updated', { collection: 'items', id, values: { quantity: 8 } })] : [e('item_consumed', { id, quantity: 1 })]);
        h.chat[1].mes = '没有喝药。'; assert.equal(h.service.view().projection.items[0].quantity, absolute ? 10 : 9);
        await h.service.ingest(block([]), 1, { manual: true }); assert.equal(h.service.view().projection.items[0].quantity, absolute ? 10 : 9);
        if (absolute) assert.ok(h.service.view().pending.some(item => /较早来源/.test(item.reason)));
    }
    const h = runtimeHost(); h.chat.push({ mes: '现在开始。' }); await h.service.enable();
    await assert.rejects(h.flow.runIndependent({ manual: true, sourceFloor: 0 }), /起点/);
});

test('I10 R08 R09 R10: scoped backup restore and clear preserve unrelated data and reject another chat', async () => {
    const h = await fixture(); h.state.storySummaries = [{ content: '不改摘要' }]; h.state.tableDatabase = { tables: [{ rows: [['不改表格']] }] };
    await h.service.editEntity('people', '', { name: '甲' }, { create: true }); const person = h.service.view().projection.people[0];
    await h.service.editTemporary(person.id, '', { description: '受伤', visibility: 'private' }, { expectedRevision: h.state.rpCore.revision });
    const pack = h.service.backup(), other = JSON.stringify([h.state.storySummaries, h.state.tableDatabase, h.chat]);
    h.state.vectorMemory = { records: [{ memoryHash: 'rp:facts:old', id: 'rp' }, { memoryHash: 'summary', id: 'summary' }] };
    await assert.rejects(h.service.restore({ ...pack, chatIdentity: 'B' }), /聊天/);
    const bad = structuredClone(pack); bad.core.facts[0].data.values.quantity = -5; await assert.rejects(h.service.restore(bad));
    const malformed = structuredClone(pack); malformed.core.facts[0].data.values.states = [{ id: 'bad', description: '受伤', active: 'yes' }];
    await assert.rejects(h.service.restore(malformed));
    const badRef = structuredClone(pack); badRef.core.facts[0].data.values.location = 'not-in-this-ledger';
    await assert.rejects(h.service.restore(badRef));
    await h.service.clear(h.state.rpCore.revision); assert.equal(h.service.view().projection.people.length, 0);
    assert.deepEqual(h.state.vectorMemory.records, [{ memoryHash: 'summary', id: 'summary' }]);
    await h.service.restore(pack); assert.equal(h.state.rpCore.settings.automatic, false); assert.equal(h.state.rpCore.settings.enabled, false);
    assert.equal(h.service.view().projection.people[0].states[0].visibility, 'private');
    assert.equal(JSON.stringify([h.state.storySummaries, h.state.tableDatabase, h.chat]), other);
    const future = structuredClone(pack.core); future.schemaVersion = 99; assert.throws(() => validateRpBackup(future));
    const stale = { expectedState: h.state, expectedRevision: h.state.rpCore.revision }; await h.service.configure({ inject: false }); await assert.rejects(h.service.restore(pack, stale), /变化/);
});

test('R01 R05 R06: RP failure does not block summary; switching chat stops old downstream processing', async () => {
    for (const switchChat of [false, true]) {
        const h = await fixture(); let summaries = 0; h.state.turnSummary = { auto: true, enabled: true }; h.state.automation.enabled = false;
        const { createMemoryOrchestrator } = await import('../src/features/memory-orchestrator.js');
        const orchestrator = createMemoryOrchestrator({ ensureState: () => h.state, rpExtractionFlow: { reconcilePending() {}, captureInline() { if (switchChat) h.switchChat(); throw Error('RP 格式失败'); } },
            getCurrentFloorMemoryIndex: () => ({}), getMemoryOrchestrationPlan: () => ({ actions: { processLatestTurn: true } }), isBusy: () => false,
            turnProcessingModes: { TABLE: 'table', BOTH: 'both' }, processLatestTurnSummary: async () => summaries++, syncInjection() {} });
        await orchestrator.runMemoryOrchestrator('完成', { scan: false }); assert.equal(summaries, switchChat ? 0 : 1);
    }
});

test('R09: cancelled request cannot append job status into restored state', async () => {
    const h = await fixture(); await h.service.configure({ mode: 'independent' }); const pack = h.service.backup(); let release, ready;
    const started = new Promise(resolve => ready = resolve);
    const flow = createRpExtractionFlow({ getState: () => h.state, getChat: () => h.chat, service: h.service,
        callGenerationModel: async () => { ready(); return new Promise(resolve => release = resolve); } });
    const run = flow.runIndependent(); await started; flow.stopIndependent(); await h.service.restore(pack); const saved = JSON.stringify(h.state.rpCore);
    release(block([])); await assert.rejects(run); assert.equal(JSON.stringify(h.state.rpCore), saved);
});

test('P06 P07: corrected and ended records change retrieval hashes without erasing narrative history', async () => {
    const h = await fixture(); await h.service.ingest(block([e('item_registered', { id: '药', name: '药', quantity: 3 })]), 0);
    const previous = rpMemorySources(h.state, h.service.view()), id = h.service.view().projection.items[0].id;
    await h.service.editEntity('items', id, { quantity: 5 }, { intent: 'correction' });
    const current = rpMemorySources(h.state, h.service.view()); assert.notEqual(current[0].hash, previous[0].hash); assert.match(current[0].text, /已被人工纠正/);
    assert.equal(h.state.rpCore.facts.length, 2);
    await h.service.configure({ inject: false }); assert.deepEqual(rpMemorySources(h.state, h.service.view()), []);
});

test('P07: returning a loan updates current ownership and typed history without editing summaries', async () => {
    const h = await fixture(); h.state.storySummaries = [{ content: '过去甲把钥匙借给乙。' }];
    await h.service.ingest(block([e('person_registered', { id: 'a', name: '甲' }), e('person_registered', { id: 'b', name: '乙' }),
        e('item_registered', { id: 'k', name: '钥匙', owner: 'a', holder: 'a' }),
        e('item_lent', { id: 'k', from: 'a', to: 'b', loanId: 'loan' })]), 0);
    const item = h.service.view().projection.items[0];
    await append(h, '乙归还钥匙。', [e('item_returned', { id: item.id, loanId: item.loan.id })]);
    const current = h.service.view().projection.items[0];
    assert.equal(current.owner, item.owner); assert.equal(current.holder, item.owner); assert.equal(current.loan, null);
    assert.ok(rpMemorySources(h.state, h.service.view()).some(source => /借用已结束/.test(source.text)));
    assert.deepEqual(h.state.storySummaries, [{ content: '过去甲把钥匙借给乙。' }]);
});

test('S10: homonymous explicit new people remain distinct and renaming preserves ID', async () => {
    const h = await fixture();
    await h.service.ingest(block([e('person_registered', { id: 'first', name: '林' }), e('person_registered', { id: 'second', name: '林' })]), 0);
    const people = h.service.view().projection.people; assert.equal(people.length, 2); assert.notEqual(people[0].id, people[1].id);
    await append(h, '第一位林改名。', [e('person_renamed', { id: people[0].id, name: '林晚' })]);
    assert.equal(h.service.view().projection.people[0].id, people[0].id);
    assert.equal(h.service.view().projection.people[1].name, '林');
});

test('S12: missing/truncated output stays failed; a late complete empty block advances progress without facts', async () => {
    const h = await fixture(); let callback;
    const flow = createRpExtractionFlow({ getState: () => h.state, getChat: () => h.chat, service: h.service,
        delay: fn => { callback = fn; return 1; }, cancelDelay() {} });
    h.chat[0].mes += '<rpEvents>{"version":2,"events":[';
    await flow.captureInline(); assert.equal(h.state.rpCore.extractionJobs[0].status, 'failed'); assert.equal(h.state.rpCore.batches.length, 0);
    h.chat[0].mes = '正文完成。<rpEvents>{broken}</rpEvents>';
    await assert.rejects(flow.captureInline()); assert.equal(h.state.rpCore.extractionJobs[0].status, 'failed');
    h.chat[0].mes = '正文完成。' + block([]);
    flow.scheduleCapture(); await callback();
    assert.equal(h.state.rpCore.extractionJobs[0].status, 'done'); assert.equal(h.state.rpCore.batches.length, 1); assert.equal(h.state.rpCore.facts.length, 0);
    assert.equal(h.service.progress().latest, 0);
});

test('S07 U03: claims and dreams do not set scene; paged history stays read-only and replay agrees', async () => {
    const h = await fixture();
    await h.service.ingest(block([{ track: 'claims', data: { speaker: '甲', description: '乙在书店' } }, e('clock_set', { date: '2024-01-01' }, { context: 'dream' })]), 0);
    assert.equal(h.service.view().projection.clock.date, null); assert.equal(h.service.view().projection.people.length, 0);
    assert.equal(h.state.rpCore.claims.length, 1); assert.match(RP_EVENT_GUIDE, /传闻/);
    for (let i = 0; i < 25; i++) await h.service.editEntity('items', '', { name: '物品' + i }, { create: true });
    assert.equal(buildStatePage(h.state.rpCore, h.service.view(), { tab: 'world', filter: 'items' }).rows.length, 20);
    const projection = replayLedger(h.state.rpCore, applyDomainFact).projection;
    assert.deepEqual(projection.items, h.service.view().projection.items);
});

test('R07 U03: migration leaves legacy same-floor replay order and historical snapshots unchanged', async () => {
    const h = runtimeHost(), core = createLedger(createProjection());
    core.ruleVersion = 2; core.settings = { enabled: true, mode: 'inline' };
    appendRecord(core, { track: 'facts', action: 'clock_set', data: { date: '2024-01-01' }, origin: { kind: 'user' } }, { floor: 0 });
    appendRecord(core, { track: 'facts', action: 'clock_set', data: { date: '2024-01-02' } }, { floor: 0 });
    h.state.rpCore = core; const before = h.service.view().projection;
    await h.service.migrate(); assert.deepEqual(h.service.view().projection, before);
    assert.equal(h.service.view(h.state, { asOfFloor: 0 }).projection.clock.date, '2024-01-02');
});

test('I10 R05: scoped cache clearing is persisted with RP and rolls back safely on save failure', async () => {
    const state = {}, chat = [{ mes: '正文' }]; let fail = false, persisted;
    const service = createRpCoreService({ getState: () => state, getChat: () => chat, saveState() {},
        saveChat: async () => { if (fail) throw Error('save failed'); persisted = structuredClone(state); } });
    await service.enable();
    state.vectorMemory = { enabled: true, records: [{ id: 'rp', memoryHash: 'rp:facts:1' }, { id: 'body' }] };
    const before = structuredClone(state); fail = true;
    await assert.rejects(service.clear(state.rpCore.revision)); assert.deepEqual(state, before);
    fail = false; await service.clear(state.rpCore.revision);
    assert.deepEqual(persisted.vectorMemory.records, [{ id: 'body' }]); assert.equal(persisted.vectorMemory.enabled, true);
});
