import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkbenchNavigation } from '../src/ui/workbench-navigation.js';
import { createPageSettings } from '../src/ui/page-settings.js';

// Minimal element stubs: enough surface for navigation and the page draft model.
function classList(initial = []) {
    const set = new Set(initial);
    return { contains: name => set.has(name), add: (...names) => names.forEach(name => set.add(name)),
        remove: (...names) => names.forEach(name => set.delete(name)),
        toggle(name, force) { const on = force ?? !set.has(name); if (on) set.add(name); else set.delete(name); return on; } };
}

function createShell(panelNames) {
    const main = { scrollTop: 0 };
    const panels = panelNames.map(name => ({ dataset: { bakemonoPanel: name }, classList: classList(), querySelectorAll: () => [] }));
    const attributes = {};
    const root = {
        dataset: { activeTab: panelNames[0] }, classList: classList(),
        getAttribute: key => attributes[key] ?? null, setAttribute: (key, value) => { attributes[key] = value; },
        querySelector(selector) {
            if (selector === '.bakemono-workbench-main') return main;
            const match = selector.match(/data-bakemono-panel="([^"]+)"/);
            return match ? panels.find(panel => panel.dataset.bakemonoPanel === match[1]) || null : null;
        },
        querySelectorAll: selector => selector === '.bakemono-workbench-panel' ? panels : [],
    };
    return { root, main };
}

async function withShell(panelNames, run) {
    const shell = createShell(panelNames);
    const saved = { document: globalThis.document, window: globalThis.window, raf: globalThis.requestAnimationFrame };
    globalThis.document = { getElementById: id => id === 'bakemono-workbench-root' ? shell.root : null };
    globalThis.window = { matchMedia: () => ({ matches: false }), setTimeout };
    globalThis.requestAnimationFrame = () => 0;
    try { await run(shell); } finally {
        globalThis.document = saved.document; globalThis.window = saved.window; globalThis.requestAnimationFrame = saved.raf;
    }
}

test('switching pages starts the new page at its top', async () => {
    await withShell(['overview', 'preview'], ({ root, main }) => {
        const navigation = createWorkbenchNavigation();
        main.scrollTop = 420;
        assert.equal(navigation.switchTab('preview'), true);
        assert.equal(root.dataset.activeTab, 'preview');
        assert.equal(main.scrollTop, 0);
    });
});

test('leaving or closing waits for the unsaved-settings decision', async () => {
    await withShell(['turn-summary', 'overview'], async ({ root }) => {
        let decision;
        const asked = [];
        const navigation = createWorkbenchNavigation({
            confirmLeave: next => { asked.push(next); return new Promise(resolve => { decision = resolve; }); },
        });
        const refused = navigation.switchTab('overview');
        assert.equal(root.dataset.activeTab, 'turn-summary', 'the page must not change before the user decides');
        decision(false);
        assert.equal(await refused, false);
        assert.equal(root.dataset.activeTab, 'turn-summary');

        const allowed = navigation.switchTab('overview');
        decision(true);
        assert.equal(await allowed, true);
        assert.equal(root.dataset.activeTab, 'overview');

        const closing = navigation.close();
        assert.equal(root.classList.contains('bakemono-workbench-hidden'), false);
        decision(false);
        assert.equal(await closing, false);
        assert.equal(root.classList.contains('bakemono-workbench-hidden'), false);
        assert.deepEqual(asked, ['overview', 'overview', null]);
    });
});

function createSettingsDom(tab = 'turn-summary') {
    const elements = {};
    const field = { id: 'bakemono-memory-turn-source', type: 'select-one', value: 'existing', readOnly: false,
        removeAttribute() {}, setAttribute() {} };
    for (const id of ['bakemono-memory-page-savebar', 'bakemono-memory-page-save-status', 'bakemono-memory-page-save', 'bakemono-memory-page-discard']) {
        elements[id] = { id, hidden: false, disabled: false, textContent: '', classList: classList() };
    }
    const panel = { querySelectorAll: () => [field] };
    const listeners = {};
    const root = { querySelector: selector => selector.includes(`"${tab}"`) ? panel : null,
        addEventListener: (type, listener) => { listeners[type] = listener; }, removeEventListener() {} };
    return { documentRef: { getElementById: id => elements[id] || null }, root, field, elements, listeners };
}

function editedPage({ choice, confirmed = true, tab = 'turn-summary' }) {
    const dom = createSettingsDom();
    const state = { activeConfigSignature: 'r1' };
    const calls = { asked: [], saved: [] };
    const ui = createPageSettings({
        documentRef: dom.documentRef, getState: () => state, getActiveTab: () => tab,
        refresh() {}, notify() {},
        askLeave: async request => { calls.asked.push(request); return choice; },
        savePage: async page => { calls.saved.push(page); return confirmed; },
    });
    ui.bind(dom.root);
    ui.render();
    dom.field.value = 'inline';
    dom.listeners.input({ target: dom.field });
    return { ui, dom, calls };
}

test('unchanged settings pages never ask before leaving', () => {
    const dom = createSettingsDom();
    const ui = createPageSettings({ documentRef: dom.documentRef, getState: () => ({}), getActiveTab: () => 'turn-summary',
        refresh() {}, savePage: async () => true, askLeave: () => { throw new Error('must not ask'); } });
    ui.bind(dom.root); ui.render();
    assert.equal(ui.confirmLeave('overview'), true);
    assert.equal(ui.confirmLeave(null), true);
});

for (const [choice, confirmed, expected, savedPages] of [
    ['stay', true, false, []],
    ['discard', true, true, []],
    ['save', true, true, ['turn-summary']],
    ['save', false, false, ['turn-summary']],
]) {
    test(`an edited page resolves "${choice}"${choice === 'save' ? ` (save ${confirmed ? 'confirmed' : 'unconfirmed'})` : ''}`, async () => {
        const page = editedPage({ choice, confirmed });
        assert.match(page.dom.elements['bakemono-memory-page-save-status'].textContent, /未保存 · 1 项修改/);

        assert.equal(page.ui.confirmLeave('tables'), true, 'tables and turn-summary share one panel and one draft');
        const result = await page.ui.confirmLeave('overview');
        assert.equal(result, expected);
        assert.deepEqual(page.calls.asked, [{ label: '摘要与表格设置', count: 1, closing: false }]);
        assert.deepEqual(page.calls.saved, savedPages);
        assert.equal(page.dom.field.value, choice === 'discard' ? 'existing' : 'inline');
    });
}

test('closing with edits says the workbench is closing', async () => {
    const page = editedPage({ choice: 'stay' });
    assert.equal(await page.ui.confirmLeave(null), false);
    assert.equal(page.calls.asked[0].closing, true);
});

test('stylesheet keeps hidden elements hidden and the mode sheet free of sideways scroll', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /#bakemono-workbench-root \[hidden\] \{ display: none !important; \}/);
    assert.match(css, /\.bakemono-memory-generation-mode-box \{[^}]*overflow-x: hidden;/);
    assert.match(css, /\.bakemono-memory-generation-mode-box > \.bakemono-memory-inline-actions \{\s*margin-inline: 0;/);
});

test('RP onboarding shows its confirmation in place of the start button', async () => {
    const source = await readFile(new URL('../src/features/rp-state-ui.js', import.meta.url), 'utf8');
    const onboarding = source.slice(source.indexOf('if (!core) {'), source.indexOf('const hasData'));
    assert.match(onboarding, /nav\.setup \? `<section class="rp-preview"/);
    assert.match(onboarding, /<div class="rp-controls">\$\{button\('enable-confirm'/);
    assert.doesNotMatch(onboarding, /insertAdjacentHTML\('beforeend', `<section class="rp-preview"/);
});
