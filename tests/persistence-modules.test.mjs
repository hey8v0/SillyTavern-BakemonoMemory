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

test('summary confirmation reports success only after durable chat save and rolls back failures', async () => {
    const { createSummaryDraftService } = await loadModule('src/features/summary-draft-service.js');
    const state = {
        outputMode: 'plain',
        blocks: [], storySummaries: [], stageSummaries: [], epicSummaries: [],
        drafts: [{ id: 'draft-1', kind: 'stage', title: '阶段一', content: '内容', sourceHashes: ['story-1'], sourceMessageIds: [8], metadata: {} }],
        history: [], coveredBlockHashes: [], coveredStageHashes: [],
        generatedMemory: '', injection: {}, autoSummaryTransactions: [],
    };
    let shouldFail = true;
    let saveChatCalls = 0;
    const toastCalls = [];
    const service = createSummaryDraftService({
        getChat: () => [],
        ensureState: () => state,
        getHash: value => `hash:${String(value)}`,
        getBlockTitle: (_content, fallback) => fallback,
        blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' },
        toastr: {
            success: message => toastCalls.push(['success', message]),
            error: message => toastCalls.push(['error', message]),
            warning() {}, info() {}, clear() {},
        },
        saveChatConditional: async () => {
            saveChatCalls += 1;
            if (shouldFail) throw new Error('disk unavailable');
        },
        updateInjectionFromSummaries: () => { state.generatedMemory = state.stageSummaries.map(item => item.content).join('\n'); },
        saveState() {},
        renderWorkbenchScope() {},
        workbenchRenderScopes: { DRAFTS: 'drafts' },
        getSourceStart: ids => Math.min(...ids),
        getSourceEnd: ids => Math.max(...ids),
        getSummaryLevel: () => 1,
        sortSummariesBySource: items => items,
        unique: values => [...new Set(values)],
        mergeBlocks: (current, next) => [...current, ...next],
        getKindLabel: kind => kind,
        parseList: () => [],
        extractConfiguredSegments: () => [],
    });

    const failed = await service.commitDraft('draft-1');
    assert.equal(failed, null);
    assert.equal(state.drafts.length, 1);
    assert.equal(state.stageSummaries.length, 0);
    assert.equal(toastCalls.some(([type]) => type === 'success'), false);
    assert.equal(toastCalls.some(([type]) => type === 'error'), true);

    shouldFail = false;
    const saved = await service.commitDraft('draft-1');
    assert.equal(saved.title, '阶段一');
    assert.equal(state.drafts.length, 0);
    assert.equal(state.stageSummaries.length, 1);
    assert.equal(saveChatCalls, 2);
    assert.equal(toastCalls.at(-1)[0], 'success');
});
