const compact = value => String(value || '').replace(/\s/gu, '');

export function rpDisplayPayloads(raw) {
    return [...String(raw || '').matchAll(/<rpEvents\b[^>]*>([\s\S]*?)(?:<\/rpEvents\s*>|$)/gi)]
        .flatMap(match => [compact(match[0]), compact(match[1])]).filter(value => value.length >= 16);
}

// Only the rendered text is changed. Stored messages, swipes and edit inputs
// retain the protocol so extraction and source verification can still read it.
export function hideRenderedRpProtocol(root, raw) {
    if (!root?.querySelectorAll || root.matches('textarea, input, [contenteditable="true"]')) return false;
    const payloads = rpDisplayPayloads(raw);
    if (!payloads.length) return false;
    let changed = false;
    for (const element of root.querySelectorAll('rpevents')) { element.remove(); changed = true; }
    for (const payload of payloads) {
        const units = [], nodes = [];
        function walk(node) {
            if (node.nodeType === 3) {
                nodes.push(node);
                for (let i = 0; i < node.data.length; i++) if (!/\s/u.test(node.data[i])) units.push({ node, offset: i, char: node.data[i] });
            } else if (node.nodeType === 1 && !node.matches('textarea, input, script, style, [contenteditable="true"]')) {
                for (const child of node.childNodes) walk(child);
            }
        }
        walk(root);
        const rendered = units.map(unit => unit.char).join('');
        const start = rendered.indexOf(payload);
        if (start < 0 || rendered.indexOf(payload, start + 1) >= 0) continue;
        const first = units[start], last = units[start + payload.length - 1];
        const startNode = nodes.indexOf(first.node), endNode = nodes.indexOf(last.node), parents = new Set();
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

export function createRpProtocolDisplay({ documentRef, getChat, Observer = globalThis.MutationObserver, schedule = callback => queueMicrotask(callback) }) {
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
        const chat = getChat();
        for (const root of roots) {
            if (!container?.contains(root)) continue;
            const message = root.closest('.mes[mesid]');
            const id = Number(message?.getAttribute('mesid'));
            if (!message || !Number.isSafeInteger(id) || id < 0 || chat[id]?.is_user || chat[id]?.is_system) continue;
            hideRenderedRpProtocol(root, chat[id]?.mes);
        }
    }
    function enqueue() { if (!queued) { queued = true; schedule(flush); } }
    function bind() {
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
