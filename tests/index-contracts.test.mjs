import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const settingsSource = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
const styleSource = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const chatSwitchSource = fs.readFileSync(new URL('../src/core/chat-switch.js', import.meta.url), 'utf8');
const configSyncSource = fs.readFileSync(new URL('../src/core/config-sync.js', import.meta.url), 'utf8');
const promptMigrationsSource = fs.readFileSync(new URL('../src/core/prompt-migrations.js', import.meta.url), 'utf8');
const stateShapeSource = fs.readFileSync(new URL('../src/core/state-shape.js', import.meta.url), 'utf8');
const workflowModeSource = fs.readFileSync(new URL('../src/core/workflow-mode.js', import.meta.url), 'utf8');
const hybridRetrievalSource = fs.readFileSync(new URL('../src/vector/hybrid-retrieval.js', import.meta.url), 'utf8');

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
    assert.match(settingsSource, /class="bakemono-memory-next-kicker">常用工作<\/span>/);
    assert.match(settingsSource, /class="bakemono-memory-status-strip"/);
    assert.match(settingsSource, /class="menu_button bakemono-memory-action-row"/);
    assert.match(settingsSource, /class="menu_button bakemono-memory-action-row bakemono-memory-maintenance-entry"[^>]*data-bakemono-nav="maintenance"/);
    assert.doesNotMatch(settingsSource, /id="bakemono-memory-workflow-description"|class="bakemono-memory-scene-steps"/);
    assert.match(settingsSource, /data-bakemono-tab="settings-hub"/);
    assert.match(settingsSource, /data-bakemono-nav="settings"/);
    assert.match(settingsSource, /data-bakemono-panel="settings"/);
    assert.match(settingsSource, /<option value="backfill">旧正文补课<\/option>/);
    assert.doesNotMatch(settingsSource, /<nav class="bakemono-mobile-actions"/);
    assert.match(source, /primaryButton\.classList\.add\('is-workflow-primary'\)/);
    assert.match(styleSource, /\.bakemono-memory-control-deck \[hidden\]\s*\{[^}]*display:\s*none !important;/s);
    assert.match(styleSource, /\.bakemono-workbench-tabs\s*\{[^}]*scrollbar-width:\s*none;/s);
    assert.match(styleSource, /\.bakemono-mobile-actions,[\s\S]*?display:\s*none !important;/s);
    assert.ok((settingsSource.match(/bakemono-memory-page-intro/g) || []).length >= 16);
    assert.match(styleSource, /Scene workbench aesthetic/);
    assert.match(styleSource, /--bk-display:/);
});

test('settings center owns global preferences while feature settings stay with their tools', () => {
    assert.match(settingsSource, /data-bakemono-nav="generation"[^>]*>[\s\S]*?<strong>默认生成模型<\/strong>/);
    assert.match(settingsSource, /data-bakemono-nav="config"[^>]*>[\s\S]*?<strong>整套配置<\/strong>/);
    assert.match(settingsSource, /data-bakemono-panel="generation"/);
    assert.match(settingsSource, /data-bakemono-panel="config"/);
    assert.match(settingsSource, /data-bakemono-owned-section="database"/);
    assert.match(settingsSource, /data-bakemono-owned-section="batch"/);
    assert.match(settingsSource, /data-bakemono-owned-section="archive"/);
    assert.match(settingsSource, /data-bakemono-owned-section="generation"/);
    assert.match(settingsSource, /data-bakemono-owned-section="config"/);
    assert.match(source, /function organizeWorkbenchOwnedSections\(/);
    assert.match(source, /\['database', 'bakemono-memory-data-status-slot'\]/);
    assert.match(source, /\['batch', 'bakemono-memory-batch-summary-slot'\]/);
    assert.match(source, /\['archive', 'bakemono-memory-floor-archive-slot'\]/);
    assert.match(source, /\['generation', 'bakemono-memory-generation-settings-slot'\]/);
    assert.match(source, /\['config', 'bakemono-memory-config-settings-slot'\]/);
    assert.doesNotMatch(settingsSource, /id="bakemono-memory-undo"|id="bakemono-memory-hide"|id="bakemono-memory-restore"/);
    assert.doesNotMatch(settingsSource, />专家设置</);
});

test('secondary workbench pages install a consistent parent navigation', () => {
    assert.match(source, /const workbenchParentNavigation = Object\.freeze\(\{/);
    assert.match(source, /'turn-summary': \{ target: 'data-hub', label: '返回自动与数据' \}/);
    assert.match(source, /vector: \{ target: 'data-hub', label: '返回自动与数据' \}/);
    assert.match(source, /settings: \{ target: 'settings-hub', label: '返回设置中心' \}/);
    assert.match(source, /prompts: \{ target: 'generation', label: '返回默认生成模型' \}/);
    assert.match(source, /timeline: \{ target: 'preview', label: '返回总结' \}/);
    assert.match(source, /function installWorkbenchParentNavigation\(\)/);
    assert.match(source, /installWorkbenchParentNavigation\(\);/);
    assert.match(styleSource, /\.bakemono-memory-parent-link\s*\{[^}]*min-height:\s*40px;/s);
    assert.match(styleSource, /@media \(max-width: 900px\)[\s\S]*?\.bakemono-memory-parent-link\s*\{[^}]*min-height:\s*44px;/s);
});

test('vector recall uses independent semantic and lexical candidates with explainable scores', () => {
    assert.match(source, /selectHybridCandidates\(scored, queries, keywords/);
    assert.match(source, /keywordBoost:\s*state\.vectorMemory\.keywordBoost/);
    assert.match(source, /lexicalScore:\s*Number/);
    assert.match(source, /matchedTerms:\s*Array\.isArray/);
    assert.match(settingsSource, /混合召回 v2：语义 \+ 稀有词 \+ 关键词/);
    assert.match(source, /title:\s*`混合初筛/);
    assert.match(hybridRetrievalSource, /export function selectHybridCandidates\(/);
    assert.match(hybridRetrievalSource, /vectorRanked/);
    assert.match(hybridRetrievalSource, /lexicalRanked/);
    assert.match(hybridRetrievalSource, /keywordRanked/);
    assert.match(hybridRetrievalSource, /getInverseDocumentFrequency/);
});

test('renderAll only scans heavy block collections and syncs forms for the active page', () => {
    assert.match(source, /function buildWorkbenchBlockBundle\(/);
    assert.match(source, /const blocks = activeTab === 'preview' \|\| activeTab === 'data-hub'/);
    assert.match(source, /function syncActiveWorkbenchFormFields\(activeTab, state/);
    assert.match(source, /if \(activeTab === 'settings'\)/);
    assert.match(source, /else if \(activeTab === 'injection'\)/);
    assert.match(source, /else if \(activeTab === 'prompts'\)/);
    assert.match(source, /else if \(activeTab === 'scan'\)/);
    assert.match(source, /else if \(activeTab === 'automation'\)/);
    assert.match(source, /else if \(activeTab === 'preview'\)/);
    assert.match(source, /else if \(activeTab === 'generation'\)/);
    assert.match(source, /else if \(tabName === 'vector'\) \{\s*renderVectorMemoryPanel\(state\)/s);
    assert.match(source, /function renderWorkbenchOverviewMemory\(state\) \{\s*state\.memoryRecords = buildMemoryRecords\(state\);\s*renderWorkflowGuide\(state\)/s);
    assert.match(source, /renderActiveWorkbenchPanel\(activeTab, state, blocks\)/);
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
    assert.equal((settingsSource.match(/class="bakemono-memory-help-trigger"/g) || []).length, 12);
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

test('floor memory orchestration stays derived and the base ledger remains optional', () => {
    assert.match(source, /import \{ buildFloorMemoryIndex, createMemoryOrchestrationPlan \}/);
    assert.match(source, /async function runMemoryOrchestrator\(/);
    assert.match(source, /event_types\.MESSAGE_RECEIVED, async \(\) => \{\s*await runMemoryOrchestrator/s);
    assert.match(settingsSource, /id="bakemono-memory-index-ready-floor"/);
    assert.match(settingsSource, /id="bakemono-memory-index-pending-count"/);
    assert.match(settingsSource, /id="bakemono-memory-create-base-ledger"/);
    assert.match(settingsSource, /不会加入事件摘要或大总结表/);
    assert.doesNotMatch(source, /floorMemoryIndex\s*:/);
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

test('structured prompt migration only refreshes recognizable built-in prompts', async () => {
    const metadataSource = fs.readFileSync(new URL('../src/summary/source-metadata.js', import.meta.url), 'utf8');
    const metadataUrl = `data:text/javascript;base64,${Buffer.from(metadataSource, 'utf8').toString('base64')}`;
    const promptSource = fs.readFileSync(new URL('../src/shared/prompt-utils.js', import.meta.url), 'utf8')
        .replace("'../summary/source-metadata.js'", `'${metadataUrl}'`);
    const promptUrl = `data:text/javascript;base64,${Buffer.from(promptSource, 'utf8').toString('base64')}`;
    const { migrateBuiltInStructuredPrompt } = await import(promptUrl);
    const fallback = 'new built-in prompt';
    const markers = ['built-in heading', 'built-in section'];
    const customized = 'built-in heading\n用户自己写的段落';
    const legacyBuiltIn = 'built-in heading\nbuilt-in section\n➤ 示例\n- 固定示例';

    assert.equal(migrateBuiltInStructuredPrompt(customized, fallback, markers), customized);
    assert.equal(migrateBuiltInStructuredPrompt(legacyBuiltIn, fallback, markers), fallback);
});

test('prompt migration orchestration stays outside the entry state adapter', () => {
    const ensureSource = extractFunction('ensureState');
    const settingsSource = extractFunction('ensureGlobalSettings');

    assert.match(source, /from '.\/src\/core\/prompt-migrations\.js'/);
    assert.match(ensureSource, /migrateGenerationPrompts\(state\.generationPrompts/);
    assert.match(ensureSource, /migrateTurnSummaryPrompt\(state\.turnSummary/);
    assert.match(ensureSource, /migrateInlineSummaryPrompt\(state\.inlineGeneration/);
    assert.match(ensureSource, /migrateVectorQueryRewritePrompt\(state\.vectorMemory/);
    assert.match(settingsSource, /migratePromptPresetTimelines\(preset/);
    assert.doesNotMatch(ensureSource, /可以不用 <bakemono> 标签，也不用 HTML|only\\s\+output\\s\+the\\s\+queries/);
    assert.match(promptMigrationsSource, /const storyPromptMarkers = \[/);
    assert.match(promptMigrationsSource, /const legacyVectorQueryRewritePattern =/);
});

test('table rollback plan cascades through newer dependent transactions', async () => {
    const moduleSource = fs.readFileSync(new URL('../src/tables/rollback-plan.js', import.meta.url), 'utf8');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, 'utf8').toString('base64')}`;
    const { buildTableRollbackPlan } = await import(moduleUrl);
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
    const scopedRenderSource = extractFunction('renderWorkbenchScope');
    const queueProgressSource = extractFunction('renderTaskQueueProgress');

    assert.doesNotMatch(ensureSource, /memoryRecords\s*=\s*buildMemoryRecords/);
    assert.match(renderAllSource, /if \(!isWorkbenchOpen\(\)\)/);
    assert.ok(
        renderAllSource.indexOf('if (!isWorkbenchOpen())') < renderAllSource.indexOf('buildMemoryRecords'),
        'renderAll should return before deriving records when the workbench is closed',
    );
    assert.match(renderAllSource, /renderActiveWorkbenchPanel\(/);
    assert.match(scopedRenderSource, /if \(!isWorkbenchOpen\(\)\)/);
    assert.match(queueProgressSource, /renderWorkbenchScope\(workbenchRenderScopes\.DRAFTS/);
});

test('vector, draft, and table actions use page-scoped rendering', () => {
    const scopedRenderSource = extractFunction('renderWorkbenchScope');
    assert.doesNotMatch(scopedRenderSource, /renderAll\(/);
    assert.match(scopedRenderSource, /scope === workbenchRenderScopes\.VECTOR/);
    assert.match(scopedRenderSource, /renderVectorMemoryPanel\(state\)/);
    assert.match(scopedRenderSource, /scope === workbenchRenderScopes\.DRAFTS/);
    assert.match(scopedRenderSource, /renderDrafts\(\)[\s\S]*renderHistory\(\)[\s\S]*renderTaskQueue\(\)/);
    assert.match(scopedRenderSource, /scope === workbenchRenderScopes\.TABLES/);
    assert.match(scopedRenderSource, /renderTurnSummaryPanel\(state\)/);

    for (const [name, scope] of [
        ['buildVectorMemoryIndex', 'VECTOR'],
        ['applyVectorMemorySettings', 'VECTOR'],
        ['testVectorMemoryRetrieval', 'VECTOR'],
        ['clearVectorMemoryIndex', 'VECTOR'],
        ['commitDraft', 'DRAFTS'],
        ['discardDraft', 'DRAFTS'],
        ['regenerateDraft', 'DRAFTS'],
        ['undoLastCommit', 'DRAFTS'],
        ['undoLastTableOperation', 'TABLES'],
        ['redoLastTableOperation', 'TABLES'],
        ['createCustomTableFromUi', 'TABLES'],
    ]) {
        const functionSource = extractFunction(name);
        assert.match(functionSource, new RegExp(`renderWorkbenchScope\\(workbenchRenderScopes\\.${scope}`), `${name} should use ${scope} scoped rendering`);
        assert.doesNotMatch(functionSource, /renderAll\(/, `${name} should not refresh the whole workbench`);
    }
});

test('all business mutations use scoped rendering and reserve renderAll for lifecycle entry points', () => {
    const scopedRenderSource = extractFunction('renderWorkbenchScope');
    const summarySurfaceSource = extractFunction('renderWorkbenchSummarySurface');
    const actionScopeSource = extractFunction('getWorkbenchActionRenderScope');

    for (const scope of [
        'SUMMARY',
        'SCAN',
        'ARCHIVE',
        'INJECTION',
        'AUTOMATION',
        'PROMPTS',
        'GENERATION',
        'CONFIG',
        'SETTINGS',
    ]) {
        assert.match(scopedRenderSource, new RegExp(`workbenchRenderScopes\\.${scope}`), `missing ${scope} render branch`);
    }
    assert.match(summarySurfaceSource, /activeTab === 'preview'/);
    assert.match(summarySurfaceSource, /activeTab === 'records'/);
    assert.match(summarySurfaceSource, /activeTab === 'drafts'/);
    assert.match(actionScopeSource, /startsWith\('vector-'\)/);
    assert.match(actionScopeSource, /'generate-stage'/);
    assert.match(actionScopeSource, /'hide-before-recent'/);

    const renderAllOccurrences = source.match(/\brenderAll\(/g) || [];
    assert.equal(renderAllOccurrences.length, 5, 'renderAll should remain only as one definition and four lifecycle calls');
    for (const name of [
        'scanBakemonoBlocks',
        'generateStageSummary',
        'generateEpicSummary',
        'generateStageBatchTasks',
        'generateEpicBatchTasks',
        'generateMissingSummaryQueue',
        'maybeRunAutoSummary',
        'runGeneration',
        'rollbackAutoSummaryTransaction',
        'saveEditedSummary',
        'deleteSavedSummary',
        'hideCoveredMessages',
        'restoreHiddenMessages',
        'applyWorkflowPreset',
        'applyPromptPresetToState',
        'renderAreaPresetChange',
        'bindSettingsEvents',
    ]) {
        assert.doesNotMatch(extractFunction(name), /\brenderAll\(/, `${name} should not refresh the whole workbench`);
    }
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
    assert.match(source, /from '.\/src\/core\/state-shape\.js'/);
    assert.match(ensureSource, /fillMissingDefaults\(state, defaultState\)/);
    assert.match(ensureSource, /normalizeArrayFields\(state, \['drafts', 'history', 'taskQueue', 'autoSummaryTransactions', 'memoryRecords'\]\)/);
    assert.match(ensureSource, /ensureObjectField\(state, 'automation', defaultAutomation\)/);
    assert.match(ensureSource, /state\.scanPreview = \(Array\.isArray\(state\.scanPreview\)/);
    assert.match(stateShapeSource, /target\[key\] === undefined/);
    assert.match(stateShapeSource, /target\[key\] = structuredClone\(value\)/);
    assert.match(stateShapeSource, /!current \|\| typeof current !== 'object'/);
    assert.match(stateShapeSource, /target\[key\] = structuredClone\(defaultValue\)/);
    assert.match(stateShapeSource, /target\[key\] = Array\.isArray\(target\[key\]\) \? target\[key\] : \[\]/);
    assert.match(source, /from '.\/src\/core\/workflow-mode\.js'/);
    assert.match(ensureSource, /normalizeWorkflowState\(state\)/);
    assert.doesNotMatch(ensureSource, /Object\.values\(memoryStrategies\)\.includes\(state\.memoryStrategy\)/);
    assert.match(workflowModeSource, /state\.workflowMode = state\.memoryStrategy === memoryStrategies\.GENERIC/);
    assert.match(workflowModeSource, /state\.stageSourceMode = state\.workflowMode === workflowModes\.GENERIC/);
    assert.match(workflowModeSource, /state\.outputMode = state\.workflowMode === workflowModes\.GENERIC/);
});

test('persistence reads the current chat at save time and keeps tavern debounced adapters', () => {
    const chatSaveSource = extractFunction('saveState');
    const globalSaveSource = extractFunction('saveGlobalSettings');

    assert.match(source, /from '.\/src\/core\/persistence\.js'/);
    assert.match(source, /from '.\/src\/vector\/storage\.js'/);
    assert.match(chatSaveSource, /persistChatState\(chat_metadata\?\.\[STORAGE_KEY\] \|\| null/);
    assert.match(chatSaveSource, /slimVectorMemoryForSave\(state\?\.vectorMemory, defaultVectorMemory\)/);
    assert.match(chatSaveSource, /save:\s*saveMetadataDebounced/);
    assert.match(globalSaveSource, /persistGlobalSettings\(saveSettingsDebounced\)/);
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
    assert.match(settingsSource, /data-bakemono-nav="appearance"/);
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
    assert.match(source, /from '.\/src\/core\/config-sync\.js'/);
    assert.match(configSyncSource, /export function getActiveConfigSignature\(/);
    assert.match(configSyncSource, /export function shouldSyncActiveConfig\(/);
    assert.match(source, /function syncGlobalActiveConfigToState\(/);
    assert.match(source, /syncGlobalActiveConfigToState\(initialState, \{ force: true \}\)/);
    assert.match(source, /syncConfig:\s*state => \{/);
    assert.match(source, /if \(state\.automation\.apiProvider !== 'custom'\) \{\s*return await generateRaw/s);
    assert.match(configSyncSource, /state\.activeConfigSignature = getActiveConfigSignature/);
});

test('saved settings become shared defaults while vector runtime remains chat-local', () => {
    assert.match(source, /function persistSharedConfigurationFromState\(/);
    assert.match(source, /vectorMemory:\s*createSharedVectorConfig\(state\.vectorMemory/);
    assert.match(source, /mergeSharedVectorConfig\(state\.vectorMemory, preset\.vectorMemory, defaultVectorMemory\)/);
    assert.match(source, /syncGlobalActiveConfigToState\(initialState, \{ force: true \}\)/);
    assert.match(source, /syncConfig:\s*state => \{/);
    const vectorPersist = extractFunction('persistVectorMemoryFieldsFromUi');
    const vectorApply = extractFunction('applyVectorMemorySettings');
    assert.match(vectorPersist, /persistSharedConfigurationFromState\(state/);
    assert.match(vectorApply, /persistSharedConfigurationFromState\(state/);
});

test('first shared-settings upgrade preserves the current chat before forced synchronization', () => {
    assert.match(source, /function bootstrapSharedConfigurationFromCurrentChat\(/);
    assert.match(source, /shouldBootstrapSharedConfig\(settings, hasActiveChat\)/);
    assert.match(source, /settings\.sharedConfigVersion = sharedConfigVersion/);
    assert.match(source, /const initialState = ensureState\(\);[\s\S]*?bootstrapSharedConfigurationFromCurrentChat\(initialState\);[\s\S]*?syncGlobalActiveConfigToState\(initialState, \{ force: true \}\)/);
    assert.match(source, /syncConfig:\s*state => \{[\s\S]*?bootstrapSharedConfigurationFromCurrentChat\(state\);[\s\S]*?return syncGlobalActiveConfigToState\(state, \{ force: true \}\);[\s\S]*?\}/);
});

test('chat changes keep their side effects in one ordered coordinator', () => {
    assert.match(source, /from '.\/src\/core\/chat-switch\.js'/);
    assert.match(source, /eventSource\.on\(event_types\.CHAT_CHANGED, \(\) => runChatSwitchFlow\(\{/);
    assert.match(source, /getState:\s*ensureState/);
    assert.match(source, /scheduleAutoHide:\s*scheduleAutoHideRecent/);
    assert.match(source, /markVectorDirty:\s*markVectorIndexDirty/);
    assert.match(source, /syncInjection,\s*scheduleRender:\s*scheduleRenderAll/);
    assert.match(
        chatSwitchSource,
        /flow\.syncConfig\(state\)[\s\S]*flow\.scheduleAutoHide\(chatSwitchReasons\.autoHide\)[\s\S]*flow\.markVectorDirty\(chatSwitchReasons\.vectorDirty\)[\s\S]*flow\.syncInjection\(\)[\s\S]*flow\.scheduleRender\(\)/,
    );
});

test('vector model fetch preserves unsaved fields and reports failures accurately', () => {
    const operationSource = extractFunction('runVisibleOperation');
    const persistSource = extractFunction('persistVectorMemoryFieldsFromUi');
    const actionSource = extractFunction('runWorkbenchAction');
    const embeddingSource = extractFunction('fetchVectorEmbeddingModels');
    const querySource = extractFunction('fetchVectorQueryModels');

    assert.doesNotMatch(operationSource, /renderAll\(/);
    assert.match(persistSource, /readVectorMemoryFieldsFromUi\(state\)/);
    assert.match(persistSource, /persistSharedConfigurationFromState\(state\)/);
    assert.equal((actionSource.match(/persistVectorMemoryFieldsFromUi\(\)/g) || []).length, 2);
    assert.match(embeddingSource, /if \(!baseUrl\)[\s\S]*?return false;/);
    assert.match(querySource, /if \(!baseUrl\)[\s\S]*?return false;/);
    assert.match(embeddingSource, /return true;[\s\S]*?catch \(error\)[\s\S]*?return false;/);
    assert.match(querySource, /return true;[\s\S]*?catch \(error\)[\s\S]*?return false;/);
});
