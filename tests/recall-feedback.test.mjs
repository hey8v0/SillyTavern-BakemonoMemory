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

test('an old chunk setting still indexes one record per floor', async () => {
    const f = fixture([{ body: 1, summary: .5, text: '前半旧事。'.repeat(55) + '后半戒指。'.repeat(55) }],
        { injectMode: 'chunk', indexMode: 'chunk', chunkSize: 240, overlap: 0, maxPerMessage: 2 },
        { createLocalEmbedding: () => [1, 0] });
    await f.run();
    assert.deepEqual(f.state.vectorMemory.records.map(r => r.kind).sort(), ['message', 'summary']);
    assert.equal(f.state.vectorMemory.lastHits.length, 1);
    assert.equal(f.state.vectorMemory.lastHits[0].text, '前半旧事。'.repeat(55) + '后半戒指。'.repeat(55));
});

test('saved summaries never expand into unrelated bodies', () => {
    const records = [{ id: 'saved', memoryHash: 'm1', messageId: 1, kind: 'summary', text: '跨楼阶段总结', score: .9 }];
    const groups = groupRecallCandidates(records, records, new Map([[1, '不该插入的正文']]), 20);
    const result = selectRecallPlan(groups, {});
    assert.equal(result.hits[0].recallTier, 'summary'); assert.doesNotMatch(result.text, /不该插入/);
    assert.equal(result.decisions[0].decisionReason, '已存的总结');
});

test('a whole floor is injected in full, also after the stored text was clipped and reloaded', async () => {
    const body = '开场场景。'.repeat(400) + '戒指藏在书柜之后。' + '后续叙述。'.repeat(50);
    const f = fixture([{ body: 1, text: body }], {}, { createLocalEmbedding: () => [1, 0] });
    await f.service.buildVectorMemoryIndex(); slimVectorMemoryForSave(f.state.vectorMemory);
    assert.doesNotMatch(f.state.vectorMemory.records[0].text, /戒指藏在/);
    await f.service.retrieveVectorMemoryHits('戒指藏在哪里');
    assert.equal(f.state.vectorMemory.lastHits[0].text, body);
    const reloaded = JSON.parse(JSON.stringify(f.state));
    const service = createVectorMemoryService({ ...f.dependencies, getState: () => reloaded });
    const rendered = service.renderVectorMemorySection();
    assert.ok(rendered.includes(body)); assert.doesNotMatch(rendered, /已截断/);
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

test('summaries and full texts are counted separately', () => {
    const candidates = Array.from({ length: 7 }, (_, i) => [
        { id: `s${i}`, kind: 'summary', messageId: i, text: `第${i}楼摘要。`, score: .9 - i * .01 },
        { id: `m${i}`, kind: 'message', messageId: i, text: `第${i}楼正文。`, score: .9 - i * .01 },
    ]).flat();
    const bodies = new Map(Array.from({ length: 7 }, (_, i) => [i, `第${i}楼正文。`]));
    const groups = groupRecallCandidates(candidates, candidates, bodies, 20);
    const result = selectRecallPlan(groups, { maxSummaryRecall: 3, fullRecallCount: 2, rerankThreshold: .5 });
    assert.equal(result.hits.filter(h => h.recallTier === 'full').length, 2);
    assert.equal(result.hits.filter(h => h.recallTier === 'summary').length, 3);
    assert.deepEqual(result.decisions.filter(d => d.recallTier === 'dropped').map(d => d.decisionReason), ['摘要已满 3 条', '摘要已满 3 条']);
    assert.match(result.decisions[2].decisionReason, /正文已满 2 条/);
});

test('nothing is cut: over the safety cap a full text falls back to its summary, a summary is left out whole', () => {
    const records = [
        { id: 'a-body', kind: 'message', messageId: 1, text: '长正文', score: .95 },
        { id: 'a-sum', kind: 'summary', messageId: 1, text: '第一楼的摘要。', score: .9 },
        { id: 'b-sum', kind: 'summary', messageId: 2, text: '很长的摘要。'.repeat(300), score: .8 },
        { id: 'c-sum', kind: 'summary', messageId: 3, text: '第三楼的摘要。', score: .7 },
    ];
    const groups = groupRecallCandidates(records, records, new Map([[1, '正文细节。'.repeat(700)]]), 20);
    const result = selectRecallPlan(groups, { recallSafetyChars: 1000 });
    assert.deepEqual(result.hits.map(h => [h.messageId, h.recallTier, h.text]), [[1, 'summary', '第一楼的摘要。'], [3, 'summary', '第三楼的摘要。']]);
    assert.match(result.decisions.find(d => d.messageId === 2).decisionReason, /放不下：超过保险上限 1000 字/);
    assert.ok(result.text.length <= 1000);
    assert.ok(result.hits.every(h => !h.truncated));
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
    assert.equal(hits.length, 6); assert.equal(hits.filter(h => h.recallTier === 'full').length, 2);
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

test('inline summaries are stored whole; only the embedding input is bounded', async () => {
    const inputs = [];
    const f = fixture([], { summaryMaxChars: 520 }, { createLocalEmbedding: value => { inputs.push(value); return [1, 0]; } });
    f.chat.push({ mes: '<bakemono>' + '很长的剧情摘要。'.repeat(1000) + '</bakemono>' });
    await f.service.buildVectorMemoryIndex();
    const record = f.state.vectorMemory.records.find(r => r.kind === 'summary');
    assert.ok(record); assert.ok(record.text.length > 7000);
    assert.ok(inputs[0].length <= 523); // The configured excerpt plus an ellipsis.
    slimVectorMemoryForSave(f.state.vectorMemory);
    assert.equal(f.state.vectorMemory.records.find(r => r.kind === 'summary').text, record.text);
});

test('body and summary winner uses hybrid score first, not a lower hybrid score with higher cosine', async () => {
    const f = fixture([{ body: .9, summary: .6 }], {}, { selectHybridCandidates: records => records.map(r => ({ ...r, hybridScore: r.kind === 'summary' ? .95 : .7 })).sort((a, b) => b.hybridScore - a.hybridScore) });
    await f.run();
    assert.equal(f.state.vectorMemory.lastRerankCandidates[0].rerankScore, .95);
});

test('actual injection, stored hit count and preview agree under a small safety cap', async () => {
    const f = fixture(Array.from({ length: 5 }, (_, i) => ({ body: .9, summary: .7, text: `第${i}楼细节。`.repeat(300) })), { recallSafetyChars: 1000 });
    await f.run();
    const rendered = f.service.renderVectorMemorySection();
    assert.ok(rendered.length <= 1000, rendered.length);
    assert.equal((rendered.match(/- 来源：/g) || []).length, f.state.vectorMemory.lastHits.length);
    for (const h of f.state.vectorMemory.lastHits) assert.ok(rendered.includes(h.text));
    assert.ok(f.state.vectorMemory.lastHits.every(h => h.recallTier === 'summary'));
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

test('a full text is injected whole and never split, however long', async () => {
    const body = '关键细节😀'.repeat(300);
    const f = fixture([{ body: .9, text: body }], { perMessageMaxChars: 200, maxInjectChars: 1000 });
    const hits = await f.run();
    assert.equal(hits[0].recallTier, 'full'); assert.equal(hits[0].truncated, false);
    assert.equal(hits[0].text, body);
    assert.doesNotMatch(f.service.renderVectorMemorySection(), /已截断/);
    assert.ok(f.state.vectorMemory.lastRecallAt); assert.equal(f.state.vectorMemory.lastRecallQuery, 'QUERY');
});

export { fixture };
