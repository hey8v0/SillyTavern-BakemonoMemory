import test from 'node:test';
import assert from 'node:assert/strict';
import { createSummarySelectors } from '../src/features/summary-selectors.js';
import { createMemoryOrchestrator } from '../src/features/memory-orchestrator.js';
import { createSummaryGenerationController } from '../src/features/summary-generation-controller.js';
import { createWorkflowOverviewModel } from '../src/features/workflow-overview-model.js';
import { buildFloorMemoryIndex, createMemoryOrchestrationPlan } from '../src/memory/floor-memory-index.js';
import { createHubAutomationUi } from '../src/features/hub-automation-ui.js';
import { createSummaryGenerationUi } from '../src/features/summary-generation-ui.js';
import { createWorkbenchRenderer, workbenchRenderScopes } from '../src/features/workbench-renderer.js';
import { getHash } from '../src/shared/text.js';
import { dedupeByHash } from '../src/shared/collections.js';
import { findTargetContinuityGaps } from '../src/summary/target-selection.js';
import { fixture as memoryFixture } from './helpers/summary-runtime.mjs';

const noop = () => {};
const blockTypes = { STORY: 'story', STAGE: 'stage', EPIC: 'epic' };
const stageSourceModes = { SUMMARIES: 'summaries', BACKFILL: 'backfill', RAW: 'raw', AUTO: 'auto', MIXED: 'mixed' };
const defaults = { floorInterval: 10, charInterval: 100, triggerType: 'count', mode: 'remind' };
const block = (i, sourceKind = 'tag') => ({ hash: `s${i}`, type: 'story', sourceKind, messageId: i, content: `故事内容第 ${i} 条。` });

function fixture() {
    let state = { storySummaries: [], stageSummaries: [], epicSummaries: [], blocks: Array.from({ length: 10 }, (_, i) => block(i)),
        drafts: [], taskQueue: [], generationTargets: { stage: {} }, generationPrompts: { stage: '' }, stageSourceMode: 'summaries',
        automation: { ...defaults, enabled: true, lastSignature: '' } };
    const getState = () => state;
    const selectors = createSummarySelectors({ getState, getBlocksByType: type => state.blocks.filter(b => b.type === type),
        blockTypes, stageSourceModes, workflowModes: { GENERIC: 'generic' }, defaultAutomation: defaults,
        dedupeByHash, summaryToBlock: value => value, getSortedTargetBlocks: blocks => [...blocks].sort((a, b) => a.messageId - b.messageId) });
    let calls = 0, saves = 0, reminders = 0;
    let generate = async () => { calls++; return { id: 'queued' }; };
    const messages = [];
    const toastr = { info: value => { messages.push(value); reminders++; }, warning: value => messages.push(value) };
    const orchestrator = createMemoryOrchestrator({ ensureState: getState, isBusy: () => false, scanBakemonoBlocks: noop,
        ...selectors, getHash, saveState: () => { saves++; }, defaultAutomation: defaults, toastr,
        renderWorkbenchScope: noop, workbenchRenderScopes, generateStageDraft: options => generate(options) });
    const controller = createSummaryGenerationController({ getState, getIsBusy: () => false, scanBlocks: noop, readGenerationTargetSettings: noop, ...selectors,
        findTargetContinuityGaps, getFloorMemoryIndex: () => buildFloorMemoryIndex({ state,
            messages: state.blocks.map(b => ({ mes: b.content })) }), renderGenerationPrompt: (_p, targets) => targets.map(b => b.content).join('\n'),
        getSourceMessageIdsFromBlocks: targets => targets.map(b => b.messageId), formatSourceRange: ids => ids.join('-'), getSourceStart: ids => ids[0], getSourceEnd: ids => ids.at(-1),
        enqueueSummaryTask: task => { const queued = { ...task, id: `task${state.taskQueue.length}`, status: 'queued' }; state.taskQueue.push(queued); return queued; },
        blockTypes, toastr, renderWorkbenchScope: noop, workbenchRenderScopes });
    return { get state() { return state; }, selectors, orchestrator, controller, messages,
        setGenerate: fn => { generate = fn; }, switchChat: next => { state = next; }, counts: () => ({ calls, saves, reminders }) };
}

test('reminder does not consume automatic generation for the same material', async () => {
    const f = fixture();
    await f.orchestrator.maybeRunAutoSummary();
    await f.orchestrator.maybeRunAutoSummary();
    assert.equal(f.counts().reminders, 1);
    f.state.automation.mode = 'draft';
    await f.orchestrator.maybeRunAutoSummary();
    await f.orchestrator.maybeRunAutoSummary();
    assert.equal(f.counts().calls, 1);
});

test('pre-queue refusal or validation failure does not consume the trigger', async () => {
    for (const failsWithError of [false, true]) {
        const f = fixture(); f.state.automation.mode = 'draft'; let attempts = 0;
        f.setGenerate(async () => { attempts++; if (attempts === 1) { if (failsWithError) throw Error('材料无效'); return; } return { id: 'queued' }; });
        if (failsWithError) await assert.rejects(f.orchestrator.maybeRunAutoSummary(), /材料无效/);
        else await f.orchestrator.maybeRunAutoSummary();
        assert.equal(f.state.automation.lastSignature, '');
        await f.orchestrator.maybeRunAutoSummary();
        assert.equal(attempts, 2);
    }
});

test('rule changes are reconsidered but identical repeated events are deduplicated', async () => {
    const f = fixture(); await f.orchestrator.maybeRunAutoSummary();
    f.state.automation.floorInterval = 5;
    await f.orchestrator.maybeRunAutoSummary();
    assert.equal(f.counts().reminders, 2);
    f.state.stageSourceMode = 'mixed';
    await f.orchestrator.maybeRunAutoSummary();
    assert.equal(f.counts().reminders, 3);
});

test('concurrent triggers enqueue once and cannot save into a different chat', async () => {
    const f = fixture(); f.state.automation.mode = 'draft'; let release, attempts = 0;
    f.setGenerate(async () => { attempts++; await new Promise(resolve => { release = resolve; }); return { id: 'queued' }; });
    const pending = f.orchestrator.maybeRunAutoSummary();
    await f.orchestrator.maybeRunAutoSummary();
    assert.equal(attempts, 1);
    const previous = f.state; f.switchChat(structuredClone(previous));
    release(); await pending;
    assert.equal(f.counts().saves, 0);
    assert.equal(f.state.automation.lastSignature, '');
});

test('raw-only and auto-fallback materials reach the orchestration stage gate', () => {
    const f = fixture(); f.state.blocks = f.state.blocks.map(b => ({ ...b, sourceKind: 'raw' }));
    for (const mode of ['raw', 'auto']) {
        f.state.stageSourceMode = mode;
        const model = createWorkflowOverviewModel({ getState: () => f.state, getContext: () => ({}), getChat: () => [],
            buildFloorMemoryIndex, createMemoryOrchestrationPlan, ...f.selectors, getIsBusy: () => false, isTaskQueueRunning: () => false });
        assert.equal(f.selectors.getUnsummarizedStoryBlocks().length, 10);
        assert.equal(model.getMemoryOrchestrationPlan().actions.runStageAutomation, true);
    }
    f.state.stageSourceMode = 'backfill';
    const plan = createMemoryOrchestrationPlan({ aggregates: { uncoveredStoryCount: 10 } }, f.state, { stageMaterialCount: 0 });
    assert.equal(plan.actions.runStageAutomation, false);
});

function uiCapture() {
    const values = new Map();
    return { values, query: selector => ({ text(value) { values.set(selector, value); return this; }, css() { return this; }, toggleClass() { return this; } }),
        documentRef: { querySelectorAll: () => [], querySelector: () => null, getElementById: () => null } };
}

test('summary and automation progress use the selected pool and show source exclusions', () => {
    const f = fixture(); f.state.storySummaries = f.state.blocks.slice(0, 7); f.state.blocks = f.state.blocks.slice(7); f.state.stageSourceMode = 'backfill';
    const ui = uiCapture();
    const dependencies = { ...ui, getState: () => f.state, ...f.selectors, defaultAutomation: defaults, getStageSourceModeLabel: mode => mode === 'backfill' ? '仅读取插件已保存摘要' : '正文标签 + 插件摘要' };
    const summary = createSummaryGenerationUi(dependencies), auto = createHubAutomationUi(dependencies);
    summary.render(f.state, { story: f.selectors.getStoryBlocks() }); auto.renderAutomationOverview();
    assert.match(ui.values.get('#bakemono-memory-summary-generation-code'), /7 条待整理/);
    assert.match(ui.values.get('#bakemono-memory-automation-rule-status'), /7 \/ 10/);
    for (const id of ['summary-generation-description', 'automation-runtime-description']) {
        assert.match(ui.values.get(`#bakemono-memory-${id}`), /3 条.*来源|来源.*3 条/);
    }
    f.state.stageSourceMode = 'summaries'; summary.render(); auto.renderAutomationOverview();
    assert.match(ui.values.get('#bakemono-memory-summary-generation-code'), /10 条待整理/);
    assert.match(ui.values.get('#bakemono-memory-automation-rule-status'), /10 \/ 10/);
    f.state.automation.triggerType = 'chars'; auto.renderAutomationOverview();
    const chars = f.selectors.getUnsummarizedStoryBlocks().reduce((sum, b) => sum + b.content.length, 0);
    assert.match(ui.values.get('#bakemono-memory-automation-rule-status'), new RegExp(`${chars} / 100`));
});

test('no saved summaries reports the source mismatch instead of a ReferenceError', async () => {
    const f = fixture(); f.state.stageSourceMode = 'backfill';
    await f.controller.generateStageDraft({ automatic: true });
    await f.controller.generateStageBatchTasks();
    assert.equal(f.state.taskQueue.length, 0);
    assert.equal(f.messages.length, 2);
    assert.ok(f.messages.every(text => /正文标签摘要未被纳入/.test(text)));
});

test('raw orchestration reaches the actual controller and enqueues one batch', async () => {
    const f = fixture(); f.state.stageSourceMode = 'raw'; f.state.automation.mode = 'draft';
    f.state.blocks = f.state.blocks.map(b => ({ ...b, sourceKind: 'raw' }));
    const model = createWorkflowOverviewModel({ getState: () => f.state, getContext: () => ({}), getChat: () => f.state.blocks.map(b => ({ mes: b.content })),
        buildFloorMemoryIndex, createMemoryOrchestrationPlan, ...f.selectors, getIsBusy: () => false, isTaskQueueRunning: () => false });
    const runner = createMemoryOrchestrator({ ensureState: () => f.state, isBusy: () => false, ...f.selectors, ...model,
        scanBakemonoBlocks: noop, getHash, saveState: noop, defaultAutomation: defaults, toastr: { info: noop }, renderWorkbenchScope: noop,
        workbenchRenderScopes, generateStageDraft: f.controller.generateStageDraft, syncInjection: noop });
    await runner.runMemoryOrchestrator();
    await runner.runMemoryOrchestrator();
    assert.equal(f.state.taskQueue.length, 1);
    assert.equal(f.state.taskQueue[0].sourceHashes.length, 10);
});

test('coverage count changes after real stage save and releases after input changes', async () => {
    const f = memoryFixture(10); f.state.stageSourceMode = 'raw';
    f.state.blocks = f.chat.map((message, i) => ({ ...block(i, 'raw'), hash: `input-${i}`, content: message.mes }));
    assert.equal(f.selectors.getStageMaterialOverview().targets.length, 10);
    await f.stage('阶段记忆', [0, 1, 2]);
    let overview = f.selectors.getStageMaterialOverview();
    assert.equal(overview.coveredCount, 3); assert.equal(overview.targets.length, 7);
    f.chat[0].mes += ' changed';
    overview = f.selectors.getStageMaterialOverview();
    assert.equal(overview.coveredCount, 0); assert.equal(overview.targets.length, 10);
});

test('disabled automation, unmet threshold and genuine continuity gaps remain blocked', async () => {
    const f = fixture(); f.state.automation.enabled = false;
    await f.orchestrator.maybeRunAutoSummary(); assert.equal(f.counts().saves, 0);
    f.state.automation.enabled = true; f.state.automation.floorInterval = 11;
    await f.orchestrator.maybeRunAutoSummary(); assert.equal(f.counts().saves, 0);
    f.state.automation.floorInterval = 5; f.state.stageSourceMode = 'backfill';
    f.state.storySummaries = f.state.blocks.filter(b => b.messageId !== 1);
    f.state.blocks = f.state.blocks.map(b => ({ ...b, sourceKind: 'raw' }));
    await f.controller.generateStageDraft({ automatic: true });
    assert.equal(f.state.taskQueue.length, 0);
    assert.match(f.messages.at(-1), /补齐缺失摘要/);
});

test('stage generator returns the queued task, and does not duplicate pending or failed automatic work', async () => {
    for (const status of ['queued', 'running', 'failed']) {
        const f = fixture(); const task = await f.controller.generateStageDraft({ automatic: true });
        assert.equal(task, f.state.taskQueue[0]);
        task.status = status;
        await f.controller.generateStageDraft({ automatic: true });
        assert.equal(f.state.taskQueue.length, 1);
    }
});

test('new sources do not regenerate the first batch while its draft is awaiting save', async () => {
    const f = fixture(); const task = await f.controller.generateStageDraft({ automatic: true });
    task.status = 'done'; f.state.drafts.push({ kind: 'stage', sourceHashes: task.sourceHashes });
    f.state.blocks.push(block(10));
    await f.controller.generateStageDraft({ automatic: true });
    assert.equal(f.state.taskQueue.length, 1);
});

test('draft, summary and scan updates refresh visible progress without replacing unsaved form fields', () => {
    const f = fixture(); const ui = uiCapture(); let renders = 0;
    const renderer = createWorkbenchRenderer({ ...ui, getState: () => f.state, isWorkbenchOpen: () => true, getActiveTab: () => 'automation',
        renderAutomationOverview: () => { renders++; }, renderHeaderContext: noop, captureFeedback: noop });
    for (const scope of ['drafts', 'summary', 'scan']) renderer.renderScope(scope);
    assert.equal(renders, 3);
});
