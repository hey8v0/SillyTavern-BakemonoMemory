export function normalizeCustomApiBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

export function getCustomChatCompletionsUrl(baseUrl) {
    return getApiEndpoint(baseUrl, 'chat/completions');
}

export function getCustomModelsUrl(baseUrl) {
    return getApiEndpoint(baseUrl, 'models');
}

export function getCustomEmbeddingsUrl(baseUrl) {
    return getApiEndpoint(baseUrl, 'embeddings');
}

function getApiEndpoint(baseUrl, endpoint) {
    const url = new URL(normalizeCustomApiBaseUrl(baseUrl));
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('接口地址必须使用 http 或 https。');
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|embeddings?|models)$/i, '') + `/${endpoint}`;
    url.hash = '';
    return url.toString();
}

// Names are hints, not capability verification. Unknown/private models remain available.
export function extractEmbeddingModelCandidates(payload) {
    const all = extractCustomModelIds(payload);
    const candidates = all.filter(id => /embed|\bbge\b|\be5[-_]|gte[-_]|jina[-_]embeddings/i.test(id) && !/rerank/i.test(id));
    return candidates.length ? candidates : all;
}

export function formatApiFailure(response, action = '接口请求失败') {
    const status = Number(response?.status);
    const advice = {
        401: '认证失败，请检查此接口的密钥；只填密钥本身，不要附加 Bearer。',
        403: '访问被拒绝，请检查账户权限或服务商限制。',
        404: '地址或模型不存在，请检查基础地址（通常以 /v1 结尾）和模型 ID。',
        429: '请求限流或额度不足，请检查服务商额度并稍后重试。',
    }[status] || (status >= 500 ? '服务商暂时异常，请稍后重试。' : '请检查接口配置和服务商状态。');
    return `${action}：${status || '未知状态'}。${advice}`;
}

export function extractCustomModelIds(payload) {
    const models = Array.isArray(payload?.data)
        ? payload.data.map(item => item?.id || item?.name).filter(Boolean)
        : [];
    return [...new Set(models.map(item => String(item).trim()).filter(Boolean))].sort();
}
