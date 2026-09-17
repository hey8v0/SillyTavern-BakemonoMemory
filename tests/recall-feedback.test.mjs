import test from 'node:test';
import assert from 'node:assert/strict';
import { createVectorMemoryService } from '../src/features/vector-memory-service.js';
import { enrichHybridLexicalScores, selectHybridCandidates, computeHybridRerankScore } from '../src/vector/hybrid-retrieval.js';
import * as text from '../src/shared/text.js';
import * as math from '../src/vector/math.js';
import { compactEmbedding, getClippedVectorText, slimVectorMemoryForSave } from '../src/vector/storage.js';
import { groupRecallCandidates, selectRecallPlan } from '../src/vector/recall-plan.js';
import { createVectorAutoRecall } from '../src/features/vector-auto-recall.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('automatic generation uses committed settings and writes actual retrieved content into the prompt', async () => {
    const f = fixture([{ body: 1, text: '旧剧情钥匙在书柜。' }], {}, { createLocalEmbedding: () => [1, 0] });
    let injected = '', saves = 0;
    const auto = createVectorAutoRecall({ getState: () => f.state,
        retrieve: f.service.retrieveVectorMemoryHits, cancelRecall: f.service.cancelVectorRecall, clear: f.service.clearVectorRecall,
        syncInjection: () => { injected = f.service.renderVectorMemorySection(); }, saveState: () => saves++,
    });
    f.chat.push({ is_user: true, mes: '钥匙在哪里？' });
    await auto.intercept([], 8000, () => {}, 'normal');
    assert.match(injected, /钥匙在书柜/); assert.ok(f.state.vectorMemory.lastQuery.includes('钥匙在哪里'));
    assert.ok(f.state.vectorMemory.records.length); assert.equal(saves, 1);
    auto.dispose();
});

test('service preserves real chunk choices after metadata serialization and reload', async () => {
    const f = fixture([{ body: 1, text: '前半旧事。'.repeat(55) + '后半戒指。'.repeat(55) }],
        { injectMode: 'chunk', indexMode: 'chunk', chunkSize: 240, overlap: 0, maxPerMessage: 2, fullRecallCount: 0 },
        { createLocalEmbedding: () => [1, 0] });
    await f.run();
    assert.equal(f.state.vectorMemory.lastHits.length, 2);
    assert.ok(f.state.vectorMemory.lastHits.every(h => h.recallTier === 'chunk'));
    slimVectorMemoryForSave(f.state.vectorMemory);
    const reloaded = JSON.parse(JSON.stringify(f.state));
    const service = createVectorMemoryService({ ...f.dependencies, getState: () => reloaded });
    const rendered = service.renderVectorMemorySection();
    assert.match(rendered, /正文片段/); assert.equal(reloaded.vectorMemory.lastHits.length, 2);
    assert.ok(reloaded.vectorMemory.lastHits.every(h => h.recallTier === 'chunk'));
});

test('saved summaries in message/chunk modes never expand into unrelated bodies', () => {
    const records = [{ id: 'saved', memoryHash: 'm1', messageId: 1, kind: 'summary', text: '跨楼阶段总结', score: .9 }];
    for (const injectMode of ['message', 'chunk']) {
        const config = { injectMode };
        const groups = groupRecallCandidates(records, records, new Map([[1, '不该插入的正文']]), 20, config);
        const result = selectRecallPlan(groups, config);
        assert.equal(result.hits[0].recallTier, 'summary'); assert.doesNotMatch(result.text, /不该插入/);
    }
});

test('whole-floor indexes with clipped stored text still locate a queried detail at the end after reload', async () => {
    const f = fixture([{ body: 1, text: '开场场景。'.repeat(400) + '戒指藏在书柜之后。' + '后续叙述。'.repeat(50) }],
        { injectMode: 'message', perMessageMaxChars: 260 }, { createLocalEmbedding: () => [1, 0] });
    await f.service.buildVectorMemoryIndex(); slimVectorMemoryForSave(f.state.vectorMemory);
    assert.doesNotMatch(f.state.vectorMemory.records[0].text, /戒指藏在/);
    await f.service.retrieveVectorMemoryHits('戒指藏在哪里');
    const expected = f.state.vectorMemory.lastHits[0];
    assert.match(expected.text, /戒指藏在书柜/); assert.ok(expected.sourceTextStart > 1000);
    const reloaded = JSON.parse(JSON.stringify(f.state));
    const service = createVectorMemoryService({ ...f.dependencies, getState: () => reloaded });
    assert.match(service.renderVectorMemorySection(), /戒指藏在书柜/);
    assert.equal(reloaded.vectorMemory.lastHits[0].sourceTextStart, expected.sourceTextStart);
});

test('a late recall success or failure cannot replace a newer successful query', async () => {
    for (const fail of [false, true]) {
        const requests = [];
        const f = fixture([{ body: 1, summary: .5 }], { queryMode: 'model-required' }, {
            rewriteWithTavern: () => { const d = deferred(); requests.push(d); return d.promise; },
            parseVectorQueryRewritePayload: s => ({ intent: s, queries: [s] }), createLocalEmbedding: () => [1, 0],
        });
        await f.service.buildVectorMemoryIndex();
        const a = f.service.retrieveVectorMemoryHits('old');
        const b = f.service.retrieveVectorMemoryHits('new');
        requests[1].resolve('NEW'); await b;
        const expected = JSON.stringify(f.state.vectorMemory);
        if (fail) requests[0].reject(new Error('old failure')); else requests[0].resolve('OLD');
        assert.deepEqual(await a, []);
        assert.equal(JSON.stringify(f.state.vectorMemory), expected);
    }
});

test('changing recall-only settings or cancelling invalidates a pending query', async () => {
    for (const change of ['config', 'cancel', 'signal']) {
        const d = deferred(), controller = new AbortController();
        const f = fixture([{ body: 1 }], { queryMode: 'model-required' }, {
            rewriteWithTavern: () => d.promise,
            parseVectorQueryRewritePayload: s => ({ queries: [s] }), createLocalEmbedding: () => [1, 0],
        });
        await f.service.buildVectorMemoryIndex();
        const result = f.service.retrieveVectorMemoryHits('old', f.state, { signal: controller.signal });
        if (change === 'config') f.state.vectorMemory.fullRecallCount = 0;
        if (change === 'cancel') f.service.cancelVectorRecall();
        if (change === 'signal') controller.abort();
        const expected = JSON.stringify(f.state.vectorMemory);
        d.resolve('OLD'); assert.deepEqual(await result, []);
        assert.equal(JSON.stringify(f.state.vectorMemory), expected);
    }
});

test('message mode ignores tiered full quota while chunk mode obeys per-floor cap', async () => {
    const f = fixture([{ body: 1, summary: .5 }], { injectMode: 'message', fullRecallCount: 0, rerankThreshold: 1 });
    assert.equal((await f.run())[0]?.recallTier, 'full');
    const candidates = Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, kind: 'chunk', messageId: 1,
        text: `片段${i}具体内容。`, score: .9 - i * .1 }));
    const config = { injectMode: 'chunk', maxPerMessage: 2, fullRecallCount: 0, maxInjectChars: 3000 };
    const groups = groupRecallCandidates(candidates, candidates, new Map([[1, '原楼正文']]), 20, config);
    const result = selectRecallPlan(groups, config);
    assert.equal(result.hits.length, 2);
    assert.ok(result.hits.every(h => h.recallTier === 'chunk'));
    assert.match(result.text, /片段0/); assert.match(result.text, /片段1/); assert.doesNotMatch(result.text, /片段2具体/);
});

test('long text keeps the matched tail with exact cleaned-source offsets under both budgets', () => {
    const body = '开场背景。'.repeat(300) + '关键证据：戒指藏在书柜后。' + '后续场景。'.repeat(200);
    const match = '关键证据：戒指藏在书柜后。';
    const candidates = [{ id: 'tail', messageId: 1, kind: 'chunk', text: match, score: .95 }];
    const groups = groupRecallCandidates(candidates, candidates, new Map([[1, body]]), 20);
    for (const budget of [3000, 280]) {
        const result = selectRecallPlan(groups, { perMessageMaxChars: 350, maxInjectChars: budget });
        const hit = result.hits[0];
        assert.match(hit.text, /戒指藏在书柜后/);
        assert.ok(hit.sourceTextStart > 0); assert.ok(hit.sourceTextEnd <= body.length);
        assert.equal(body.slice(hit.sourceTextStart, hit.sourceTextEnd), hit.text.replace(/^…|…$/g, ''));
        assert.ok(result.text.length <= budget);
    }
});

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

test('RP data cannot inflate two tagged summaries to fifteen index entries', async () => {
    const sources = Array.from({ length: 13 }, (_, i) => ({ id: `vec-rp-facts-${i}`, hash: `rp:facts:${i}`, messageId: 0, text: `状态记录${i}`, title: '状态' }));
    const f = fixture([{ body: .9, summary: .7 }, { body: .9, summary: .7 }], { summaryTags: 'bakemono' }, { getRpMemorySources: () => sources, createLocalEmbedding: () => [1, 0] });
    const hits = await f.run();
    assert.equal(f.state.vectorMemory.records.filter(r => r.kind === 'summary').length, 2);
    assert.ok(hits.every(h => !h.memoryHash?.startsWith('rp:')));
    assert.doesNotMatch(f.service.renderVectorMemorySection(), /状态记录/);
    const signature = f.service.getVectorSourceSignature();
    sources[0].text = '改变剧情状态不使向量索引失效';
    assert.equal(f.service.getVectorSourceSignature(), signature);
});

test('configured summary tags exclude unrelated tags and nested RP protocol', async () => {
    const f = fixture([{ body: .9, summary: .7 }], { summaryTags: 'bakemono' }, { createLocalEmbedding: () => [1, 0] });
    f.chat[0].mes = '正文<bakemono>真正摘要<rpEvents>{"events":[{"data":{"name":"RP_ONLY"}}]}</rpEvents></bakemono><other>OTHER_ONLY</other>';
    await f.service.buildVectorMemoryIndex();
    const summaries = f.state.vectorMemory.records.filter(item => item.kind === 'summary');
    assert.equal(summaries.length, 1);
    assert.match(summaries[0].text, /真正摘要/);
    assert.doesNotMatch(summaries[0].text, /RP_ONLY|OTHER_ONLY/);
    assert.ok(f.state.vectorMemory.records.every(item => !item.text.includes('RP_ONLY')));
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

test('legacy RP hits are removed on reload even with automatic indexing disabled', async () => {
    const f = fixture([{ body: .9, summary: .7 }], { autoIndex: false }, { createLocalEmbedding: () => [1, 0] });
    await f.run();
    const original = structuredClone(f.state.vectorMemory.records);
    for (const marker of [{ id: 'vec-rp-facts-old' }, { memoryHash: 'rp:claims:old' }, { summaryType: 'rp-observations' }]) {
        const legacy = { id: 'legacy', kind: 'summary', isSavedSummary: true, messageId: 0, text: '不应召回的状态', summary: '不应召回的状态', score: 1, embedding: [1, 0], ...marker };
        const saved = structuredClone(f.state);
        saved.vectorMemory.records.push(legacy);
        saved.vectorMemory.lastHits.push(legacy);
        const service = createVectorMemoryService({ ...f.dependencies, getState: () => saved });
        assert.ok(service.getVectorRecallSourceRecords().every(r => r !== legacy));
        assert.doesNotMatch(service.renderVectorMemorySection(), /不应召回/);
        assert.ok(saved.vectorMemory.lastHits.every(h => h.text !== legacy.text));
        assert.deepEqual(saved.vectorMemory.records, original);
        await service.retrieveVectorMemoryHits('QUERY');
        assert.ok(saved.vectorMemory.lastHits.length);
        assert.doesNotMatch(service.renderVectorMemorySection(), /不应召回/);
    }
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
