export function createVectorMemoryService({
    defaultVectorMemory,
    getState: ensureState,
    normalizeLineEndings,
    stripHtml,
    parseList,
    extractConfiguredTagBlocks,
    stripConfiguredTags,
    unique,
    getContext,
    getFallbackChat,
    toPlainPreview,
    normalizeCustomApiBaseUrl,
    getCustomChatCompletionsUrl,
    extractChatCompletionText,
    rewriteWithTavern,
    parseVectorQueryRewritePayload,
    getClippedVectorText,
    computeHybridRerankScore,
    getMessageVariantKey,
    getHash,
    getActiveCoveredStageHashes,
    memoryStrategies,
    getActiveEpicMemoryBlocks,
    getFiniteMessageIds,
    getSourceStart,
    getSourceEnd,
    getBlockTitle,
    getKindLabel,
    getBlockPlainText,
    blockTypes,
    saveState,
    compactEmbedding,
    createLocalEmbedding,
    getCustomEmbeddingsUrl,
    readVectorMemoryFieldsFromUi,
    syncInjection,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    cosineSimilarity,
    countKeywordHits,
    selectHybridCandidates,
    fetchImpl = globalThis.fetch,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
} = {}) {
    let vectorIndexTimer = null;
    const vectorEmbeddingRuntimeCache = new Map();
    function pruneVectorRuntimeCache(limit = 120) {
        while (vectorEmbeddingRuntimeCache.size > limit) {
            const firstKey = vectorEmbeddingRuntimeCache.keys().next().value;
            vectorEmbeddingRuntimeCache.delete(firstKey);
        }
    }
    
    function splitTextIntoChunks(text, chunkSize = defaultVectorMemory.chunkSize, overlap = defaultVectorMemory.overlap) {
        const clean = normalizeLineEndings(stripHtml(text)).replace(/\n{3,}/g, '\n\n').trim();
        if (!clean) {
            return [];
        }
        const safeChunk = Math.max(240, Number(chunkSize || defaultVectorMemory.chunkSize));
        const safeOverlap = Math.min(Math.max(0, Number(overlap || 0)), Math.floor(safeChunk / 2));
        const chunks = [];
        let start = 0;
        while (start < clean.length) {
            let end = Math.min(clean.length, start + safeChunk);
            if (end < clean.length) {
                const naturalBreak = Math.max(clean.lastIndexOf('\n', end), clean.lastIndexOf('。', end), clean.lastIndexOf('！', end), clean.lastIndexOf('？', end));
                if (naturalBreak > start + safeChunk * 0.55) {
                    end = naturalBreak + 1;
                }
            }
            const chunk = clean.slice(start, end).trim();
            if (chunk) {
                chunks.push({ text: chunk, start, end });
            }
            if (end >= clean.length) {
                break;
            }
            start = Math.max(end - safeOverlap, start + 1);
        }
        return chunks;
    }
    
    function getVectorSummaryTags(state = ensureState()) {
        return parseList(state.vectorMemory.summaryTags || defaultVectorMemory.summaryTags);
    }
    
    function extractVectorSummaryText(text, state = ensureState()) {
        const summaryTags = getVectorSummaryTags(state);
        const blocks = extractConfiguredTagBlocks(text, summaryTags.length ? summaryTags : ['bakemono', 'summaryDraft'])
            .map(block => block.content)
            .filter(Boolean);
        if (!blocks.length) {
            return '';
        }
        return normalizeLineEndings(blocks.join('\n\n')).replace(/\n{3,}/g, '\n\n').trim();
    }
    
    function getVectorBodyText(text, state = ensureState()) {
        const excludeTags = unique([
            ...parseList(state.scanRules?.excludeTags || ''),
            ...parseList(state.vectorMemory.excludeTags || defaultVectorMemory.excludeTags),
        ]);
        const summaryTags = getVectorSummaryTags(state);
        return stripConfiguredTags(text, unique([...excludeTags, ...summaryTags])).trim();
    }
    
    function getVectorSourceMessages(state = ensureState()) {
        const context = getContext();
        const sourceChat = context.chat || getFallbackChat?.() || [];
        const maxIndexedMessages = Math.max(0, Number(state.vectorMemory.maxIndexedMessages ?? defaultVectorMemory.maxIndexedMessages));
        const items = sourceChat
            .map((message, messageId) => ({
                message,
                messageId,
                cleanedText: getVectorBodyText(message?.mes || '', state),
                summaryText: extractVectorSummaryText(message?.mes || '', state),
            }))
            .filter(({ message }) => message?.mes && (state.vectorMemory.includeHidden !== false || !message.is_system))
            .filter(({ message }) => state.vectorMemory.includeUser === true || !message.is_user);
        return maxIndexedMessages > 0 ? items.slice(-maxIndexedMessages) : items;
    }
    
    function getVectorCleanedMessageText(messageId, state = ensureState()) {
        const match = getVectorSourceMessages(state).find(item => Number(item.messageId) === Number(messageId));
        return String(match?.cleanedText || '').trim();
    }
    
    function getRecentConversationQuery(maxMessages = 8) {
        const context = getContext();
        const sourceChat = context.chat || getFallbackChat?.() || [];
        return sourceChat
            .map((message, messageId) => ({ message, messageId }))
            .filter(({ message }) => message?.mes && !message.is_system)
            .slice(-Math.max(1, Number(maxMessages || 8)))
            .map(({ message, messageId }) => `${message.is_user ? '用户' : '助手'} #${messageId}: ${stripHtml(message.mes || '')}`)
            .join('\n')
            .trim();
    }
    
    function getVectorQueryText(state = ensureState(), explicitQuery = '') {
        const current = String(explicitQuery || '').trim() || getRecentConversationQuery(8);
        const keywords = parseList(state.vectorMemory.keywordTriggers).join(' ');
        return [current, keywords].filter(Boolean).join('\n\n关键词提示：');
    }
    
    function getVectorRewriteIntentText(baseQuery = '') {
        const clean = String(baseQuery || '')
            .split(/\n\n关键词提示：/)[0]
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        const userLine = [...clean].reverse().find(line => /^用户\s*#?\d*\s*[:：]/.test(line));
        const lastLine = userLine || clean.at(-1) || '';
        return toPlainPreview(lastLine.replace(/^(?:用户|助手)\s*#?\d*\s*[:：]\s*/, '').trim(), 220);
    }
    
    async function callVectorQueryRewriteModel(prompt, systemPrompt, state = ensureState()) {
        const provider = String(state.vectorMemory.queryRewriteProvider || defaultVectorMemory.queryRewriteProvider);
        if (provider === 'custom') {
            const queryConfig = state.vectorMemory.queryCustomApi || {};
            const embeddingConfig = state.vectorMemory.customApi || {};
            const baseUrl = normalizeCustomApiBaseUrl(queryConfig.baseUrl || embeddingConfig.baseUrl || '');
            const model = String(queryConfig.model || '').trim();
            const apiKey = String(queryConfig.apiKey || embeddingConfig.apiKey || '').trim();
            if (!baseUrl || !model) {
                throw new Error('查询重写需要聊天模型。请填写改写模型；接口地址和密钥可留空复用嵌入向量接口。');
            }
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
                    temperature: 0.1,
                    top_p: 0.8,
                    max_tokens: 900,
                    stream: false,
                    enable_thinking: false,
                }),
            });
            if (!response.ok) {
                throw new Error(`查询重写请求失败：${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            const content = extractChatCompletionText(data);
            if (!content) {
                throw new Error('查询重写没有返回可用内容。');
            }
            return content;
        }
        return await rewriteWithTavern({ prompt, systemPrompt });
    }
    
    async function prepareVectorQueries(explicitQuery = '', state = ensureState()) {
        const baseQuery = getVectorQueryText(state, explicitQuery);
        const mode = String(state.vectorMemory.queryMode || defaultVectorMemory.queryMode);
        state.vectorMemory.lastRewriteIntent = getVectorRewriteIntentText(baseQuery);
        if (!baseQuery.trim()) {
            return [];
        }
        if (mode === 'off') {
            return [baseQuery];
        }
        if (mode === 'local') {
            return unique([
                baseQuery,
                ...parseList(state.vectorMemory.keywordTriggers),
            ]).filter(Boolean).slice(0, 6);
        }
        const systemPrompt = '你是剧情记忆检索的查询改写器。关闭思考过程。只输出 INTENT 与 Q1-Q5 六行中文，不输出解释、英文、JSON、Markdown 或分析。';
        const prompt = `${state.vectorMemory.queryRewritePrompt || defaultVectorMemory.queryRewritePrompt}
    
    <最近剧情>
    ${baseQuery}
    </最近剧情>
    
    请严格输出下面 6 行，不要输出任何解释、标题、JSON 或 Markdown：
    INTENT: 一句话检索意图
    Q1: 第一条旧记忆检索线索
    Q2: 第二条旧记忆检索线索
    Q3: 第三条旧记忆检索线索
    Q4: 第四条旧记忆检索线索
    Q5: 第五条旧记忆检索线索`;
        const rewritten = await callVectorQueryRewriteModel(prompt, systemPrompt, state);
        const payload = parseVectorQueryRewritePayload(rewritten);
        if (payload.intent) {
            state.vectorMemory.lastRewriteIntent = payload.intent;
        }
        const queries = unique(payload.queries)
            .map(text => text.slice(0, 260))
            .filter(Boolean)
            .slice(0, 6);
        if (!queries.length) {
            throw new Error('查询重写没有生成有效检索句。');
        }
        return queries;
    }
    
    function getAssistantMessageCount() {
        const context = getContext();
        const sourceChat = context.chat || getFallbackChat?.() || [];
        return sourceChat.filter(message => message?.mes && !message.is_user && !message.is_system).length;
    }
    
    function getVisibleConversationMessageCount() {
        const context = getContext();
        const sourceChat = context.chat || getFallbackChat?.() || [];
        return sourceChat.filter(message => message?.mes && !message.is_system).length;
    }
    
    function getRecentVisibleConversationMessageIds(limit = defaultVectorMemory.contextWindowMessages) {
        const max = Math.max(0, Number(limit || 0));
        if (!max) {
            return new Set();
        }
        const context = getContext();
        const sourceChat = context.chat || getFallbackChat?.() || [];
        return new Set(sourceChat
            .map((message, messageId) => ({ message, messageId }))
            .filter(({ message }) => message?.mes && !message.is_system)
            .slice(-max)
            .map(({ messageId }) => Number(messageId)));
    }
    
    function getVectorRecallSourceRecords(state = ensureState()) {
        const records = Array.isArray(state.vectorMemory.records) ? state.vectorMemory.records : [];
        const contextWindowMessages = Math.max(0, Number(state.vectorMemory.contextWindowMessages || defaultVectorMemory.contextWindowMessages));
        if (state.vectorMemory.skipIfAllInContext === false || contextWindowMessages <= 0) {
            return records;
        }
        const recentVisibleIds = getRecentVisibleConversationMessageIds(contextWindowMessages);
        if (!recentVisibleIds.size) {
            return records;
        }
        return records.filter(record => !recentVisibleIds.has(Number(record.messageId)));
    }
    
    function shouldSkipVectorRecallForRecentWindow(state = ensureState()) {
        const contextWindowMessages = Math.max(0, Number(state.vectorMemory.contextWindowMessages || defaultVectorMemory.contextWindowMessages));
        if (state.vectorMemory.skipIfAllInContext === false || contextWindowMessages <= 0) {
            return false;
        }
        const records = Array.isArray(state.vectorMemory.records) ? state.vectorMemory.records : [];
        if (!records.length) {
            return false;
        }
        const recentVisibleIds = getRecentVisibleConversationMessageIds(contextWindowMessages);
        if (!recentVisibleIds.size) {
            return false;
        }
        return !getVectorRecallSourceRecords(state).length;
    }
    
    function makeVectorRecordSummary(text, maxChars = defaultVectorMemory.summaryMaxChars) {
        const clean = normalizeLineEndings(stripHtml(text)).replace(/\n{3,}/g, '\n\n').trim();
        if (!clean) {
            return '';
        }
    
        const hasSummaryEnvelope = /<bakemono\b|<summary\b|剧情摘要|阶段总结|多次总结|剧集终了|长期总览|纪元回溯|正文摘要/i.test(text);
        const sectionLines = clean
            .split(/\n+/)
            .map(line => line.trim())
            .filter(line => line.length >= 12)
            .filter(line => (
                /摘要|总结|事件|关系|线索|伏笔|暗线|第四面墙|角色|地点|时间/.test(line)
                && (/[:：]|[【】\[\]]|^[-*➤]/.test(line) || /摘要|总结/.test(line))
            ));
    
        if (sectionLines.length) {
            return getClippedVectorText(sectionLines.slice(0, 8).join('\n'), Math.max(120, Number(maxChars || defaultVectorMemory.summaryMaxChars)));
        }
    
        if (!hasSummaryEnvelope) {
            return '';
        }
    
        return getClippedVectorText(clean, Math.max(120, Number(maxChars || defaultVectorMemory.summaryMaxChars)));
    }
    
    function computeVectorRerankScore(item, queries = [], state = ensureState()) {
        return computeHybridRerankScore(item, {
            keywordBoost: state.vectorMemory.keywordBoost ?? defaultVectorMemory.keywordBoost,
            explicitKeywordCount: parseList(state.vectorMemory.keywordTriggers).length,
        });
    }
    
    function clearVectorRecall(reason = '', state = ensureState()) {
        state.vectorMemory.lastHits = [];
        state.vectorMemory.lastQueries = [];
        state.vectorMemory.lastRewriteIntent = '';
        state.vectorMemory.lastEmbeddingCandidates = [];
        state.vectorMemory.lastRerankCandidates = [];
        state.vectorMemory.lastQuery = '';
        state.vectorMemory.estimatedChars = 0;
        state.vectorMemory.trimmedHitCount = 0;
        state.vectorMemory.lastRecallSkippedReason = reason;
        return [];
    }
    
    function serializeVectorRecallItem(item, options = {}) {
        const score = Number((item.rerankScore ?? item.score ?? 0).toFixed(4));
        const similarity = Number((item.embeddingScore ?? item.similarity ?? 0).toFixed(4));
        return {
            id: item.id,
            kind: item.kind || 'message',
            recallTier: options.recallTier || item.recallTier || '',
            messageId: item.messageId,
            chunkIndex: item.chunkIndex,
            role: item.role,
            isHidden: !!item.isHidden,
            isSavedSummary: !!item.isSavedSummary,
            summaryType: item.summaryType || '',
            title: item.title || `楼层 ${item.messageId}`,
            text: getClippedVectorText(item.text || item.summary || '', Number(options.textLimit || 480)),
            preview: toPlainPreview(item.preview || item.text || item.summary || '', Number(options.previewLimit || 220)),
            matchedText: getClippedVectorText(item.matchedText || item.text || '', 360),
            matchedChunks: item.matchedChunks || 1,
            keywordHits: item.keywordHitsTotal || item.keywordHits || 0,
            lexicalScore: Number((item.lexicalScore || 0).toFixed(4)),
            matchedTerms: Array.isArray(item.matchedTerms) ? item.matchedTerms.slice(0, 8) : [],
            matchedKeywords: Array.isArray(item.matchedKeywords) ? item.matchedKeywords.slice(0, 8) : [],
            score,
            similarity,
            rerankScore: Number((item.rerankScore ?? score).toFixed(4)),
        };
    }
    
    function getVectorSourceSignature(state = ensureState()) {
        return [
            ...getVectorSourceMessages(state)
                .map(({ message, messageId, cleanedText, summaryText }) => `${messageId}:${getMessageVariantKey(message)}:${getHash(cleanedText || '')}:${getHash(summaryText || '')}`),
            ...getVectorSavedSummarySources(state)
                .map(source => `saved:${source.type}:${source.hash}:${getHash(source.text || '')}`),
        ].join('|');
    }
    
    function getInjectedSummaryHashesForVector(state = ensureState()) {
        const coveredStoryHashes = new Set(state.coveredBlockHashes || []);
        const coveredStageHashes = getActiveCoveredStageHashes(state);
        return new Set([
            ...(state.memoryStrategy === memoryStrategies.GENERIC
                ? (state.storySummaries || [])
                    .filter(summary => summary.hash && !coveredStoryHashes.has(summary.hash))
                    .map(summary => summary.hash)
                : []),
            ...(state.stageSummaries || [])
                .filter(summary => summary.hash && !coveredStageHashes.has(summary.hash))
                .map(summary => summary.hash),
            ...getActiveEpicMemoryBlocks(state)
                .map(summary => summary.hash)
                .filter(Boolean),
        ]);
    }
    
    function getVectorSavedSummarySources(state = ensureState()) {
        const summaryMax = Math.max(120, Number(state.vectorMemory.summaryMaxChars || defaultVectorMemory.summaryMaxChars));
        const sources = [];
        const injectedSummaryHashes = getInjectedSummaryHashesForVector(state);
        const addSummary = (summary, type) => {
            const raw = String(summary?.content || '').trim();
            if (!summary?.hash || !raw) {
                return;
            }
            if (injectedSummaryHashes.has(summary.hash)) {
                return;
            }
            const sourceMessageIds = getFiniteMessageIds(summary.sourceMessageIds || []);
            const sourceStart = Number.isFinite(summary.sourceStart)
                ? Number(summary.sourceStart)
                : getSourceStart(sourceMessageIds);
            const sourceEnd = Number.isFinite(summary.sourceEnd)
                ? Number(summary.sourceEnd)
                : getSourceEnd(sourceMessageIds);
            const title = summary.title || getBlockTitle(raw, getKindLabel(type));
            const plain = getBlockPlainText(raw) || normalizeLineEndings(stripHtml(raw)).trim();
            const text = getClippedVectorText(plain, summaryMax);
            if (!text) {
                return;
            }
            sources.push({
                id: `vec-saved-${type}-${summary.hash}`,
                hash: summary.hash,
                type,
                messageId: Number.isFinite(sourceStart) && sourceStart < Number.MAX_SAFE_INTEGER ? sourceStart : Number.MAX_SAFE_INTEGER,
                sourceStart,
                sourceEnd,
                sourceMessageIds,
                title: `${getKindLabel(type)}：${title}`,
                text,
                preview: toPlainPreview(text, 180),
                createdAt: summary.createdAt || '',
            });
        };
        (state.storySummaries || [])
            .filter(summary => ['backfill', 'turn', 'inline', 'manual', 'turn_manual', 'turn_auto', 'inline_summary'].includes(String(summary.sourceKind || summary.metadata?.sourceKind || '')))
            .forEach(summary => addSummary(summary, blockTypes.STORY));
        (state.stageSummaries || []).forEach(summary => addSummary(summary, blockTypes.STAGE));
        (state.epicSummaries || []).forEach(summary => addSummary(summary, blockTypes.EPIC));
        return sources;
    }
    
    function markVectorIndexDirty(reason = 'changed', state = ensureState()) {
        state.vectorMemory.dirty = true;
        state.vectorMemory.dirtyReason = reason;
        clearVectorRecall(`索引待刷新：${reason}`, state);
        saveState();
        scheduleVectorAutoIndex(reason);
    }
    
    function scheduleVectorAutoIndex(reason = 'auto') {
        const state = ensureState();
        if (!state.vectorMemory.enabled || state.vectorMemory.autoIndex === false) {
            return;
        }
        clearTimer(vectorIndexTimer);
        vectorIndexTimer = setTimer(async () => {
            try {
                await buildVectorMemoryIndex({ silent: true, reason });
            } catch (error) {
                console.warn('[BakemonoMemory] vector auto index failed', error);
                toastr.warning(`向量自动索引失败：${error?.message || error}`);
            }
        }, 1200);
    }
    
    async function getEmbeddingForText(text, state = ensureState()) {
        const source = String(text || '');
        const cacheKey = `${state.vectorMemory.embeddingProvider || 'local'}:${state.vectorMemory.customApi?.model || ''}:${getHash(source)}`;
        if (Array.isArray(vectorEmbeddingRuntimeCache.get(cacheKey))) {
            return vectorEmbeddingRuntimeCache.get(cacheKey);
        }
        const dimensions = Math.max(32, Number(state.vectorMemory.embeddingDimensions || defaultVectorMemory.embeddingDimensions));
        if (state.vectorMemory.embeddingProvider === 'custom-openai') {
            try {
                const embedding = compactEmbedding(await fetchCustomEmbedding(source, state), dimensions);
                vectorEmbeddingRuntimeCache.set(cacheKey, embedding);
                pruneVectorRuntimeCache();
                return embedding;
            } catch (error) {
                console.warn('[BakemonoMemory] custom embedding failed, fallback to local', error);
            }
        }
        const embedding = compactEmbedding(createLocalEmbedding(source, dimensions), dimensions);
        vectorEmbeddingRuntimeCache.set(cacheKey, embedding);
        pruneVectorRuntimeCache();
        return embedding;
    }
    
    async function fetchCustomEmbedding(text, state = ensureState()) {
        const config = state.vectorMemory.customApi || {};
        const baseUrl = normalizeCustomApiBaseUrl(config.baseUrl);
        const apiKey = String(config.apiKey || '').trim();
        const model = String(config.model || defaultVectorMemory.customApi.model).trim();
        if (!baseUrl || !model) {
            throw new Error('嵌入向量接口需要填写接口地址和模型。');
        }
        const response = await fetchImpl(getCustomEmbeddingsUrl(baseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({ model, input: text }),
        });
        if (!response.ok) {
            throw new Error(`嵌入向量接口请求失败：${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        const embedding = data?.data?.[0]?.embedding;
        if (!Array.isArray(embedding)) {
            throw new Error('嵌入向量接口没有返回向量结果。');
        }
        return embedding.map(Number);
    }
    
    async function buildVectorMemoryIndex({ silent = false } = {}) {
        const state = ensureState();
        readVectorMemoryFieldsFromUi(state);
        const signature = getVectorSourceSignature(state);
        if (silent && !state.vectorMemory.dirty && state.vectorMemory.lastIndexedSignature === signature) {
            return state.vectorMemory.records || [];
        }
        const records = [];
        const indexMode = String(state.vectorMemory.indexMode || defaultVectorMemory.indexMode);
        const chunkSize = Math.max(240, Number(state.vectorMemory.chunkSize || defaultVectorMemory.chunkSize));
        const overlap = Math.max(0, Number(state.vectorMemory.overlap || defaultVectorMemory.overlap));
        const longMessageThreshold = Math.max(240, Number(state.vectorMemory.longMessageThreshold || defaultVectorMemory.longMessageThreshold));
    
        for (const { message, messageId, cleanedText, summaryText } of getVectorSourceMessages(state)) {
            const fullText = String(cleanedText || '').trim();
            const summaryContent = String(summaryText || '').trim();
            if (!fullText && !summaryContent) {
                continue;
            }
            const role = message.is_user ? 'user' : message.is_system ? 'hidden' : 'assistant';
            const variantKey = getMessageVariantKey(message);
            const shouldChunk = indexMode === 'chunk' || (indexMode === 'hybrid' && fullText.length > longMessageThreshold);
            if (summaryContent) {
                records.push({
                    id: `vec-${getHash(`${messageId}|${variantKey}|summary|${summaryContent}`)}`,
                    kind: 'summary',
                    messageId,
                    chunkIndex: 0,
                    role,
                    isHidden: !!message.is_system,
                    title: `${message.is_user ? '用户摘要' : message.is_system ? '隐藏摘要' : '助手摘要'} #${messageId}`,
                    text: getClippedVectorText(summaryContent, Math.max(120, Number(state.vectorMemory.summaryMaxChars || defaultVectorMemory.summaryMaxChars))),
                    summary: getClippedVectorText(summaryContent, Math.max(120, Number(state.vectorMemory.summaryMaxChars || defaultVectorMemory.summaryMaxChars))),
                    preview: toPlainPreview(summaryContent, 180),
                    embedding: await getEmbeddingForText(summaryContent, state),
                    createdAt: new Date().toISOString(),
                });
            }
            if (!fullText) {
                continue;
            }
            if (!shouldChunk) {
                records.push({
                    id: `vec-${getHash(`${messageId}|${variantKey}|message|${fullText}`)}`,
                    kind: 'message',
                    messageId,
                    chunkIndex: 0,
                    role,
                    isHidden: !!message.is_system,
                    title: `${message.is_user ? '用户' : message.is_system ? '隐藏楼层' : '助手'} #${messageId}`,
                    text: fullText,
                    summary: '',
                    preview: toPlainPreview(fullText, 180),
                    embedding: await getEmbeddingForText(fullText, state),
                    createdAt: new Date().toISOString(),
                });
                continue;
            }
            for (const [chunkIndex, chunk] of splitTextIntoChunks(fullText, chunkSize, overlap).entries()) {
                const text = chunk.text.trim();
                if (!text) {
                    continue;
                }
                records.push({
                    id: `vec-${getHash(`${messageId}|${variantKey}|${chunkIndex}|${text}`)}`,
                    kind: 'chunk',
                    messageId,
                    chunkIndex,
                    role,
                    isHidden: !!message.is_system,
                    title: `${message.is_user ? '用户' : message.is_system ? '隐藏楼层' : '助手'} #${messageId}.${chunkIndex + 1}`,
                    text,
                    summary: '',
                    preview: toPlainPreview(text, 180),
                    embedding: await getEmbeddingForText(text, state),
                    createdAt: new Date().toISOString(),
                });
            }
        }
    
        for (const source of getVectorSavedSummarySources(state)) {
            records.push({
                id: source.id,
                kind: 'summary',
                messageId: source.messageId,
                chunkIndex: 0,
                role: 'memory',
                isHidden: false,
                isSavedSummary: true,
                summaryType: source.type,
                sourceStart: source.sourceStart,
                sourceEnd: source.sourceEnd,
                sourceMessageIds: source.sourceMessageIds,
                title: source.title,
                text: source.text,
                summary: source.text,
                preview: source.preview,
                embedding: await getEmbeddingForText(source.text, state),
                createdAt: source.createdAt || new Date().toISOString(),
            });
        }
    
        state.vectorMemory.records = records;
        state.vectorMemory.embeddingCache = {};
        state.vectorMemory.lastIndexAt = new Date().toISOString();
        state.vectorMemory.lastIndexedSignature = signature;
        state.vectorMemory.dirty = false;
        state.vectorMemory.dirtyReason = '';
        await retrieveVectorMemoryHits('', state);
        saveState();
        syncInjection();
        renderWorkbenchScope(workbenchRenderScopes.VECTOR, silent ? '' : `向量索引完成：${records.length} 个原文片段。`);
        if (!silent) {
            toastr.success(`已建立 ${records.length} 个向量片段。`);
        }
        return records;
    }
    
    async function retrieveVectorMemoryHits(explicitQuery = '', state = ensureState()) {
        if (!state.vectorMemory?.enabled || !Array.isArray(state.vectorMemory.records) || !state.vectorMemory.records.length) {
            return clearVectorRecall('', state);
        }
        const minAiMessages = Math.max(0, Number(state.vectorMemory.startAfterAiMessages || 0));
        if (minAiMessages > 0 && getAssistantMessageCount() < minAiMessages) {
            return clearVectorRecall(`当前 AI 楼数少于 ${minAiMessages}，已跳过召回。`, state);
        }
        if (!explicitQuery && shouldSkipVectorRecallForRecentWindow(state)) {
            const contextWindowMessages = Math.max(0, Number(state.vectorMemory.contextWindowMessages || defaultVectorMemory.contextWindowMessages));
            return clearVectorRecall(`已索引内容都还在可见最近 ${contextWindowMessages} 楼内，已跳过向量召回。`, state);
        }
        const recallRecords = getVectorRecallSourceRecords(state);
        if (!recallRecords.length) {
            const contextWindowMessages = Math.max(0, Number(state.vectorMemory.contextWindowMessages || defaultVectorMemory.contextWindowMessages));
            return clearVectorRecall(`可召回内容都还在可见最近 ${contextWindowMessages} 楼内，已跳过向量召回。`, state);
        }
        let queries = [];
        try {
            queries = await prepareVectorQueries(explicitQuery, state);
        } catch (error) {
            console.warn('[BakemonoMemory] vector query rewrite failed', error);
            return clearVectorRecall(`查询重写失败，本轮不召回：${error?.message || error}`, state);
        }
        if (!queries.length) {
            return clearVectorRecall('查询重写没有生成有效检索句，本轮不召回。', state);
        }
    
        const queryEmbeddings = [];
        for (const query of queries) {
            queryEmbeddings.push(await getEmbeddingForText(query, state));
        }
        const keywords = parseList(state.vectorMemory.keywordTriggers);
        const embeddingThreshold = Math.max(0, Number(state.vectorMemory.embeddingThreshold ?? state.vectorMemory.minScore ?? defaultVectorMemory.embeddingThreshold));
        const rerankThreshold = Math.max(0, Number(state.vectorMemory.rerankThreshold ?? defaultVectorMemory.rerankThreshold));
        const rerankCandidateCount = Math.max(1, Number(state.vectorMemory.rerankCandidateCount || state.vectorMemory.topK || defaultVectorMemory.rerankCandidateCount));
        const finalRecallCount = Math.max(1, Number(state.vectorMemory.finalRecallCount || state.vectorMemory.maxRecallMessages || defaultVectorMemory.finalRecallCount));
        const fullRecallCount = Math.max(0, Number(state.vectorMemory.fullRecallCount ?? defaultVectorMemory.fullRecallCount));
        const scored = recallRecords.map(record => {
            const similarities = queryEmbeddings.map(embedding => cosineSimilarity(embedding, record.embedding || []));
            const similarity = similarities.length ? Math.max(...similarities) : 0;
            const keywordHits = countKeywordHits(`${record.title}\n${record.summary || ''}\n${record.text}`, keywords);
            return {
                ...record,
                embeddingScore: similarity,
                score: similarity,
                similarity,
                keywordHits,
            };
        });
    
        let embeddingCandidates = selectHybridCandidates(scored, queries, keywords, {
            embeddingThreshold,
            candidateCount: rerankCandidateCount,
            keywordBoost: state.vectorMemory.keywordBoost ?? defaultVectorMemory.keywordBoost,
        });
        if (!embeddingCandidates.length) {
            const contextWindowMessages = Math.max(0, Number(state.vectorMemory.contextWindowMessages || defaultVectorMemory.contextWindowMessages));
            const recentVisibleIds = getRecentVisibleConversationMessageIds(contextWindowMessages);
            const fallbackCandidates = scored.filter(item => item.isHidden || !recentVisibleIds.has(Number(item.messageId)));
            if (fallbackCandidates.length) {
                embeddingCandidates = selectHybridCandidates(fallbackCandidates, queries, keywords, {
                    embeddingThreshold: 0,
                    candidateCount: rerankCandidateCount,
                    keywordBoost: state.vectorMemory.keywordBoost ?? defaultVectorMemory.keywordBoost,
                });
            }
        }
        state.vectorMemory.lastEmbeddingCandidates = embeddingCandidates
            .slice(0, rerankCandidateCount)
            .map(item => serializeVectorRecallItem(item, { previewLimit: 240, textLimit: 480 }));
        const byMessage = new Map();
        for (const item of embeddingCandidates.slice(0, Math.max(rerankCandidateCount * 2, rerankCandidateCount))) {
            const key = String(item.messageId);
            const existing = byMessage.get(key);
            const rerankScore = Number.isFinite(Number(item.hybridScore))
                ? Number(item.hybridScore)
                : computeVectorRerankScore(item, queries, state);
            const enriched = {
                ...item,
                rerankScore,
                score: rerankScore,
                matchedChunks: 1,
                keywordHitsTotal: item.keywordHits,
            };
            if (!existing || enriched.rerankScore > existing.rerankScore || enriched.embeddingScore > existing.embeddingScore) {
                if (existing) {
                    enriched.matchedChunks = existing.matchedChunks + 1;
                    enriched.keywordHitsTotal = existing.keywordHitsTotal + item.keywordHits;
                }
                byMessage.set(key, enriched);
            } else {
                existing.matchedChunks += 1;
                existing.keywordHitsTotal += item.keywordHits;
            }
        }
    
        const reranked = [...byMessage.values()]
            .sort((a, b) => (b.rerankScore - a.rerankScore) || (b.embeddingScore - a.embeddingScore) || (b.keywordHitsTotal - a.keywordHitsTotal) || (Number(b.messageId) - Number(a.messageId)))
            .slice(0, rerankCandidateCount);
        state.vectorMemory.lastRerankCandidates = reranked.map(item => {
            const recallTier = item.kind !== 'summary' && item.rerankScore >= rerankThreshold
                ? 'full'
                : (item.kind === 'summary' || item.summary ? 'summary' : 'dropped');
            return serializeVectorRecallItem(item, { recallTier, previewLimit: 260, textLimit: 520 });
        });
        const fullHits = [];
        const summaryHits = [];
        for (const item of reranked) {
            const fullText = getVectorCleanedMessageText(item.messageId, state) || item.text || '';
            const base = {
                ...item,
                kind: item.kind === 'summary' ? 'summary' : 'message',
                matchedText: item.text,
                title: item.kind === 'summary'
                    ? item.isSavedSummary
                        ? item.title
                        : `${item.role === 'user' ? '用户摘要' : item.isHidden ? '隐藏摘要' : '助手摘要'} #${item.messageId}`
                    : `${item.role === 'user' ? '用户' : item.isHidden ? '隐藏楼层' : '助手'} #${item.messageId}`,
                keywordHits: item.keywordHitsTotal || item.keywordHits,
            };
            if (item.kind !== 'summary' && item.rerankScore >= rerankThreshold && fullHits.length < fullRecallCount) {
                fullHits.push({
                    ...base,
                    recallTier: 'full',
                    text: fullText,
                    preview: toPlainPreview(fullText, 220),
                });
            } else {
                const summaryText = String(item.kind === 'summary' ? item.text : item.summary || '').trim();
                if (summaryText) {
                    summaryHits.push({
                        ...base,
                        recallTier: 'summary',
                        text: summaryText,
                        preview: toPlainPreview(summaryText, 220),
                    });
                }
            }
        }
        const hits = [...fullHits, ...summaryHits]
            .slice(0, finalRecallCount)
            .sort((a, b) => (
                Number(a.messageId) - Number(b.messageId)
                || Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0)
                || String(a.recallTier || '').localeCompare(String(b.recallTier || ''))
            ));
        state.vectorMemory.lastQuery = queries.join('\n');
        state.vectorMemory.lastQueries = queries;
        state.vectorMemory.lastRecallSkippedReason = hits.length ? '' : '没有内容通过当前向量阈值和重排规则。';
        const textLimit = Math.max(240, Number(state.vectorMemory.maxStoredTextChars || defaultVectorMemory.maxStoredTextChars));
        const hitTextLimit = Math.max(textLimit, Number(state.vectorMemory.perMessageMaxChars || defaultVectorMemory.perMessageMaxChars));
        state.vectorMemory.lastHits = hits.map(hit => ({
            id: hit.id,
            kind: hit.kind || 'message',
            recallTier: hit.recallTier || 'summary',
            messageId: hit.messageId,
            chunkIndex: hit.chunkIndex,
            role: hit.role,
            isHidden: hit.isHidden,
            isSavedSummary: !!hit.isSavedSummary,
            summaryType: hit.summaryType || '',
            title: hit.title,
            text: getClippedVectorText(hit.text, hit.recallTier === 'full' ? hitTextLimit : Math.max(120, Number(state.vectorMemory.summaryMaxChars || defaultVectorMemory.summaryMaxChars))),
            matchedText: getClippedVectorText(hit.matchedText || '', Math.min(textLimit, 480)),
            matchedChunks: hit.matchedChunks || 1,
            preview: hit.preview,
            score: Number((hit.rerankScore ?? hit.score ?? 0).toFixed(4)),
            similarity: Number((hit.embeddingScore ?? hit.similarity ?? 0).toFixed(4)),
            rerankScore: Number((hit.rerankScore ?? hit.score ?? 0).toFixed(4)),
            keywordHits: hit.keywordHits,
            lexicalScore: Number((hit.lexicalScore || 0).toFixed(4)),
            matchedTerms: Array.isArray(hit.matchedTerms) ? hit.matchedTerms.slice(0, 8) : [],
            matchedKeywords: Array.isArray(hit.matchedKeywords) ? hit.matchedKeywords.slice(0, 8) : [],
        }));
        state.vectorMemory.estimatedChars = state.vectorMemory.lastHits.reduce((sum, hit) => sum + String(hit.text || '').length, 0);
        state.vectorMemory.trimmedHitCount = Math.max(0, embeddingCandidates.length - hits.length);
        return state.vectorMemory.lastHits;
    }
    
    function renderVectorMemorySection(state = ensureState()) {
        const hits = Array.isArray(state.vectorMemory.lastHits) ? state.vectorMemory.lastHits : [];
        const maxChars = Math.max(200, Number(state.vectorMemory.maxInjectChars || defaultVectorMemory.maxInjectChars));
        const perMessageMaxChars = Math.max(200, Number(state.vectorMemory.perMessageMaxChars || defaultVectorMemory.perMessageMaxChars));
        let used = 0;
        const lines = [];
        for (const hit of hits) {
            const source = String(hit.text || '').trim();
            const snippet = hit.kind === 'message' && source.length > perMessageMaxChars
                ? `${source.slice(0, perMessageMaxChars)}...`
                : source;
            if (!snippet) {
                continue;
            }
            const remaining = maxChars - used;
            if (remaining <= 0) {
                break;
            }
            const clipped = snippet.length > remaining ? `${snippet.slice(0, remaining)}...` : snippet;
            used += clipped.length;
            const tierLabel = hit.recallTier === 'full' ? '全文' : '摘要';
            lines.push(`- 来源：${hit.title}（${tierLabel}，重排 ${hit.rerankScore ?? hit.score ?? 0}，相似度 ${hit.similarity ?? 0}${hit.keywordHits ? `，关键词命中 ${hit.keywordHits}` : ''}${hit.matchedChunks > 1 ? `，命中片段 ${hit.matchedChunks}` : ''}）\n${clipped}`);
        }
        state.vectorMemory.estimatedChars = used;
        state.vectorMemory.trimmedHitCount = Math.max(0, (state.vectorMemory.lastHits?.length || 0) - lines.length);
        return lines.length ? `## 向量召回记忆\n${lines.join('\n\n')}` : '';
    }

    return {
        pruneVectorRuntimeCache,
        splitTextIntoChunks,
        getVectorSummaryTags,
        extractVectorSummaryText,
        getVectorBodyText,
        getVectorSourceMessages,
        getVectorCleanedMessageText,
        getRecentConversationQuery,
        getVectorQueryText,
        getVectorRewriteIntentText,
        callVectorQueryRewriteModel,
        prepareVectorQueries,
        getAssistantMessageCount,
        getVisibleConversationMessageCount,
        getRecentVisibleConversationMessageIds,
        getVectorRecallSourceRecords,
        shouldSkipVectorRecallForRecentWindow,
        makeVectorRecordSummary,
        computeVectorRerankScore,
        clearVectorRecall,
        serializeVectorRecallItem,
        getVectorSourceSignature,
        getInjectedSummaryHashesForVector,
        getVectorSavedSummarySources,
        markVectorIndexDirty,
        scheduleVectorAutoIndex,
        getEmbeddingForText,
        fetchCustomEmbedding,
        buildVectorMemoryIndex,
        retrieveVectorMemoryHits,
        renderVectorMemorySection,
    };
}
