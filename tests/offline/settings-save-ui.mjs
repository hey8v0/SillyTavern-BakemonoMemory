import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPageSettings } from '../../src/ui/page-settings.js';
const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const { document, window } = parseHTML(await readFile(new URL('../../settings.html', import.meta.url), 'utf8'));
// Linkedom exposes a getter-only select.value; browsers expose both.
const selectValue = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    ...selectValue, set(value) { for (const option of this.options) option.selected = option.value === String(value); },
});
let state = {}, tab = 'vector', done;
const saves = [], warnings = [];
const ui = createPageSettings({ documentRef: document, getState: () => state, getActiveTab: () => tab,
    savePage: async t => { saves.push(t); return new Promise(resolve => { done = resolve; }); }, refresh() {}, notify: message => warnings.push(message) });
const root = document.getElementById('bakemono-workbench-root'); ui.bind(root); ui.render();
const model = document.getElementById('bakemono-memory-vector-model');
model.value = 'changed'; model.dispatchEvent(new window.Event('input', { bubbles: true }));
assert.match(document.getElementById('bakemono-memory-page-save-status').textContent, /未保存/);
tab = 'prompts'; ui.render(); tab = 'vector'; model.value = 'background-render'; ui.render();
assert.equal(model.value, 'changed');
const save = ui.save(); assert.deepEqual(saves, ['vector']);
assert.match(document.getElementById('bakemono-memory-page-save-status').textContent, /正在保存/);
done(true); await save;
assert.match(document.getElementById('bakemono-memory-page-save-status').textContent, /已核验保存/);
model.value = 'private-draft'; model.dispatchEvent(new window.Event('input', { bubbles: true }));
state = {}; model.value = 'other-chat'; ui.render(); assert.equal(model.value, 'other-chat');
model.value = 'retry-me'; model.dispatchEvent(new window.Event('input', { bubbles: true }));
const failed = ui.save(); done(false); await failed;
assert.match(document.getElementById('bakemono-memory-page-save-status').textContent, /保存未确认/);
assert.equal(warnings.length, 1);
model.value = 'background'; ui.render(); assert.equal(model.value, 'retry-me');
const pending = ui.save();
model.value = 'newer-edit'; model.dispatchEvent(new window.Event('input', { bubbles: true }));
model.value = 'background'; ui.render(); assert.equal(model.value, 'newer-edit');
done(true); await pending;
assert.match(document.getElementById('bakemono-memory-page-save-status').textContent, /未保存/);
assert.equal(model.value, 'newer-edit');
// Discard must return to the just-saved value, not the pre-save baseline.
document.getElementById('bakemono-memory-page-discard').dispatchEvent(new window.Event('click', { bubbles: true }));
assert.equal(model.value, 'retry-me');
model.value = 'keep-after-cancel'; model.dispatchEvent(new window.Event('input', { bubbles: true }));
document.querySelector('[data-bakemono-panel="vector"] select[id*="preset"]').dispatchEvent(new window.Event('change', { bubbles: true }));
await Promise.resolve(); model.value = 'background'; ui.render();
assert.equal(model.value, 'keep-after-cancel');
// A real externally applied configuration becomes the discard baseline.
state.activeConfigSignature = 'new-config'; model.value = 'new-committed'; ui.render();
assert.equal(model.value, 'keep-after-cancel');
document.getElementById('bakemono-memory-page-discard').dispatchEvent(new window.Event('click', { bubbles: true }));
assert.equal(model.value, 'new-committed');
const oldChatSave = ui.save();
state = {}; model.value = 'third-chat'; ui.render();
assert.equal(document.getElementById('bakemono-memory-page-save').disabled, true);
done(true); await oldChatSave;
assert.equal(document.getElementById('bakemono-memory-page-save').disabled, false);
assert.equal(model.value, 'third-chat');
assert.doesNotMatch(document.getElementById('bakemono-memory-page-save-status').textContent, /已核验保存/);
const enabled = document.getElementById('bakemono-memory-vector-enabled');
enabled.checked = true; enabled.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.doesNotMatch(document.getElementById('bakemono-memory-page-save-status').textContent, /切页暂存/);
tab = 'overview'; ui.render(); assert.equal(document.getElementById('bakemono-memory-page-savebar').hidden, true);
assert.ok(document.querySelector('[data-bakemono-panel="preview"] [data-bakemono-nav="automation"]'));
console.log('Settings save UI: scoped save, failure/retry, edits during save, discard, cancelled preset, chat isolation, summary shortcut passed.');
