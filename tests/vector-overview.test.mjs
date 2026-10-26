import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVectorWorkbenchUi } from '../src/features/vector-workbench-ui.js';

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
        const el = { text: value => { texts.set(selector, value); return el; }, val: () => el, css: () => el, toggleClass: () => el, prop: () => el, html: value => { texts.set(selector, value); return el; } };
        return el;
    };
    const ui = createVectorWorkbenchUi({ query, document: { querySelector: () => null }, getState: () => state,
        defaultVectorMemory: {}, unique: xs => [...new Set(xs)], getVectorQueryText: () => '', canKeepVectorForm: () => true });
    ui.renderVectorMemoryPanel();
    assert.match(texts.get('#bakemono-memory-vector-runtime-description'), /<b>2<\/b> 条楼层摘要/);
    assert.match(texts.get('#bakemono-memory-vector-runtime-description'), /<b>1<\/b> 条已存总结/);
    assert.equal(state.vectorMemory.records.length, 4);
    assert.equal(state.vectorMemory.lastHits.length, 0);
    assert.equal(state.vectorMemory.lastEmbeddingCandidates.length, 0);
    assert.equal(state.vectorMemory.lastRerankCandidates.length, 0);
});

test('overview lists the six injection sources in order, each with its own muted colour', () => {
    const html = readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const sources = [...html.matchAll(/data-bakemono-token-source="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(sources, ['rule', 'summary', 'memory', 'facts', 'time', 'vector']);
    for (const key of sources) {
        assert.match(html, new RegExp('id="bakemono-memory-token-pct-' + key + '"'));
        assert.match(css, new RegExp('\\[data-bakemono-stack-source="' + key + '"\\]'));
    }
});
