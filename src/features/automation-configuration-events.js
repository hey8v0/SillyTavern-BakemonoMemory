export function createAutomationConfigurationEvents({
    query,
    documentRef,
    getState,
    readAutomationFieldsFromUi,
    readGenerationTargetSettings,
    persistSharedConfigurationFromState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    defaultAutomation,
    fetchCustomApiModels,
} = {}) {
    function bind() {
        query('#bakemono-memory-apply-automation').off('click').on('click', () => {
            const state = getState();
            readAutomationFieldsFromUi(state);
            readGenerationTargetSettings();
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.AUTOMATION, '自动总结与生成 API 已同步到所有角色卡。');
            toastr.success('自动总结与生成 API 已全局保存。');
        });
        query('#bakemono-memory-auto-trigger').off('change.bakemonoAutomationUi').on('change.bakemonoAutomationUi', function () {
            const triggerType = String(this.value || defaultAutomation.triggerType);
            documentRef.querySelectorAll('[data-bakemono-auto-rule]').forEach(row => {
                row.hidden = row.dataset.bakemonoAutoRule !== triggerType;
            });
        });
        query('#bakemono-memory-fetch-models').off('click').on('click', async () => {
            await fetchCustomApiModels();
        });
        query('#bakemono-memory-toggle-api-key').off('click').on('click', function () {
            const input = documentRef.querySelector('#bakemono-memory-custom-api-key');
            if (!input) return;
            const shouldShow = input.type === 'password';
            input.type = shouldShow ? 'text' : 'password';
            this.title = shouldShow ? '隐藏接口密钥' : '显示接口密钥';
            this.setAttribute('aria-label', this.title);
            this.querySelector('i')?.classList.toggle('fa-eye', !shouldShow);
            this.querySelector('i')?.classList.toggle('fa-eye-slash', shouldShow);
            const label = this.querySelector('span');
            if (label) label.textContent = shouldShow ? '隐藏' : '显示';
        });
        query('#bakemono-memory-stage-target-mode, #bakemono-memory-stage-target-count, #bakemono-memory-stage-target-range, #bakemono-memory-epic-target-mode, #bakemono-memory-epic-target-count, #bakemono-memory-epic-target-range')
            .off('change input')
            .on('change input', () => readGenerationTargetSettings());
    }

    return { bind };
}
