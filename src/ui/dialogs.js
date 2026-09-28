// Modal panels in the film-slate style: a bottom sheet on phones, centred on wide screens. They replace the
// browser's own confirm() box, which on phones is a grey system box that ended every question with “确认继续吗？”.
// Each panel is a <dialog> shown modally, so it sits above everything, keeps focus inside and closes on Escape.
// While the workbench is open the panel lives inside it and uses its colours; when the workbench is closed (a
// question can come from the tavern side) it lives in a small host on <body> that copies the colour tokens.
const colourTokens = ['--ns-ink', '--ns-text', '--ns-muted', '--ns-faint', '--ns-rule', '--ns-rule-strong', '--ns-hover',
    '--ns-accent', '--ns-accent-soft', '--ns-alert', '--ns-ok', '--ns-surface', '--ns-serif', '--ns-mono',
    '--ns-c-event', '--ns-c-done', '--ns-c-wall', '--bk-paper',
    '--ns-source-rule', '--ns-source-summary', '--ns-source-memory', '--ns-source-rpState', '--ns-source-table', '--ns-source-vector'];
const dangerVerbs = /^(清空|删除|覆盖|丢弃|放弃|移除|恢复默认|重建|替换|导入)/;
const verbs = ['清空', '删除', '覆盖', '恢复默认', '恢复', '导入', '载入', '使用', '取消隐藏', '隐藏', '重建', '重新', '生成', '加入',
    '应用', '合并', '放弃', '移除', '保存', '切换', '回滚', '撤回', '撤销', '解除', '清理', '重试', '继续'];

const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// “删除配置「x」？” → 删除. The old third argument (“确认生成吗？”) still names the button when given.
export function confirmButtonLabel(title, confirmText = '') {
    const fromText = String(confirmText || '').replace(/^确认/, '').replace(/[吗？?。\s]+$/g, '');
    if (fromText && fromText !== '继续') return fromText;
    const text = String(title || '').replace(/^[「“【]/, '');
    return verbs.find(verb => text.startsWith(verb)) || '继续';
}

export function createDialogs({ documentRef = globalThis.document } = {}) {
    let serial = 0;

    function host() {
        const root = documentRef.getElementById('bakemono-workbench-root');
        const visible = root && !root.classList.contains('bakemono-workbench-hidden') && root.getClientRects?.().length > 0;
        if (visible) return root;
        let box = documentRef.getElementById('bakemono-dialog-host');
        if (!box) {
            box = documentRef.createElement('div');
            box.id = 'bakemono-dialog-host';
            documentRef.body.append(box);
        }
        const computed = root && documentRef.defaultView?.getComputedStyle?.(root);
        if (computed) for (const name of colourTokens) {
            const value = computed.getPropertyValue(name).trim();
            if (value) box.style.setProperty(name, value);
        }
        return box;
    }

    // html is trusted markup built by the caller; [data-dlg-value] buttons close the panel with their value.
    function open({ className = '', html, label = '', dismiss = null, onReady }) {
        const dialog = documentRef.createElement('dialog');
        const id = `bakemono-dlg-${++serial}`;
        dialog.className = `bk-dlg ${className}`.trim();
        dialog.setAttribute('aria-labelledby', `${id}-title`);
        dialog.innerHTML = html.replace('data-dlg-title', `id="${id}-title"`);
        if (label) dialog.setAttribute('aria-label', label);
        const returnFocus = documentRef.activeElement;
        return new Promise(resolve => {
            let done = false;
            const finish = value => {
                if (done) return;
                done = true;
                try { dialog.close?.(); } catch {}
                dialog.remove();
                if (returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
                resolve(value);
            };
            dialog.addEventListener('click', event => {
                const button = event.target.closest?.('[data-dlg-value]');
                if (button && !button.disabled) finish(button.dataset.dlgValue);
                else if (event.target === dialog) finish(dismiss);
            });
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(dismiss); });
            host().append(dialog);
            if (typeof dialog.showModal === 'function') {
                try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
            } else dialog.setAttribute('open', '');
            onReady?.(dialog, finish);
            (dialog.querySelector('[data-dlg-focus]') || dialog.querySelector('.bk-dlg-foot button:last-child'))?.focus?.({ preventScroll: true });
        });
    }

    // Resolves true or false. lines are plain text, one consequence per line.
    function confirm(title, lines = [], options = {}) {
        const { confirmText = '', cancelText = '取消' } = typeof options === 'string' ? { confirmText: options } : options;
        const label = confirmButtonLabel(title, confirmText);
        const danger = options.danger ?? (dangerVerbs.test(label) || dangerVerbs.test(String(title)));
        const items = (Array.isArray(lines) ? lines : [lines]).flatMap(line => String(line ?? '').split('\n')).map(line => line.trim()).filter(Boolean);
        return open({
            className: `bk-dlg-confirm${danger ? ' is-danger' : ''}`,
            dismiss: 'no',
            html: `<div class="bk-dlg-h"><h3 data-dlg-title>${esc(title)}</h3></div>`
                + (items.length ? `<ul class="bk-dlg-lines">${items.map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : '')
                + `<div class="bk-dlg-foot"><button type="button" class="bk-dlg-text" data-dlg-value="no">${esc(cancelText)}</button>`
                + `<button type="button" class="bk-dlg-btn${danger ? ' is-danger' : ''}" data-dlg-value="yes">${esc(label)}</button></div>`,
        }).then(value => value === 'yes');
    }

    // A question with several answers, listed as rows; the first one is the suggested answer.
    function choose({ title, text = '', choices = [], dismiss = null, closeLabel = '关闭' }) {
        return open({
            className: 'bk-dlg-choose',
            dismiss,
            html: `<div class="bk-dlg-h"><h3 data-dlg-title>${esc(title)}</h3>`
                + `<button type="button" class="bk-dlg-x" data-dlg-value="${esc(dismiss ?? '')}" aria-label="${esc(closeLabel)}">×</button></div>`
                + (text ? `<p class="bk-dlg-text-line">${esc(text)}</p>` : '')
                + `<div class="bk-dlg-choices">${choices.map((choice, index) => `<button type="button" class="${index === 0 ? 'is-go' : ''}" data-dlg-value="${esc(choice.value)}"${index === 0 ? ' data-dlg-focus' : ''}>`
                    + `<span>${esc(choice.label)}</span>${choice.note ? `<small>${esc(choice.note)}</small>` : index === 0 ? '<small aria-hidden="true">›</small>' : ''}</button>`).join('')}</div>`,
        });
    }

    return { open, confirm, choose, host };
}
