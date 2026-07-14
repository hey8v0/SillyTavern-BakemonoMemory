import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const settingsSource = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');

test('workbench menu branding reuses the clapperboard entry icon', () => {
    assert.match(
        settingsSource,
        /class="bakemono-workbench-menu-mark"[^>]*aria-hidden="true"[^>]*>\s*<i class="fa-solid fa-clapperboard"><\/i>\s*<\/div>/,
    );
    assert.doesNotMatch(settingsSource, /class="bakemono-workbench-menu-mark"[^>]*>\s*剪\s*<\/div>/);
    assert.match(source, /icon\.classList\.add\('fa-solid', 'fa-clapperboard', 'extensionsMenuExtensionButton'\)/);
});

function extractTemplate(name) {
    const marker = `const ${name} = \``;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `${name} should exist`);
    const contentStart = start + marker.length;
    const end = source.indexOf('`;', contentStart);
    assert.notEqual(end, -1, `${name} should be a template literal`);
    return source.slice(contentStart, end);
}

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} should exist`);
    const signatureEnd = source.indexOf(') {', start);
    assert.notEqual(signatureEnd, -1, `${name} should have a function body`);
    const bodyStart = signatureEnd + 2;
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${name}`);
}

function assertContinuationEllipses(prompt) {
    const headings = [...prompt.matchAll(/^➤.*$/gm)];
    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        if (heading[0].includes('第四面墙')) continue;
        const nextStart = headings[index + 1]?.index ?? prompt.length;
        const section = prompt.slice(heading.index, nextStart);
        assert.match(section, /^……$/m, `${heading[0]} should end with a continuation ellipsis`);
    }
}

test('structured prompts use expandable section examples', () => {
    for (const name of [
        'defaultInlineSummaryPrompt',
        'defaultTurnSummaryPrompt',
        'defaultMissingSummaryPrompt',
        'defaultStageGenerationPrompt',
        'defaultEpicGenerationPrompt',
        'defaultStoryGenerationPrompt',
    ]) {
        assertContinuationEllipses(extractTemplate(name));
    }
});

test('stage and multi-summary defaults use the requested event timeline format', () => {
    const stage = extractTemplate('defaultStageGenerationPrompt');
    const epic = extractTemplate('defaultEpicGenerationPrompt');

    assert.match(stage, /➤ 🎞️ 【剧情长焦】（详细提炼本阶段的\[事件\]/);
    assert.match(stage, /- \[事件名称\] \(涵盖的章节跨度 \| 发生时间 \| 发生地点 \| 在场角色\)/);
    assert.match(stage, /经过：用流水账形式清晰记录该事件的起因、经过、结果，保留所有重要动作\/话语\/冲突。/);
    assert.match(stage, /➤ 🎭 【角色进化录】/);
    assert.match(stage, /➤ 🏆 【金句名人堂】（从整篇剧情中挑选出最具代表性、最能定义本卷灵魂的台词）/);
    assert.match(stage, /1\. > “台词1”——【角色名】\n……/);

    assert.match(epic, /➤ 📜 【时间线总览】/);
    assert.match(epic, /- \[事件名称\] \(涵盖的章节跨度 \| 发生时间 \| 发生地点 \| 在场角色\)/);
    assert.match(epic, /关键点：一句话总结该事件对剧情推进或角色关系造成的重大影响\/转折。/);
});

test('structured prompt migration only refreshes recognizable built-in prompts', () => {
    const migrateBuiltInStructuredPrompt = Function(`return (${extractFunction('migrateBuiltInStructuredPrompt')})`)();
    const fallback = 'new built-in prompt';
    const markers = ['built-in heading', 'built-in section'];
    const customized = 'built-in heading\n用户自己写的段落';
    const legacyBuiltIn = 'built-in heading\nbuilt-in section\n➤ 示例\n- 固定示例';

    assert.equal(migrateBuiltInStructuredPrompt(customized, fallback, markers), customized);
    assert.equal(migrateBuiltInStructuredPrompt(legacyBuiltIn, fallback, markers), fallback);
});

test('table rollback plan cascades through newer dependent transactions', () => {
    const buildTableRollbackPlan = Function(`return (${extractFunction('buildTableRollbackPlan')})`)();
    const stack = [
        { id: 'newest', profileKey: 'chat:a', sourceMessageIds: [30], tables: [{ rows: [['before-30']] }] },
        { id: 'affected', profileKey: 'chat:a', sourceMessageIds: [20], tables: [{ rows: [['before-20']] }] },
        { id: 'oldest', profileKey: 'chat:a', sourceMessageIds: [10], tables: [{ rows: [['before-10']] }] },
        { id: 'other-profile', profileKey: 'chat:b', sourceMessageIds: [20], tables: [{ rows: [['other']] }] },
    ];

    const plan = buildTableRollbackPlan(stack, [20], 'chat:a');
    assert.deepEqual(plan.rollbackSnapshotIds, ['newest', 'affected']);
    assert.deepEqual(plan.cascadedSnapshotIds, ['newest']);
    assert.equal(plan.restoreSnapshot.id, 'affected');
    assert.deepEqual(plan.cascadedSourceMessageIds, [30]);
});

test('hot paths use scoped or coalesced rendering', () => {
    const queueStart = source.indexOf('async function processTaskQueue()');
    const queueEnd = source.indexOf('function retryQueueTask', queueStart);
    const queueSource = source.slice(queueStart, queueEnd);
    assert.match(queueSource, /renderTaskQueueProgress\(/);
    assert.doesNotMatch(queueSource, /renderAll\(`正在处理任务/);

    const initStart = source.indexOf('async function init()');
    const initSource = source.slice(initStart);
    assert.match(initSource, /scheduleRenderAll\(\)/);
});

test('closed workbench and background queues avoid heavy DOM rendering', () => {
    const ensureSource = extractFunction('ensureState');
    const renderAllSource = extractFunction('renderAll');
    const queueProgressSource = extractFunction('renderTaskQueueProgress');

    assert.doesNotMatch(ensureSource, /memoryRecords\s*=\s*buildMemoryRecords/);
    assert.match(renderAllSource, /if \(!isWorkbenchOpen\(\)\)/);
    assert.ok(
        renderAllSource.indexOf('if (!isWorkbenchOpen())') < renderAllSource.indexOf('buildMemoryRecords'),
        'renderAll should return before deriving records when the workbench is closed',
    );
    assert.match(renderAllSource, /renderActiveWorkbenchPanel\(/);
    assert.match(queueProgressSource, /if \(!isWorkbenchOpen\(\)\)/);
});

test('large-chat scans avoid quadratic lookup and duplicate opening renders', () => {
    const scanSource = extractFunction('scanBakemonoBlocks');
    const openSource = extractFunction('openWorkbench');

    assert.match(scanSource, /previousBlockByContent\s*=\s*new Map/);
    assert.doesNotMatch(scanSource, /previousBlocks\.find\(/);
    assert.match(scanSource, /preview\.slice\(-maxStoredScanPreviewItems\)/);
    assert.match(openSource, /scanBakemonoBlocks\(\{ persist: false, render: false \}\)/);
    assert.equal((openSource.match(/renderAll\(/g) || []).length, 1);
});

test('state normalization remains compatible with SillyTavern metadata objects', () => {
    const ensureSource = extractFunction('ensureState');
    assert.doesNotMatch(ensureSource, /setTransientStateArray|Object\.defineProperty/);
    assert.doesNotMatch(ensureSource, /normalizedChatStates/);
    assert.match(ensureSource, /state\.memoryRecords = Array\.isArray\(state\.memoryRecords\)/);
    assert.match(ensureSource, /state\.scanPreview = \(Array\.isArray\(state\.scanPreview\)/);
});

test('timeline pagination creates DOM only for the visible page', () => {
    const timelineSource = extractFunction('renderTimeline');
    assert.match(timelineSource, /const rootFactories = \[\]/);
    assert.match(timelineSource, /rootFactories\.slice\(start, start \+ timelinePageSize\)\.map/);
    assert.doesNotMatch(timelineSource, /roots\.push\(make(?:Epic|Stage)Node/);
});

test('every config-bearing tab refreshes its own preset selectors', () => {
    const presetSource = extractFunction('renderActivePresetControls');
    for (const required of [
        "renderPresetControlPair('#bakemono-memory-preset-select', '#bakemono-memory-preset-name')",
        "renderAreaPresetControl(areaPresetScopes.SCAN, '#bakemono-memory-scan-preset-select', '#bakemono-memory-scan-preset-name')",
        "renderAreaPresetControl(areaPresetScopes.AUTOMATION, '#bakemono-memory-automation-preset-select', '#bakemono-memory-automation-preset-name')",
        "renderAreaPresetControl(areaPresetScopes.API, '#bakemono-memory-api-preset-select', '#bakemono-memory-api-preset-name')",
        "renderAreaPresetControl(areaPresetScopes.PROMPTS, '#bakemono-memory-prompts-preset-select', '#bakemono-memory-prompts-preset-name')",
        "renderAreaPresetControl(areaPresetScopes.TURN, '#bakemono-memory-turn-preset-select', '#bakemono-memory-turn-preset-name')",
        "renderAreaPresetControl(areaPresetScopes.INJECTION, '#bakemono-memory-injection-preset-select', '#bakemono-memory-injection-preset-name')",
        "renderAreaPresetControl(areaPresetScopes.VECTOR, '#bakemono-memory-vector-preset-select', '#bakemono-memory-vector-preset-name')",
    ]) {
        assert.ok(presetSource.includes(required), `missing active-tab preset render: ${required}`);
    }
});
