import test from 'node:test';
import assert from 'node:assert/strict';
import { compactEmbedding, encodeEmbedding, decodeEmbedding } from '../src/vector/storage.js';
import { createScanController } from '../src/features/scan-controller.js';
import { runApiRequest } from '../src/shared/request-policy.js';
import { createVectorMemoryService } from '../src/features/vector-memory-service.js';
import { createEmbeddingCache, getEmbeddingCacheKey } from '../src/vector/embedding-cache.js';
import { hydrateVectorRecords, serializeVectorMemory } from '../src/vector/storage.js';
import { createSummaryTaskQueue } from '../src/features/summary-task-queue.js';
import { createSummaryBackfillController } from '../src/features/summary-backfill-controller.js';
import { createGenerationClient } from '../src/features/generation-client.js';
import * as provider from '../src/vector/provider-config.js';
import * as math from '../src/vector/math.js';
import * as sourceMetadata from '../src/summary/source-metadata.js';
import { selectHybridCandidates, computeHybridRerankScore } from '../src/vector/hybrid-retrieval.js';
import { stripConfiguredTags } from '../src/shared/text.js';

const noop = () => {};
const toastr = { info: noop, success: noop, warning: noop, error: noop, clear: noop };
const tick = () => new Promise(resolve => setImmediate(resolve));

function vectorFixture(count = 150, overrides = {}) {
    const chat = Array.from({ length: count }, (_, i) => ({ mes: '剧情 ' + i }));
    const defaults = { chunkSize: 900, overlap: 120, longMessageThreshold: 1800, indexMode: 'message',
        maxIndexedMessages: 300, summaryMaxChars: 520, embeddingDimensions: 128 };
    const state = { vectorMemory: { ...defaults, enabled: true, embeddingProvider: 'custom-openai', records: [],
        customApi: { model: 'embed', baseUrl: 'https://example.invalid/v1' } }, scanRules: {}, storySummaries: [], stageSummaries: [], epicSummaries: [] };
    let calls = 0, yields = 0, cleaned = 0;
    const cache = new Map();
    const dependencies = { ...provider, ...math, ...sourceMetadata, getState: () => state,
        defaultVectorMemory: defaults, compactEmbedding, getContext: () => ({ chat }),
        getHash: String, normalizeLineEndings: String, stripHtml: String, parseList: x => String(x || '').split(',').filter(Boolean),
        unique: x => [...new Set(x)], extractConfiguredTagBlocks: () => [],
        stripConfiguredTags: x => { cleaned++; return x; }, toPlainPreview: String,
        getMessageVariantKey: m => m.swipe_id || 0, getActiveCoveredStageHashes: () => new Set(),
        getActiveEpicMemoryBlocks: () => [], memoryStrategies: { GENERIC: 'generic' }, blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' },
        getClippedVectorText: String, readVectorMemoryFieldsFromUi: noop, syncInjection: noop,
        renderWorkbenchScope: noop, workbenchRenderScopes: {}, saveState: noop, toastr,
        embeddingCache: { get: async key => cache.get(key), put: async (key, value) => cache.set(key, value) },
        yieldToUi: async () => { yields++; },
        fetchImpl: async () => { calls++; return new Response(JSON.stringify({ data: [{ embedding: [0.2, 0.8, 0.4] }] })); },
        ...overrides,
    };
    return { state, chat, cache, dependencies, service: createVectorMemoryService(dependencies),
        calls: () => calls, yields: () => yields, cleaned: () => cleaned };
}

test('excluded trailing widget leaves index current; retrieval refreshes changed text before evaluating recall', async () => {
    const f = vectorFixture(2, { stripConfiguredTags, stripHtml: text => text.replace(/<[^>]*>/g, ''), setTimer: () => 1, clearTimer() {} });
    f.state.vectorMemory.excludeTags = 'widget';
    f.state.vectorMemory.startAfterAiMessages = 99;
    await f.service.buildVectorMemoryIndex();
    const signature = f.service.getVectorSourceSignature();
    f.chat[1].mes += '<widget>动态按钮</widget><script>run()</script>';
    f.service.markVectorIndexDirty('消息变更');
    assert.equal(f.service.getVectorSourceSignature(), signature);
    assert.equal(f.state.vectorMemory.dirty, false);
    f.chat[1].mes += '新的剧情';
    f.service.markVectorIndexDirty('消息变更');
    assert.equal(f.state.vectorMemory.dirty, true);
    await f.service.retrieveVectorMemoryHits('线索');
    assert.equal(f.state.vectorMemory.lastIndexedSignature, f.service.getVectorSourceSignature());
    assert.equal(f.state.vectorMemory.dirty, false);
    assert.match(f.state.vectorMemory.lastRecallSkippedReason, /少于 99/);
    assert.equal(f.calls(), 3);
});

test('recall does not restart an explicitly paused index', async () => {
    const f = vectorFixture(1);
    await f.service.buildVectorMemoryIndex();
    f.service.pauseVectorIndex();
    f.chat.push({mes:'新增'});
    await f.service.retrieveVectorMemoryHits('线索');
    assert.equal(f.calls(), 1);
    assert.match(f.state.vectorMemory.lastRecallSkippedReason, /刷新索引/);
});

test('recall retries the newest source after a pending build is invalidated by a late append', async () => {
    const f = vectorFixture(1);
    await f.service.buildVectorMemoryIndex();
    f.chat[0].mes = '第一版变化';
    f.state.vectorMemory.startAfterAiMessages = 99;
    let release, calls = 0;
    const service = createVectorMemoryService({ ...f.dependencies, fetchImpl: async () => {
        if (++calls === 1) await new Promise(resolve => { release = resolve; });
        return new Response(JSON.stringify({ data: [{embedding:[0.2, 0.8, 0.4]}] }));
    }});
    const pending = service.buildVectorMemoryIndex().catch(error => error);
    while (!release) await tick();
    f.chat[0].mes += '追加内容';
    const recall = service.retrieveVectorMemoryHits('线索');
    release();
    assert.ok(await pending instanceof Error);
    await recall;
    assert.equal(f.state.vectorMemory.lastIndexedSignature, service.getVectorSourceSignature());
    assert.equal(f.state.vectorMemory.records[0].text, '第一版变化追加内容');
    assert.equal(calls, 2);
});

test('150 indexed fragments are reused across scans and reload; one appended fragment costs one request', async () => {
    const f = vectorFixture();
    await f.service.buildVectorMemoryIndex();
    assert.equal(f.calls(), 150);
    assert.equal(f.yields(), 15);
    const cleaned = f.cleaned();
    await f.service.buildVectorMemoryIndex();
    assert.equal(f.calls(), 150); assert.equal(f.cleaned(), cleaned);
    f.chat.push({ mes: '新增的约定' });
    await f.service.buildVectorMemoryIndex();
    assert.equal(f.calls(), 151); assert.equal(f.cleaned(), cleaned + 1);
    f.state.vectorMemory = JSON.parse(JSON.stringify(serializeVectorMemory(f.state.vectorMemory)));
    assert.equal(typeof f.state.vectorMemory.records[0].embedding, 'string');
    hydrateVectorRecords(f.state.vectorMemory);
    f.cache.clear();
    await createVectorMemoryService(f.dependencies).buildVectorMemoryIndex();
    assert.equal(f.calls(), 151);
    f.chat.splice(0, 1);
    await f.service.buildVectorMemoryIndex();
    assert.equal(f.calls(), 151);
    assert.equal(f.state.vectorMemory.records.length, 150);
    assert.equal(f.state.vectorMemory.records[0].messageId, 0);
});

test('old compressed vectors are rebuilt and a dimension change never replaces a working index', async () => {
    const f = vectorFixture(1);
    f.state.vectorMemory.records = [{ embedding: [1], text: '旧数据' }];
    await f.service.buildVectorMemoryIndex();
    assert.equal(f.calls(), 1);
    assert.equal(f.state.vectorMemory.records[0].embeddingFormat, 'native-v1');
    const original = f.state.vectorMemory.records;
    f.chat.push({ mes: 'new' });
    const service = createVectorMemoryService({ ...f.dependencies,
        fetchImpl: async () => new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] })) });
    await assert.rejects(service.buildVectorMemoryIndex(), /维度/);
    assert.equal(f.state.vectorMemory.records, original);
});

test('paused index keeps completed cache checkpoints and resumes without repeating them', async () => {
    const f = vectorFixture(30);
    let yields = 0;
    const service = createVectorMemoryService({ ...f.dependencies,
        yieldToUi: async () => { if (++yields === 1) service.pauseVectorIndex(); } });
    assert.equal(await service.buildVectorMemoryIndex(), false);
    assert.equal(f.calls(), 10);
    assert.equal(f.state.vectorMemory.records.length, 0);
    await service.buildVectorMemoryIndex({ silent: true });
    assert.equal(f.calls(), 10);
    await service.buildVectorMemoryIndex();
    assert.equal(f.calls(), 30);
    assert.equal(f.state.vectorMemory.records.length, 30);
});

test('a failed optional cache does not block indexing and keys isolate both space and content', async () => {
    const f = vectorFixture(2, { embeddingCache: { get: async () => { throw Error('unavailable'); }, put: async () => { throw Error('quota'); } } });
    await f.service.buildVectorMemoryIndex(); assert.equal(f.calls(), 2);
    const disabled = createEmbeddingCache({ indexedDB: { open() { throw Error('denied'); } } });
    assert.equal(await disabled.get('key'), null);
    assert.equal(await disabled.put('key', [1]), false);
    assert.notEqual(await getEmbeddingCacheKey('a', 'b'), await getEmbeddingCacheKey('a', 'c'));
    assert.notEqual(await getEmbeddingCacheKey('a', 'b'), await getEmbeddingCacheKey('c', 'b'));
});

function queueFixture(tasks, overrides = {}) {
    const state = { taskQueue: tasks, drafts: [], automation: {}, storySummaries: [] };
    const created = [];
    const deps = { getState: () => state, getHash: String, getKindLabel: String, saveState: noop, setBusy: noop,
        renderTaskQueueProgress: noop, renderWorkbenchScope: noop, workbenchRenderScopes: {},
        toastr, switchWorkbenchTab: noop, normalizeGeneratedBakemono: String,
        callGenerationModel: async () => '生成内容', blockTypes: { STAGE: 'stage' },
        createDraft: draft => { const item = { id: String(created.length), ...draft }; state.drafts.push(item); created.push(item); return item; },
        ...overrides };
    return { state, created, queue: createSummaryTaskQueue(deps), deps };
}

test('BM25 participates in the actual vector recall pipeline without extra embedding calls', async () => {
    const f = vectorFixture(2, { selectHybridCandidates, computeHybridRerankScore, countKeywordHits: () => 0 });
    f.chat[0].mes = 'silver key promised to Nana';
    f.chat[1].mes = 'silver key ' + 'breakfast weather '.repeat(120);
    Object.assign(f.state.vectorMemory, { queryMode: 'off', skipIfAllInContext: false, contextWindowMessages: 0,
        embeddingThreshold: 0, rerankThreshold: 0, rerankCandidateCount: 20,
        finalRecallCount: 1, fullRecallCount: 1, perMessageMaxChars: 1600, maxStoredTextChars: 1200 });
    await f.service.buildVectorMemoryIndex();
    const hits = await f.service.retrieveVectorMemoryHits('silver key');
    assert.equal(hits.length, 1); assert.equal(hits[0].messageId, 0);
    assert.ok(hits[0].lexicalScore > 0);
    const calls = f.calls();
    await f.service.retrieveVectorMemoryHits('silver key');
    assert.equal(f.calls(), calls);
    assert.equal(Object.hasOwn(f.state.vectorMemory, 'lexicalIndex'), false);
});

test('queue pauses after current task and resumes pending tasks without repeating completed tasks', async () => {
    let release, calls = 0;
    const f = queueFixture([{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }], {
        callGenerationModel: () => { calls++; return new Promise(resolve => { release = resolve; }); },
    });
    const first = f.queue.processTaskQueue(); f.queue.pauseQueue(); release('A'); await first;
    assert.equal(calls, 1); assert.equal(f.state.taskQueue[1].status, 'queued');
    const second = f.queue.resumeQueue(); release('B'); await second;
    assert.equal(calls, 2); assert.equal(f.created.length, 2);
    assert.deepEqual(f.state.taskQueue.map(t => t.status), ['done', 'done']);
});

test('stop aborts custom request and recovery marks interrupted tasks retryable', async () => {
    let signal;
    const f = queueFixture([{ id: 'a', status: 'queued' }], { callGenerationModel: args => {
        signal = args.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('stopped'))));
    } });
    const running = f.queue.processTaskQueue(); f.queue.stopCurrentTask(); await running;
    assert.equal(signal.aborted, true); assert.equal(f.created.length, 0);
    assert.equal(f.state.taskQueue[0].status, 'failed'); assert.equal(f.state.taskQueuePaused, true);
    f.state.taskQueue[0].status = 'running';
    f.queue.recoverInterruptedTasks();
    assert.equal(f.state.taskQueue[0].status, 'failed');
    assert.match(f.state.taskQueue[0].error, /中断/);
});

test('retrying a failed auto-save uses its existing draft instead of billing another generation', async () => {
    let calls = 0;
    const f = queueFixture([{ id: 'a', status: 'queued', kind: 'stage', trigger: 'auto' }], {
        callGenerationModel: async () => { calls++; return '保留草稿'; },
        commitDraft: async () => { throw Error('save failed'); },
    });
    f.state.automation.mode = 'commit_hide';
    await f.queue.processTaskQueue();
    assert.equal(f.state.drafts.length, 1);
    await f.queue.retryQueueTask('a'); await tick();
    assert.equal(calls, 1); assert.equal(f.state.drafts.length, 1);
});

test('partial batch retry sends only missing source floors and does not duplicate drafts', async () => {
    const targets = [0, 1, 2].map(messageId => ({ messageId, hash: 'hash' + messageId, targetMessageHash: '正文' + messageId }));
    const task = { id: 'batch', status: 'queued', trigger: 'missing_summary_batch', prompt: 'all', metadata: { missingTargets: targets } };
    const requests = [];
    let controller, f;
    f = queueFixture([task], {
        callGenerationModel: async args => { requests.push(args.prompt); return requests.length; },
        parseMissingSummaryBatchResult: result => (result === 1 ? [targets[0], targets[2]] : [targets[1]])
            .map(target => ({ target, content: '摘要' + target.messageId })),
        createMissingSummaryDraftFromBatchItem: (item, task) => f.state.drafts.push({ content: item.content,
            metadata: { missingBatchTaskId: task.id, targetMessageId: item.target.messageId } }),
        rebuildMissingTask: task => controller.rebuildMissingTask(task),
    });
    f.state.scanRules = {}; f.state.generationPrompts = { missing: '{{blocks}}' };
    controller = createSummaryBackfillController({ getState: () => f.state, getContext: () => ({ chat: targets.map(t => ({ mes: t.targetMessageHash })) }),
        getHash: String, parseList: x => String(x || '').split(',').filter(Boolean), unique: x => [...new Set(x)],
        stripPostProcessNoise: String, stripConfiguredTags: String, blockTypes: { STORY: 'story' },
        ...sourceMetadata, buildTurnReferenceSystemPrompt: async () => 'system' });
    await f.queue.processTaskQueue();
    assert.equal(task.status, 'partial'); assert.deepEqual(task.metadata.completedMessageIds, [0, 2]);
    await f.queue.retryQueueTask(task.id); await tick();
    assert.equal(requests.length, 2);
    assert.match(requests[1], /正文1/); assert.doesNotMatch(requests[1], /正文0|正文2/);
    assert.equal(task.status, 'done'); assert.equal(f.state.drafts.length, 3);
});

test('generation refuses length-truncated non-streaming output and incomplete SSE', async () => {
    const client = createGenerationClient({ ...provider, ensureState: () => ({
        automation: { apiProvider: 'custom', customApi: { baseUrl: 'https://example.invalid/v1', model: 'chat' } } }),
        defaultAutomation: { customApi: { temperature: 0.5, maxTokens: 1000 } },
        fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '半截' }, finish_reason: 'length' }] })),
    });
    await assert.rejects(client.callGenerationModel({ prompt: 'summary' }), /长度上限/);
    await assert.rejects(client.readOpenAIStream(new Response('data: {"choices":[{"delta":{"content":"半截"}}]}')), /完成标记/);
    await assert.rejects(client.readOpenAIStream(new Response('data: {"choices":[{"delta":{"content":"半截"},"finish_reason":"length"}]}')), /长度上限/);
    assert.equal(await client.readOpenAIStream(new Response('data: {"choices":[{"delta":{"content":"完整"},"finish_reason":"stop"}]}')), '完整');
});

test('timeout also covers response consumption; 503 retries once and network failures never retry', async () => {
    await assert.rejects(runApiRequest({ timeoutMs: 10, fetchImpl: async () => new Response('ok'),
        consume: () => new Promise(() => {}) }), /超时/);
    let calls = 0;
    await assert.rejects(runApiRequest({ fetchImpl: async () => { calls++; return new Response('', { status: 503 }); }, wait: async () => {} }), /503/);
    assert.equal(calls, 2); calls = 0;
    await assert.rejects(runApiRequest({ fetchImpl: async () => { calls++; throw Error('network'); } }), /network/);
    assert.equal(calls, 1);
});

test('embedding errors and rejected consumption abort the transport', async () => {
    let signal;
    await assert.rejects(runApiRequest({ fetchImpl: async (_, options) => {
        signal = options.signal; return new Response('broken');
    }, consume: () => { throw Error('invalid'); } }), /invalid/);
    assert.equal(signal.aborted, true);
});

test('a changed embedding model during a request cannot poison either model cache', async () => {
    let release;
    const f = vectorFixture(1, { fetchImpl: () => new Promise(resolve => { release = resolve; }) });
    const pending = f.service.buildVectorMemoryIndex();
    while (!release) await tick();
    f.state.vectorMemory.customApi.model = 'replacement';
    release(new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] })));
    await assert.rejects(pending, /配置/);
    assert.equal(f.cache.size, 0); assert.equal(f.state.vectorMemory.records.length, 0);
});

test('full dimensional float32 persistence keeps nearest-neighbor order on a synthetic recall fixture', () => {
    const query = compactEmbedding(Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.17)));
    const candidates = [query, compactEmbedding(query.map((v, i) => v + Math.cos(i) * 0.04)),
        compactEmbedding(query.map((v, i) => v + Math.cos(i) * 0.4)), query.map(v => -v)];
    const score = values => math.cosineSimilarity(query, values);
    const rank = records => records.map((embedding, i) => ({ i, score: score(embedding) })).sort((a, b) => b.score - a.score).map(x => x.i);
    assert.deepEqual(rank(candidates.map(vector => decodeEmbedding(encodeEmbedding(vector)))), rank(candidates));
    assert.deepEqual(rank(candidates), [0, 1, 2, 3]);
});

test('queue recovery after switching chat aborts the old request and never creates a new-chat draft', async () => {
    let release, signal;
    const first = { taskQueue: [{ id: 'old', status: 'queued' }], drafts: [] };
    const next = { taskQueue: [], drafts: [] };
    let current = first, created = 0;
    const f = queueFixture([], { getState: () => current,
        createDraft: () => { created++; },
        callGenerationModel: args => { signal = args.signal; return new Promise(resolve => { release = resolve; }); } });
    const pending = f.queue.processTaskQueue();
    current = next; f.queue.recoverInterruptedTasks(next);
    assert.equal(signal.aborted, true);
    release('old'); await pending;
    assert.equal(created, 0); assert.equal(next.taskQueue.length, 0); assert.equal(f.queue.isRunning(), false);
});

test('normalization and persisted encoding preserve dimensions and similarity', () => {
    const a = Array.from({ length: 1536 }, (_, i) => i % 2 ? -0.9 : 1);
    const b = a.map((_, i) => i % 2 ? 1 : -0.9);
    const x = compactEmbedding(a, 32), y = compactEmbedding(b, 32);
    assert.equal(x.length, 1536);
    assert.ok(x.reduce((s, v, i) => s + v * y[i], 0) < -0.99);
    const restored = decodeEmbedding(encodeEmbedding(x));
    assert.equal(restored.length, x.length);
    assert.ok(restored.every((v, i) => Math.abs(v - x[i]) < 1e-6));
    assert.deepEqual(decodeEmbedding('f32:bad'), []);
});

test('scan only extracts changed messages, invalidates rules, and isolates chats', () => {
    let extractions = 0;
    const chat = [{ mes: 'one' }, { mes: 'two' }];
    let state = { blocks: [], coveredBlockHashes: [], coveredStageHashes: [], scanRules: {}, classificationRules: {}, previewLayouts: {} };
    const controller = createScanController({ getState: () => state, getContext: () => ({ chat }),
        extractConfiguredSegments: content => { extractions++; return [{ content, mode: 'tag', matchedTag: 'tag' }]; },
        getSegmentSourceKind: () => 'tag', getMessageVariantKey: m => m.swipe_id || 0,
        getHash: String, classifyBlock: () => 'story', getBlockTitle: String, toPlainPreview: String,
        shouldPersistScannedBlock: () => true, mergeBlocks: (_, items) => items, unique: x => [...new Set(x)],
        maxStoredScanPreviewItems: 240, syncInjection() {},
    });
    const scan = () => controller.scanBakemonoBlocks({ persist: false, render: false });
    scan(); scan(); assert.equal(extractions, 2);
    chat.push({ mes: 'three' }); scan(); assert.equal(extractions, 3);
    chat[0].mes = 'edited'; scan(); assert.equal(extractions, 4);
    chat[1].swipe_id = 1; scan(); assert.equal(extractions, 5);
    chat.splice(1, 1); scan(); assert.equal(state.blocks.length, 2);
    assert.equal(state.blocks[1].content, 'three');
    const before = extractions;
    state.scanRules.tags = 'new'; scan(); assert.equal(extractions, before + 2);
    state = { ...state, blocks: [] }; scan(); assert.equal(extractions, before + 4);
});

test('request policy retries bounded 429 responses but never authentication errors', async () => {
    let calls = 0;
    assert.equal(await runApiRequest({ fetchImpl: async () => ++calls === 1 ? new Response('', { status: 429 }) : new Response('ok'),
        url: 'https://example.invalid', consume: r => r.text(), wait: async () => {} }), 'ok');
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(runApiRequest({ fetchImpl: async () => { calls++; return new Response('', { status: 401 }); },
        url: 'https://example.invalid', consume: r => r.text(), formatError: r => 'HTTP ' + r.status }), /401/);
    assert.equal(calls, 1);
});

test('timeout and cancellation stop waiting without retrying an uncertain request', async () => {
    let calls = 0, signal;
    await assert.rejects(runApiRequest({ url: '', timeoutMs: 10, fetchImpl: (_, opts) => {
        calls++; signal = opts.signal; return new Promise(() => {});
    } }), /超时/);
    assert.equal(calls, 1); assert.equal(signal.aborted, true);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(runApiRequest({ signal: controller.signal, fetchImpl: () => { calls++; } }), /取消/);
    assert.equal(calls, 1);
});
