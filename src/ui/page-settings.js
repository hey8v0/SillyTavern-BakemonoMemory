const pages = {
    vector: { label: '向量设置', save: '[data-bakemono-action="vector-apply"]', fields: /^bakemono-memory-vector-/ },
    scan: { label: '扫描规则', save: '#bakemono-memory-apply-rules', fields: /^bakemono-memory-(scan-mode|include-tags|exclude-tags|full-min-length|include-hidden|class-|layout-)/ },
    automation: { label: '自动总结', save: '#bakemono-memory-apply-automation', fields: /^bakemono-memory-(auto-|backfill-batch-size$)/ },
    generation: { label: '生成接口', save: '#bakemono-memory-apply-generation-api', fields: /^bakemono-memory-(api-provider|custom-)/ },
    prompts: { label: '生成提示词', save: '#bakemono-memory-apply-prompts', fields: /^bakemono-memory-(story|missing|stage|epic)-prompt$/ },
    injection: { label: '注入设置', save: '#bakemono-memory-apply-injection', fields: /^bakemono-memory-(injection-(template|enabled)|depth|role)$/ },
    'turn-summary': { label: '摘要与表格设置', save: '#bakemono-memory-apply-turn-settings', fields: /^bakemono-memory-(turn-|inline-|table-(prompt|enabled|inject-memory|auto-apply|schema-scope)$)/ },
};
const immediateFields = new Set(['bakemono-memory-vector-enabled', 'bakemono-memory-table-inject-memory', 'bakemono-memory-table-schema-scope']);

// Drafts live only in this page/session. Never read hidden pages into shared settings.
export function createPageSettings({ documentRef, getState, getActiveTab, savePage, refresh, notify = () => {} }) {
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
            if (!draft.edits.has(el.id)) { draft.base.set(el.id, value(el)); continue; }
            if (el.type === 'checkbox') el.checked = draft.edits.get(el.id);
            else el.value = draft.edits.get(el.id);
        }
        documentRef.getElementById('bakemono-memory-page-save-status').textContent =
            `${pages[tab].label} · ${saving ? '正在保存…' : draft.status || (draft.edits.size ? '未保存 · 切页暂存' : '无未保存修改')}`;
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
        saving = true; render(tab, state);
        try {
            if (controls(tab).some(el => el.type === 'number' && (el.validity?.valid === false || (el.value !== '' && !Number.isFinite(Number(el.value)))))) {
                throw new Error('请检查数值设置，填写允许范围内的数字。');
            }
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
    function onClick(event) {
        const tab = tabKey(getActiveTab());
        if (!pages[tab]) return;
        if (event.target.closest('#bakemono-memory-page-save, ' + pages[tab].save)) {
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
    return { bind, render, save };
}
