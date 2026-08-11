export function createVectorSettingsModel({
    query,
    defaultVectorMemory,
    getState: ensureState,
    persistSharedConfigurationFromState,
} = {}) {
    function readVectorMemoryFieldsFromUi(state = ensureState()) {
        if (!query('#bakemono-memory-vector-enabled').length) {
            return state;
        }
        const previousRecords = Array.isArray(state.vectorMemory?.records) ? state.vectorMemory.records : [];
        const previousHits = Array.isArray(state.vectorMemory?.lastHits) ? state.vectorMemory.lastHits : [];
        const previousEmbeddingCandidates = Array.isArray(state.vectorMemory?.lastEmbeddingCandidates) ? state.vectorMemory.lastEmbeddingCandidates : [];
        const previousRerankCandidates = Array.isArray(state.vectorMemory?.lastRerankCandidates) ? state.vectorMemory.lastRerankCandidates : [];
        const previousCache = {};
        state.vectorMemory = {
            ...structuredClone(defaultVectorMemory),
            ...(state.vectorMemory || {}),
            enabled: query('#bakemono-memory-vector-enabled').prop('checked'),
            autoIndex: query('#bakemono-memory-vector-auto-index').length ? query('#bakemono-memory-vector-auto-index').prop('checked') : state.vectorMemory?.autoIndex !== false,
            includeHidden: query('#bakemono-memory-vector-include-hidden').prop('checked'),
            includeUser: query('#bakemono-memory-vector-include-user').length ? query('#bakemono-memory-vector-include-user').prop('checked') : state.vectorMemory?.includeUser === true,
            indexMode: String(query('#bakemono-memory-vector-index-mode').val() || defaultVectorMemory.indexMode),
            injectMode: String(query('#bakemono-memory-vector-inject-mode').val() || defaultVectorMemory.injectMode),
            maxIndexedMessages: Math.max(0, Number(query('#bakemono-memory-vector-max-indexed-messages').val() === '' ? defaultVectorMemory.maxIndexedMessages : query('#bakemono-memory-vector-max-indexed-messages').val())),
            maxStoredTextChars: Math.max(240, Number(query('#bakemono-memory-vector-max-stored-text-chars').val() || defaultVectorMemory.maxStoredTextChars)),
            embeddingDimensions: Math.max(32, Number(state.vectorMemory?.embeddingDimensions || defaultVectorMemory.embeddingDimensions)),
            chunkSize: Math.max(240, Number(query('#bakemono-memory-vector-chunk-size').val() || defaultVectorMemory.chunkSize)),
            overlap: Math.max(0, Number(query('#bakemono-memory-vector-overlap').val() || defaultVectorMemory.overlap)),
            longMessageThreshold: Math.max(240, Number(query('#bakemono-memory-vector-long-message-threshold').val() || defaultVectorMemory.longMessageThreshold)),
            topK: Math.max(1, Number(query('#bakemono-memory-vector-top-k').val() || defaultVectorMemory.rerankCandidateCount)),
            rerankCandidateCount: Math.max(1, Number(query('#bakemono-memory-vector-top-k').val() || defaultVectorMemory.rerankCandidateCount)),
            maxRecallMessages: Math.max(1, Number(query('#bakemono-memory-vector-max-recall-messages').val() || defaultVectorMemory.finalRecallCount)),
            finalRecallCount: Math.max(1, Number(query('#bakemono-memory-vector-max-recall-messages').val() || defaultVectorMemory.finalRecallCount)),
            fullRecallCount: Math.max(0, Number(query('#bakemono-memory-vector-full-recall-count').val() || defaultVectorMemory.fullRecallCount)),
            maxPerMessage: Math.max(1, Number(query('#bakemono-memory-vector-max-per-message').val() || defaultVectorMemory.maxPerMessage)),
            perMessageMaxChars: Math.max(200, Number(query('#bakemono-memory-vector-per-message-max-chars').val() || defaultVectorMemory.perMessageMaxChars)),
            minScore: Math.max(0, Number(query('#bakemono-memory-vector-min-score').val() || defaultVectorMemory.embeddingThreshold)),
            embeddingThreshold: Math.max(0, Number(query('#bakemono-memory-vector-min-score').val() || defaultVectorMemory.embeddingThreshold)),
            rerankThreshold: Math.max(0, Number(query('#bakemono-memory-vector-rerank-threshold').val() || defaultVectorMemory.rerankThreshold)),
            keywordBoost: Math.max(0, Number(query('#bakemono-memory-vector-keyword-boost').val() || defaultVectorMemory.keywordBoost)),
            maxInjectChars: Math.max(200, Number(query('#bakemono-memory-vector-max-chars').val() || defaultVectorMemory.maxInjectChars)),
            summaryMaxChars: Math.max(120, Number(query('#bakemono-memory-vector-summary-max-chars').val() || defaultVectorMemory.summaryMaxChars)),
            keywordTriggers: String(query('#bakemono-memory-vector-keywords').val() || ''),
            excludeTags: String(query('#bakemono-memory-vector-exclude-tags').val() || defaultVectorMemory.excludeTags),
            summaryTags: String(query('#bakemono-memory-vector-summary-tags').val() || defaultVectorMemory.summaryTags),
            queryMode: String(query('#bakemono-memory-vector-query-mode').val() || defaultVectorMemory.queryMode),
            queryRewriteProvider: String(query('#bakemono-memory-vector-query-provider').val() || defaultVectorMemory.queryRewriteProvider),
            queryRewritePrompt: String(query('#bakemono-memory-vector-query-prompt').val() || defaultVectorMemory.queryRewritePrompt),
            queryCustomApi: {
                baseUrl: String(query('#bakemono-memory-vector-query-base-url').val() || '').trim(),
                apiKey: String(query('#bakemono-memory-vector-query-api-key').val() || '').trim(),
                model: String(query('#bakemono-memory-vector-query-model').val() || '').trim(),
                models: Array.isArray(state.vectorMemory?.queryCustomApi?.models) ? state.vectorMemory.queryCustomApi.models : [],
            },
            startAfterAiMessages: Math.max(0, Number(query('#bakemono-memory-vector-start-after-ai').val() || defaultVectorMemory.startAfterAiMessages)),
            skipIfAllInContext: query('#bakemono-memory-vector-skip-context').length ? query('#bakemono-memory-vector-skip-context').prop('checked') : state.vectorMemory?.skipIfAllInContext !== false,
            contextWindowMessages: Math.max(0, Number(query('#bakemono-memory-vector-context-window').val() || defaultVectorMemory.contextWindowMessages)),
            rerankMode: String(query('#bakemono-memory-vector-rerank-mode').val() || defaultVectorMemory.rerankMode),
            embeddingProvider: String(query('#bakemono-memory-vector-provider').val() || defaultVectorMemory.embeddingProvider),
            customApi: {
                baseUrl: String(query('#bakemono-memory-vector-base-url').val() || '').trim(),
                apiKey: String(query('#bakemono-memory-vector-api-key').val() || '').trim(),
                model: String(query('#bakemono-memory-vector-model').val() || defaultVectorMemory.customApi.model).trim(),
                models: Array.isArray(state.vectorMemory?.customApi?.models) ? state.vectorMemory.customApi.models : [],
            },
            records: previousRecords,
            embeddingCache: previousCache,
            lastHits: previousHits,
            lastEmbeddingCandidates: previousEmbeddingCandidates,
            lastRerankCandidates: previousRerankCandidates,
        };
        return state;
    }
    
    function persistVectorMemoryFieldsFromUi() {
        const state = ensureState();
        readVectorMemoryFieldsFromUi(state);
        persistSharedConfigurationFromState(state);
        return state;
    }

    return { readVectorMemoryFieldsFromUi, persistVectorMemoryFieldsFromUi };
}
