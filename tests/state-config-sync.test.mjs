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

test('active config reader and signature tolerate missing or partial settings', async () => {
    const configSync = await loadModule('src/core/config-sync.js');

    assert.equal(configSync.readActiveConfig(null), null);
    assert.equal(configSync.readActiveConfig({ activeConfig: 'invalid' }), null);
    assert.deepEqual(
        configSync.readActiveConfig({ activeConfig: { id: 'preset-a', updatedAt: '2026-08-10' } }),
        { id: 'preset-a', updatedAt: '2026-08-10' },
    );
    assert.equal(configSync.getActiveConfigSignature(null), '');
    assert.equal(configSync.getActiveConfigSignature({ id: 'preset-a' }), 'preset-a|');
    assert.equal(
        configSync.getActiveConfigSignature({ id: 'preset-a', updatedAt: '2026-08-10' }),
        'preset-a|2026-08-10',
    );
});

test('config sync decision follows signature and supports forced chat refresh', async () => {
    const configSync = await loadModule('src/core/config-sync.js');
    const config = { id: 'preset-a', updatedAt: '2026-08-10' };

    assert.equal(configSync.shouldSyncActiveConfig({}, null), false);
    assert.equal(configSync.shouldSyncActiveConfig({}, config), true);
    assert.equal(
        configSync.shouldSyncActiveConfig({ activeConfigSignature: 'preset-a|2026-08-10' }, config),
        false,
    );
    assert.equal(
        configSync.shouldSyncActiveConfig(
            { activeConfigSignature: 'preset-a|2026-08-10' },
            config,
            { force: true },
        ),
        true,
    );
});

test('applied config marker updates only synchronization metadata', async () => {
    const configSync = await loadModule('src/core/config-sync.js');
    const state = { blocks: [{ hash: 'keep-me' }], activeConfigId: 'old' };

    const result = configSync.markActiveConfigApplied(state, {
        id: 'preset-a',
        updatedAt: '2026-08-10',
    });

    assert.equal(result, state);
    assert.equal(state.configInitialized, true);
    assert.equal(state.activeConfigId, 'preset-a');
    assert.equal(state.activeConfigSignature, 'preset-a|2026-08-10');
    assert.deepEqual(state.blocks, [{ hash: 'keep-me' }]);

    configSync.markActiveConfigApplied(state, null);
    assert.equal(state.activeConfigId, '');
    assert.equal(state.activeConfigSignature, '');
});
