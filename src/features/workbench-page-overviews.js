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
    defaultGenericStoryGenerationPrompt = '',
    defaultGenericStageGenerationPrompt = '',
    defaultGenericEpicGenerationPrompt = '',
    defaultInjectionTemplate = '',
    getInjectionMemoryParts,
    renderInjectionContent,
    toastr,
    mobileScanPreviewRenderLimit = 60,
    desktopScanPreviewRenderLimit = 120,
}) {
    let promptPreviewType = 'stage';
    let openPrompt = null;

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

    const promptKeys = ['story', 'missing', 'stage', 'epic'];
    const promptDefaults = () => ({
        story: [defaultStoryGenerationPrompt, defaultGenericStoryGenerationPrompt],
        missing: [defaultMissingSummaryPrompt],
        stage: [defaultStageGenerationPrompt, defaultGenericStageGenerationPrompt],
        epic: [defaultEpicGenerationPrompt, defaultGenericEpicGenerationPrompt],
    });
    const isDefaultPrompt = (key, value) => promptDefaults()[key].some(text => text && String(text).trim() === String(value || '').trim());
    // The line a person recognises a prompt by: its first line of real text, without markdown marks.
    const firstLine = text => String(text || '').split('\n').map(line => line.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || '';
    // The empty first option is a placeholder, not a preset name.
    const presetName = selector => {
        const option = documentRef.querySelector(selector)?.selectedOptions?.[0];
        return option?.value ? option.textContent : '';
    };
    function renderPresetValues() {
        documentRef.querySelectorAll('[data-bakemono-preset-value]').forEach(el => {
            el.textContent = presetName(el.dataset.bakemonoPresetValue);
        });
    }

    function renderPromptOverview(state = getState()) {
        let changed = 0;
        for (const key of promptKeys) {
            const item = documentRef.querySelector(`[data-bakemono-prompt="${key}"]`);
            if (!item) continue;
            const value = getPromptPreviewValue(key, state);
            const isDefault = isDefaultPrompt(key, value);
            if (!isDefault) changed++;
            const open = key === openPrompt;
            item.classList.toggle('is-open', open);
            item.querySelector('.bk-prm-h')?.setAttribute('aria-expanded', String(open));
            const body = item.querySelector('.bk-prm-body');
            if (body) body.hidden = !open;
            const first = item.querySelector('[data-bakemono-prompt-first]');
            if (first) first.textContent = firstLine(value);
            const mark = item.querySelector('[data-bakemono-prompt-state]');
            if (mark) { mark.textContent = isDefault ? '默认' : '已修改'; mark.classList.toggle('is-changed', !isDefault); }
        }
        const name = presetName('#bakemono-memory-prompts-preset-select') || '默认提示词';
        query('#bakemono-memory-prompts-current-name').text(changed ? `${name} · 改过 ${changed} 份` : name);
        renderPresetValues();
    }

    // Sizes per source use the home page's source names and colours.
    const injectionSources = [['summary', '阶段／多次总结'], ['memory', '长期记忆'], ['rpState', '剧情状态'], ['table', '表格记忆'], ['vector', '向量召回']];
    function renderInjectionOverview(state = getState()) {
        const enabled = !!state.injection.enabled;
        const content = renderInjectionContent(state);
        const parts = getInjectionMemoryParts(state);
        const sizes = injectionSources.map(([key, label]) => [key, label, String(parts.sources?.[key] || '').length]).filter(([, , size]) => size);
        query('#bakemono-memory-injection-runtime-label').text(enabled ? '开启' : '关闭');
        query('#bakemono-memory-injection-runtime-title').text(!enabled ? '注入没开' : content.length ? `本轮注入 ${content.length.toLocaleString()} 字` : '这一轮没有可注入的内容');
        const shown = enabled ? sizes : [];
        query('#bakemono-memory-injection-stack').html(shown.map(([key, , size]) => `<i data-bakemono-stack-source="${key}" style="flex-grow:${size}"></i>`).join('')).prop('hidden', !shown.length);
        query('#bakemono-memory-injection-legend').html(shown.map(([key, label, size]) => `<span data-bakemono-inj-source="${key}"><b>${size.toLocaleString()}</b>${label}</span>`).join('')).prop('hidden', !shown.length);
        query('#bakemono-memory-injection-char-count').text(`${content.length.toLocaleString()} 字`);
        const template = String(query('#bakemono-memory-injection-template').val() ?? state.injection.template ?? '');
        query('#bakemono-memory-injection-template-state').text(template.trim() === String(defaultInjectionTemplate || '').trim() ? '默认' : '已修改');
        renderPresetValues();
    }

    // Title and custom fields follow the choice on screen, before it is saved.
    function renderGenerationOverview(state = getState()) {
        const picked = documentRef.querySelector('input[name="bakemono-memory-api-provider"]:checked')?.value || state.automation?.apiProvider || 'tavern';
        const custom = picked === 'custom';
        const model = String(query('#bakemono-memory-custom-model').val() || state.automation?.customApi?.model || '').trim();
        query('#bakemono-memory-generation-title').text(custom ? `自定义接口 · ${model || '还没填模型'}` : '用酒馆主模型');
        const fields = documentRef.getElementById('bakemono-memory-custom-api-fields');
        if (fields) fields.hidden = !custom;
        renderPresetValues();
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
        // One prompt open at a time.
        root.off('click.bakemonoPromptOpen').on('click.bakemonoPromptOpen', '[data-bakemono-prompt-open]', function () {
            const key = this.dataset.bakemonoPromptOpen;
            openPrompt = openPrompt === key ? null : key;
            setPromptPreviewType(key);
            renderPromptOverview();
        });
        root.off('click.bakemonoPromptCopy').on('click.bakemonoPromptCopy', '[data-bakemono-prompt-copy]', async function () {
            await navigatorRef.clipboard.writeText(getPromptPreviewValue(this.dataset.bakemonoPromptCopy));
            toastr.success('提示词已复制。');
        });
        root.off('input.bakemonoPromptPreview').on(
            'input.bakemonoPromptPreview',
            '#bakemono-memory-story-prompt, #bakemono-memory-missing-prompt, #bakemono-memory-stage-prompt, #bakemono-memory-epic-prompt',
            () => renderPromptOverview(),
        );
        root.off('change.bakemonoProvider input.bakemonoProvider').on('change.bakemonoProvider input.bakemonoProvider',
            'input[name="bakemono-memory-api-provider"], #bakemono-memory-custom-model', () => renderGenerationOverview());
        root.off('input.bakemonoTemplateState').on('input.bakemonoTemplateState', '#bakemono-memory-injection-template', () => {
            const value = String(query('#bakemono-memory-injection-template').val() || '');
            query('#bakemono-memory-injection-template-state').text(value.trim() === String(defaultInjectionTemplate || '').trim() ? '默认' : '已修改');
        });
        root.off('change.bakemonoPresetValue').on('change.bakemonoPresetValue', 'select[id$="-preset-select"]', () => renderPresetValues());
    }

    return {
        bindPromptEvents,
        getPromptPreviewType,
        getPromptPreviewValue,
        renderGenerationOverview,
        renderInjectionOverview,
        renderPromptOverview,
        renderScanOverview,
        renderScanPreview,
        setPromptPreviewType,
    };
}
