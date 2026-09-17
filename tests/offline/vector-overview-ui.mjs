import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOverviewTokenManifest } from '../../src/features/overview-token-manifest.js';
import { createVectorWorkbenchUi } from '../../src/features/vector-workbench-ui.js';
const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const { parse } = await import(process.env.BAKEMONO_TEST_CSS_TREE || 'css-tree');
const html = await readFile(new URL('../../settings.html', import.meta.url), 'utf8');
parse(await readFile(new URL('../../style.css', import.meta.url), 'utf8'));
const { document } = parseHTML(html);
const debugList = document.createElement('div');
debugList.id = 'bakemono-memory-vector-record-list';
document.querySelector('.bakemono-workbench-main').append(debugList);
const query = selector => {
    const nodes = [...document.querySelectorAll(selector)];
    const api = {
        text: value => { nodes.forEach(n => n.textContent = String(value)); return api; },
        val: value => { nodes.forEach(n => n.value = value); return api; },
        css: (name, value) => { nodes.forEach(n => n.style[name] = value); return api; },
        toggleClass: (name, value) => { nodes.forEach(n => n.classList.toggle(name, value)); return api; },
    };
    return api;
};
const state = { injection: { enabled: true }, vectorMemory: { enabled: true, records: [
    { id: 'summary1', kind: 'summary', messageId: 0, title: '摘要一', text: '摘要一' },
    { id: 'summary2', kind: 'summary', messageId: 1, title: '摘要二', text: '摘要二' },
    { id: 'vec-rp-facts-old', kind: 'summary', messageId: 1, text: 'RP_ONLY' },
], lastHits: [{ id: 'vec-rp-facts-old', text: 'RP_ONLY' }] } };
const vectorUi = createVectorWorkbenchUi({ query, document, getState: () => state, defaultVectorMemory: {},
    unique: xs => [...new Set(xs)], escapeHtml: String, getVectorQueryText: () => '', canKeepVectorForm: () => true });
vectorUi.renderVectorMemoryPanel();
assert.match(document.querySelector('#bakemono-memory-vector-runtime-description').textContent, /2 条标签摘要/);
assert.doesNotMatch(document.querySelector('#bakemono-memory-vector-record-list').textContent, /RP_ONLY/);
assert.equal(document.querySelector('#bakemono-memory-vector-result-count').textContent, '0 条');
const sources = { rule: '', summary: '', memory: '', rpState: 'RP_BRIEF', table: 'TABLE', vector: '' };
const tokens = createOverviewTokenManifest({ query, getState: () => state, getHash: s => s,
    countTokens: async s => s.length, getInjectionMemoryParts: () => ({ sources, rpMaintenance: 'RULES' }),
    renderInjectionContent: () => 'injected', renderInlinePrompt: String, defaultInjectionTemplate: '{{memory}}',
    getLastPromptUsage: async () => null, getActiveTab: () => 'overview', logWarning: () => {} });
await tokens.renderOverviewTokenManifest();
assert.equal(document.querySelector('#bakemono-memory-token-rule').textContent, '5');
assert.equal(document.querySelector('#bakemono-memory-token-rpState').textContent, '8');
assert.equal(document.querySelector('#bakemono-memory-token-vector').textContent, '0');
assert.equal(document.querySelector('#bakemono-memory-overview-token-total').textContent, '18');
assert.equal(document.querySelector('#bakemono-memory-overview-token-percent').textContent, '—');
const cells = [...document.querySelector('.bakemono-memory-token-breakdown').children];
assert.equal(cells.length, 6);
assert.equal(cells[0].dataset.bakemonoTokenSource, 'rule');
assert.equal(cells[5].dataset.bakemonoTokenSource, 'vector');
assert.equal(new Set(cells.flatMap(cell => [...cell.querySelectorAll('[id]')].map(n => n.id))).size, 12);
console.log('Offline vector counts, legacy filtering, token bindings, six-cell DOM and stylesheet parsing passed.');
