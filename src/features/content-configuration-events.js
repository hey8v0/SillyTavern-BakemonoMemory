export function createContentConfigurationEvents({
    query,
    navigatorRef,
    getState,
    defaultInjectionTemplate,
    syncInjection,
    persistSharedConfigurationFromState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    renderInjectionContent,
} = {}) {
    function bindInjectionEvents() {
        query('#bakemono-memory-copy-injection').off('click').on('click', async () => {
            syncInjection();
            const content = String(query('#bakemono-memory-injection-content').val() || '');
            await navigatorRef.clipboard.writeText(content);
            toastr.success('注入内容已复制。');
        });
        query('#bakemono-memory-reset-template').off('click').on('click', () => {
            const confirmed = confirmDanger(
                '恢复默认注入模板？',
                ['当前注入模板会被默认模板覆盖，记忆正文会保留。'],
            );
            if (!confirmed) return;
            const state = getState();
            state.injection.template = defaultInjectionTemplate;
            syncInjection();
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.INJECTION, '注入模板已恢复默认。');
        });
        // These fields stay drafts until the user explicitly saves this page.
        query('#bakemono-memory-injection-enabled, #bakemono-memory-role').off('change');
        query('#bakemono-memory-depth').off('input');
        // The memory body is derived from saved records (read-only); only the template previews live.
        query('#bakemono-memory-injection-template').off('input').on('input', () => {
            const state = getState();
            const previewState = {
                ...state,
                generatedMemory: String(query('#bakemono-memory-source-content').val() || ''),
                injection: {
                    ...state.injection,
                    template: String(query('#bakemono-memory-injection-template').val() || ''),
                },
            };
            const content = renderInjectionContent(previewState, { memory: previewState.generatedMemory });
            query('#bakemono-memory-injection-content').val(content);
            query('#bakemono-memory-injection-char-count').text(`约 ${content.length.toLocaleString()} 字符`);
        });
    }

    function bindPromptEvents() {
        const resetPrompt = ({ selector, title, warning, key, value, status }) => {
            query(selector).off('click').on('click', () => {
                if (!confirmDanger(title, [warning])) return;
                const state = getState();
                state.generationPrompts[key] = value;
                persistSharedConfigurationFromState(state);
                renderWorkbenchScope(workbenchRenderScopes.PROMPTS, status);
            });
        };
        resetPrompt({
            selector: '#bakemono-memory-reset-stage-prompt',
            title: '恢复默认阶段总结提示词？',
            warning: '当前阶段总结提示词会被默认摘要手账模板覆盖。',
            key: 'stage',
            value: defaultStageGenerationPrompt,
            status: '阶段总结提示词已恢复默认。',
        });
        resetPrompt({
            selector: '#bakemono-memory-reset-epic-prompt',
            title: '恢复默认多次总结提示词？',
            warning: '当前多次总结提示词会被默认摘要手账模板覆盖。',
            key: 'epic',
            value: defaultEpicGenerationPrompt,
            status: '多次总结提示词已恢复默认。',
        });
        resetPrompt({
            selector: '#bakemono-memory-reset-story-prompt',
            title: '恢复默认旧正文补课提示词？',
            warning: '当前旧正文补课提示词会被默认摘要手账模板覆盖。',
            key: 'story',
            value: defaultStoryGenerationPrompt,
            status: '旧正文摘要提示词已恢复默认。',
        });
        resetPrompt({
            selector: '#bakemono-memory-reset-missing-prompt',
            title: '恢复默认补写缺失摘要提示词？',
            warning: '当前补写缺失摘要提示词会被默认摘要手账模板覆盖。',
            key: 'missing',
            value: defaultMissingSummaryPrompt,
            status: '补写缺失摘要提示词已恢复默认。',
        });
    }

    function bind() {
        bindInjectionEvents();
        bindPromptEvents();
    }

    return { bind };
}
