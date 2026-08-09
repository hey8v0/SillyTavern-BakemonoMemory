import { getHash } from '../shared/text.js';

/**
 * Pure local-vector helpers. API calls, caching and SillyTavern state belong in
 * the vector service layer, not in this mathematical core.
 */

export function tokenizeForVector(text) {
    const normalized = String(text || '')
        .toLowerCase()
        .replace(/<[^>]+>/g, ' ')
        .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ')
        .trim();
    const tokens = normalized.match(/[\p{L}\p{N}]{2,}|[\u4e00-\u9fff]/gu) || [];
    const compact = normalized.replace(/\s+/g, '');
    for (let index = 0; index + 2 <= compact.length; index++) {
        tokens.push(compact.slice(index, index + 2));
    }
    for (let index = 0; index + 3 <= compact.length; index += 2) {
        tokens.push(compact.slice(index, index + 3));
    }
    return tokens;
}

export function createLocalEmbedding(text, dimensions = 192) {
    const vector = Array(dimensions).fill(0);
    for (const token of tokenizeForVector(text)) {
        const hash = parseInt(getHash(token), 16);
        const index = hash % dimensions;
        const sign = hash & 1 ? 1 : -1;
        vector[index] += sign * (1 + Math.min(token.length, 6) / 10);
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map(value => Number((value / norm).toFixed(6)));
}

export function cosineSimilarity(a = [], b = []) {
    const length = Math.min(a.length, b.length);
    if (!length) {
        return 0;
    }
    let sum = 0;
    for (let index = 0; index < length; index++) {
        sum += Number(a[index] || 0) * Number(b[index] || 0);
    }
    return sum;
}
