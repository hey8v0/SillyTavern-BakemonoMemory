import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpCoreService } from '../src/rp-core/service.js';
test('enabled chat ingests grounded facts through one channel and invalidates edited evidence', async () => {
    const state = {}, chat = [{ mes: '甲来到这里。' }];
    let saves = 0, id = 0;
    const service = createRpCoreService({ getState: () => state, getChat: () => chat,
        saveState: () => ({ status: 'staged' }), saveChat: async () => saves++,
        makeSourceId: () => String(++id) });
    await service.enable();
    const raw = JSON.stringify({ version: 1, events: [
        { track: 'facts', action: 'person_created', data: { id: 'a', name: '甲' }, excerpt: '甲来到这里' },
    ] });
    assert.equal(await service.ingest(raw, 0, { channel: 'independent' }), null);
    await service.ingest(raw, 0);
    assert.equal(service.view().projection.people[0].name, '甲');
    assert.equal(state.rpCore.facts.length, 1);
    const originalExcerpt = state.rpCore.facts[0].evidence.excerpt;
    state.rpCore.facts[0].evidence.excerpt = '不存在的来源';
    assert.equal(service.view().projection.people.length, 1, 'optional excerpt text is not a model-recording gate');
    state.rpCore.facts[0].evidence.excerpt = originalExcerpt;
    chat[0].mes = '另一段正文';
    assert.equal(service.view().projection.people.length, 0);
    assert.equal(service.view().pending.length, 1);
    assert.equal(saves, 2);
});
