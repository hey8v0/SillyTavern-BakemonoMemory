import { runApiRequest } from '../shared/request-policy.js';

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
    formatApiFailure = response => `接口请求失败：${response.status} ${response.statusText}`,
    requestTimeoutMs = 300000,
} = {}) {
    function checkFinishReason(reason) {
        if (reason && reason !== 'stop') throw new Error(reason === 'length'
            ? '模型输出达到长度上限，摘要可能被截断；请提高输出上限或减小批次后重试。'
            : `模型未正常完成输出（${reason}），本次未作为完整摘要保存。`);
    }

    async function callGenerationModel({ prompt, systemPrompt, signal }) {
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
        return await runApiRequest({ url: getCustomChatCompletionsUrl(baseUrl), fetchImpl, signal,
            timeoutMs: requestTimeoutMs,
            formatError: response => formatApiFailure(response, '自定义 API 请求失败'),
            init: {
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
        }, consume: async response => {
        if (stream) {
            return await readOpenAIStream(response);
        }
        const data = await response.json();
        checkFinishReason(data?.choices?.[0]?.finish_reason);
        const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
        if (!content) {
            throw new Error('自定义 API 没有返回可用内容。');
        }
        return content;
        } });
    }
    
    async function readOpenAIStream(response) {
        if (!response.body?.getReader) {
            throw new Error('当前浏览器无法读取自定义 API 的流式响应，请改用非流式。');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        let finished = false;
        function readLine(line) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) return;
            const payload = trimmed.slice(5).trim();
            if (!payload) return;
            if (payload === '[DONE]') { finished = true; return; }
            let data;
            try { data = JSON.parse(payload); } catch {
                if (/^[{[]/.test(payload)) throw new Error('自定义 API 流式数据不完整或格式错误，本次未作为完整摘要保存。');
                return; // Non-JSON keep-alive messages from compatible proxies.
            }
            if (data?.error) throw new Error('自定义 API 流式响应返回错误；本次未作为完整摘要保存，请检查服务商额度或重试。');
            const reason = data?.choices?.[0]?.finish_reason;
            checkFinishReason(reason);
            if (reason === 'stop') finished = true;
            content += data?.choices?.[0]?.delta?.content
                || data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
        }
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';
                for (const line of lines) readLine(line);
                if (finished) { await reader.cancel(); break; }
            }
            buffer += decoder.decode();
            for (const line of buffer.split(/\r?\n/)) readLine(line);
        } catch (error) {
            try { await reader.cancel(); } catch {}
            throw error;
        } finally {
            reader.releaseLock();
        }
        if (!content.trim()) {
            throw new Error('自定义 API 流式响应没有返回可用内容。');
        }
        if (!finished) throw new Error('流式连接结束，但没有收到完成标记；可能中途断线，本次未作为完整摘要保存。');
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
                throw new Error(formatApiFailure(response, '拉取模型失败'));
            }
            const data = await response.json();
            if (ensureState() !== state || state.automation.customApi !== config) {
                throw new Error('聊天或接口配置已切换，请在当前配置重新拉取模型。');
            }
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
