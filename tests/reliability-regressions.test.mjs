import test from 'node:test';
import assert from 'node:assert/strict';
import * as provider from '../src/vector/provider-config.js';
import { createGenerationClient } from '../src/features/generation-client.js';
import { createVectorActionsController } from '../src/features/vector-actions-controller.js';
import { createVectorMemoryService } from '../src/features/vector-memory-service.js';
import { createSummaryGenerationController } from '../src/features/summary-generation-controller.js';
import { createSummaryTaskQueue } from '../src/features/summary-task-queue.js';
import { renderGenerationPrompt } from '../src/shared/prompt-utils.js';
import * as sourceMetadata from '../src/summary/source-metadata.js';

const noop = () => {};
const toastr = { info: noop, success: noop, warning: noop, error: noop, clear: noop };

test('all supported endpoint pastes resolve to sibling API endpoints', () => {
    for (const suffix of ['', '/embedding', '/embeddings/', '/models', '/chat/completions']) {
        const base = `https://example.com/custom/v1${suffix}`;
        assert.equal(provider.getCustomModelsUrl(base), 'https://example.com/custom/v1/models');
        assert.equal(provider.getCustomEmbeddingsUrl(base), 'https://example.com/custom/v1/embeddings');
        assert.equal(provider.getCustomChatCompletionsUrl(base), 'https://example.com/custom/v1/chat/completions');
    }
});

test('stream flushes final unterminated event and split UTF-8 without duplicating chunks', async () => {
    const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"前"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"尾巴"}}]}');
    const response = new Response(new ReadableStream({ start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
    } }));
    assert.equal(await createGenerationClient().readOpenAIStream(response), '前尾巴');
    assert.equal(response.body.locked, false);
});

test('stream API error after partial content is not returned as a successful summary', async () => {
    const response = new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"quota"}}');
    await assert.rejects(createGenerationClient().readOpenAIStream(response), /流式.*错误/);
});

function vectorController(overrides = {}) {
    const state = { vectorMemory: { enabled: true, customApi: { baseUrl: 'https://example.com/v1/embeddings', model: '' }, records: [{}] } };
    const notices = [];
    return { state, notices, controller: createVectorActionsController({
        getState: () => state, readVectorMemoryFieldsFromUi: noop,
        persistSharedConfigurationFromState: noop, ...provider,
        query: () => ({ val: () => '寻找旧约定' }),
        renderVectorModelOptions: noop, saveState: noop, syncInjection: noop,
        renderWorkbenchScope: noop, workbenchRenderScopes: {},
        toastr: { ...toastr, success: message => notices.push(message), error: message => notices.push(message) },
        ...overrides,
    }) };
}

test('embedding model candidates do not auto-select a chat model or claim verified capability', async () => {
    const { state, notices, controller } = vectorController({ fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'chat-model' }, { id: 'text-embedding-3-small' }] })) });
    assert.equal(await controller.fetchVectorEmbeddingModels(), true);
    assert.equal(state.vectorMemory.customApi.model, '');
    assert.deepEqual(state.vectorMemory.customApi.models, ['text-embedding-3-small']);
    assert.match(notices.join(' '), /候选/);
});

test('unknown model names remain manually selectable and HTTP failures have actionable explanations', async () => {
    const { state, controller } = vectorController({ fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'private-model' }] })) });
    await controller.fetchVectorEmbeddingModels();
    assert.deepEqual(state.vectorMemory.customApi.models, ['private-model']);
    const failed = vectorController({ fetchImpl: async () => new Response('', { status: 401 }) });
    assert.equal(await failed.controller.fetchVectorEmbeddingModels(), false);
    assert.match(failed.notices.join(' '), /401.*密钥/);
});

test('test retrieval reads the input without shadowing the UI query function', async () => {
    let received;
    const { controller } = vectorController({ retrieveVectorMemoryHits: async text => { received = text; return [{}]; } });
    assert.equal(await controller.testVectorMemoryRetrieval(), true);
    assert.equal(received, '寻找旧约定');
});

test('custom embedding failure never silently caches an unrelated local embedding', async () => {
    const state = { vectorMemory: { embeddingProvider: 'custom-openai', embeddingDimensions: 32, customApi: { model: 'embed', baseUrl: 'https://example.com/v1' } } };
    let localCalls = 0;
    const service = createVectorMemoryService({ getState: () => state, defaultVectorMemory: { embeddingDimensions: 32 }, ...provider,
        getHash: String, compactEmbedding: x => x, createLocalEmbedding: () => { localCalls++; return [1]; },
        fetchImpl: async () => new Response('', { status: 401 }),
    });
    await assert.rejects(service.getEmbeddingForText('材料'), /401/);
    assert.equal(localCalls, 0);
});

test('summary generation rejects title-only tag extraction but keeps real tagged story', () => {
    const controller = createSummaryGenerationController({ getState: () => ({ generationPrompts: { stage: '{{blocks}}', epic: '{{blocks}}' } }), renderGenerationPrompt: (_, blocks) => blocks.map(b => b.content).join('\n') });
    assert.throws(() => controller.buildStageUserPrompt([{ messageId: 9, content: '<summary>剧情摘要</summary>' }]), /第 9 楼.*读取标签/);
    const content = '<bakemono><details><summary>剧情摘要</summary>阿青找到了失踪的信。</details></bakemono>';
    assert.equal(controller.buildStageUserPrompt([{ content }]), content);
    assert.throws(() => controller.buildEpicUserPrompt([{ content: '<details><summary>标题</summary> </details>' }]), /有效/);
});

test('queue does not write old-chat response into the newly selected chat', async () => {
    const first = { taskQueue: [{ id: 'a', status: 'queued', prompt: 'old' }], automation: {} };
    const second = { taskQueue: [], automation: {} };
    let state = first;
    let resolve;
    let created = 0;
    let savesInSecond = 0;
    const queue = createSummaryTaskQueue({ getState: () => state, setBusy: noop, toastr,
        saveState: () => { if (state === second) savesInSecond++; },
        renderTaskQueueProgress: noop, renderWorkbenchScope: noop, workbenchRenderScopes: {},
        callGenerationModel: () => new Promise(r => { resolve = r; }),
        normalizeGeneratedBakemono: x => x, createDraft: () => { created++; return {}; }, switchWorkbenchTab: noop,
    });
    const running = queue.processTaskQueue();
    state = second;
    resolve('old result');
    await running;
    assert.equal(created, 0);
    assert.equal(savesInSecond, 0);
    assert.equal(queue.isRunning(), false);
});

test('stream rejects broken JSON tail but accepts comments and DONE without newline', async () => {
    const client = createGenerationClient();
    await assert.rejects(client.readOpenAIStream(new Response('data: {"choices":[{"delta":{"content":"first"}}]}\n\ndata: {"choices":')), /不完整/);
    assert.equal(await client.readOpenAIStream(new Response(': ping\n\ndata: keep-alive\n\ndata: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]')), '完成');
});

test('summary range macros include inherited source floors instead of synthetic IDs', () => {
    const prompt = renderGenerationPrompt('{{startFloor}}/{{endFloor}}/{{sourceRange}}\n{{blocks}}', [
        { messageId: Number.MAX_SAFE_INTEGER, sourceMessageIds: [12, 13, 14], title: '阶段', content: '发生的事' },
    ]);
    assert.match(prompt, /^12\/14\/楼层 12-14/);
    assert.doesNotMatch(prompt, /9007199254740991/);
});

test('embedding cache isolates same-named models at different servers', async () => {
    const state = { vectorMemory: { embeddingProvider: 'custom-openai', embeddingDimensions: 32, customApi: { model: 'same', baseUrl: 'https://first.example/v1' } } };
    let calls = 0;
    const service = createVectorMemoryService({ getState: () => state, defaultVectorMemory: { embeddingDimensions: 32 }, ...provider,
        getHash: String, compactEmbedding: x => x,
        fetchImpl: async () => { calls++; return new Response(JSON.stringify({ data: [{ embedding: [calls, 1] }] })); },
    });
    assert.deepEqual(await service.getEmbeddingForText('相同文本'), [1, 1]);
    assert.deepEqual(await service.getEmbeddingForText('相同文本'), [1, 1]);
    state.vectorMemory.customApi.baseUrl = 'https://second.example/v1';
    assert.deepEqual(await service.getEmbeddingForText('相同文本'), [2, 1]);
});

test('invalid embedding response is rejected, not converted into a zero/NaN vector', async () => {
    const state = { vectorMemory: { embeddingProvider: 'custom-openai', embeddingDimensions: 32, customApi: { model: 'embed', baseUrl: 'https://example.com/v1' } } };
    for (const embedding of [[], [null, 1], ['1', 2]]) {
        const service = createVectorMemoryService({ getState: () => state, defaultVectorMemory: { embeddingDimensions: 32 }, ...provider,
            getHash: String, compactEmbedding: x => x,
            fetchImpl: async () => new Response(JSON.stringify({ data: [{ embedding }] })),
        });
        await assert.rejects(service.getEmbeddingForText('材料'), /有效数值向量/);
    }
});

test('queue rejects source edits during generation and reports no successful drafts', async () => {
    const state = { taskQueue: [{ id: 'a', status: 'queued', prompt: 'old' }], automation: {} };
    let source = 'old';
    let created = 0;
    let message;
    const queue = createSummaryTaskQueue({ getState: () => state, setBusy: noop, toastr, saveState: noop,
        getTaskSourceSignature: () => source, renderTaskQueueProgress: noop,
        renderWorkbenchScope: (_, text) => { message = text; }, workbenchRenderScopes: {},
        callGenerationModel: async () => { source = 'edited'; return 'old result'; },
        normalizeGeneratedBakemono: x => x, createDraft: () => { created++; return {}; }, switchWorkbenchTab: noop,
    });
    await queue.processTaskQueue();
    assert.equal(created, 0);
    assert.equal(state.taskQueue[0].status, 'failed');
    assert.match(state.taskQueue[0].error, /来源正文/);
    assert.match(message, /没有生成草稿/);
});

test('removing a running task does not let its late finally clear the next task busy state', async () => {
    const state = { taskQueue: [{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }], automation: {} };
    const pending = [];
    let busy = false;
    let created = 0;
    const queue = createSummaryTaskQueue({ getState: () => state, getIsBusy: () => busy, setBusy: value => { busy = value; }, toastr,
        saveState: noop, renderTaskQueueProgress: noop, renderWorkbenchScope: noop, workbenchRenderScopes: {}, confirmDanger: () => true,
        callGenerationModel: () => new Promise(resolve => pending.push(resolve)),
        normalizeGeneratedBakemono: x => x, createDraft: () => { created++; return {}; }, switchWorkbenchTab: noop,
    });
    const old = queue.processTaskQueue();
    queue.removeQueueTask('a');
    assert.equal(pending.length, 2);
    pending[0]('discarded');
    await old;
    assert.equal(busy, true);
    assert.equal(queue.isRunning(), true);
    assert.equal(created, 0);
    pending[1]('new');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(created, 1);
    assert.equal(busy, false);
});

test('embedding connection test sends only the fixed sample and leaves index untouched', async () => {
    let input;
    const { controller, state, notices } = vectorController({ fetchCustomEmbedding: async text => { input = text; return [0.2, 0.8]; } });
    const before = JSON.stringify(state.vectorMemory.records);
    assert.equal(await controller.testEmbeddingConnection(), true);
    assert.equal(input, '连接测试');
    assert.equal(JSON.stringify(state.vectorMemory.records), before);
    assert.match(notices.join(' '), /2 维/);
});

test('model response from previous configuration is not applied to a replacement config', async () => {
    let resolve;
    const { controller, state } = vectorController({ fetchImpl: () => new Promise(r => { resolve = r; }) });
    const pending = controller.fetchVectorEmbeddingModels();
    state.vectorMemory.customApi = { baseUrl: 'https://new.example/v1', model: 'keep' };
    resolve(new Response(JSON.stringify({ data: [{ id: 'old-embedding' }] })));
    assert.equal(await pending, false);
    assert.equal(state.vectorMemory.customApi.model, 'keep');
    assert.equal(state.vectorMemory.customApi.models, undefined);
});

test('selecting stage materials across a chat switch cannot enqueue into the new chat', async () => {
    const first = { generationTargets: { stage: {} } };
    let state = first;
    let queued = 0;
    const controller = createSummaryGenerationController({ getState: () => state, getIsBusy: () => false,
        scanBlocks: noop, getUnsummarizedStoryBlocks: () => [{ hash: 'old', content: '旧聊天正文' }],
        readGenerationTargetSettings: noop,
        promptGenerationTargetSelection: async () => { state = { generationTargets: { stage: {} } }; return {}; },
        enqueueSummaryTask: () => { queued++; },
    });
    await assert.rejects(controller.generateStageDraft(), /切换聊天/);
    assert.equal(queued, 0);
});

test('title guards preserve custom summary tags containing actual story prose', () => {
    const controller = createSummaryGenerationController({ getState: () => ({ generationPrompts: { stage: '{{blocks}}' } }), renderGenerationPrompt });
    const content = '<summary>阿青在雨夜找到了失踪的信，决定次日去码头找阿白。</summary>';
    assert.match(controller.buildStageUserPrompt([{ messageId: 2, content }]), /决定次日去码头找阿白/);
});

test('single epic task carries complete inherited floor provenance like the batch path', async () => {
    const blocks = [{ type: 'stage', messageId: Number.MAX_SAFE_INTEGER, sourceMessageIds: [4, 5, 6], hash: 'stage', content: '人物结盟后前往码头。' }];
    let queued;
    const controller = createSummaryGenerationController({
        getIsBusy: () => false, scanBlocks: noop,
        getState: () => state, getUnsummarizedStageBlocks: () => blocks,
        getUnsummarizedMultiSummaryBlocks: () => [], getStoryMaterialBlocks: () => [],
        selectGenerationTargets: x => x, getNextMultiSummaryLevel: () => 1,
        getMultiSummaryLabel: () => '多次总结', getTargetSelectionLabel: () => '全部',
        renderGenerationPrompt, ...sourceMetadata,
        blockTypes: { STAGE: 'stage', EPIC: 'epic' }, enqueueSummaryTask: task => { queued = task; },
    });
    const state = { generationTargets: { epic: {} }, generationPrompts: { epic: '{{blocks}}' }, coveredBlockHashes: [] };
    await controller.generateEpicDraft({ automatic: true });
    assert.deepEqual(queued.sourceMessageIds, [4, 5, 6]);
    assert.equal(queued.metadata.sourceRange, '楼层 4-6');
    assert.equal(queued.metadata.sourceStart, 4);
    assert.equal(queued.metadata.sourceEnd, 6);
});

test('changed queued source is rejected before making a paid generation request', async () => {
    const state = { taskQueue: [], automation: {} };
    let source = 'original';
    let requests = 0;
    const queue = createSummaryTaskQueue({ getState: () => state, getHash: () => 'id', saveState: noop,
        getKindLabel: () => '摘要', getTaskSourceSignature: () => source, setBusy: noop, toastr,
        renderWorkbenchScope: noop, renderTaskQueueProgress: noop, workbenchRenderScopes: {},
        callGenerationModel: async () => { requests++; return 'wrong'; },
    });
    queue.enqueueSummaryTask({ kind: 'stage', prompt: 'old prompt', autoStart: false, silent: true });
    source = 'edited';
    await queue.processTaskQueue();
    assert.equal(requests, 0);
    assert.equal(state.taskQueue[0].status, 'failed');
    assert.match(state.taskQueue[0].error, /重新选择材料/);
});
