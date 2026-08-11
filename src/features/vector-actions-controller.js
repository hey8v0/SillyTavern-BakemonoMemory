export function createVectorActionsController({
    query,
    getState: ensureState,
    readVectorMemoryFieldsFromUi,
    persistSharedConfigurationFromState,
    normalizeCustomApiBaseUrl,
    getCustomModelsUrl,
    extractCustomModelIds,
    renderVectorModelOptions,
    renderVectorQueryModelOptions,
    toastr,
    getVectorSourceSignature,
    markVectorIndexDirty,
    retrieveVectorMemoryHits,
    syncInjection,
    renderWorkbenchScope,
    workbenchRenderScopes,
    saveState,
    confirmDanger,
    fetchImpl = globalThis.fetch,
} = {}) {
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
                throw new Error(`拉取模型失败：${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            const models = extractCustomModelIds(data);
            if (!models.length) {
                throw new Error('接口返回里没有找到模型 ID。');
            }
            state.vectorMemory.customApi.models = models;
            if (!String(state.vectorMemory.customApi.model || '').trim()) {
                state.vectorMemory.customApi.model = state.vectorMemory.customApi.models[0];
                query('#bakemono-memory-vector-model').val(state.vectorMemory.customApi.model);
            }
            renderVectorModelOptions(state.vectorMemory.customApi.models);
            persistSharedConfigurationFromState(state);
            toastr.success(`已拉取 ${state.vectorMemory.customApi.models.length} 个嵌入向量模型。`);
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
                throw new Error(`拉取模型失败：${response.status} ${response.statusText}`);
            }
            const data = await response.json();
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
        syncInjection();
        renderWorkbenchScope(workbenchRenderScopes.VECTOR, '向量记忆配置已保存，并同步到所有角色卡。');
    }
    
    async function testVectorMemoryRetrieval() {
        const state = ensureState();
        readVectorMemoryFieldsFromUi(state);
        if (!state.vectorMemory.records.length) {
            toastr.warning('还没有索引。请先点击“建立/刷新索引”。');
            renderWorkbenchScope(workbenchRenderScopes.VECTOR, '向量记忆尚未建立索引。');
            return false;
        }
        const query = String(query('#bakemono-memory-vector-test-query').val() || '').trim();
        const hits = await retrieveVectorMemoryHits(query, state);
        saveState();
        syncInjection();
        renderWorkbenchScope(workbenchRenderScopes.VECTOR, hits.length ? `向量召回完成：命中 ${hits.length} 条记忆。` : (state.vectorMemory.lastRecallSkippedReason || '向量召回完成：没有命中。'));
        return true;
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
        fetchVectorEmbeddingModels,
        fetchVectorQueryModels,
        applyVectorMemorySettings,
        testVectorMemoryRetrieval,
        clearVectorMemoryIndex,
    };
}
