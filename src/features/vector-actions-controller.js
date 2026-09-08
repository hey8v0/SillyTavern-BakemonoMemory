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
} = {}) {
    async function testEmbeddingConnection() {
        const state = ensureState();
        readVectorMemoryFieldsFromUi(state);
        persistSharedConfigurationFromState(state);
        const config = state.vectorMemory.customApi;
        try {
            // A fixed tiny sample verifies capability without transmitting chat content.
            const embedding = await fetchCustomEmbedding('连接测试', state);
            if (ensureState() !== state || state.vectorMemory.customApi !== config) {
                throw new Error('测试期间配置或聊天已切换，请在当前配置重新测试。');
            }
            toastr.success(`嵌入接口测试通过：返回 ${embedding.length} 维向量。未发送聊天正文，也未修改索引。`);
            return true;
        } catch (error) {
            toastr.error(error instanceof TypeError ? '连接失败：可能是网络、证书或跨域限制，请检查服务商是否允许浏览器直连。' : error?.message || String(error), '嵌入接口测试失败');
            return false;
        }
    }

    async function fetchVectorEmbeddingModels() {
        const state = ensureState();
        readVectorMemoryFieldsFromUi(state);
        persistSharedConfigurationFromState(state);
        const config = state.vectorMemory.customApi || {};
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
            if (ensureState() !== state || state.vectorMemory.customApi !== config) {
                throw new Error('聊天或向量配置已切换，请在当前配置重新拉取模型。');
            }
            const models = extractEmbeddingModelCandidates(data);
            if (!models.length) {
                throw new Error('接口返回里没有找到模型 ID。');
            }
            state.vectorMemory.customApi.models = models;
            renderVectorModelOptions(state.vectorMemory.customApi.models);
            persistSharedConfigurationFromState(state);
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
        readVectorMemoryFieldsFromUi(state);
        persistSharedConfigurationFromState(state);
        const queryConfig = state.vectorMemory.queryCustomApi || {};
        const embeddingConfig = state.vectorMemory.customApi || {};
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
            if (ensureState() !== state || state.vectorMemory.queryCustomApi !== queryConfig || state.vectorMemory.customApi !== embeddingConfig) {
                throw new Error('聊天或改写配置已切换，请在当前配置重新拉取模型。');
            }
            const models = extractCustomModelIds(data);
            if (!models.length) {
                throw new Error('接口返回里没有找到模型 ID。');
            }
            state.vectorMemory.queryCustomApi.models = models;
            if (!String(state.vectorMemory.queryCustomApi.model || '').trim()) {
                state.vectorMemory.queryCustomApi.model = state.vectorMemory.queryCustomApi.models[0];
                query('#bakemono-memory-vector-query-model').val(state.vectorMemory.queryCustomApi.model);
            }
            renderVectorQueryModelOptions(state.vectorMemory.queryCustomApi.models);
            persistSharedConfigurationFromState(state);
            toastr.success(`已拉取 ${state.vectorMemory.queryCustomApi.models.length} 个改写模型。`);
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
            } else {
                await retrieveVectorMemoryHits('', state);
            }
        }
        persistSharedConfigurationFromState(state);
        await saveChatConditional();
        syncInjection();
        renderWorkbenchScope(workbenchRenderScopes.VECTOR, '向量记忆配置已保存，并同步到所有角色卡。');
    }

    async function persistVectorEnabledFromUi() {
        const state = ensureState();
        const wasEnabled = !!state.vectorMemory?.enabled;
        readVectorMemoryFieldsFromUi(state);
        if (state.vectorMemory.enabled && !wasEnabled) {
            markVectorIndexDirty('向量开关已开启', state);
        }
        persistSharedConfigurationFromState(state);
        await saveChatConditional();
        syncInjection();
        renderWorkbenchScope(workbenchRenderScopes.VECTOR, state.vectorMemory.enabled
            ? '向量记忆已开启并立即保存。'
            : '向量记忆已关闭并立即保存。');
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
        readVectorMemoryFieldsFromUi(state);
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
        const hits = await retrieveVectorMemoryHits(queryText, state);
        if (ensureState() !== state) return false;
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
