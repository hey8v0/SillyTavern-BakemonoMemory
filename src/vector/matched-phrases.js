import { normalizeLexicalText } from './bm25-index.js';

// Presentation only: a phrase must occur contiguously in both query and source.
export function getMatchedPhrases(record, queries = [], keywords = []) {
    const source = normalizeLexicalText([record.text, record.summary, record.title].filter(Boolean).join('\n'));
    const query = normalizeLexicalText(queries.join('\n'));
    const exact = keywords.map(normalizeLexicalText).filter(term => term.length >= 2 && source.includes(term));
    const phrases = new Set(exact);
    for (const word of query.match(/[a-z0-9][a-z0-9_.-]+/g) || []) {
        if ((source.match(/[a-z0-9][a-z0-9_.-]+/g) || []).includes(word)) phrases.add(word);
    }
    for (const run of query.match(/[\u3400-\u9fff]+/g) || []) {
        for (let start = 0; start < run.length;) {
            let length = Math.min(32, run.length - start);
            while (length >= 3 && !source.includes(run.slice(start, start + length))) length--;
            if (length >= 3) {
                phrases.add(run.slice(start, start + length));
                start += length;
            } else start++;
        }
    }
    const ordered = [...phrases].sort((a, b) => Number(exact.includes(b)) - Number(exact.includes(a)) || b.length - a.length || a.localeCompare(b));
    return ordered.filter(term => !ordered.some(other => other !== term && other.includes(term))).slice(0, 8);
}
