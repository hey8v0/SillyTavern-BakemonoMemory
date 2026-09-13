import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchNavigation } from '../src/ui/workbench-navigation.js';
import { createVectorActionsController } from '../src/features/vector-actions-controller.js';
import { createVectorSettingsModel } from '../src/features/vector-settings-model.js';
import { createConfigurationService } from '../src/features/configuration-service.js';

test('saving another configuration page preserves committed vector settings', () => {
    const state = { vectorMemory: { enabled: true, customApi: { model: 'saved' } } };
    const service = createConfigurationService({ getState: () => state, query: () => ({ length: 0 }),
        readVectorMemoryFieldsFromUi() { throw new Error('hidden vector form read'); } });
    service.readConfigFieldsFromUi(state);
    assert.equal(state.vectorMemory.customApi.model, 'saved');
});

test('resize events are not interpreted as DOM scopes', () => {
    const oldDocument = globalThis.document;
    const oldWindow = globalThis.window;
    let visited = 0;
    globalThis.document = { getElementById: () => ({ querySelectorAll: () => { visited++; return []; } }) };
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    try {
        const navigation = createWorkbenchNavigation();
        navigation.syncMobileCollapsibles(new Event('resize'));
        navigation.syncMobileCollapsibles();
        assert.equal(visited, 2);
    } finally {
        globalThis.document = oldDocument;
        globalThis.window = oldWindow;
    }
});

test('applying vector settings does not run retrieval before saving', async () => {
    let saved = 0;
    const state = { vectorMemory: { enabled: true, records: [{}], lastIndexedSignature: 'same' } };
    const controller = createVectorActionsController({
        getState: () => state, readVectorMemoryFieldsFromUi() {},
        getVectorSourceSignature: () => 'same',
        retrieveVectorMemoryHits: async () => { throw new Error('must not query'); },
        persistSharedConfigurationFromState: () => saved++,
        saveChatConditional: async () => {}, syncInjection() {}, renderWorkbenchScope() {},
        workbenchRenderScopes: { VECTOR: 'vector' },
    });
    await controller.applyVectorMemorySettings();
    assert.equal(saved, 1);
});

test('the vector toggle never reads other form fields', async () => {
    const state = { vectorMemory: { enabled: false, customApi: { model: 'keep' } } };
    const controller = createVectorActionsController({
        getState: () => state,
        query: () => ({ prop: () => true }),
        readVectorMemoryFieldsFromUi() { throw new Error('toggle read whole form'); },
        persistSharedConfigurationFromState() {}, markVectorIndexDirty() {},
        saveChatConditional: async () => {}, syncInjection() {}, renderWorkbenchScope() {},
        workbenchRenderScopes: { VECTOR: 'vector' },
    });
    await controller.persistVectorEnabledFromUi();
    assert.equal(state.vectorMemory.enabled, true);
    assert.equal(state.vectorMemory.customApi.model, 'keep');
});

test('vector forms reject another chat and a newer configuration revision', () => {
    const a = { activeConfigSignature: 'one', vectorMemory: {} };
    const b = { activeConfigSignature: 'one', vectorMemory: {} };
    let current = a;
    const model = createVectorSettingsModel({ getState: () => current });
    assert.throws(() => model.assertVectorFormCurrent(), /重新打开/);
    model.markVectorFormRendered(a);
    assert.equal(model.canKeepVectorForm(a), true);
    assert.doesNotThrow(() => model.assertVectorFormCurrent());
    current = b;
    assert.equal(model.canKeepVectorForm(b), false);
    assert.throws(() => model.assertVectorFormCurrent(), /重新打开/);
    current = a;
    a.activeConfigSignature = 'two';
    assert.equal(model.canKeepVectorForm(a), false);
    assert.throws(() => model.assertVectorFormCurrent(), /重新打开/);
});

test('vector fields retain deliberate zero, false, and empty tag settings', () => {
    const values = new Map([
        ['#bakemono-memory-vector-enabled', false],
        ['#bakemono-memory-vector-overlap', '0'],
        ['#bakemono-memory-vector-exclude-tags', ''],
    ]);
    const state = { vectorMemory: {} };
    const model = createVectorSettingsModel({
        getState: () => state,
        defaultVectorMemory: { overlap: 120, excludeTags: 'thinking', customApi: {}, queryCustomApi: {} },
        query: selector => ({
            length: 1, val: () => values.get(selector), prop: () => values.get(selector) ?? false,
        }),
    });
    model.markVectorFormRendered(state);
    model.readVectorMemoryFieldsFromUi(state);
    assert.equal(state.vectorMemory.overlap, 0);
    assert.equal(state.vectorMemory.excludeTags, '');
    assert.equal(state.vectorMemory.enabled, false);
});

test('recall testing never commits hidden or unsubmitted settings', async () => {
    const state = { vectorMemory: { enabled: true, records: [{}] } };
    const controller = createVectorActionsController({
        getState: () => state, query: () => ({ val: () => '线索' }),
        readVectorMemoryFieldsFromUi() { throw new Error('must not read form'); },
        retrieveVectorMemoryHits: async (_query, value) => { assert.equal(value, state); return []; },
        saveState() {}, syncInjection() {}, renderWorkbenchScope() {}, workbenchRenderScopes: {},
    });
    await controller.testVectorMemoryRetrieval();
});

test('invalid numeric fields cannot partially replace configuration; absent fields and caches survive', () => {
    const values = new Map([['enabled', true], ['overlap', 'bad']]);
    const state = { vectorMemory: { overlap: 12, includeHidden: true, customApi: { model: 'keep' }, embeddingCache: { keep: [1] } } };
    const model = createVectorSettingsModel({ getState: () => state, defaultVectorMemory: {},
        query: selector => { const key = selector.replace('#bakemono-memory-vector-', '');
            return { length: values.has(key) ? 1 : 0, val: () => values.get(key), prop: () => values.get(key) }; } });
    model.markVectorFormRendered(state);
    const original = state.vectorMemory;
    assert.throws(() => model.readVectorMemoryFieldsFromUi(), /数值/);
    assert.equal(state.vectorMemory, original);
    values.set('overlap', '0');
    model.readVectorMemoryFieldsFromUi();
    assert.equal(state.vectorMemory.overlap, 0);
    assert.equal(state.vectorMemory.includeHidden, true);
    assert.equal(state.vectorMemory.customApi.model, 'keep');
    assert.equal(state.vectorMemory.embeddingCache, original.embeddingCache);
    values.set('overlap', '15');
    const draft = model.readVectorFormDraft(state);
    assert.equal(draft.vectorMemory.overlap, 15);
    assert.equal(state.vectorMemory.overlap, 0);
});

test('embedding connection test uses a draft without committing settings', async () => {
    const state = { vectorMemory: { customApi: { model: 'saved' } } };
    const draft = { vectorMemory: { customApi: { model: 'draft' } } };
    const controller = createVectorActionsController({ getState: () => state,
        readVectorFormDraft: () => draft,
        readVectorMemoryFieldsFromUi() { throw new Error('must not commit'); },
        persistSharedConfigurationFromState() { throw new Error('must not save'); },
        fetchCustomEmbedding: async (_text, value) => { assert.equal(value, draft); return [1, 2]; },
        toastr: { success() {}, error(message) { throw new Error(message); } },
    });
    assert.equal(await controller.testEmbeddingConnection(), true);
    assert.equal(state.vectorMemory.customApi.model, 'saved');
});

test('model lists use draft endpoints without committing and reject stale form responses', async () => {
    for (const kind of ['embedding', 'query']) for (const stale of [false, true]) {
        const state = { activeConfigSignature: 'one', vectorMemory: { customApi: { baseUrl: 'saved' }, queryCustomApi: { model: '' } } };
        const before = JSON.stringify(state);
        let draft = { vectorMemory: { customApi: { baseUrl: 'draft', apiKey: 'draft-key' }, queryCustomApi: { baseUrl: 'rewrite', apiKey: 'rewrite-key' } } };
        let rendered = null;
        const controller = createVectorActionsController({ getState: () => state,
            readVectorFormDraft: () => structuredClone(draft),
            readVectorMemoryFieldsFromUi() { throw new Error('must not commit'); },
            persistSharedConfigurationFromState() { throw new Error('must not save'); },
            normalizeCustomApiBaseUrl: String, getCustomModelsUrl: value => value + '/models',
            extractCustomModelIds: data => data.models, extractEmbeddingModelCandidates: data => data.models,
            renderVectorModelOptions: value => { rendered = value; }, renderVectorQueryModelOptions: value => { rendered = value; },
            toastr: { info() {}, warning() {}, error() {}, success() {}, clear() {} },
            fetchImpl: async (url, options) => {
                assert.equal(url, (kind === 'embedding' ? 'draft' : 'rewrite') + '/models');
                assert.equal(options.headers.Authorization, 'Bearer ' + (kind === 'embedding' ? 'draft-key' : 'rewrite-key'));
                if (stale) draft.vectorMemory.customApi.baseUrl = 'changed';
                return { ok: true, json: async () => ({ models: ['candidate'] }) };
            },
        });
        const result = await controller[kind === 'embedding' ? 'fetchVectorEmbeddingModels' : 'fetchVectorQueryModels']();
        assert.equal(result, !stale);
        assert.deepEqual(rendered, stale ? null : ['candidate']);
        assert.equal(JSON.stringify(state), before);
    }
});
