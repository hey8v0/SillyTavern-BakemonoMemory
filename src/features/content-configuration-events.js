export function createContentConfigurationEvents({
    query,
    navigatorRef,
    getState,
    defaultInjectionTemplate,
    normalizeInjectionMemoryBody,
    syncInjection,
    persistSharedConfigurationFromState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    saveState,
    readPromptFieldsFromUi,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    memoryStrategies,
    updateInjectionFromSummaries,
    workflowModes,
    stageSourceModes,
    scanBlocks,
    defaultState,
    extensionPromptRoles,
    renderInjectionContent,
} = {}) {
    function bindInjectionEvents() {
        query('#bakemono-memory-apply-injection').off('click').on('click', () => {
            const state = getState();
            state.injection.template = String(query('#bakemono-memory-injection-template').val() || defaultInjectionTemplate);
            state.generatedMemory = normalizeInjectionMemoryBody(
                query('#bakemono-memory-source-content').val() || '',
                state.injection.template,
                defaultInjectionTemplate,
            );
            syncInjection();
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.INJECTION, '注入内容已应用，注入设置已同步到所有角色卡。');
            toastr.success('注入内容已应用，设置已全局保存。');
        });
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
        query('#bakemono-memory-clear-injection').off('click').on('click', () => {
            const confirmed = confirmDanger(
                '清空记忆正文？',
                ['这会清空手动编辑的记忆正文；已保存摘要仍在，但当前自定义正文会消失。'],
            );
            if (!confirmed) return;
            const state = getState();
            state.generatedMemory = '';
            syncInjection();
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.INJECTION, '注入内容已清空。');
        });
        query('#bakemono-memory-injection-enabled').off('change').on('change', function () {
            const state = getState();
            state.injection.enabled = !!this.checked;
            syncInjection();
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.INJECTION);
        });
        query('#bakemono-memory-depth').off('input').on('input', function () {
            const state = getState();
            state.injection.depth = Math.max(0, Number(this.value || defaultState.injection.depth));
            syncInjection();
            persistSharedConfigurationFromState(state);
        });
        query('#bakemono-memory-role').off('change').on('change', function () {
            const state = getState();
            state.injection.role = Number(this.value || extensionPromptRoles.SYSTEM);
            syncInjection();
            persistSharedConfigurationFromState(state);
        });
        query('#bakemono-memory-source-content, #bakemono-memory-injection-template').off('input').on('input', () => {
            const state = getState();
            const previewState = {
                ...state,
                generatedMemory: String(query('#bakemono-memory-source-content').val() || ''),
                injection: {
                    ...state.injection,
                    template: String(query('#bakemono-memory-injection-template').val() || ''),
                },
            };
            const content = renderInjectionContent(previewState);
            query('#bakemono-memory-injection-content').val(content);
            query('#bakemono-memory-injection-char-count').text(`约 ${content.length.toLocaleString()} 字符`);
        });
    }

    function bindPromptEvents() {
        query('#bakemono-memory-apply-prompts').off('click').on('click', () => {
            const state = getState();
            readPromptFieldsFromUi(state);
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.PROMPTS, '生成提示词已应用，并同步到所有角色卡。');
            toastr.success('生成提示词已全局保存。');
        });
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

    function bindWorkflowEvents() {
        query('#bakemono-memory-memory-strategy').off('change').on('change', function () {
            const state = getState();
            state.memoryStrategy = Object.values(memoryStrategies).includes(this.value) ? this.value : memoryStrategies.BAKEMONO;
            updateInjectionFromSummaries();
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.SETTINGS, '记忆策略已切换。');
        });
        query('#bakemono-memory-workflow-mode').off('change').on('change', function () {
            const state = getState();
            state.workflowMode = Object.values(workflowModes).includes(this.value) ? this.value : workflowModes.BAKEMONO;
            if (state.workflowMode === workflowModes.GENERIC) {
                state.memoryStrategy = memoryStrategies.GENERIC;
                state.stageSourceMode = stageSourceModes.BACKFILL;
                state.outputMode = 'plain';
            } else if (state.workflowMode === workflowModes.BAKEMONO) {
                state.memoryStrategy = memoryStrategies.BAKEMONO;
                state.stageSourceMode = stageSourceModes.SUMMARIES;
                state.outputMode = 'bakemono';
            }
            scanBlocks({ persist: false });
            updateInjectionFromSummaries();
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.SETTINGS, '工作流模式已切换，已有扫描和自动总结配置已保留。');
        });
        query('#bakemono-memory-stage-source-mode').off('change').on('change', function () {
            const state = getState();
            state.stageSourceMode = Object.values(stageSourceModes).includes(this.value) ? this.value : stageSourceModes.SUMMARIES;
            scanBlocks({ persist: false });
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.SETTINGS, '阶段总结材料已切换。');
        });
        query('#bakemono-memory-output-mode').off('change').on('change', function () {
            const state = getState();
            state.outputMode = ['bakemono', 'plain', 'custom'].includes(this.value) ? this.value : 'bakemono';
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.SETTINGS, '输出风格已切换。');
        });
    }

    function bind() {
        bindInjectionEvents();
        bindPromptEvents();
        bindWorkflowEvents();
    }

    return { bind };
}
