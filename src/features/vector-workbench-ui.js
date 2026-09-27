import { removeRpVectorCache } from '../vector/source-policy.js';
import { recallLimits } from '../vector/recall-plan.js';
import { renderModelPicker } from '../ui/model-picker.js';

const relativeTime = (value, now = Date.now()) => {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '';
    const minutes = Math.round((now - time) / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return new Date(time).toLocaleDateString();
};
// Tag blocks (<bakemono>, <details>…) are kept in what is injected; the list shows their text only.
const plainText = value => String(value || '').replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/\n{3,}/g, '\n\n').trim();
const percent = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, Math.round(number <= 1 ? number * 100 : number)));
};

export function createVectorWorkbenchUi({
    query,
    document,
    getState: ensureState,
    defaultVectorMemory,
    unique,
    escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    formatSourceRange = ids => ids.length ? `第 ${ids[0]} 楼` : '',
    markVectorFormRendered,
    canKeepVectorForm,
    getVectorSourceMessages = () => [],
    isVectorIndexing = () => false,
} = {}) {
    // What the reader has opened in the last-recall list; cleared when a new recall arrives.
    const view = { recallAt: null, open: new Set(), queries: false, pool: false };

    function renderVectorMemoryPanel(state = ensureState()) {
        if (!canKeepVectorForm?.(state)) renderVectorConfigurationFields(state);
        renderVectorRuntime(state);
    }

    function renderVectorConfigurationFields(state) {
        const config = state.vectorMemory;
        const fallback = key => config[key] ?? defaultVectorMemory[key];
        query('#bakemono-memory-vector-enabled').prop('checked', !!config.enabled);
        query('#bakemono-memory-vector-auto-index').prop('checked', config.autoIndex !== false);
        query('#bakemono-memory-vector-include-hidden').prop('checked', config.includeHidden !== false);
        query('#bakemono-memory-vector-include-user').prop('checked', config.includeUser === true);
        query('#bakemono-memory-vector-max-summary-recall').val(fallback('maxSummaryRecall'));
        query('#bakemono-memory-vector-full-recall-count').val(fallback('fullRecallCount'));
        query('#bakemono-memory-vector-max-indexed-messages').val(fallback('maxIndexedMessages'));
        query('#bakemono-memory-vector-min-score').val(config.embeddingThreshold ?? config.minScore ?? defaultVectorMemory.embeddingThreshold);
        query('#bakemono-memory-vector-rerank-threshold').val(fallback('rerankThreshold'));
        query('#bakemono-memory-vector-keyword-boost').val(fallback('keywordBoost'));
        query('#bakemono-memory-vector-safety-chars').val(fallback('recallSafetyChars'));
        query('#bakemono-memory-vector-start-after-ai').val(fallback('startAfterAiMessages'));
        query('#bakemono-memory-vector-skip-context').prop('checked', config.skipIfAllInContext !== false);
        query('#bakemono-memory-vector-context-window').val(fallback('contextWindowMessages'));
        query('#bakemono-memory-vector-keywords').val(config.keywordTriggers || '');
        query('#bakemono-memory-vector-exclude-tags').val(fallback('excludeTags'));
        query('#bakemono-memory-vector-summary-tags').val(fallback('summaryTags'));
        query('#bakemono-memory-vector-query-mode').val(config.queryMode || defaultVectorMemory.queryMode);
        query('#bakemono-memory-vector-query-provider').val(config.queryRewriteProvider || defaultVectorMemory.queryRewriteProvider);
        query('#bakemono-memory-vector-query-prompt').val(fallback('queryRewritePrompt'));
        query('#bakemono-memory-vector-query-base-url').val(config.queryCustomApi?.baseUrl || '');
        query('#bakemono-memory-vector-query-api-key').val(config.queryCustomApi?.apiKey || '');
        query('#bakemono-memory-vector-query-model').val(config.queryCustomApi?.model || '');
        renderVectorQueryModelOptions(config.queryCustomApi?.models || []);
        query('#bakemono-memory-vector-provider').val(config.embeddingProvider || defaultVectorMemory.embeddingProvider);
        query('#bakemono-memory-vector-base-url').val(config.customApi?.baseUrl || '');
        query('#bakemono-memory-vector-api-key').val(config.customApi?.apiKey || '');
        query('#bakemono-memory-vector-model').val(config.customApi?.model || '');
        renderVectorModelOptions(config.customApi?.models || []);
        markVectorFormRendered?.(state);
    }

    // The one-line values beside each settings row and the fields that only apply to some choices
    // follow the form as typed, so they are read from the inputs rather than from saved state.
    function renderVectorSettingsSummary() {
        const val = selector => query(selector).val?.();
        const checked = selector => !!query(selector).prop?.('checked');
        const queryMode = String(val('#bakemono-memory-vector-query-mode') || 'model-required');
        const queryProvider = String(val('#bakemono-memory-vector-query-provider') || 'tavern');
        const embedCustom = val('#bakemono-memory-vector-provider') === 'custom-openai';
        query('#bakemono-memory-vector-set-amount').text(`摘要 ${val('#bakemono-memory-vector-max-summary-recall') ?? ''} · 正文 ${val('#bakemono-memory-vector-full-recall-count') ?? ''}`);
        query('#bakemono-memory-vector-set-query').text(queryMode === 'local' ? '本地改写' : queryMode === 'off' ? '不改写' : '模型改写');
        query('#bakemono-memory-vector-set-index').text(checked('#bakemono-memory-vector-auto-index') ? '自动更新' : '手动更新');
        query('#bakemono-memory-vector-set-embed').text(embedCustom ? '自定义接口' : '本地哈希向量');
        query('[data-bk-vec-when="query-model"]').prop('hidden', queryMode !== 'model-required');
        query('[data-bk-vec-when="query-custom"]').prop('hidden', queryMode !== 'model-required' || queryProvider !== 'custom');
        query('[data-bk-vec-when="embed-custom"]').prop('hidden', !embedCustom);
    }

    function describeIndex(state) {
        const config = state.vectorMemory;
        const records = config.records || [];
        const indexedFloors = new Set(records.filter(r => !r.isSavedSummary).map(r => String(r.messageId)));
        let eligible = indexedFloors.size;
        try { eligible = Math.max(eligible, getVectorSourceMessages(state).length); } catch {}
        const summaries = records.filter(r => r.kind === 'summary' && !r.isSavedSummary).length;
        const saved = records.filter(r => r.isSavedSummary).length;
        const running = isVectorIndexing();
        const waiting = Math.max(0, eligible - indexedFloors.size);
        const title = config.lastIndexError ? '自动索引已暂停'
            : !records.length ? (running ? '正在建索引…' : '还没有建索引')
            : running ? `正在更新索引：${indexedFloors.size} / ${eligible} 楼`
            : waiting ? `${indexedFloors.size} / ${eligible} 楼已建索引，还有 ${waiting} 楼等待`
            : config.dirty ? `${eligible} 楼已建索引，有改动等待更新`
            : `${eligible} 楼都已建索引`;
        const facts = [
            `<span><b>${indexedFloors.size}</b> 楼正文</span>`,
            `<span><b>${summaries}</b> 条楼层摘要</span>`,
            saved ? `<span><b>${saved}</b> 条已存总结</span>` : '',
            `<span>${config.embeddingProvider === 'custom-openai' ? '自定义嵌入接口' : '本地哈希向量'}</span>`,
            config.lastIndexAt ? `<span>${escapeHtml(relativeTime(config.lastIndexAt))}更新</span>` : '',
        ].filter(Boolean).join('');
        const note = config.lastIndexError || (config.dirty && records.length && config.dirtyReason ? `等待更新：${config.dirtyReason}` : '');
        return { records, indexedFloors, eligible, running, waiting, title, facts, note,
            ready: records.length > 0 && !config.dirty && !config.lastIndexError && !waiting };
    }

    function renderVectorRuntime(state) {
        removeRpVectorCache(state.vectorMemory);
        const config = state.vectorMemory;
        const index = describeIndex(state);
        query('#bakemono-memory-vector-runtime-badge').text(config.enabled ? '召回开启' : '召回关闭');
        query('#bakemono-memory-vector-runtime-title').text(index.title);
        query('#bakemono-memory-vector-runtime-description').html(index.facts);
        query('#bakemono-memory-vector-runtime-note').text(index.note).prop('hidden', !index.note);
        const width = !index.eligible ? 0 : Math.round(index.indexedFloors.size / index.eligible * 100);
        query('#bakemono-memory-vector-meter-bar').css('width', `${index.records.length ? width : 0}%`);
        query('.bk-vec-meter').toggleClass('is-running', index.running);
        query('#bakemono-memory-vector-index-label').text(index.running ? '正在更新…'
            : index.ready ? '重建索引' : index.waiting && index.records.length ? `更新索引（${index.waiting} 楼）` : index.records.length ? '更新索引' : '建立索引');
        query('.bk-vec-index').toggleClass('is-quiet', index.ready);
        query('[data-bakemono-action="vector-pause"]').prop('hidden', !index.running);
        renderVectorSettingsSummary();
        renderVectorRecall(state);
    }

    function floorLabel(item) {
        const ids = Array.isArray(item.sourceMessageIds) && item.sourceMessageIds.length ? item.sourceMessageIds : [item.messageId];
        return item.isSavedSummary ? formatSourceRange(ids) : `第 ${item.messageId} 楼`;
    }

    function hitMarkup(item, index, fullText) {
        const kept = item.recallTier === 'full' || item.recallTier === 'summary';
        const tier = item.recallTier === 'full' ? '正文' : item.isSavedSummary ? '总结' : item.kind === 'summary' || item.recallTier === 'summary' ? '摘要' : '正文';
        const open = view.open.has(index);
        // A kept row shows what is injected; a left-out row shows the passage that matched. CSS clamps it when closed.
        const text = plainText(kept ? fullText || item.preview : item.text || item.preview);
        const why = [
            `相似度 ${item.similarity ?? 0}`,
            item.lexicalScore ? `词项 ${item.lexicalScore}` : '',
            item.keywordHits ? `关键词 ${item.keywordHits}` : '',
            item.matchedPhrases?.length ? `匹配：${item.matchedPhrases.slice(0, 6).join('、')}` : '',
            kept && item.decisionReason ? item.decisionReason : '',
        ].filter(Boolean).join(' · ');
        return `<div class="bk-vec-hit${kept ? '' : ' is-cut'}${open ? ' is-open' : ''}">
            <span class="bk-vec-score">${percent(item.rerankScore ?? item.score)}<span class="bk-vec-bar"><i style="width:${percent(item.rerankScore ?? item.score)}%"></i></span></span>
            <button type="button" class="bk-vec-hit-main" data-bk-vec-hit="${index}" aria-expanded="${open}">
              <span class="bk-vec-line1">${kept ? `<span class="bk-vec-tier is-${item.recallTier === 'full' ? 'full' : 'summary'}">${tier}</span>` : ''}<span>${escapeHtml(floorLabel(item))}</span>${kept
                ? '<span class="bk-vec-in">会注入</span>' : `<span class="bk-vec-out">不带：${escapeHtml(item.decisionReason || '没有选上')}</span>`}</span>
              ${item.isSavedSummary && item.title ? `<strong>${escapeHtml(item.title)}</strong>` : ''}
              <span class="bk-vec-text">${escapeHtml(text)}</span>
              ${open ? `<small class="bk-vec-why">${escapeHtml(why)}</small>` : ''}
            </button>
          </div>`;
    }

    function renderVectorRecall(state = ensureState()) {
        const container = document.querySelector('#bakemono-memory-vector-recall');
        if (!container) return;
        const config = state.vectorMemory;
        if (view.recallAt !== (config.lastRecallAt || null)) {
            view.recallAt = config.lastRecallAt || null;
            view.open.clear(); view.queries = false; view.pool = false;
        }
        const hits = config.lastHits || [];
        const decisions = config.lastRerankCandidates || [];
        const pool = config.lastEmbeddingCandidates || [];
        const queries = config.lastQueries || [];
        const skipped = String(config.lastRecallSkippedReason || '').trim();
        const when = [relativeTime(config.lastRecallAt), config.lastRecallAt ? (config.lastRecallQuery ? '手动试的' : '回复前自动') : ''].filter(Boolean).join(' · ');
        if (!decisions.length && !hits.length) {
            container.innerHTML = `<div class="bk-vec-last-h"><h4>${skipped ? '上次没有召回' : '还没有召回过'}</h4>${when ? `<span class="bk-sum-meta">${escapeHtml(when)}</span>` : ''}</div>
              <p class="bk-vec-empty">${escapeHtml(skipped || '建好索引并打开召回后，每次回复前会自动找一次；也可以在上面试一试。')}</p>`;
            return;
        }
        const limits = recallLimits({ ...defaultVectorMemory, ...config });
        const fullCount = hits.filter(hit => hit.recallTier === 'full').length;
        const kept = decisions.filter(item => item.recallTier === 'full' || item.recallTier === 'summary');
        const cut = decisions.filter(item => !(item.recallTier === 'full' || item.recallTier === 'summary'));
        const fullTextOf = item => hits.find(hit => (hit.sourceGroup && hit.sourceGroup === item.sourceGroup) || hit.id === item.id)?.text || item.text || '';
        const ordered = [...kept, ...cut];
        const intent = String(config.lastRewriteIntent || '').trim();
        const searched = intent || queries[0] || '';
        const ownKeywords = String(config.keywordTriggers || '').split(/[,，\n]+/).map(word => word.trim()).filter(Boolean);
        const inferredKeywords = config.lastInferredKeywords || [];
        const keywordLine = ownKeywords.length || inferredKeywords.length
            ? `<p class="bk-vec-keywords">${ownKeywords.length ? `<span>你填的关键词：${escapeHtml(ownKeywords.join('、'))}</span>` : ''}${inferredKeywords.length ? `<span>模型这一轮加的：${escapeHtml(inferredKeywords.join('、'))}</span>` : ''}</p>` : '';
        container.innerHTML = `<div class="bk-vec-last-h"><h4>上次召回 · 找到 ${ordered.length} 条，带上 ${hits.length} 条</h4>${when ? `<span class="bk-sum-meta">${escapeHtml(when)}</span>` : ''}</div>
          <div class="bk-sum-meta bk-vec-counts"><span>摘要 <b>${hits.length - fullCount}</b> / ${limits.maxSummary}</span><span>正文 <b>${fullCount}</b> / ${limits.maxFull}</span><span><b>${Number(config.estimatedChars || 0).toLocaleString()}</b> 字</span></div>
          ${searched ? `<button type="button" class="bk-vec-searched" data-bk-vec-toggle="queries" aria-expanded="${view.queries}"><span class="bk-vec-searched-k">拿去搜的是</span><span class="bk-vec-searched-v">${escapeHtml(searched)}</span><span class="bk-vec-chev" aria-hidden="true">›</span></button>
            ${view.queries ? `<ol class="bk-vec-queries">${queries.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ol>${keywordLine}` : ''}` : ''}
          <div class="bk-vec-hits">${ordered.map((item, index) => `${index === kept.length && cut.length ? '<div class="bk-vec-cut-line">这次不带</div>' : ''}${hitMarkup(item, index, fullTextOf(item))}`).join('')}</div>
          ${pool.length ? `<button type="button" class="bk-sum-link bk-vec-pool-toggle" data-bk-vec-toggle="pool" aria-expanded="${view.pool}">${view.pool ? '收起初筛候选' : `看初筛的 ${pool.length} 条候选 ›`}</button>
            ${view.pool ? `<ol class="bk-vec-pool">${pool.map(item => `<li><span class="bk-vec-pool-score">${percent(item.rerankScore ?? item.score)}</span><span>${item.kind === 'summary' ? (item.isSavedSummary ? '总结' : '摘要') : '正文'} · ${escapeHtml(floorLabel(item))}</span><span class="bk-vec-pool-text">${escapeHtml(plainText(item.preview || item.text))}</span></li>`).join('')}</ol>` : ''}` : ''}`;
    }

    function toggleVectorView(kind, index) {
        if (kind === 'hit') view.open.has(index) ? view.open.delete(index) : view.open.add(index);
        else if (kind === 'queries' || kind === 'pool') view[kind] = !view[kind];
        renderVectorRecall();
    }

    function renderVectorModelOptions(models = [], options) {
        renderModelPicker(document, 'bakemono-memory-vector-model', models, options);
    }

    function renderVectorQueryModelOptions(models = [], options) {
        renderModelPicker(document, 'bakemono-memory-vector-query-model', models, options);
    }

    return {
        renderVectorConfigurationFields,
        renderVectorMemoryPanel,
        renderVectorRecall,
        renderVectorSettingsSummary,
        toggleVectorView,
        renderVectorModelOptions,
        renderVectorQueryModelOptions,
    };
}
