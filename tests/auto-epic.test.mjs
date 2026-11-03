import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemoryOrchestrator } from '../src/features/memory-orchestrator.js';
import { createSummaryGenerationController } from '../src/features/summary-generation-controller.js';

// Chapters pile up; a 多次总结 over the older ones keeps what goes with every message short. Automation offers it the
// way it offers a 阶段总结: a reminder, or a draft that waits for the user. It is never saved on its own.
const stage = i => ({ hash: `st${i}`, type: 'stage', content: `第${i}章的总结。`, sourceMessageIds: [i * 10, i * 10 + 2], sourceStart: i * 10, sourceEnd: i * 10 + 2 });
function orchestrator({ mode = 'draft', count = 6, enabled = true, epic = true, after = 6 } = {}) {
    const state = { automation: { enabled, mode, epicEnabled: epic, epicAfterStages: after, lastEpicSignature: '' }, turnSummary: {} };
    const calls = [], toasts = [], scopes = [];
    let stages = Array.from({ length: count }, (_, i) => stage(i));
    const o = createMemoryOrchestrator({ ensureState: () => state, isBusy: () => false, getHash: value => String(value.length) + value.slice(-40), saveState: () => {},
        defaultAutomation: { mode: 'remind' }, toastr: { info: (...args) => toasts.push(args) }, renderWorkbenchScope: (scope, text) => scopes.push(text), workbenchRenderScopes: { AUTOMATION: 'automation' },
        getUnsummarizedStageBlocks: () => stages, generateEpicDraft: async options => { calls.push(options); return { id: `task${calls.length}` }; } });
    return { o, state, calls, toasts, scopes, setStages: list => { stages = list; } };
}

test('enough chapters: the older ones go into a draft, the latest two stay as they are', async () => {
    const f = orchestrator();
    await f.o.maybeRunAutoEpic();
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0], { automatic: true, targetConfig: { mode: 'oldest', count: 4 } });
    await f.o.maybeRunAutoEpic();
    assert.equal(f.calls.length, 1, 'the same chapters are not asked for twice');
    f.setStages([...Array.from({ length: 6 }, (_, i) => stage(i)), stage(6)]);
    await f.o.maybeRunAutoEpic();
    assert.equal(f.calls.length, 2, 'one more chapter: a new batch');
    assert.equal(f.calls[1].targetConfig.count, 5);
});

test('fewer than the number, automation off, merging off, or only reminding: no draft', async () => {
    for (const options of [{ count: 5 }, { enabled: false }, { epic: false }]) {
        const f = orchestrator(options);
        await f.o.maybeRunAutoEpic();
        assert.equal(f.calls.length, 0, JSON.stringify(options));
        assert.equal(f.toasts.length, 0);
    }
    const remind = orchestrator({ mode: 'remind' });
    await remind.o.maybeRunAutoEpic();
    assert.equal(remind.calls.length, 0);
    assert.equal(remind.toasts.length, 1);
    assert.match(remind.scopes[0], /6 段阶段总结没有合并/);
    await remind.o.maybeRunAutoEpic();
    assert.equal(remind.toasts.length, 1, 'once per batch');
    const lower = orchestrator({ after: 3, count: 3 });
    await lower.o.maybeRunAutoEpic();
    assert.deepEqual(lower.calls[0].targetConfig, { mode: 'oldest', count: 1 });
});

test('a refusal before anything was queued does not use up the batch', async () => {
    const f = orchestrator();
    f.o.maybeRunAutoEpic.length;
    const refusing = createMemoryOrchestrator({ ensureState: () => f.state, isBusy: () => false, getHash: value => value, saveState: () => {}, defaultAutomation: {}, toastr: { info() {} },
        renderWorkbenchScope() {}, workbenchRenderScopes: {}, getUnsummarizedStageBlocks: () => Array.from({ length: 6 }, (_, i) => stage(i)), generateEpicDraft: async () => undefined });
    await refusing.maybeRunAutoEpic();
    assert.equal(f.state.automation.lastEpicSignature, '');
});

function generation(state) {
    const queued = [];
    const controller = createSummaryGenerationController({ getIsBusy: () => false, scanBlocks: () => {}, getState: () => state, summarySources: { assertMaterials() {}, capture: () => null },
        getUnsummarizedStageBlocks: () => state.stageSummaries, getUnsummarizedMultiSummaryBlocks: () => [], selectGenerationTargets: (blocks, config) => config.mode === 'oldest' ? blocks.slice(0, config.count) : blocks,
        renderGenerationPrompt: (template, blocks) => blocks.map(block => block.content).join('\n'), enqueueSummaryTask: task => { queued.push(task); return { id: `t${queued.length}`, ...task }; },
        getSourceMessageIdsFromBlocks: blocks => blocks.flatMap(block => block.sourceMessageIds), getNextMultiSummaryLevel: () => 1, getMultiSummaryLabel: () => '多次总结', getTargetSelectionLabel: () => '',
        formatSourceRange: ids => ids.join(','), getSourceStart: ids => Math.min(...ids), getSourceEnd: ids => Math.max(...ids), blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' },
        renderWorkbenchScope: () => {}, workbenchRenderScopes: {}, toastr: { info() {}, warning() {} } });
    return { controller, queued };
}

test('the automatic draft takes the oldest chapters it is given, returns its task, and is not queued twice', async () => {
    const state = { stageSummaries: Array.from({ length: 6 }, (_, i) => stage(i)), epicSummaries: [], generationPrompts: { epic: '{{blocks}}' }, generationTargets: { epic: { mode: 'all' } }, taskQueue: [], drafts: [] };
    const g = generation(state);
    const task = await g.controller.generateEpicDraft({ automatic: true, targetConfig: { mode: 'oldest', count: 4 } });
    assert.ok(task?.id, 'it returns the task');
    assert.deepEqual(g.queued[0].sourceHashes, ['st0', 'st1', 'st2', 'st3']);
    assert.equal(g.queued[0].trigger, 'auto');
    state.taskQueue.push({ kind: 'epic', status: 'queued', sourceHashes: ['st0', 'st1', 'st2', 'st3'] });
    assert.equal(await g.controller.generateEpicDraft({ automatic: true, targetConfig: { mode: 'oldest', count: 4 } }), undefined);
    assert.equal(g.queued.length, 1);
    state.taskQueue = [];
    state.drafts.push({ kind: 'epic', sourceHashes: ['st0', 'st1', 'st2', 'st3'] });
    assert.equal(await g.controller.generateEpicDraft({ automatic: true, targetConfig: { mode: 'oldest', count: 4 } }), undefined, 'a draft of the same chapters waits for the user');
});

test('the switch and the number are on the automation page, saved with it; an automatic 多次总结 is never saved on its own', () => {
    const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const html = read('settings.html');
    assert.match(html, /id="bakemono-memory-auto-epic-enabled"/);
    assert.match(html, /id="bakemono-memory-auto-epic-after"/);
    assert.match(read('src/config/defaults.js'), /epicEnabled: true,[\s\S]{0,80}epicAfterStages: 6,/);
    const service = read('src/features/configuration-service.js');
    assert.match(service, /epicEnabled: .*#bakemono-memory-auto-epic-enabled/);
    assert.match(service, /epicAfterStages: /);
    assert.match(service, /lastEpicSignature: ''/);
    assert.match(read('src/features/workbench-renderer.js'), /#bakemono-memory-auto-epic-after/);
    assert.match(read('src/features/summary-task-queue.js'), /mode === 'commit_hide' && task\.kind === blockTypes\.STAGE/, 'only a 阶段总结 is saved on its own');
    assert.match(read('index.js'), /generateEpicDraft: \(\.\.\.args\) => generateEpicDraft\(\.\.\.args\)/);
    assert.match(read('src/features/memory-orchestrator.js'), /await maybeRunAutoEpic\(\)/);
});
