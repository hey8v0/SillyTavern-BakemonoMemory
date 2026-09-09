const fallbackVectorDefaults = {
    embeddingDimensions: 128,
    maxStoredTextChars: 1200,
    perMessageMaxChars: 1600,
};

export function compactEmbedding(values = [], dimensions = fallbackVectorDefaults.embeddingDimensions) {
    const source = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
    if (!source.length) {
        return [];
    }
    const normalize = vector => {
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
        return vector.map(value => Number((value / norm).toFixed(6)));
    };
    return normalize(source);
}

export function encodeEmbedding(values) {
    if (!Array.isArray(values) || !values.length || !values.every(Number.isFinite)) return '';
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat32(index * 4, value, true));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return 'f32:' + btoa(binary);
}

export function decodeEmbedding(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.startsWith('f32:')) return [];
    try {
        const binary = atob(value.slice(4));
        if (!binary.length || binary.length % 4 || binary.length > 65536) return [];
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const view = new DataView(bytes.buffer);
        const vector = Array.from({ length: bytes.length / 4 }, (_, i) => view.getFloat32(i * 4, true));
        return vector.every(Number.isFinite) ? vector : [];
    } catch { return []; }
}

export function hydrateVectorRecords(vectorMemory) {
    for (const record of vectorMemory?.records || []) {
        if (typeof record.embedding !== 'string') continue;
        record.embedding = decodeEmbedding(record.embedding);
        if (!record.embedding.length) {
            vectorMemory.dirty = true;
            vectorMemory.lastIndexedSignature = '';
        }
    }
}

export function serializeVectorMemory(vectorMemory) {
    return { ...vectorMemory, embeddingCache: {},
        records: (vectorMemory.records || []).map(record => ({
            ...record, embedding: typeof record.embedding === 'string' ? record.embedding : encodeEmbedding(record.embedding),
        })),
    };
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
            embedding: record.embeddingFormat === 'native-v1' ? record.embedding : compactEmbedding(record.embedding, dimensions),
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
