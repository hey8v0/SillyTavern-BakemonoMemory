import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summaryMaterialBudget } from '../src/summary/length-target.js';
import { isContextOverflow, explainContextOverflow } from '../src/summary/request-overflow.js';
import { createSummaryTaskQueue } from '../src/features/summary-task-queue.js';
import { createGenerationClient } from '../src/features/generation-client.js';
import { createSummaryGenerationController } from '../src/features/summary-generation-controller.js';
import { runApiRequest } from '../src/shared/request-policy.js';
import { selectGenerationTargets, partitionGenerationTargets } from '../src/summary/target-selection.js';
import * as provider from '../src/vector/provider-config.js';

// A 多次总结 over every chapter at once, on a long chat, is longer than the model can read. The provider refuses it
// ("maximum context length…"), and the user read only that, with nothing to say what to change. The automation takes
// a batch sized to what one request can carry, the panel says when a selection is too long, and a refusal for length
// says where to make the batches smaller.

// What the providers say, as seen.
const refusals = {
    deepseek: "This model's maximum context length is 65536 tokens. However, you requested 70123 tokens (66027 in the messages, 4096 in the completion). Please reduce the length of the messages or completion.",
    openai: "This model's maximum context length is 128000 tokens. However, your messages resulted in 131072 tokens. Please reduce the length of the messages.",
    code: 'context_length_exceeded',
    anthropic: 'prompt is too long: 210345 tokens > 200000 maximum',
    gemini: 'The input token count (1100000) exceeds the maximum number of tokens allowed (1048576).',
    mistral: 'Prompt contains 40000 tokens and 0 draft tokens, too large for model with 32768 maximum context length',
    kimi: 'Invalid request: Your request exceeded model token limit: 8192',
    qwen: '<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 30720]',
    glm: 'Prompt 超过最大长度限制',
    relay: '请求的上下文长度超出模型限制',
    llamacpp: 'the request exceeds the available context size, try increasing it',
};
// Failures that are not about length, some of them about other limits.
const others = [
    '模型输出达到长度上限，结果可能被截断；请减小批次，或提高输出上限后重试。',
    'max_tokens is too large: 100000. This model supports at most 8192 completion tokens',
    'Incorrect API key provided',
    'Rate limit reached for requests',
    '接口等待超时，本次未自动重发；请确认服务商状态后重试。',
    '自定义 API 请求失败：401。认证失败，请检查此接口的密钥；只填密钥本身，不要附加 Bearer。',
];

test('a refusal for length is told from other failures, in the words of each provider', () => {
    for (const [name, message] of Object.entries(refusals)) assert.ok(isContextOverflow(message), name);
    for (const message of others) assert.ok(!isContextOverflow(message), message);
});

test('the advice says where to change it, by what was asked for; what the provider said follows it', () => {
    const epic = explainContextOverflow(refusals.deepseek, 'epic');
    assert.match(epic, /^多次总结的材料太长/);
    assert.match(epic, /“生成多次总结”，在“生成几条”里选“分批”/);
    assert.match(epic, /原来的报错：This model's maximum context length is 65536 tokens/);
    assert.match(explainContextOverflow(refusals.glm, 'stage'), /^阶段总结的材料太长[\s\S]*“生成几章”里选“分批”/);
    assert.match(explainContextOverflow(refusals.anthropic, 'story'), /^补写时一次发的楼层太长/);
    assert.match(explainContextOverflow(refusals.gemini, 'facts'), /^这次发给模型的内容太长/);
    // A custom API failure carries the provider's words after its own generic advice: only those are quoted.
    const custom = explainContextOverflow(`自定义 API 请求失败：400。请检查接口配置和服务商状态。接口原话：${refusals.openai}`, 'epic');
    assert.doesNotMatch(custom, /请检查接口配置/);
    assert.match(custom, /接口原话：This model's maximum context length is 128000/);
    assert.ok(explainContextOverflow('context_length_exceeded '.repeat(40), 'epic').endsWith('…'), 'a long one is cut short');
    for (const message of others) assert.equal(explainContextOverflow(message, 'epic'), message, 'any other failure goes on as it was');
});

test('in the queue: a 多次总结 refused for length fails with the advice, the toast says the same, nothing is saved', async () => {
    const toasts = [], noop = () => {};
    const state = { taskQueue: [{ id: 'a', status: 'queued', kind: 'epic', label: '多次总结 · 38 个片段', prompt: 'p', sourceHashes: ['st0', 'st1'] }], drafts: [], automation: {}, storySummaries: [] };
    const queue = createSummaryTaskQueue({ getState: () => state, getHash: String, getKindLabel: String, saveState: noop, setBusy: noop, renderTaskQueueProgress: noop,
        renderWorkbenchScope: noop, workbenchRenderScopes: {}, toastr: { error: (...args) => toasts.push(args), info: noop, success: noop, warning: noop, clear: noop }, switchWorkbenchTab: noop,
        normalizeGeneratedBakemono: String, blockTypes: { STAGE: 'stage', EPIC: 'epic' }, createDraft: () => { throw new Error('a refusal makes no draft'); },
        callGenerationModel: async () => { throw new Error(refusals.deepseek); },
        // As index.js wires it.
        explainFailure: (error, task) => explainContextOverflow(error?.message || String(error), task?.kind) });
    await queue.processTaskQueue();
    const task = state.taskQueue[0];
    assert.equal(task.status, 'failed');
    assert.match(task.error, /^多次总结的材料太长[\s\S]*选“分批”[\s\S]*原来的报错：This model's maximum context length/);
    assert.equal(toasts[0][0], task.error);
    assert.equal(state.drafts.length, 0);
    // Without the wiring the queue says what it always said.
    const plain = { taskQueue: [{ id: 'b', status: 'queued', kind: 'epic', label: 'x', prompt: 'p' }], drafts: [], automation: {}, storySummaries: [] };
    await createSummaryTaskQueue({ getState: () => plain, getHash: String, getKindLabel: String, saveState: noop, setBusy: noop, renderTaskQueueProgress: noop,
        renderWorkbenchScope: noop, workbenchRenderScopes: {}, toastr: { error: noop, info: noop, success: noop, warning: noop, clear: noop }, switchWorkbenchTab: noop,
        normalizeGeneratedBakemono: String, blockTypes: {}, createDraft: noop, callGenerationModel: async () => { throw new Error(refusals.deepseek); } }).processTaskQueue();
    assert.equal(plain.taskQueue[0].error, refusals.deepseek);
});

test('a custom API refusing for length: its words reach the user, and the request is not sent a second time', async () => {
    const client = (customApi, respond) => {
        const calls = [];
        return { calls, client: createGenerationClient({ ...provider, getTavernHeaders: () => ({}),
            ensureState: () => ({ automation: { apiProvider: 'custom', customApi: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', ...customApi } } }),
            defaultAutomation: { customApi: { temperature: 0.5, maxTokens: 4096 } },
            fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return respond(); } }) };
    };
    const direct = client({}, () => new Response(JSON.stringify({ error: { message: refusals.deepseek, type: 'invalid_request_error' } }), { status: 400 }));
    const error = await direct.client.callGenerationModel({ prompt: 'p' }).catch(failure => failure);
    assert.equal(direct.calls.length, 1, 'refused for length: asking again without the thinking switch would only cost');
    assert.deepEqual(direct.calls[0].thinking, { type: 'disabled' });
    assert.match(error.message, /^自定义 API 请求失败：400。[\s\S]*接口原话：This model's maximum context length is 65536 tokens/);
    assert.match(explainContextOverflow(error.message, 'epic'), /^多次总结的材料太长[\s\S]*接口原话：This model's maximum/);
    // Through the relay the same refusal comes as 200 with { error }.
    const relay = client({ viaTavern: true }, () => new Response(JSON.stringify({ error: { message: refusals.deepseek } })));
    await assert.rejects(relay.client.callGenerationModel({ prompt: 'p' }), /maximum context length/);
    assert.equal(relay.calls.length, 1);
    // A 400 for anything else still gets the one retry without the switch (facts-request.test.mjs).
    let first = true;
    const other = client({}, () => { if (first) { first = false; return new Response('unknown field thinking', { status: 400 }); } return new Response(JSON.stringify({ choices: [{ message: { content: '好' }, finish_reason: 'stop' }] })); });
    assert.equal(await other.client.callGenerationModel({ prompt: 'p' }), '好');
    assert.equal(other.calls.length, 2);
});

test('a refused request carries what the provider said, short; nothing when there is nothing to read', async () => {
    const said = response => runApiRequest({ fetchImpl: async () => response, formatError: (r, detail) => `${r.status}|${detail}` }).catch(error => error.message);
    assert.equal(await said(new Response(JSON.stringify({ error: { message: 'too long' } }), { status: 400 })), '400|too long');
    assert.equal(await said(new Response(JSON.stringify({ detail: [{ msg: 'field required' }] }), { status: 422 })), '422|[{"msg":"field required"}]');
    assert.equal(await said(new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', { status: 502 })), '502|502 Bad Gateway');
    assert.equal((await said(new Response('x'.repeat(1000), { status: 400 }))).length, '400|'.length + 300);
    assert.equal(await said({ ok: false, status: 400, headers: { get: () => null } }), '400|');
    assert.equal(provider.formatApiFailure({ status: 400 }, '自定义 API 请求失败'), '自定义 API 请求失败：400。请检查接口配置和服务商状态。', 'callers that pass no words get what they always got');
});

test('what one request can carry: by the model window, as for 32k where the window cannot be read', () => {
    assert.equal(summaryMaterialBudget(0), 13107);
    assert.equal(summaryMaterialBudget(32768), 13107);
    assert.equal(summaryMaterialBudget(128000), 51200);
    assert.equal(summaryMaterialBudget(1048576), 60000, 'a very long window is not one very long request');
    assert.equal(summaryMaterialBudget(4096), 4000);
});

test('the panel is told when one request of the selection is too long; batches that fit are not flagged', async () => {
    const stages = Array.from({ length: 12 }, (_, i) => ({ hash: `st${i}`, id: `st${i}`, type: 'stage', sourceMessageIds: [i * 20 + 2, i * 20 + 20], content: '长'.repeat(3000) }));
    const state = { generationTargets: { epic: { mode: 'all', count: 5 } }, generationPrompts: { epic: '{{blocks}}' }, storySummaries: [], stageSummaries: stages, epicSummaries: [], blocks: [], taskQueue: [], drafts: [] };
    let seen = null;
    const controller = createSummaryGenerationController({
        getIsBusy: () => false, scanBlocks() {}, getState: () => state, readGenerationTargetSettings() {},
        getUnsummarizedStageBlocks: () => stages, getUnsummarizedMultiSummaryBlocks: () => [],
        promptGenerationTargetSelection: async (kind, total, options) => { seen = options; return null; },
        selectGenerationTargets, partitionGenerationTargets, getMultiSummaryLabel: () => '多次总结',
        getSourceMessageIdsFromBlocks: list => list.flatMap(block => block.sourceMessageIds),
        formatSourceRange: ids => `${Math.min(...ids)}-${Math.max(...ids)}`, getSourceStart: ids => Math.min(...ids), getSourceEnd: ids => Math.max(...ids),
        renderGenerationPrompt: (_, list) => list.map(block => block.content).join('\n'),
        blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' }, defaultGenerationTargets: { epic: { count: 5 } },
        renderWorkbenchScope() {}, workbenchRenderScopes: {}, toastr: { info() {}, warning() {}, success() {} },
        getMaterialBudget: () => 13107,
    });
    await controller.generateEpicDraft();
    assert.equal(seen.describe({ mode: 'all', sourceMode: 'stage', batch: false }).tooLong, 36000, 'all twelve in one: the default');
    assert.equal(seen.describe({ mode: 'all', sourceMode: 'stage', batch: true, count: 4 }).tooLong, 0, 'four of 3,000 fit');
    assert.equal(seen.describe({ mode: 'all', sourceMode: 'stage', batch: true, count: 5 }).tooLong, 15000, 'the longest batch is the one told');
    assert.equal(seen.describe({ mode: 'oldest', sourceMode: 'stage', batch: false, count: 3 }).tooLong, 0);
});

test('wired: the budget reaches the automation and the panel, the advice the queue; the panel shows the warning', () => {
    const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const index = read('index.js');
    assert.match(index, /function summaryMaterialChars\(\) \{\s*return summaryMaterialBudget\(ensureState\(\)\.automation\?\.apiProvider === 'custom' \? 0 : hostContextTokens\(\)\);/);
    assert.equal((index.match(/getMaterialBudget: summaryMaterialChars,/g) || []).length, 2, 'the automation and the panel');
    assert.match(index, /explainFailure: \(error, task\) => explainContextOverflow\(error\?\.message \|\| String\(error\), task\?\.kind\)/);
    const dialog = read('src/features/summary-target-controller.js');
    assert.match(dialog, /<p class="bk-dlg-gap" data-gen-long hidden><\/p>/);
    assert.match(dialog, /long\.hidden = !info\?\.tooLong;/);
});
