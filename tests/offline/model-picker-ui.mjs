import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderModelPicker } from '../../src/ui/model-picker.js';
import { createPageSettings } from '../../src/ui/page-settings.js';
const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const { parse, walk, generate } = await import(process.env.BAKEMONO_TEST_CSSTREE || 'css-tree');
const { document, window } = parseHTML(await readFile(new URL('../../settings.html', import.meta.url), 'utf8'));
// linkedom has no native select.value setter; model the platform's selection value.
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return this.querySelector('option[selected]')?.value || ''; },
    set(value) { for (const option of this.querySelectorAll('option')) option.toggleAttribute('selected', option.value === value); },
});
for (const kind of ['custom', 'vector', 'vector-query']) {
    const id = `bakemono-memory-${kind}-model`, input = document.getElementById(id);
    input.value = 'saved-model';
    renderModelPicker(document, id, ['saved-model', 'another-model', 'another-model', '<script>unsafe</script>']);
    const select = document.querySelector(`select[data-model-input="${id}"]`);
    assert.ok(select);
    assert.equal(select.closest('label'), null);
    assert.equal(input.value, 'saved-model');
    assert.equal(input.hasAttribute('list'), false);
    assert.equal(select.querySelectorAll('option').length, 4);
    assert.equal(select.value, 'saved-model');
    assert.equal(select.querySelector('script'), null);
    assert.ok(select.getAttribute('aria-label'));
    let changes = 0, inputs = 0;
    input.addEventListener('change', () => changes++);
    input.addEventListener('input', () => inputs++);
    select.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(input.value, 'saved-model');
    assert.equal(changes, 0);
    renderModelPicker(document, id, []);
    assert.equal(select.querySelectorAll('option').length, 4, 'rerender/saving retains this endpoint catalog');
    renderModelPicker(document, id, ['another-model', 'saved-model'], { refresh: true });
    select.value = 'another-model';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(input.value, 'another-model');
    assert.equal(changes, 1); assert.equal(inputs, 1);
    input.value = 'saved-model';
    select.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(select.value, 'saved-model', 'opening reflects a programmatically restored draft');
    input.value = 'private/manual-model';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(select.value, '');
    renderModelPicker(document, id, ['new-model'], { refresh: true });
    assert.equal(input.value, 'private/manual-model');
    const endpoint = document.getElementById(`bakemono-memory-${kind === 'custom' ? 'custom' : kind}-base-url`);
    endpoint.value = 'https://new.example.test/v1';
    endpoint.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(select.disabled, true);
    assert.equal(input.value, 'private/manual-model');
    renderModelPicker(document, id, ['old-saved-candidate']);
    assert.equal(select.disabled, true, 'old saved candidates do not return after an endpoint change');
}
const state = { automation: { customApi: { model: 'unchanged' } } };
let saveCalls = 0;
const page = createPageSettings({ documentRef: document, getState: () => state, getActiveTab: () => 'generation', refresh() {},
    savePage: async () => { saveCalls++; state.automation.customApi.model = document.getElementById('bakemono-memory-custom-model').value; return true; } });
page.bind(document.getElementById('bakemono-workbench-root')); page.render();
renderModelPicker(document, 'bakemono-memory-custom-model', ['new-choice'], { refresh: true });
const picker = document.querySelector('select[data-model-input="bakemono-memory-custom-model"]');
picker.value = 'new-choice'; picker.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.equal(saveCalls, 0);
assert.equal(state.automation.customApi.model, 'unchanged');
assert.match(document.getElementById('bakemono-memory-page-save-status').textContent, /未保存/);
await page.save();
assert.equal(saveCalls, 1); assert.equal(state.automation.customApi.model, 'new-choice');
assert.match(document.getElementById('bakemono-memory-page-save-status').textContent, /已核验保存/);
const rules = new Map();
walk(parse(await readFile(new URL('../../style.css', import.meta.url), 'utf8')), node => {
    if (node.type !== 'Rule') return;
    const declarations = {};
    node.block.children.forEach(item => { if (item.type === 'Declaration') declarations[item.property] = generate(item.value); });
    rules.set(generate(node.prelude), declarations);
});
const prefix = '#bakemono-workbench-root .bakemono-memory-model-';
assert.equal(rules.get(prefix + 'picker')['min-width'], '0');
assert.equal(rules.get(prefix + 'select')['min-height'], '44px');
assert.equal(rules.get(prefix + 'select')['flex'], '0 0 44px');
assert.equal(rules.get(prefix + 'select')['background'], 'var(--bk-paper-soft)');
assert.equal(rules.get(prefix + 'select>select')['position'], 'absolute');
assert.ok(rules.get(prefix + 'select:focus-within')['outline']);
console.log('model picker DOM checks passed (three fields, full list, retained input, selection events, manual names)');
