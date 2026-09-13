import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpTransactions } from '../src/rp-core/transaction.js';
test('failed saves restore only the transaction-owned RP value', async () => {
    const original = { revision: 1 };
    const state = { rpCore: original, unrelated: 'keep' };
    const service = createRpTransactions({ getState: () => state, saveState: () => ({}), saveChat: async () => { throw Error('disk'); } });
    await assert.rejects(service.commit(state, 1, { revision: 2 }), /disk/);
    assert.equal(state.rpCore, original);
    assert.equal(state.unrelated, 'keep');
});
test('failed older writes do not overwrite newer RP edits', async () => {
    const state = { rpCore: { revision: 1 } };
    const service = createRpTransactions({ getState: () => state, saveState: () => ({}), saveChat: async () => {
        state.rpCore = { revision: 3 };
        throw Error('disk');
    } });
    await assert.rejects(service.commit(state, 1, { revision: 2 }), /disk/);
    assert.equal(state.rpCore.revision, 3);
});
test('queued writes recheck revision, chat and source at commit time', async () => {
    const state = { rpCore: { revision: 1 } };
    const service = createRpTransactions({ getState: () => state, saveState: () => ({}), saveChat: async () => {} });
    const first = service.commit(state, 1, { revision: 2 });
    const second = service.commit(state, 1, { revision: 3 });
    await first;
    await assert.rejects(second, /变化/);
    await assert.rejects(service.commit(state, 2, { revision: 4 }, () => false), /来源/);
    assert.equal(state.rpCore.revision, 2);
});
