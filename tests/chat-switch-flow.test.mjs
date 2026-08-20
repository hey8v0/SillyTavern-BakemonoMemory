import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../', import.meta.url);

function toDataModule(source) {
    return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function loadModule(path) {
    const source = await readFile(new URL(path, repoUrl), 'utf8');
    return await import(toDataModule(source));
}

test('chat switch coordinator preserves the existing side-effect order and reasons', async () => {
    const chatSwitch = await loadModule('src/core/chat-switch.js');
    const calls = [];
    const state = { id: 'new-chat-state' };

    const result = chatSwitch.runChatSwitchFlow({
        getState() {
            calls.push('get-state');
            return state;
        },
        recover(current) {
            calls.push(`recover:${current.id}`);
        },
        syncConfig(current) {
            calls.push(`sync-config:${current.id}`);
        },
        scheduleAutoHide(reason) {
            calls.push(`auto-hide:${reason}`);
        },
        markVectorDirty(reason, unexpectedState) {
            calls.push(`vector-dirty:${reason}:${unexpectedState === undefined}`);
        },
        syncInjection() {
            calls.push('sync-injection');
        },
        scheduleRender() {
            calls.push('schedule-render');
        },
    });

    assert.equal(result, state);
    assert.deepEqual(calls, [
        'get-state',
        'recover:new-chat-state',
        'sync-config:new-chat-state',
        'auto-hide:chat changed',
        'vector-dirty:切换聊天:true',
        'sync-injection',
        'schedule-render',
    ]);
});

test('chat switch coordinator tolerates omitted optional actions', async () => {
    const chatSwitch = await loadModule('src/core/chat-switch.js');

    assert.equal(chatSwitch.runChatSwitchFlow(), undefined);
    assert.equal(chatSwitch.runChatSwitchFlow({ getState: () => null }), null);
});

test('chat switch coordinator keeps fail-fast behavior', async () => {
    const chatSwitch = await loadModule('src/core/chat-switch.js');
    const calls = [];

    assert.throws(() => chatSwitch.runChatSwitchFlow({
        getState: () => ({}),
        syncConfig() {
            calls.push('sync-config');
            throw new Error('sync failed');
        },
        scheduleAutoHide() {
            calls.push('auto-hide');
        },
    }), /sync failed/);
    assert.deepEqual(calls, ['sync-config']);
});
