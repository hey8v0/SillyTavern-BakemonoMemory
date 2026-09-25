import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfigurationService } from '../../src/features/configuration-service.js';
import { createTurnSummaryUi } from '../../src/features/turn-summary-ui.js';
import { createTableManagementEvents } from '../../src/features/table-management-events.js';
import { createHubAutomationUi } from '../../src/features/hub-automation-ui.js';
import { createSummaryBrowserUi } from '../../src/features/summary-browser-ui.js';
import { createSummaryBrowserEvents } from '../../src/features/summary-browser-events.js';
import { createWorkbenchNavigation } from '../../src/ui/workbench-navigation.js';
import { stageAutomationStatus } from '../../src/summary/automation-status.js';
const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const { document, window } = parseHTML(await readFile(new URL('../../settings.html', import.meta.url), 'utf8'));
const descriptor = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    ...descriptor, set(value) {
        for (const option of this.options) option.removeAttribute('selected');
        [...this.options].find(option => option.value === String(value))?.setAttribute('selected', '');
    },
});
const handlers = new Map(), noop = () => {};
const query = selector => {
    const nodes = [...document.querySelectorAll(selector)];
    return { length: nodes.length,
        val(value) { if (!arguments.length) return nodes[0]?.value; nodes.forEach(n => n.value = value); return this; },
        prop(key, value) { if (arguments.length === 1) return nodes[0]?.[key]; nodes.forEach(n => n[key] = value); return this; },
        text(value) { nodes.forEach(n => n.textContent = String(value)); return this; },
        css(key, value) { nodes.forEach(n => n.style[key] = value); return this; },
        toggleClass(key, value) { nodes.forEach(n => n.classList.toggle(key, value)); return this; },
        off() { return this; }, on(event, selectorOrCallback, callback) { handlers.set(selector + ':' + event, callback || selectorOrCallback); return this; },
    };
};
const state = { turnSummary: { enabled: true, auto: false, processingMode: 'summary', saveMode: 'draft',
    includeUserMessage: false, worldInfoMaxContext: 4096, prompt: '自定义摘要提示' },
    inlineGeneration: { summaryEnabled: false, tableEnabled: false, summaryPrompt: '自定义随文提示' },
    tableDatabase: { enabled: false, tables: [], editDrafts: [], schemaScope: 'chat' }, stageSourceMode: 'raw' };
const ui = createTurnSummaryUi({ documentRef: document, query, getState: () => state,
    defaultState: { turnSummary: { worldInfoMaxContext: 4096 } }, turnProcessingModes: { BOTH: 'both', TABLE: 'table' },
    tableSchemaScopes: { CHAT: 'chat' }, getTableSchemaScopeLabel: () => '', getCurrentCharacterSchemaLabel: () => '',
    renderTableProfileControls: noop, renderInlinePromptPresetControls: noop, renderTableList: noop, renderTableEditDrafts: noop });
const config = createConfigurationService({ query, getState: () => state,
    defaultState: { turnSummary: { worldInfoMaxContext: 4096 } }, turnProcessingModes: { BOTH: 'both' },
    tableSchemaScopes: { CHAT: 'chat' }, setTableSchemaScope: noop });
ui.render();
assert.equal(query('#bakemono-memory-turn-source').val(), 'manual');
assert.match(document.getElementById('bakemono-memory-turn-runtime-label').textContent, /仅手动/);
assert.equal(query('#bakemono-memory-turn-trigger-timing').prop('disabled'), true);
config.readTurnSummaryFieldsFromUi();
assert.equal(state.turnSummary.auto, false);
assert.equal(state.stageSourceMode, 'raw');
assert.equal(state.turnSummary.includeUserMessage, false);
assert.equal(state.turnSummary.prompt, '自定义摘要提示');
assert.equal(state.inlineGeneration.summaryPrompt, '自定义随文提示');

createTableManagementEvents({ query }).bind();
const source = document.getElementById('bakemono-memory-turn-source');
source.value = 'independent';
handlers.get('#bakemono-memory-turn-source:change.bakemonoSummarySource').call(source);
assert.equal(query('#bakemono-memory-turn-trigger-timing').prop('disabled'), false);
assert.equal(state.turnSummary.auto, false, 'choice alone does not save or launch work');
config.readTurnSummaryFieldsFromUi();
assert.equal(state.turnSummary.auto, true);
assert.equal(state.turnSummary.enabled, true);
assert.equal(state.stageSourceMode, 'backfill');
assert.equal(state.tableDatabase.enabled, false);
assert.equal(document.getElementById('bakemono-memory-turn-auto'), null);
assert.equal(document.getElementById('bakemono-memory-inline-summary-enabled'), null);

state.automation = { enabled: true, mode: 'draft', floorInterval: 10, triggerType: 'count' };
state.taskQueue = [{ id: 'failed-task', kind: 'stage', sourceHashes: ['a'], status: 'failed', error: '接口等待超时' }];
state.drafts = [];
let materials = { targets: [{ hash: 'a', content: '剧情' }], sourceMode: 'summaries', coveredCount: 0 };
const auto = createHubAutomationUi({ documentRef: document, query, getState: () => state,
    getStageMaterialOverview: () => materials,
    getStageSourceModeLabel: () => '读取已有摘要', defaultAutomation: { floorInterval: 10, autoHidePreserveRecent: 2 } });
auto.renderAutomationOverview();
const action = document.getElementById('bakemono-memory-automation-next-action');
assert.equal(action.hidden, false); assert.equal(action.dataset.taskId, 'failed-task');
assert.equal(action.dataset.bakemonoTaskAction, 'retry');
assert.match(document.getElementById('bakemono-memory-automation-runtime-title').textContent, /失败/);
state.taskQueuePaused = true; auto.renderAutomationOverview();
assert.equal(action.dataset.taskId, undefined); assert.equal(action.dataset.bakemonoTab, 'drafts');
state.automation.enabled = false; auto.renderAutomationOverview(); assert.equal(action.hidden, true);

state.automation.enabled = true; state.taskQueuePaused = false; state.taskQueue = [];
const unsafeKey = 'summary-"]<img src=x onerror=alert(1)>';
materials = { ...materials, issues: [{ key: unsafeKey, type: 'story', title: '<img src=x onerror=alert(1)>',
    floors: [0], reason: '第 0 楼的实际输入版本变化' }] };
auto.renderAutomationOverview();
assert.equal(action.dataset.taskId, undefined);
assert.equal(action.dataset.bakemonoTab, undefined);
assert.equal(action.dataset.bakemonoSummaryFocus, unsafeKey);
const issues = document.getElementById('bakemono-memory-automation-issues');
issues.open = true; auto.renderAutomationOverview();
assert.equal(issues.open, true); assert.equal(issues.querySelector('img'), null);
assert.match(issues.textContent, /第 0 楼/);

const blocks = Array.from({ length: 20 }, (_, id) => ({ id: id === 0 ? unsafeKey : 's-' + id,
    hash: 'h-' + id, type: 'story', messageId: id, title: '摘要' + id, content: '甲进入书店。' }));
const browserState = { storySummaries: blocks, stageSummaries: [], epicSummaries: [] };
const browser = createSummaryBrowserUi({ documentRef: document, query, getState: () => browserState,
    getStoryBlocks: () => blocks, getBlocksByType: () => [], blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' },
    dedupeByHash: values => values, summaryToBlock: value => value, normalizeSearchText: value => String(value).toLowerCase(),
    getPreviewSummaryText: block => block.title, parsePreviewMeta: () => ({}), stripHtml: text => text,
    getBlockSortKey: block => block.messageId,
    createNotebook: block => { const node = document.createElement('details'); node.textContent = block.title; return node; } });
globalThis.document = document;
globalThis.window = window;
globalThis.requestAnimationFrame = callback => callback();
const navigation = createWorkbenchNavigation();
navigation.switchTab('automation');
// Exercise the route wired by index.js, not a replacement invented by this test.
const entrySource = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
const focusRoute = entrySource.match(/focusSummaryRecord:\s*\(key, type\) => \{\s*switchWorkbenchTab\('([^']+)'\)/)?.[1];
assert.ok(focusRoute);
createSummaryBrowserEvents({ query, focusSummaryRecord: (key, type) => {
    navigation.switchTab(focusRoute); assert.equal(browser.focusRecord(key, type), true);
} }).bind();
query('#bakemono-memory-preview-filter').val('no match');
query('#bakemono-memory-preview-order').val('desc');
const clickFocus = handlers.get('#bakemono-workbench-root:click.bakemonoSummaryFocus');
clickFocus.call(issues.querySelector('button'));
assert.equal(navigation.getActiveTab(), 'preview');
assert.equal(document.querySelectorAll('.bakemono-workbench-panel.is-active').length, 1);
assert.equal(document.querySelector('.bakemono-workbench-panel.is-active').dataset.bakemonoPanel, 'preview');
navigation.switchTab('unknown-page');
assert.equal(navigation.getActiveTab(), 'preview');
assert.equal(document.querySelectorAll('.bakemono-workbench-panel.is-active').length, 1);
assert.equal(query('#bakemono-memory-preview-filter').val(), '');
assert.equal(browser.getActiveType(), 'story');
const focused = [...document.querySelectorAll('[data-bakemono-summary-key]')].find(node => node.dataset.bakemonoSummaryKey === unsafeKey);
assert.equal(focused.open, true);
assert.match(document.querySelector('#bakemono-memory-preview-story').textContent, /17-20 \/ 20/);
assert.equal(browser.focusRecord('removed'), false);
for (const status of [
    stageAutomationStatus({ automation: { enabled: true } }, { targets: [], invalid: ['来源变化'] }),
    stageAutomationStatus({ automation: { enabled: true, mode: 'remind', floorInterval: 1 } }, { targets: [blocks[0]] }),
]) {
    navigation.switchTab('automation');
    navigation.switchTab(status.action.tab);
    assert.equal(navigation.getActiveTab(), 'preview');
}

materials = { ...materials, targets: Array.from({ length: 10 }, (_, i) => ({ hash: 'b-' + i, messageId: i + 10, content: '剧情' })) };
auto.renderAutomationOverview();
assert.equal(action.hidden, true); assert.equal(action.dataset.bakemonoSummaryFocus, undefined);
assert.match(document.getElementById('bakemono-memory-automation-runtime-title').textContent, /已就绪/);
assert.equal(document.getElementById('bakemono-memory-automation-issues').querySelectorAll('button').length, 1);
materials.issues = []; auto.renderAutomationOverview();
assert.equal(document.getElementById('bakemono-memory-automation-issues'), null);
console.log('Automation recovery DOM: source choices/save, preserved settings, failure actions, safe issue text and cross-page record navigation passed.');
