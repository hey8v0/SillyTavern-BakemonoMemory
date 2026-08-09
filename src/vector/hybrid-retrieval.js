const CJK_STOP_CHARACTERS = new Set('的了是在与和及或也都而被把对从为有还就又很这那中上下来去后前着过于将并但则所其之'.split(''));
const LATIN_TERM_PATTERN = /[a-z0-9][a-z0-9_.-]+/g;
const CJK_SEQUENCE_PATTERN = /[\u3400-\u9fff]+/g;

function unique(values = []) {
    return [...new Set(values.filter(Boolean))];
}

function normalizeLexicalText(value = '') {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function isUsefulCjkGram(value = '') {
    const characters = [...String(value || '')];
    return characters.length >= 2 && characters.filter(character => !CJK_STOP_CHARACTERS.has(character)).length >= 2;
}

function tokenizeHybridText(value = '', options = {}) {
    const normalized = normalizeLexicalText(value);
    if (!normalized) {
        return [];
    }
    const terms = [];
    for (const term of normalized.match(LATIN_TERM_PATTERN) || []) {
        if (term.length >= 2) {
            terms.push(term);
        }
    }
    for (const sequence of normalized.match(CJK_SEQUENCE_PATTERN) || []) {
        if (sequence.length >= 2 && sequence.length <= 12 && isUsefulCjkGram(sequence)) {
            terms.push(sequence);
        }
        for (const size of [2, 3, 4]) {
            if (sequence.length < size) {
                continue;
            }
            for (let index = 0; index <= sequence.length - size; index += 1) {
                const gram = sequence.slice(index, index + size);
                if (isUsefulCjkGram(gram)) {
                    terms.push(gram);
                }
            }
        }
    }
    return unique(terms).slice(0, Math.max(1, Number(options.maxTerms || 180)));
}

export function createHybridQueryTerms(queries = [], keywordTerms = [], options = {}) {
    const explicitKeywords = unique((Array.isArray(keywordTerms) ? keywordTerms : [])
        .map(term => normalizeLexicalText(term))
        .filter(term => term.length >= 2));
    const generatedTerms = (Array.isArray(queries) ? queries : [])
        .flatMap(query => tokenizeHybridText(query, options));
    return {
        terms: unique([...explicitKeywords, ...generatedTerms]).slice(0, Math.max(1, Number(options.maxTerms || 180))),
        explicitKeywords,
    };
}

function getRecordSearchText(record = {}) {
    return normalizeLexicalText(`${record.title || ''}\n${record.summary || ''}\n${record.text || ''}`);
}

function buildDocumentFrequency(records = [], terms = []) {
    const frequencies = new Map(terms.map(term => [term, 0]));
    for (const record of records) {
        const haystack = getRecordSearchText(record);
        for (const term of terms) {
            if (haystack.includes(term)) {
                frequencies.set(term, (frequencies.get(term) || 0) + 1);
            }
        }
    }
    return frequencies;
}

function getInverseDocumentFrequency(documentCount, frequency) {
    return Math.log(1 + (documentCount - frequency + 0.5) / (frequency + 0.5));
}

export function enrichHybridLexicalScores(records = [], queries = [], keywordTerms = [], options = {}) {
    const source = Array.isArray(records) ? records : [];
    const { terms, explicitKeywords } = createHybridQueryTerms(queries, keywordTerms, options);
    if (!source.length || !terms.length) {
        return source.map(record => ({
            ...record,
            lexicalScore: 0,
            keywordHits: 0,
            matchedTerms: [],
            matchedKeywords: [],
        }));
    }
    const frequencies = buildDocumentFrequency(source, terms);
    const weights = new Map(terms
        .filter(term => Number(frequencies.get(term) || 0) > 0)
        .map(term => [term, getInverseDocumentFrequency(source.length, frequencies.get(term) || 0)]));
    const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0) || 1;
    return source.map(record => {
        const haystack = getRecordSearchText(record);
        const matchedTerms = terms.filter(term => haystack.includes(term));
        const matchedKeywords = explicitKeywords.filter(term => haystack.includes(term));
        const matchedWeight = matchedTerms.reduce((sum, term) => sum + (weights.get(term) || 0), 0);
        return {
            ...record,
            lexicalScore: Math.max(0, Math.min(1, matchedWeight / totalWeight)),
            keywordHits: matchedKeywords.length,
            matchedTerms: matchedTerms
                .slice()
                .sort((a, b) => b.length - a.length || a.localeCompare(b))
                .slice(0, Math.max(1, Number(options.maxMatchedTerms || 8))),
            matchedKeywords,
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
