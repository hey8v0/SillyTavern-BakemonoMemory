import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/summary-runtime.mjs';
import { stageAutomationStatus } from '../src/summary/automation-status.js';
import { buildFloorMemoryIndex } from '../src/memory/floor-memory-index.js';

// Replies carry their own summary in a titled <details> block, next to an options block (reported by a user).
const chapter = i => `<details><summary>章节摘要</summary>甲在第 ${i} 楼找到旧信，约定明天去码头见乙。</details>`;
const reply = i => `正文 ${i}\n${chapter(i)}\n<details><summary>剧情选项</summary>A. 去码头 B. 回书店</details>`;

function chat(floors) {
    const f = fixture(floors);
    f.chat.forEach((message, i) => { message.mes = reply(i); });
    f.source.refresh();
    f.state.stageSourceMode = 'summaries';
    f.state.scanRules = { mode: 'tag', includeTags: 'details:章节摘要' };
    f.state.automation = { enabled: true, floorInterval: 10, mode: 'draft' };
    f.state.blocks = f.chat.map((_, i) => ({ hash: 'chapter-' + i, type: 'story', messageId: i, blockIndex: 0,
        content: chapter(i), matchedTag: 'details:章节摘要', scanMode: 'tag', sourceKind: 'tag' }));
    return f;
}
function status(f) {
    const materials = f.selectors.getStageMaterialOverview();
    return stageAutomationStatus(f.state, materials, { batch: f.selectors.getAutoStageTargets(materials.targets),
        records: buildFloorMemoryIndex({ messages: f.chat, state: f.state }).records });
}
const rerolled = i => `<details><summary>章节摘要</summary>甲在第 ${i} 楼改去了港口。</details>`;
const reroll = (f, i) => { f.chat[i].swipe_id = 1; f.chat[i].mes = `重 roll 后的正文\n${rerolled(i)}`; };

test('automatic stage summaries wait until the latest reply can no longer be rerolled', async () => {
    const f = chat(10);
    assert.equal(f.selectors.getUnsummarizedStoryBlocks().length, 10);
    assert.equal(f.selectors.getUnsummarizedStoryBlocks({ newOnly: true }).length, 9, 'floor 9 is the reply that can still be rerolled');
    const waiting = status(f);
    assert.equal(waiting.code, 'holding');
    assert.match(waiting.detail, /第 9 楼/);
    assert.equal(await f.controller.generateStageDraft({ automatic: true }), undefined);
    assert.equal(f.state.taskQueue.length, 0);

    // A reroll of floor 9 at this point touches nothing the plugin has started.
    reroll(f, 9); f.source.refresh();
    f.state.blocks[9] = { ...f.state.blocks[9], hash: 'chapter-9b', content: rerolled(9) };
    assert.equal(status(f).code, 'holding');

    // The next message settles floor 9; the batch is then taken and its sources check out.
    f.chat.push({ mes: '去码头。', is_user: true, swipe_id: 0 });
    assert.equal(status(f).code, 'ready');
    const task = await f.controller.generateStageDraft({ automatic: true });
    assert.deepEqual(task.sourceMessageIds, Array.from({ length: 10 }, (_, i) => i));
    f.onCall(() => {}); await f.queue.processTaskQueue();
    assert.equal(task.status, 'done'); assert.ok(!f.state.taskQueuePaused);
    assert.equal(f.state.drafts.length, 1);
});

test('a reroll during an automatic summary drops that run without pausing the queue', async () => {
    const f = chat(10);
    const blocks = f.state.blocks;
    const enqueue = trigger => f.queue.enqueueSummaryTask({ kind: 'stage', prompt: trigger, sourceHashes: blocks.map(b => b.hash),
        sourceMessageIds: blocks.map(b => b.messageId), trigger, autoStart: false, silent: true,
        metadata: { inputSnapshot: f.source.capture(blocks) } });

    const auto = enqueue('auto');
    f.onCall(() => reroll(f, 9));
    await f.queue.processTaskQueue();
    assert.equal(auto.status, 'failed');
    assert.match(auto.error, /重 roll/);
    assert.ok(!f.state.taskQueuePaused, 'later automatic summaries still run');
    assert.equal(f.state.drafts.length, 0, 'no draft is kept from material that no longer exists');

    // A summary the user started still stops the queue and keeps the paid result, as before.
    f.chat[9].swipe_id = 0; f.chat[9].mes = reply(9); f.source.refresh();
    const manual = enqueue('manual');
    await f.queue.processTaskQueue();
    assert.equal(manual.status, 'failed');
    assert.equal(f.state.taskQueuePaused, true);
    assert.equal(f.state.drafts.length, 1);
    assert.ok(f.state.drafts[0].metadata.inputError);
});
