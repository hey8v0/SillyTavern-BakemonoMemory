import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVectorWorkbenchUi } from '../src/features/vector-workbench-ui.js';
import { clearRpDerivedCache, renderRpStateMemory } from '../src/rp-core/memory.js';

test('vector panel reports tagged and saved summaries separately and removes legacy RP previews', () => {
    const records = [
        { id: 'body', messageId: 0, kind: 'chunk' },
        { id: 'tag1', messageId: 0, kind: 'summary' },
        { id: 'tag2', messageId: 1, kind: 'summary' },
        { id: 'saved', messageId: 1, kind: 'summary', isSavedSummary: true },
        ...Array.from({ length: 13 }, (_, i) => ({ id: `vec-rp-facts-${i}`, messageId: 1, kind: 'summary' })),
    ];
    const stale = records.at(-1);
    const state = { vectorMemory: { records, lastHits: [stale], lastEmbeddingCandidates: [stale], lastRerankCandidates: [stale] } };
    const texts = new Map();
    const query = selector => {
        const el = { text: value => { texts.set(selector, value); return el; }, val: () => el, css: () => el, toggleClass: () => el };
        return el;
    };
    const ui = createVectorWorkbenchUi({ query, document: { querySelector: () => null }, getState: () => state,
        defaultVectorMemory: {}, unique: xs => [...new Set(xs)], getVectorQueryText: () => '', canKeepVectorForm: () => true });
    ui.renderVectorMemoryPanel();
    assert.match(texts.get('#bakemono-memory-vector-runtime-description'), /2 条标签摘要/);
    assert.match(texts.get('#bakemono-memory-vector-runtime-description'), /1 条已存摘要/);
    assert.equal(state.vectorMemory.records.length, 4);
    assert.equal(state.vectorMemory.lastHits.length, 0);
    assert.equal(state.vectorMemory.lastEmbeddingCandidates.length, 0);
    assert.equal(state.vectorMemory.lastRerankCandidates.length, 0);
});

test('removing derived RP cache preserves ledger, direct state injection and vector settings', () => {
    const state = { rpCore: { settings: { enabled: true, inject: true }, facts: [{ id: 'keep' }] },
        vectorMemory: { enabled: true, customApi: { model: 'keep-model' }, records: [{ id: 'body' }, { summaryType: 'rp-claims' }], lastHits: [{ memoryHash: 'rp:facts:old' }] } };
    const view = { projection: { clock: { date: '2024-04-12', calendar: 'gregorian' }, people: [{ id: 'p', name: '人物甲', location: 'room' }],
        locations: [{ id: 'room', name: '书房' }], relationships: [], plans: [], items: [] } };
    const before = JSON.stringify(state.rpCore);
    const brief = renderRpStateMemory(state, view, '人物甲');
    assert.match(brief, /人物甲/);
    clearRpDerivedCache(state);
    assert.equal(JSON.stringify(state.rpCore), before);
    assert.equal(renderRpStateMemory(state, view, '人物甲'), brief);
    assert.equal(state.vectorMemory.customApi.model, 'keep-model');
    assert.equal(state.vectorMemory.enabled, true);
    assert.deepEqual(state.vectorMemory.records, [{ id: 'body' }]);
    assert.deepEqual(state.vectorMemory.lastHits, []);
});

test('overview uses six equal cells with rules first and a divider on the vector cell', () => {
    const html = readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const sources = [...html.matchAll(/data-bakemono-token-source="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(sources, ['rule', 'summary', 'memory', 'rpState', 'table', 'vector']);
    assert.match(css, /\.bakemono-memory-token-breakdown\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.bakemono-memory-token-breakdown > div:nth-child\(even\)\s*\{[^}]*border-left:/);
    assert.doesNotMatch(css, /\.bakemono-memory-token-breakdown > div:last-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
});
