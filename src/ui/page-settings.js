// The sticky save bar is the only save control for these pages.
const pages = {
    vector: { label: '向量设置', fields: /^bakemono-memory-vector-/ },
    scan: { label: '扫描规则', fields: /^bakemono-memory-(scan-mode|include-tags|exclude-tags|full-min-length|include-hidden|class-|layout-)/ },
    automation: { label: '自动总结', fields: /^bakemono-memory-(auto-|backfill-batch-size$)/ },
    generation: { label: '生成接口', fields: /^bakemono-memory-(api-provider|custom-)/ },
    prompts: { label: '生成提示词', fields: /^bakemono-memory-(story|missing|stage|epic)-prompt$/ },
    injection: { label: '注入设置', fields: /^bakemono-memory-(injection-(template|enabled)|depth|role)$/ },
    'turn-summary': { label: '摘要与表格设置', fields: /^bakemono-memory-(turn-|inline-|table-(prompt|enabled|inject-memory|auto-apply|schema-scope)$)/ },
};
const immediateFields = new Set(['bakemono-memory-vector-enabled', 'bakemono-memory-table-inject-memory', 'bakemono-memory-table-schema-scope']);

function numberIssue(el) {
    if (el.type !== 'number' || el.disabled || el.willValidate === false) return '';
    const validity = el.validity || {};
    if (validity.badInput || (el.value !== '' && !Number.isFinite(Number(el.value)))) return '请填写有效数字';
    if (validity.valueMissing) return '请填写数值';
    if (validity.rangeUnderflow) return `不能小于 ${el.min}`;
    if (validity.rangeOverflow) return `不能大于 ${el.max}`;
    if (validity.stepMismatch) return el.step === '1' ? '请填写整数'
        : `请以 ${el.step || '1'} 为间隔填写（起点 ${el.min || el.getAttribute('value') || '0'}）`;
    return validity.valid === false ? '请检查数值格式' : '';
}

function revealInvalidField(el) {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
        if (parent.classList.contains('is-mobile-collapsed')) {
            parent.classList.remove('is-mobile-collapsed');
            parent.classList.add('is-mobile-expanded');
        }
    }
    el.setAttribute('aria-invalid', 'true');
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'center', behavior: 'instant' });
}

// Drafts live only in this page/session. Never read hidden pages into shared settings.
export function createPageSettings({ documentRef, getState, getActiveTab, savePage, refresh, notify = () => {}, askLeave }) {
    const drafts = new WeakMap();
    let root, saving = false, replacement;
    const tabKey = tab => tab === 'tables' ? 'turn-summary' : tab;
    function controls(tab) {
        return [...(root?.querySelector(`[data-bakemono-panel="${tab}"]`)?.querySelectorAll('input[id], select[id], textarea[id]') || [])]
            .filter(el => pages[tab]?.fields.test(el.id) && !el.readOnly && el.type !== 'file'
                && !immediateFields.has(el.id) && !/preset|test-query|query-preview|models$/.test(el.id));
    }
    const value = el => el.type === 'checkbox' ? !!el.checked : el.value;
    const snapshot = tab => new Map(controls(tab).map(el => [el.id, value(el)]));
    function entry(state, tab) {
        if (!drafts.has(state)) drafts.set(state, new Map());
        const map = drafts.get(state);
        if (!map.has(tab)) map.set(tab, { base: snapshot(tab), edits: new Map(), revision: 0, status: '', configRevision: state.activeConfigSignature });
        return map.get(tab);
    }
    function render(tab = tabKey(getActiveTab()), state = getState()) {
        tab = tabKey(tab);
        const bar = documentRef.getElementById('bakemono-memory-page-savebar');
        if (!bar) return;
        bar.hidden = !pages[tab];
        if (!pages[tab]) return;
        const draft = entry(state, tab);
        if (draft.configRevision !== state.activeConfigSignature) {
            draft.base = snapshot(tab);
            draft.configRevision = state.activeConfigSignature;
            if (replacement?.state === state && replacement.tab === tab) {
                for (const id of draft.edits.keys()) if (!replacement.field || replacement.field === id) draft.edits.delete(id);
                draft.status = '';
            }
        }
        for (const el of controls(tab)) {
            if (!numberIssue(el)) el.removeAttribute('aria-invalid');
            if (!draft.edits.has(el.id)) { draft.base.set(el.id, value(el)); continue; }
            if (el.type === 'checkbox') el.checked = draft.edits.get(el.id);
            else if (el.value !== draft.edits.get(el.id)) el.value = draft.edits.get(el.id);
        }
        documentRef.getElementById('bakemono-memory-page-save-status').textContent =
            `${pages[tab].label} · ${saving ? '正在保存…' : draft.status || (draft.edits.size ? `未保存 · ${draft.edits.size} 项修改` : '无未保存修改')}`;
        documentRef.getElementById('bakemono-memory-page-save').disabled = saving;
        documentRef.getElementById('bakemono-memory-page-discard').hidden = !draft.edits.size;
        documentRef.getElementById('bakemono-memory-page-discard').disabled = saving;
        bar.classList.toggle('is-dirty', !!draft.edits.size);
    }
    function onInput(event) {
        const tab = tabKey(getActiveTab()), state = getState();
        if (!pages[tab] || !controls(tab).includes(event.target)) return;
        const draft = entry(state, tab), el = event.target;
        if (value(el) === draft.base.get(el.id)) draft.edits.delete(el.id);
        else draft.edits.set(el.id, value(el));
        draft.revision++; draft.status = ''; render(tab, state);
    }
    async function save() {
        const tab = tabKey(getActiveTab()), state = getState();
        if (!pages[tab] || saving) return;
        const draft = entry(state, tab), revision = draft.revision, submitted = snapshot(tab);
        const invalid = controls(tab).find(el => numberIssue(el));
        if (invalid) {
            const label = invalid.labels?.[0] || invalid.closest('label');
            const name = (label?.querySelector('span')?.textContent || label?.textContent || invalid.getAttribute('aria-label') || invalid.id).trim();
            const message = `「${name}」${numberIssue(invalid)}。`;
            draft.status = `未保存 · ${message}`;
            render(tab, state);
            notify(message);
            revealInvalidField(invalid);
            return;
        }
        saving = true; render(tab, state);
        try {
            const confirmed = await savePage(tab, state);
            if (getState() !== state) return;
            if (confirmed !== true) throw Error('保存尚未确认，请重试保存设置。');
            draft.base = submitted;
            draft.configRevision = state.activeConfigSignature;
            if (revision === draft.revision) { draft.edits.clear(); draft.status = '已核验保存'; }
            else for (const [id, edit] of draft.edits) if (edit === submitted.get(id)) draft.edits.delete(id);
        } catch (error) {
            draft.status = '保存未确认 · 请重试';
            if (getState() === state) notify(error?.message || String(error));
        } finally {
            saving = false;
            if (getState() === state) refresh();
            render();
        }
    }
    function discard() {
        if (saving) return;
        const tab = tabKey(getActiveTab()), draft = entry(getState(), tab);
        for (const el of controls(tab)) if (draft.base.has(el.id)) {
            if (el.type === 'checkbox') el.checked = draft.base.get(el.id); else el.value = draft.base.get(el.id);
        }
        drafts.get(getState())?.delete(tab); refresh(); render();
    }
    function unsavedCount(tab) {
        return pages[tab] ? drafts.get(getState())?.get(tab)?.edits.size || 0 : 0;
    }
    // Leaving a settings page (nextTab) or closing the workbench (null) with
    // unsaved edits asks first. Returns true, or a promise when the user decides.
    function confirmLeave(nextTab = null) {
        const tab = tabKey(getActiveTab()), state = getState();
        const count = unsavedCount(tab);
        if (saving || !count || !askLeave || (nextTab && tabKey(nextTab) === tab)) return true;
        return (async () => {
            const choice = await askLeave({ label: pages[tab].label, count, closing: !nextTab });
            if (getState() !== state || tabKey(getActiveTab()) !== tab) return false;
            if (choice === 'discard') { discard(); return true; }
            if (choice !== 'save') return false;
            await save();
            return getState() === state && !unsavedCount(tab);
        })();
    }
    function onClick(event) {
        const tab = tabKey(getActiveTab());
        if (!pages[tab]) return;
        if (event.target.closest('#bakemono-memory-page-save')) {
            event.preventDefault(); event.stopImmediatePropagation(); void save();
        } else if (event.target.closest('#bakemono-memory-page-discard')) {
            event.preventDefault(); discard();
        } else {
            const button = event.target.closest('button[id]');
            if (button?.id.includes('reset-')) {
                const field = button.id.replace('reset-', '').replace('bakemono-memory-template', 'bakemono-memory-injection-template');
                markReplacement(tab, controls(tab).some(el => el.id === field) ? field : undefined);
            } else if (button?.id.includes('load-') && /preset|config/.test(button.id)) markReplacement(tab);
        }
    }
    // Existing preset/reset handlers apply synchronously after confirmation. A
    // cancelled dialog or selection-only dropdown must not discard typed edits.
    function markReplacement(tab, field) {
        const ticket = { state: getState(), tab, field };
        replacement = ticket;
        queueMicrotask(() => { if (replacement === ticket) replacement = null; });
    }
    function onPreset(event) {
        if (event.target.matches('select[id*="preset"]')) markReplacement(tabKey(getActiveTab()));
    }
    function bind(nextRoot) {
        if (root === nextRoot) return;
        root?.removeEventListener('input', onInput); root?.removeEventListener('change', onInput);
        root?.removeEventListener('click', onClick, true); root?.removeEventListener('change', onPreset, true);
        root = nextRoot;
        root?.addEventListener('input', onInput); root?.addEventListener('change', onInput);
        root?.addEventListener('click', onClick, true); root?.addEventListener('change', onPreset, true);
    }
    return { bind, confirmLeave, render, save };
}
