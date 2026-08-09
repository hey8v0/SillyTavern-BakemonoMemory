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

test('table operation parser reads insert, update and delete without applying them', async () => {
    const textSource = await readFile(new URL('src/shared/text.js', repoUrl), 'utf8');
    const textUrl = toDataModule(textSource);
    const parser = await loadModule('src/tables/operation-parser.js', [
        ["'../shared/text.js'", `'${textUrl}'`],
    ]);
    const operations = parser.parseTableEditOperations(`
        <tableEdit>
        insertRow(0, {0: 'Nana', 1: '鲸湾'})
        updateRow(0, 2, {1: '书房'})
        deleteRow(1, 3)
        </tableEdit>
    `);

    assert.deepEqual(operations, [
        { op: 'insert', tableIndex: 0, data: { 0: 'Nana', 1: '鲸湾' } },
        { op: 'update', tableIndex: 0, rowIndex: 2, data: { 1: '书房' } },
        { op: 'delete', tableIndex: 1, rowIndex: 3 },
    ]);
});

test('vector query parser keeps Chinese clues and removes reasoning residue', async () => {
    const parser = await loadModule('src/vector/query-parser.js');
    const payload = parser.parseVectorQueryRewritePayload(`
        <think>Analyze the request and output queries.</think>
        INTENT: 找回鲸湾书房中遗失的钥匙
        Q1: Nana 在鲸湾书房交出黑曜石钥匙
        Q2: Kuroha 发现钥匙失踪后的反应
        Q3: Nana 在鲸湾书房交出黑曜石钥匙
        Output: no explanations
    `);

    assert.equal(payload.intent, '找回鲸湾书房中遗失的钥匙');
    assert.deepEqual(payload.queries, [
        'Nana 在鲸湾书房交出黑曜石钥匙',
        'Kuroha 发现钥匙失踪后的反应',
    ]);
    assert.equal(parser.extractChatCompletionText({ choices: [{ message: { content: [{ text: '第一行' }, { content: '第二行' }] } }] }), '第一行\n第二行');
});
