import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { helpGuideArticles, helpGuideCategories } from '../src/features/help-guide-content.js';
import { createHelpGuide } from '../src/features/help-guide.js';
import { createVectorActionsController } from '../src/features/vector-actions-controller.js';
import { createVectorMemoryService } from '../src/features/vector-memory-service.js';

const noop = () => {};
test('detailed manual is complete, separately navigable, and retains the brief guides', () => {
    assert.ok(helpGuideArticles['quick-start']);
    assert.ok(helpGuideCategories.manual?.length >= 9);
    for (const id of helpGuideCategories.manual) {
        const article = helpGuideArticles[id];
        assert.equal(article.category, '详细手册');
        assert.ok(article.steps.length >= 5, id);
        assert.ok(article.steps.every(([title, copy]) => title && copy));
    }
    const ids = Object.values(helpGuideCategories).flat();
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every(id => helpGuideArticles[id]));
});

test('detailed entry lives inside the help panel and sample markup is escaped in the reader', async () => {
    const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    const helpStart = html.indexOf('data-bakemono-panel="help"');
    const entry = html.indexOf('data-bakemono-help-category="manual"');
    assert.ok(entry > helpStart);
    assert.equal(html.match(/data-bakemono-help-category="manual"/g)?.length, 1);
    const source = await readFile(new URL('../src/features/help-guide.js', import.meta.url), 'utf8');
    assert.match(source, /escapeHtml\(copy\)/);
});

function vectorActions(vm, overrides = {}) {
    const calls = [];
    const state = { vectorMemory: vm };
    const controller = createVectorActionsController({ getState: () => state,
        query: () => ({ val: () => '旧约定' }), readVectorMemoryFieldsFromUi: noop,
        toastr: { warning: text => calls.push(text), info: noop },
        renderWorkbenchScope: (_, text) => calls.push(text), workbenchRenderScopes: {},
        saveState: noop, syncInjection: noop, ...overrides,
    });
    return { controller, calls, state };
}

test('disabled retrieval explains the switch and does not call the API', async () => {
    let requests = 0;
    const { controller, calls } = vectorActions({ enabled: false, records: [{}] }, {
        retrieveVectorMemoryHits: async () => { requests++; return []; },
    });
    assert.equal(await controller.testVectorMemoryRetrieval(), false);
    assert.equal(requests, 0);
    assert.match(calls.join(' '), /召回.*关闭/);
});

test('skipped retrieval does not report a successful test', async () => {
    const vm = { enabled: true, records: [{}] };
    const { controller } = vectorActions(vm, { retrieveVectorMemoryHits: async () => {
        vm.lastRecallSkippedReason = '索引已变化，请刷新索引'; return [];
    } });
    assert.equal(await controller.testVectorMemoryRetrieval(), false);
});

function vectorIndex() {
    const state = { vectorMemory: { enabled: true, autoIndex: true, embeddingProvider: 'local', records: [{}], lastHits: [{ id: 'hit' }] },
        storySummaries: [], stageSummaries: [], epicSummaries: [], coveredBlockHashes: [] };
    const calls = [];
    const service = createVectorMemoryService({ getState: () => state,
        getContext: () => ({ chat: [] }), defaultVectorMemory: { embeddingDimensions: 64 },
        getActiveCoveredStageHashes: () => new Set(), getActiveEpicMemoryBlocks: () => [],
        memoryStrategies: {}, getHash: String, saveState: () => calls.push('save'),
        setTimer: () => { calls.push('timer'); return 1; }, clearTimer: noop,
    });
    return { state, calls, service };
}

test('unchanged foreground resume preserves current index and hits without scheduling work', () => {
    const { state, calls, service } = vectorIndex();
    state.vectorMemory.lastIndexedSignature = service.getVectorSourceSignature(state);
    service.markVectorIndexDirty('窗口恢复', state);
    assert.notEqual(state.vectorMemory.dirty, true);
    assert.deepEqual(state.vectorMemory.lastHits, [{ id: 'hit' }]);
    assert.deepEqual(calls, []);
});

test('chunk configuration changes invalidate the index and schedule a refresh', () => {
    const { state, calls, service } = vectorIndex();
    const previous = service.getVectorSourceSignature(state);
    state.vectorMemory.lastIndexedSignature = previous;
    state.vectorMemory.chunkSize = 800;
    assert.notEqual(service.getVectorSourceSignature(state), previous);
    service.markVectorIndexDirty('配置变更', state);
    assert.equal(state.vectorMemory.dirty, true);
    assert.deepEqual(state.vectorMemory.lastHits, []);
    assert.ok(calls.includes('timer'));
});

test('manual reader escapes tag examples and returns to the detailed chapter list', () => {
    const nodes = new Map();
    function node(key) {
        if (!nodes.has(key)) nodes.set(key, {
            dataset: {}, hidden: false, attrs: {}, textContent: '', innerHTML: '',
            classList: { toggle: noop }, setAttribute(name, value) { this.attrs[name] = value; },
            querySelector: selector => node(`${key}:${selector}`), focus: noop, scrollTo: noop,
        });
        return nodes.get(key);
    }
    const categories = Object.keys(helpGuideCategories).map(category => {
        const button = node(`[data-bakemono-help-category="${category}"]`);
        button.dataset.bakemonoHelpCategory = category;
        return button;
    });
    const documentRef = { getElementById: node, querySelector: node, querySelectorAll: () => categories };
    node('bakemono-workbench-root').dataset.activeTab = 'help';
    const escapeHtml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const guide = createHelpGuide({ escapeHtml, documentRef });
    guide.openArticle('manual-tags');
    assert.equal(node('bakemono-memory-help-article-title').textContent, helpGuideArticles['manual-tags'].title);
    assert.match(node('bakemono-memory-help-article-steps').innerHTML, /&lt;bakemono&gt;/);
    assert.doesNotMatch(node('bakemono-memory-help-article-steps').innerHTML, /<bakemono>/);
    assert.equal(node('bakemono-memory-help-next').dataset.bakemonoHelpArticle, 'manual-auto');
    guide.closeArticle();
    assert.equal(node('[data-bakemono-help-view="hub"]').hidden, false);
    assert.equal(node('[data-bakemono-help-view="article"]').hidden, true);
    assert.equal(node('[data-bakemono-help-category="manual"]').attrs['aria-pressed'], 'true');
    assert.match(node('bakemono-memory-help-list').innerHTML, /manual-troubleshooting/);
    guide.openArticle('manual-troubleshooting');
    assert.equal(node('bakemono-memory-help-next').dataset.bakemonoHelpArticle, 'manual-story-state');
    guide.openArticle('manual-story-state');
    assert.equal(node('bakemono-memory-help-next').hidden, true);
    guide.openArticle('main-model');
    assert.equal(node('bakemono-memory-help-next').hidden, true);
});

test('help and README version labels match the release manifest', async () => {
    const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const help = html.slice(html.indexOf('data-bakemono-panel="help"'));
    assert.ok(help.includes(`v${manifest.version} ·`));
    assert.ok(readme.includes(`当前版本：**v${manifest.version}**`));
});
