import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, appendRecord, retractFact, replayLedger } from '../src/rp-core/ledger.js';
const reducer = (state, event) => {
    if (event.action === 'acquire') {
        if (state.item) throw new Error('already owned');
        return { item: event.data.person };
    }
    if (event.action === 'give') {
        if (state.item !== event.data.from) throw new Error('not held');
        return { item: event.data.to };
    }
    throw new Error('unknown action');
};
test('claims and observations never invoke the fact reducer', () => {
    const core = createLedger({}, 0);
    appendRecord(core, { track: 'claims', action: 'acquire', data: { person: 'A' } }, { floor: 1 });
    appendRecord(core, { track: 'observations', action: 'acquire', data: { person: 'B' } }, { floor: 1 });
    const view = replayLedger(core, () => { throw new Error('must not run'); });
    assert.deepEqual(view.projection, {});
    assert.equal(core.facts.length, 0);
    assert.equal(core.claims.length, 1);
    assert.equal(core.observations.length, 1);
});
test('retraction reevaluates later preconditions and preserves historical knowledge', () => {
    const core = createLedger({}, 0);
    const first = appendRecord(core, { track: 'facts', action: 'acquire', data: { person: 'A' } }, { floor: 1 });
    appendRecord(core, { track: 'facts', action: 'give', data: { from: 'A', to: 'B' } }, { floor: 2 });
    assert.deepEqual(replayLedger(core, reducer).projection, { item: 'B' });
    retractFact(core, first.id, { floor: 3, reason: 'correction' });
    const view = replayLedger(core, reducer);
    assert.deepEqual(view.projection, {});
    assert.equal(view.pending.length, 1);
    assert.equal(core.facts.length, 2);
    assert.deepEqual(replayLedger(core, reducer, { asOfFloor: 2 }).projection, { item: 'B' });
});
test('retroactive ordering does not rewrite knowledge at an earlier recorded floor', () => {
    const core = createLedger({}, 0);
    appendRecord(core, { track: 'facts', action: 'give', data: { from: 'A', to: 'B' } }, { floor: 5, order: 5 });
    appendRecord(core, { track: 'facts', action: 'acquire', data: { person: 'A' } }, { floor: 8, order: 2 });
    assert.equal(replayLedger(core, reducer, { asOfFloor: 5 }).pending.length, 1);
    assert.deepEqual(replayLedger(core, reducer).projection, { item: 'B' });
    assert.deepEqual(replayLedger(JSON.parse(JSON.stringify(core)), reducer).projection, { item: 'B' });
});
test('unsupported versions and prebaseline events are refused', () => {
    const core = createLedger({}, 10);
    assert.throws(() => appendRecord(core, { track: 'facts', action: 'acquire' }, { floor: 11, order: 5 }), /基线/);
    assert.throws(() => replayLedger({ ...core, ruleVersion: 99 }, reducer), /版本/);
});
