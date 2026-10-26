import test from 'node:test';
import assert from 'node:assert/strict';
import { factsRuntime, reply, lin } from './helpers/facts-runtime.mjs';
import { createMemoryOrchestrator } from '../src/features/memory-orchestrator.js';

const minutes = n => n * 60 * 1000;

// 1. Source changes: automatic 整理 is dropped quietly, like automatic summaries; manual 整理 pauses like manual summaries.
test('an automatic 整理 whose material changed while it ran is dropped without pausing the queue, and the material is picked again', async () => {
    const r = factsRuntime({ every: 3, summaries: 3 });
    const task = r.controller.maybeRun();
    r.editSummary(4, '林晚其实去了书店。');
    r.setResult(reply([lin('在码头')]));
    await r.queue.processTaskQueue();
    assert.equal(task.status, 'failed');
    assert.match(task.error, /有变化/);
    assert.ok(!r.state.taskQueuePaused, 'a reroll or edit must not stall every later automatic task');
    assert.equal(r.state.facts.cards.length, 0, 'the stale result is not written');
    assert.deepEqual(r.pendingFloors(), [2, 4, 6]);
    const next = r.controller.maybeRun();
    assert.ok(next && next.id !== task.id, 'the new material is picked');
    assert.ok(next.sourceHashes.includes('b4-v2'));
    r.setResult(reply([lin('在书店')]));
    await r.queue.processTaskQueue();
    assert.equal(next.status, 'done');
    assert.equal(r.state.facts.cards[0].fields.处境, '在书店');
});

test('an idle 整理 is automatic too; a manual one pauses the queue when its material changed, like a manual summary', async () => {
    const r = factsRuntime({ every: 6, summaries: 2, idleMinutes: 10 });
    r.controller.noteActivity();
    r.timers.at(-1).fn();
    const idle = r.factsTasks()[0];
    assert.equal(idle.trigger, 'facts_idle');
    r.removeSummary(2);
    r.setResult(reply([lin()]));
    await r.queue.processTaskQueue();
    assert.equal(idle.status, 'failed');
    assert.ok(!r.state.taskQueuePaused);
    const m = factsRuntime({ every: 6, summaries: 2 });
    const manual = await m.controller.runManual();
    m.editSummary(2, '改过了。');
    m.setResult(reply([lin()]));
    await m.queue.processTaskQueue();
    assert.equal(manual.status, 'failed');
    assert.equal(m.state.taskQueuePaused, true, 'manual work waits for the user, as manual summaries do');
});

// 2. Identity, not just the floor cursor.
test('a summary written later for an older floor, or an integrated summary that was edited, is pending again; a stale one is not', async () => {
    const r = factsRuntime({ every: 3, summaries: 0, floors: 16 });
    [4, 6, 8].forEach(floor => r.addSummary(floor));
    r.controller.maybeRun();
    r.setResult(reply([lin('在码头')]));
    await r.queue.processTaskQueue();
    assert.equal(r.state.facts.lastIntegratedFloor, 8);
    assert.deepEqual(r.pendingFloors(), []);
    r.addSummary(2, '林晚在家里发现一封旧信。');
    assert.deepEqual(r.pendingFloors(), [2], 'a backfilled summary below the cursor still gets its turn');
    r.editSummary(6, '林晚在码头遇到沈砚。');
    assert.deepEqual(r.pendingFloors(), [2, 6], 'an edited summary keeps its id but its text changed');
    r.invalid.add('s2');
    assert.deepEqual(r.pendingFloors(), [6], 'a summary whose source floor went stale is left for the user to rebuild');
    r.invalid.clear();
    const task = await r.controller.runManual();
    assert.equal(task.metadata.factsCount, 2);
    assert.match(task.prompt, /第 2 楼（补写）：林晚在家里发现一封旧信。/);
    assert.match(task.prompt, /第 6 楼（改过）：林晚在码头遇到沈砚。/);
    assert.match(task.prompt, /早于已整理到的第 8 楼/, 'the model is told these are older than the current state of the cards');
    r.setResult(reply([{ kind: 'item', name: '旧信', fields: { 持有者: '林晚' } }]));
    await r.queue.processTaskQueue();
    assert.equal(r.state.facts.lastIntegratedFloor, 8, 'older material does not move the cursor');
    assert.deepEqual(r.pendingFloors(), []);
    assert.equal(r.state.facts.integrated.s6, r.state.storySummaries.find(item => item.hash === 's6').contentHash);
    // A removed summary is forgotten once the next batch lands; its floor is not pending.
    r.removeSummary(4);
    assert.deepEqual(r.pendingFloors(), []);
    [10, 12, 14].forEach(floor => r.addSummary(floor));
    r.chat.push({ mes: '继续。', is_user: true });
    r.controller.maybeRun();
    r.setResult(reply([]));
    await r.queue.processTaskQueue();
    assert.equal('b4' in r.state.facts.integrated, false);
});

test('a batch is never sent twice for the same material: the 整理 is recorded per summary and the next run goes forward', async () => {
    const r = factsRuntime({ every: 3, summaries: 3, floors: 16 });
    const first = r.controller.maybeRun();
    r.setResult(reply([lin()]));
    await r.queue.processTaskQueue();
    assert.equal(first.status, 'done');
    r.state.facts.lastIntegratedFloor = -1; // a cursor that went wrong (an older version, a branch) must not redo the work
    assert.deepEqual(r.pendingFloors(), []);
    [8, 10, 12].forEach(floor => r.addSummary(floor));
    r.chat.push({ mes: '继续。', is_user: true });
    assert.deepEqual(r.pendingFloors(), [8, 10, 12]);
});

test('chats from v1.34.0 and v1.33.0 are migrated once: everything up to the cursor counts as integrated at its current text', () => {
    const r = factsRuntime({ summaries: 5, floors: 14 });
    delete r.state.facts.integrated;
    r.state.facts.lastIntegratedFloor = 6;
    assert.deepEqual(r.pendingFloors(), [8, 10]);
    assert.deepEqual(Object.keys(r.controller.facts().integrated).sort(), ['b4', 's2', 's6']);
    const q = factsRuntime({ summaries: 3 });
    delete q.state.facts.integrated;
    q.state.facts.doneStages = ['st1'];
    q.state.stageSummaries = [{ hash: 'st1', sourceMessageIds: [1, 2, 3, 4] }];
    assert.deepEqual(q.pendingFloors(), [6]);
    assert.deepEqual(Object.keys(q.controller.facts().integrated).sort(), ['b4', 's2']);
    // Not before the chat is loaded: an empty chat would seed nothing and then integrate everything again.
    const n = factsRuntime({ summaries: 3 });
    delete n.state.facts.integrated;
    n.state.facts.lastIntegratedFloor = 4;
    n.setReady(false);
    assert.deepEqual(n.pendingFloors(), []);
    assert.equal(n.controller.facts().integrated ?? null, null);
    n.setReady(true);
    assert.deepEqual(n.pendingFloors(), [6]);
    assert.deepEqual(Object.keys(n.controller.facts().integrated).sort(), ['b4', 's2']);
});

// 3. Backlog boundaries.
test('23 pending summaries after idle: one batch of 20 then one of 3, both idle, no extra task', async () => {
    const r = factsRuntime({ every: 6, summaries: 23, floors: 50, idleMinutes: 10 });
    r.controller.noteActivity();
    r.timers.at(-1).fn();
    const first = r.factsTasks()[0];
    assert.equal(first.metadata.factsCount, 20);
    assert.equal(first.metadata.factsRemaining, 3);
    assert.match(first.label, /还剩 3 条/);
    r.setResult(reply([lin()]));
    await r.queue.processTaskQueue();
    const second = r.factsTasks().find(task => task.id !== first.id);
    assert.equal(second.trigger, 'facts_idle');
    assert.equal(second.metadata.factsCount, 3);
    await r.queue.processTaskQueue();
    assert.deepEqual(r.pendingFloors(), []);
    assert.equal(r.factsTasks().length, 2);
    assert.ok(r.factsTasks().every(task => task.status === 'done'));
});

test('50 pending summaries by hand: 20 + 20 + 10 through the queue, the toast says how many now and how many follow, pausing the queue stops the chain', async () => {
    const r = factsRuntime({ every: 6, summaries: 50, floors: 104 });
    const first = await r.controller.runManual();
    assert.equal(first.metadata.factsCount, 20);
    assert.match(r.toasts.at(-1)[1], /本次 20 条.*还剩 30 条/);
    // The user pauses the queue while the first request is out: the next batch is queued but not sent.
    r.setResult(() => { r.state.taskQueuePaused = true; return reply([lin()]); });
    await r.queue.processTaskQueue();
    assert.equal(r.factsTasks().length, 2);
    assert.equal(r.factsTasks()[1].trigger, 'facts_manual');
    assert.equal(r.factsTasks()[1].metadata.factsCount, 20);
    assert.equal(r.factsTasks()[1].metadata.factsRemaining, 10);
    assert.equal(r.factsTasks()[1].status, 'queued', 'a paused queue holds the next batch');
    r.setResult(reply([lin()]));
    r.state.taskQueuePaused = false;
    await r.queue.processTaskQueue();
    assert.equal(r.factsTasks().length, 3, 'the rest follows through the queue, one task per batch');
    assert.equal(r.factsTasks()[2].metadata.factsCount, 10);
    assert.deepEqual(r.pendingFloors(), []);
    assert.equal(r.state.facts.lastIntegratedFloor, 100);
});

test('a batch that failed twice on the same material is not sent again on its own; new material or a manual run sends it', async () => {
    const r = factsRuntime({ every: 2, summaries: 2, floors: 16 });
    const first = r.controller.maybeRun();
    r.setResult('抱歉。');
    await r.queue.processTaskQueue();
    assert.equal(first.status, 'failed');
    const second = r.controller.maybeRun();
    assert.ok(second, 'one retry on the next trigger');
    await r.queue.processTaskQueue();
    assert.equal(second.status, 'failed');
    assert.equal(r.controller.maybeRun(), null, 'twice is enough: no request per message for ever');
    assert.ok(r.controller.blockedBatch(), 'the page can say why nothing happens');
    r.addSummary(8);
    r.chat.push({ mes: '继续。', is_user: true });
    assert.equal(r.controller.maybeRun(), null, 'the batch of two is still the same two');
    const manual = await r.controller.runManual();
    assert.equal(manual.metadata.factsCount, 3);
    r.setResult(reply([lin()]));
    await r.queue.processTaskQueue();
    assert.equal(manual.status, 'done');
    assert.deepEqual(r.pendingFloors(), []);
    assert.equal(r.controller.blockedBatch(), null);
});

test('summaries that arrive while a batch runs are not in it and are picked next; with 先审再用 a held batch is not redone and no chain starts', async () => {
    const r = factsRuntime({ every: 3, summaries: 3, floors: 20 });
    const task = r.controller.maybeRun();
    [8, 10, 12].forEach(floor => r.addSummary(floor));
    r.chat.push({ mes: '继续。', is_user: true });
    assert.deepEqual(r.pendingFloors(), [8, 10, 12]);
    r.setResult(reply([lin()]));
    await r.queue.processTaskQueue();
    assert.equal(task.metadata.factsCount, 3);
    const next = r.factsTasks()[1];
    assert.deepEqual([next.metadata.factsFloorFrom, next.metadata.factsFloorTo], [8, 12]);
    const v = factsRuntime({ review: true, every: 6, summaries: 25, floors: 60 });
    await v.controller.runManual();
    assert.match(v.toasts.at(-1)[1], /本次 20 条.*还剩 5 条/);
    v.setResult(reply([lin()]));
    await v.queue.processTaskQueue();
    assert.equal(v.state.drafts.length, 1);
    assert.equal(v.factsTasks().length, 1, 'held for review: the next batch waits for the user');
    assert.equal(v.pendingFloors().length, 5);
    assert.equal(v.state.drafts[0].metadata.factsSources.length, 20);
    await v.controller.applyDraft(v.state.drafts[0].id);
    assert.equal(Object.keys(v.state.facts.integrated).length, 20);
    assert.equal(v.state.facts.lastIntegratedFloor, 40);
});

// 4. Progress and undo stay in step.
test('a result that changes nothing still leaves a light record: the summaries count as checked, and undo reopens them', async () => {
    const r = factsRuntime({ every: 3, summaries: 3 });
    r.controller.maybeRun();
    r.setResult(reply([]));
    await r.queue.processTaskQueue();
    assert.equal(r.state.facts.history.length, 1);
    const entry = r.state.facts.history[0];
    assert.equal(entry.changes.length, 0);
    assert.equal(entry.sources.length, 3);
    assert.deepEqual([entry.floorBefore, entry.floorTo], [-1, 6]);
    assert.equal(r.state.facts.lastIntegratedFloor, 6);
    assert.deepEqual(r.pendingFloors(), []);
    assert.ok(r.scopes.some(text => /没有变化/.test(text)));
    const undone = await r.controller.undoLast();
    assert.equal(undone.id, entry.id);
    assert.deepEqual(r.state.facts.integrated, {});
    assert.equal(r.state.facts.lastIntegratedFloor, -1);
    assert.deepEqual(r.pendingFloors(), [2, 4, 6]);
});

test('undoing a batch keeps what the user edited after it, and only touches the fields that batch changed', async () => {
    const r = factsRuntime({ every: 1, summaries: 1, floors: 16 });
    r.controller.maybeRun();
    r.setResult(reply([lin('在书店')]));
    await r.queue.processTaskQueue();
    const card = r.state.facts.cards[0];
    r.controller.saveCard(card.id, { fields: { 处境: '在家' } });
    r.addSummary(4);
    r.controller.maybeRun();
    r.setResult(reply([{ kind: 'person', name: '林晚', fields: { 目标: '回家', 外貌: '短发' } }]));
    await r.queue.processTaskQueue();
    assert.deepEqual([card.fields.处境, card.fields.目标, card.fields.外貌], ['在家', '回家', '短发']);
    r.controller.saveCard(card.id, { fields: { 外貌: '长发' } });
    const undone = await r.controller.undoLast();
    assert.equal(undone.floorTo, 4);
    assert.deepEqual([card.fields.处境, card.fields.目标, card.fields.外貌], ['在家', '找到旧信的主人', '长发'], 'user edits survive the undo');
    assert.equal(card.updatedBy, 'user');
    assert.equal(r.state.facts.lastIntegratedFloor, 2);
    assert.deepEqual(r.pendingFloors(), [4]);
});

test('discarding a held result reopens its summaries; applying it records them; both leave the cursor and the record in step', async () => {
    const r = factsRuntime({ review: true, every: 3, summaries: 3 });
    r.controller.maybeRun();
    r.setResult(reply([lin()]));
    await r.queue.processTaskQueue();
    assert.deepEqual(r.pendingFloors(), []);
    assert.equal(r.controller.discardDraft(r.state.drafts[0].id), true);
    assert.deepEqual(r.pendingFloors(), [2, 4, 6]);
    assert.deepEqual(r.state.facts.integrated, {});
    r.controller.maybeRun();
    await r.queue.processTaskQueue();
    const entry = await r.controller.applyDraft(r.state.drafts[0].id);
    assert.equal(entry.sources.length, 3);
    assert.equal(r.state.facts.lastIntegratedFloor, 6);
    assert.equal(Object.keys(r.state.facts.integrated).length, 3);
    await r.controller.undoLast();
    assert.deepEqual(r.pendingFloors(), [2, 4, 6]);
});

// 5. Idle without trusting the browser timer.
test('coming back after the idle time has passed consolidates at once; a shorter gap arms the remainder; coming back is not activity', () => {
    const r = factsRuntime({ every: 6, summaries: 2, idleMinutes: 10 });
    r.controller.noteActivity();
    r.clock.now += minutes(11);
    const task = r.controller.resume();
    assert.equal(task?.trigger, 'facts_idle', 'the frozen timer never fired; the pending summaries are consolidated now');
    const s = factsRuntime({ every: 6, summaries: 2, idleMinutes: 10 });
    s.controller.noteActivity();
    s.clock.now += minutes(4);
    assert.equal(s.controller.resume(), null);
    assert.equal(s.timers.at(-1).ms, minutes(6));
    s.clock.now += minutes(7);
    assert.equal(s.controller.resume()?.trigger, 'facts_idle', 'eleven minutes since the last message, two resumes in between');
    const u = factsRuntime({ every: 6, summaries: 2, idleMinutes: 10 });
    assert.equal(u.controller.resume(), null, 'no record of the last message: wait the full time');
    assert.equal(u.timers.at(-1).ms, minutes(10));
    const n = factsRuntime({ every: 6, summaries: 2, idleMinutes: 10 });
    n.controller.noteActivity();
    n.clock.now += minutes(30);
    n.setReady(false);
    assert.equal(n.controller.resume(), null, 'a chat still loading is left alone');
    assert.equal(n.factsTasks().length, 0);
});

test('the orchestrator counts messages as activity but a return to the foreground as a resume', async () => {
    const calls = [], state = { automation: {}, turnSummary: {} };
    const orchestrator = createMemoryOrchestrator({
        ensureState: () => state, isBusy: () => false, scanBakemonoBlocks: () => {}, getUnsummarizedStoryBlocks: () => [],
        getCurrentFloorMemoryIndex: () => 0, getMemoryOrchestrationPlan: () => ({ actions: {} }), syncInjection: () => {}, scheduleRenderAll: () => {},
        noteFactsActivity: () => calls.push('activity'), resumeFacts: () => calls.push('resume'), consolidateFacts: () => calls.push('consolidate'),
    });
    await orchestrator.runMemoryOrchestrator('收到新回复');
    await orchestrator.runMemoryOrchestrator('恢复前台', { activity: false });
    assert.deepEqual(calls, ['activity', 'consolidate', 'resume', 'consolidate']);
});
