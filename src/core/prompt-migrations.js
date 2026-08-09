const storyPromptMarkers = [
    '# 👾旧正文补课摘要模式！',
    '➤ 🎬 【场记打板】（流水账形式记录本批次已经发生的全部事件',
    '➤ 💡 【第四面墙】（用👾视角记录角色不知道',
];

const missingPromptMarkers = [
    '你是剧情剪辑台的缺失摘要补写器',
    '每个楼层必须严格使用以下格式',
    '➤ 🪢 【剧本暗线】（伏笔系统',
];

const turnSummaryPromptMarkers = [
    '你是剧情剪辑台的正文摘要器',
    '输出必须放在 <summaryDraft>',
    '➤ 🎙️ 【高光收音】',
];

const inlineSummaryPromptMarkers = [
    '请在本次回复正文结束后',
    '推荐格式：',
    '<summary>📋 剧情摘要</summary>',
];

const legacyVectorQueryRewritePattern = /JSON\s*字符串数组|JSON\s*对象|3\s*到\s*5\s*条.*中文查询句|一个检索意图\s*\+\s*3\s*到\s*5\s*条|适合检索旧剧情记忆|recent\s+plot|old\s+memories|create\s+queries|only\s+output\s+the\s+queries/i;

export function migrateGenerationPrompts(prompts, defaults, migrations) {
    const {
        migrateBuiltInStructuredPrompt,
        migrateEpicPromptTimeSpan,
        migrateStagePromptTimeSpan,
    } = migrations;

    if (String(prompts.story || '').includes('请把以下聊天正文压缩成一个可继续用于后续阶段总结的剧情摘要')) {
        prompts.story = defaults.story;
    }
    if (
        String(prompts.story || '').includes('旧正文补课摘要模式')
        && String(prompts.story || '').includes('第x章：旧正文补课')
        && !String(prompts.story || '').includes('{{suggestedTitle}}')
    ) {
        prompts.story = defaults.story;
    }
    if (String(prompts.story || '').includes('可以不用 <bakemono> 标签，也不用 HTML')) {
        prompts.story = defaults.genericStory;
        prompts.missing = defaults.missing;
        prompts.stage = defaults.genericStage;
        prompts.epic = defaults.genericEpic;
    }
    prompts.stage = migrateStagePromptTimeSpan(prompts.stage, defaults.stage);
    prompts.epic = migrateEpicPromptTimeSpan(prompts.epic, defaults.epic);
    prompts.story = migrateBuiltInStructuredPrompt(prompts.story, defaults.story, storyPromptMarkers);
    prompts.missing = migrateBuiltInStructuredPrompt(prompts.missing, defaults.missing, missingPromptMarkers);
    return prompts;
}

export function migrateTurnSummaryPrompt(turnSummary, fallback, migrateBuiltInStructuredPrompt) {
    turnSummary.prompt = migrateBuiltInStructuredPrompt(turnSummary.prompt, fallback, turnSummaryPromptMarkers);
    return turnSummary;
}

export function migrateInlineSummaryPrompt(inlineGeneration, fallback, migrateBuiltInStructuredPrompt) {
    inlineGeneration.summaryPrompt = migrateBuiltInStructuredPrompt(
        inlineGeneration.summaryPrompt,
        fallback,
        inlineSummaryPromptMarkers,
    );
    return inlineGeneration;
}

export function migrateVectorQueryRewritePrompt(vectorMemory, fallback) {
    if (legacyVectorQueryRewritePattern.test(String(vectorMemory.queryRewritePrompt || ''))) {
        vectorMemory.queryRewritePrompt = fallback;
    }
    return vectorMemory;
}

export function migratePromptPresetTimelines(preset, defaults, migrations) {
    if (preset.stage !== undefined) {
        preset.stage = migrations.migrateStagePromptTimeSpan(preset.stage, defaults.stage);
    }
    if (preset.epic !== undefined) {
        preset.epic = migrations.migrateEpicPromptTimeSpan(preset.epic, defaults.epic);
    }
    return preset;
}
