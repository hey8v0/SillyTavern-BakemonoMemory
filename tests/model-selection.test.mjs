import test from 'node:test';
import assert from 'node:assert/strict';
import * as provider from '../src/vector/provider-config.js';
import { createGenerationClient } from '../src/features/generation-client.js';
import { createVectorActionsController } from '../src/features/vector-actions-controller.js';

const personal = 'https://qianfan.baidubce.com/v2/tokenplan/personal';
const noop = () => {};
function notices() {
    const messages = [];
    return { messages, toastr: Object.fromEntries(['info', 'warning', 'success', 'error', 'clear'].map(key => [key, text => messages.push([key, text])])) };
}

test('Qianfan personal catalog is scoped to its official OpenAI endpoint and retains the subscription route', () => {
    for (const suffix of ['', '/', '/models', '/chat/completions/']) {
        const catalog = provider.getQianfanPersonalModelCatalog(personal + suffix);
        assert.equal(catalog.source, 'official-catalog');
        assert.ok(catalog.models.includes('qianfan-code-latest'));
        assert.ok(catalog.models.includes('deepseek-v4-pro'));
        assert.match(catalog.notice, /未验证.*密钥/);
        assert.equal(provider.getCustomChatCompletionsUrl(personal + suffix), personal + '/chat/completions');
    }
    for (const base of ['https://qianfan.baidubce.com/v2', personal.replace('/personal', '/enterprise'),
        personal.replace('qianfan.baidubce.com', 'qianfan.baidubce.com.example.org'), 'https://proxy.example/v2/tokenplan/personal']) {
        assert.equal(provider.getQianfanPersonalModelCatalog(base), null);
    }
    assert.throws(() => provider.getQianfanPersonalModelCatalog(personal, 'embedding'), /不提供嵌入/);
    assert.throws(() => provider.getQianfanPersonalModelCatalog(personal.replace('/v2/', '/anthropic/')), /OpenAI/);
});

function generationFixture(baseUrl = personal) {
    const state = { activeConfigSignature: 'one', automation: { apiProvider: 'custom', customApi: { baseUrl, model: 'keep-model', apiKey: 'saved-key', models: ['old'] } } };
    let form = { ...state.automation.customApi, apiKey: 'draft-key' };
    const logs = notices(), rendered = [];
    let fetchImpl = async () => { throw Error('must not call an undocumented models endpoint'); };
    const client = createGenerationClient({ ...provider, ensureState: () => state,
        readCustomApiFieldsFromUi: draft => { draft.automation.customApi = structuredClone(form); },
        persistSharedConfigurationFromState: () => { throw Error('model discovery must not save configuration'); },
        query: () => ({ val: () => form.model }),
        renderCustomModelOptions: models => rendered.push(models),
        fetchImpl: (...args) => fetchImpl(...args), toastr: logs.toastr,
    });
    return { client, state, logs, rendered, setForm: value => { form = { ...form, ...value }; }, setFetch: value => { fetchImpl = value; } };
}

test('generation model discovery loads personal candidates without validating credentials or changing selected model', async () => {
    const f = generationFixture(), before = JSON.stringify(f.state);
    assert.equal(await f.client.fetchCustomApiModels(), true);
    assert.ok(f.rendered[0].includes('qianfan-code-latest'));
    assert.equal(JSON.stringify(f.state), before);
    assert.ok(f.logs.messages.some(([, message]) => /官方.*候选/.test(message)));
    assert.ok(!f.logs.messages.some(([kind]) => kind === 'success'));
});

test('query model discovery uses the personal catalog while embeddings reject it without network or settings writes', async () => {
    for (const embedding of [false, true]) {
        const state = { vectorMemory: { customApi: { baseUrl: personal, apiKey: 'key', model: 'keep' }, queryCustomApi: { model: 'query-keep' } } };
        const before = JSON.stringify(state), logs = notices();
        let rendered;
        const controller = createVectorActionsController({ ...provider, getState: () => state, toastr: logs.toastr,
            fetchImpl: () => { throw Error('network must not be used for a catalog'); },
            renderVectorModelOptions: models => { rendered = models; }, renderVectorQueryModelOptions: models => { rendered = models; },
        });
        assert.equal(await controller[embedding ? 'fetchVectorEmbeddingModels' : 'fetchVectorQueryModels'](), !embedding);
        assert.equal(JSON.stringify(state), before);
        if (embedding) { assert.equal(rendered, undefined); assert.ok(logs.messages.some(([, message]) => /不提供嵌入/.test(message))); }
        else assert.ok(rendered.includes('qianfan-code-latest'));
    }
});

test('generation discovery keeps generic authentication failures visible and preserves prior candidates', async () => {
    const f = generationFixture('https://example.test/v1');
    f.setFetch(async (url, init) => {
        assert.equal(url, 'https://example.test/v1/models');
        assert.equal(init.headers.Authorization, 'Bearer draft-key');
        return { ok: false, status: 401 };
    });
    assert.equal(await f.client.fetchCustomApiModels(), false);
    assert.equal(f.rendered.length, 0);
    assert.ok(f.logs.messages.some(([, message]) => /401/.test(message)));
});

test('generation discovery ignores stale form and superseded responses', async () => {
    for (const mode of ['form', 'newer', 'config']) {
        const f = generationFixture('https://example.test/v1'), pending = [];
        f.setFetch(() => new Promise(resolve => pending.push(resolve)));
        const first = f.client.fetchCustomApiModels();
        let second;
        if (mode === 'form') f.setForm({ baseUrl: 'https://other.test/v1' });
        if (mode === 'config') f.state.activeConfigSignature = 'two';
        if (mode === 'newer') {
            second = f.client.fetchCustomApiModels();
            pending[1]({ ok: true, json: async () => ({ data: [{ id: 'new-model' }] }) });
            assert.equal(await second, true);
        }
        pending[0]({ ok: true, json: async () => ({ data: [{ id: 'old-model' }] }) });
        assert.equal(await first, false);
        assert.deepEqual(f.rendered, mode === 'newer' ? [['new-model']] : []);
    }
});

test('personal generation sends the selected model only to the personal chat route', async () => {
    let calls = 0;
    const state = { automation: { apiProvider: 'custom', customApi: { baseUrl: personal, apiKey: 'personal-key', model: 'glm-5.2', stream: false } } };
    const client = createGenerationClient({ ...provider, ensureState: () => state,
        defaultAutomation: { customApi: { temperature: 0.7, maxTokens: 512 } },
        fetchImpl: async (url, init) => {
            calls++;
            assert.equal(url, personal + '/chat/completions');
            assert.equal(init.headers.Authorization, 'Bearer personal-key');
            assert.equal(JSON.parse(init.body).model, 'glm-5.2');
            return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'fixture result' } }] }) };
        },
    });
    assert.equal(await client.callGenerationModel({ prompt: 'fixture' }), 'fixture result');
    assert.equal(calls, 1);
});
