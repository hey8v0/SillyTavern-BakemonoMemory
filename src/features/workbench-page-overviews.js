export function createWorkbenchPageOverviews({
    documentRef,
    windowRef,
    navigatorRef,
    query,
    getState,
    blockTypes,
    defaultScanRules,
    parseList,
    getPromptStructureExcerpt,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    getInjectionMemoryParts,
    renderInjectionContent,
    toastr,
    mobileScanPreviewRenderLimit = 60,
    desktopScanPreviewRenderLimit = 120,
}) {
    let promptPreviewType = 'stage';

    function getPromptPreviewType() {
        return promptPreviewType;
    }

    function setPromptPreviewType(type) {
        promptPreviewType = ['story', 'missing', 'stage', 'epic'].includes(type) ? type : 'stage';
    }

    function getPromptPreviewValue(type = promptPreviewType, state = getState()) {
        const config = {
            story: ['#bakemono-memory-story-prompt', state.generationPrompts.story || defaultStoryGenerationPrompt],
            missing: ['#bakemono-memory-missing-prompt', state.generationPrompts.missing || defaultMissingSummaryPrompt],
            stage: ['#bakemono-memory-stage-prompt', state.generationPrompts.stage || defaultStageGenerationPrompt],
            epic: ['#bakemono-memory-epic-prompt', state.generationPrompts.epic || defaultEpicGenerationPrompt],
        }[type] || ['#bakemono-memory-stage-prompt', state.generationPrompts.stage || defaultStageGenerationPrompt];
        const editorValue = String(query(config[0]).val() || '').trim();
        return editorValue || String(config[1] || '').trim();
    }

    function renderPromptOverview(state = getState()) {
        setPromptPreviewType(promptPreviewType);
        const meta = {
            story: { label: '旧聊天补课', description: '把没有摘要的旧正文分批压缩进插件记忆，不写回原楼层。' },
            missing: { label: '缺失摘要', description: '为漏写摘要的助手楼层补回标准摘要块。' },
            stage: { label: '阶段总结', description: '把普通摘要整理成带时间轴的阶段记忆。' },
            epic: { label: '多次总结', description: '把多个阶段继续整理成长时间线总览。' },
        }[promptPreviewType];
        const prompt = getPromptPreviewValue(promptPreviewType, state);
        const select = documentRef.querySelector('#bakemono-memory-prompts-preset-select');
        const selectedName = select?.selectedOptions?.[0]?.textContent
            || String(query('#bakemono-memory-prompts-preset-name').val() || '').trim()
            || '默认提示词';
        query('#bakemono-memory-prompts-current-name').text(selectedName);
        query('#bakemono-memory-prompts-preview-label').text(meta.label);
        query('#bakemono-memory-prompts-preview-description').text(meta.description);
        query('#bakemono-memory-prompts-structure-preview').text(getPromptStructureExcerpt(prompt));
        documentRef.querySelectorAll('[data-bakemono-prompt-preview]').forEach(button => {
            const isActive = button.dataset.bakemonoPromptPreview === promptPreviewType;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });
    }

    function renderInjectionOverview(state = getState()) {
        const parts = getInjectionMemoryParts(state);
        const stats = parts.stats;
        const content = renderInjectionContent(state);
        const total = (stats.epic || 0) + (stats.stage || 0) + (stats.story || 0) + (stats.table || 0) + (stats.vector || 0);
        const enabled = !!state.injection.enabled;
        query('#bakemono-memory-injection-runtime-label').text(enabled ? '注入已开启' : '注入未开启');
        query('#bakemono-memory-injection-runtime-title').text(`本轮共 ${total.toLocaleString()} 条记忆`);
        query('#bakemono-memory-injection-runtime-description').text(enabled
            ? `多次总结 ${stats.epic || 0} · 阶段总结 ${stats.stage || 0} · 普通摘要 ${stats.story || 0} · 表格 ${stats.table || 0} · 向量召回 ${stats.vector || 0}`
            : '当前最终内容不会发送给模型；可在工作流细节中开启剧情记忆注入。');
        query('#bakemono-memory-injection-source-total').text(`${total.toLocaleString()} 条`);
        query('#bakemono-memory-injection-source-epic').text(stats.epic || 0);
        query('#bakemono-memory-injection-source-summary').text((stats.stage || 0) + (stats.story || 0));
        query('#bakemono-memory-injection-source-table').text(stats.table || 0);
        query('#bakemono-memory-injection-source-vector').text(stats.vector || 0);
        query('#bakemono-memory-injection-char-count').text(`约 ${content.length.toLocaleString()} 字符`);
        const select = documentRef.querySelector('#bakemono-memory-injection-preset-select');
        query('#bakemono-memory-injection-preset-summary').text(select?.selectedOptions?.[0]?.textContent || '当前配置');
        query('.bakemono-memory-injection-status-hero').toggleClass('is-active', enabled);
    }

    function renderScanOverview(state = getState()) {
        const blocks = Array.isArray(state.blocks) ? state.blocks : [];
        const counts = {
            story: blocks.filter(block => block.type === blockTypes.STORY).length,
            stage: blocks.filter(block => block.type === blockTypes.STAGE).length,
            epic: blocks.filter(block => block.type === blockTypes.EPIC).length,
        };
        const total = Math.max(Number(state.lastScanMatchCount || 0), counts.story + counts.stage + counts.epic);
        const hasScanned = !!state.lastScanAt;
        const includeTags = parseList(state.scanRules.includeTags || defaultScanRules.includeTags);
        const excludeCount = parseList(state.scanRules.excludeTags || '').length;
        query('#bakemono-memory-scan-runtime-title').text(hasScanned ? new Date(state.lastScanAt).toLocaleString() : '尚未扫描');
        query('#bakemono-memory-scan-runtime-count').text(hasScanned ? `扫出 ${total.toLocaleString()} 条摘要` : '还没有扫描');
        query('#bakemono-memory-scan-story-count').text(counts.story);
        query('#bakemono-memory-scan-stage-count').text(counts.stage);
        query('#bakemono-memory-scan-epic-count').text(counts.epic);
        query('#bakemono-memory-scan-pool-count').text(`${total.toLocaleString()} 条`);
        query('#bakemono-memory-scan-tag-summary').text([
            includeTags.length > 2 ? `${includeTags.slice(0, 2).join('、')} 等 ${includeTags.length} 个` : includeTags.join('、') || '未设置',
            excludeCount ? `去掉 ${excludeCount} 个` : '',
        ].filter(Boolean).join(' · '));
    }

    function renderScanPreview(state = getState()) {
        const container = documentRef.querySelector('#bakemono-memory-scan-preview');
        if (!container) return;
        container.innerHTML = '';
        if (!state.scanPreview.length) {
            const empty = documentRef.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '还没有扫描结果。';
            container.append(empty);
            return;
        }

        const renderLimit = windowRef.matchMedia?.('(max-width: 900px)').matches
            ? mobileScanPreviewRenderLimit
            : desktopScanPreviewRenderLimit;
        const visibleItems = state.scanPreview.slice(-renderLimit);
        const totalMatches = Math.max(Number(state.lastScanMatchCount || 0), state.scanPreview.length);
        const omittedCount = Math.max(0, totalMatches - visibleItems.length);
        if (omittedCount) {
            const notice = documentRef.createElement('div');
            notice.className = 'bakemono-memory-empty';
            notice.textContent = `只列出最近 ${visibleItems.length} 条，另有 ${omittedCount} 条没有列出。`;
            container.append(notice);
        }

        const kinds = { [blockTypes.STORY]: ['剧情摘要', 'is-event'], [blockTypes.STAGE]: ['阶段总结', 'is-people'], [blockTypes.EPIC]: ['多次总结', ''] };
        const fragment = documentRef.createDocumentFragment();
        visibleItems.slice().reverse().forEach(item => {
            const row = documentRef.createElement('div');
            const [kind, tone] = kinds[item.type] || [String(item.type || ''), ''];
            row.className = `bk-scan-row ${tone}`;
            row.title = `<${item.matchedTag}> · ${item.scanMode}`;
            const floor = documentRef.createElement('b');
            floor.textContent = `#${item.messageId}${item.isHidden ? ' · 隐藏' : ''}`;
            const label = documentRef.createElement('span');
            label.className = 'bk-scan-kind';
            label.textContent = kind;
            const text = documentRef.createElement('span');
            text.className = 'bk-scan-text';
            // The summary's own title when it has one (『…』), otherwise its first words without the “📋 剧情摘要” lead.
            const preview = String(item.preview || '');
            text.textContent = preview.match(/『([^』]+)』/)?.[1] || preview.replace(/^[📋\s]*(剧情摘要|正文摘要|阶段总结|多次总结)?\s*/u, '');
            row.append(floor, label, text);
            fragment.append(row);
        });
        container.append(fragment);
    }

    function bindPromptEvents(rootSelector = '#bakemono-workbench-root') {
        const root = query(rootSelector);
        root.off('click.bakemonoPromptPreview').on('click.bakemonoPromptPreview', '[data-bakemono-prompt-preview]', function () {
            setPromptPreviewType(this.dataset.bakemonoPromptPreview || 'stage');
            renderPromptOverview();
        });
        root.off('input.bakemonoPromptPreview').on(
            'input.bakemonoPromptPreview',
            '#bakemono-memory-story-prompt, #bakemono-memory-missing-prompt, #bakemono-memory-stage-prompt, #bakemono-memory-epic-prompt',
            () => renderPromptOverview(),
        );
        query('#bakemono-memory-copy-prompt-preview').off('click').on('click', async () => {
            await navigatorRef.clipboard.writeText(getPromptPreviewValue(getPromptPreviewType()));
            toastr.success('当前提示词已复制。');
        });
    }

    return {
        bindPromptEvents,
        getPromptPreviewType,
        getPromptPreviewValue,
        renderInjectionOverview,
        renderPromptOverview,
        renderScanOverview,
        renderScanPreview,
        setPromptPreviewType,
    };
}
