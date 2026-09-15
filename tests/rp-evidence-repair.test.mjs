import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpCoreService } from '../src/rp-core/service.js';
import { validateRpBackup } from '../src/rp-core/backup.js';
import { seedLegacyExtraction } from './helpers/legacy-rp-extraction.mjs';

async function fixture() {
    const state = {}, chat = [{ mes: '甲走进花园。<bakemono>【第四面墙】甲来到花园</bakemono>' }];
    const service = createRpCoreService({ getState: () => state, getChat: () => chat, saveState() {}, saveChat: async () => {} });
    await service.enable();
    service.ingest = async (raw, floor) => seedLegacyExtraction(state, chat, raw, floor);
    await service.ingest(JSON.stringify({ version: 1, events: [{ track: 'facts', action: 'person_created', data: { id: 'a', name: '甲' }, excerpt: '甲来到花园' }] }), 0);
    return { service, state, chat, id: state.rpCore.candidates[0].id };
}
test('missing evidence is actionable and can be repaired only with a grounded excerpt before separate review', async () => {
    const f = await fixture();
    assert.equal(f.state.rpCore.facts.length, 0);
    assert.match(f.state.rpCore.candidates[0].reason, /正文.*摘录/);
    assert.throws(() => f.service.previewEvidenceRepair(f.id, '甲来到花园'), /正文/);
    const preview = f.service.previewEvidenceRepair(f.id, '甲走进花园');
    assert.equal(f.state.rpCore.candidates[0].evidence, null);
    await preview.commit();
    assert.equal(f.state.rpCore.facts.length, 0);
    assert.equal(f.state.rpCore.candidates[0].status, 'pending');
    assert.equal(f.state.rpCore.decisions.at(-1).action, 'repair_evidence');
    await f.service.review(f.id, 'accept');
    assert.equal(f.state.rpCore.facts.length, 1);
    validateRpBackup(f.state.rpCore);
    const repeated = await f.service.ingest(JSON.stringify({ version: 1, events: [{ track: 'facts', action: 'person_created', data: { id: 'a', name: '甲' }, excerpt: '甲走进花园' }] }), 0, { manual: true });
    assert.ok(['unchanged', 'modified'].includes(repeated.items[0].change));
    assert.equal(f.state.rpCore.facts.length, 1);
});
test('evidence repair preview refuses source changes and newer revisions', async () => {
    for (const change of ['source', 'revision']) {
        const f = await fixture(), preview = f.service.previewEvidenceRepair(f.id, '甲走进花园');
        if (change === 'source') f.chat[0].mes = '甲没有进入花园';
        else await f.service.configure({ autoApply: false });
        await assert.rejects(preview.commit(), /变化|修订/);
        assert.equal(f.state.rpCore.candidates[0].evidence, null);
    }
});
