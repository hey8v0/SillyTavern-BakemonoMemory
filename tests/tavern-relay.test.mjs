import test from 'node:test';
import assert from 'node:assert/strict';
import * as provider from '../src/vector/provider-config.js';
import { createGenerationClient } from '../src/features/generation-client.js';

// A reported setup: 智谱 refuses browser requests (Failed to fetch), so the request goes through SillyTavern's server.
const zhipu = 'https://open.bigmodel.cn/api/paas/v4';
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: '', headers: { get: () => null }, json: async () => body });
const quiet = { info: () => 'toast', success: () => {}, warning: () => {}, error: (...args) => quiet.errors.push(args), clear: () => {}, errors: [] };

function client(customApi, reply) {
    const calls = [], rendered = [];
    const state = { activeConfigSignature: 'one', automation: { apiProvider: 'custom', customApi } };
    const generation = createGenerationClient({ ...provider, ensureState: () => state, defaultAutomation: { customApi: { temperature: 0.7, maxTokens: 3000 } },
        getTavernHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' }),
        readCustomApiFieldsFromUi: draft => { draft.automation.customApi = structuredClone(customApi); },
        renderCustomModelOptions: models => rendered.push(models), toastr: quiet,
        fetchImpl: async (url, init) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); return reply(url); } });
    return { generation, calls, rendered };
}

test('the root SillyTavern adds its own paths to is the address without the endpoint', () => {
    assert.equal(provider.getCustomApiRootUrl(zhipu), zhipu);
    assert.equal(provider.getCustomApiRootUrl(zhipu + '/chat/completions/'), zhipu);
    assert.equal(provider.getCustomChatCompletionsUrl(zhipu), zhipu + '/chat/completions', 'no /v1 is added when calling directly');
    assert.throws(() => provider.getCustomApiRootUrl('ftp://example.com'), /http/);
});

test('with 经酒馆后端转发 the summary request is sent to SillyTavern with the plugin\'s own key', async () => {
    const f = client({ baseUrl: zhipu + '/chat/completions', apiKey: 'zp-key', model: 'glm-5.3-flashx', viaTavern: true },
        () => json({ choices: [{ message: { content: '摘要' }, finish_reason: 'stop' }] }));
    assert.equal(await f.generation.callGenerationModel({ prompt: '正文', systemPrompt: '规则' }), '摘要');
    const [call] = f.calls;
    assert.equal(call.url, '/api/backends/chat-completions/generate');
    assert.equal(call.init.headers['X-CSRF-Token'], 'csrf');
    assert.equal(call.init.headers.Authorization, undefined, 'the key never goes to SillyTavern as its own auth');
    assert.equal(call.body.chat_completion_source, 'custom');
    assert.equal(call.body.custom_url, zhipu);
    assert.deepEqual(JSON.parse(call.body.custom_include_headers), { Authorization: 'Bearer zp-key' });
    assert.equal(call.body.model, 'glm-5.3-flashx');
    assert.deepEqual(call.body.messages.map(m => m.role), ['system', 'user']);
});

test('without a key the relayed header is empty, so SillyTavern\'s stored custom key is not sent', async () => {
    const f = client({ baseUrl: zhipu, apiKey: '', model: 'm', viaTavern: true }, () => json({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }));
    await f.generation.callGenerationModel({ prompt: 'p' });
    assert.deepEqual(JSON.parse(f.calls[0].body.custom_include_headers), { Authorization: '' });
});

test('an upstream failure SillyTavern reports with status 200 is an error, not an empty summary', async () => {
    const f = client({ baseUrl: zhipu, apiKey: 'k', model: 'm', viaTavern: true }, () => json({ error: { message: 'Unauthorized' } }));
    await assert.rejects(f.generation.callGenerationModel({ prompt: 'p' }), /经酒馆转发.*Unauthorized/);
});

test('拉取模型 goes through SillyTavern too, and its failure is reported', async () => {
    let answer = json({ data: [{ id: 'glm-5.3-flashx' }, { id: 'glm-5.2' }] });
    const f = client({ baseUrl: zhipu, apiKey: 'zp-key', model: 'glm-5.3-flashx', viaTavern: true }, () => answer);
    assert.equal(await f.generation.fetchCustomApiModels(), true);
    assert.equal(f.calls[0].url, '/api/backends/chat-completions/status');
    assert.equal(f.calls[0].init.method, 'POST');
    assert.equal(f.calls[0].body.custom_url, zhipu);
    assert.deepEqual(f.rendered[0], ['glm-5.2', 'glm-5.3-flashx']);
    answer = json({ error: true, data: { data: [] } });
    assert.equal(await f.generation.fetchCustomApiModels(), false);
    assert.match(quiet.errors.at(-1)[0], /经酒馆转发/);
});

test('direct requests are unchanged when the switch is off', async () => {
    const f = client({ baseUrl: zhipu, apiKey: 'zp-key', model: 'm' }, () => json({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }));
    await f.generation.callGenerationModel({ prompt: 'p' });
    assert.equal(f.calls[0].url, zhipu + '/chat/completions');
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer zp-key');
    assert.equal(f.calls[0].body.chat_completion_source, undefined);
});
