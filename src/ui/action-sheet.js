// A small sheet for per-item actions: a bottom sheet on phones, centred on wide screens.
// Pages give it a title and a render(view) that returns buttons; [data-sheet-view] switches views inside the sheet
// (used for “are you sure” steps), [data-sheet-do] closes it and hands the action name to run().
export function createActionSheet({ documentRef }) {
    let wrap = null, current = null, returnFocus = null;

    function host() {
        const root = documentRef.getElementById('bakemono-workbench-root');
        return root?.querySelector('.bakemono-workbench') || root || documentRef.body;
    }

    function build() {
        const node = documentRef.createElement('div');
        node.className = 'bk-sheet-wrap';
        node.hidden = true;
        node.innerHTML = `<div class="bk-sheet-scrim" data-sheet-close></div>
            <div class="bk-sheet" role="dialog" aria-modal="true" aria-labelledby="bk-sheet-title">
                <div class="bk-sheet-h"><div><strong id="bk-sheet-title"></strong><small></small></div>
                <button type="button" class="bk-sum-link" data-sheet-close>关闭</button></div>
                <div class="bk-sheet-body"></div>
            </div>`;
        node.addEventListener('click', event => {
            const target = event.target.closest('button, [data-sheet-close]');
            if (!target || target.disabled) return;
            if (target.hasAttribute('data-sheet-close')) return close();
            if (target.dataset.sheetView) return show(target.dataset.sheetView);
            if (target.dataset.sheetDo) run(target.dataset.sheetDo);
        });
        node.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); close(); }
            if (event.key !== 'Tab') return;
            const buttons = [...node.querySelectorAll('.bk-sheet button:not([disabled])')];
            const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
            if (documentRef.activeElement === edge) { event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus(); }
        });
        return node;
    }

    function show(view = 'menu') {
        wrap.querySelector('.bk-sheet-body').innerHTML = current.render(view);
        wrap.querySelector('.bk-sheet-body button:not([disabled])')?.focus({ preventScroll: true });
    }

    async function run(name) {
        const action = current;
        close({ restore: !action?.keepFocus?.includes(name) });
        await action?.run(name);
    }

    function open({ title, subtitle = '', render, run: onRun, trigger = null, keepFocus = [] }) {
        if (!wrap || !wrap.isConnected) { wrap = build(); host().append(wrap); }
        current = { render, run: onRun, keepFocus };
        returnFocus = trigger;
        wrap.querySelector('#bk-sheet-title').textContent = title;
        wrap.querySelector('.bk-sheet-h small').textContent = subtitle;
        wrap.hidden = false;
        show('menu');
    }

    function close({ restore = true } = {}) {
        if (!wrap || wrap.hidden) return;
        wrap.hidden = true;
        current = null;
        if (restore && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        returnFocus = null;
    }

    return { open, close };
}

// Shared pieces for sheet contents.
export function sheetAction(name, label, note, { danger = false, view = false, disabled = false, escapeHtml = String } = {}) {
    const target = view ? `data-sheet-view="${name}"` : `data-sheet-do="${name}"`;
    return `<button type="button" class="bk-act${danger ? ' is-danger' : ''}" ${disabled ? 'disabled' : target}><span>${escapeHtml(label)}</span><small>${escapeHtml(note)}</small></button>`;
}

export function sheetConfirm(message, actionName, actionLabel, { danger = true, escapeHtml = String } = {}) {
    return `<div class="bk-confirm"><p>${escapeHtml(message)}</p>
        <div class="bk-confirm-actions"><button type="button" class="bk-sum-link" data-sheet-view="menu">‹ 返回</button>
        <button type="button" class="menu_button ${danger ? 'bk-sheet-danger' : 'bk-sheet-primary'}" data-sheet-do="${actionName}">${escapeHtml(actionLabel)}</button></div></div>`;
}
