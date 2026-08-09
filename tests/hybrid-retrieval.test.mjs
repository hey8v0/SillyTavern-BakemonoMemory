import assert from 'node:assert/strict';
import test from 'node:test';

import {
    computeHybridRerankScore,
    createHybridQueryTerms,
    enrichHybridLexicalScores,
    selectHybridCandidates,
} from '../src/vector/hybrid-retrieval.js';

test('hybrid candidates union semantic and low-similarity lexical matches', () => {
    const records = [
        { id: 'semantic', messageId: 10, title: '雨夜', text: '两人在屋檐下交谈。', embeddingScore: 0.84 },
        { id: 'lexical', messageId: 20, title: '银钥匙', text: 'Nana 把银钥匙交给 Kuroha，并要求她保守承诺。', embeddingScore: 0.05 },
        { id: 'noise', messageId: 30, title: '早餐', text: '今天吃了面包。', embeddingScore: 0.03 },
    ];

    const candidates = selectHybridCandidates(records, ['寻找银钥匙与旧承诺'], [], {
        embeddingThreshold: 0.22,
        candidateCount: 4,
    });

    assert.deepEqual(new Set(candidates.map(item => item.id)), new Set(['semantic', 'lexical']));
    assert.ok(candidates.find(item => item.id === 'lexical').lexicalScore > 0);
});

test('rare exact terms contribute more lexical evidence than common fragments', () => {
    const records = [
        { id: 'rare', text: 'Seraphina 将戒指藏进旧剧院。' },
        { id: 'common-a', text: '他们重新提到了过去的承诺。' },
        { id: 'common-b', text: '这份承诺至今仍然有效。' },
    ];
    const scored = enrichHybridLexicalScores(records, ['Seraphina 的戒指与承诺'], []);
    const rare = scored.find(item => item.id === 'rare');
    const common = scored.find(item => item.id === 'common-a');

    assert.ok(rare.lexicalScore > common.lexicalScore);
    assert.ok(rare.matchedTerms.some(term => term.includes('seraphina')));
});

test('configured keyword boost participates in the final score', () => {
    const score = computeHybridRerankScore({
        embeddingScore: 0,
        lexicalScore: 0,
        keywordHits: 1,
    }, {
        keywordBoost: 0.27,
        explicitKeywordCount: 1,
    });

    assert.equal(score, 0.27);
});

test('query term extraction creates bounded Chinese ngrams and preserves explicit keywords', () => {
    const result = createHybridQueryTerms(['她是否兑现了旧日承诺？'], ['银钥匙'], { maxTerms: 40 });

    assert.ok(result.terms.length <= 40);
    assert.ok(result.terms.includes('银钥匙'));
    assert.ok(result.terms.includes('承诺'));
    assert.deepEqual(result.explicitKeywords, ['银钥匙']);
});
