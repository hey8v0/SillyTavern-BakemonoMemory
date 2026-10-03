import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/summary-runtime.mjs';
import { getHash } from '../src/shared/text.js';
import { getSummaryStatus } from '../src/memory/summary-provenance.js';
import { readFile } from 'node:fs/promises';

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

test('a real swipe to another reply marks the summary and keeps it in use', async () => {
    const x = fixture();
    withoutSwipe(x, [0]);
    await x.stage('S', [0]);
    x.chat[0].swipe_id = 1; x.chat[0].swipes = ['other', x.chat[0].mes];
    assert.equal(x.parts().stats.stage, 1);
    assert.equal(x.records()[0].validity, 'drift');
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

test('a stage whose floor was edited keeps that floor; only new floors are material', async () => {
    const x = fixture();
    x.state.stageSourceMode = 'raw';
    x.state.blocks = [10, 20].map(id => ({ hash: 'input-' + id, content: x.chat[id].mes, messageId: id, sourceKind: 'raw', matchedTag: '全文', type: 'story' }));
    await x.stage('S', [10]);
    x.chat[10].mes += ' edited';
    assert.equal(x.parts().stats.stage, 1, 'the marked stage is still injected');
    assert.deepEqual(x.selectors.getUnsummarizedStoryBlocks().map(b => b.messageId), [20]);
    assert.deepEqual(x.selectors.getUnsummarizedStoryBlocks({ newOnly: true }).map(b => b.messageId), [20]);
    assert.deepEqual(x.selectors.getStageMaterialOverview({ newOnly: true }).targets.map(b => b.messageId), [20]);
});

// A tester's chapters all showed “需重建：第 2 楼已删除或来源缺失” the morning after: the source records were lost
// (a branch chat saved from another device) while the floors were untouched.
test('lost source records with unchanged floors leave summaries fully valid', async () => {
    const x = fixture();
    await x.stage('S', [2, 3]);
    const epic = await x.generateEpic('E');
    x.state.chronicle.sources = x.state.chronicle.sources.map(source => ({ ...source, id: 'other-' + source.id }));
    const rows = x.records();
    assert.equal(rows.find(r => r.hash === epic.hash).status, 'injected');
    assert.ok(rows.every(r => r.validity === 'valid'), JSON.stringify(rows.map(r => r.validity)));
});

test('regenerating a marked summary over the same floors retires the old one', async () => {
    const x = fixture();
    const old = await x.stage('old', [10, 11]);
    x.chat[10].mes += ' edited';
    assert.equal(x.records().find(r => r.hash === old.hash).validity, 'drift');
    const fresh = await x.stage('new', [10, 11]);
    const rows = x.records();
    assert.equal(rows.find(r => r.hash === fresh.hash).status, 'injected');
    assert.equal(rows.find(r => r.hash === old.hash).status, 'stale');
    assert.match(getSummaryStatus(x.state, old).reason, /新生成的版本/);
    assert.equal(x.parts().stats.stage, 1);
});

test('the tree shows a change as a grey note and the filter is named for it', async () => {
    const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
    const tree = await read('src/features/summary-timeline-ui.js');
    assert.match(tree, /原文有改动：/);
    assert.match(await read('settings.html'), /data-bakemono-tree-filter="stale" aria-pressed="false">原文改过</);
    assert.match(await read('style.css'), /\.bk-tree-why\.is-note \{ color: var\(--ns-faint\); \}/);
});
