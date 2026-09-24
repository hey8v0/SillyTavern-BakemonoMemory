import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/summary-runtime.mjs';
import { createSummaryBackfillController } from '../src/features/summary-backfill-controller.js';
import { createArchiveController } from '../src/features/archive-controller.js';
import { stageAutomationStatus } from '../src/summary/automation-status.js';
import { findTargetContinuityGaps } from '../src/summary/target-selection.js';
import { summarySourceFloors, getSummaryStatus } from '../src/memory/summary-provenance.js';
import { buildFloorMemoryIndex } from '../src/memory/floor-memory-index.js';
import * as text from '../src/shared/text.js';
import * as meta from '../src/summary/source-metadata.js';
import { unique } from '../src/shared/collections.js';
import { stripPostProcessNoise } from '../src/shared/prompt-utils.js';

const noop = () => {};
function backfill(f) {
    return createSummaryBackfillController({ getState: () => f.state, getContext: () => ({ chat: f.chat }),
        summarySources: f.source, ...text, ...meta, unique, stripPostProcessNoise,
        getMessageVariantKey: message => String(message.swipe_id ?? ''), blockTypes: { STORY: 'story' },
        defaultAutomation: { backfillBatchSize: 10 }, getIsBusy: () => false,
        renderWorkbenchScope: noop, workbenchRenderScopes: {}, toastr: { info: noop },
        confirmDanger: () => { throw Error('No redundant confirmation expected'); } });
}
async function saveStory(f, ids) {
    const blocks = ids.map(id => ({ hash: 'raw-' + id, messageId: id, sourceKind: 'raw', content: f.chat[id].mes }));
    const draft = f.service.createDraft({ kind: 'story', content: '甲离开书店并带走钥匙。' + ids.join(','),
        sourceHashes: blocks.map(block => block.hash), sourceMessageIds: ids,
        metadata: { inputSnapshot: f.source.capture(blocks) } });
    return f.service.commitDraft(draft.id);
}
function status(f) {
    const materials = f.selectors.getStageMaterialOverview();
    return stageAutomationStatus(f.state, materials, { batch: f.selectors.getAutoStageTargets(materials.targets),
        records: buildFloorMemoryIndex({ messages: f.chat, state: f.state }).records });
}

test('old changed and deleted summaries do not block a valid current batch or become missing backfill targets', async () => {
    const f = fixture(116);
    for (const id of [28, 92, ...Array.from({ length: 16 }, (_, i) => 100 + i)]) await saveStory(f, [id]);
    f.chat[28].mes += ' changed'; f.chat.splice(92, 1);
    f.state.stageSourceMode = 'backfill';
    f.state.automation = { enabled: true, floorInterval: 10, mode: 'draft' };
    const materials = f.selectors.getStageMaterialOverview();
    assert.equal(materials.targets.length, 16); assert.equal(materials.issues.length, 2);
    assert.equal(materials.coveredCount, 0);
    assert.equal(status(f).code, 'ready');
    assert.match(status(f).detail, /2 条异常/);
    const task = await f.controller.generateStageDraft({ automatic: true });
    assert.deepEqual(task.sourceMessageIds, Array.from({ length: 10 }, (_, i) => 99 + i));
    await f.controller.generateStageDraft({ automatic: true });
    assert.equal(f.state.taskQueue.length, 1); assert.equal(f.calls(), 0);
    const targets = backfill(f).buildMissingSummaryTargets();
    assert.equal(targets.filter(item => item.messageId >= 99).length, 0);
    assert.ok(targets.some(item => item.messageId === 28));
    assert.ok(targets.some(item => item.messageId === 92), 'new occupant of deleted floor is not covered by an old summary');
    assert.equal(f.state.storySummaries.length, 18); assert.deepEqual(f.state.hiddenMessageIds || [], []);
    const stageDraft = f.service.createDraft({ kind: 'stage', content: '甲从书店出发，到港口取回钥匙。',
        sourceHashes: task.sourceHashes, sourceMessageIds: task.sourceMessageIds, metadata: task.metadata });
    await f.service.commitDraft(stageDraft.id);
    const afterSave = f.selectors.getStageMaterialOverview();
    assert.equal(afterSave.coveredCount, 10); assert.equal(afterSave.targets.length, 6);
    assert.equal(afterSave.issues.length, 2); assert.equal(status(f).code, 'waiting');
});

test('invalid material inside the selected batch still blocks and points to that exact record', async () => {
    const f = fixture(14);
    for (let id = 0; id < 14; id++) await saveStory(f, [id]);
    f.chat[4].mes += ' changed';
    f.state.stageSourceMode = 'backfill'; f.state.automation = { enabled: true, floorInterval: 10, mode: 'draft' };
    const issue = f.selectors.getStageMaterialOverview().issues[0];
    assert.equal(status(f).code, 'invalid'); assert.equal(status(f).action.summaryKey, issue.key);
    await f.controller.generateStageDraft({ automatic: true });
    assert.equal(f.state.taskQueue.length, 0); assert.equal(f.calls(), 0);
});

test('batch-local gap checks ignore earlier missing floors but preserve interior gaps and manual leading checks', () => {
    const records = [0, 1, 2, 3, 4].map(id => ({ id, summaryState: 'missing' }));
    const batch = [{ messageId: 2 }, { messageId: 4 }];
    assert.deepEqual(findTargetContinuityGaps(batch, records, { includeLeading: false }).map(item => item.id), [3]);
    assert.deepEqual(findTargetContinuityGaps(batch, records).map(item => item.id), [0, 1, 3]);
});

test('a valid replacement can summarize its floor without the retained stale record blocking it', async () => {
    const f = fixture(10);
    for (let id = 0; id < 10; id++) await saveStory(f, [id]);
    f.chat[4].mes += ' changed'; f.source.refresh();
    const draft = f.service.createDraft({ kind: 'story', content: '甲改为乘船离开港口。', sourceMessageIds: [4],
        sourceHashes: ['new-4'], metadata: { inputSnapshot: f.source.capture([
            { hash: 'new-4', messageId: 4, sourceKind: 'raw', content: f.chat[4].mes },
        ]) } });
    await f.service.commitDraft(draft.id);
    f.state.stageSourceMode = 'backfill'; f.state.automation = { enabled: true, floorInterval: 10, mode: 'draft' };
    assert.equal(f.selectors.getStageMaterialOverview().issues.length, 1);
    assert.equal(f.state.storySummaries.length, 11);
    assert.equal(status(f).code, 'ready');
    const task = await f.controller.generateStageDraft({ automatic: true });
    assert.equal(task.sourceMessageIds.length, 10); assert.equal(f.calls(), 0);
});

test('saved story and stage memory suppress backfill without body tags; invalidated memory releases only its floors', async () => {
    const f = fixture(8), controller = backfill(f);
    await saveStory(f, [1, 3]); await f.stage('甲抵达港口。', [4, 5]);
    assert.deepEqual(controller.buildMissingSummaryTargets().map(item => item.messageId), [0, 2, 6, 7]);
    f.chat[4].mes += ' changed';
    assert.deepEqual(controller.buildMissingSummaryTargets().map(item => item.messageId), [0, 2, 4, 5, 6, 7]);
    f.state.storySummaries[0].content = '<summary>剧情摘要</summary>';
    assert.deepEqual(controller.buildMissingSummaryTargets().map(item => item.messageId), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('nested summary provenance follows floor shifts, not stale metadata or claimed inclusive ranges', async () => {
    const f = fixture(8);
    await saveStory(f, [2, 4]); f.state.stageSourceMode = 'backfill';
    const story = f.selectors.getUnsummarizedStoryBlocks()[0];
    const snapshot = f.source.capture([story]);
    const stageDraft = f.service.createDraft({ kind: 'stage', content: '甲去书店再到港口。', sourceHashes: [story.hash],
        sourceMessageIds: [2, 4], metadata: { inputSnapshot: snapshot } });
    const stage = await f.service.commitDraft(stageDraft.id);
    f.chat.splice(0, 1); f.source.refresh();
    assert.equal(getSummaryStatus(f.state, stage).valid, true);
    assert.deepEqual(summarySourceFloors(f.state, stage), [1, 3]);
    assert.deepEqual(backfill(f).buildMissingSummaryTargets().map(item => item.messageId), [0, 2, 4, 5, 6]);
    const records = buildFloorMemoryIndex({ messages: f.chat, state: f.state }).records;
    assert.deepEqual(records.filter(record => record.summaryState === 'covered').map(record => record.id), [1, 3]);
    const hidden = [];
    f.state.hiddenMessageIds = [];
    const archive = createArchiveController({ getChat: () => f.chat, ensureState: () => f.state,
        scanBakemonoBlocks: () => f.source.refresh(), blockTypes: { STORY: 'story' }, ...meta, unique,
        hideChatMessageRange: async (start, end) => { assert.equal(start, end); hidden.push(start); },
        saveChatConditional: async () => {}, saveState: noop });
    await archive.hideCoveredMessages({ confirm: false, silent: true });
    assert.deepEqual(hidden, [1, 3], 'hide only current source floors, never old positions or interior gaps');
    assert.deepEqual(f.state.hiddenMessageIds, [1, 3]);
});

test('valid tag bodies count as summaries; empty headings and RP protocol do not', () => {
    const f = fixture(5), controller = backfill(f);
    f.chat[0].mes += '<bakemono>甲从书店带走钥匙。</bakemono>';
    f.chat[1].mes += '<bakemono><summary>剧情摘要</summary></bakemono>';
    f.chat[2].mes += '<bakemono> </bakemono>';
    f.chat[3].mes += '<bakemono><details><summary>摘要</summary>甲走出大门。</details></bakemono>';
    f.state.scanRules.includeTags = 'rpEvents'; f.state.vectorMemory.summaryTags = 'rpEvents';
    f.chat[4].mes += '<rpEvents>{"events":[]}</rpEvents>';
    assert.deepEqual(controller.buildMissingSummaryTargets().map(item => item.messageId), [1, 2, 4]);
});

test('queued work and drafts prevent duplicate calls, while failed/done tasks and stale inputs do not mask missing memory', () => {
    const f = fixture(4), controller = backfill(f);
    const targets = controller.buildMissingSummaryTargets();
    const task = { kind: 'story', sourceHashes: [targets[0].hash], status: 'queued' };
    f.state.taskQueue.push(task);
    assert.deepEqual(controller.buildMissingSummaryTargets().map(item => item.messageId), [1, 2, 3]);
    for (const status of ['failed', 'partial', 'done', 'cancelled']) {
        task.status = status; assert.equal(controller.buildMissingSummaryTargets().length, 4);
    }
    f.state.drafts.push({ kind: 'story', content: '甲走进书店。', sourceHashes: [targets[1].hash] });
    const snapshot = f.source.capture([{ hash: 'input-2', messageId: 2, sourceKind: 'raw', content: f.chat[2].mes }]);
    f.state.drafts.push({ kind: 'story', content: '甲找到钥匙。', metadata: { inputSnapshot: snapshot } });
    assert.deepEqual(controller.buildMissingSummaryTargets().map(item => item.messageId), [0, 3]);
    f.chat[1].mes += 'changed'; f.chat[2].mes += 'changed';
    assert.equal(controller.buildMissingSummaryTargets().length, 4);
});

test('all remembered floors avoid a redundant batch confirmation or model call, and range/role filters still apply', async () => {
    const f = fixture(3), controller = backfill(f);
    await saveStory(f, [0, 1, 2]);
    await controller.generateMissingSummaryQueue(); assert.equal(f.calls(), 0);
    f.state.storySummaries = []; f.chat[0].is_user = true; f.chat[1].is_system = true;
    f.state.scanRules.includeHidden = false;
    assert.deepEqual(controller.buildMissingSummaryTargets().map(item => item.messageId), [2]);
    assert.equal(controller.buildMissingSummaryTargets({ rangeIds: new Set([0, 1]) }).length, 0);
});
