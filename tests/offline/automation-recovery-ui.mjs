import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfigurationService } from '../../src/features/configuration-service.js';
import { createTurnSummaryUi } from '../../src/features/turn-summary-ui.js';
import { createTableManagementEvents } from '../../src/features/table-management-events.js';
import { createHubAutomationUi } from '../../src/features/hub-automation-ui.js';
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
        off() { return this; }, on(event, callback) { handlers.set(selector + ':' + event, callback); return this; },
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
const auto = createHubAutomationUi({ documentRef: document, query, getState: () => state,
    getStageMaterialOverview: () => ({ targets: [{ hash: 'a', content: '剧情' }], sourceMode: 'summaries', coveredCount: 0 }),
    getStageSourceModeLabel: () => '读取已有摘要', defaultAutomation: { floorInterval: 10, autoHidePreserveRecent: 2 } });
auto.renderAutomationOverview();
const action = document.getElementById('bakemono-memory-automation-next-action');
assert.equal(action.hidden, false); assert.equal(action.dataset.taskId, 'failed-task');
assert.equal(action.dataset.bakemonoTaskAction, 'retry');
assert.match(document.getElementById('bakemono-memory-automation-runtime-title').textContent, /失败/);
state.taskQueuePaused = true; auto.renderAutomationOverview();
assert.equal(action.dataset.taskId, undefined); assert.equal(action.dataset.bakemonoTab, 'drafts');
state.automation.enabled = false; auto.renderAutomationOverview(); assert.equal(action.hidden, true);
console.log('Automation recovery DOM: source choices/save, preserved manual settings, disabled controls and failure actions passed.');
