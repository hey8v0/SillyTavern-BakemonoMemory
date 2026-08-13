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
        const maxCount = Math.max(1, counts.story, counts.stage, counts.epic);
        const hasScanned = !!state.lastScanAt;
        const mode = state.scanRules.mode || defaultScanRules.mode;
        const includeTags = parseList(state.scanRules.includeTags || defaultScanRules.includeTags);
        const tagSummary = includeTags.slice(0, 3).join('、') || '未设置读取标签';
        query('#bakemono-memory-scan-runtime-title').text(hasScanned ? '识别正常' : '尚未扫描');
        query('#bakemono-memory-scan-runtime-count').text(`${total.toLocaleString()} 条结果`);
        query('#bakemono-memory-scan-runtime-description').text(hasScanned
            ? `${mode === 'full' ? '全文管线' : '标签块'} · ${state.scanRules.includeHidden !== false ? '包含隐藏楼层' : '只看可见楼层'} · ${new Date(state.lastScanAt).toLocaleString()}`
            : '扫描后会在这里显示普通摘要、阶段总结和多次总结的识别数量。');
        query('#bakemono-memory-scan-story-count').text(counts.story);
        query('#bakemono-memory-scan-stage-count').text(counts.stage);
        query('#bakemono-memory-scan-epic-count').text(counts.epic);
        query('#bakemono-memory-scan-story-bar').css('width', `${Math.round((counts.story / maxCount) * 100)}%`);
        query('#bakemono-memory-scan-stage-bar').css('width', `${Math.round((counts.stage / maxCount) * 100)}%`);
        query('#bakemono-memory-scan-epic-bar').css('width', `${Math.round((counts.epic / maxCount) * 100)}%`);
        query('#bakemono-memory-scan-mode-badge').text(mode === 'full' ? '全文管线' : '标签块');
        query('#bakemono-memory-scan-tag-summary').text(includeTags.length > 3 ? `${tagSummary} 等 ${includeTags.length} 个` : tagSummary);
        query('.bakemono-memory-scan-status-hero').toggleClass('is-healthy', hasScanned);
    }

    function renderScanPreview(state = getState()) {
        const container = documentRef.querySelector('#bakemono-memory-scan-preview');
        if (!container) return;
        container.innerHTML = '';
        if (!state.scanPreview.length) {
            const empty = documentRef.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无扫描预览。点击“扫描预览”后会显示命中的片段。';
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
            notice.textContent = `为降低手机内存占用，仅显示最近 ${visibleItems.length} 条扫描结果；其余 ${omittedCount} 条未创建预览节点。`;
            container.append(notice);
        }

        const fragment = documentRef.createDocumentFragment();
        visibleItems.forEach(item => {
            const wrapper = documentRef.createElement('div');
            wrapper.className = 'bakemono-memory-debug-item';
            const meta = documentRef.createElement('div');
            meta.className = 'bakemono-memory-debug-meta';
            meta.textContent = `#${item.messageId}.${item.blockIndex + 1} · ${item.isHidden ? '隐藏' : '可见'} · ${item.scanMode} · <${item.matchedTag}> · ${item.type}`;
            const text = documentRef.createElement('div');
            text.className = 'bakemono-memory-debug-text';
            text.textContent = item.preview;
            wrapper.append(meta, text);
            fragment.append(wrapper);
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
