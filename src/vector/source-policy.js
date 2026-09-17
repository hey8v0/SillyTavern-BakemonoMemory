// RP state has its own context slot. Old RP-derived vectors are disposable.
export function isRpVectorRecord(record) {
    return String(record?.id || '').startsWith('vec-rp-')
        || String(record?.memoryHash || '').startsWith('rp:')
        || String(record?.summaryType || '').startsWith('rp-');
}

export function removeRpVectorCache(vectorMemory) {
    if (!vectorMemory) return false;
    let changed = false;
    for (const key of ['records', 'lastHits', 'lastEmbeddingCandidates', 'lastRerankCandidates']) {
        const items = vectorMemory[key];
        if (!Array.isArray(items) || !items.some(isRpVectorRecord)) continue;
        vectorMemory[key] = items.filter(item => !isRpVectorRecord(item));
        if (key === 'lastHits') vectorMemory.estimatedChars = 0;
        changed = true;
    }
    return changed;
}
