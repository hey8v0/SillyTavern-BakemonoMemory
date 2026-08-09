export function normalizeCustomApiBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

export function getCustomChatCompletionsUrl(baseUrl) {
    const clean = normalizeCustomApiBaseUrl(baseUrl);
    if (/\/chat\/completions$/i.test(clean)) {
        return clean;
    }
    return `${clean}/chat/completions`;
}

export function getCustomModelsUrl(baseUrl) {
    let clean = normalizeCustomApiBaseUrl(baseUrl);
    clean = clean.replace(/\/chat\/completions$/i, '');
    return `${clean}/models`;
}

export function getCustomEmbeddingsUrl(baseUrl) {
    let clean = normalizeCustomApiBaseUrl(baseUrl);
    clean = clean.replace(/\/chat\/completions$/i, '').replace(/\/embeddings$/i, '');
    return `${clean}/embeddings`;
}

export function extractCustomModelIds(payload) {
    const models = Array.isArray(payload?.data)
        ? payload.data.map(item => item?.id || item?.name).filter(Boolean)
        : [];
    return [...new Set(models.map(item => String(item).trim()).filter(Boolean))].sort();
}
