export function createOverviewTokenManifest({
    query,
    getState,
    getHash,
    countTokens,
    getInjectionMemoryParts,
    renderInjectionContent,
    renderInlinePrompt,
    defaultInjectionTemplate,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    getLastPromptUsage,
    getActiveTab,
    logWarning,
}) {
    let renderRevision = 0;
    const tokenCache = new Map();

    function getOverviewInjectionSources(state = getState()) {
        const parts = getInjectionMemoryParts(state);
        const mainInjectionEnabled = !!state.injection?.enabled;
        const mainInjectionContent = mainInjectionEnabled ? renderInjectionContent(state) : '';
        const ruleSections = [];
        if (mainInjectionContent) {
            ruleSections.push(String(state.injection?.template || defaultInjectionTemplate).replaceAll('{{memory}}', '').trim());
        }
        if (state.inlineGeneration?.summaryEnabled) {
            ruleSections.push(renderInlinePrompt(state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt, state));
        }
        if (state.inlineGeneration?.tableEnabled) {
            ruleSections.push(renderInlinePrompt(state.inlineGeneration.tablePrompt || defaultInlineTablePrompt, state));
        }
        return {
            summary: mainInjectionContent ? String(parts.sources?.summary || '') : '',
            memory: mainInjectionContent ? String(parts.sources?.memory || '') : '',
            table: mainInjectionContent ? String(parts.sources?.table || '') : '',
            vector: mainInjectionContent ? String(parts.sources?.vector || '') : '',
            rule: ruleSections.filter(Boolean).join('\n\n'),
        };
    }

    function estimateOverviewTokenCount(text) {
        const value = String(text || '');
        if (!value.trim()) return 0;
        const cjkCount = (value.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
        const remainingCount = Math.max(0, value.length - cjkCount);
        return Math.max(1, Math.round((cjkCount * 1.05) + (remainingCount / 4)));
    }

    async function getOverviewTokenCount(text) {
        const value = String(text || '');
        if (!value.trim()) return 0;
        const cacheKey = `${value.length}:${getHash(value)}`;
        if (tokenCache.has(cacheKey)) return tokenCache.get(cacheKey);
        let count;
        try {
            count = await countTokens(value);
        } catch (error) {
            logWarning('[BakemonoMemory] token count failed, using local estimate', error);
            count = estimateOverviewTokenCount(value);
        }
        const normalizedCount = Math.max(0, Number(count) || 0);
        tokenCache.set(cacheKey, normalizedCount);
        if (tokenCache.size > 36) {
            tokenCache.delete(tokenCache.keys().next().value);
        }
        return normalizedCount;
    }

    function doesLastPromptMatchCurrentInjection(promptText, state = getState()) {
        const expectedSections = [];
        if (state.injection?.enabled) {
            const content = renderInjectionContent(state);
            if (content) expectedSections.push(content);
        }
        if (state.inlineGeneration?.summaryEnabled) {
            expectedSections.push(renderInlinePrompt(state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt, state));
        }
        if (state.inlineGeneration?.tableEnabled) {
            expectedSections.push(renderInlinePrompt(state.inlineGeneration.tablePrompt || defaultInlineTablePrompt, state));
        }
        const normalizedPrompt = String(promptText || '');
        return expectedSections.every(section => !section || normalizedPrompt.includes(section));
    }

    function formatPromptSharePercent(total, fullPromptTotal) {
        if (!fullPromptTotal) return '—%';
        const value = Math.max(0, (total / fullPromptTotal) * 100);
        if (value > 0 && value < 0.1) return '<0.1%';
        if (value < 10) return `${value.toFixed(1)}%`;
        return `${Math.round(value)}%`;
    }

    async function renderOverviewTokenManifest(state = getState()) {
        const revision = ++renderRevision;
        const sourceTexts = getOverviewInjectionSources(state);
        const sourceKeys = ['summary', 'memory', 'table', 'vector', 'rule'];
        const sourceCounts = await Promise.all(sourceKeys.map(key => getOverviewTokenCount(sourceTexts[key])));
        const lastPromptUsage = await getLastPromptUsage();
        if (revision !== renderRevision || getActiveTab() !== 'overview') return;

        const counts = Object.fromEntries(sourceKeys.map((key, index) => [key, sourceCounts[index]]));
        const total = sourceCounts.reduce((sum, count) => sum + count, 0);
        const promptMatches = !!lastPromptUsage && doesLastPromptMatchCurrentInjection(lastPromptUsage.promptText, state);
        query('#bakemono-memory-overview-token-total').text(total.toLocaleString());
        query('#bakemono-memory-overview-token-percent').text(promptMatches ? formatPromptSharePercent(total, lastPromptUsage.total) : '—%');
        query('#bakemono-memory-overview-token-scope').text(!lastPromptUsage ? '等待上一轮' : promptMatches ? '上一轮实测' : '配置已变更');
        sourceKeys.forEach(key => {
            const value = counts[key] || 0;
            query(`#bakemono-memory-token-${key}`).text(value.toLocaleString());
            query(`#bakemono-memory-token-bar-${key}`).css('width', total ? `${Math.max(0, Math.min(100, (value / total) * 100))}%` : '0%');
        });
    }

    return {
        doesLastPromptMatchCurrentInjection,
        estimateOverviewTokenCount,
        formatPromptSharePercent,
        getOverviewInjectionSources,
        getOverviewTokenCount,
        renderOverviewTokenManifest,
    };
}
