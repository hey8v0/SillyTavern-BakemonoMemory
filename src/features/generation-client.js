export function createGenerationClient({
    query,
    ensureState,
    generateRaw,
    normalizeCustomApiBaseUrl,
    getCustomChatCompletionsUrl,
    defaultAutomation,
    fetchImpl,
    readCustomApiFieldsFromUi,
    persistSharedConfigurationFromState,
    toastr,
    getCustomModelsUrl,
    extractCustomModelIds,
    renderCustomModelOptions,
} = {}) {
    async function callGenerationModel({ prompt, systemPrompt }) {
        const state = ensureState();
        if (state.automation.apiProvider !== 'custom') {
            return await generateRaw({ prompt, systemPrompt });
        }
    
        const config = state.automation.customApi || {};
        const baseUrl = normalizeCustomApiBaseUrl(config.baseUrl);
        const model = String(config.model || '').trim();
        const apiKey = String(config.apiKey || '').trim();
        if (!baseUrl || !model) {
            throw new Error('自定义接口需要填写接口地址和模型。');
        }
    
        const stream = !!config.stream;
        const response = await fetchImpl(getCustomChatCompletionsUrl(baseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
                model,
                messages: [
                    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                    { role: 'user', content: prompt },
                ],
                temperature: Number(config.temperature ?? defaultAutomation.customApi.temperature),
                max_tokens: Number(config.maxTokens ?? defaultAutomation.customApi.maxTokens),
                stream,
            }),
        });
        if (!response.ok) {
            throw new Error(`自定义 API 请求失败：${response.status} ${response.statusText}`);
        }
        if (stream) {
            return await readOpenAIStream(response);
        }
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
        if (!content) {
            throw new Error('自定义 API 没有返回可用内容。');
        }
        return content;
    }
    
    async function readOpenAIStream(response) {
        if (!response.body?.getReader) {
            throw new Error('当前浏览器无法读取自定义 API 的流式响应，请改用非流式。');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) {
                    continue;
                }
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === '[DONE]') {
                    continue;
                }
                try {
                    const data = JSON.parse(payload);
                    content += data?.choices?.[0]?.delta?.content
                        || data?.choices?.[0]?.message?.content
                        || data?.choices?.[0]?.text
                        || '';
                } catch {
                    // Some proxies send keep-alive chunks that are not JSON.
                }
            }
        }
        if (!content.trim()) {
            throw new Error('自定义 API 流式响应没有返回可用内容。');
        }
        return content;
    }
    
    async function fetchCustomApiModels() {
        const state = ensureState();
        readCustomApiFieldsFromUi(state);
        persistSharedConfigurationFromState(state);
        const config = state.automation.customApi || {};
        const baseUrl = normalizeCustomApiBaseUrl(config.baseUrl);
        const apiKey = String(config.apiKey || '').trim();
        if (!baseUrl) {
            toastr.warning('请先填写自定义接口地址。');
            return;
        }
        const toast = toastr.info('正在拉取模型列表...', '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
        try {
            const response = await fetchImpl(getCustomModelsUrl(baseUrl), {
                method: 'GET',
                headers: {
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                },
            });
            if (!response.ok) {
                throw new Error(`拉取模型失败：${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            const models = extractCustomModelIds(data);
            if (!models.length) {
                throw new Error('接口返回里没有找到模型 ID。');
            }
            state.automation.customApi.models = models;
            if (!String(state.automation.customApi.model || '').trim()) {
                state.automation.customApi.model = state.automation.customApi.models[0];
                query('#bakemono-memory-custom-model').val(state.automation.customApi.model);
            }
            renderCustomModelOptions(state.automation.customApi.models);
            persistSharedConfigurationFromState(state);
            toastr.success(`已拉取 ${state.automation.customApi.models.length} 个模型。`);
        } catch (error) {
            toastr.error(error?.message || String(error), '模型拉取失败');
        } finally {
            toastr.clear(toast);
        }
    }

    return {
        callGenerationModel,
        fetchCustomApiModels,
        readOpenAIStream,
    };
}
