import test from 'node:test';
import assert from 'node:assert/strict';
import { createVectorMemoryService } from '../src/features/vector-memory-service.js';
import { enrichHybridLexicalScores, selectHybridCandidates, computeHybridRerankScore } from '../src/vector/hybrid-retrieval.js';
import * as text from '../src/shared/text.js';
import * as math from '../src/vector/math.js';
import { compactEmbedding, getClippedVectorText, slimVectorMemoryForSave } from '../src/vector/storage.js';

const noop = () => {};
function fixture(rows, settings = {}, overrides = {}) {
    const scores = new Map();
    const chat = rows.map((row, i) => {
        const body = row.text ?? `正文材料${i}。`;
        const summary = row.summary == null ? '' : `<bakemono>剧情摘要${i}。</bakemono>`;
        scores.set(body, row.body); if (summary) scores.set(summary, row.summary);
        return { mes: body + summary, is_system: true };
    });
    const defaults = { enabled: true, indexMode: 'message', embeddingProvider: 'local', embeddingDimensions: 128,
        includeHidden: true, includeUser: false, maxIndexedMessages: 300, chunkSize: 900, overlap: 120, longMessageThreshold: 1800,
        summaryTags: 'bakemono,summaryDraft', excludeTags: 'thinking,think,reasoning', summaryMaxChars: 520,
        maxStoredTextChars: 1200, perMessageMaxChars: 1600, maxInjectChars: 2600, rerankCandidateCount: 20,
        finalRecallCount: 5, fullRecallCount: 2, embeddingThreshold: 0.22, rerankThreshold: 0.45, keywordBoost: 0.18,
        queryMode: 'off', skipIfAllInContext: false, contextWindowMessages: 20, ...settings };
    const state = { vectorMemory: { ...defaults, records: [] }, scanRules: {}, storySummaries: [], stageSummaries: [], epicSummaries: [] };
    const dependencies = { ...text, ...math, defaultVectorMemory: defaults, getState: () => state,
        getContext: () => ({ chat }), normalizeLineEndings: String, stripHtml: s => String(s).replace(/<[^>]*>/g, ''), unique: xs => [...new Set(xs)],
        toPlainPreview: (s, n) => String(s).slice(0, n), getClippedVectorText,
        getMessageVariantKey: () => 0, getActiveCoveredStageHashes: () => new Set(), getActiveEpicMemoryBlocks: () => [],
        memoryStrategies: { GENERIC: 'generic' }, blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' },
        saveState: noop, syncInjection: noop, renderWorkbenchScope: noop, workbenchRenderScopes: {}, toastr: { success: noop },
        createLocalEmbedding: s => { const sim = s === 'QUERY' ? 1 : scores.get(s); assert.ok(Number.isFinite(sim), s); return [sim, Math.sqrt(1 - sim * sim)]; },
        compactEmbedding, selectHybridCandidates, computeHybridRerankScore, countKeywordHits: () => 0, yieldToUi: async () => {}, ...overrides,
    };
    const service = createVectorMemoryService(dependencies);
    return { state, service, chat, dependencies, async run() { await service.buildVectorMemoryIndex(); return service.retrieveVectorMemoryHits('QUERY'); } };
}

test('readable matches preserve Chinese names and never manufacture a full-name match from fragments', () => {
    const result = enrichHybridLexicalScores([
        { id: 'full', text: '塞巴斯蒂安抵达凡多姆海恩宅，米多福特正在门外等候。' },
        { id: 'part', text: '巴斯去了别处，蒂安尚未回来。' },
    ], ['寻找塞巴斯蒂安和凡多姆海恩宅以及米多福特相关的旧事'], []);
    for (const name of ['塞巴斯蒂安', '凡多姆海恩宅', '米多福特']) assert.ok(result[0].matchedPhrases?.includes(name), name);
    assert.ok(!result[1].matchedPhrases?.includes('塞巴斯蒂安'));
    assert.ok(result[0].matchedTerms.includes('巴斯'));
});

test('a high-scoring inline summary retrieves its own cleaned body without an extra embedding request', async () => {
    const f = fixture([{ body: .85, summary: 1 }]);
    const hits = await f.run();
    assert.equal(hits.length, 1); assert.equal(hits[0].recallTier, 'full');
    assert.equal(hits[0].text, '正文材料0。'); assert.doesNotMatch(hits[0].text, /bakemono/);
});

test('a winning body below the full threshold falls back to its separately indexed summary', async () => {
    const f = fixture([{ body: .6, summary: .4 }]);
    const hits = await f.run();
    assert.equal(hits.length, 1); assert.equal(hits[0].recallTier, 'summary');
    assert.match(hits[0].text, /剧情摘要0/);
});

test('twenty candidates across twelve floors can retain five instead of dropping available summaries', async () => {
    const f = fixture(Array.from({ length: 12 }, (_, i) => ({ body: i < 3 ? .3 : .4, ...(i < 8 ? { summary: i < 3 ? .9 : .25 } : {}) })));
    const hits = await f.run();
    assert.equal(f.state.vectorMemory.lastEmbeddingCandidates.length, 20);
    assert.equal(f.state.vectorMemory.lastRerankCandidates.length, 12);
    assert.equal(hits.length, 5); assert.equal(hits.filter(h => h.recallTier === 'full').length, 2);
});

test('zero full allowance retains summaries but never fabricates a summary for a body-only floor', async () => {
    const f = fixture([{ body: .9, summary: .4 }, { body: .9 }], { fullRecallCount: 0 });
    const hits = await f.run();
    assert.equal(hits.length, 1); assert.equal(hits[0].recallTier, 'summary');
    assert.ok(f.state.vectorMemory.lastRerankCandidates.some(x => x.decisionReason?.includes('摘要')));
});

test('distinct saved memories sharing a floor stay separate and never expand to that floor body', async () => {
    const sources = ['a', 'b'].map(hash => ({ id: `rp-${hash}`, hash: `rp:${hash}`, messageId: 0, text: `独立信息${hash}`, title: hash }));
    const f = fixture([{ body: .9 }], {}, { getRpMemorySources: () => sources, createLocalEmbedding: () => [1, 0] });
    const hits = await f.run();
    assert.equal(hits.length, 3);
    assert.ok(hits.filter(h => h.memoryHash).every(h => h.recallTier === 'summary' && h.text.startsWith('独立信息')));
});

test('body and summary winner uses hybrid score first, not a lower hybrid score with higher cosine', async () => {
    const f = fixture([{ body: .9, summary: .6 }], {}, { selectHybridCandidates: records => records.map(r => ({ ...r, hybridScore: r.kind === 'summary' ? .95 : .7 })).sort((a, b) => b.hybridScore - a.hybridScore) });
    await f.run();
    assert.equal(f.state.vectorMemory.lastRerankCandidates[0].rerankScore, .95);
});

test('actual injection, stored hit count and preview agree under a small total budget', async () => {
    const f = fixture(Array.from({ length: 5 }, (_, i) => ({ body: .9, summary: .7, text: `第${i}楼细节。`.repeat(300) })), { maxInjectChars: 300 });
    await f.run();
    const rendered = f.service.renderVectorMemorySection();
    assert.ok(rendered.length <= 300, rendered.length);
    assert.equal((rendered.match(/- 来源：/g) || []).length, f.state.vectorMemory.lastHits.length);
    for (const h of f.state.vectorMemory.lastHits) assert.ok(rendered.includes(h.text));
    assert.ok(f.state.vectorMemory.lastRerankCandidates.some(x => /预算|上限/.test(x.decisionReason || '')));
    assert.equal(f.service.renderVectorMemorySection(), rendered);
});

test('changed source invalidates an already selected recall before injection', async () => {
    const f = fixture([{ body: .9 }]); await f.run();
    f.chat[0].mes = '修改后的正文';
    assert.equal(f.service.renderVectorMemorySection(), '');
    assert.equal(f.state.vectorMemory.lastHits.length, 0);
});

test('a configured zero recent window does not fall back to the default window', async () => {
    const f = fixture([{ body: .9 }], { skipIfAllInContext: true });
    f.chat[0].is_system = false; f.state.vectorMemory.contextWindowMessages = 0;
    assert.equal((await f.run()).length, 1);
});

test('save-time array cloning preserves fallback choices and drop reasons; explicit clearing cannot restore hits', async () => {
    const f = fixture([{ body: .9, summary: .8 }, { body: .9, summary: .8 }, { body: .9, summary: .8 }], { fullRecallCount: 0, finalRecallCount: 1 });
    await f.run();
    slimVectorMemoryForSave(f.state.vectorMemory);
    f.service.renderVectorMemorySection();
    assert.equal(f.state.vectorMemory.lastRerankCandidates.length, 3);
    f.state.vectorMemory.finalRecallCount = 3;
    f.service.renderVectorMemorySection();
    assert.equal(f.state.vectorMemory.lastHits.length, 3);
    f.state.vectorMemory.lastHits = [];
    assert.equal(f.service.renderVectorMemorySection(), '');
});

test('duplicate body candidates do not spend a full slot or final slot', async () => {
    const f = fixture([{ body: .9, text: '共同正文' }, { body: .9, text: '共同正文' }, { body: .9, text: '不同正文' }]);
    const hits = await f.run();
    assert.equal(hits.length, 2); assert.ok(hits.every(h => h.recallTier === 'full'));
    assert.ok(f.state.vectorMemory.lastRerankCandidates.some(x => /相同内容/.test(x.decisionReason)));
});

test('budget preview identifies truncated full text without splitting an emoji surrogate', async () => {
    const f = fixture([{ body: .9, text: '关键细节😀'.repeat(300) }], { perMessageMaxChars: 200, maxInjectChars: 1000 });
    const hits = await f.run();
    assert.equal(hits[0].recallTier, 'full'); assert.equal(hits[0].truncated, true);
    assert.ok(hits[0].text.length <= 200); assert.ok(hits[0].text.isWellFormed());
    assert.match(f.service.renderVectorMemorySection(), /已截断/);
});

export { fixture };
