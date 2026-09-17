const labels = Object.freeze({
    rule: '模板／规则', summary: '阶段／多次总结', memory: '长期记忆',
    rpState: '剧情状态', table: '表格记忆', vector: '向量召回',
});
const popupId = 'bakemono-injection-preview';

// Display sections only: boundaries never rewrite or truncate the injected text.
export function splitInjectionPreview(key, value) {
    const text = String(value ?? '');
    if (!text.trim()) return [];
    const marker = key === 'table' ? /^### /gm : key === 'vector' ? /^- 来源[：:]/gm : /^## /gm;
    const headings = [...text.matchAll(marker)].map(match => match.index);
    const boundaries = headings.length > 1
        ? headings.slice(1)
        : [...text.matchAll(/\r?\n[ \t]*\r?\n/g)].map(match => match.index + match[0].length);
    const sections = [];
    let start = 0;
    for (const end of [...boundaries, text.length]) {
        if (end > start) sections.push(text.slice(start, end));
        start = end;
    }
    return sections;
}

export function createInjectionPreview({ documentRef, windowRef = documentRef.defaultView, getSources, beforeOpen = () => {} }) {
    let root = null;
    let overlay = null;
    let trigger = null;
    let closeButton = null;
    let body = null;
    let panel = null;
    let viewport = null;
    let openingClick = null;

    function syncViewport() {
        if (!overlay) return;
        const valid = value => Number.isFinite(value) && value > 0;
        const width = [viewport?.width, windowRef?.innerWidth, documentRef.documentElement?.clientWidth, 360].find(valid);
        const height = [viewport?.height, windowRef?.innerHeight, documentRef.documentElement?.clientHeight, 640].find(valid);
        const offset = value => Number.isFinite(value) ? Math.max(0, value) : 0;
        // Pixel bounds also work on mobile keyboards, zoom and older dvh implementations.
        for (const [name, value] of Object.entries({
            top: offset(viewport?.offsetTop), left: offset(viewport?.offsetLeft), width, height,
        })) overlay.style.setProperty(name, value + 'px', 'important');
        overlay.style.setProperty('--bk-preview-max-height', Math.max(44, Math.min(680, height - 48)) + 'px');
    }

    function copyTheme() {
        const computed = windowRef?.getComputedStyle?.(root);
        if (!computed) return;
        for (const name of ['--SmartThemeBodyColor', '--bk-paper', '--bk-paper-raised', '--bk-ink-soft',
            '--bk-accent', '--bk-line', '--bk-line-strong', '--bk-shadow', 'font-family', 'font-size', 'line-height']) {
            const value = computed.getPropertyValue(name);
            if (value) overlay.style.setProperty(name, value);
        }
    }

    function close({ restoreFocus = true } = {}) {
        if (!overlay) return;
        const previousOverlay = overlay;
        overlay = null;
        documentRef.removeEventListener('keydown', onKeyDown, true);
        documentRef.removeEventListener('focusin', onFocusIn, true);
        documentRef.removeEventListener('click', onOutsideClick, true);
        windowRef?.removeEventListener('resize', syncViewport);
        viewport?.removeEventListener('resize', syncViewport);
        viewport?.removeEventListener('scroll', syncViewport);
        viewport = null;
        try { previousOverlay.close?.(); } catch { /* Detached or fallback dialog. */ }
        previousOverlay.remove();
        root?.classList.remove('has-injection-preview');
        const previousTrigger = trigger;
        previousTrigger?.setAttribute('aria-expanded', 'false');
        trigger = closeButton = body = panel = null;
        openingClick = null;
        if (restoreFocus && previousTrigger?.isConnected && root?.getAttribute('aria-hidden') !== 'true') {
            previousTrigger.focus({ preventScroll: true });
        }
    }

    function onKeyDown(event) {
        if (!overlay) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (event.key === 'Tab') {
            // Only two interactive targets: close, and the keyboard-scrollable content.
            event.preventDefault();
            const next = documentRef.activeElement === closeButton ? body : closeButton;
            next.focus({ preventScroll: true });
        }
    }

    function onFocusIn(event) {
        if (overlay && !overlay.contains(event.target)) closeButton.focus({ preventScroll: true });
    }

    function onOutsideClick(event) {
        if (event === openingClick) return;
        if (!overlay || panel?.contains(event.target)) return;
        // Catch the backdrop AND uncovered page space. Do not click through on dismissal.
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
    }

    function open(button, event) {
        const key = button?.dataset.bakemonoTokenSource;
        if (!Object.hasOwn(labels, key) || !root?.isConnected || root.getAttribute('aria-hidden') === 'true') return;
        close({ restoreFocus: false });
        openingClick = event;
        beforeOpen();
        let sections = [];
        let failed = false;
        try {
            sections = splitInjectionPreview(key, getSources()?.[key]);
        } catch {
            failed = true;
        }
        trigger = button;
        overlay = documentRef.createElement('dialog');
        overlay.className = 'bakemono-injection-preview-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', popupId + '-title');
        overlay.setAttribute('aria-describedby', popupId + '-note');
        // Critical geometry must not inherit host dialog transforms/margins.
        for (const [name, value] of Object.entries({
            position: 'fixed', inset: 'auto', margin: '0', transform: 'none',
            'max-width': 'none', 'max-height': 'none', display: 'grid',
        })) overlay.style.setProperty(name, value, 'important');
        copyTheme();
        overlay.innerHTML = `
            <section id="${popupId}" class="bakemono-injection-preview">
                <header>
                    <div><span>本轮注入预览</span><h3 id="${popupId}-title"></h3></div>
                    <button type="button" class="bakemono-injection-preview-close" aria-label="关闭注入预览">×</button>
                </header>
                <p id="${popupId}-note">按当前配置展示；实际发送内容请看“查看上一轮”。</p>
                <div class="bakemono-injection-preview-body" tabindex="0" role="region" aria-label="注入内容，可滚动"></div>
            </section>`;
        overlay.querySelector('h3').textContent = labels[key];
        closeButton = overlay.querySelector('button');
        panel = overlay.querySelector('section');
        body = overlay.querySelector('.bakemono-injection-preview-body');
        if (!sections.length) {
            const empty = documentRef.createElement('p');
            empty.className = 'bakemono-injection-preview-empty';
            empty.textContent = failed ? '暂时无法读取注入内容，请关闭后重试。' : '本轮没有此模块的注入内容。';
            if (failed) empty.setAttribute('role', 'alert');
            body.append(empty);
        } else {
            const list = documentRef.createElement('ol');
            sections.forEach((text, index) => {
                const item = documentRef.createElement('li');
                const heading = documentRef.createElement('span');
                heading.className = 'bakemono-injection-preview-number';
                heading.textContent = `第 ${index + 1} 段`;
                const content = documentRef.createElement('pre');
                content.textContent = text;
                item.append(heading, content);
                list.append(item);
            });
            body.append(list);
        }
        closeButton.addEventListener('click', () => close());
        overlay.addEventListener('cancel', event => {
            event.preventDefault();
            close();
        });
        const openedOverlay = overlay;
        overlay.addEventListener('close', () => {
            if (overlay === openedOverlay) close();
        });
        documentRef.body.append(overlay);
        viewport = windowRef?.visualViewport;
        syncViewport();
        windowRef?.addEventListener('resize', syncViewport);
        viewport?.addEventListener('resize', syncViewport);
        viewport?.addEventListener('scroll', syncViewport);
        // Native top layer escapes transformed/scrolled ancestors. Never manually inert the
        // workbench: even an unsupported dialog must leave a recoverable dismissal path.
        try {
            if (typeof overlay.showModal === 'function') overlay.showModal();
            else overlay.setAttribute('open', '');
        } catch {
            overlay.setAttribute('open', '');
        }
        root.classList.add('has-injection-preview');
        trigger.setAttribute('aria-expanded', 'true');
        closeButton.focus({ preventScroll: true });
        documentRef.addEventListener('keydown', onKeyDown, true);
        documentRef.addEventListener('focusin', onFocusIn, true);
        documentRef.addEventListener('click', onOutsideClick, true);
    }

    function onClick(event) {
        const button = event.target?.closest?.('button[data-bakemono-token-source]');
        if (button && root?.contains(button)) open(button, event);
    }

    function bind(nextRoot) {
        close({ restoreFocus: false });
        root?.removeEventListener('click', onClick);
        root = nextRoot || null;
        root?.addEventListener('click', onClick);
    }

    return { bind, close, destroy: () => bind(null) };
}
