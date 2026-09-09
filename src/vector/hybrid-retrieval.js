import { createBm25Index, normalizeLexicalText, tokenizeBm25Text } from './bm25-index.js';

function unique(values = []) {
    return [...new Set(values.filter(Boolean))];
}

function tokenizeHybridText(value = '', options = {}) {
    return unique(tokenizeBm25Text(value)).slice(0, Math.max(1, Number(options.maxTerms || 180)));
}

export function createHybridQueryTerms(queries = [], keywordTerms = [], options = {}) {
    const explicitKeywords = unique((Array.isArray(keywordTerms) ? keywordTerms : [])
        .map(term => normalizeLexicalText(term))
        .filter(term => term.length >= 2));
    const generatedTerms = (Array.isArray(queries) ? queries : [])
        .flatMap(query => tokenizeHybridText(query, options));
    return {
        terms: unique([...explicitKeywords, ...explicitKeywords.flatMap(term => tokenizeHybridText(term, options)), ...generatedTerms])
            .slice(0, Math.max(1, Number(options.maxTerms || 180))),
        explicitKeywords,
    };
}

export function enrichHybridLexicalScores(records = [], queries = [], keywordTerms = [], options = {}) {
    const source = Array.isArray(records) ? records : [];
    const { terms, explicitKeywords } = createHybridQueryTerms(queries, keywordTerms, options);
    const index = options.lexicalIndex || createBm25Index();
    const scores = index.score(source, terms, explicitKeywords);
    return source.map((record, i) => {
        const { matchedTerms, ...score } = scores[i];
        return {
            ...record,
            ...score,
            matchedTerms: matchedTerms
                .slice()
                .sort((a, b) => b.length - a.length || a.localeCompare(b))
                .slice(0, Math.max(1, Number(options.maxMatchedTerms || 8))),
        };
    });
}

export function computeHybridRerankScore(record = {}, options = {}) {
    const semanticWeight = Math.max(0, Number(options.semanticWeight ?? 0.68));
    const lexicalWeight = Math.max(0, Number(options.lexicalWeight ?? 0.32));
    const keywordBoost = Math.max(0, Number(options.keywordBoost ?? 0.18));
    const embeddingScore = Math.max(0, Math.min(1, Number(record.embeddingScore ?? record.similarity ?? 0)));
    const lexicalScore = Math.max(0, Math.min(1, Number(record.lexicalScore || 0)));
    const keywordCount = Array.isArray(record.matchedKeywords)
        ? record.matchedKeywords.length
        : Math.max(0, Number(record.keywordHits || 0));
    const totalKeywords = Math.max(1, Number(options.explicitKeywordCount || keywordCount || 1));
    const keywordScore = Math.min(1, keywordCount / totalKeywords);
    return Math.max(0, Math.min(1,
        embeddingScore * semanticWeight
        + lexicalScore * lexicalWeight
        + keywordScore * keywordBoost,
    ));
}

function rankOf(records = []) {
    return new Map(records.map((record, index) => [record.id, index + 1]));
}

export function selectHybridCandidates(records = [], queries = [], keywordTerms = [], options = {}) {
    const candidateCount = Math.max(1, Number(options.candidateCount || 20));
    const embeddingThreshold = Math.max(0, Number(options.embeddingThreshold || 0));
    const explicitKeywordCount = createHybridQueryTerms([], keywordTerms, options).explicitKeywords.length;
    const enriched = enrichHybridLexicalScores(records, queries, keywordTerms, options);
    const vectorRanked = enriched
        .filter(record => Number(record.embeddingScore || 0) >= embeddingThreshold)
        .slice()
        .sort((a, b) => Number(b.embeddingScore || 0) - Number(a.embeddingScore || 0))
        .slice(0, candidateCount);
    const lexicalRanked = enriched
        .filter(record => Number(record.lexicalScore || 0) > 0)
        .slice()
        .sort((a, b) => Number(b.lexicalScore || 0) - Number(a.lexicalScore || 0)
            || Number(b.keywordHits || 0) - Number(a.keywordHits || 0)
            || Number(b.messageId || 0) - Number(a.messageId || 0))
        .slice(0, candidateCount);
    const keywordRanked = enriched
        .filter(record => Number(record.keywordHits || 0) > 0)
        .slice()
        .sort((a, b) => Number(b.keywordHits || 0) - Number(a.keywordHits || 0)
            || Number(b.lexicalScore || 0) - Number(a.lexicalScore || 0))
        .slice(0, candidateCount);
    const vectorRanks = rankOf(vectorRanked);
    const lexicalRanks = rankOf(lexicalRanked);
    const keywordRanks = rankOf(keywordRanked);
    const candidateIds = new Set([
        ...vectorRanked.map(record => record.id),
        ...lexicalRanked.map(record => record.id),
        ...keywordRanked.map(record => record.id),
    ]);
    return enriched
        .filter(record => candidateIds.has(record.id))
        .map(record => {
            const hybridScore = computeHybridRerankScore(record, {
                keywordBoost: options.keywordBoost,
                explicitKeywordCount,
            });
            const reciprocalRankScore = [
                vectorRanks.get(record.id),
                lexicalRanks.get(record.id),
                keywordRanks.get(record.id),
            ].filter(Boolean).reduce((sum, rank) => sum + 1 / (60 + rank), 0);
            return {
                ...record,
                hybridScore,
                reciprocalRankScore,
                vectorRank: vectorRanks.get(record.id) || 0,
                lexicalRank: lexicalRanks.get(record.id) || 0,
            };
        })
        .sort((a, b) => Number(b.hybridScore || 0) - Number(a.hybridScore || 0)
            || Number(b.reciprocalRankScore || 0) - Number(a.reciprocalRankScore || 0)
            || Number(b.embeddingScore || 0) - Number(a.embeddingScore || 0)
            || Number(b.messageId || 0) - Number(a.messageId || 0))
        .slice(0, candidateCount * 2);
}
