import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTableWorkbenchUi } from '../src/features/table-workbench-ui.js';

test('the table page module starts, and index.js only takes what it exports', () => {
    const ui = createTableWorkbenchUi({});
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const taken = source.match(/const \{([^}]*)\} = tableWorkbenchUi;/)[1]
        .split(',').map(name => name.trim().split(':')[0].trim()).filter(Boolean);
    for (const name of taken) assert.ok(name in ui, `tableWorkbenchUi exports ${name}`);
});

test('saving a table that is shown as records keeps its rows and column notes', () => {
    const table = { tableIndex: 0, name: '角色', columns: ['名字', '备注'], columnPrompts: ['', '写长期备注'], rows: [['旅人', '在找人'], ['格伦', '铁匠']] };
    const state = { tableDatabase: { tables: [table] } };
    const ui = createTableWorkbenchUi({ getState: () => state, persistCurrentTableDatabase() {}, renderWorkbenchScope() {}, workbenchRenderScopes: {} });
    // A record being edited: only that row has inputs on screen.
    const inputs = { '[data-table-col="0"]': { value: '旅人' }, '[data-table-col="1"]': { value: '在找北方矿坑里的人' } };
    const form = { dataset: { tableRowEdit: '0' }, querySelector: selector => inputs[selector] || null };
    const section = { dataset: { tableIndex: '0' }, querySelector: () => null, querySelectorAll: selector => selector === '[data-table-row-edit]' ? [form] : [] };
    ui.saveEditedTableFromElement(section, { render: false, persist: false });
    assert.deepEqual(table.rows, [['旅人', '在找北方矿坑里的人'], ['格伦', '铁匠']]);
    assert.deepEqual(table.columnPrompts, ['', '写长期备注']);
    assert.equal(table.name, '角色');
});
