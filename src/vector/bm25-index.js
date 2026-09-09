const CJK_STOP_CHARACTERS = new Set('的了是在与和及或也都而被把对从为有还就又很这那中上下来去后前着过于将并但则所其之');

export function normalizeLexicalText(value = '') {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function tokenizeBm25Text(value = '') {
    const normalized = normalizeLexicalText(value);
    const terms = normalized.match(/[a-z0-9][a-z0-9_.-]+/g) || [];
    const useful = word => [...word].filter(char => !CJK_STOP_CHARACTERS.has(char)).length >= 2;
    for (const sequence of normalized.match(/[\u3400-\u9fff]+/g) || []) {
        if (sequence.length > 2 && sequence.length <= 12 && useful(sequence)) terms.push(sequence);
        // Bigrams retain Chinese name fragments without requiring a dictionary.
        for (let i = 0; i + 2 <= sequence.length; i++) {
            const gram = sequence.slice(i, i + 2);
            if (useful(gram)) terms.push(gram);
        }
    }
    return terms;
}

export function createBm25Index({ tokenize = tokenizeBm25Text } = {}) {
    const documents = new Map();
    const postings = new Map();
    let totalLength = 0, nonEmptyDocuments = 0, tokenizedDocuments = 0;
    let prepareVersion = 0;

    function remove(key) {
        const previous = documents.get(key);
        if (!previous) return;
        totalLength -= previous.length;
        if (previous.length) nonEmptyDocuments--;
        for (const term of previous.frequencies.keys()) {
            const posting = postings.get(term);
            posting.delete(key);
            if (!posting.size) postings.delete(term);
        }
        documents.delete(key);
    }

    function getKeys(records) {
        const occurrences = new Map();
        return records.map((record, i) => {
            const id = record?.id == null ? ['position', i] : ['id', String(record.id)];
            const identity = JSON.stringify(id);
            const occurrence = occurrences.get(identity) || 0;
            occurrences.set(identity, occurrence + 1);
            const key = JSON.stringify([identity, occurrence]);
            return key;
        });
    }

    function update(record, key) {
        const fields = [String(record?.text || ''), String(record?.summary || ''), String(record?.title || '')];
        const previous = documents.get(key);
        if (previous && fields.every((field, index) => field === previous.fields[index])) return false;
        const text = [...new Set(fields.map(normalizeLexicalText).filter(Boolean))].join('\n');
        const terms = tokenize(text);
        const frequencies = new Map();
        for (const term of terms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
        remove(key);
        documents.set(key, { fields, text, frequencies, length: terms.length });
        totalLength += terms.length;
        if (terms.length) nonEmptyDocuments++;
        tokenizedDocuments++;
        for (const [term, frequency] of frequencies) {
            if (!postings.has(term)) postings.set(term, new Map());
            postings.get(term).set(key, frequency);
        }
        return true;
    }

    function prune(keys) {
        const seen = new Set(keys);
        for (const key of documents.keys()) if (!seen.has(key)) remove(key);
    }

    function sync(records) {
        prepareVersion++;
        const keys = getKeys(records);
        records.forEach((record, i) => update(record, keys[i]));
        prune(keys);
        return keys;
    }

    async function prepare(records, { yieldEvery = 16, yieldToUi = () => new Promise(resolve => setTimeout(resolve, 0)), isCurrent = () => true } = {}) {
        const version = ++prepareVersion;
        const keys = getKeys(records);
        let changed = 0;
        if (!isCurrent()) return false;
        for (let i = 0; i < records.length; i++) {
            if (update(records[i], keys[i]) && ++changed % yieldEvery === 0) {
                await yieldToUi();
                if (version !== prepareVersion || !isCurrent()) return false;
            }
        }
        if (version !== prepareVersion || !isCurrent()) return false;
        prune(keys);
        return true;
    }

    function score(records = [], queryTerms = [], keywords = []) {
        const keys = sync(records);
        const scores = new Map();
        const matched = new Map();
        const averageLength = totalLength / Math.max(1, nonEmptyDocuments) || 1;
        const k1 = 1.2, b = 0.75;
        let queryWeight = 0;
        for (const term of new Set(queryTerms.map(normalizeLexicalText).filter(Boolean))) {
            const posting = postings.get(term);
            if (!posting) continue;
            const idf = Math.log(1 + (nonEmptyDocuments - posting.size + 0.5) / (posting.size + 0.5));
            queryWeight += idf;
            for (const [key, frequency] of posting) {
                const length = documents.get(key).length;
                const contribution = idf * frequency * (k1 + 1)
                    / (frequency + k1 * (1 - b + b * length / averageLength));
                scores.set(key, (scores.get(key) || 0) + contribution);
                if (!matched.has(key)) matched.set(key, []);
                matched.get(key).push(term);
            }
        }
        // A partial match should not become a full lexical score just for ranking first.
        let maximum = queryWeight;
        for (const value of scores.values()) maximum = Math.max(maximum, value);
        return keys.map(key => {
            const bm25Score = scores.get(key) || 0;
            const matchedKeywords = keywords.filter(keyword => documents.get(key).text.includes(keyword));
            return { bm25Score, lexicalScore: maximum ? bm25Score / maximum : 0,
                matchedTerms: matched.get(key) || [], matchedKeywords, keywordHits: matchedKeywords.length };
        });
    }

    function clear() {
        prepareVersion++;
        documents.clear();
        postings.clear();
        totalLength = nonEmptyDocuments = tokenizedDocuments = 0;
    }

    return { score, prepare, clear, stats: () => ({ documents: documents.size, terms: postings.size, totalLength, tokenizedDocuments }) };
}
