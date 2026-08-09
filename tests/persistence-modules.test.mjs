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

test('vector storage compacts and normalizes embeddings deterministically', async () => {
    const storage = await loadModule('src/vector/storage.js');
    const source = Array.from({ length: 64 }, (_, index) => index + 1);
    const compact = storage.compactEmbedding(source, 32);

    assert.equal(compact.length, 32);
    const norm = Math.sqrt(compact.reduce((sum, value) => sum + value * value, 0));
    assert.ok(Math.abs(norm - 1) < 0.00001);
    assert.deepEqual(storage.compactEmbedding(['bad'], 32), []);
    assert.deepEqual(storage.compactEmbedding([3, 4], 32), [0.6, 0.8]);
});

test('save preparation clears runtime cache and bounds stored vector text', async () => {
    const storage = await loadModule('src/vector/storage.js');
    const vectorMemory = {
        embeddingDimensions: 32,
        maxStoredTextChars: 240,
        perMessageMaxChars: 300,
        embeddingCache: { stale: [1, 2, 3] },
        records: [{
            id: 'record-a',
            text: 'x'.repeat(260),
            matchedText: 'y'.repeat(260),
            embedding: Array.from({ length: 64 }, (_, index) => index + 1),
        }],
        lastHits: [{
            id: 'hit-a',
            text: 'z'.repeat(320),
            matchedText: 'm'.repeat(260),
        }],
    };

    storage.slimVectorMemoryForSave(vectorMemory, {
        embeddingDimensions: 128,
        maxStoredTextChars: 1200,
        perMessageMaxChars: 1600,
    });

    assert.deepEqual(vectorMemory.embeddingCache, {});
    assert.equal(vectorMemory.records[0].id, 'record-a');
    assert.equal(vectorMemory.records[0].text.length, 243);
    assert.equal(vectorMemory.records[0].matchedText.length, 243);
    assert.equal(vectorMemory.records[0].embedding.length, 32);
    assert.equal(vectorMemory.lastHits[0].text.length, 303);
    assert.equal(vectorMemory.lastHits[0].matchedText.length, 243);
});

test('persistence adapter prepares the current chat state before scheduling save', async () => {
    const persistence = await loadModule('src/core/persistence.js');
    const calls = [];
    const state = { id: 'current-chat' };
    const result = persistence.persistChatState(state, {
        prepare(current) {
            calls.push(`prepare:${current.id}`);
            current.prepared = true;
        },
        save() {
            calls.push(`save:${state.prepared}`);
            return 'queued';
        },
    });

    assert.equal(result, 'queued');
    assert.deepEqual(calls, ['prepare:current-chat', 'save:true']);
    assert.equal(state.prepared, true);
});

test('global persistence delegates once and missing callbacks remain safe', async () => {
    const persistence = await loadModule('src/core/persistence.js');
    let saves = 0;

    assert.equal(persistence.persistGlobalSettings(() => ++saves), 1);
    assert.equal(saves, 1);
    assert.equal(persistence.persistGlobalSettings(null), undefined);
    assert.equal(persistence.persistChatState(null, {}), undefined);
});
