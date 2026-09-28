import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { helpGuideArticles, helpGuideSections, helpPageTargets } from '../src/features/help-guide-content.js';
import { createHelpGuide } from '../src/features/help-guide.js';
import { createVectorActionsController } from '../src/features/vector-actions-controller.js';
import { createVectorMemoryService } from '../src/features/vector-memory-service.js';

const noop = () => {};
test('help is three groups; “按页面” follows the sidebar and every article is complete', async () => {
    assert.deepEqual(helpGuideSections.map(section => section.title), ['从这里开始', '按页面', '遇到问题']);
    const ids = helpGuideSections.flatMap(section => section.articles);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(Object.keys(helpGuideArticles).sort(), [...ids].sort());
    for (const id of ids) {
        const article = helpGuideArticles[id];
        assert.ok(article.title && article.lead && article.minutes, id);
        assert.ok(article.steps.length && article.steps.every(([title, copy]) => title && copy), id);
        assert.doesNotMatch(JSON.stringify(article), /旧版|v1\.\d|记忆档案|剧情回看|工作流设置/, id + ' describes the current screens, not history');
    }
    const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    const sidebar = [...html.slice(html.indexOf('bakemono-workbench-tabs'), html.indexOf('data-bakemono-tab="help"')).matchAll(/data-bakemono-tab="([a-z-]+)"/g)].map(m => m[1]);
    const pages = helpGuideSections[1].articles.map(id => helpPageTargets[helpGuideArticles[id].label.split(' · ')[0]]);
    assert.deepEqual([...new Set(pages)], sidebar, 'the pages group lists the sidebar in order');
    const nav = new Set([...html.matchAll(/data-bakemono-(?:nav|panel|tab)="([a-z-]+)"/g)].map(m => m[1]));
    assert.ok(Object.values(helpPageTargets).every(target => nav.has(target)), 'every page link leads to a real page');
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

test('index configuration changes invalidate the index and schedule a refresh', () => {
    const { state, calls, service } = vectorIndex();
    const previous = service.getVectorSourceSignature(state);
    state.vectorMemory.lastIndexedSignature = previous;
    state.vectorMemory.summaryMaxChars = 800;
    assert.notEqual(service.getVectorSourceSignature(state), previous);
    service.markVectorIndexDirty('配置变更', state);
    assert.equal(state.vectorMemory.dirty, true);
    assert.deepEqual(state.vectorMemory.lastHits, []);
    assert.ok(calls.includes('timer'));
});

test('the reader escapes tag examples, links page names and pages through the articles', () => {
    const nodes = new Map();
    function node(key) {
        if (!nodes.has(key)) nodes.set(key, {
            dataset: {}, hidden: false, attrs: {}, textContent: '', innerHTML: '',
            setAttribute(name, value) { this.attrs[name] = value; }, focus: noop, scrollTo: noop,
        });
        return nodes.get(key);
    }
    const documentRef = { getElementById: node, querySelector: node, querySelectorAll: () => [] };
    node('bakemono-workbench-root').dataset.activeTab = 'help';
    const escapeHtml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const guide = createHelpGuide({ escapeHtml, documentRef });
    guide.render();
    assert.match(node('bakemono-memory-help-list').innerHTML, /从这里开始[\s\S]*按页面[\s\S]*遇到问题/);
    assert.equal(node('bakemono-workbench-section-title').textContent, '使用说明 · 19 篇');
    guide.openArticle('not-recognized');
    assert.equal(node('bakemono-memory-help-article-title').textContent, helpGuideArticles['not-recognized'].title);
    assert.match(node('bakemono-memory-help-article-steps').innerHTML, /&lt;bakemono&gt;/);
    assert.doesNotMatch(node('bakemono-memory-help-article-steps').innerHTML, /<bakemono>/);
    assert.equal(node('[data-bakemono-help-view="article"]').hidden, false);
    assert.equal(node('bakemono-workbench-section-title').textContent, '使用说明 · 遇到问题');
    assert.match(node('bakemono-memory-help-pager').innerHTML, /data-bakemono-help-article="injection-empty"[\s\S]*data-bakemono-help-article="recall-empty"/);
    guide.openArticle('first-steps');
    const steps = node('bakemono-memory-help-article-steps').innerHTML;
    assert.match(steps, /<button type="button" class="bk-help-ref" data-bakemono-nav="settings">设置中心 → 摘要方式<\/button>/);
    assert.match(steps, /“回复里本来就有”/, 'a button name stays quoted text, not a link');
    assert.equal(node('bakemono-memory-help-article-goto').dataset.bakemonoNav, 'settings');
    assert.doesNotMatch(node('bakemono-memory-help-pager').innerHTML, /上一篇/);
    guide.openArticle('feedback');
    assert.doesNotMatch(node('bakemono-memory-help-pager').innerHTML, /下一篇/);
    guide.closeArticle();
    assert.equal(node('[data-bakemono-help-view="hub"]').hidden, false);
    assert.equal(node('[data-bakemono-help-view="article"]').hidden, true);
});

test('help and README version labels match the release manifest', async () => {
    const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const help = html.slice(html.indexOf('data-bakemono-panel="help"'));
    assert.ok(help.includes(`v${manifest.version} ·`));
    assert.ok(readme.includes(`当前版本：**v${manifest.version}**`));
});
