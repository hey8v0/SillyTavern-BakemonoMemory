import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const settingsSource = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
const styleSource = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('workbench markup and stylesheet remain structurally balanced', () => {
    const ids = [...settingsSource.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const containerOpenCount = (settingsSource.match(/<(?:section|div|header|nav|main|article|details)(?:\s|>)/g) || []).length;
    const containerCloseCount = (settingsSource.match(/<\/(?:section|div|header|nav|main|article|details)>/g) || []).length;
    const cssBraceDelta = (styleSource.match(/\{/g) || []).length - (styleSource.match(/\}/g) || []).length;

    assert.deepEqual(duplicateIds, []);
    assert.equal(containerOpenCount, containerCloseCount);
    assert.equal(cssBraceDelta, 0);
});

test('workbench menu branding reuses the clapperboard entry icon', () => {
    assert.match(
        settingsSource,
        /class="bakemono-workbench-menu-mark"[^>]*aria-hidden="true"[^>]*>\s*<i class="fa-solid fa-clapperboard"><\/i>\s*<\/div>/,
    );
    assert.doesNotMatch(settingsSource, /class="bakemono-workbench-menu-mark"[^>]*>\s*剪\s*<\/div>/);
    assert.match(source, /icon\.classList\.add\('fa-solid', 'fa-clapperboard', 'extensionsMenuExtensionButton'\)/);
});

test('mobile header keeps one compact static injection state', () => {
    assert.match(settingsSource, /id="bakemono-memory-injection-badge"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.doesNotMatch(settingsSource, /bakemono-workbench-context-trigger|bakemono-workbench-context-popover|bakemono-workbench-context-caret/);
    assert.match(source, /function getWorkbenchPanelShortKicker\(/);
    assert.match(source, /short: '注入开'/);
    assert.match(source, /short: '注入空'/);
    assert.match(source, /short: '注入关'/);
    assert.doesNotMatch(source, /function setWorkbenchContextOpen\(/);
    assert.match(styleSource, /grid-template-rows:\s*70px minmax\(0, 1fr\)/);
    assert.match(styleSource, /\.bakemono-workbench-header\s*\{[^}]*min-height:\s*70px;/s);
    assert.match(styleSource, /#bakemono-workbench-section-title\s*\{[^}]*display:\s*none;/s);
    assert.match(styleSource, /\.bakemono-workbench-kicker-short\s*\{[^}]*display:\s*inline;/s);
});

test('scene workbench keeps the mobile hierarchy compact', () => {
    assert.match(settingsSource, /class="bakemono-memory-scene-meta"/);
    assert.match(settingsSource, /class="bakemono-memory-next-kicker">剧情剪辑<\/span>/);
    assert.match(settingsSource, /class="bakemono-memory-status-strip"/);
    assert.match(settingsSource, /class="menu_button bakemono-memory-action-row"/);
    assert.match(settingsSource, /class="bakemono-memory-console-disclosure bakemono-memory-maintenance-actions"/);
    assert.doesNotMatch(settingsSource, /id="bakemono-memory-workflow-description"|class="bakemono-memory-scene-steps"/);
    assert.match(settingsSource, /data-bakemono-tab="settings"/);
    assert.match(settingsSource, /data-bakemono-panel="settings"/);
    assert.match(settingsSource, /<option value="backfill">旧正文补课<\/option>/);
    assert.doesNotMatch(settingsSource, /<nav class="bakemono-mobile-actions"/);
    assert.match(source, /button\.classList\.toggle\('is-workflow-primary', !!isPrimary\)/);
    assert.match(styleSource, /\.bakemono-memory-control-deck \[hidden\]\s*\{[^}]*display:\s*none !important;/s);
    assert.match(styleSource, /\.bakemono-workbench-tabs\s*\{[^}]*scrollbar-width:\s*none;/s);
    assert.match(styleSource, /\.bakemono-mobile-actions,[\s\S]*?display:\s*none !important;/s);
    assert.equal((settingsSource.match(/bakemono-memory-page-intro/g) || []).length, 14);
    assert.match(styleSource, /Scene workbench aesthetic/);
    assert.match(styleSource, /--bk-display:/);
});

test('phone typography restores a semantic 12, 13, and 14px hierarchy', () => {
    assert.match(styleSource, /v1\.2\.3 mobile refinement/);
    assert.match(styleSource, /--bk-type-meta:\s*12px/);
    assert.match(styleSource, /--bk-type-copy:\s*13px/);
    assert.match(styleSource, /--bk-type-label:\s*14px/);
    assert.match(styleSource, /\.bakemono-memory-record-main strong\s*\{[^}]*font-size:\s*var\(--bk-type-label\)\s*!important;/s);
    assert.match(styleSource, /\.bakemono-memory-page-intro p,[\s\S]*?font-size:\s*13px\s*!important;/s);
    assert.match(styleSource, /\.bakemono-memory-timeline-meta,[\s\S]*?font-size:\s*12px\s*!important;/s);
});

test('expanded disclosures expose anchored help and important operations expose live feedback', () => {
    assert.equal((settingsSource.match(/class="bakemono-memory-help-trigger"/g) || []).length, 10);
    assert.match(settingsSource, /class="bakemono-memory-help-content"/);
    assert.match(source, /function toggleWorkbenchHelpPopover\(/);
    assert.match(source, /function positionWorkbenchHelpPopover\(/);
    assert.match(source, /event\.key === 'Escape'/);
    assert.match(styleSource, /details\[open\] > summary > \.bakemono-memory-help-trigger\s*\{[^}]*display:\s*inline-flex;/s);
    assert.match(styleSource, /\.bakemono-memory-help-popover::before/);
    assert.match(source, /toast\.setAttribute\('role', 'status'\)/);
    assert.match(source, /toast\.setAttribute\('aria-live', 'polite'\)/);
    assert.match(source, /setOperationFeedback\('success'/);
    assert.match(source, /setOperationFeedback\('error'/);
});

test('summary page keeps generation, review, and filtering in the demo hierarchy', () => {
    assert.equal((settingsSource.match(/data-bakemono-summary-mode=/g) || []).length, 3);
    assert.match(settingsSource, /id="bakemono-memory-summary-primary-action"[^>]*data-bakemono-action="generate-stage"/);
    assert.match(settingsSource, /class="bakemono-memory-section-head bakemono-memory-summary-list-head"/);
    assert.match(settingsSource, /class="bakemono-memory-console-disclosure bakemono-memory-preview-filter-disclosure"/);
    assert.match(source, /function renderSummaryGenerationPanel\(/);
    assert.match(source, /renderSummaryGenerationPanel\(state, blocks\)/);
    assert.match(styleSource, /Summary demo precision pass/);
});

test('archive and timeline pages keep the demo hierarchy without dropping controls', () => {
    assert.match(settingsSource, /class="bakemono-memory-record-search"/);
    assert.match(settingsSource, /data-bakemono-record-status="all"/);
    assert.match(settingsSource, /id="bakemono-memory-record-stat-total"/);
    assert.match(settingsSource, /class="bakemono-memory-record-filter-disclosure/);
    assert.match(settingsSource, /id="bakemono-memory-record-kind"/);
    assert.match(settingsSource, /id="bakemono-memory-record-status"/);
    assert.match(settingsSource, /class="bakemono-memory-timeline-overview"/);
    assert.match(settingsSource, /id="bakemono-memory-timeline-epic-count"/);
    assert.match(source, /className = 'bakemono-memory-timeline-copy'/);
    assert.match(source, /if \(kind === 'epic'\) \{\s*details\.open = true;/);
    assert.doesNotMatch(source, /if \(kind !== 'story'\) \{\s*details\.open = true;/);
});

test('review desk keeps drafts first while preserving task and history operations', () => {
    assert.match(settingsSource, /data-bakemono-review-view="drafts"/);
    assert.match(settingsSource, /data-bakemono-review-view="tasks"/);
    assert.match(settingsSource, /data-bakemono-review-view="history"/);
    assert.match(settingsSource, /data-bakemono-review-panel="drafts"[^>]*role="tabpanel"/);
    assert.match(settingsSource, /data-bakemono-action="clear-queue"/);
    assert.match(settingsSource, /data-bakemono-action="undo"/);
    assert.match(settingsSource, /data-bakemono-action="clear-history"/);
    assert.match(source, /function renderReviewPanelTabs/);
    assert.match(source, /data-bakemono-draft-editor-toggle/);
    assert.match(source, /bakemono-memory-draft-editor-disclosure/);
    assert.match(source, /data-bakemono-draft-action="commit"/);
    assert.match(source, /data-bakemono-draft-action="regenerate"/);
    assert.match(source, /data-bakemono-draft-action="discard"/);
});

test('automatic memory and tables keep the demo status-first hierarchy', () => {
    assert.match(settingsSource, /class="bakemono-memory-turn-status-hero bakemono-turn-panel-card"/);
    assert.match(settingsSource, /id="bakemono-memory-turn-flow-read"/);
    assert.match(settingsSource, /class="bakemono-memory-turn-settings/);
    assert.match(settingsSource, /id="bakemono-memory-table-overview-count"/);
    assert.match(settingsSource, /class="bakemono-memory-table-diff-head/);
    assert.match(settingsSource, /id="bakemono-memory-table-draft-list"/);
    assert.match(settingsSource, /class="[^"]*bakemono-memory-table-maintenance/);
    assert.match(source, /bakemono-memory-turn-runtime-label/);
    assert.match(source, /bakemono-memory-table-overview-draft-count/);
    assert.match(source, /className = 'bakemono-memory-table-diff-list'/);
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

test('custom themes stay token-only, global, and importable as JSON', () => {
    assert.match(settingsSource, /data-bakemono-tab="appearance"/);
    assert.match(settingsSource, /data-bakemono-panel="appearance"/);
    assert.match(settingsSource, /id="bakemono-memory-theme-json"/);
    assert.match(settingsSource, /id="bakemono-memory-theme-file"[^>]*accept="application\/json,\.json"/);
    assert.match(settingsSource, /id="bakemono-memory-theme-preset-select"/);
    assert.match(settingsSource, /id="bakemono-memory-theme-save-as"/);
    assert.match(settingsSource, /id="bakemono-memory-theme-download-library"/);
    assert.equal((settingsSource.match(/data-bakemono-theme-section-panel=/g) || []).length, 3);
    assert.match(source, /const CUSTOM_THEME_SCHEMA = 'bakemono-memory-theme\/v1'/);
    assert.match(source, /const CUSTOM_THEME_LIBRARY_SCHEMA = 'bakemono-memory-theme-library\/v1'/);
    assert.match(source, /function sanitizeCustomTheme\(/);
    assert.match(source, /function applyAppearanceTheme\(/);
    assert.match(source, /function downloadCustomThemeJson\(/);
    assert.match(source, /function downloadCustomThemeLibraryJson\(/);
    assert.match(source, /function importCustomThemeJson\(/);
    assert.match(source, /settings\.ui\.customTheme = sanitizeCustomTheme/);
    assert.match(source, /settings\.ui\.themePresets = settings\.ui\.themePresets\.map/);
    assert.match(styleSource, /\.bakemono-workbench-root\.bakemono-custom-theme/);
    assert.match(styleSource, /v1\.2\.5 compact theme library/);
    assert.match(styleSource, /\.bakemono-memory-theme-section-panel\[hidden\]\s*\{[^}]*display:\s*none !important;/s);
});

test('active global config follows existing chats without removing the tavern model path', () => {
    assert.match(source, /function getActiveGlobalConfigSignature\(/);
    assert.match(source, /function syncGlobalActiveConfigToState\(/);
    assert.equal((source.match(/syncGlobalActiveConfigToState\(ensureState\(\)\)/g) || []).length, 2);
    assert.match(source, /if \(state\.automation\.apiProvider !== 'custom'\) \{\s*return await generateRaw/s);
    assert.match(source, /state\.activeConfigSignature = getActiveGlobalConfigSignature/);
});
