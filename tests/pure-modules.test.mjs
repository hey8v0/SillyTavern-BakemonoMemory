import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../', import.meta.url);

function toDataModule(source) {
    return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function loadPureModules() {
    const textSource = await readFile(new URL('src/shared/text.js', repoUrl), 'utf8');
    const textUrl = toDataModule(textSource);
    const vectorSource = await readFile(new URL('src/vector/math.js', repoUrl), 'utf8');
    const vectorUrl = toDataModule(vectorSource.replace("'../shared/text.js'", `'${textUrl}'`));
    return {
        text: await import(textUrl),
        vector: await import(vectorUrl),
    };
}

test('shared text helpers preserve scanning and search behavior', async () => {
    const { text } = await loadPureModules();

    assert.match(text.getHash('bakemono'), /^[0-9a-f]{8}$/);
    assert.equal(text.getHash('bakemono'), text.getHash('bakemono'));
    assert.deepEqual(text.parseList('角色, 地点，事件\n伏笔'), ['角色', '地点', '事件', '伏笔']);
    assert.equal(
        text.stripConfiguredTags('正文<think>隐藏</think><bakemono>摘要</bakemono>', ['think']),
        '正文<bakemono>摘要</bakemono>',
    );
    assert.equal(text.normalizeTagName('<小剧场>'), '小剧场');
    assert.equal(
        text.stripConfiguredTags('正文<小剧场 type="extra">不应参与摘要</小剧场>结尾', ['<小剧场>']),
        '正文结尾',
    );
    assert.equal(
        text.stripConfiguredTags('正文<小剧场 hidden="true" />结尾', ['小剧场']),
        '正文结尾',
    );
    assert.deepEqual(
        text.extractConfiguredTagBlocks('<bakemono>一</bakemono><bakemono>二</bakemono>', ['bakemono']),
        [
            { content: '<bakemono>一</bakemono>', matchedTag: 'bakemono' },
            { content: '<bakemono>二</bakemono>', matchedTag: 'bakemono' },
        ],
    );
    assert.deepEqual(
        text.extractConfiguredTagBlocks('<小剧场>番外</小剧场>', ['<小剧场>']),
        [{ content: '<小剧场>番外</小剧场>', matchedTag: '小剧场' }],
    );
    assert.equal(text.matchesAnyKeyword('阶段总结：第一幕', ['阶段总结']), true);
    assert.equal(text.normalizeSearchText(' 第 12 楼：相 遇 '), '第12楼:相遇');
    assert.equal(text.countKeywordHits('黑曜石钥匙交给了 Nana', ['钥匙', 'Nana', '不存在']), 2);
});

test('local vector helpers stay deterministic and normalized', async () => {
    const { vector } = await loadPureModules();
    const first = vector.createLocalEmbedding('鲸湾书房里的黑曜石钥匙', 32);
    const second = vector.createLocalEmbedding('鲸湾书房里的黑曜石钥匙', 32);

    assert.deepEqual(first, second);
    assert.equal(first.length, 32);
    const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    assert.ok(Math.abs(norm - 1) < 0.00001);
    assert.ok(vector.cosineSimilarity(first, second) > 0.99999);
    assert.ok(vector.tokenizeForVector('Nana 在鲸湾').includes('nana'));
});
