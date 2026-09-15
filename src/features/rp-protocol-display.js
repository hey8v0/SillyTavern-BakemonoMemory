const compact = value => String(value || '').replace(/\s/gu, '');
const displayRuleId = '60605b50-b16f-4f38-8da0-63258ee768fc';
const protocolPattern = /<rpEvents\b[^>]*>([\s\S]*?)(?:<\/rpEvents\s*>|$)/gi;

export function ensureRpDisplayFilter(settings, saveSettings = () => {}) {
    if (!settings || typeof settings !== 'object' || (settings.regex != null && !Array.isArray(settings.regex))) return false;
    if (settings.regex?.some(rule => rule?.id === displayRuleId)) return false;
    const find = /(?:^[ \t]*(`{3,}|~{3,})[^\r\n]*\r?\n[ \t]*<rpEvents\b[^>]*>(?:(?!<\/rpEvents\s*>)[\s\S])*<\/rpEvents\s*>[ \t]*\r?\n[ \t]*\1[ \t]*(?=\r?\n|$)|<rpEvents\b[^>]*>[\s\S]*?(?:<\/rpEvents\s*>|(?![\s\S])))/gim;
    const rule = { id: displayRuleId, scriptName: '剧情剪辑台 · 隐藏剧情状态协议',
        findRegex: find.toString(), replaceString: '', trimStrings: [], placement: [2],
        disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true,
        substituteRegex: 0, minDepth: null, maxDepth: null };
    // The host applies markdownOnly rules before quote highlighting and Markdown.
    // Never enable the regex extension or overwrite rules the user already owns.
    settings.regex = [rule, ...(settings.regex || [])];
    saveSettings();
    return true;
}

export function rpDisplayPayloads(raw) {
    return [...String(raw || '').matchAll(protocolPattern)]
        .flatMap(match => [compact(match[0]), compact(match[1])]).filter(value => value.length >= 16);
}

// Only the rendered text is changed. Stored messages, swipes and edit inputs
// retain the protocol so extraction and source verification can still read it.
export function hideRenderedRpProtocol(root, raw, { renderProtocol } = {}) {
    if (!root?.querySelectorAll || root.closest?.('textarea, input, [contenteditable="true"]')) return false;
    const payloads = rpDisplayPayloads(raw);
    if (!payloads.length) return false;
    let changed = false;
    for (const element of root.querySelectorAll('rpevents')) {
        if (element.closest('textarea, input, [contenteditable="true"]')) continue;
        element.remove(); changed = true;
    }
    // Already-mounted messages may predate installation of the display rule.
    // Compare with the host's rendered payload too, without fuzzy text deletion.
    if (renderProtocol && /rpEvents|["“](?:version|events|state|claims|observations)["”]\s*:/i.test(root.textContent)) {
        for (const match of String(raw || '').matchAll(protocolPattern)) {
            try {
                const preview = root.ownerDocument.createElement('template');
                preview.innerHTML = renderProtocol(match[1]);
                const text = compact([...preview.content.childNodes].map(node => node.textContent || '').join(''));
                if (text.length >= 16) {
                    payloads.push(compact(match[0].slice(0, match[0].indexOf('>') + 1)) + text
                        + compact(match[0].match(/<\/rpEvents\s*>$/i)?.[0] || ''), text);
                }
            } catch { /* A host formatter failure must not interrupt chat rendering. */ }
        }
    }
    const visibleText = compact(root.textContent);
    for (const payload of new Set(payloads)) {
        if (!visibleText.includes(payload)) continue;
        const units = [], nodes = [], elements = [], order = new Map();
        let position = 0;
        function walk(node) {
            order.set(node, position++);
            if (node.nodeType === 3) {
                nodes.push(node);
                for (let i = 0; i < node.data.length; i++) if (!/\s/u.test(node.data[i])) units.push({ node, offset: i, char: node.data[i] });
            } else if (node.nodeType === 1 && !node.matches('textarea, input, script, style, [contenteditable="true"]')) {
                for (const child of node.childNodes) walk(child);
                elements.push({ node, end: position - 1 });
            }
        }
        walk(root);
        const rendered = units.map(unit => unit.char).join('');
        const start = rendered.indexOf(payload);
        if (start < 0 || rendered.indexOf(payload, start + 1) >= 0) continue;
        const first = units[start], last = units[start + payload.length - 1];
        const startNode = nodes.indexOf(first.node), endNode = nodes.indexOf(last.node), parents = new Set();
        for (const element of elements) {
            if (order.get(element.node) > order.get(first.node) && element.end < order.get(last.node)
                && !element.node.querySelector('textarea, input, [contenteditable="true"]')) element.node.remove();
        }
        for (let i = startNode; i <= endNode; i++) {
            const node = nodes[i]; parents.add(node.parentElement);
            node.data = node.data.slice(0, i === startNode ? first.offset : 0)
                + node.data.slice(i === endNode ? last.offset + 1 : node.data.length);
        }
        for (let parent of parents) {
            while (parent && parent !== root && /^(P|SPAN|CODE|PRE|EM|STRONG|B|I|Q)$/i.test(parent.tagName)
                && !parent.textContent.trim() && !parent.querySelector('img, svg, video, audio, iframe, input, button')) {
                const next = parent.parentElement; parent.remove(); parent = next;
            }
        }
        changed = true;
    }
    return changed;
}

export function createRpProtocolDisplay({ documentRef, getChat, renderProtocol, installDisplayFilter = () => {}, Observer = globalThis.MutationObserver, schedule = callback => queueMicrotask(callback) }) {
    let observer = null, container = null, queued = false;
    const pending = new Set();
    function collect(node) {
        const element = node?.nodeType === 3 ? node.parentElement : node;
        if (!element?.querySelectorAll) return;
        const own = element.closest?.('.mes_text');
        if (own) pending.add(own);
        for (const root of element.querySelectorAll('.mes_text')) pending.add(root);
    }
    function flush() {
        queued = false;
        const roots = [...pending]; pending.clear();
        const chat = getChat() || [];
        for (const root of roots) {
            if (!container?.contains(root)) continue;
            const message = root.closest('.mes[mesid]');
            const id = Number(message?.getAttribute('mesid'));
            const current = chat[id];
            if (!message || !Number.isSafeInteger(id) || id < 0 || !current || current.is_user || current.is_system) continue;
            for (const raw of new Set([current.extra?.display_text, current.mes])) {
                hideRenderedRpProtocol(root, raw, { renderProtocol: renderProtocol && (text => renderProtocol(text, current)) });
            }
        }
    }
    function enqueue() { if (!queued) { queued = true; schedule(flush); } }
    function bind() {
        installDisplayFilter();
        const next = documentRef.querySelector('#chat');
        if (next !== container) {
            observer?.disconnect(); pending.clear(); container = next;
            observer = next && Observer ? new Observer(records => {
                for (const record of records) { collect(record.target); for (const node of record.addedNodes || []) collect(node); }
                enqueue();
            }) : null;
            observer?.observe(next, { childList: true, characterData: true, subtree: true });
        }
        if (container) { collect(container); enqueue(); }
    }
    function dispose() { observer?.disconnect(); observer = null; container = null; pending.clear(); }
    return { bind, dispose, flush };
}
