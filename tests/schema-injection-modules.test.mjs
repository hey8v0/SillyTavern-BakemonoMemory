import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../', import.meta.url);

function toDataModule(source) {
    return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function loadModule(path, replacements = []) {
    let source = await readFile(new URL(path, repoUrl), 'utf8');
    for (const [from, to] of replacements) {
        source = source.replace(from, to);
    }
    return await import(toDataModule(source));
}

async function loadSchemaModule() {
    const textSource = await readFile(new URL('src/shared/text.js', repoUrl), 'utf8');
    const textUrl = toDataModule(textSource);
    return await loadModule('src/tables/schema-utils.js', [
        ["'../shared/text.js'", `'${textUrl}'`],
    ]);
}

test('table schemas normalize configuration without carrying live rows', async () => {
    const schema = await loadSchemaModule();
    const normalized = schema.toTableSchema({
        id: 'characters',
        tableIndex: '3',
        name: 'Characters',
        columns: ['Name', 'Status'],
        columnPrompts: ['identity', 'current state', 'ignored'],
        rows: [['Nana', 'awake']],
        readOnly: true,
        allowAiEdit: true,
        inject: false,
        injectLimit: -4,
    }, 0);

    assert.deepEqual(normalized.columns, ['Name', 'Status']);
    assert.deepEqual(normalized.columnPrompts, ['identity', 'current state']);
    assert.deepEqual(normalized.rows, []);
    assert.equal(normalized.tableIndex, 3);
    assert.equal(normalized.readOnly, true);
    assert.equal(normalized.allowAiEdit, false);
    assert.equal(normalized.inject, true);
    assert.equal(normalized.injectLimit, 0);
});

test('table schema matching preserves rows by id, index or name', async () => {
    const schema = await loadSchemaModule();
    const nextSchema = schema.toTableSchema({
        id: 'characters',
        tableIndex: 2,
        name: 'Characters',
        columns: ['Name', 'Status', 'Place'],
    });
    const oldTables = [
        { id: 'characters', tableIndex: 9, name: 'Old name', rows: [['Nana', 'awake']] },
    ];
    const existing = schema.findMatchingTable(nextSchema, oldTables);
    const merged = schema.mergeTableSchemaWithRows(nextSchema, existing);

    assert.equal(existing.id, 'characters');
    assert.deepEqual(merged.rows, [['Nana', 'awake', '']]);
    assert.equal(schema.normalizeTableText('A, "B"\nC'), 'A /  B C');
});

test('table JSON importer accepts current and legacy sheet formats', async () => {
    const schema = await loadSchemaModule();
    const current = schema.normalizeImportedTablesFromJson({
        tables: [{ id: 'events', name: 'Events', columns: ['Title'], rows: [[12], [null]] }],
    });
    assert.deepEqual(current[0].rows, [['12'], ['']]);

    const legacy = schema.normalizeImportedTablesFromJson({
        sheet: {
            uid: 'legacy',
            name: 'Legacy sheet',
            orderNo: 1,
            content: [['id', 'Name', 'Value'], ['row-1', 'Key', 7]],
            sourceData: { note: 'Imported note' },
        },
    });
    assert.equal(legacy[0].id, 'legacy');
    assert.deepEqual(legacy[0].columns, ['Name', 'Value']);
    assert.deepEqual(legacy[0].rows, [['Key', '7']]);
    assert.equal(legacy[0].note, 'Imported note');
});

test('injection templates remove duplicate wrappers and render one clean copy', async () => {
    const injection = await loadModule('src/shared/injection-template.js');
    const fallback = '<memory>\n{{memory}}\n</memory>';
    const custom = 'BEGIN\n{{memory}}\nEND';
    const wrapped = 'BEGIN\r\nBEGIN\r\nRemember Nana\r\nEND\r\nEND';

    assert.equal(
        injection.normalizeInjectionMemoryBody(wrapped, custom, fallback),
        'Remember Nana',
    );
    assert.equal(
        injection.renderInjectionTemplate(wrapped, custom, fallback),
        'BEGIN\nRemember Nana\nEND',
    );
    assert.equal(
        injection.normalizeInjectionMemoryBody('<memory>\nRemember Nana\n</memory>', custom, fallback),
        'Remember Nana',
    );
    assert.equal(injection.renderInjectionTemplate('', custom, fallback), '');
    assert.equal(
        injection.renderInjectionTemplate('Remember Nana', 'Memory follows:', fallback),
        'Memory follows:\n\nRemember Nana',
    );
});

test('recognized legacy injection defaults gain a closing marker and front-of-history depth', async () => {
    const injection = await loadModule('src/shared/injection-template.js');
    const legacyTemplate = 'BEGIN\n{{memory}}';
    const nextTemplate = 'BEGIN\n{{memory}}\nEND';
    const settings = { enabled: true, depth: 4, template: legacyTemplate };

    assert.equal(injection.migrateBuiltInInjectionDefaults(settings, legacyTemplate, nextTemplate), true);
    assert.deepEqual(settings, { enabled: true, depth: 999, template: nextTemplate });

    const custom = { enabled: false, depth: 4, template: 'CUSTOM\n{{memory}}' };
    assert.equal(injection.migrateBuiltInInjectionDefaults(custom, legacyTemplate, nextTemplate), false);
    assert.deepEqual(custom, { enabled: false, depth: 4, template: 'CUSTOM\n{{memory}}' });
});
