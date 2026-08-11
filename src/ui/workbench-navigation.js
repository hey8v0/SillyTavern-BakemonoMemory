export function createWorkbenchNavigation({
    getPanelTitle,
    renderHeaderContext,
    renderAll,
    scanBlocks,
    closeHelp,
    clearFeedback,
    rootId = 'bakemono-workbench-root',
    menuButtonId = 'bakemono-memory-menu-toggle',
} = {}) {
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
        const target = scope || root;
        target.querySelectorAll('.bakemono-mobile-collapsible').forEach(panel => {
            if (!isMobile) {
                panel.classList.remove('is-mobile-collapsed', 'is-mobile-expanded');
                delete panel.dataset.bakemonoMobileReady;
                return;
            }
            if (!panel.dataset.bakemonoMobileReady) {
                panel.classList.add('is-mobile-collapsed');
                panel.classList.remove('is-mobile-expanded');
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

    function switchTab(tabName) {
        const root = getRoot();
        if (!root) return;
        closeHelp?.();
        if (!tabName) {
            setMenuOpen(false);
            return;
        }
        if (root.dataset.activeTab === tabName) {
            setMenuOpen(false);
            return;
        }
        const panelName = tabName === 'tables' ? 'turn-summary' : tabName;
        root.dataset.activeTab = tabName;
        const title = document.getElementById('bakemono-workbench-title');
        if (title) title.textContent = getPanelTitle?.(tabName) || '';
        renderHeaderContext?.(tabName);
        const menuTabName = getMenuTab(tabName);
        root.querySelectorAll('.bakemono-workbench-tab').forEach(tab => {
            tab.classList.toggle('is-active', tab.dataset.bakemonoTab === menuTabName);
        });
        root.querySelectorAll('.bakemono-workbench-panel').forEach(panel => {
            panel.classList.toggle('is-active', panel.dataset.bakemonoPanel === panelName);
        });
        renderAll?.();
        requestAnimationFrame(() => setMenuOpen(false));
        syncMobileCollapsibles(root.querySelector(`.bakemono-workbench-panel[data-bakemono-panel="${panelName}"]`) || root);
        if (tabName === 'preview') {
            requestAnimationFrame(stabilizeMobilePreviewScroll);
        } else if (tabName === 'prompts') {
            stabilizeMobileScroll('prompts');
        }
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
        const root = getRoot();
        closeHelp?.();
        clearFeedback?.();
        setMenuOpen(false);
        root?.classList.add('bakemono-workbench-hidden');
        root?.setAttribute('aria-hidden', 'true');
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
