import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpPromptHost } from './helpers/rp-prompt-host.mjs';
import { RP_EVENT_GUIDE, createRpExtractionFlow } from '../src/rp-core/extraction-flow.js';

test('production prompt binding reads default after real global initialization', () => {
    const host = createRpPromptHost();
    assert.equal(host.library.current(), RP_EVENT_GUIDE);
    assert.equal(host.library.draft().selectedId, 'default');
    assert.equal(host.library.list().length, 1);
    assert.ok(host.extensionSettings[host.storageKey].promptPresets.length);
    assert.equal(host.ensureGlobalSettings(), undefined);
});

test('production prompt writes and verifies host settings, retaining presets after reload', async () => {
    const host = createRpPromptHost({ stringSettings: true });
    const draft = { ...host.library.draft(), name: '我的剧情状态', prompt: '按本轮整理状态' };
    assert.equal((await host.library.commit('save-as', draft)).status, 'confirmed');
    assert.equal(host.getSaveRequests(), 1);
    assert.equal(host.getSaved()[host.storageKey].rpPromptLibrary.activePrompt, draft.prompt);
    const reload = createRpPromptHost({ initialSettings: host.getSaved() });
    assert.equal(reload.library.current(), draft.prompt);
    assert.equal(reload.library.list()[1].name, draft.name);
    assert.equal((await reload.library.commit('overwrite', { ...reload.library.draft(), prompt: '修改后的指令' })).status, 'confirmed');
    assert.equal((await reload.library.commit('delete', reload.library.draft())).status, 'confirmed');
    assert.equal(reload.library.current(), '修改后的指令');
    assert.equal(reload.library.list().length, 1);
});

test('production save verification reports failed and unpersisted writes without resetting active settings', async () => {
    for (const saveMode of ['fail', 'ignore']) {
        const host = createRpPromptHost({ saveMode });
        const result = await host.library.commit('apply', { ...host.library.draft(), prompt: '自定义指令' });
        assert.equal(result.status, 'unconfirmed');
        assert.equal(host.library.current(), '自定义指令');
        host.setSaveMode('persist');
        assert.equal((await host.library.commit('apply', host.library.draft())).status, 'confirmed');
    }
});

test('production callbacks follow replaced settings and supply all extraction modes', async () => {
    const host = createRpPromptHost();
    await host.library.commit('apply', { ...host.library.draft(), prompt: '旧设置' });
    const oldObject = host.extensionSettings[host.storageKey];
    host.extensionSettings[host.storageKey] = { rpPromptLibrary: { ...oldObject.rpPromptLibrary, revision: 5, activePrompt: '重新载入的设置' } };
    assert.equal(host.library.current(), '重新载入的设置');
    await host.library.commit('apply', { ...host.library.draft(), prompt: '新设置' });
    assert.equal(oldObject.rpPromptLibrary.activePrompt, '旧设置');
    assert.equal(host.getSaved()[host.storageKey].rpPromptLibrary.activePrompt, '新设置');
    const state = { rpCore: { schemaVersion: 1, ruleVersion: 2, baseline: {}, facts: [], claims: [], observations: [], decisions: [], settings: { enabled: true, mode: 'inline' } }, turnSummary: { enabled: true } };
    const projection = { people: [], relationships: [], plans: [], items: [], locations: [] };
    const flow = createRpExtractionFlow({ getState: () => state, getChat: () => [], getPrompt: () => host.library.current(), service: { view: () => ({ projection }) } });
    for (const mode of ['inline', 'independent']) {
        state.rpCore.settings.mode = mode;
        assert.ok(flow.prompt(mode).startsWith('新设置'), mode);
    }
});
