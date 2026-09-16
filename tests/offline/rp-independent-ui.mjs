import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRpStateUi } from '../../src/features/rp-state-ui.js';
import { runtimeHost } from '../helpers/rp-runtime-host.mjs';
const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const { document, window } = parseHTML(await readFile(new URL('../../settings.html', import.meta.url), 'utf8'));
Object.defineProperty(window.HTMLInputElement.prototype, 'checked', { get() { return this.hasAttribute('checked'); }, set(v) { this.toggleAttribute('checked', !!v); } });
const h = runtimeHost(), root = document.querySelector('#bakemono-rp-root');
let file = null, confirm = true, located = null, focused;
window.HTMLElement.prototype.focus = function () { focused = this; };
const downloads = [];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ui = createRpStateUi({ documentRef: document, getState: () => h.state, service: h.service, flow: h.flow, navigate() {},
    promptLibrary: h.library, escapeHtml: esc, confirm: () => confirm, chooseFile: async () => file,
    download: async payload => downloads.push(payload), locateSource: floor => located = floor, getContextPreview: () => h.injection.getInjectionMemoryParts().rpContext });
const click = async selector => {
    const node = root.querySelector(selector); assert.ok(node, selector + '\n' + root.textContent);
    node.dispatchEvent(new window.Event('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(root.querySelector('[role=alert]')?.textContent || null, null, root.textContent);
};
const fill = (key, value) => { const input = root.querySelector('[data-rp-edit-field="' + key + '"]'); assert.ok(input, key); input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
ui.bind(); ui.render();
await click('[data-rp-action=enable-preview]');
assert.equal(root.querySelector('[data-rp-action=migration]'), null);
await click('[data-rp-action=enable-confirm]');
for (const [kind, field, value] of [['people', 'name', '甲'], ['locations', 'name', '书店'], ['items', 'name', '钥匙']]) {
    await click('[data-rp-action=new][data-rp-kind=' + kind + ']'); fill(field, value); await click('[data-rp-action=edit-save]');
    assert.equal(h.service.view().projection[kind].length, 1);
}
assert.equal(h.service.view().projection.items[0].holder, null);
const person = h.service.view().projection.people[0];
await click('.rp-story-person'); await click('[data-rp-action=state-new]'); fill('description', '受伤'); await click('[data-rp-action=edit-save]');
await click('[data-rp-action=state-new]'); fill('description', '疲惫'); await click('[data-rp-action=edit-save]');
const fatigue = h.service.view().projection.people[0].states.find(item => item.description === '疲惫');
await click('[data-rp-action=state-end][data-rp-state-id="' + fatigue.id + '"]');
assert.equal(h.service.view().projection.people[0].states[0].active, true);
assert.equal(h.service.view().projection.people[0].states[1].active, false);
await click('[data-rp-action=back]');
await click('[data-rp-action=new][data-rp-kind=plans]'); fill('title', '看海');
const participant = root.querySelector('input[data-rp-edit-field=participants]');
assert.ok(participant); participant.checked = true; participant.dispatchEvent(new window.Event('change', { bubbles: true }));
await click('[data-rp-action=edit-save]'); assert.equal(h.service.view().projection.plans.length, 1);
const other = JSON.stringify([h.state.storySummaries, h.state.tableDatabase, h.chat]);
const pack = h.service.backup();
await click('[data-rp-action=settings]'); await click('[data-rp-action=backup]'); assert.equal(downloads.length, 1);
confirm = false; await click('[data-rp-action=clear-preview]'); assert.equal(h.service.view().projection.people.length, 1);
confirm = true; await click('[data-rp-action=clear-preview]'); assert.equal(downloads.length, 2); assert.equal(h.service.view().projection.people.length, 0);
await click('[data-rp-action=settings]'); file = { text: async () => JSON.stringify(pack) };
await click('[data-rp-action=restore]'); assert.equal(downloads.length, 3);
assert.equal(h.service.view().projection.people[0].id, person.id); assert.equal(h.state.rpCore.settings.enabled, false);
assert.equal(JSON.stringify([h.state.storySummaries, h.state.tableDatabase, h.chat]), other);
console.log('PASS: U01/U02 independent empty enable, create people/location/item/plan, per-state end, backup-before-clear/restore, cancellation, scoped data protection; offline DOM only.');
