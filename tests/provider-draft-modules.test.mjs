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

test('OpenAI-compatible provider helpers keep endpoint construction stable', async () => {
    const provider = await loadModule('src/vector/provider-config.js');

    assert.equal(provider.normalizeCustomApiBaseUrl(' https://api.example/v1/// '), 'https://api.example/v1');
    assert.equal(
        provider.getCustomChatCompletionsUrl('https://api.example/v1/chat/completions/'),
        'https://api.example/v1/chat/completions',
    );
    assert.equal(
        provider.getCustomChatCompletionsUrl('https://api.example/v1'),
        'https://api.example/v1/chat/completions',
    );
    assert.equal(
        provider.getCustomModelsUrl('https://api.example/v1/chat/completions'),
        'https://api.example/v1/models',
    );
    assert.equal(
        provider.getCustomEmbeddingsUrl('https://api.example/v1/embeddings/'),
        'https://api.example/v1/embeddings',
    );
});

test('model list parser accepts id or name, removes blanks and sorts unique values', async () => {
    const provider = await loadModule('src/vector/provider-config.js');
    const models = provider.extractCustomModelIds({
        data: [
            { id: 'text-embedding-3-small' },
            { name: 'qwen-plus' },
            { id: ' text-embedding-3-small ' },
            { id: '' },
            null,
        ],
    });

    assert.deepEqual(models, ['qwen-plus', 'text-embedding-3-small']);
    assert.deepEqual(provider.extractCustomModelIds({ models: [] }), []);
});

test('missing-summary batch parser maps each generated segment back to its target', async () => {
    const textSource = await readFile(new URL('src/shared/text.js', repoUrl), 'utf8');
    const textUrl = toDataModule(textSource);
    const parser = await loadModule('src/summary/draft-parser.js', [
        ["'../shared/text.js'", `'${textUrl}'`],
    ]);
    const task = {
        metadata: {
            missingTargets: [
                { messageId: 12, hash: 'floor-12' },
                { messageId: 18, hash: 'floor-18' },
            ],
        },
    };
    const result = `
<thinking>hidden reasoning</thinking>
===楼层#12===
<summaryDraft>First summary</summaryDraft>
===message 18===
Second summary
`;
    const parsed = parser.parseMissingSummaryBatchResult(result, task, content => `[normalized] ${content}`);

    assert.deepEqual(parsed, [
        { target: task.metadata.missingTargets[0], content: '[normalized] First summary' },
        { target: task.metadata.missingTargets[1], content: '[normalized] Second summary' },
    ]);
});

test('missing-summary parser supports an unsegmented result only for one target', async () => {
    const textSource = await readFile(new URL('src/shared/text.js', repoUrl), 'utf8');
    const textUrl = toDataModule(textSource);
    const parser = await loadModule('src/summary/draft-parser.js', [
        ["'../shared/text.js'", `'${textUrl}'`],
    ]);
    const target = { messageId: 7, hash: 'floor-7' };

    assert.deepEqual(
        parser.parseMissingSummaryBatchResult('<summaryDraft>Only summary</summaryDraft>', {
            metadata: { missingTargets: [target] },
        }),
        [{ target, content: 'Only summary' }],
    );
    assert.deepEqual(
        parser.parseMissingSummaryBatchResult('Ambiguous summary', {
            metadata: { missingTargets: [target, { messageId: 8 }] },
        }),
        [],
    );
});
