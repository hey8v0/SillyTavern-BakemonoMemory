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

async function loadPromptAndMetadataModules() {
    const metadataSource = await readFile(new URL('src/summary/source-metadata.js', repoUrl), 'utf8');
    const metadataUrl = toDataModule(metadataSource);
    return {
        metadata: await import(metadataUrl),
        prompts: await loadModule('src/shared/prompt-utils.js', [
            ["'../summary/source-metadata.js'", `'${metadataUrl}'`],
        ]),
    };
}

test('summary source metadata collects, formats and sorts source floors', async () => {
    const { metadata } = await loadPromptAndMetadataModules();
    const blocks = [
        { messageId: 12, sourceMessageIds: [10, 11, 12] },
        { messageId: Number.MAX_SAFE_INTEGER, sourceMessageIds: [20, 21, 20] },
    ];

    assert.deepEqual(metadata.getSourceMessageIdsFromBlocks(blocks), [12, 10, 11, 20, 21]);
    assert.equal(metadata.getSourceStart([12, 4, Number.MAX_SAFE_INTEGER]), 4);
    assert.equal(metadata.getSourceEnd([12, 4, Number.MAX_SAFE_INTEGER]), 12);
    assert.equal(metadata.formatSourceRange([4]), '楼层 4');
    assert.equal(metadata.formatSourceRange([4, 12]), '楼层 4-12');
    assert.equal(metadata.formatSourceRange([]), '来源楼层未知');

    const summaries = [
        { hash: 'b', sourceMessageIds: [20], createdAt: '2026-01-02' },
        { hash: 'c', sourceSortKey: 5, createdAt: '2026-01-03' },
        { hash: 'a', sourceMessageIds: [20], createdAt: '2026-01-01' },
    ];
    assert.equal(metadata.sortSummariesBySource(summaries), summaries);
    assert.deepEqual(summaries.map(summary => summary.hash), ['c', 'a', 'b']);
});

test('prompt renderer replaces metadata placeholders and preserves block material', async () => {
    const { prompts } = await loadPromptAndMetadataModules();
    const blocks = [
        { messageId: 8, title: 'First', content: 'Alpha' },
        { messageId: 12, title: 'Second', content: 'Beta' },
    ];
    const template = 'Range {{sourceRange}} ({{startFloor}}-{{endFloor}})\n{{blocks}}';
    const rendered = prompts.renderGenerationPrompt(template, blocks);

    assert.match(rendered, /Range 楼层 8-12 \(8-12\)/);
    assert.match(rendered, /--- #1 \| message 8 \| First ---\nAlpha/);
    assert.match(rendered, /--- #2 \| message 12 \| Second ---\nBeta/);
    assert.equal((rendered.match(/Alpha/g) || []).length, 1);

    const appended = prompts.renderGenerationPrompt('Summarize this material.', blocks);
    assert.match(appended, /^Summarize this material\.\n\n--- #1/);
});

test('prompt migrations update recognized defaults without overwriting custom text', async () => {
    const { prompts } = await loadPromptAndMetadataModules();
    const stageFallback = 'new stage fallback';
    const epicFallback = 'new epic fallback';

    assert.equal(
        prompts.migrateStagePromptTimeSpan('★ 当前时间点：XXX ☆', stageFallback),
        '★ 时间跨度：XXX-XXX ☆',
    );
    assert.equal(
        prompts.migrateStagePromptTimeSpan('详细提炼本阶段的“起、承、转、合”', stageFallback),
        stageFallback,
    );
    assert.equal(
        prompts.migrateEpicPromptTimeSpan('[事件一名称]：……', epicFallback),
        epicFallback,
    );

    const fallback = 'new built-in prompt';
    const markers = ['built-in heading', 'built-in section'];
    const customized = 'built-in heading\n用户自己写的段落';
    const legacyBuiltIn = 'built-in heading\nbuilt-in section\n➤ 示例\n- 固定示例';
    assert.equal(prompts.migrateBuiltInStructuredPrompt(customized, fallback, markers), customized);
    assert.equal(prompts.migrateBuiltInStructuredPrompt(legacyBuiltIn, fallback, markers), fallback);
});

test('prompt preview and post-processing keep useful structure and remove hidden noise', async () => {
    const { prompts } = await loadPromptAndMetadataModules();
    const excerpt = prompts.getPromptStructureExcerpt(`
Intro
➤ 【剧情长焦】
- 事件 A
  - 经过：发生了什么
……
`);

    assert.match(excerpt, /剧情长焦/);
    assert.match(excerpt, /经过：/);
    assert.doesNotMatch(excerpt, /Intro/);
    assert.equal(
        prompts.stripPostProcessNoise('Before<thinking>secret</thinking><tableEdit>edit</tableEdit>After'),
        'BeforeAfter',
    );
});
