import assert from 'node:assert/strict';
import { createTableWorkbenchUi } from '../../src/features/table-workbench-ui.js';
import { createTableEditorEvents } from '../../src/features/table-editor-events.js';
import { createTableMemoryModel } from '../../src/features/table-memory-model.js';
import { parseTableEditOperations } from '../../src/tables/operation-parser.js';
import { ensureChronicle } from '../../src/memory/story-state.js';
const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const { document } = parseHTML('<div id="bakemono-workbench-root"><div id="bakemono-memory-table-draft-list"></div></div>');
const state = { tableDatabase: { tables: [{ id: 't', tableIndex: 0, name: '成员', columns: ['名称'], rows: [] }], editDrafts: [], history: [] } };
ensureChronicle(state, []);
let saved = 0, applied = 0;
const model = createTableMemoryModel({ getState: () => state, getFiniteMessageIds: x => x, parseTableEditOperations,
    normalizeTableText: String, pushTableUndoSnapshot: () => ({ id: 'u' }), saveCurrentTableProfileRows() {}, updateInjectionFromSummaries() {} });
const ui = createTableWorkbenchUi({ document, getState: () => state, formatSourceRange: () => '第 1 楼', inspectTableEditDraft: model.inspectTableEditDraft });
const handlers = new Map();
function query() { return { off() { return this; }, on(event, selector, handler) { if (handler) handlers.set(selector, handler); return this; } }; }
createTableEditorEvents({ query, getState: () => state, parseTableEditOperations, inspectTableEditDraft: model.inspectTableEditDraft,
    applyTableOperations: (...args) => { applied++; return model.applyTableOperations(...args); },
    persistCurrentTableDatabase: () => saved++, renderWorkbenchScope: () => ui.renderTableEditDrafts(state), workbenchRenderScopes: { TABLES: 'tables' },
    confirmDanger: () => true, formatSourceRange: String, toastr: { error() {}, warning() {}, success() {} },
}).bind();
const draft = { id: 'd', raw: '<tableEdit>insertRow(0,{"0":"<img src=x onerror=alert(1)>"})\nsetStoryClock({"date":"2026-02-30"})</tableEdit>', sourceMessageIds: [1] };
state.tableDatabase.editDrafts.push(draft);
ui.renderTableEditDrafts(state);
let card = document.querySelector('.bakemono-memory-table-draft-card');
assert.match(card.querySelector('[role="alert"]').textContent, /setStoryClock.*日期/);
assert.match(card.querySelector('h4').textContent, /未应用/);
assert.equal(card.querySelector('img'), null, 'model content must be text, not executable HTML');
async function click(action, raw) {
    card = document.querySelector('.bakemono-memory-table-draft-card');
    if (raw !== undefined) card.querySelector('textarea').value = raw;
    const button = card.querySelector(`[data-bakemono-table-draft-action="${action}"]`);
    await handlers.get('[data-bakemono-table-draft-action]').call(button, { preventDefault() {}, stopPropagation() {} });
    card = document.querySelector('.bakemono-memory-table-draft-card');
}
await click('apply');
assert.equal(applied, 0, 'preflight prevents invalid commit');
assert.equal(state.tableDatabase.tables[0].rows.length, 0);
await click('reparse', '<tableEdit>insertRow(0,)</tableEdit>');
assert.match(card.querySelector('[role="alert"]').textContent, /insertRow.*参数/);
assert.equal(draft.operations.length, 0, 'old valid operations must not survive a failed reparse');
assert.ok(saved);
await click('reparse', '<tableEdit>insertRow(0,{"0":"林舟"})\nsetStoryClock({"date":"11月14日"})</tableEdit>');
assert.equal(card.querySelector('[role="alert"]'), null);
assert.match(card.querySelector('[role="status"]').textContent, /未提供年份/);
await click('apply');
assert.equal(applied, 1);
assert.deepEqual(state.tableDatabase.tables[0].rows, [['林舟']]);
assert.equal(state.tableDatabase.editDrafts.length, 0);
assert.equal(state.tableDatabase.history.length, 1);
console.log('table draft feedback DOM checks passed: persistent errors, raw repair, normalization notice, safe text, one commit');
