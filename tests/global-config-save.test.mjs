import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalConfigSaveVerifier } from '../src/core/global-config-save.js';
import { createVectorActionsController } from '../src/features/vector-actions-controller.js';
import { readFile } from 'node:fs/promises';

test('vector actions are wired to host read-back with the actual storage key', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /createVectorActionsController\(\{\s*confirmGlobalConfiguration,\s*cancelVectorRecall,\s*clearVectorRecall,/);
    assert.match(index, /extension_settings\?\.\[STORAGE_KEY\]\?\.activeConfig/);
});

test('global confirmation requires exact read-back, not a resolved host save promise', async () => {
    const expected = { id: 'shared', updatedAt: 'one', vectorMemory: { enabled: false, overlap: 0, excludeTags: '' } };
    for (const stored of [expected, { ...expected, vectorMemory: { enabled: true } }, null]) {
        let saves = 0;
        const verify = createGlobalConfigSaveVerifier({ getCurrentConfig: () => expected,
            requestSave: async () => { saves++; }, readSavedConfig: async () => stored, retryDelays: [0] });
        const result = await verify(expected);
        assert.equal(result.status, stored === expected ? 'confirmed' : 'unconfirmed');
        assert.equal(saves, 1);
    }
});

test('verification serializes saves and a superseded revision cannot report success', async () => {
    let current = { id: 'a' }, unblock, saves = 0;
    const first = current;
    const verify = createGlobalConfigSaveVerifier({ getCurrentConfig: () => current, retryDelays: [0],
        requestSave: () => { saves++; if (saves === 1) return new Promise(resolve => { unblock = resolve; }); },
        readSavedConfig: async () => current });
    const a = verify(first); await new Promise(resolve => setImmediate(resolve));
    current = { id: 'b' }; const b = verify(current);
    assert.equal(saves, 1); unblock();
    assert.equal((await a).status, 'superseded'); assert.equal((await b).status, 'confirmed');
});

test('global verification classifies errors and bounds a hung save without exposing its error', async () => {
    for (const hang of [false, true]) {
        const verify = createGlobalConfigSaveVerifier({ getCurrentConfig: () => ({ id: 'one' }),
            requestSave: () => hang ? new Promise(() => {}) : Promise.reject(new Error('secret endpoint/token')),
            readSavedConfig: async () => { throw new Error('must not read'); }, timeoutMs: 25 });
        const result = await verify({ id: 'one' });
        assert.equal(result.status, 'unconfirmed'); assert.doesNotMatch(JSON.stringify(result), /secret|token|endpoint/);
    }
});

test('vector save reports global and chat outcomes separately, without rolling back changed settings', async () => {
    for (const global of ['confirmed', 'unconfirmed']) for (const chatFails of [false, true]) {
        const state = { vectorMemory: { enabled: false }, activeConfigSignature: 'one' }, messages = [];
        let resolveGlobal;
        const actions = createVectorActionsController({ getState: () => state, readVectorMemoryFieldsFromUi() {},
            persistSharedConfigurationFromState: () => ({ id: 'one' }),
            confirmGlobalConfiguration: () => new Promise(resolve => { resolveGlobal = resolve; }),
            saveChatConditional: async () => { if (chatFails) throw new Error('save failed'); },
            syncInjection() {}, renderWorkbenchScope: (_scope, message) => messages.push(message), workbenchRenderScopes: {},
            toastr: { warning() {} },
        });
        const pending = actions.applyVectorMemorySettings();
        assert.equal(messages.length, 0);
        resolveGlobal({ status: global }); await pending;
        const message = messages.at(-1);
        assert.match(message, global === 'confirmed' ? /共享配置已核验保存/ : /共享配置尚未确认保存/);
        assert.match(message, chatFails ? /聊天保存失败/ : /聊天保存请求已完成/);
        assert.equal(state.vectorMemory.enabled, false);
    }
});
