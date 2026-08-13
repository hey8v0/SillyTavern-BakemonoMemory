import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const settingsSource = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
const styleSource = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const chatSwitchSource = fs.readFileSync(new URL('../src/core/chat-switch.js', import.meta.url), 'utf8');
const configSyncSource = fs.readFileSync(new URL('../src/core/config-sync.js', import.meta.url), 'utf8');
const chatStateServiceSource = fs.readFileSync(new URL('../src/core/chat-state-service.js', import.meta.url), 'utf8');
const globalSettingsServiceSource = fs.readFileSync(new URL('../src/core/global-settings-service.js', import.meta.url), 'utf8');
const promptMigrationsSource = fs.readFileSync(new URL('../src/core/prompt-migrations.js', import.meta.url), 'utf8');
const stateShapeSource = fs.readFileSync(new URL('../src/core/state-shape.js', import.meta.url), 'utf8');
const workflowModeSource = fs.readFileSync(new URL('../src/core/workflow-mode.js', import.meta.url), 'utf8');
const hybridRetrievalSource = fs.readFileSync(new URL('../src/vector/hybrid-retrieval.js', import.meta.url), 'utf8');
const promptInspectorSource = fs.readFileSync(new URL('../src/features/prompt-inspector.js', import.meta.url), 'utf8');
const archiveControllerSource = fs.readFileSync(new URL('../src/features/archive-controller.js', import.meta.url), 'utf8');
const memoryOrchestratorSource = fs.readFileSync(new URL('../src/features/memory-orchestrator.js', import.meta.url), 'utf8');
const turnProcessingControllerSource = fs.readFileSync(new URL('../src/features/turn-processing-controller.js', import.meta.url), 'utf8');
const generationClientSource = fs.readFileSync(new URL('../src/features/generation-client.js', import.meta.url), 'utf8');
const summaryDraftServiceSource = fs.readFileSync(new URL('../src/features/summary-draft-service.js', import.meta.url), 'utf8');
const scanControllerSource = fs.readFileSync(new URL('../src/features/scan-controller.js', import.meta.url), 'utf8');
const summaryGenerationControllerSource = fs.readFileSync(new URL('../src/features/summary-generation-controller.js', import.meta.url), 'utf8');
const summaryBackfillControllerSource = fs.readFileSync(new URL('../src/features/summary-backfill-controller.js', import.meta.url), 'utf8');
const configurationServiceSource = fs.readFileSync(new URL('../src/features/configuration-service.js', import.meta.url), 'utf8');
const configurationControllerSource = fs.readFileSync(new URL('../src/features/configuration-controller.js', import.meta.url), 'utf8');
const workflowOverviewModelSource = fs.readFileSync(new URL('../src/features/workflow-overview-model.js', import.meta.url), 'utf8');
const overviewWorkbenchUiSource = fs.readFileSync(new URL('../src/features/overview-workbench-ui.js', import.meta.url), 'utf8');
const summaryGenerationUiSource = fs.readFileSync(new URL('../src/features/summary-generation-ui.js', import.meta.url), 'utf8');
const turnSummaryUiSource = fs.readFileSync(new URL('../src/features/turn-summary-ui.js', import.meta.url), 'utf8');
const hubAutomationUiSource = fs.readFileSync(new URL('../src/features/hub-automation-ui.js', import.meta.url), 'utf8');
const summaryBrowserUiSource = fs.readFileSync(new URL('../src/features/summary-browser-ui.js', import.meta.url), 'utf8');
const workbenchPageOverviewsSource = fs.readFileSync(new URL('../src/features/workbench-page-overviews.js', import.meta.url), 'utf8');
const reviewQueueUiSource = fs.readFileSync(new URL('../src/features/review-queue-ui.js', import.meta.url), 'utf8');
const reviewQueueEventsSource = fs.readFileSync(new URL('../src/features/review-queue-events.js', import.meta.url), 'utf8');
const maintenanceUiSource = fs.readFileSync(new URL('../src/features/maintenance-ui.js', import.meta.url), 'utf8');
const summaryTimelineUiSource = fs.readFileSync(new URL('../src/features/summary-timeline-ui.js', import.meta.url), 'utf8');
const presetControlsUiSource = fs.readFileSync(new URL('../src/features/preset-controls-ui.js', import.meta.url), 'utf8');
const workbenchHeaderUiSource = fs.readFileSync(new URL('../src/features/workbench-header-ui.js', import.meta.url), 'utf8');
const workbenchRendererSource = fs.readFileSync(new URL('../src/features/workbench-renderer.js', import.meta.url), 'utf8');
const workbenchActionControllerSource = fs.readFileSync(new URL('../src/features/workbench-action-controller.js', import.meta.url), 'utf8');
const presetEventsControllerSource = fs.readFileSync(new URL('../src/features/preset-events-controller.js', import.meta.url), 'utf8');
const helpGuideContentSource = fs.readFileSync(new URL('../src/features/help-guide-content.js', import.meta.url), 'utf8');
const helpGuideSource = fs.readFileSync(new URL('../src/features/help-guide.js', import.meta.url), 'utf8');
const summaryMemoryModelSource = fs.readFileSync(new URL('../src/features/summary-memory-model.js', import.meta.url), 'utf8');
const summarySelectorsSource = fs.readFileSync(new URL('../src/features/summary-selectors.js', import.meta.url), 'utf8');
const summaryTargetControllerSource = fs.readFileSync(new URL('../src/features/summary-target-controller.js', import.meta.url), 'utf8');
const summaryTaskQueueSource = fs.readFileSync(new URL('../src/features/summary-task-queue.js', import.meta.url), 'utf8');
const tableStateServiceSource = fs.readFileSync(new URL('../src/features/table-state-service.js', import.meta.url), 'utf8');
const tableMemoryModelSource = fs.readFileSync(new URL('../src/features/table-memory-model.js', import.meta.url), 'utf8');
const tableWorkflowControllerSource = fs.readFileSync(new URL('../src/features/table-workflow-controller.js', import.meta.url), 'utf8');
const tableWorkbenchUiSource = fs.readFileSync(new URL('../src/features/table-workbench-ui.js', import.meta.url), 'utf8');
const vectorMemoryServiceSource = fs.readFileSync(new URL('../src/features/vector-memory-service.js', import.meta.url), 'utf8');
const vectorSettingsModelSource = fs.readFileSync(new URL('../src/features/vector-settings-model.js', import.meta.url), 'utf8');
const vectorWorkbenchUiSource = fs.readFileSync(new URL('../src/features/vector-workbench-ui.js', import.meta.url), 'utf8');
const vectorActionsControllerSource = fs.readFileSync(new URL('../src/features/vector-actions-controller.js', import.meta.url), 'utf8');
const themeControllerSource = fs.readFileSync(new URL('../src/features/theme-controller.js', import.meta.url), 'utf8');
const presetRegistrySource = fs.readFileSync(new URL('../src/features/preset-registry.js', import.meta.url), 'utf8');
const themeSchemaSource = fs.readFileSync(new URL('../src/theme/theme-schema.js', import.meta.url), 'utf8');
const helpPopoverSource = fs.readFileSync(new URL('../src/ui/help-popover.js', import.meta.url), 'utf8');
const operationFeedbackSource = fs.readFileSync(new URL('../src/ui/operation-feedback.js', import.meta.url), 'utf8');
const workbenchLayoutSource = fs.readFileSync(new URL('../src/ui/workbench-layout.js', import.meta.url), 'utf8');
const workbenchNavigationSource = fs.readFileSync(new URL('../src/ui/workbench-navigation.js', import.meta.url), 'utf8');
const workbenchShellEventsSource = fs.readFileSync(new URL('../src/ui/workbench-shell-events.js', import.meta.url), 'utf8');
const summaryLevelsSource = fs.readFileSync(new URL('../src/summary/levels.js', import.meta.url), 'utf8');

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
    assert.match(source, /createWorkbenchHeaderUi\(\{/);
    assert.match(workbenchHeaderUiSource, /function getPanelShortKicker\(/);
    assert.match(workbenchHeaderUiSource, /short: '注入开'/);
    assert.match(workbenchHeaderUiSource, /short: '注入空'/);
    assert.match(workbenchHeaderUiSource, /short: '注入关'/);
    assert.doesNotMatch(source, /function setWorkbenchContextOpen\(/);
    assert.match(styleSource, /grid-template-rows:\s*70px minmax\(0, 1fr\)/);
    assert.match(styleSource, /\.bakemono-workbench-header\s*\{[^}]*min-height:\s*70px;/s);
    assert.match(styleSource, /#bakemono-workbench-section-title\s*\{[^}]*display:\s*none;/s);
    assert.match(styleSource, /\.bakemono-workbench-kicker-short\s*\{[^}]*display:\s*inline;/s);
});

test('overview dashboard keeps the mobile hierarchy compact and read-only', () => {
    assert.match(settingsSource, /class="bakemono-memory-overview-dashboard"/);
    assert.match(settingsSource, /class="bakemono-memory-next-kicker">当前聊天<\/span>/);
    assert.match(settingsSource, /class="bakemono-memory-health-board"/);
    assert.match(settingsSource, /class="bakemono-memory-token-manifest"/);
    assert.match(settingsSource, /class="bakemono-memory-config-manifest"/);
    assert.match(settingsSource, /data-bakemono-nav="prompt-inspector"/);
    assert.doesNotMatch(settingsSource, /id="bakemono-memory-workflow-description"|class="bakemono-memory-scene-steps"|class="menu_button bakemono-memory-action-row"/);
    assert.match(settingsSource, /data-bakemono-tab="settings-hub"/);
    assert.match(settingsSource, /data-bakemono-nav="settings"/);
    assert.match(settingsSource, /data-bakemono-panel="settings"/);
    assert.match(settingsSource, /<option value="backfill">旧正文补课<\/option>/);
    assert.match(source, /createWorkflowOverviewModel\(\{/);
    assert.match(source, /createOverviewWorkbenchUi\(\{/);
    assert.match(workflowOverviewModelSource, /function getCurrentFloorMemoryIndex\(/);
    assert.match(workflowOverviewModelSource, /function getOverviewHealth\(/);
    assert.match(overviewWorkbenchUiSource, /function renderWorkflowGuide\(/);
    assert.match(source, /createHubAutomationUi\(\{/);
    assert.match(hubAutomationUiSource, /function renderHubPanels\(/);
    assert.match(hubAutomationUiSource, /function renderAutomationOverview\(/);
    assert.doesNotMatch(settingsSource, /<nav class="bakemono-mobile-actions"/);
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
    assert.match(source, /organizeWorkbenchOwnedSections\(getSummaryGenerationMode\(\)\)/);
    assert.match(workbenchLayoutSource, /export function organizeWorkbenchOwnedSections\(/);
    assert.match(workbenchLayoutSource, /\['database', 'bakemono-memory-data-status-slot'\]/);
    assert.match(workbenchLayoutSource, /\['batch', 'bakemono-memory-batch-summary-slot'\]/);
    assert.match(workbenchLayoutSource, /\['archive', 'bakemono-memory-floor-archive-slot'\]/);
    assert.match(workbenchLayoutSource, /\['generation', 'bakemono-memory-generation-settings-slot'\]/);
    assert.match(workbenchLayoutSource, /\['config', 'bakemono-memory-config-settings-slot'\]/);
    assert.doesNotMatch(settingsSource, /id="bakemono-memory-undo"|id="bakemono-memory-hide"|id="bakemono-memory-restore"/);
    assert.doesNotMatch(settingsSource, />专家设置</);
});

test('secondary workbench pages install a consistent parent navigation', () => {
    assert.match(workbenchLayoutSource, /const workbenchParentNavigation = Object\.freeze\(\{/);
    assert.match(workbenchLayoutSource, /'turn-summary': \{ target: 'data-hub', label: '返回自动与数据' \}/);
    assert.match(workbenchLayoutSource, /vector: \{ target: 'data-hub', label: '返回自动与数据' \}/);
    assert.match(workbenchLayoutSource, /settings: \{ target: 'settings-hub', label: '返回设置中心' \}/);
    assert.match(workbenchLayoutSource, /prompts: \{ target: 'settings-hub', label: '返回设置中心' \}/);
    assert.match(workbenchLayoutSource, /archive: \{ target: 'settings-hub', label: '返回设置中心' \}/);
    assert.match(workbenchLayoutSource, /timeline: \{ target: 'preview', label: '返回总结' \}/);
    assert.match(workbenchLayoutSource, /function installWorkbenchParentNavigation\(/);
    assert.match(source, /installWorkbenchParentNavigation\(\);/);
    assert.match(styleSource, /\.bakemono-memory-parent-link\s*\{[^}]*min-height:\s*40px;/s);
    assert.match(styleSource, /@media \(max-width: 900px\)[\s\S]*?\.bakemono-memory-parent-link\s*\{[^}]*min-height:\s*44px;/s);
});

test('previous prompt inspector stays read-only, manually searchable, navigable, and lazy on mobile', () => {
    assert.match(settingsSource, /data-bakemono-nav="prompt-inspector"/);
    assert.match(settingsSource, /data-bakemono-panel="prompt-inspector"/);
    assert.match(settingsSource, /id="bakemono-memory-prompt-inspector-search-form"/);
    assert.match(settingsSource, /id="bakemono-memory-prompt-inspector-query"[^>]*type="search"/);
    assert.match(settingsSource, /id="bakemono-memory-prompt-inspector-search-submit"[^>]*type="submit"/);
    assert.match(settingsSource, /id="bakemono-memory-prompt-inspector-search-previous"/);
    assert.match(settingsSource, /id="bakemono-memory-prompt-inspector-search-next"/);
    assert.match(settingsSource, /id="bakemono-memory-prompt-inspector-search-status"[^>]*aria-live="polite"/);
    assert.match(settingsSource, /id="bakemono-memory-prompt-inspector-search-empty"/);
    assert.match(settingsSource, /id="bakemono-memory-prompt-inspector-model"/);
    assert.match(settingsSource, /id="bakemono-memory-prompt-inspector-preset"/);
    assert.match(settingsSource, /id="bakemono-memory-prompt-inspector-floor"/);
    assert.match(workbenchLayoutSource, /'prompt-inspector': \{ target: 'overview', label: '返回剪辑台' \}/);
    assert.match(source, /import \{ createPromptInspector \} from '\.\/src\/features\/prompt-inspector\.js';/);
    assert.match(source, /const promptInspector = createPromptInspector\(\{/);
    assert.match(source, /const workbenchShellEvents = createWorkbenchShellEvents\(\{/);
    assert.match(workbenchShellEventsSource, /promptInspector\.bindEvents\(rootElement\)/);
    assert.match(promptInspectorSource, /export function createPromptInspector\(/);
    assert.match(promptInspectorSource, /function applySearch\(/);
    assert.match(promptInspectorSource, /function collectSearchResults\(/);
    assert.match(promptInspectorSource, /function openSearchResult\(/);
    assert.match(promptInspectorSource, /function navigateSearch\(/);
    assert.match(promptInspectorSource, /function clearSearch\(/);
    assert.match(promptInspectorSource, /function renderHighlightedContent\(/);
    assert.match(promptInspectorSource, /label: '基础系统与预设'/);
    assert.match(promptInspectorSource, /getActiveTab\?\.\(\) !== 'prompt-inspector'/);
    assert.match(promptInspectorSource, /if \(content\) content\.textContent = ''/);
    assert.match(promptInspectorSource, /const maxSearchResults = 2000/);
    assert.match(promptInspectorSource, /const maxRenderedMatches = 240/);
    assert.doesNotMatch(extractFunctionFrom(promptInspectorSource, 'applySearch'), /saveState|saveGlobalSettings|renderAll/);
    assert.doesNotMatch(extractFunctionFrom(promptInspectorSource, 'navigateSearch'), /saveState|saveGlobalSettings|renderAll/);
    assert.doesNotMatch(promptInspectorSource, /function schedulePromptInspectorSearch\(/);
    assert.match(styleSource, /#bakemono-memory-prompt-inspector-query\s*\{[^}]*min-height:\s*44px;/s);
    assert.match(styleSource, /#bakemono-memory-prompt-inspector-search-submit\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;/s);
    assert.match(styleSource, /\.bakemono-memory-prompt-inspector-search-navigation\s*\{[^}]*min-height:\s*44px;/s);
    assert.match(styleSource, /\.bakemono-memory-prompt-inspector-item-body > pre mark/);
    assert.match(styleSource, /\.bakemono-memory-prompt-inspector-item-body > pre mark\.is-current/);
});

test('help guide owns its content, reader state, and delegated events outside the entry file', () => {
    assert.match(source, /import \{ createHelpGuide \} from '\.\/src\/features\/help-guide\.js';/);
    assert.match(source, /const helpGuide = createHelpGuide\(\{ escapeHtml \}\)/);
    assert.match(workbenchShellEventsSource, /helpGuide\.bind\(rootElement\)/);
    assert.match(helpGuideContentSource, /export const helpGuideCategories =/);
    assert.match(helpGuideContentSource, /export const helpGuideArticles =/);
    assert.match(helpGuideSource, /function renderArticle\(/);
    assert.match(helpGuideSource, /function openArticle\(/);
    assert.match(helpGuideSource, /function closeArticle\(/);
    assert.doesNotMatch(helpGuideSource, /saveState|saveGlobalSettings|renderAll/);
});

test('summary memory hierarchy and material selection stay DOM-free feature models', () => {
    assert.match(source, /import \{ createSummaryMemoryModel \} from '\.\/src\/features\/summary-memory-model\.js';/);
    assert.match(source, /import \{ createSummarySelectors \} from '\.\/src\/features\/summary-selectors\.js';/);
    assert.match(source, /from '\.\/src\/summary\/levels\.js';/);
    assert.match(summaryMemoryModelSource, /function buildMemoryRecords\(/);
    assert.match(summaryMemoryModelSource, /function getActiveCoveredStageHashes\(/);
    assert.match(summarySelectorsSource, /function getStoryMaterialBlocks\(/);
    assert.match(summarySelectorsSource, /function getUnsummarizedMultiSummaryBlocks\(/);
    assert.match(summaryLevelsSource, /export function getSummaryLevel\(/);
    assert.doesNotMatch(summaryMemoryModelSource, /document\.|window\.|\$\(|saveState|renderAll/);
    assert.doesNotMatch(summarySelectorsSource, /document\.|window\.|\$\(|saveState|renderAll/);
});

test('summary target selection and task queue are assembled outside the entry file', () => {
    assert.match(source, /import \{ createSummaryTargetController \} from '\.\/src\/features\/summary-target-controller\.js';/);
    assert.match(source, /import \{ createSummaryTaskQueue \} from '\.\/src\/features\/summary-task-queue\.js';/);
    assert.match(source, /const summaryTargetController = createSummaryTargetController\(\{/);
    assert.match(source, /const summaryTaskQueue = createSummaryTaskQueue\(\{/);
    assert.match(summaryTargetControllerSource, /function confirmGenerationTargets\(/);
    assert.match(summaryTaskQueueSource, /async function processTaskQueue\(/);
    assert.doesNotMatch(source, /function enqueueSummaryTask\(|async function processTaskQueue\(/);
    assert.doesNotMatch(summaryTargetControllerSource, /renderAll\(/);
    assert.doesNotMatch(summaryTaskQueueSource, /renderAll\(/);
});

test('table profiles, scoped storage, and rollback transactions share one table state boundary', () => {
    assert.match(source, /import \{ createTableStateService \} from '\.\/src\/features\/table-state-service\.js';/);
    assert.match(source, /const tableStateService = createTableStateService\(\{/);
    assert.match(tableStateServiceSource, /function getActiveTableProfile\(/);
    assert.match(tableStateServiceSource, /function persistCurrentTableDatabase\(/);
    assert.match(tableStateServiceSource, /function rollbackTableOperationsForMessages\(/);
    assert.doesNotMatch(source, /function getActiveTableProfile\(|function rollbackTableOperationsForMessages\(/);
    assert.doesNotMatch(tableStateServiceSource, /renderAll\(/);
    assert.match(tableMemoryModelSource, /function applyTableOperations\(/);
    assert.match(tableWorkflowControllerSource, /async function processLatestTableEdit\(/);
    assert.match(tableWorkbenchUiSource, /function renderTableList\(/);
    assert.doesNotMatch(source, /function applyTableOperations\(|async function processLatestTableEdit\(|function renderTableList\(/);
});

test('vector recall uses independent semantic and lexical candidates with explainable scores', () => {
    assert.match(vectorMemoryServiceSource, /selectHybridCandidates\(scored, queries, keywords/);
    assert.match(vectorMemoryServiceSource, /keywordBoost:\s*state\.vectorMemory\.keywordBoost/);
    assert.match(vectorMemoryServiceSource, /lexicalScore:\s*Number/);
    assert.match(vectorMemoryServiceSource, /matchedTerms:\s*Array\.isArray/);
    assert.match(settingsSource, /混合召回 v2：语义 \+ 稀有词 \+ 关键词/);
    assert.match(source, /title:\s*`混合初筛/);
    assert.match(hybridRetrievalSource, /export function selectHybridCandidates\(/);
    assert.match(hybridRetrievalSource, /vectorRanked/);
    assert.match(hybridRetrievalSource, /lexicalRanked/);
    assert.match(hybridRetrievalSource, /keywordRanked/);
    assert.match(hybridRetrievalSource, /getInverseDocumentFrequency/);
});

test('vector indexing, settings, actions, and page rendering are assembled as separate boundaries', () => {
    assert.match(source, /const vectorMemoryService = createVectorMemoryService\(\{/);
    assert.match(source, /const vectorSettingsModel = createVectorSettingsModel\(\{/);
    assert.match(source, /const vectorWorkbenchUi = createVectorWorkbenchUi\(\{/);
    assert.match(source, /const vectorActionsController = createVectorActionsController\(\{/);
    assert.match(vectorMemoryServiceSource, /async function retrieveVectorMemoryHits\(/);
    assert.match(vectorSettingsModelSource, /function readVectorMemoryFieldsFromUi\(/);
    assert.match(vectorWorkbenchUiSource, /function renderVectorMemoryPanel\(/);
    assert.match(vectorActionsControllerSource, /async function fetchVectorEmbeddingModels\(/);
    assert.doesNotMatch(source, /async function retrieveVectorMemoryHits\(|function renderVectorMemoryPanel\(/);
});

test('renderAll only scans heavy block collections and syncs forms for the active page', () => {
    assert.match(source, /const workbenchRenderer = createWorkbenchRenderer|workbenchRenderer = createWorkbenchRenderer/);
    assert.match(workbenchRendererSource, /function buildBlockBundle\(/);
    assert.match(workbenchRendererSource, /const blocks = activeTab === 'preview' \|\| activeTab === 'data-hub'/);
    assert.match(workbenchRendererSource, /function syncActiveFormFields\(activeTab, state/);
    assert.match(workbenchRendererSource, /if \(activeTab === 'settings'\)/);
    assert.match(workbenchRendererSource, /else if \(activeTab === 'injection'\)/);
    assert.match(workbenchRendererSource, /else if \(activeTab === 'prompts'\)/);
    assert.match(workbenchRendererSource, /else if \(activeTab === 'scan'\)/);
    assert.match(workbenchRendererSource, /else if \(activeTab === 'automation'\)/);
    assert.match(workbenchRendererSource, /else if \(activeTab === 'preview'\)/);
    assert.match(workbenchRendererSource, /else if \(activeTab === 'generation'\)/);
    assert.match(workbenchRendererSource, /else if \(tabName === 'vector'\) renderVectorMemoryPanel\(state\)/);
    assert.match(workbenchRendererSource, /function renderOverviewMemory\(state\) \{\s*state\.memoryRecords = buildMemoryRecords\(state\);\s*renderWorkflowGuide\(state\)/s);
    assert.match(workbenchRendererSource, /renderActivePanel\(activeTab, state, blocks\)/);
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
    assert.match(source, /import \{ createHelpPopover \} from '\.\/src\/ui\/help-popover\.js';/);
    assert.match(source, /const helpPopover = createHelpPopover\(\)/);
    assert.match(helpPopoverSource, /function toggle\(/);
    assert.match(helpPopoverSource, /function position\(/);
    assert.match(helpPopoverSource, /event\.key === 'Escape'/);
    assert.match(styleSource, /details\[open\] > summary > \.bakemono-memory-help-trigger\s*\{[^}]*display:\s*inline-flex;/s);
    assert.match(styleSource, /\.bakemono-memory-help-popover::before/);
    assert.match(source, /import \{ createOperationFeedback \} from '\.\/src\/ui\/operation-feedback\.js';/);
    assert.match(source, /const operationFeedback = createOperationFeedback\(\{/);
    assert.match(operationFeedbackSource, /toast\.setAttribute\('role', 'status'\)/);
    assert.match(operationFeedbackSource, /toast\.setAttribute\('aria-live', 'polite'\)/);
    assert.match(operationFeedbackSource, /set\('success'/);
    assert.match(operationFeedbackSource, /set\('error'/);
});

test('floor memory orchestration stays derived and the base ledger remains optional', () => {
    assert.match(source, /import \{ buildFloorMemoryIndex, createMemoryOrchestrationPlan \}/);
    assert.match(memoryOrchestratorSource, /async function runMemoryOrchestrator\(/);
    assert.match(source, /createMemoryOrchestrator\(\{/);
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
    assert.match(summaryGenerationUiSource, /function render\(state = getState\(\), blocks = null\)/);
    assert.match(source, /renderSummaryGenerationPanel\(state, blocks\)/);
    assert.match(turnSummaryUiSource, /function render\(state = getState\(\)\)/);
    assert.match(source, /createSummaryBrowserUi\(\{/);
    assert.match(summaryBrowserUiSource, /function renderSections\(/);
    assert.match(summaryBrowserUiSource, /function changePage\(/);
    assert.match(source, /createWorkbenchPageOverviews\(\{/);
    assert.match(workbenchPageOverviewsSource, /function renderPromptOverview\(/);
    assert.match(workbenchPageOverviewsSource, /function renderInjectionOverview\(/);
    assert.match(workbenchPageOverviewsSource, /function renderScanPreview\(/);
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
    assert.match(source, /createReviewQueueUi\(\{/);
    assert.match(reviewQueueUiSource, /function renderTabs\(/);
    assert.match(reviewQueueUiSource, /function renderDrafts\(/);
    assert.match(reviewQueueUiSource, /function renderHistory\(/);
    assert.match(reviewQueueUiSource, /function renderTaskQueue\(/);
    assert.match(reviewQueueEventsSource, /bakemonoDraftAction/);
    assert.match(reviewQueueEventsSource, /bakemonoTaskAction/);
    assert.match(reviewQueueEventsSource, /bakemonoAutoTransaction/);
    assert.doesNotMatch(source, /bakemonoDraftAction|bakemonoTaskAction|bakemonoAutoTransaction/);
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

function extractFunctionFrom(targetSource, name) {
    const start = targetSource.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} should exist`);
    const signatureEnd = targetSource.indexOf(') {', start);
    assert.notEqual(signatureEnd, -1, `${name} should have a function body`);
    const bodyStart = signatureEnd + 2;
    let depth = 0;
    for (let index = bodyStart; index < targetSource.length; index += 1) {
        if (targetSource[index] === '{') depth += 1;
        if (targetSource[index] === '}') depth -= 1;
        if (depth === 0) {
            return targetSource.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${name}`);
}

function extractFunction(name) {
    return extractFunctionFrom(source, name);
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
    assert.match(stage, /1\. > “台词1”——【角色名】\r?\n……/);

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
    const ensureSource = extractFunctionFrom(chatStateServiceSource, 'ensureState');
    const globalSettingsSource = extractFunctionFrom(globalSettingsServiceSource, 'ensureGlobalSettings');

    assert.match(source, /from '.\/src\/core\/prompt-migrations\.js'/);
    assert.match(ensureSource, /migrateGenerationPrompts\(state\.generationPrompts/);
    assert.match(ensureSource, /migrateTurnSummaryPrompt\(state\.turnSummary/);
    assert.match(ensureSource, /migrateInlineSummaryPrompt\(state\.inlineGeneration/);
    assert.match(ensureSource, /migrateVectorQueryRewritePrompt\(state\.vectorMemory/);
    assert.match(globalSettingsSource, /migratePromptPresetTimelines\(preset/);
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
    const queueSource = extractFunctionFrom(summaryTaskQueueSource, 'processTaskQueue');
    assert.match(queueSource, /renderTaskQueueProgress\(/);
    assert.doesNotMatch(queueSource, /renderAll\(`正在处理任务/);

    const initStart = source.indexOf('async function init()');
    const initSource = source.slice(initStart);
    assert.match(initSource, /scheduleRenderAll\(\)/);
});

test('closed workbench and background queues avoid heavy DOM rendering', () => {
    const ensureSource = extractFunctionFrom(chatStateServiceSource, 'ensureState');
    const renderAllSource = extractFunctionFrom(workbenchRendererSource, 'renderAll');
    const scopedRenderSource = extractFunctionFrom(workbenchRendererSource, 'renderScope');
    const queueProgressSource = extractFunctionFrom(workbenchRendererSource, 'renderTaskQueueProgress');

    assert.doesNotMatch(ensureSource, /memoryRecords\s*=\s*buildMemoryRecords/);
    assert.match(renderAllSource, /if \(!isWorkbenchOpen\(\)\)/);
    assert.ok(
        renderAllSource.indexOf('if (!isWorkbenchOpen())') < renderAllSource.indexOf('buildMemoryRecords'),
        'renderAll should return before deriving records when the workbench is closed',
    );
    assert.match(renderAllSource, /renderActivePanel\(/);
    assert.match(scopedRenderSource, /if \(!isWorkbenchOpen\(\)\)/);
    assert.match(queueProgressSource, /renderScope\(workbenchRenderScopes\.DRAFTS/);
});

test('vector, draft, and table actions use page-scoped rendering', () => {
    const scopedRenderSource = extractFunctionFrom(workbenchRendererSource, 'renderScope');
    assert.doesNotMatch(scopedRenderSource, /renderAll\(/);
    assert.match(scopedRenderSource, /scope === workbenchRenderScopes\.VECTOR/);
    assert.match(scopedRenderSource, /renderVectorMemoryPanel\(state\)/);
    assert.match(scopedRenderSource, /scope === workbenchRenderScopes\.DRAFTS/);
    assert.match(scopedRenderSource, /renderDrafts\(\)[\s\S]*renderHistory\(\)[\s\S]*renderTaskQueue\(\)/);
    assert.match(scopedRenderSource, /scope === workbenchRenderScopes\.TABLES/);
    assert.match(scopedRenderSource, /renderTurnSummaryPanel\(state\)/);

    for (const [name, scope] of [
        ['commitDraft', 'DRAFTS'],
        ['discardDraft', 'DRAFTS'],
        ['regenerateDraft', 'DRAFTS'],
        ['undoLastCommit', 'DRAFTS'],
    ]) {
        const functionSource = extractFunctionFrom(summaryDraftServiceSource, name);
        assert.match(functionSource, new RegExp(`renderWorkbenchScope\\(workbenchRenderScopes\\.${scope}`), `${name} should use ${scope} scoped rendering`);
        assert.doesNotMatch(functionSource, /renderAll\(/, `${name} should not refresh the whole workbench`);
    }
    for (const [moduleSource, name] of [
        [vectorMemoryServiceSource, 'buildVectorMemoryIndex'],
        [vectorActionsControllerSource, 'applyVectorMemorySettings'],
        [vectorActionsControllerSource, 'testVectorMemoryRetrieval'],
        [vectorActionsControllerSource, 'clearVectorMemoryIndex'],
    ]) {
        const functionSource = extractFunctionFrom(moduleSource, name);
        assert.match(functionSource, /renderWorkbenchScope\(workbenchRenderScopes\.VECTOR/);
        assert.doesNotMatch(functionSource, /renderAll\(/);
    }
    for (const [moduleSource, name] of [
        [tableStateServiceSource, 'undoLastTableOperation'],
        [tableStateServiceSource, 'redoLastTableOperation'],
        [tableWorkbenchUiSource, 'createCustomTableFromUi'],
    ]) {
        const functionSource = extractFunctionFrom(moduleSource, name);
        assert.match(functionSource, /renderWorkbenchScope\(workbenchRenderScopes\.TABLES/);
        assert.doesNotMatch(functionSource, /renderAll\(/);
    }
});

test('all business mutations use scoped rendering and reserve renderAll for lifecycle entry points', () => {
    const scopedRenderSource = extractFunctionFrom(workbenchRendererSource, 'renderScope');
    const summarySurfaceSource = extractFunctionFrom(workbenchRendererSource, 'renderSummarySurface');
    const actionScopeSource = extractFunctionFrom(workbenchActionControllerSource, 'getRenderScope');

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
    assert.equal(renderAllOccurrences.length, 4, 'index should keep one definition, two lifecycle calls, and one navigation adapter');
    assert.equal((workbenchNavigationSource.match(/renderAll\?\.\(\)/g) || []).length, 2);
    for (const name of [
        'scanBakemonoBlocks',
        'generateStageBatchTasks',
        'generateEpicBatchTasks',
        'generateMissingSummaryQueue',
        'applyWorkflowPreset',
        'applyPromptPresetToState',
        'renderAreaPresetChange',
        'bindSettingsEvents',
    ]) {
        const targetSource = name === 'scanBakemonoBlocks'
            ? scanControllerSource
            : ['generateStageBatchTasks', 'generateEpicBatchTasks'].includes(name)
                ? summaryGenerationControllerSource
                : name === 'generateMissingSummaryQueue'
                    ? summaryBackfillControllerSource
                : name === 'applyWorkflowPreset'
                    ? workflowOverviewModelSource
                : ['applyPromptPresetToState', 'renderAreaPresetChange'].includes(name)
                    ? configurationControllerSource
                : source;
        assert.doesNotMatch(extractFunctionFrom(targetSource, name), /\brenderAll\(/, `${name} should not refresh the whole workbench`);
    }
    assert.doesNotMatch(extractFunctionFrom(archiveControllerSource, 'hideCoveredMessages'), /\brenderAll\(/);
    assert.doesNotMatch(extractFunctionFrom(archiveControllerSource, 'restoreHiddenMessages'), /\brenderAll\(/);
    assert.doesNotMatch(extractFunctionFrom(memoryOrchestratorSource, 'maybeRunAutoSummary'), /\brenderAll\(/);
    for (const name of ['rollbackAutoSummaryTransaction', 'saveEditedSummary', 'deleteSavedSummary']) {
        assert.doesNotMatch(extractFunctionFrom(summaryDraftServiceSource, name), /\brenderAll\(/);
    }
    assert.doesNotMatch(extractFunctionFrom(operationFeedbackSource, 'runGeneration'), /\brenderAll\(/);
});

test('large-chat scans avoid quadratic lookup and duplicate opening renders', () => {
    const scanSource = extractFunctionFrom(scanControllerSource, 'scanBakemonoBlocks');
    const openSource = extractFunctionFrom(workbenchNavigationSource, 'open');

    assert.match(scanSource, /previousBlockByContent\s*=\s*new Map/);
    assert.doesNotMatch(scanSource, /previousBlocks\.find\(/);
    assert.match(scanSource, /preview\.slice\(-maxStoredScanPreviewItems\)/);
    assert.match(source, /scanBlocks: options => scanBakemonoBlocks\(options\)/);
    assert.match(openSource, /scanBlocks\?\.\(\{ persist: false, render: false \}\)/);
    assert.equal((openSource.match(/renderAll\?\.\(\)/g) || []).length, 1);
});

test('state normalization remains compatible with SillyTavern metadata objects', () => {
    const ensureSource = extractFunctionFrom(chatStateServiceSource, 'ensureState');
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
    const timelineSource = extractFunctionFrom(summaryTimelineUiSource, 'render');
    assert.match(source, /createSummaryTimelineUi\(\{/);
    assert.match(timelineSource, /const rootFactories = \[\]/);
    assert.match(timelineSource, /rootFactories\.slice\(start, start \+ pageSize\)\.map/);
    assert.doesNotMatch(timelineSource, /roots\.push\(make(?:Epic|Stage)Node/);
});

test('maintenance history and transaction export live outside the entry module', () => {
    assert.match(source, /createMaintenanceUi\(\{/);
    assert.match(maintenanceUiSource, /function renderOverview\(/);
    assert.match(maintenanceUiSource, /function renderAutoSummaryTransactions\(/);
    assert.match(maintenanceUiSource, /function exportTransactions\(/);
});

test('every config-bearing tab refreshes its own preset selectors', () => {
    const presetSource = extractFunctionFrom(workbenchRendererSource, 'renderActivePresetControls');
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
    assert.match(source, /createPresetControlsUi\(\{/);
    assert.match(presetControlsUiSource, /function renderPresetControlPair\(/);
    assert.match(presetControlsUiSource, /function renderAreaPresetControl\(/);
    assert.match(presetEventsControllerSource, /function bindAreaPresetControls\(/);
    assert.match(presetEventsControllerSource, /function bindInlinePromptPresetControls\(/);
    assert.doesNotMatch(source, /function bindAreaPresetControls\(|function bindInlinePromptPresetControls\(/);
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
    assert.match(themeSchemaSource, /const CUSTOM_THEME_SCHEMA = 'bakemono-memory-theme\/v1'/);
    assert.match(themeSchemaSource, /const CUSTOM_THEME_LIBRARY_SCHEMA = 'bakemono-memory-theme-library\/v1'/);
    assert.match(themeSchemaSource, /function sanitizeCustomTheme\(/);
    assert.match(themeControllerSource, /function applyAppearanceTheme\(/);
    assert.match(themeControllerSource, /function downloadCustomThemeJson\(/);
    assert.match(themeControllerSource, /function downloadCustomThemeLibraryJson\(/);
    assert.match(themeControllerSource, /function importCustomThemeJson\(/);
    assert.match(themeControllerSource, /function bindEvents\(rootElement\)/);
    assert.match(source, /bindEvents: bindThemeEvents/);
    assert.doesNotMatch(source, /bakemonoThemePreview|bakemono-memory-theme-copy-json/);
    assert.match(source, /createThemeController\(\{/);
    assert.match(globalSettingsServiceSource, /settings\.ui\.customTheme = sanitizeCustomTheme/);
    assert.match(globalSettingsServiceSource, /settings\.ui\.themePresets = Array\.isArray\(settings\.ui\.themePresets\)[\s\S]*?settings\.ui\.themePresets\.map/);
    assert.match(styleSource, /\.bakemono-workbench-root\.bakemono-custom-theme/);
    assert.match(styleSource, /v1\.2\.5 compact theme library/);
    assert.match(styleSource, /\.bakemono-memory-theme-section-panel\[hidden\]\s*\{[^}]*display:\s*none !important;/s);
});

test('active global config follows existing chats without removing the tavern model path', () => {
    assert.match(source, /from '.\/src\/core\/config-sync\.js'/);
    assert.match(configSyncSource, /export function getActiveConfigSignature\(/);
    assert.match(configSyncSource, /export function shouldSyncActiveConfig\(/);
    assert.match(presetRegistrySource, /function syncGlobalActiveConfigToState\(/);
    assert.match(source, /syncGlobalActiveConfigToState\(initialState, \{ force: true \}\)/);
    assert.match(source, /syncConfig:\s*state => \{/);
    assert.match(generationClientSource, /if \(state\.automation\.apiProvider !== 'custom'\) \{\s*return await generateRaw/s);
    assert.match(configSyncSource, /state\.activeConfigSignature = getActiveConfigSignature/);
});

test('saved settings become shared defaults while vector runtime remains chat-local', () => {
    assert.match(configurationServiceSource, /function persistSharedConfigurationFromState\(/);
    assert.match(configurationServiceSource, /vectorMemory:\s*createSharedVectorConfig\(state\.vectorMemory/);
    assert.match(source, /mergeSharedVectorConfig\(state\.vectorMemory, preset\.vectorMemory, defaultVectorMemory\)/);
    assert.match(source, /syncGlobalActiveConfigToState\(initialState, \{ force: true \}\)/);
    assert.match(source, /syncConfig:\s*state => \{/);
    const vectorPersist = extractFunctionFrom(vectorSettingsModelSource, 'persistVectorMemoryFieldsFromUi');
    const vectorApply = extractFunctionFrom(vectorActionsControllerSource, 'applyVectorMemorySettings');
    assert.match(vectorPersist, /persistSharedConfigurationFromState\(state/);
    assert.match(vectorApply, /persistSharedConfigurationFromState\(state/);
});

test('first shared-settings upgrade preserves the current chat before forced synchronization', () => {
    assert.match(configurationServiceSource, /function bootstrapSharedConfigurationFromCurrentChat\(/);
    assert.match(configurationServiceSource, /shouldBootstrapSharedConfig\(settings, hasActiveChat\)/);
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
    const operationSource = extractFunctionFrom(operationFeedbackSource, 'runVisible');
    const persistSource = extractFunctionFrom(vectorSettingsModelSource, 'persistVectorMemoryFieldsFromUi');
    const actionSource = extractFunctionFrom(workbenchActionControllerSource, 'run');
    const embeddingSource = extractFunctionFrom(vectorActionsControllerSource, 'fetchVectorEmbeddingModels');
    const querySource = extractFunctionFrom(vectorActionsControllerSource, 'fetchVectorQueryModels');

    assert.doesNotMatch(operationSource, /renderAll\(/);
    assert.match(persistSource, /readVectorMemoryFieldsFromUi\(state\)/);
    assert.match(persistSource, /persistSharedConfigurationFromState\(state\)/);
    assert.equal((actionSource.match(/persistVectorMemoryFieldsFromUi\(\)/g) || []).length, 2);
    assert.match(embeddingSource, /if \(!baseUrl\)[\s\S]*?return false;/);
    assert.match(querySource, /if \(!baseUrl\)[\s\S]*?return false;/);
    assert.match(embeddingSource, /return true;[\s\S]*?catch \(error\)[\s\S]*?return false;/);
    assert.match(querySource, /return true;[\s\S]*?catch \(error\)[\s\S]*?return false;/);
});

test('frequent prompt and floor-archive tools live directly in the settings center', () => {
    assert.match(settingsSource, /data-bakemono-nav="prompts"[^>]*>[\s\S]*?<strong>生成提示词<\/strong>/);
    assert.match(settingsSource, /data-bakemono-nav="archive"[^>]*>[\s\S]*?<strong>楼层收纳<\/strong>/);
    assert.match(settingsSource, /data-bakemono-panel="archive"/);
    assert.match(settingsSource, /id="bakemono-memory-floor-archive-slot"/);
    assert.match(source, /archive: \{ target: 'settings-hub', label: '返回设置中心' \}/);
    assert.match(source, /prompts: \{ target: 'settings-hub', label: '返回设置中心' \}/);
    assert.match(source, /\['config', 'generation', 'archive'\]\.includes\(sectionName\)/);
    assert.match(settingsSource, /data-bakemono-nav="maintenance">\s*<span>09<\/span>/);
    assert.doesNotMatch(settingsSource, /data-bakemono-panel="generation"[\s\S]*?data-bakemono-nav="prompts"/);
});

test('injection defaults mark their end and start at the front of chat history', () => {
    assert.match(source, /\{\{memory\}\}\r?\n【剧情剪辑台：长期剧情记忆结束】`;/);
    assert.match(source, /injection:\s*\{\s*enabled:\s*true,\s*depth:\s*999,/);
    assert.match(source, /migrateBuiltInInjectionDefaults\(state\.injection, legacyInjectionTemplate, defaultInjectionTemplate\)/);
});

test('appearance settings ship protected warm-paper day and night presets', () => {
    assert.match(source, /id: 'bakemono-warm-paper-day'/);
    assert.match(source, /id: 'bakemono-warm-paper-night'/);
    assert.match(source, /name: '暖纸日间'/);
    assert.match(source, /name: '暖纸夜间'/);
    assert.match(source, /builtInCustomThemePresetIds\.has/);
});

test('table-memory injection toggle persists immediately before page refresh', () => {
    assert.match(source, /\$\('#bakemono-memory-table-inject-memory'\)\.off\('change\.bakemonoTableInjection'\)/);
    assert.match(source, /state\.tableDatabase\.injectMemory = !!this\.checked;[\s\S]*?persistSharedConfigurationFromState\(state\);/);
});
