const maxSearchResults = 2000;
const maxRenderedMatches = 240;

export function createPromptInspector({
    getChat,
    getItemizedPrompts,
    getItemizedParams,
    countTokens,
    getActiveTab,
    notifySuccess = () => {},
    notifyError = () => {},
    logWarning = (...args) => console.warn(...args),
} = {}) {
    let renderRevision = 0;
    let openEntryKey = '';
    let searchQuery = '';
    let searchResults = [];
    let searchResultIndex = -1;
    let searchTruncated = false;
    let boundRoot = null;
    const entries = new Map();
    const searchResultsByEntry = new Map();
    const promptUsageCache = new WeakMap();

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value ?? '');
    }

    function flattenPromptSnapshot(value, seen = new WeakSet()) {
        if (typeof value === 'string') return value;
        if (!value || typeof value !== 'object') return '';
        if (seen.has(value)) return '';
        seen.add(value);
        if (Array.isArray(value)) return value.map(item => flattenPromptSnapshot(item, seen)).filter(Boolean).join('\n');
        return Object.values(value).map(item => flattenPromptSnapshot(item, seen)).filter(Boolean).join('\n');
    }

    function getLatestCompletedPromptSnapshot() {
        const prompts = getItemizedPrompts?.();
        const chat = getChat?.();
        if (!Array.isArray(prompts) || !prompts.length) return null;
        let latest = null;
        prompts.forEach((entry, index) => {
            const messageId = Number(entry?.mesId);
            const message = Number.isInteger(messageId) ? chat?.[messageId] : null;
            if (!message || message.is_user) return;
            if (!latest || messageId > latest.messageId || (messageId === latest.messageId && index > latest.index)) {
                latest = { entry, index, messageId };
            }
        });
        return latest;
    }

    async function getLastCompletePromptUsage() {
        const snapshot = getLatestCompletedPromptSnapshot();
        if (!snapshot) return null;
        if (promptUsageCache.has(snapshot.entry)) return promptUsageCache.get(snapshot.entry);
        const usagePromise = (async () => {
            try {
                const params = await getItemizedParams?.(getItemizedPrompts?.(), snapshot.index, snapshot.messageId);
                const total = Number(params?.finalPromptTokens || params?.totalTokensInPrompt || 0);
                if (!Number.isFinite(total) || total <= 0) return null;
                return {
                    total,
                    messageId: snapshot.messageId,
                    promptText: flattenPromptSnapshot(snapshot.entry?.rawPrompt),
                    entry: snapshot.entry,
                    index: snapshot.index,
                    params,
                };
            } catch (error) {
                logWarning('[BakemonoMemory] failed to read the last itemized prompt', error);
                return null;
            }
        })();
        promptUsageCache.set(snapshot.entry, usagePromise);
        return usagePromise;
    }

    function formatMessageContent(value) {
        if (typeof value === 'string') return value;
        if (!value) return '';
        if (Array.isArray(value)) {
            return value.map(item => {
                if (typeof item === 'string') return item;
                if (typeof item?.text === 'string') return item.text;
                if (typeof item?.content === 'string') return item.content;
                if (item?.image_url || item?.type === 'image') return '[图片内容]';
                return '';
            }).filter(Boolean).join('\n');
        }
        if (typeof value === 'object') {
            if (typeof value.text === 'string') return value.text;
            if (typeof value.content === 'string') return value.content;
        }
        return '';
    }

    function collectMessages(value, messages = [], seen = new WeakSet()) {
        if (!value || typeof value !== 'object' || seen.has(value)) return messages;
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach(item => collectMessages(item, messages, seen));
            return messages;
        }
        if (typeof value.role === 'string' && Object.prototype.hasOwnProperty.call(value, 'content')) {
            const content = formatMessageContent(value.content).trim();
            if (content) messages.push({ role: value.role.toLowerCase(), content });
            return messages;
        }
        Object.values(value).forEach(item => collectMessages(item, messages, seen));
        return messages;
    }

    function formatSnapshot(value) {
        if (typeof value === 'string') return value;
        const messages = collectMessages(value);
        if (messages.length) return messages.map(message => `【${message.role.toUpperCase()}】\n${message.content}`).join('\n\n');
        try {
            return JSON.stringify(value, null, 2) || '';
        } catch {
            return flattenPromptSnapshot(value);
        }
    }

    function joinSections(sections) {
        return sections
            .filter(([, value]) => String(value || '').trim())
            .map(([title, value]) => `【${title}】\n${String(value).trim()}`)
            .join('\n\n');
    }

    function stripEmbeddedSources(content, values) {
        let result = String(content || '');
        const sources = values
            .map(value => String(value || '').trim())
            .filter(value => value.length >= 2)
            .sort((left, right) => right.length - left.length);
        sources.forEach(source => {
            result = result.split(source).join('');
        });
        return result.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    async function resolveTokens(nativeTokens, getContent) {
        const nativeCount = Number(nativeTokens);
        if (Number.isFinite(nativeCount) && nativeCount > 0) return nativeCount;
        return await countTokens?.(getContent()) || 0;
    }

    async function buildEntries(usage) {
        const entry = usage?.entry || {};
        const params = usage?.params || {};
        const promptMessages = collectMessages(entry.rawPrompt);
        const systemMessages = promptMessages
            .filter(message => ['system', 'developer'].includes(message.role))
            .map(message => `【${message.role.toUpperCase()}】\n${message.content}`)
            .join('\n\n');
        const systemContent = systemMessages || String(entry.instruction || '').trim();
        const roleCardContent = joinSections([
            ['角色描述', entry.charDescription],
            ['角色性格', entry.charPersonality],
            ['场景设定', entry.scenarioText],
        ]);
        const baseSystemContent = stripEmbeddedSources(systemContent, [
            entry.worldInfoString,
            entry.userPersona,
            entry.charDescription,
            entry.charPersonality,
            entry.scenarioText,
            entry.examplesString,
            entry.allAnchors,
            entry.summarizeString,
            entry.authorsNoteString,
            entry.smartContextString,
            entry.chatVectorsString,
            entry.dataBankVectorsString,
            entry.beforeScenarioAnchor,
            entry.afterScenarioAnchor,
            entry.promptBias,
        ]);
        const fullPromptSource = entry.rawPrompt ?? entry.finalPrompt ?? '';
        const candidates = [
            { key: 'full', label: '完整 Prompt', description: '酒馆上一轮实际发送的完整上下文', icon: 'fa-file-lines', nativeTokens: usage.total, hasContent: !!usage.total, getContent: () => formatSnapshot(fullPromptSource) },
            { key: 'system', label: '基础系统与预设', description: '已扣除下方单列内容的系统消息', icon: 'fa-terminal', nativeTokens: params.this_main_api === 'openai' ? 0 : params.instructionTokens, hasContent: !!baseSystemContent, getContent: () => baseSystemContent },
            { key: 'character', label: '角色卡', description: '角色描述、性格与场景设定', icon: 'fa-address-card', nativeTokens: Number(params.charDescriptionTokens || 0) + Number(params.charPersonalityTokens || 0) + Number(params.scenarioTextTokens || 0), hasContent: !!roleCardContent, getContent: () => roleCardContent },
            { key: 'persona', label: 'User 人设', description: '当前用户身份与人设说明', icon: 'fa-user', nativeTokens: params.userPersonaStringTokens, hasContent: !!String(entry.userPersona || '').trim(), getContent: () => String(entry.userPersona || '') },
            { key: 'world-info', label: '世界书', description: '上一轮实际触发的世界信息', icon: 'fa-earth-asia', nativeTokens: params.worldInfoStringTokens, hasContent: !!String(entry.worldInfoString || '').trim(), getContent: () => String(entry.worldInfoString || '') },
            { key: 'examples', label: '示例对话', description: `${params.examplesCount || entry.examplesCount || 0} 组示例消息`, icon: 'fa-comments', nativeTokens: params.examplesStringTokens, hasContent: !!String(entry.examplesString || '').trim(), getContent: () => String(entry.examplesString || '') },
            { key: 'chat', label: '聊天记录', description: `${params.messagesCount || entry.messagesCount || 0} 条进入上下文的消息`, icon: 'fa-message', nativeTokens: params.ActualChatHistoryTokens, hasContent: !!String(entry.mesSendString || '').trim(), getContent: () => String(entry.mesSendString || '') },
            { key: 'extensions', label: '扩展注入', description: '作者注释、记忆与其他扩展内容', icon: 'fa-puzzle-piece', nativeTokens: params.allAnchorsTokens, hasContent: !!String(entry.allAnchors || '').trim(), getContent: () => String(entry.allAnchors || '') },
            { key: 'bias', label: 'Prompt Bias', description: '上一轮追加的偏置提示', icon: 'fa-thumbtack', nativeTokens: params.promptBiasTokens || params.oaiBiasTokens, hasContent: !!String(entry.promptBias || '').trim(), getContent: () => String(entry.promptBias || '') },
        ].filter(item => item.hasContent);

        const resolved = await Promise.all(candidates.map(async item => ({
            ...item,
            tokens: await resolveTokens(item.nativeTokens, item.getContent),
        })));
        const systemItem = resolved.find(item => item.key === 'system');
        if (systemItem && systemItem.tokens > usage.total) {
            const overlappingSourceTokens = resolved
                .filter(item => ['character', 'persona', 'world-info', 'examples', 'extensions', 'bias'].includes(item.key))
                .reduce((sum, item) => sum + item.tokens, 0);
            systemItem.tokens = Math.max(0, systemItem.tokens - overlappingSourceTokens);
        }
        resolved.forEach(item => {
            if (item.key !== 'full') item.tokens = Math.min(item.tokens, usage.total);
        });
        return resolved;
    }

    function setEmptyState(empty) {
        const list = document.getElementById('bakemono-memory-prompt-inspector-list');
        const emptyState = document.getElementById('bakemono-memory-prompt-inspector-empty');
        if (list) list.hidden = !!empty;
        if (emptyState) emptyState.hidden = !empty;
    }

    function setSearchEnabled(enabled) {
        const input = document.getElementById('bakemono-memory-prompt-inspector-query');
        const submitButton = document.getElementById('bakemono-memory-prompt-inspector-search-submit');
        const navigation = document.getElementById('bakemono-memory-prompt-inspector-search-navigation');
        if (input) input.disabled = !enabled;
        if (submitButton) submitButton.disabled = !enabled;
        if (!enabled && navigation) navigation.hidden = true;
    }

    function resetSearchResults() {
        searchResults = [];
        searchResultIndex = -1;
        searchTruncated = false;
        searchResultsByEntry.clear();
    }

    function closeItem(row) {
        if (!row) return;
        row.classList.remove('is-open');
        const button = row.querySelector('.bakemono-memory-prompt-inspector-item-toggle');
        const body = row.querySelector('.bakemono-memory-prompt-inspector-item-body');
        const content = body?.querySelector('pre');
        button?.setAttribute('aria-expanded', 'false');
        if (body) body.hidden = true;
        if (content) content.textContent = '';
    }

    function renderHighlightedContent(container, content, query = searchQuery, activeResultIndex = searchResultIndex) {
        if (!container) return;
        const text = String(content || '');
        if (!String(query || '').trim()) {
            container.textContent = text || '这一项没有可显示的文本内容。';
            return;
        }
        const entryKey = String(container.closest('.bakemono-memory-prompt-inspector-item')?.dataset.promptEntryKey || '');
        const entryMatches = searchResultsByEntry.get(entryKey) || [];
        if (!entryMatches.length) {
            container.textContent = text || '这一项没有可显示的文本内容。';
            return;
        }
        let matchesToRender = entryMatches;
        if (entryMatches.length > maxRenderedMatches) {
            const activePosition = Math.max(0, entryMatches.findIndex(match => match.resultIndex === activeResultIndex));
            const halfWindow = Math.floor(maxRenderedMatches / 2);
            const windowStart = Math.min(Math.max(0, activePosition - halfWindow), entryMatches.length - maxRenderedMatches);
            matchesToRender = entryMatches.slice(windowStart, windowStart + maxRenderedMatches);
        }
        let cursor = 0;
        const fragment = document.createDocumentFragment();
        matchesToRender.forEach(match => {
            if (match.start > cursor) fragment.append(document.createTextNode(text.slice(cursor, match.start)));
            const mark = document.createElement('mark');
            mark.textContent = text.slice(match.start, match.end);
            mark.dataset.bakemonoPromptSearchResult = String(match.resultIndex);
            if (match.resultIndex === activeResultIndex) {
                mark.classList.add('is-current');
                mark.setAttribute('aria-current', 'true');
            }
            fragment.append(mark);
            cursor = match.end;
        });
        if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
        container.replaceChildren(fragment);
    }

    function collectSearchResults(query) {
        resetSearchResults();
        const needle = String(query || '').trim().toLocaleLowerCase();
        if (!needle) return;
        entryLoop:
        for (const item of entries.values()) {
            const content = String(item.getContent() || '');
            const normalizedContent = content.toLocaleLowerCase();
            let cursor = 0;
            while (cursor < normalizedContent.length) {
                const start = normalizedContent.indexOf(needle, cursor);
                if (start < 0) break;
                if (searchResults.length >= maxSearchResults) {
                    searchTruncated = true;
                    break entryLoop;
                }
                const result = { entryKey: item.key, start, end: start + needle.length, resultIndex: searchResults.length };
                searchResults.push(result);
                if (!searchResultsByEntry.has(item.key)) searchResultsByEntry.set(item.key, []);
                searchResultsByEntry.get(item.key).push(result);
                cursor = result.end;
            }
        }
    }

    function updateSearchNavigation() {
        const navigation = document.getElementById('bakemono-memory-prompt-inspector-search-navigation');
        const scope = document.getElementById('bakemono-memory-prompt-inspector-search-scope');
        const status = document.getElementById('bakemono-memory-prompt-inspector-search-status');
        const previousButton = document.getElementById('bakemono-memory-prompt-inspector-search-previous');
        const nextButton = document.getElementById('bakemono-memory-prompt-inspector-search-next');
        if (navigation) navigation.hidden = !searchQuery;
        const current = searchResults[searchResultIndex];
        const item = current ? entries.get(current.entryKey) : null;
        if (scope) scope.textContent = item?.label || (searchResults.length ? '匹配位置' : '没有命中');
        if (status) {
            const totalLabel = `${searchResults.length.toLocaleString()}${searchTruncated ? '+' : ''}`;
            status.textContent = searchResults.length ? `${(searchResultIndex + 1).toLocaleString()} / ${totalLabel}` : '0 / 0';
        }
        const disabled = searchResults.length <= 1;
        if (previousButton) previousButton.disabled = disabled;
        if (nextButton) nextButton.disabled = disabled;
    }

    function scrollSearchResultIntoView(article, content, resultIndex, smooth = true) {
        if (!article || !content) return;
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        const behavior = smooth && !reducedMotion ? 'smooth' : 'auto';
        window.requestAnimationFrame(() => {
            article.scrollIntoView({ block: 'center', inline: 'nearest', behavior });
            window.requestAnimationFrame(() => {
                const mark = content.querySelector(`[data-bakemono-prompt-search-result="${resultIndex}"]`);
                if (!mark) return;
                const contentRect = content.getBoundingClientRect();
                const markRect = mark.getBoundingClientRect();
                const centeredTop = content.scrollTop + markRect.top - contentRect.top - ((content.clientHeight - markRect.height) / 2);
                content.scrollTo({ top: Math.max(0, centeredTop), behavior });
            });
        });
    }

    function openSearchResult(resultIndex, { smooth = true } = {}) {
        const list = document.getElementById('bakemono-memory-prompt-inspector-list');
        if (!list || !searchResults.length) return;
        const total = searchResults.length;
        searchResultIndex = ((Number(resultIndex) % total) + total) % total;
        const result = searchResults[searchResultIndex];
        const item = entries.get(result.entryKey);
        const article = list.querySelector(`.bakemono-memory-prompt-inspector-item[data-prompt-entry-key="${result.entryKey}"]`);
        if (!item || !article) return;
        list.querySelectorAll('.bakemono-memory-prompt-inspector-item').forEach(row => closeItem(row));
        const trigger = article.querySelector('.bakemono-memory-prompt-inspector-item-toggle');
        const body = article.querySelector('.bakemono-memory-prompt-inspector-item-body');
        const content = body?.querySelector('pre');
        article.hidden = false;
        article.classList.add('is-open');
        trigger?.setAttribute('aria-expanded', 'true');
        if (body) body.hidden = false;
        openEntryKey = result.entryKey;
        renderHighlightedContent(content, item.getContent(), searchQuery, searchResultIndex);
        updateSearchNavigation();
        scrollSearchResultIntoView(article, content, searchResultIndex, smooth);
    }

    function navigateSearch(step) {
        if (searchResults.length) openSearchResult(searchResultIndex + Number(step || 0));
    }

    function applySearch(value = document.getElementById('bakemono-memory-prompt-inspector-query')?.value, { focusFirst = true } = {}) {
        const list = document.getElementById('bakemono-memory-prompt-inspector-list');
        const searchEmpty = document.getElementById('bakemono-memory-prompt-inspector-search-empty');
        if (!list) return;
        const query = String(value || '').trim();
        searchQuery = query;
        collectSearchResults(query);
        document.getElementById('bakemono-memory-prompt-inspector-search-form')?.classList.remove('has-pending-query');
        const matchingEntryKeys = new Set(searchResults.map(result => result.entryKey));
        let visibleCount = 0;
        list.querySelectorAll('.bakemono-memory-prompt-inspector-item').forEach(row => {
            const item = entries.get(String(row.dataset.promptEntryKey || ''));
            const matches = !query || !!item && matchingEntryKeys.has(item.key);
            row.hidden = !matches;
            if (matches) {
                visibleCount += 1;
                if (!query && row.classList.contains('is-open')) renderHighlightedContent(row.querySelector('pre'), item.getContent(), '');
            } else if (row.classList.contains('is-open')) {
                closeItem(row);
                openEntryKey = '';
            }
        });
        if (searchEmpty) searchEmpty.hidden = !query || visibleCount > 0;
        setText('bakemono-memory-prompt-inspector-count', query
            ? `${searchResults.length.toLocaleString()}${searchTruncated ? '+' : ''} 处 · ${visibleCount.toLocaleString()} 个条目`
            : `${entries.size.toLocaleString()} 个条目`);
        updateSearchNavigation();
        if (searchResults.length) openSearchResult(0, { smooth: focusFirst });
        else if (!query && openEntryKey) {
            const openItem = entries.get(openEntryKey);
            const openRow = list.querySelector(`.bakemono-memory-prompt-inspector-item[data-prompt-entry-key="${openEntryKey}"]`);
            if (openItem && openRow) renderHighlightedContent(openRow.querySelector('pre'), openItem.getContent(), '');
        }
    }

    function clearSearch() {
        const input = document.getElementById('bakemono-memory-prompt-inspector-query');
        if (input) input.value = '';
        applySearch('', { focusFirst: false });
        input?.focus();
    }

    async function render() {
        const revision = ++renderRevision;
        const list = document.getElementById('bakemono-memory-prompt-inspector-list');
        if (!list) return;
        list.replaceChildren();
        entries.clear();
        openEntryKey = '';
        resetSearchResults();
        setEmptyState(false);
        document.getElementById('bakemono-memory-prompt-inspector-search-empty')?.setAttribute('hidden', '');
        const searchInput = document.getElementById('bakemono-memory-prompt-inspector-query');
        if (searchInput) searchInput.value = searchQuery;
        setSearchEnabled(false);
        setText('bakemono-memory-prompt-inspector-count', '正在读取');
        setText('bakemono-memory-prompt-inspector-total', '— Token');
        setText('bakemono-memory-prompt-inspector-model', '正在读取');
        setText('bakemono-memory-prompt-inspector-preset', '—');
        setText('bakemono-memory-prompt-inspector-floor', '—');
        const usage = await getLastCompletePromptUsage();
        if (revision !== renderRevision || getActiveTab?.() !== 'prompt-inspector') return;
        if (!usage) {
            setText('bakemono-memory-prompt-inspector-count', '暂无记录');
            setText('bakemono-memory-prompt-inspector-model', '等待生成回复');
            setEmptyState(true);
            return;
        }
        const resolvedEntries = await buildEntries(usage);
        if (revision !== renderRevision || getActiveTab?.() !== 'prompt-inspector') return;
        resolvedEntries.forEach(item => entries.set(item.key, item));
        const model = String(usage.params?.modelUsed || '').trim();
        const preset = String(usage.params?.presetName || '').trim();
        setText('bakemono-memory-prompt-inspector-count', `${resolvedEntries.length.toLocaleString()} 个条目`);
        setText('bakemono-memory-prompt-inspector-total', `${usage.total.toLocaleString()} Token`);
        setText('bakemono-memory-prompt-inspector-model', model || '未记录');
        setText('bakemono-memory-prompt-inspector-preset', preset && preset !== '(Unknown)' ? preset : '未记录');
        setText('bakemono-memory-prompt-inspector-floor', `第 ${usage.messageId.toLocaleString()} 楼`);
        const fragment = document.createDocumentFragment();
        resolvedEntries.forEach(item => {
            const article = document.createElement('article');
            article.className = 'bakemono-memory-prompt-inspector-item';
            article.dataset.promptEntryKey = item.key;
            article.innerHTML = `
                <button type="button" class="bakemono-memory-prompt-inspector-item-toggle" data-bakemono-prompt-entry="${item.key}" aria-expanded="false">
                    <span class="bakemono-memory-prompt-inspector-item-mark" aria-hidden="true"><i class="fa-solid ${item.icon}"></i></span>
                    <span class="bakemono-memory-prompt-inspector-item-copy"><strong>${item.label}</strong><small>${item.description}</small></span>
                    <em><b>${item.tokens.toLocaleString()}</b><small> Token</small></em>
                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                </button>
                <div class="bakemono-memory-prompt-inspector-item-body" hidden>
                    <header><span>实际内容</span><button type="button" data-bakemono-prompt-copy="${item.key}"><i class="fa-regular fa-copy" aria-hidden="true"></i>复制</button></header>
                    <pre></pre>
                </div>`;
            fragment.append(article);
        });
        list.append(fragment);
        setEmptyState(!resolvedEntries.length);
        setSearchEnabled(!!resolvedEntries.length);
        applySearch(searchQuery, { focusFirst: false });
    }

    function toggleEntry(entryKey, trigger) {
        const list = document.getElementById('bakemono-memory-prompt-inspector-list');
        const item = entries.get(entryKey);
        const article = trigger?.closest('.bakemono-memory-prompt-inspector-item');
        if (!list || !item || !article) return;
        const shouldOpen = openEntryKey !== entryKey;
        list.querySelectorAll('.bakemono-memory-prompt-inspector-item').forEach(row => closeItem(row));
        openEntryKey = shouldOpen ? entryKey : '';
        if (!shouldOpen) return;
        const body = article.querySelector('.bakemono-memory-prompt-inspector-item-body');
        const content = body?.querySelector('pre');
        article.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        if (body) body.hidden = false;
        const entryResults = searchResultsByEntry.get(entryKey) || [];
        if (searchQuery && entryResults.length) {
            const currentBelongsToEntry = entryResults.some(match => match.resultIndex === searchResultIndex);
            if (!currentBelongsToEntry) searchResultIndex = entryResults[0].resultIndex;
            updateSearchNavigation();
        }
        renderHighlightedContent(content, item.getContent(), searchQuery, searchResultIndex);
    }

    async function copyEntry(entryKey) {
        const item = entries.get(entryKey);
        if (!item) return;
        try {
            await navigator.clipboard.writeText(item.getContent() || '');
            notifySuccess(`已复制：${item.label}`);
        } catch (error) {
            logWarning('[BakemonoMemory] failed to copy prompt inspector content', error);
            notifyError('复制失败，请长按内容手动复制。');
        }
    }

    function handleClick(event) {
        const entryTrigger = event.target.closest('[data-bakemono-prompt-entry]');
        if (entryTrigger && boundRoot?.contains(entryTrigger)) return toggleEntry(String(entryTrigger.dataset.bakemonoPromptEntry || ''), entryTrigger);
        const copyTrigger = event.target.closest('[data-bakemono-prompt-copy]');
        if (copyTrigger && boundRoot?.contains(copyTrigger)) return void copyEntry(String(copyTrigger.dataset.bakemonoPromptCopy || ''));
        if (event.target.closest('#bakemono-memory-prompt-inspector-search-previous')) navigateSearch(-1);
        else if (event.target.closest('#bakemono-memory-prompt-inspector-search-next')) navigateSearch(1);
        else if (event.target.closest('#bakemono-memory-prompt-inspector-clear')) clearSearch();
    }

    function handleSubmit(event) {
        if (event.target.id !== 'bakemono-memory-prompt-inspector-search-form') return;
        event.preventDefault();
        applySearch(document.getElementById('bakemono-memory-prompt-inspector-query')?.value);
    }

    function handleInput(event) {
        if (event.target.id !== 'bakemono-memory-prompt-inspector-query') return;
        document.getElementById('bakemono-memory-prompt-inspector-search-form')?.classList.toggle('has-pending-query', String(event.target.value || '').trim() !== searchQuery);
    }

    function unbindEvents() {
        if (!boundRoot) return;
        boundRoot.removeEventListener('click', handleClick);
        boundRoot.removeEventListener('submit', handleSubmit);
        boundRoot.removeEventListener('input', handleInput);
        boundRoot = null;
    }

    function bindEvents(root) {
        if (!root || boundRoot === root) return;
        unbindEvents();
        boundRoot = root;
        root.addEventListener('click', handleClick);
        root.addEventListener('submit', handleSubmit);
        root.addEventListener('input', handleInput);
    }

    return { bindEvents, getLastCompletePromptUsage, render, unbindEvents };
}
