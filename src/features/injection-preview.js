const labels = Object.freeze({
    rule: '模板／规则', summary: '阶段／多次总结', memory: '长期记忆',
    rpState: '剧情状态', table: '表格记忆', vector: '向量召回',
});

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

// One module of this turn's injection, opened from a row on the home page: the same panel as every other dialog
// (see src/ui/dialogs.js), with the module's colour from the home page stack and its text in sections.
const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createInjectionPreview({ getSources, beforeOpen = () => {}, openDialog }) {
    let root = null;
    let trigger = null;
    let finish = null;

    function close() {
        finish?.('');
    }

    function open(button) {
        const key = button?.dataset.bakemonoTokenSource;
        if (!Object.hasOwn(labels, key) || !root?.isConnected || root.getAttribute('aria-hidden') === 'true') return;
        close();
        beforeOpen();
        let sections = [];
        let failed = false;
        try {
            sections = splitInjectionPreview(key, getSources()?.[key]);
        } catch {
            failed = true;
        }
        const total = sections.reduce((sum, text) => sum + text.length, 0);
        const body = sections.length
            ? `<ol class="bk-dlg-sections" tabindex="0" aria-label="注入内容，可滚动">${sections.map((text, index) => `<li><span class="bk-dlg-label">第 ${index + 1} 段</span><pre>${esc(text)}</pre></li>`).join('')}</ol>`
            : `<p class="bk-dlg-text-line"${failed ? ' role="alert"' : ''}>${failed ? '暂时读不到这部分的注入内容，关掉再试一次。' : '这一轮没有这部分的注入内容。'}</p>`;
        trigger = button;
        trigger.setAttribute('aria-expanded', 'true');
        openDialog({
            className: 'bk-dlg-preview',
            dismiss: '',
            html: `<div class="bk-dlg-h"><div><span class="bk-dlg-label">本轮注入${total ? ` · ${total.toLocaleString()} 字` : ''}</span>`
                + `<h3 data-dlg-title><i class="bk-dlg-swatch" style="background: var(--ns-source-${key})" aria-hidden="true"></i>${esc(labels[key])}</h3></div>`
                + '<button type="button" class="bk-dlg-x" data-dlg-value="" aria-label="关闭注入预览">×</button></div>'
                + body
                + '<div class="bk-dlg-foot"><span class="bk-dlg-note">这是按现在的设置拼出来的；真正发出去的在“上一轮内容”。</span></div>',
            onReady: (dialog, done) => { finish = done; },
        }).then(() => {
            finish = null;
            trigger?.setAttribute('aria-expanded', 'false');
            trigger = null;
        });
    }

    function onClick(event) {
        const button = event.target?.closest?.('button[data-bakemono-token-source]');
        if (button && root?.contains(button)) open(button, event);
    }

    function bind(nextRoot) {
        close();
        root?.removeEventListener('click', onClick);
        root = nextRoot || null;
        root?.addEventListener('click', onClick);
    }

    return { bind, close, destroy: () => bind(null) };
}
