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

export function createInjectionPreview({ documentRef, getSources, beforeOpen = () => {} }) {
    let root = null;
    let overlay = null;
    let trigger = null;
    let closeButton = null;
    let body = null;
    let inertSiblings = [];

    function close({ restoreFocus = true } = {}) {
        if (!overlay) return;
        overlay.remove();
        overlay = null;
        documentRef.removeEventListener('keydown', onKeyDown, true);
        documentRef.removeEventListener('focusin', onFocusIn, true);
        for (const [element, wasInert] of inertSiblings) {
            if (!wasInert) element.removeAttribute('inert');
        }
        inertSiblings = [];
        root?.classList.remove('has-injection-preview');
        const previousTrigger = trigger;
        previousTrigger?.setAttribute('aria-expanded', 'false');
        trigger = closeButton = body = null;
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

    function open(button) {
        const key = button?.dataset.bakemonoTokenSource;
        if (!Object.hasOwn(labels, key) || !root?.isConnected || root.getAttribute('aria-hidden') === 'true') return;
        close({ restoreFocus: false });
        beforeOpen();
        let sections = [];
        let failed = false;
        try {
            sections = splitInjectionPreview(key, getSources()?.[key]);
        } catch {
            failed = true;
        }
        trigger = button;
        overlay = documentRef.createElement('div');
        overlay.className = 'bakemono-injection-preview-overlay';
        overlay.innerHTML = `
            <section id="${popupId}" class="bakemono-injection-preview" role="dialog" aria-modal="true"
                aria-labelledby="${popupId}-title" aria-describedby="${popupId}-note">
                <header>
                    <div><span>本轮注入预览</span><h3 id="${popupId}-title"></h3></div>
                    <button type="button" class="bakemono-injection-preview-close" aria-label="关闭注入预览">×</button>
                </header>
                <p id="${popupId}-note">按当前配置展示；实际发送内容请看“查看上一轮”。</p>
                <div class="bakemono-injection-preview-body" tabindex="0" role="region" aria-label="注入内容，可滚动"></div>
            </section>`;
        overlay.querySelector('h3').textContent = labels[key];
        closeButton = overlay.querySelector('button');
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
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        root.append(overlay);
        root.classList.add('has-injection-preview');
        trigger.setAttribute('aria-expanded', 'true');
        closeButton.focus({ preventScroll: true });
        inertSiblings = [...root.children].filter(element => element !== overlay)
            .map(element => [element, element.hasAttribute('inert')]);
        for (const [element] of inertSiblings) element.setAttribute('inert', '');
        documentRef.addEventListener('keydown', onKeyDown, true);
        documentRef.addEventListener('focusin', onFocusIn, true);
    }

    function onClick(event) {
        const button = event.target?.closest?.('button[data-bakemono-token-source]');
        if (button && root?.contains(button)) open(button);
    }

    function bind(nextRoot) {
        close({ restoreFocus: false });
        root?.removeEventListener('click', onClick);
        root = nextRoot || null;
        root?.addEventListener('click', onClick);
    }

    return { bind, close, destroy: () => bind(null) };
}
