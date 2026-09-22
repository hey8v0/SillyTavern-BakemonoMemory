export function createVectorActionsController({
    query,
    getState: ensureState,
    readVectorMemoryFieldsFromUi,
    persistSharedConfigurationFromState,
    normalizeCustomApiBaseUrl,
    getCustomModelsUrl,
    extractCustomModelIds,
    extractEmbeddingModelCandidates = extractCustomModelIds,
    formatApiFailure = response => `拉取模型失败：${response.status} ${response.statusText}`,
    renderVectorModelOptions,
    renderVectorQueryModelOptions,
    toastr,
    getVectorSourceSignature,
    markVectorIndexDirty,
    retrieveVectorMemoryHits,
    fetchCustomEmbedding,
    syncInjection,
    renderWorkbenchScope,
    workbenchRenderScopes,
    saveState,
    saveChatConditional = async () => {},
    confirmDanger,
    fetchImpl = globalThis.fetch,
    assertVectorFormCurrent,
    markVectorFormRendered,
    readVectorFormDraft,
    confirmGlobalConfiguration = async () => ({ status: 'unconfirmed' }),
    cancelVectorRecall = () => {},
    clearVectorRecall = () => {},
} = {}) {
    const modelRequests = { embedding: 0, query: 0 };
    let saveRequest = 0;
    async function saveVectorConfiguration(state, label) {
        const request = ++saveRequest;
        cancelVectorRecall(); clearVectorRecall('', state);
        const config = persistSharedConfigurationFromState(state);
        const revision = state.activeConfigSignature;
        markVectorFormRendered?.(state);
        syncInjection();
        const [global, chat] = await Promise.allSettled([
            confirmGlobalConfiguration(config), saveChatConditional(),
        ]);
        if (ensureState() !== state || state.activeConfigSignature !== revision || request !== saveRequest) return false;
        const confirmed = global.status === 'fulfilled' && global.value?.status === 'confirmed';
        const chatDone = chat.status === 'fulfilled';
        const message = `${label}：${confirmed ? '共享配置已核验保存' : '共享配置尚未确认保存，请保持页面并重试应用'}；${chatDone ? '聊天保存请求已完成' : '聊天保存失败，请检查酒馆连接后重试'}。`;
        renderWorkbenchScope(workbenchRenderScopes.VECTOR, message);
        if (!confirmed || !chatDone) toastr?.warning?.(message, '配置保存状态');
        return confirmed && chatDone;
    }
    function modelDraftTicket(kind, state) {
        const draft = readVectorFormDraft ? readVectorFormDraft(state) : state;
        const signature = value => JSON.stringify([value.vectorMemory.customApi, value.vectorMemory.queryCustomApi]);
        const expected = signature(draft), revision = state.activeConfigSignature;
        const committed = state.vectorMemory;
        const requestId = ++modelRequests[kind];
        return { draft, assertCurrent() {
            assertVectorFormCurrent?.(state);
            if (ensureState() !== state || state.vectorMemory !== committed || state.activeConfigSignature !== revision
                || modelRequests[kind] !== requestId || signature(readVectorFormDraft ? readVectorFormDraft(state) : state) !== expected) {
                throw new Error('聊天或接口表单已变化，请重新拉取模型。');
            }
        } };
    }
    async function testEmbeddingConnection() {
        const state = ensureState();
        const config = state.vectorMemory.customApi;
        try {
            const draft = readVectorFormDraft ? readVectorFormDraft(state) : state;
            // A fixed tiny sample verifies capability without transmitting chat content.
            const embedding = await fetchCustomEmbedding('连接测试', draft);
            if (ensureState() !== state || state.vectorMemory.customApi !== config) {
                throw new Error('测试期间配置或聊天已切换，请在当前配置重新测试。');
            }
            const unchanged = JSON.stringify(draft.vectorMemory.customApi) === JSON.stringify(config);
            toastr.success(`嵌入接口测试通过：返回 ${embedding.length} 维向量。${unchanged ? '使用已保存的接口配置。' : '测试的是输入框草稿，请先保存设置，后台才会使用这套接口。'}仅验证短文本连接，不代表长文索引已经完成。未发送聊天正文，也未修改索引。`);
            return true;
        } catch (error) {
            toastr.error(error instanceof TypeError ? '连接失败：可能是网络、证书或跨域限制，请检查服务商是否允许浏览器直连。' : error?.message || String(error), '嵌入接口测试失败');
            return false;
        }
    }

    async function fetchVectorEmbeddingModels() {
        const state = ensureState();
        const ticket = modelDraftTicket('embedding', state);
        const config = ticket.draft.vectorMemory.customApi || {};
        const baseUrl = normalizeCustomApiBaseUrl(config.baseUrl);
        const apiKey = String(config.apiKey || '').trim();
        if (!baseUrl) {
            toastr.warning('请先填写嵌入向量接口地址。');
            return false;
        }
        const toast = toastr.info('正在拉取嵌入向量模型列表...', '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
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
            ticket.assertCurrent();
            const models = extractEmbeddingModelCandidates(data);
            if (!models.length) {
                throw new Error('接口返回里没有找到模型 ID。');
            }
            renderVectorModelOptions(models);
            toastr.success(`已拉取 ${models.length} 个模型候选；名称筛选不代表能力验证，请选择服务商支持的嵌入模型，也可手动填写。`);
            return true;
        } catch (error) {
            toastr.error(error?.message || String(error), '嵌入向量模型拉取失败');
            return false;
        } finally {
            toastr.clear(toast);
        }
    }
    
    async function fetchVectorQueryModels() {
        const state = ensureState();
        const ticket = modelDraftTicket('query', state);
        const queryConfig = ticket.draft.vectorMemory.queryCustomApi || {};
        const embeddingConfig = ticket.draft.vectorMemory.customApi || {};
        const baseUrl = normalizeCustomApiBaseUrl(queryConfig.baseUrl || embeddingConfig.baseUrl);
        const apiKey = String(queryConfig.apiKey || embeddingConfig.apiKey || '').trim();
        if (!baseUrl) {
            toastr.warning('请先填写改写接口地址，或填写上方嵌入向量接口地址以便复用。');
            return false;
        }
        const toast = toastr.info('正在拉取改写模型列表...', '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
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
            ticket.assertCurrent();
            const models = extractCustomModelIds(data);
            if (!models.length) {
                throw new Error('接口返回里没有找到模型 ID。');
            }
            renderVectorQueryModelOptions(models);
            toastr.success(`已拉取 ${models.length} 个改写模型候选，请选择模型后应用配置。`);
            return true;
        } catch (error) {
            toastr.error(error?.message || String(error), '改写模型拉取失败');
            return false;
        } finally {
            toastr.clear(toast);
        }
    }
    
    async function applyVectorMemorySettings() {
        const state = ensureState();
        readVectorMemoryFieldsFromUi(state);
        if (state.vectorMemory.enabled) {
            if (!state.vectorMemory.records.length || state.vectorMemory.lastIndexedSignature !== getVectorSourceSignature(state)) {
                markVectorIndexDirty('配置已变更', state);
            }
        }
        return saveVectorConfiguration(state, '向量配置');
    }

    async function persistVectorEnabledFromUi() {
        const state = ensureState();
        assertVectorFormCurrent?.(state);
        const wasEnabled = !!state.vectorMemory?.enabled;
        state.vectorMemory.enabled = !!query('#bakemono-memory-vector-enabled').prop('checked');
        if (state.vectorMemory.enabled && !wasEnabled) {
            markVectorIndexDirty('向量开关已开启', state);
        }
        return saveVectorConfiguration(state, state.vectorMemory.enabled ? '向量记忆已开启' : '向量记忆已关闭');
    }

    function bind() {
        query('#bakemono-memory-vector-enabled')
            .off('change.bakemonoVectorEnabled')
            .on('change.bakemonoVectorEnabled', async () => {
                try {
                    await persistVectorEnabledFromUi();
                } catch (error) {
                    toastr.error(`向量开关保存失败：${error?.message || error}`);
                }
            });
    }
    
    async function testVectorMemoryRetrieval() {
        const state = ensureState();
        if (!state.vectorMemory.enabled) {
            const message = '向量召回当前关闭。请先在“向量配置”开启向量记忆并应用配置，再测试召回。';
            toastr.warning(message);
            renderWorkbenchScope(workbenchRenderScopes.VECTOR, message);
            return false;
        }
        if (!state.vectorMemory.records.length) {
            toastr.warning('还没有索引。请先点击“建立/刷新索引”。');
            renderWorkbenchScope(workbenchRenderScopes.VECTOR, '向量记忆尚未建立索引。');
            return false;
        }
        const queryText = String(query('#bakemono-memory-vector-test-query').val() || '').trim();
        let ownsRequest = () => true;
        const hits = await retrieveVectorMemoryHits(queryText, state, { onStart: owns => { ownsRequest = owns; } });
        if (ensureState() !== state || !ownsRequest()) return false;
        saveState();
        syncInjection();
        renderWorkbenchScope(workbenchRenderScopes.VECTOR, hits.length ? `向量召回完成：命中 ${hits.length} 条记忆。` : (state.vectorMemory.lastRecallSkippedReason || '向量召回完成：没有命中。'));
        return hits.length > 0 || !state.vectorMemory.lastRecallSkippedReason;
    }
    
    function clearVectorMemoryIndex() {
        const state = ensureState();
        if (!state.vectorMemory.records.length && !state.vectorMemory.lastHits.length) {
            toastr.info('向量索引已经是空的。');
            return;
        }
        if (!confirmDanger(
            '清空向量索引？',
            ['这只会删除本聊天保存的向量片段和最近召回，不会删除聊天正文。'],
            '确认清空吗？',
        )) {
            return;
        }
        state.vectorMemory.records = [];
        cancelVectorRecall();
        clearVectorRecall('', state);
        state.vectorMemory.lastHits = [];
        state.vectorMemory.lastQuery = '';
        state.vectorMemory.lastIndexAt = null;
        saveState();
        syncInjection();
        renderWorkbenchScope(workbenchRenderScopes.VECTOR, '向量索引已清空。');
    }

    return {
        bind,
        fetchVectorEmbeddingModels,
        testEmbeddingConnection,
        fetchVectorQueryModels,
        applyVectorMemorySettings,
        persistVectorEnabledFromUi,
        testVectorMemoryRetrieval,
        clearVectorMemoryIndex,
    };
}
