const fallbackVectorDefaults = {
    embeddingDimensions: 128,
    maxStoredTextChars: 1200,
    perMessageMaxChars: 1600,
};

export function compactEmbedding(values = [], dimensions = fallbackVectorDefaults.embeddingDimensions) {
    const source = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
    const targetSize = Math.max(32, Math.min(384, Number(dimensions || fallbackVectorDefaults.embeddingDimensions)));
    if (!source.length) {
        return [];
    }
    const normalize = vector => {
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
        return vector.map(value => Number((value / norm).toFixed(6)));
    };
    if (source.length <= targetSize) {
        return normalize(source);
    }
    const compact = [];
    for (let index = 0; index < targetSize; index++) {
        const start = Math.floor(index * source.length / targetSize);
        const end = Math.max(start + 1, Math.floor((index + 1) * source.length / targetSize));
        const slice = source.slice(start, end);
        const average = slice.reduce((sum, value) => sum + value, 0) / slice.length;
        compact.push(average);
    }
    return normalize(compact);
}

export function getClippedVectorText(value, limit = fallbackVectorDefaults.maxStoredTextChars) {
    const text = String(value || '');
    const max = Math.max(240, Number(limit || fallbackVectorDefaults.maxStoredTextChars));
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function slimVectorMemoryForSave(vectorMemory = null, defaults = fallbackVectorDefaults) {
    if (!vectorMemory || typeof vectorMemory !== 'object') {
        return;
    }
    const dimensions = Math.max(32, Number(vectorMemory.embeddingDimensions || defaults.embeddingDimensions));
    const textLimit = Math.max(240, Number(vectorMemory.maxStoredTextChars || defaults.maxStoredTextChars));
    vectorMemory.embeddingCache = {};
    vectorMemory.records = Array.isArray(vectorMemory.records)
        ? vectorMemory.records.map(record => ({
            ...record,
            text: getClippedVectorText(record.text, textLimit),
            matchedText: getClippedVectorText(record.matchedText, Math.min(textLimit, 480)),
            embedding: compactEmbedding(record.embedding, dimensions),
        }))
        : [];
    vectorMemory.lastHits = Array.isArray(vectorMemory.lastHits)
        ? vectorMemory.lastHits.map(hit => ({
            ...hit,
            text: getClippedVectorText(hit.text, Math.max(textLimit, Number(vectorMemory.perMessageMaxChars || defaults.perMessageMaxChars))),
            matchedText: getClippedVectorText(hit.matchedText, Math.min(textLimit, 480)),
        }))
        : [];
}
