export function createWorkbenchShellEvents({
    query,
    documentRef,
    windowRef,
    extensionSettings,
    storageKey,
    saveSettingsDebounced,
    renderExtensionEntrySettings,
    syncTopNavButton,
    syncMobileCollapsibles,
    openWorkbench,
    closeWorkbench,
    setWorkbenchMenuOpen,
    switchWorkbenchTab,
    stabilizeMobileWorkbenchScroll,
    operationFeedback,
    bindThemeEvents,
    promptInspector,
    helpGuide,
    helpPopover,
    runWorkbenchAction,
    getWorkbenchActionRenderScope,
    renderWorkbenchScope,
    logError = (...args) => console.error(...args),
} = {}) {
    function bind() {
        windowRef.removeEventListener('resize', syncMobileCollapsibles);
        windowRef.addEventListener('resize', syncMobileCollapsibles);
        const rootElement = documentRef.getElementById('bakemono-workbench-root');
        const root = query(rootElement);
        operationFeedback.bindCapture(rootElement);

        query('#bakemono-memory-extension-open').off('click').on('click', () => openWorkbench());
        query('#bakemono-memory-show-top-nav').off('change').on('change', function () {
            const settings = extensionSettings[storageKey];
            settings.ui = settings.ui || {};
            settings.ui.showTopNavButton = !!this.checked;
            saveSettingsDebounced();
            renderExtensionEntrySettings();
            syncTopNavButton();
        });
        query('#bakemono-memory-close, [data-bakemono-close]').off('click').on('click', () => closeWorkbench());
        query('#bakemono-memory-menu-toggle').off('click').on('click', () => {
            setWorkbenchMenuOpen(!rootElement?.classList.contains('is-menu-open'));
        });
        query('.bakemono-workbench-tab').off('click').on('click', function (event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            switchWorkbenchTab(this.dataset.bakemonoTab);
        });
        root.off('click.bakemonoHubTab').on('click.bakemonoHubTab', '.menu_button[data-bakemono-tab]', function () {
            switchWorkbenchTab(this.dataset.bakemonoTab);
        });
        root.off('click.bakemonoNav').on('click.bakemonoNav', '[data-bakemono-nav]', function () {
            switchWorkbenchTab(this.dataset.bakemonoNav);
        });

        bindThemeEvents(rootElement);
        promptInspector.bindEvents(rootElement);
        helpGuide.bind(rootElement);
        helpPopover.bind(rootElement);

        root.off('click.bakemonoMobileFold').on('click.bakemonoMobileFold', '.bakemono-mobile-collapsible > h4', function () {
            if (!(windowRef.matchMedia?.('(max-width: 900px)').matches ?? false)) return;
            const panel = this.closest('.bakemono-mobile-collapsible');
            if (!panel) return;
            const expand = panel.classList.contains('is-mobile-collapsed');
            panel.classList.toggle('is-mobile-collapsed', !expand);
            panel.classList.toggle('is-mobile-expanded', expand);
            helpPopover.close();
            stabilizeMobileWorkbenchScroll(rootElement?.dataset.activeTab || '');
        });
        root.off('click.bakemonoPromptEditorScroll').on('click.bakemonoPromptEditorScroll', '.bakemono-memory-prompt-editor-item > summary', () => {
            stabilizeMobileWorkbenchScroll('prompts');
        });
        root.off('click.bakemonoAction').on('click.bakemonoAction', '[data-bakemono-action]', async function () {
            try {
                await runWorkbenchAction(this.dataset.bakemonoAction);
            } catch (error) {
                logError('[BakemonoMemory] action failed', error);
                const failure = `操作失败：${error?.message || error}`;
                operationFeedback.set('error', failure, 2600);
                renderWorkbenchScope(getWorkbenchActionRenderScope(this.dataset.bakemonoAction), failure);
            } finally {
                operationFeedback.resetCapture();
            }
        });
    }

    return { bind };
}
