import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSummarySelectors } from '../../src/features/summary-selectors.js';
import { createSummaryGenerationUi } from '../../src/features/summary-generation-ui.js';
import { createHubAutomationUi } from '../../src/features/hub-automation-ui.js';
import { createWorkbenchRenderer } from '../../src/features/workbench-renderer.js';
import { dedupeByHash } from '../../src/shared/collections.js';
const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const { document } = parseHTML(await readFile(new URL('../../settings.html', import.meta.url), 'utf8'));
const all = Array.from({ length: 10 }, (_, i) => ({ hash: `s${i}`, type: 'story', sourceKind: 'tag', content: '摘要正文' }));
const state = { storySummaries: all.slice(0, 7), blocks: all.slice(7), stageSummaries: [], epicSummaries: [], drafts: [],
    stageSourceMode: 'backfill', automation: { enabled: true, mode: 'draft', triggerType: 'count', floorInterval: 10 } };
const selectors = createSummarySelectors({ getState: () => state, getBlocksByType: () => state.blocks,
    blockTypes: { STORY: 'story' }, stageSourceModes: { BACKFILL: 'backfill', SUMMARIES: 'summaries', MIXED: 'mixed' },
    workflowModes: {}, dedupeByHash, summaryToBlock: value => value });
const query = selector => ({
    text(value) { document.querySelectorAll(selector).forEach(node => { node.textContent = String(value); }); return this; },
    css(key, value) { document.querySelectorAll(selector).forEach(node => { node.style[key] = value; }); return this; },
    toggleClass(name, enabled) { document.querySelectorAll(selector).forEach(node => node.classList.toggle(name, enabled)); return this; },
});
const dependencies = { documentRef: document, query, getState: () => state, ...selectors, defaultAutomation: { floorInterval: 10 },
    getStageSourceModeLabel: mode => mode === 'backfill' ? '仅读取插件已保存摘要' : '读取已有摘要' };
const summary = createSummaryGenerationUi(dependencies), automation = createHubAutomationUi(dependencies);
summary.render(state, { story: selectors.getStoryBlocks() }); automation.renderAutomationOverview();
assert.match(document.querySelector('#bakemono-memory-summary-generation-code').textContent, /7 条待整理/);
assert.match(document.querySelector('#bakemono-memory-automation-runtime-description').textContent, /3 条因来源设置未纳入/);
const input = document.querySelector('#bakemono-memory-auto-floor-interval'); input.value = '17';
const renderer = createWorkbenchRenderer({ ...dependencies, isWorkbenchOpen: () => true, getActiveTab: () => 'automation',
    renderAutomationOverview: automation.renderAutomationOverview, renderHeaderContext() {}, captureFeedback() {} });
state.storySummaries.push(...state.blocks); state.blocks = [];
for (const scope of ['drafts', 'summary', 'scan']) {
    renderer.renderScope(scope);
    assert.match(document.querySelector('#bakemono-memory-automation-rule-status').textContent, /10 \/ 10/);
    assert.equal(document.querySelector('#bakemono-memory-automation-progress-bar').style.width, '100%');
    assert.equal(input.value, '17', 'background refresh retains unsaved settings');
}
summary.render(state, { story: selectors.getStoryBlocks() });
assert.match(document.querySelector('#bakemono-memory-summary-generation-code').textContent, /10 条待整理/);
assert.equal(document.querySelector('#bakemono-memory-automation-runtime-description').textContent.includes('未纳入'), false);
console.log('Auto-summary DOM: selected-source counts, exclusion reason, live refresh and unsaved settings passed.');
