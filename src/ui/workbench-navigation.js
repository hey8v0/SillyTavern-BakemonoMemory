export function createWorkbenchNavigation({
    getPanelTitle,
    renderHeaderContext,
    renderAll,
    scanBlocks,
    closeHelp,
    clearFeedback,
    confirmLeave,
    rootId = 'bakemono-workbench-root',
    menuButtonId = 'bakemono-memory-menu-toggle',
} = {}) {
    const mobileExpansion = new WeakMap();
    function getRoot() {
        return document.getElementById(rootId);
    }

    function isOpen() {
        const root = getRoot();
        return !!root
            && !root.classList.contains('bakemono-workbench-hidden')
            && root.getAttribute('aria-hidden') !== 'true';
    }

    function getActiveTab() {
        return getRoot()?.dataset.activeTab || 'overview';
    }

    function getMenuTab(tabName) {
        if (tabName === 'prompt-inspector') return 'overview';
        if (['turn-summary', 'tables', 'automation', 'vector'].includes(tabName)) return 'data-hub';
        if (['settings', 'scan', 'injection', 'generation', 'prompts', 'appearance', 'config', 'maintenance'].includes(tabName)) return 'settings-hub';
        if (tabName === 'timeline') return 'preview';
        return tabName;
    }

    function setMenuOpen(open) {
        const root = getRoot();
        const button = document.getElementById(menuButtonId);
        if (!root) return;
        closeHelp?.();
        root.classList.toggle('is-menu-open', !!open);
        if (button) {
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
            button.title = open ? '关闭菜单' : '打开菜单';
            button.setAttribute('aria-label', button.title);
            button.querySelector('i')?.classList.toggle('fa-bars', !open);
            button.querySelector('i')?.classList.toggle('fa-xmark', !!open);
        }
    }

    function syncMobileCollapsibles(scope = null) {
        const root = getRoot();
        if (!root) return;
        const isMobile = window.matchMedia?.('(max-width: 900px)').matches ?? false;
        const target = typeof scope?.querySelectorAll === 'function' ? scope : root;
        target.querySelectorAll('.bakemono-mobile-collapsible').forEach(panel => {
            if (!isMobile) {
                if (panel.dataset.bakemonoMobileReady) mobileExpansion.set(panel, panel.classList.contains('is-mobile-expanded'));
                panel.classList.remove('is-mobile-collapsed', 'is-mobile-expanded');
                delete panel.dataset.bakemonoMobileReady;
                return;
            }
            if (!panel.dataset.bakemonoMobileReady) {
                const expanded = mobileExpansion.get(panel) === true;
                panel.classList.toggle('is-mobile-collapsed', !expanded);
                panel.classList.toggle('is-mobile-expanded', expanded);
                panel.dataset.bakemonoMobileReady = '1';
            }
        });
    }

    function stabilizeMobileScroll(expectedTab = '') {
        const root = getRoot();
        if (!root || (expectedTab && root.dataset.activeTab !== expectedTab)) return;
        if (!(window.matchMedia?.('(max-width: 900px)').matches ?? false)) return;
        const main = root.querySelector('.bakemono-workbench-main');
        if (!main) return;
        const settle = () => {
            const currentTop = main.scrollTop;
            const maxTop = Math.max(0, main.scrollHeight - main.clientHeight);
            if (maxTop <= 0) return;
            const nudgedTop = Math.min(currentTop + 1, maxTop);
            main.scrollTop = nudgedTop;
            main.scrollTop = Math.min(currentTop, maxTop);
        };
        requestAnimationFrame(() => {
            settle();
            window.setTimeout(settle, 80);
        });
    }

    function stabilizeMobilePreviewScroll() {
        stabilizeMobileScroll('preview');
    }

    // Returns true when switched, false when refused, or a promise while the
    // user decides what to do with unsaved settings on the current page.
    function switchTab(tabName) {
        const root = getRoot();
        if (!root) return false;
        closeHelp?.();
        if (!tabName) {
            setMenuOpen(false);
            return false;
        }
        if (root.dataset.activeTab === tabName) {
            setMenuOpen(false);
            return true;
        }
        const panelName = tabName === 'tables' ? 'turn-summary' : tabName;
        if (!root.querySelector(`.bakemono-workbench-panel[data-bakemono-panel="${panelName}"]`)) return false;
        const verdict = isOpen() ? confirmLeave?.(tabName) ?? true : true;
        if (verdict === true) return showTab(root, tabName, panelName);
        return Promise.resolve(verdict).then(ok => !!ok && showTab(root, tabName, panelName));
    }

    function showTab(root, tabName, panelName) {
        const panels = [...root.querySelectorAll('.bakemono-workbench-panel')];
        const targetPanel = panels.find(panel => panel.dataset.bakemonoPanel === panelName);
        if (!targetPanel) return false;
        root.dataset.activeTab = tabName;
        const title = document.getElementById('bakemono-workbench-title');
        if (title) title.textContent = getPanelTitle?.(tabName) || '';
        renderHeaderContext?.(tabName);
        const menuTabName = getMenuTab(tabName);
        root.querySelectorAll('.bakemono-workbench-tab').forEach(tab => {
            tab.classList.toggle('is-active', tab.dataset.bakemonoTab === menuTabName);
        });
        panels.forEach(panel => {
            panel.classList.toggle('is-active', panel.dataset.bakemonoPanel === panelName);
        });
        // All panels share one scroll surface; a new page always starts at its top.
        const main = root.querySelector('.bakemono-workbench-main');
        if (main) main.scrollTop = 0;
        renderAll?.();
        requestAnimationFrame(() => setMenuOpen(false));
        syncMobileCollapsibles(targetPanel);
        if (tabName === 'preview') {
            requestAnimationFrame(stabilizeMobilePreviewScroll);
        } else if (tabName === 'prompts') {
            stabilizeMobileScroll('prompts');
        }
        return true;
    }

    function open() {
        const root = getRoot();
        closeHelp?.();
        root?.classList.remove('bakemono-workbench-hidden');
        root?.setAttribute('aria-hidden', 'false');
        scanBlocks?.({ persist: false, render: false });
        renderAll?.();
    }

    function close() {
        const verdict = isOpen() ? confirmLeave?.(null) ?? true : true;
        if (verdict === true) return hide();
        return Promise.resolve(verdict).then(ok => !!ok && hide());
    }

    function hide() {
        const root = getRoot();
        closeHelp?.();
        clearFeedback?.();
        setMenuOpen(false);
        root?.classList.add('bakemono-workbench-hidden');
        root?.setAttribute('aria-hidden', 'true');
        return true;
    }

    return {
        close,
        getActiveTab,
        getMenuTab,
        isOpen,
        open,
        setMenuOpen,
        stabilizeMobilePreviewScroll,
        stabilizeMobileScroll,
        switchTab,
        syncMobileCollapsibles,
    };
}
