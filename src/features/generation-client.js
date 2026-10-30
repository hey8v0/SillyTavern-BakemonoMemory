import { runApiRequest } from '../shared/request-policy.js';
import { buildTavernCustomRequest, getQianfanPersonalModelCatalog, tavernChatCompletionsUrl, tavernModelsUrl } from '../vector/provider-config.js';

// The request field that turns a model's thinking off, for the APIs known to have one. A thinking model spends most of
// its output allowance on thinking, and summaries and 整理 gain little from it. An API that refuses the field gets the
// request again without it (see callGenerationModel). Picked by the address first where the provider sets the protocol.
export function thinkingOffParams(model, baseUrl) {
    const where = `${model || ''} ${baseUrl || ''}`;
    if (/qwen|qianwen|tongyi|dashscope|siliconflow/i.test(where)) return { enable_thinking: false };
    if (/glm|zhipu|bigmodel|z\.ai|doubao|volces|\bark\.|kimi|moonshot|deepseek/i.test(where)) return { thinking: { type: 'disabled' } };
    if (/gemini|googleapis/i.test(where) || /^(?:.*\/)?(?:o\d|gpt-5)/i.test(String(model || ''))) return { reasoning_effort: 'low' };
    return null;
}

const readUsage = data => {
    const usage = data?.usage;
    if (!usage || typeof usage !== 'object') return null;
    const input = Number(usage.prompt_tokens ?? usage.input_tokens) || 0, output = Number(usage.completion_tokens ?? usage.output_tokens) || 0;
    const reasoning = Number(usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens) || 0;
    return input || output ? { input, output, reasoning } : null;
};

// Raising the limit is the wrong advice when thinking took the allowance: it only costs more.
function outputLimitError(usage, thinkingAdvice = '请在接口设置里打开“关闭模型思考”，或换一个不带思考的模型。') {
    const count = value => value.toLocaleString('en-US');
    const error = new Error(usage?.reasoning && usage.reasoning >= usage.output / 2
        ? `模型输出达到长度上限：${count(usage.output)} 个输出 token 里有 ${count(usage.reasoning)} 个花在思考上，调高上限只会多花钱。${thinkingAdvice}`
        : '模型输出达到长度上限，结果可能被截断；请减小批次，或提高输出上限后重试。');
    error.code = 'output_limit';
    return error;
}

export function createGenerationClient({
    ensureState,
    generateRaw,
    normalizeCustomApiBaseUrl,
    getCustomChatCompletionsUrl,
    defaultAutomation,
    fetchImpl,
    readCustomApiFieldsFromUi,
    toastr,
    getCustomModelsUrl,
    extractCustomModelIds,
    renderCustomModelOptions,
    formatApiFailure = response => `接口请求失败：${response.status} ${response.statusText}`,
    getTavernHeaders = () => ({}),
    requestTimeoutMs = 300000,
} = {}) {
    let modelRequest = 0;
    // Address and model pairs that refused the thinking field this session.
    const thinkingRefused = new Set();
    function checkFinishReason(reason, usage, thinkingAdvice) {
        if (reason === 'length') throw outputLimitError(usage, thinkingAdvice);
        if (reason && reason !== 'stop') throw new Error(`模型未正常完成输出（${reason}），本次未作为完整摘要保存。`);
    }

    async function callGenerationModel({ prompt, systemPrompt, signal, onUsage }) {
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
        const viaTavern = !!config.viaTavern;
        const action = viaTavern ? '自定义 API 请求失败（经酒馆转发）' : '自定义 API 请求失败';
        const thinkingKey = `${baseUrl}|${model}`;
        const thinkingOff = config.disableThinking !== false && !thinkingRefused.has(thinkingKey) ? thinkingOffParams(model, baseUrl) : null;
        let refused = false;
        // What to do about thinking that ate the output, by what this request did about it.
        const adviceFor = extraParams => extraParams ? '这个接口没有理会“关闭模型思考”，请换一个不带思考的模型。'
            : config.disableThinking === false ? undefined
            : '插件没法替这个接口关闭思考，请在服务商那边关掉，或换一个不带思考的模型。';
        const send = extraParams => runApiRequest({ url: viaTavern ? tavernChatCompletionsUrl : getCustomChatCompletionsUrl(baseUrl), fetchImpl, signal,
            timeoutMs: requestTimeoutMs,
            formatError: response => { refused = [400, 422].includes(response.status); return formatApiFailure(response, action); },
            init: {
            method: 'POST',
            headers: viaTavern ? { ...getTavernHeaders(), 'Content-Type': 'application/json' } : {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
                ...(viaTavern ? buildTavernCustomRequest(baseUrl, apiKey) : {}),
                model,
                messages: [
                    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                    { role: 'user', content: prompt },
                ],
                temperature: Number(config.temperature ?? defaultAutomation.customApi.temperature),
                max_tokens: Number(config.maxTokens ?? defaultAutomation.customApi.maxTokens),
                stream,
                // The relay passes on only the fields it knows, plus what custom_include_body adds.
                ...(extraParams ? viaTavern ? { custom_include_body: JSON.stringify(extraParams) } : extraParams : {}),
            }),
        }, consume: async response => {
        if (stream) {
            return await readOpenAIStream(response, { onUsage, thinkingAdvice: adviceFor(extraParams) });
        }
        const data = await response.json();
        // SillyTavern answers a failed upstream request with 200 and { error: { message } }.
        if (viaTavern && data?.error) {
            refused = true;
            throw new Error(`${action}：${data.error.message || '服务商返回错误'}。请检查接口地址、密钥和模型。`);
        }
        const usage = readUsage(data);
        if (usage) onUsage?.(usage);
        checkFinishReason(data?.choices?.[0]?.finish_reason, usage, adviceFor(extraParams));
        const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
        if (!content) {
            throw new Error('自定义 API 没有返回可用内容。');
        }
        return content;
        } });
        try {
            return await send(thinkingOff);
        } catch (error) {
            if (!thinkingOff || !refused || signal?.aborted) throw error;
            // Through the relay a rejected field looks like any other failure (200 with { error }, or 400 when streaming), so
            // only an answer without the field tells.
            const answer = await send(null);
            thinkingRefused.add(thinkingKey);
            return answer;
        }
    }
    
    async function readOpenAIStream(response, { onUsage, thinkingAdvice } = {}) {
        if (!response.body?.getReader) {
            throw new Error('当前浏览器无法读取自定义 API 的流式响应，请改用非流式。');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        let finished = false;
        let usage = null;
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
            const chunkUsage = readUsage(data);
            if (chunkUsage) { usage = chunkUsage; onUsage?.(usage); }
            const reason = data?.choices?.[0]?.finish_reason;
            checkFinishReason(reason, usage, thinkingAdvice);
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
        const savedConfig = state.automation.customApi, revision = state.activeConfigSignature;
        const request = ++modelRequest;
        const readDraft = () => {
            const draft = { ...state, automation: { ...state.automation, customApi: { ...savedConfig } } };
            readCustomApiFieldsFromUi(draft);
            return draft.automation.customApi || {};
        };
        const config = readDraft(), expected = JSON.stringify(config);
        const baseUrl = normalizeCustomApiBaseUrl(config.baseUrl);
        const apiKey = String(config.apiKey || '').trim();
        if (!baseUrl) {
            toastr.warning('请先填写自定义接口地址。');
            return false;
        }
        const toast = toastr.info('正在拉取模型列表...', '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
        try {
            const catalog = getQianfanPersonalModelCatalog(baseUrl);
            let models = catalog?.models;
            if (!catalog && config.viaTavern) {
                const response = await fetchImpl(tavernModelsUrl, {
                    method: 'POST',
                    headers: { ...getTavernHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildTavernCustomRequest(baseUrl, apiKey)),
                });
                if (!response.ok) throw new Error(formatApiFailure(response, '拉取模型失败（经酒馆转发）'));
                const data = await response.json();
                // SillyTavern reports a failed upstream check as 200 with { error: true }.
                if (data?.error) throw new Error('拉取模型失败（经酒馆转发）：服务商没有返回模型列表，请检查接口地址和密钥。');
                models = extractCustomModelIds(data);
            } else if (!catalog) {
                const response = await fetchImpl(getCustomModelsUrl(baseUrl), {
                    method: 'GET',
                    headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
                });
                if (!response.ok) throw new Error(formatApiFailure(response, '拉取模型失败'));
                models = extractCustomModelIds(await response.json());
            }
            if (ensureState() !== state || state.automation.customApi !== savedConfig
                || state.activeConfigSignature !== revision || request !== modelRequest || JSON.stringify(readDraft()) !== expected) {
                throw new Error('聊天或接口配置已切换，请在当前配置重新拉取模型。');
            }
            if (!models.length) {
                throw new Error('接口返回里没有找到模型 ID。');
            }
            renderCustomModelOptions(models, { refresh: true });
            if (catalog) toastr.info(catalog.notice, '模型候选');
            else toastr.success(`已拉取 ${models.length} 个模型候选。`);
            return true;
        } catch (error) {
            toastr.error(error?.message || String(error), '模型拉取失败');
            return false;
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
