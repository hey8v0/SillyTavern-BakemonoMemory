import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../', import.meta.url);

function toDataModule(source) {
    return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function loadModule(path) {
    const source = await readFile(new URL(path, repoUrl), 'utf8');
    return await import(toDataModule(source));
}

const defaults = {
    story: 'story-default',
    genericStory: 'generic-story-default',
    missing: 'missing-default',
    stage: 'stage-default',
    genericStage: 'generic-stage-default',
    epic: 'epic-default',
    genericEpic: 'generic-epic-default',
};

function structuredMigration(value, fallback, markers) {
    return markers.every(marker => String(value).includes(marker)) ? fallback : value;
}

test('generation prompt migration preserves its original ordered legacy fallbacks', async () => {
    const migrations = await loadModule('src/core/prompt-migrations.js');
    const prompts = {
        story: '旧正文补课摘要模式\n第x章：旧正文补课',
        missing: 'custom-missing',
        stage: 'old-stage',
        epic: 'old-epic',
    };

    const result = migrations.migrateGenerationPrompts(prompts, defaults, {
        migrateStagePromptTimeSpan: value => value === 'old-stage' ? 'stage-migrated' : value,
        migrateEpicPromptTimeSpan: value => value === 'old-epic' ? 'epic-migrated' : value,
        migrateBuiltInStructuredPrompt: structuredMigration,
    });

    assert.equal(result, prompts);
    assert.deepEqual(prompts, {
        story: 'story-default',
        missing: 'custom-missing',
        stage: 'stage-migrated',
        epic: 'epic-migrated',
    });
});

test('generic legacy story switches the same four prompts before later migrations', async () => {
    const migrations = await loadModule('src/core/prompt-migrations.js');
    const prompts = {
        story: '可以不用 <bakemono> 标签，也不用 HTML',
        missing: 'old-missing',
        stage: 'old-stage',
        epic: 'old-epic',
    };

    migrations.migrateGenerationPrompts(prompts, defaults, {
        migrateStagePromptTimeSpan: value => value,
        migrateEpicPromptTimeSpan: value => value,
        migrateBuiltInStructuredPrompt: structuredMigration,
    });

    assert.deepEqual(prompts, {
        story: 'generic-story-default',
        missing: 'missing-default',
        stage: 'generic-stage-default',
        epic: 'generic-epic-default',
    });
});

test('turn and inline migration replace only recognizable built-in structures', async () => {
    const migrations = await loadModule('src/core/prompt-migrations.js');
    const turn = {
        prompt: '你是剧情剪辑台的正文摘要器\n输出必须放在 <summaryDraft>\n➤ 🎙️ 【高光收音】',
    };
    const inline = { summaryPrompt: '我的自定义随正文提示词' };

    migrations.migrateTurnSummaryPrompt(turn, 'turn-default', structuredMigration);
    migrations.migrateInlineSummaryPrompt(inline, 'inline-default', structuredMigration);

    assert.equal(turn.prompt, 'turn-default');
    assert.equal(inline.summaryPrompt, '我的自定义随正文提示词');
});

test('vector and preset migrations keep custom values and undefined preset fields intact', async () => {
    const migrations = await loadModule('src/core/prompt-migrations.js');
    const legacyVector = { queryRewritePrompt: 'only output the queries as a JSON 字符串数组' };
    const customVector = { queryRewritePrompt: '只输出我的自定义检索问题' };
    const preset = { stage: undefined, epic: 'old-epic' };

    migrations.migrateVectorQueryRewritePrompt(legacyVector, 'vector-default');
    migrations.migrateVectorQueryRewritePrompt(customVector, 'vector-default');
    migrations.migratePromptPresetTimelines(preset, { stage: 'stage-default', epic: 'epic-default' }, {
        migrateStagePromptTimeSpan: () => 'should-not-run',
        migrateEpicPromptTimeSpan: value => `${value}-migrated`,
    });

    assert.equal(legacyVector.queryRewritePrompt, 'vector-default');
    assert.equal(customVector.queryRewritePrompt, '只输出我的自定义检索问题');
    assert.equal(preset.stage, undefined);
    assert.equal(preset.epic, 'old-epic-migrated');
});
