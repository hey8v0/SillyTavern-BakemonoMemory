import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFloorReel } from '../src/features/overview-workbench-ui.js';

const index = states => {
    const records = Object.entries(states).map(([id, summaryState]) => ({ id: Number(id), summaryState }));
    return { records, byId: new Map(records.map(record => [record.id, record])) };
};

test('whole-story bar merges floors into runs and keeps its size at any length', () => {
    const states = {};
    for (let id = 1; id < 20000; id += 2) states[id] = id < 15000 ? 'covered' : id < 19000 ? 'saved' : 'missing';
    const reel = buildFloorReel(index(states), 20000);
    assert.deepEqual(reel.runs.map(run => run.band), ['covered', 'saved', 'open']);
    assert.equal(reel.lastFloor, 19999);
    assert.ok(reel.ticks.length <= 201, 'gap ticks closer than half a percent share one mark');
    assert.equal(reel.recent.length, 24);
});

test('latest floors are listed one by one; user messages are plain frames', () => {
    const reel = buildFloorReel(index({ 1: 'covered', 3: 'saved', 5: 'missing', 7: 'draft' }), 8);
    assert.deepEqual(reel.recent.map(frame => frame.state), ['user', 'covered', 'user', 'saved', 'user', 'missing', 'user', 'draft']);
    assert.deepEqual(reel.counts, { covered: 1, saved: 1, missing: 1, draft: 1 });
    assert.deepEqual(reel.ticks.map(tick => tick.from), [5]);
    assert.deepEqual(buildFloorReel(index({}), 0), { lastFloor: -1, runs: [], ticks: [], recent: [], counts: { covered: 0, saved: 0, missing: 0, draft: 0 } });
});
