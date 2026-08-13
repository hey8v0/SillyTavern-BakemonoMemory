export function createSillyTavernEntry({
    documentRef = document,
    query,
    extensionSettings,
    storageKey,
    openWorkbench,
}) {
    function renderSettings() {
        const settings = extensionSettings[storageKey] || {};
        query('#bakemono-memory-show-top-nav').prop('checked', !!settings.ui?.showTopNavButton);
    }

    async function addSettingsBlock() {
        const container = documentRef.getElementById('extensions_settings')
            || documentRef.getElementById('extensions_settings2');
        if (!container) return;

        documentRef.getElementById('bakemono-memory-extension-settings')?.remove();

        const wrapper = documentRef.createElement('div');
        wrapper.id = 'bakemono-memory-extension-settings';
        wrapper.className = 'extension_container bakemono-memory-extension-settings';
        wrapper.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b><i class="fa-solid fa-clapperboard"></i> 剧情剪辑台</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="bakemono-memory-extension-entry">
                        <button type="button" class="menu_button menu_button_icon" id="bakemono-memory-extension-open">
                            <i class="fa-solid fa-clapperboard"></i>
                            <span>打开剧情剪辑台</span>
                        </button>
                        <label class="checkbox_label" for="bakemono-memory-show-top-nav">
                            <input id="bakemono-memory-show-top-nav" type="checkbox" class="checkbox">
                            <span>在顶部导航栏显示入口按钮</span>
                        </label>
                        <small>如果当前酒馆美化和顶部栏不兼容，可以关闭这个入口，继续用左下角魔法棒进入。</small>
                    </div>
                </div>
            </div>
        `;
        container.append(wrapper);
        renderSettings();
    }

    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const existing = documentRef.querySelector(selector);
            if (existing) {
                resolve(existing);
                return;
            }

            const startTime = Date.now();
            const timer = setInterval(() => {
                const element = documentRef.querySelector(selector);
                if (element) {
                    clearInterval(timer);
                    resolve(element);
                    return;
                }

                if (Date.now() - startTime > timeout) {
                    clearInterval(timer);
                    reject(new Error(`Timed out waiting for ${selector}`));
                }
            }, 100);
        });
    }

    async function addWandButton() {
        const menu = await waitForElement('#extensionsMenu');
        if (documentRef.getElementById('bakemono-memory-wand-button')) return;

        const button = documentRef.createElement('div');
        button.id = 'bakemono-memory-wand-button';
        button.classList.add('list-group-item', 'flex-container', 'flexGap5');

        const icon = documentRef.createElement('div');
        icon.classList.add('fa-solid', 'fa-clapperboard', 'extensionsMenuExtensionButton');

        const text = documentRef.createElement('span');
        text.textContent = '剧情剪辑台';

        button.append(icon, text);
        button.addEventListener('click', () => openWorkbench());
        menu.append(button);
    }

    function syncTopNavButton() {
        const settings = extensionSettings[storageKey] || {};
        const shouldShow = !!settings.ui?.showTopNavButton;
        const existing = documentRef.getElementById('bakemono-memory-top-nav-entry');
        if (!shouldShow) {
            existing?.remove();
            return;
        }
        if (existing) return;

        const holder = documentRef.getElementById('top-settings-holder') || documentRef.getElementById('top-bar');
        if (!holder) return;

        const entry = documentRef.createElement('div');
        entry.id = 'bakemono-memory-top-nav-entry';
        entry.className = 'drawer bakemono-memory-top-nav-entry';
        entry.innerHTML = `
            <div class="drawer-toggle bakemono-memory-top-nav-toggle">
                <div id="bakemono-memory-top-nav-button"
                    class="drawer-icon fa-solid fa-clapperboard fa-fw closedIcon bakemono-memory-top-nav-button"
                    title="剧情剪辑台"
                    aria-label="打开剧情剪辑台"></div>
            </div>
        `;
        entry.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openWorkbench();
        });

        const anchor = documentRef.getElementById('extensions-settings-button');
        if (anchor?.parentElement === holder) {
            anchor.insertAdjacentElement('afterend', entry);
        } else {
            holder.append(entry);
        }
    }

    return {
        addSettingsBlock,
        addWandButton,
        renderSettings,
        syncTopNavButton,
    };
}
