import test from 'node:test';
import assert from 'node:assert/strict';
import { createBm25Index, tokenizeBm25Text } from '../src/vector/bm25-index.js';
import { enrichHybridLexicalScores, selectHybridCandidates } from '../src/vector/hybrid-retrieval.js';

test('BM25 matches the formula including term frequency saturation and token length', () => {
    const index = createBm25Index({ tokenize: text => text.split(/\s+/).filter(Boolean) });
    const records = [{ id: 'a', text: 'key key door' }, { id: 'b', text: 'key door door door door' }];
    const scores = index.score(records, ['key']);
    const idf = Math.log(1 + 0.5 / 2.5);
    const expected = idf * 2 * 2.2 / (2 + 1.2 * (0.25 + 0.75 * 3 / 4));
    assert.ok(Math.abs(scores[0].bm25Score - expected) < 1e-12);
    assert.ok(scores[0].bm25Score > scores[1].bm25Score);
    const saturated = index.score([{ id: 'a', text: 'key ' .repeat(100) }, { id: 'b', text: 'door' }], ['key'])[0];
    assert.ok(saturated.bm25Score < Math.log(2) * 2.2);
});

test('index reuses unchanged text and removes edited, deleted and excluded postings', () => {
    const index = createBm25Index();
    const records = [{ id: 'a', text: 'silver key' }, { id: 'b', text: 'secret promise' }];
    index.score(records, ['key']);
    assert.equal(index.stats().tokenizedDocuments, 2);
    index.score(records.map(r => ({ ...r, embeddingScore: 0.9 })), ['promise']);
    assert.equal(index.stats().tokenizedDocuments, 2);
    records.push({ id: 'c', text: 'silver ring' });
    index.score(records, ['ring']); assert.equal(index.stats().tokenizedDocuments, 3);
    records[0].text = 'wooden door';
    assert.equal(index.score(records, ['key'])[0].bm25Score, 0);
    assert.equal(index.stats().tokenizedDocuments, 4);
    index.score(records.slice(0, 1), ['ring']);
    assert.equal(index.stats().documents, 1);
    assert.equal(index.stats().terms, 2);
    index.score([], []);
    assert.equal(index.stats().documents, 0); assert.equal(index.stats().terms, 0);
});

test('same-ID replacement, duplicate IDs, and independent chats cannot reuse stale text', () => {
    const a = createBm25Index(), b = createBm25Index();
    assert.ok(a.score([{ id: '1', text: 'old promise' }], ['promise'])[0].bm25Score);
    assert.equal(b.score([{ id: '1', text: 'new breakfast' }], ['promise'])[0].bm25Score, 0);
    assert.equal(a.score([{ id: '1', text: 'new breakfast' }], ['promise'])[0].bm25Score, 0);
    const duplicate = a.score([{ id: '1', text: 'ring' }, { id: '1', text: 'breakfast' }], ['ring']);
    assert.ok(duplicate[0].bm25Score); assert.equal(duplicate[1].bm25Score, 0);
    a.clear(); assert.equal(a.stats().documents, 0);
});

test('summary mirrored in text is counted once; edits to title also invalidate the index', () => {
    const index = createBm25Index();
    const base = index.score([{ id: '1', text: 'silver key' }], ['key'])[0].bm25Score;
    assert.equal(index.score([{ id: '1', text: 'silver key', summary: 'silver key' }], ['key'])[0].bm25Score, base);
    assert.ok(index.score([{ id: '1', title: 'promise', text: 'silver key' }], ['promise'])[0].bm25Score > 0);
});

test('Chinese names, objects and promises are searchable with bounded query terms', () => {
    const records = [
        { id: 'target', messageId: 1, text: '塞巴斯蒂安把银钥匙交给阿青，约定雨夜在旧码头重逢。', embeddingScore: 0.35 },
        { id: 'noise', messageId: 2, text: '大家讨论明天的早餐。', embeddingScore: 0.35 },
    ];
    const index = createBm25Index();
    for (const query of ['塞巴斯蒂安', '银钥匙', '旧码头的约定']) {
        const hits = selectHybridCandidates(records, [query], [], { lexicalIndex: index });
        assert.equal(hits[0].id, 'target', query);
        assert.ok(hits[0].bm25Score > 0);
    }
    assert.ok(tokenizeBm25Text('銀鑰匙 ＮＡＮＡ').includes('nana'));
    assert.ok(tokenizeBm25Text('约定约定').filter(term => term === '约定').length >= 2);
});

test('long text with a passing mention no longer ties a focused memory', () => {
    const records = [
        { id: 'long', messageId: 20, text: 'silver key ' + 'unrelated breakfast '.repeat(200), embeddingScore: 0.4 },
        { id: 'focused', messageId: 10, text: 'silver key promised to Nana', embeddingScore: 0.4 },
    ];
    const scores = enrichHybridLexicalScores(records, ['silver key']);
    assert.ok(scores[1].lexicalScore > scores[0].lexicalScore);
    assert.equal(selectHybridCandidates(records, ['silver key'])[0].id, 'focused');
});

test('partial query matches are not promoted to a full lexical score just for ranking first', () => {
    const scored = enrichHybridLexicalScores([
        { id: 'a', text: 'silver breakfast' }, { id: 'b', text: 'key weather' },
    ], ['silver key']);
    assert.ok(scored.every(item => item.lexicalScore > 0 && item.lexicalScore <= 0.5));
});

test('semantic paraphrases and aliases still enter through the vector route without word matches', () => {
    const records = [
        { id: 'semantic', text: '今后有我在，没人能伤你。', embeddingScore: 0.91 },
        { id: 'literal', text: '他答应保护另一位访客。', embeddingScore: 0.25 },
    ];
    assert.equal(selectHybridCandidates(records, ['他什么时候答应保护我'])[0].id, 'semantic');
    const alias = selectHybridCandidates([{ id: 'alias', text: '塞巴斯蒂安递出戒指。', embeddingScore: 0.88 }], ['那位恶魔管家的信物']);
    assert.equal(alias[0].id, 'alias');
});

test('explicit long phrases keep exact matching and input scores remain immutable and finite', () => {
    const records = [{ id: '1', title: '誓言', text: '我们约定此生不再背弃彼此。', embeddingScore: 0.1 }];
    const before = structuredClone(records);
    const hits = selectHybridCandidates(records, [], ['此生不再背弃彼此']);
    assert.equal(hits[0].keywordHits, 1);
    assert.ok(hits[0].lexicalScore > 0);
    assert.deepEqual(records, before);
    assert.ok(Number.isFinite(hits[0].hybridScore));
    assert.deepEqual(enrichHybridLexicalScores([], ['key']), []);
    assert.equal(enrichHybridLexicalScores([{ id: 'empty', text: '' }], ['key'])[0].lexicalScore, 0);
});

test('cold preparation yields in batches, warm queries do not yield, and cancellation preserves consistency', async () => {
    const index = createBm25Index();
    const records = Array.from({ length: 32 }, (_, i) => ({ id: String(i), text: 'promise ' + i }));
    let yields = 0;
    assert.equal(await index.prepare(records, { yieldToUi: async () => { yields++; } }), true);
    assert.equal(yields, 2);
    assert.equal(await index.prepare(records, { yieldToUi: async () => { yields++; } }), true);
    assert.equal(yields, 2);
    const oldScore = index.score(records, ['promise']).map(x => x.bm25Score);
    let active = true;
    const changed = records.map(r => ({ ...r, text: 'new ' + r.id }));
    assert.equal(await index.prepare(changed, { yieldToUi: async () => { active = false; }, isCurrent: () => active }), false);
    assert.deepEqual(index.score(records, ['promise']).map(x => x.bm25Score), oldScore);
    let release;
    const pending = index.prepare(changed, { yieldToUi: () => new Promise(resolve => { release = resolve; }) });
    index.clear(); release();
    assert.equal(await pending, false);
    assert.equal(index.stats().documents, 0);
});
