export function createVectorSettingsModel({
    query,
    defaultVectorMemory,
    getState: ensureState,
    persistSharedConfigurationFromState,
} = {}) {
    let formState = null;
    let formRevision = '';
    let formElement = null;
    const fields = {
        enabled: ['enabled'], 'auto-index': ['autoIndex'], 'include-hidden': ['includeHidden'], 'include-user': ['includeUser'],
        'index-mode': ['indexMode'], 'inject-mode': ['injectMode'],
        'max-indexed-messages': ['maxIndexedMessages'], 'max-stored-text-chars': ['maxStoredTextChars'],
        'chunk-size': ['chunkSize'], overlap: ['overlap'], 'long-message-threshold': ['longMessageThreshold'],
        'top-k': ['topK', 'rerankCandidateCount'], 'max-recall-messages': ['maxRecallMessages', 'finalRecallCount'],
        'full-recall-count': ['fullRecallCount'], 'max-per-message': ['maxPerMessage'],
        'per-message-max-chars': ['perMessageMaxChars'], 'min-score': ['minScore', 'embeddingThreshold'],
        'rerank-threshold': ['rerankThreshold'], 'keyword-boost': ['keywordBoost'], 'max-chars': ['maxInjectChars'],
        'summary-max-chars': ['summaryMaxChars'], keywords: ['keywordTriggers'], 'exclude-tags': ['excludeTags'],
        'summary-tags': ['summaryTags'], 'query-mode': ['queryMode'], 'query-provider': ['queryRewriteProvider'],
        'query-prompt': ['queryRewritePrompt'], 'start-after-ai': ['startAfterAiMessages'], 'skip-context': ['skipIfAllInContext'],
        'context-window': ['contextWindowMessages'], 'rerank-mode': ['rerankMode'], provider: ['embeddingProvider'],
    };
    const numeric = new Set(['max-indexed-messages', 'max-stored-text-chars', 'chunk-size', 'overlap',
        'long-message-threshold', 'top-k', 'max-recall-messages', 'full-recall-count', 'max-per-message',
        'per-message-max-chars', 'min-score', 'rerank-threshold', 'keyword-boost', 'max-chars',
        'summary-max-chars', 'start-after-ai', 'context-window']);
    function markVectorFormRendered(state = ensureState()) {
        formState = state;
        formRevision = String(state.activeConfigSignature || '');
        formElement = query?.('#bakemono-memory-vector-enabled')?.[0] ?? null;
    }
    function canKeepVectorForm(state = ensureState()) {
        return formState === state && formRevision === String(state.activeConfigSignature || '')
            && formElement === (query?.('#bakemono-memory-vector-enabled')?.[0] ?? null);
    }
    function assertVectorFormCurrent(state = ensureState()) {
        if (formState !== state || formRevision !== String(state.activeConfigSignature || '')) {
            throw new Error('聊天或配置已变化，请重新打开向量配置后再应用。');
        }
    }
    function readVectorMemoryFieldsFromUi(state = ensureState(), { commit = true } = {}) {
        if (!query('#bakemono-memory-vector-enabled').length) {
            return state;
        }
        assertVectorFormCurrent(state);
        for (const suffix of numeric) {
            const element = query('#bakemono-memory-vector-' + suffix), value = element.val();
            if (element.length && value != null && value !== '' && !Number.isFinite(Number(value))) {
                throw new Error('向量配置含无效数值，请检查输入。');
            }
        }
        const previousRecords = Array.isArray(state.vectorMemory?.records) ? state.vectorMemory.records : [];
        const previousHits = Array.isArray(state.vectorMemory?.lastHits) ? state.vectorMemory.lastHits : [];
        const previousEmbeddingCandidates = Array.isArray(state.vectorMemory?.lastEmbeddingCandidates) ? state.vectorMemory.lastEmbeddingCandidates : [];
        const previousRerankCandidates = Array.isArray(state.vectorMemory?.lastRerankCandidates) ? state.vectorMemory.lastRerankCandidates : [];
        const previousCache = state.vectorMemory?.embeddingCache || {};
        const next = {
            ...structuredClone(defaultVectorMemory),
            ...(state.vectorMemory || {}),
            enabled: query('#bakemono-memory-vector-enabled').prop('checked'),
            autoIndex: query('#bakemono-memory-vector-auto-index').length ? query('#bakemono-memory-vector-auto-index').prop('checked') : state.vectorMemory?.autoIndex !== false,
            includeHidden: query('#bakemono-memory-vector-include-hidden').prop('checked'),
            includeUser: query('#bakemono-memory-vector-include-user').length ? query('#bakemono-memory-vector-include-user').prop('checked') : state.vectorMemory?.includeUser === true,
            indexMode: String(query('#bakemono-memory-vector-index-mode').val() ?? defaultVectorMemory.indexMode),
            injectMode: String(query('#bakemono-memory-vector-inject-mode').val() ?? defaultVectorMemory.injectMode),
            maxIndexedMessages: Math.max(0, Number(query('#bakemono-memory-vector-max-indexed-messages').val() === '' ? defaultVectorMemory.maxIndexedMessages : query('#bakemono-memory-vector-max-indexed-messages').val())),
            maxStoredTextChars: Math.max(240, Number(query('#bakemono-memory-vector-max-stored-text-chars').val() ?? defaultVectorMemory.maxStoredTextChars)),
            embeddingDimensions: Math.max(32, Number(state.vectorMemory?.embeddingDimensions ?? defaultVectorMemory.embeddingDimensions)),
            chunkSize: Math.max(240, Number(query('#bakemono-memory-vector-chunk-size').val() ?? defaultVectorMemory.chunkSize)),
            overlap: Math.max(0, Number(query('#bakemono-memory-vector-overlap').val() ?? defaultVectorMemory.overlap)),
            longMessageThreshold: Math.max(240, Number(query('#bakemono-memory-vector-long-message-threshold').val() ?? defaultVectorMemory.longMessageThreshold)),
            topK: Math.max(1, Number(query('#bakemono-memory-vector-top-k').val() ?? defaultVectorMemory.rerankCandidateCount)),
            rerankCandidateCount: Math.max(1, Number(query('#bakemono-memory-vector-top-k').val() ?? defaultVectorMemory.rerankCandidateCount)),
            maxRecallMessages: Math.max(1, Number(query('#bakemono-memory-vector-max-recall-messages').val() ?? defaultVectorMemory.finalRecallCount)),
            finalRecallCount: Math.max(1, Number(query('#bakemono-memory-vector-max-recall-messages').val() ?? defaultVectorMemory.finalRecallCount)),
            fullRecallCount: Math.max(0, Number(query('#bakemono-memory-vector-full-recall-count').val() ?? defaultVectorMemory.fullRecallCount)),
            maxPerMessage: Math.max(1, Number(query('#bakemono-memory-vector-max-per-message').val() ?? defaultVectorMemory.maxPerMessage)),
            perMessageMaxChars: Math.max(200, Number(query('#bakemono-memory-vector-per-message-max-chars').val() ?? defaultVectorMemory.perMessageMaxChars)),
            minScore: Math.max(0, Number(query('#bakemono-memory-vector-min-score').val() ?? defaultVectorMemory.embeddingThreshold)),
            embeddingThreshold: Math.max(0, Number(query('#bakemono-memory-vector-min-score').val() ?? defaultVectorMemory.embeddingThreshold)),
            rerankThreshold: Math.max(0, Number(query('#bakemono-memory-vector-rerank-threshold').val() ?? defaultVectorMemory.rerankThreshold)),
            keywordBoost: Math.max(0, Number(query('#bakemono-memory-vector-keyword-boost').val() ?? defaultVectorMemory.keywordBoost)),
            maxInjectChars: Math.max(200, Number(query('#bakemono-memory-vector-max-chars').val() ?? defaultVectorMemory.maxInjectChars)),
            summaryMaxChars: Math.max(120, Number(query('#bakemono-memory-vector-summary-max-chars').val() ?? defaultVectorMemory.summaryMaxChars)),
            keywordTriggers: String(query('#bakemono-memory-vector-keywords').val() || ''),
            excludeTags: String(query('#bakemono-memory-vector-exclude-tags').val() ?? defaultVectorMemory.excludeTags),
            summaryTags: String(query('#bakemono-memory-vector-summary-tags').val() ?? defaultVectorMemory.summaryTags),
            queryMode: String(query('#bakemono-memory-vector-query-mode').val() ?? defaultVectorMemory.queryMode),
            queryRewriteProvider: String(query('#bakemono-memory-vector-query-provider').val() ?? defaultVectorMemory.queryRewriteProvider),
            queryRewritePrompt: String(query('#bakemono-memory-vector-query-prompt').val() ?? defaultVectorMemory.queryRewritePrompt),
            queryCustomApi: {
                baseUrl: String(query('#bakemono-memory-vector-query-base-url').val() || '').trim(),
                apiKey: String(query('#bakemono-memory-vector-query-api-key').val() || '').trim(),
                model: String(query('#bakemono-memory-vector-query-model').val() || '').trim(),
                models: Array.isArray(state.vectorMemory?.queryCustomApi?.models) ? state.vectorMemory.queryCustomApi.models : [],
            },
            startAfterAiMessages: Math.max(0, Number(query('#bakemono-memory-vector-start-after-ai').val() ?? defaultVectorMemory.startAfterAiMessages)),
            skipIfAllInContext: query('#bakemono-memory-vector-skip-context').length ? query('#bakemono-memory-vector-skip-context').prop('checked') : state.vectorMemory?.skipIfAllInContext !== false,
            contextWindowMessages: Math.max(0, Number(query('#bakemono-memory-vector-context-window').val() ?? defaultVectorMemory.contextWindowMessages)),
            rerankMode: String(query('#bakemono-memory-vector-rerank-mode').val() ?? defaultVectorMemory.rerankMode),
            embeddingProvider: String(query('#bakemono-memory-vector-provider').val() ?? defaultVectorMemory.embeddingProvider),
            customApi: {
                baseUrl: String(query('#bakemono-memory-vector-base-url').val() || '').trim(),
                apiKey: String(query('#bakemono-memory-vector-api-key').val() || '').trim(),
                model: String(query('#bakemono-memory-vector-model').val() || '').trim(),
                models: Array.isArray(state.vectorMemory?.customApi?.models) ? state.vectorMemory.customApi.models : [],
            },
            records: previousRecords,
            embeddingCache: previousCache,
            lastHits: previousHits,
            lastEmbeddingCandidates: previousEmbeddingCandidates,
            lastRerankCandidates: previousRerankCandidates,
        };
        for (const [suffix, keys] of Object.entries(fields)) {
            const element = query('#bakemono-memory-vector-' + suffix);
            if (!element.length || (numeric.has(suffix) && element.val() == null)) {
                for (const key of keys) {
                    if (state.vectorMemory?.[key] !== undefined) next[key] = state.vectorMemory[key];
                    else if (defaultVectorMemory[key] !== undefined) next[key] = defaultVectorMemory[key];
                    else delete next[key];
                }
            }
        }
        for (const [path, prefix] of [['customApi', ''], ['queryCustomApi', 'query-']]) {
            for (const [key, suffix] of [['baseUrl', 'base-url'], ['apiKey', 'api-key'], ['model', 'model']]) {
                const element = query('#bakemono-memory-vector-' + prefix + suffix);
                if (!element.length || element.val() == null) next[path][key] = state.vectorMemory?.[path]?.[key] ?? defaultVectorMemory[path]?.[key] ?? '';
            }
        }
        if (!commit) return { ...state, vectorMemory: next };
        state.vectorMemory = next;
        return state;
    }
    
    function persistVectorMemoryFieldsFromUi() {
        const state = ensureState();
        readVectorMemoryFieldsFromUi(state);
        persistSharedConfigurationFromState(state);
        markVectorFormRendered(state);
        return state;
    }

    return { readVectorMemoryFieldsFromUi, persistVectorMemoryFieldsFromUi, markVectorFormRendered, assertVectorFormCurrent, canKeepVectorForm,
        readVectorFormDraft: state => readVectorMemoryFieldsFromUi(state, { commit: false }) };
}
