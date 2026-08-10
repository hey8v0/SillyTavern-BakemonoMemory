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

test('shared vector config excludes chat runtime and restores the destination chat runtime', async () => {
    const configSync = await loadModule('src/core/config-sync.js');
    const source = {
        enabled: true,
        embeddingProvider: 'custom-openai',
        customApi: { baseUrl: 'https://example.com/v1', apiKey: 'secret', model: 'embed-1', models: ['embed-1'] },
        records: [{ id: 'source-record' }],
        embeddingCache: { source: [1] },
        lastHits: [{ id: 'source-hit' }],
        lastQueries: ['source query'],
        lastEmbeddingCandidates: [{ id: 'source-candidate' }],
        lastRerankCandidates: [{ id: 'source-rerank' }],
        lastIndexAt: 'source-time',
        lastIndexedSignature: 'source-signature',
        dirty: false,
    };
    const shared = configSync.createSharedVectorConfig(source);

    assert.equal(shared.enabled, true);
    assert.equal(shared.customApi.model, 'embed-1');
    for (const key of configSync.vectorRuntimeFieldNames) {
        assert.equal(Object.hasOwn(shared, key), false, `${key} should remain chat-local`);
    }

    const current = {
        records: [{ id: 'destination-record' }],
        embeddingCache: { destination: [2] },
        lastHits: [{ id: 'destination-hit' }],
        lastQueries: ['destination query'],
        lastEmbeddingCandidates: [{ id: 'destination-candidate' }],
        lastRerankCandidates: [{ id: 'destination-rerank' }],
        lastIndexAt: 'destination-time',
        lastIndexedSignature: 'destination-signature',
        dirty: false,
    };
    const merged = configSync.mergeSharedVectorConfig(current, shared, { enabled: false, embeddingProvider: 'local' });

    assert.equal(merged.embeddingProvider, 'custom-openai');
    assert.deepEqual(merged.records, current.records);
    assert.deepEqual(merged.lastHits, current.lastHits);
    assert.deepEqual(merged.lastEmbeddingCandidates, current.lastEmbeddingCandidates);
    assert.equal(merged.lastIndexedSignature, 'destination-signature');
});

test('shared config bootstrap waits for a real chat and only runs once', async () => {
    const configSync = await loadModule('src/core/config-sync.js');

    assert.equal(configSync.shouldBootstrapSharedConfig({}, false), false);
    assert.equal(configSync.shouldBootstrapSharedConfig({}, true), true);
    assert.equal(configSync.shouldBootstrapSharedConfig({ sharedConfigVersion: 1 }, true), false);
    assert.equal(configSync.shouldBootstrapSharedConfig({ sharedConfigVersion: 2 }, true), false);
});
