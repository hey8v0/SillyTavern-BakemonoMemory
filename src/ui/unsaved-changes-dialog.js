const dialogId = 'bakemono-memory-unsaved-dialog';
const choices = [
    ['save', '保存并继续', 'fa-floppy-disk'],
    ['discard', '放弃修改', 'fa-rotate-left'],
    ['stay', '留在本页', 'fa-pen'],
];

// Resolves to 'save', 'discard' or 'stay'. Escape and backdrop clicks keep editing.
export function createUnsavedChangesDialog({ documentRef = document, getHost } = {}) {
    let pending = null;

    function build(host) {
        const dialog = documentRef.createElement('dialog');
        dialog.id = dialogId;
        dialog.className = 'bakemono-memory-unsaved-dialog';
        dialog.setAttribute('aria-labelledby', `${dialogId}-title`);
        dialog.setAttribute('aria-describedby', `${dialogId}-copy`);
        const title = documentRef.createElement('h3');
        title.id = `${dialogId}-title`;
        const copy = documentRef.createElement('p');
        copy.id = `${dialogId}-copy`;
        const actions = documentRef.createElement('div');
        actions.className = 'bakemono-memory-unsaved-actions';
        for (const [value, label, icon] of choices) {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = `menu_button${value === 'save' ? ' is-primary' : ''}`;
            button.dataset.unsavedChoice = value;
            const mark = documentRef.createElement('i');
            mark.className = `fa-solid ${icon}`;
            mark.setAttribute('aria-hidden', 'true');
            const text = documentRef.createElement('span');
            text.textContent = label;
            button.append(mark, text);
            actions.append(button);
        }
        dialog.append(title, copy, actions);
        dialog.addEventListener('click', event => {
            const choice = event.target.closest?.('[data-unsaved-choice]')?.dataset.unsavedChoice;
            if (choice) finish(choice);
            else if (event.target === dialog) finish('stay');
        });
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            finish('stay');
        });
        host.append(dialog);
        return dialog;
    }

    function finish(choice) {
        const dialog = documentRef.getElementById(dialogId);
        if (dialog?.open) dialog.close();
        const resolve = pending;
        pending = null;
        resolve?.(choice);
    }

    function ask({ label, count, closing }) {
        if (pending) finish('stay');
        const host = getHost?.() || documentRef.body;
        const dialog = documentRef.getElementById(dialogId) || build(host);
        dialog.querySelector('h3').textContent = `「${label}」还有 ${count} 项修改未保存`;
        dialog.querySelector('p').textContent = closing
            ? '关闭后这些修改不会生效。要先保存吗？'
            : '离开本页后这些修改不会生效。要先保存吗？';
        return new Promise(resolve => {
            pending = resolve;
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
            dialog.querySelector('[data-unsaved-choice="save"]')?.focus();
        });
    }

    return { ask };
}
