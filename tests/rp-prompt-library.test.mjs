import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpPromptLibrary } from '../src/rp-core/prompt-library.js';
import { RP_EVENT_GUIDE, createRpExtractionFlow } from '../src/rp-core/extraction-flow.js';
test('prompt presets apply, save, overwrite, delete and persist across instances', async () => {
    let saved; const confirmations = [];
    const deps = { read: () => saved, write: value => { saved = structuredClone(value); }, confirmSave: async value => { confirmations.push(value); return { status: 'confirmed' }; } };
    const library = createRpPromptLibrary(deps);
    assert.equal(library.current(), RP_EVENT_GUIDE);
    const draft = library.draft(); draft.prompt = '自定义状态指令'; draft.name = '我的预设';
    await library.commit('save-as', draft);
    assert.equal(library.current(), draft.prompt);
    assert.equal(createRpPromptLibrary(deps).current(), draft.prompt);
    const edit = library.draft(); edit.prompt = '更新的指令'; await library.commit('overwrite', edit);
    assert.equal(library.list().length, 2); assert.equal(library.current(), edit.prompt);
    await assert.rejects(library.commit('apply', draft), /变化/);
    const loaded = library.load('default'); assert.equal(loaded.prompt, RP_EVENT_GUIDE);
    assert.equal(library.current(), edit.prompt);
    await assert.rejects(library.commit('overwrite', loaded), /内置/);
    await library.commit('delete', library.draft()); assert.equal(library.list().length, 1);
    assert.equal(library.current(), edit.prompt); assert.equal(confirmations.length, 3);
});
test('failed persistence is not reported as saved and empty prompts cannot replace active prompt', async () => {
    let saved; const library = createRpPromptLibrary({ read: () => saved, write: value => { saved = value; }, confirmSave: async () => { throw Error('network'); } });
    const draft = library.draft(); draft.prompt = '自定义';
    assert.equal((await library.commit('apply', draft)).status, 'unconfirmed');
    assert.equal(library.current(), '自定义');
    await assert.rejects(library.commit('apply', { ...library.draft(), prompt: ' ' }), /提示词/);
});
test('both extraction modes use the committed custom prompt', () => {
    const state = { rpCore: { schemaVersion: 1, ruleVersion: 2, baseline: {}, facts: [], claims: [], observations: [], decisions: [], settings: { enabled: true, mode: 'inline' } } };
    const projection = { people: [], relationships: [], plans: [], items: [], locations: [] };
    let custom = '这是已应用提示词';
    const flow = createRpExtractionFlow({ getState: () => state, getChat: () => [], service: { view: () => ({ projection }) }, getPrompt: () => custom });
    assert.ok(flow.prompt('inline').startsWith(custom));
    state.rpCore.settings.mode = 'independent'; custom = '独立提取自定义';
    assert.ok(flow.prompt('independent').startsWith(custom));
    assert.equal(flow.prompt('inline'), '');
});
