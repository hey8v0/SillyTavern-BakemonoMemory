import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/summary-runtime.mjs';
import { getHash } from '../src/shared/text.js';

// SillyTavern writes swipe_id 0 into a reply that had none (greetings without alternates, /sendas, imported
// floors) when the floor is shown. A 900-floor chat reopened the next day lost every summary made over floor 0 and
// the automatic run started again from the first floor.
const withoutSwipe = (x, ids) => { for (const id of ids) delete x.chat[id].swipe_id; x.state.chronicle.sources = []; x.records(); };
const showFloor = (x, id) => { x.chat[id].swipe_id = 0; x.chat[id].swipes = [x.chat[id].mes]; };

test('a floor that only gains swipe_id 0 keeps its summaries valid, also after reload', async () => {
    const x = fixture();
    withoutSwipe(x, [0, 10]);
    const stage = await x.stage('S', [0, 10]);
    const epic = await x.generateEpic('E');
    showFloor(x, 0); showFloor(x, 10);
    const rows = x.records();
    assert.equal(rows.find(r => r.hash === epic.hash).status, 'injected');
    assert.equal(rows.find(r => r.hash === stage.hash).status, 'archived', 'covered by the epic, not stale');
    x.reload();
    assert.equal(x.parts().stats.epic, 1);
});

test('a real swipe to another reply still marks the summary stale', async () => {
    const x = fixture();
    withoutSwipe(x, [0]);
    await x.stage('S', [0]);
    x.chat[0].swipe_id = 1; x.chat[0].swipes = ['other', x.chat[0].mes];
    assert.equal(x.parts().stats.stage, 0);
});

test('legacy links recorded without swipe_id accept the filled-in 0', async () => {
    const x = fixture();
    withoutSwipe(x, [5]);
    const content = 'legacy stage';
    x.state.stageSummaries.push({ hash: getHash(content), content, title: 'L', kind: 'stage', sourceMessageIds: [5], messageId: 5 });
    x.records();
    assert.equal(x.parts().stats.stage, 1);
    showFloor(x, 5);
    assert.equal(x.parts().stats.stage, 1);
});

test('automatic runs never go back to floors a saved summary took, even when it went stale', async () => {
    const x = fixture();
    x.state.stageSourceMode = 'raw';
    x.state.blocks = [10, 20].map(id => ({ hash: 'input-' + id, content: x.chat[id].mes, messageId: id, sourceKind: 'raw', matchedTag: '全文', type: 'story' }));
    await x.stage('S', [10]);
    x.chat[10].mes += ' edited';
    assert.equal(x.parts().stats.stage, 0, 'the stale stage is no longer injected');
    assert.deepEqual(x.selectors.getUnsummarizedStoryBlocks().map(b => b.messageId), [10, 20], 'a manual run can rebuild it');
    assert.deepEqual(x.selectors.getUnsummarizedStoryBlocks({ newOnly: true }).map(b => b.messageId), [20]);
    assert.deepEqual(x.selectors.getStageMaterialOverview({ newOnly: true }).targets.map(b => b.messageId), [20]);
});
