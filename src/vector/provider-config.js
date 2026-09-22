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

// Official catalog snapshot, not an authenticated account/model-list response.
// https://cloud.baidu.com/doc/qianfan/s/Dmrabu8b6 (checked 2026-09-22)
const qianfanPersonalModels = Object.freeze([
    'qianfan-code-latest',
    'deepseek-v4-pro', 'deepseek-v4-pro-0813', 'deepseek-v4-flash', 'deepseek-v4-flash-0731',
    'glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'kimi-k2.6',
]);

export function getQianfanPersonalModelCatalog(baseUrl, purpose = 'chat') {
    let url;
    try { url = new URL(normalizeCustomApiBaseUrl(baseUrl)); } catch { return null; }
    if (url.origin !== 'https://qianfan.baidubce.com' || url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, '');
    if (/^\/anthropic\/tokenplan\/personal(?:\/v1\/(?:messages|models))?$/.test(path)) {
        throw new Error('此处使用 OpenAI 协议，请填写千帆个人版地址 https://qianfan.baidubce.com/v2/tokenplan/personal。');
    }
    if (!/^\/v2\/tokenplan\/personal(?:\/(?:chat\/completions|models|embeddings?))?$/.test(path)) return null;
    if (purpose === 'embedding') throw new Error('千帆 Token Plan 个人版不提供嵌入模型候选；请为向量索引配置独立的嵌入接口。');
    return {
        source: 'official-catalog', models: [...qianfanPersonalModels],
        notice: '已加载千帆个人版官方文档候选（2026-09-22）；未验证接口密钥，实际可用模型以套餐为准。',
    };
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
