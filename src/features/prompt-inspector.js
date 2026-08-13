const maxSearchResults = 2000;
const maxRenderedMatches = 240;

function getPromptRoleMeta(role) {
    const normalizedRole = String(role || '').trim().toLowerCase();
    const roles = {
        system: { label: '系统消息', description: 'Role: system', icon: 'fa-terminal' },
        developer: { label: '开发者消息', description: 'Role: developer', icon: 'fa-code' },
        user: { label: '用户消息', description: 'Role: user', icon: 'fa-user' },
        assistant: { label: '助手消息', description: 'Role: assistant', icon: 'fa-robot' },
        tool: { label: '工具结果', description: 'Role: tool', icon: 'fa-screwdriver-wrench' },
        function: { label: '函数结果', description: 'Role: function', icon: 'fa-gears' },
    };
    return roles[normalizedRole] || { label: '其他消息', description: 'Role: other', icon: 'fa-message' };
}

function collectPromptMessages(value, messages = [], seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return messages;
    seen.add(value);
    if (Array.isArray(value)) {
        value.forEach(item => collectPromptMessages(item, messages, seen));
        return messages;
    }
    if (typeof value.role === 'string' && (Object.prototype.hasOwnProperty.call(value, 'content') || Array.isArray(value.tool_calls))) {
        messages.push(value);
        return messages;
    }
    Object.values(value).forEach(item => collectPromptMessages(item, messages, seen));
    return messages;
}

function formatPromptMessageContent(message) {
    const content = message?.content;
    let text = '';
    if (typeof content === 'string') {
        text = content;
    } else if (Array.isArray(content)) {
        text = content.map(part => {
            if (typeof part === 'string') return part;
            if (typeof part?.text === 'string') return part.text;
            if (typeof part?.content === 'string') return part.content;
            if (part?.type === 'image_url' || part?.image_url) {
                const detail = String(part?.image_url?.detail || '').trim();
                return detail ? `[图片内容 · ${detail}]` : '[图片内容]';
            }
            if (part?.type === 'video_url' || part?.video_url) return '[视频内容]';
            return '';
        }).filter(Boolean).join('\n');
    } else if (content && typeof content === 'object') {
        if (typeof content.text === 'string') text = content.text;
        else if (typeof content.content === 'string') text = content.content;
        else {
            try {
                text = JSON.stringify(content, null, 2);
            } catch {
                text = '';
            }
        }
    }
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
        const toolCalls = JSON.stringify(message.tool_calls, null, 2);
        text = [text, `【工具调用】\n${toolCalls}`].filter(Boolean).join('\n\n');
    }
    return text || '（空消息）';
}

export async function countNativePromptMessageTokens(message, {
    countTokens,
    countImageTokens = async () => 0,
    countVideoTokens = async () => 0,
} = {}) {
    const content = message?.content;
    if (!content) {
        if (message?.role === 'assistant' && Array.isArray(message?.tool_calls) && message.tool_calls.length) {
            return Math.max(0, Number(await countTokens?.(JSON.stringify(message.tool_calls))) || 0);
        }
        return 0;
    }
    if (typeof content === 'string') return Math.max(0, Number(await countTokens?.(content)) || 0);
    if (!Array.isArray(content)) return 0;
    const partCounts = await Promise.all(content.map(async part => {
        if (part?.type === 'text') return Math.max(0, Number(await countTokens?.(String(part.text || ''))) || 0);
        if (part?.type === 'image_url') {
            return Math.max(0, Number(await countImageTokens?.(part.image_url?.url, part.image_url?.detail)) || 0);
        }
        if (part?.type === 'video_url') {
            return Math.max(0, Number(await countVideoTokens?.(part.video_url?.url)) || 0);
        }
        return 0;
    }));
    return partCounts.reduce((sum, count) => sum + count, 0);
}

export async function countNativePromptTokens(rawPrompt, {
    countTokens,
    countImageTokens = async () => 0,
    countVideoTokens = async () => 0,
} = {}) {
    if (typeof rawPrompt === 'string') return Math.max(0, Number(await countTokens?.(rawPrompt)) || 0);
    const messages = collectPromptMessages(rawPrompt);
    const counts = await Promise.all(messages.map(message => countNativePromptMessageTokens(message, {
        countTokens,
        countImageTokens,
        countVideoTokens,
    })));
    return counts.reduce((sum, count) => sum + count, 0);
}

export async function buildFinalPromptEntries(rawPrompt, {
    countTokens,
    countImageTokens = async () => 0,
    countVideoTokens = async () => 0,
} = {}) {
    if (typeof rawPrompt === 'string') {
        const content = rawPrompt || '（空 Prompt）';
        return [{
            key: 'message-1',
            label: '完整文本 Prompt',
            description: 'Text completion · 上一轮最终请求',
            icon: 'fa-file-lines',
            tokens: Math.max(0, Number(await countTokens?.(rawPrompt)) || 0),
            getContent: () => content,
        }];
    }
    const messages = collectPromptMessages(rawPrompt);
    return await Promise.all(messages.map(async (message, index) => {
        const role = getPromptRoleMeta(message?.role);
        const position = index + 1;
        const content = formatPromptMessageContent(message);
        return {
            key: `message-${position}`,
            label: `${String(position).padStart(2, '0')} · ${role.label}`,
            description: `${role.description} · 上一轮最终请求`,
            icon: role.icon,
            tokens: await countNativePromptMessageTokens(message, { countTokens, countImageTokens, countVideoTokens }),
            getContent: () => content,
        };
    }));
}

function formatPromptSnapshot(rawPrompt) {
    if (typeof rawPrompt === 'string') return rawPrompt || '（空 Prompt）';
    const messages = collectPromptMessages(rawPrompt);
    if (!messages.length) {
        try {
            return JSON.stringify(rawPrompt, null, 2) || '（空 Prompt）';
        } catch {
            return '（空 Prompt）';
        }
    }
    return messages.map((message, index) => {
        const role = String(message?.role || 'other').toUpperCase();
        return `【${String(index + 1).padStart(2, '0')} · ${role}】\n${formatPromptMessageContent(message)}`;
    }).join('\n\n');
}

function joinPromptSourceSections(sections) {
    return sections
        .filter(([, value]) => String(value || '').trim())
        .map(([title, value]) => `【${title}】\n${String(value).trim()}`)
        .join('\n\n');
}

export async function buildPromptSourceEntries(entry, {
    countTokens,
} = {}) {
    const source = entry || {};
    const roleCard = joinPromptSourceSections([
        ['角色描述', source.charDescription],
        ['角色性格', source.charPersonality],
        ['场景设定', source.scenarioText],
    ]);
    const extensionContent = String(source.allAnchors || '').trim() || joinPromptSourceSections([
        ['记忆扩展', source.summarizeString],
        ['作者注释', source.authorsNoteString],
        ['Smart Context', source.smartContextString],
        ['聊天向量', source.chatVectorsString],
        ['资料库向量', source.dataBankVectorsString],
        ['场景前锚点', source.beforeScenarioAnchor],
        ['场景后锚点', source.afterScenarioAnchor],
    ]);
    const candidates = [
        { key: 'source-character', label: '角色卡', description: '角色描述、性格与场景设定', icon: 'fa-address-card', content: roleCard },
        { key: 'source-persona', label: 'User 人设', description: '上一轮使用的用户身份与人设', icon: 'fa-user', content: String(source.userPersona || '') },
        { key: 'source-world-info', label: '世界书', description: '上一轮实际触发并进入组装的世界信息', icon: 'fa-earth-asia', content: String(source.worldInfoString || '') },
        { key: 'source-examples', label: '示例对话', description: '角色卡中的示例消息', icon: 'fa-comments', content: String(source.examplesString || '') },
        { key: 'source-chat', label: '聊天记录', description: '上一轮进入上下文的聊天消息', icon: 'fa-message', content: String(source.mesSendString || '') },
        { key: 'source-extensions', label: '扩展注入', description: '记忆、作者注释、向量与其他扩展内容', icon: 'fa-puzzle-piece', content: extensionContent },
        { key: 'source-bias', label: 'Prompt Bias', description: '上一轮追加的偏置提示', icon: 'fa-thumbtack', content: String(source.promptBias || '') },
    ].filter(item => item.content.trim());
    return await Promise.all(candidates.map(async item => ({
        ...item,
        tokens: Math.max(0, Number(await countTokens?.(item.content)) || 0),
        getContent: () => item.content,
    })));
}

export function createPromptInspector({
    getChat,
    getItemizedPrompts,
    getItemizedParams,
    countTokens,
    countImageTokens,
    countVideoTokens,
    getActiveTab,
    notifySuccess = () => {},
    notifyError = () => {},
    logWarning = (...args) => console.warn(...args),
} = {}) {
    let renderRevision = 0;
    let openEntryKey = '';
    let activeView = 'full';
    let currentUsage = null;
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
                const rawPrompt = snapshot.entry?.rawPrompt ?? snapshot.entry?.finalPrompt ?? '';
                const nativeTotal = await countNativePromptTokens(rawPrompt, { countTokens, countImageTokens, countVideoTokens });
                const total = nativeTotal || Number(params?.finalPromptTokens || params?.totalTokensInPrompt || 0);
                if (!Number.isFinite(total) || total <= 0) return null;
                return {
                    total,
                    messageId: snapshot.messageId,
                    promptText: flattenPromptSnapshot(rawPrompt),
                    rawPrompt,
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

    async function buildMessageEntries(usage) {
        return await buildFinalPromptEntries(usage?.rawPrompt, {
            countTokens,
            countImageTokens,
            countVideoTokens,
        });
    }

    async function buildEntries(usage, view = activeView) {
        const messageEntries = await buildMessageEntries(usage);
        if (view === 'messages') return messageEntries;
        if (view === 'sources') return await buildPromptSourceEntries(usage?.entry, { countTokens });
        const total = messageEntries.reduce((sum, item) => sum + Number(item.tokens || 0), 0) || usage?.total || 0;
        const content = formatPromptSnapshot(usage?.rawPrompt);
        return [{
            key: 'full-prompt',
            label: '完整 Prompt',
            description: `${messageEntries.length.toLocaleString()} 条最终消息 · 上一轮已发送`,
            icon: 'fa-file-lines',
            tokens: total,
            getContent: () => content,
        }];
    }

    function updateViewControls() {
        document.querySelectorAll('[data-bakemono-prompt-view]').forEach(button => {
            const selected = button.dataset.bakemonoPromptView === activeView;
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-selected', String(selected));
        });
        const labels = { full: '完整 Prompt', sources: '来源拆分', messages: '最终消息顺序' };
        setText('bakemono-memory-prompt-inspector-view-label', labels[activeView] || '内容条目');
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
            currentUsage = null;
            setText('bakemono-memory-prompt-inspector-count', '暂无记录');
            setText('bakemono-memory-prompt-inspector-model', '等待生成回复');
            setEmptyState(true);
            return;
        }
        currentUsage = usage;
        const messageEntries = await buildMessageEntries(usage);
        const resolvedEntries = await buildEntries(usage, activeView);
        if (revision !== renderRevision || getActiveTab?.() !== 'prompt-inspector') return;
        resolvedEntries.forEach(item => entries.set(item.key, item));
        const model = String(usage.params?.modelUsed || '').trim();
        const preset = String(usage.params?.presetName || '').trim();
        setText('bakemono-memory-prompt-inspector-count', `${resolvedEntries.length.toLocaleString()} 个条目`);
        const displayedTotal = messageEntries.reduce((sum, item) => sum + Number(item.tokens || 0), 0) || usage.total;
        setText('bakemono-memory-prompt-inspector-total', `${displayedTotal.toLocaleString()} Token`);
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
        updateViewControls();
        setEmptyState(!resolvedEntries.length);
        setSearchEnabled(!!resolvedEntries.length);
        applySearch(searchQuery, { focusFirst: false });
    }

    async function switchView(view) {
        if (!['full', 'sources', 'messages'].includes(view) || activeView === view) return;
        activeView = view;
        searchQuery = '';
        const input = document.getElementById('bakemono-memory-prompt-inspector-query');
        if (input) input.value = '';
        updateViewControls();
        if (currentUsage) await render();
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
        const viewTrigger = event.target.closest('[data-bakemono-prompt-view]');
        if (viewTrigger && boundRoot?.contains(viewTrigger)) return void switchView(String(viewTrigger.dataset.bakemonoPromptView || ''));
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
