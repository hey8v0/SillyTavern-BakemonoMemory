export function createVectorWorkbenchUi({
    query,
    document,
    getState: ensureState,
    defaultVectorMemory,
    unique,
    getVectorQueryText,
    escapeHtml,
    formatSourceRange,
} = {}) {
    function renderVectorMemoryPanel(state = ensureState()) {
        query('#bakemono-memory-vector-enabled').prop('checked', !!state.vectorMemory.enabled);
        query('#bakemono-memory-vector-auto-index').prop('checked', state.vectorMemory.autoIndex !== false);
        query('#bakemono-memory-vector-include-hidden').prop('checked', state.vectorMemory.includeHidden !== false);
        query('#bakemono-memory-vector-include-user').prop('checked', state.vectorMemory.includeUser === true);
        query('#bakemono-memory-vector-index-mode').val(state.vectorMemory.indexMode || defaultVectorMemory.indexMode);
        query('#bakemono-memory-vector-inject-mode').val(state.vectorMemory.injectMode || defaultVectorMemory.injectMode);
        query('#bakemono-memory-vector-max-indexed-messages').val(state.vectorMemory.maxIndexedMessages ?? defaultVectorMemory.maxIndexedMessages);
        query('#bakemono-memory-vector-max-stored-text-chars').val(state.vectorMemory.maxStoredTextChars ?? defaultVectorMemory.maxStoredTextChars);
        query('#bakemono-memory-vector-chunk-size').val(state.vectorMemory.chunkSize ?? defaultVectorMemory.chunkSize);
        query('#bakemono-memory-vector-overlap').val(state.vectorMemory.overlap ?? defaultVectorMemory.overlap);
        query('#bakemono-memory-vector-long-message-threshold').val(state.vectorMemory.longMessageThreshold ?? defaultVectorMemory.longMessageThreshold);
        query('#bakemono-memory-vector-top-k').val(state.vectorMemory.rerankCandidateCount ?? state.vectorMemory.topK ?? defaultVectorMemory.rerankCandidateCount);
        query('#bakemono-memory-vector-max-recall-messages').val(state.vectorMemory.finalRecallCount ?? state.vectorMemory.maxRecallMessages ?? defaultVectorMemory.finalRecallCount);
        query('#bakemono-memory-vector-full-recall-count').val(state.vectorMemory.fullRecallCount ?? defaultVectorMemory.fullRecallCount);
        query('#bakemono-memory-vector-max-per-message').val(state.vectorMemory.maxPerMessage ?? defaultVectorMemory.maxPerMessage);
        query('#bakemono-memory-vector-per-message-max-chars').val(state.vectorMemory.perMessageMaxChars ?? defaultVectorMemory.perMessageMaxChars);
        query('#bakemono-memory-vector-min-score').val(state.vectorMemory.embeddingThreshold ?? state.vectorMemory.minScore ?? defaultVectorMemory.embeddingThreshold);
        query('#bakemono-memory-vector-rerank-threshold').val(state.vectorMemory.rerankThreshold ?? defaultVectorMemory.rerankThreshold);
        query('#bakemono-memory-vector-keyword-boost').val(state.vectorMemory.keywordBoost ?? defaultVectorMemory.keywordBoost);
        query('#bakemono-memory-vector-max-chars').val(state.vectorMemory.maxInjectChars ?? defaultVectorMemory.maxInjectChars);
        query('#bakemono-memory-vector-summary-max-chars').val(state.vectorMemory.summaryMaxChars ?? defaultVectorMemory.summaryMaxChars);
        query('#bakemono-memory-vector-start-after-ai').val(state.vectorMemory.startAfterAiMessages ?? defaultVectorMemory.startAfterAiMessages);
        query('#bakemono-memory-vector-skip-context').prop('checked', state.vectorMemory.skipIfAllInContext !== false);
        query('#bakemono-memory-vector-context-window').val(state.vectorMemory.contextWindowMessages ?? defaultVectorMemory.contextWindowMessages);
        query('#bakemono-memory-vector-keywords').val(state.vectorMemory.keywordTriggers || '');
        query('#bakemono-memory-vector-exclude-tags').val(state.vectorMemory.excludeTags || defaultVectorMemory.excludeTags);
        query('#bakemono-memory-vector-summary-tags').val(state.vectorMemory.summaryTags || defaultVectorMemory.summaryTags);
        query('#bakemono-memory-vector-query-mode').val(state.vectorMemory.queryMode || defaultVectorMemory.queryMode);
        query('#bakemono-memory-vector-query-provider').val(state.vectorMemory.queryRewriteProvider || defaultVectorMemory.queryRewriteProvider);
        query('#bakemono-memory-vector-query-prompt').val(state.vectorMemory.queryRewritePrompt || defaultVectorMemory.queryRewritePrompt);
        query('#bakemono-memory-vector-query-base-url').val(state.vectorMemory.queryCustomApi?.baseUrl || '');
        query('#bakemono-memory-vector-query-api-key').val(state.vectorMemory.queryCustomApi?.apiKey || '');
        query('#bakemono-memory-vector-query-model').val(state.vectorMemory.queryCustomApi?.model || '');
        renderVectorQueryModelOptions(state.vectorMemory.queryCustomApi?.models || []);
        query('#bakemono-memory-vector-rerank-mode').val(state.vectorMemory.rerankMode || defaultVectorMemory.rerankMode);
        query('#bakemono-memory-vector-provider').val(state.vectorMemory.embeddingProvider || defaultVectorMemory.embeddingProvider);
        query('#bakemono-memory-vector-base-url').val(state.vectorMemory.customApi?.baseUrl || '');
        query('#bakemono-memory-vector-api-key').val(state.vectorMemory.customApi?.apiKey || '');
        query('#bakemono-memory-vector-model').val(state.vectorMemory.customApi?.model || defaultVectorMemory.customApi.model);
        renderVectorModelOptions(state.vectorMemory.customApi?.models || []);
        const messageRecordCount = unique((state.vectorMemory.records || []).map(record => String(record.messageId))).length;
        const bodyRecordCount = (state.vectorMemory.records || []).filter(record => record.kind !== 'summary').length;
        const summaryRecordCount = (state.vectorMemory.records || []).filter(record => record.kind === 'summary').length;
        const maxIndexed = Number(state.vectorMemory.maxIndexedMessages || 0);
        const fullHitCount = (state.vectorMemory.lastHits || []).filter(hit => hit.recallTier === 'full').length;
        const summaryHitCount = (state.vectorMemory.lastHits || []).filter(hit => hit.recallTier !== 'full').length;
        const hitCount = fullHitCount + summaryHitCount;
        const indexReady = messageRecordCount > 0 && !state.vectorMemory.dirty;
        const indexTime = state.vectorMemory.lastIndexAt ? new Date(state.vectorMemory.lastIndexAt).toLocaleString() : '';
        const providerLabel = state.vectorMemory.embeddingProvider === 'custom-openai' ? '自定义向量' : '本地向量';
        const runtimeLabel = !messageRecordCount
            ? '尚未建立索引'
            : state.vectorMemory.dirty
                ? '索引等待刷新'
                : '索引健康';
        const runtimeDescription = !messageRecordCount
            ? '建立索引后，剪辑台才能从长聊天里找回相关旧剧情。'
            : `${bodyRecordCount} 个正文片段 · ${summaryRecordCount} 个摘要片段${indexTime ? ` · 最近刷新于 ${indexTime}` : ''}${state.vectorMemory.lastRecallSkippedReason ? ` · 上次跳过：${state.vectorMemory.lastRecallSkippedReason}` : ''}`;
        query('#bakemono-memory-vector-runtime-label').text(runtimeLabel);
        query('#bakemono-memory-vector-runtime-badge').text(state.vectorMemory.enabled ? '召回开启' : '召回关闭');
        query('#bakemono-memory-vector-runtime-title').text(`${messageRecordCount} 楼已索引`);
        query('#bakemono-memory-vector-runtime-description').text(runtimeDescription);
        query('#bakemono-memory-vector-meter-bar').css('width', `${!messageRecordCount ? 0 : indexReady ? 100 : 68}%`);
        query('.bakemono-memory-vector-status-hero')
            .toggleClass('is-healthy', indexReady)
            .toggleClass('is-dirty', messageRecordCount > 0 && !indexReady);
        query('#bakemono-memory-vector-result-count').text(`${hitCount} 条`);
        query('#bakemono-memory-vector-config-summary').text(`${providerLabel} · 候选 ${state.vectorMemory.rerankCandidateCount ?? state.vectorMemory.topK ?? defaultVectorMemory.rerankCandidateCount} · 最终 ${state.vectorMemory.finalRecallCount ?? state.vectorMemory.maxRecallMessages ?? defaultVectorMemory.finalRecallCount}`);
        query('#bakemono-memory-vector-stats').text(`索引 ${messageRecordCount} 楼 / 正文 ${bodyRecordCount} 条 / 摘要 ${summaryRecordCount} 条 / 召回全文 ${fullHitCount} 条 / 召回摘要 ${summaryHitCount} 条 / 预计 ${state.vectorMemory.estimatedChars || 0} 字 / 裁剪 ${state.vectorMemory.trimmedHitCount || 0} 个 / ${maxIndexed > 0 ? `最多索引最近 ${maxIndexed} 楼 / ` : ''}${state.vectorMemory.lastRecallSkippedReason ? `跳过：${state.vectorMemory.lastRecallSkippedReason}` : state.vectorMemory.dirty ? `待刷新：${state.vectorMemory.dirtyReason || '有变更'}` : state.vectorMemory.lastIndexAt ? new Date(state.vectorMemory.lastIndexAt).toLocaleString() : '尚未建索引'}`);
        query('#bakemono-memory-vector-query-preview').val((state.vectorMemory.lastQueries || []).join('\n') || state.vectorMemory.lastQuery || getVectorQueryText(state));
        renderVectorResultList(state);
        renderVectorRecallDetails(state);
        renderVectorHitList();
        renderVectorRecordList();
    }
    
    function renderVectorRecallDetails(state = ensureState()) {
        const container = document.querySelector('#bakemono-memory-vector-recall-details');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        const queries = state.vectorMemory.lastQueries || [];
        const hits = state.vectorMemory.lastHits || [];
        const intent = String(state.vectorMemory.lastRewriteIntent || '').trim();
        const embeddingCandidates = state.vectorMemory.lastEmbeddingCandidates || [];
        const rerankCandidates = state.vectorMemory.lastRerankCandidates || [];
        const renderRecallItems = (items = [], emptyText = '暂无内容。') => {
            if (!items.length) {
                return `<div class="bakemono-memory-empty">${escapeHtml(emptyText)}</div>`;
            }
            return items.map(item => {
                const tier = item.recallTier === 'full'
                    ? '全文'
                    : item.recallTier === 'summary'
                        ? '摘要'
                        : item.recallTier === 'dropped'
                            ? '未入档'
                            : item.kind === 'summary'
                                ? '摘要'
                                : '候选';
                const meta = [
                    tier,
                    `重排 ${item.rerankScore ?? item.score ?? 0}`,
                    `相似 ${item.similarity ?? 0}`,
                    item.lexicalScore ? `词项 ${item.lexicalScore}` : '',
                    item.keywordHits ? `关键词 ${item.keywordHits}` : '',
                    item.matchedChunks > 1 ? `命中片段 ${item.matchedChunks}` : '',
                ].filter(Boolean).join(' · ');
                const matchedTerms = Array.isArray(item.matchedTerms) && item.matchedTerms.length
                    ? `<small>命中词：${escapeHtml(item.matchedTerms.join('、'))}</small>`
                    : '';
                return `
                    <article class="bakemono-memory-vector-detail-item">
                      <div class="bakemono-memory-vector-detail-head">
                        <strong>${escapeHtml(item.title || `楼层 ${item.messageId}`)}</strong>
                        <span>${escapeHtml(meta)}</span>
                      </div>
                      ${matchedTerms}
                      <div class="bakemono-memory-vector-detail-text">${escapeHtml(item.preview || item.text || '')}</div>
                    </article>
                `;
            }).join('');
        };
        const steps = [
            {
                title: `查询重写 · ${queries.length || 0} 条线索`,
                body: [
                    intent
                        ? `<div class="bakemono-memory-vector-intent-card"><strong>检索意图</strong><span>${escapeHtml(intent)}</span></div>`
                        : '',
                    queries.length
                        ? queries.map((query, index) => `<div class="bakemono-memory-vector-query-row"><strong>线索 ${String(index + 1).padStart(2, '0')}</strong><span>${escapeHtml(query)}</span></div>`).join('')
                        : '<div class="bakemono-memory-empty">暂无查询重写结果。成功召回后会在这里显示多条检索 query。</div>',
                ].filter(Boolean).join(''),
            },
            {
                title: `混合初筛 · ${embeddingCandidates.length || 0} 候选`,
                body: renderRecallItems(embeddingCandidates, state.vectorMemory.lastRecallSkippedReason || '暂无候选。'),
            },
            {
                title: `Rerank 分档 · ${rerankCandidates.length || 0} 条`,
                body: renderRecallItems(rerankCandidates, embeddingCandidates.length ? '候选没有进入可注入档位。' : '暂无重排结果。'),
            },
            {
                title: `最终注入 · ${hits.length || 0} 条`,
                body: renderRecallItems(hits, state.vectorMemory.lastRecallSkippedReason || '暂无最终注入。'),
            },
        ];
        const fragment = document.createDocumentFragment();
        steps.forEach((step, index) => {
            const details = document.createElement('details');
            details.className = 'bakemono-memory-vector-step';
            if (index === 0 && queries.length) {
                details.open = true;
            }
            details.innerHTML = `<summary><span>${index + 1} · ${escapeHtml(step.title)}</span><i class="fa-solid fa-chevron-down"></i></summary><div class="bakemono-memory-vector-step-body">${step.body}</div>`;
            fragment.append(details);
        });
        container.append(fragment);
    }
    
    function renderVectorHitList(state = ensureState()) {
        const container = document.querySelector('#bakemono-memory-vector-hit-list');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        const hits = state.vectorMemory.lastHits || [];
        if (!hits.length) {
            const empty = document.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无召回。启用后先建立索引，或点击“测试召回”。';
            container.append(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        hits.forEach(hit => {
            const item = document.createElement('section');
            item.className = 'bakemono-memory-vector-hit';
            const tierLabel = hit.recallTier === 'full' ? '全文' : '摘要';
            const matchedTerms = Array.isArray(hit.matchedTerms) && hit.matchedTerms.length
                ? ` · 命中 ${hit.matchedTerms.slice(0, 4).join('、')}`
                : '';
            item.innerHTML = `
                <div class="bakemono-memory-vector-hit-head">
                    <strong>${escapeHtml(hit.title || `楼层 ${hit.messageId}`)}</strong>
                    <span>${tierLabel} · 重排 ${escapeHtml(hit.rerankScore ?? hit.score ?? 0)} · 相似度 ${escapeHtml(hit.similarity ?? 0)}${hit.lexicalScore ? ` · 词项 ${escapeHtml(hit.lexicalScore)}` : ''}${hit.keywordHits ? ` · 关键词 ${escapeHtml(hit.keywordHits)}` : ''}${hit.matchedChunks > 1 ? ` · 命中片段 ${escapeHtml(hit.matchedChunks)}` : ''}${escapeHtml(matchedTerms)}</span>
                </div>
                <div class="bakemono-memory-vector-snippet">${escapeHtml(hit.preview || hit.text || '')}</div>
            `;
            fragment.append(item);
        });
        container.append(fragment);
    }
    
    function renderVectorRecordList(state = ensureState()) {
        const container = document.querySelector('#bakemono-memory-vector-record-list');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        const records = (state.vectorMemory.records || [])
            .slice()
            .sort((a, b) => {
                const priority = record => record.isSavedSummary ? 0 : record.kind === 'summary' ? 1 : record.kind === 'message' ? 2 : 3;
                return priority(a) - priority(b)
                    || Number(a.messageId) - Number(b.messageId)
                    || Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0);
            })
            .slice(0, 16);
        if (!records.length) {
            const empty = document.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无索引片段。';
            container.append(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        records.forEach(record => {
            const item = document.createElement('div');
            item.className = 'bakemono-memory-debug-item';
            const typeLabel = record.isSavedSummary
                ? '保存摘要索引'
                : record.kind === 'summary'
                    ? '摘要索引'
                    : record.kind === 'message'
                        ? '楼层索引'
                        : '片段索引';
            item.innerHTML = `
                <div class="bakemono-memory-debug-meta">${escapeHtml(record.title)} · ${typeLabel} · ${record.isHidden ? '隐藏' : '可见'}</div>
                <div class="bakemono-memory-debug-text">${escapeHtml(record.preview || record.text || '')}</div>
            `;
            fragment.append(item);
        });
        container.append(fragment);
    }
    
    function renderVectorResultList(state = ensureState()) {
        const container = document.querySelector('#bakemono-memory-vector-result-list');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        const hits = (state.vectorMemory.lastHits || []).slice(0, 4);
        if (!hits.length) {
            const empty = document.createElement('div');
            empty.className = 'bakemono-memory-vector-result-empty';
            empty.innerHTML = '<i class="fa-solid fa-bullseye"></i><div><strong>还没有召回结果</strong><span>建立索引后输入一段剧情线索，测试最相关的旧记忆。</span></div>';
            container.append(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        hits.forEach(hit => {
            const scoreValue = Number(hit.rerankScore ?? hit.score ?? hit.similarity ?? 0);
            const normalizedScore = Number.isFinite(scoreValue) ? scoreValue : 0;
            const score = Math.max(0, Math.min(100, Math.round(normalizedScore <= 1 ? normalizedScore * 100 : normalizedScore)));
            const item = document.createElement('article');
            item.className = 'bakemono-memory-vector-result-item';
            const tier = hit.recallTier === 'full' ? '全文' : '摘要';
            const sourceRange = formatSourceRange(hit.sourceMessageIds || [hit.messageId]);
            item.innerHTML = `
                <span class="bakemono-memory-vector-result-score">${score}%</span>
                <div>
                  <strong>${escapeHtml(hit.title || `楼层 ${hit.messageId}`)}</strong>
                  <p>${escapeHtml(hit.preview || hit.text || '暂无预览内容')}</p>
                  <small>${escapeHtml([tier, sourceRange].filter(Boolean).join(' · '))}</small>
                </div>
            `;
            fragment.append(item);
        });
        container.append(fragment);
    }
    
    function renderVectorModelOptions(models = []) {
        const list = document.querySelector('#bakemono-memory-vector-model-options');
        if (!list) {
            return;
        }
        list.innerHTML = '';
        for (const model of unique(models.map(item => String(item || '').trim()).filter(Boolean)).sort()) {
            const option = document.createElement('option');
            option.value = model;
            list.append(option);
        }
    }
    
    function renderVectorQueryModelOptions(models = []) {
        const list = document.querySelector('#bakemono-memory-vector-query-model-options');
        if (!list) {
            return;
        }
        list.innerHTML = '';
        for (const model of unique(models.map(item => String(item || '').trim()).filter(Boolean)).sort()) {
            const option = document.createElement('option');
            option.value = model;
            list.append(option);
        }
    }

    return {
        renderVectorMemoryPanel,
        renderVectorRecallDetails,
        renderVectorHitList,
        renderVectorRecordList,
        renderVectorResultList,
        renderVectorModelOptions,
        renderVectorQueryModelOptions,
    };
}
