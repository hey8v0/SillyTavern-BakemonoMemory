import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeHost } from './helpers/rp-runtime-host.mjs';
import { parsePayload } from '../src/rp-core/extraction.js';
import { inspectSummaryMaterials } from '../src/features/summary-generation-controller.js';
import { stageAutomationStatus } from '../src/summary/automation-status.js';
import { summarySourceChoice, applySummarySourceChoice } from '../src/features/turn-trigger-policy.js';
import { createTurnProcessingController } from '../src/features/turn-processing-controller.js';
import { fixture as summaryFixture } from './helpers/summary-runtime.mjs';
import * as text from '../src/shared/text.js';
import { stripPostProcessNoise } from '../src/shared/prompt-utils.js';
import * as meta from '../src/summary/source-metadata.js';
import { createRpExtractionFlow } from '../src/rp-core/extraction-flow.js';

const noop = () => {};

test('stage progress describes the actual queue, including paused failures, rather than the enabled switch', () => {
    const targets = Array.from({ length: 14 }, (_, i) => ({ hash: String(i), messageId: i, content: '剧情内容' }));
    const materials = { targets, invalid: [] }, batch = targets.slice(0, 10);
    const state = { automation: { enabled: true, floorInterval: 10, mode: 'draft' }, taskQueue: [], drafts: [] };
    const status = (busy = false) => stageAutomationStatus(state, materials, { batch, busy });
    assert.equal(status().code, 'ready');
    state.taskQueuePaused = true; assert.equal(status().code, 'paused');
    state.taskQueuePaused = false;
    const task = { id: 't', kind: 'stage', sourceHashes: batch.map(b => b.hash), status: 'queued' };
    state.taskQueue.push(task); assert.equal(status().code, 'queued');
    task.status = 'running';
    assert.notEqual(status().code, 'running'); assert.equal(status(true).code, 'running');
    task.status = 'failed'; task.error = '接口超时';
    assert.deepEqual(status().action, { taskId: 't', label: '重试总结' });
    assert.equal(status().detail, '接口超时');
    state.taskQueuePaused = true; assert.equal(status().action.tab, 'drafts');
    state.taskQueuePaused = false; task.status = 'done'; state.drafts.push({ kind: 'stage', sourceHashes: task.sourceHashes });
    assert.equal(status().code, 'draft');
    state.automation.enabled = false; assert.equal(status().code, 'off');
});

test('invalid material is excluded from counts and blocks automatic generation with a floor-specific reason', async () => {
    const f = summaryFixture(14);
    f.state.stageSourceMode = 'raw';
    f.state.automation = { enabled: true, floorInterval: 10, mode: 'draft' };
    f.state.blocks = f.chat.map((m, i) => ({ hash: 'b' + i, type: 'story', sourceKind: 'raw', messageId: i, content: m.mes }));
    f.state.blocks[4].content = '<summary>输出推理过程</summary>';
    const materials = f.selectors.getStageMaterialOverview();
    assert.equal(materials.targets.length, 13);
    assert.match(materials.invalid[0], /第 4 楼/);
    assert.equal(stageAutomationStatus(f.state, materials).code, 'invalid');
    await f.controller.generateStageDraft({ automatic: true });
    assert.equal(f.state.taskQueue.length, 0);
    assert.equal(f.calls(), 0);
});

test('selecting automatic summary connects its prerequisite; legacy manual/off and table settings stay intact', () => {
    for (const enabled of [false, true]) {
        const state = { turnSummary: { enabled, auto: false, processingMode: 'both', prompt: '自定义' },
            inlineGeneration: { summaryEnabled: false, tableEnabled: true }, tableDatabase: { enabled: false }, stageSourceMode: 'raw' };
        const original = structuredClone(state), choice = summarySourceChoice(state);
        assert.equal(choice, enabled ? 'manual' : 'existing');
        applySummarySourceChoice(state, choice);
        assert.deepEqual(state, original);
        applySummarySourceChoice(state, 'independent');
        assert.equal(state.turnSummary.enabled, true); assert.equal(state.turnSummary.auto, true);
        assert.equal(state.stageSourceMode, 'backfill'); assert.equal(state.turnSummary.prompt, '自定义');
        assert.deepEqual(state.tableDatabase, original.tableDatabase);
        assert.equal(state.inlineGeneration.tableEnabled, true);
        applySummarySourceChoice(state, 'inline');
        assert.equal(state.turnSummary.enabled, false); assert.equal(state.inlineGeneration.summaryEnabled, true);
        assert.equal(state.stageSourceMode, 'summaries');
    }
    const legacy = { turnSummary: { enabled: true, auto: false }, inlineGeneration: { summaryEnabled: true } };
    const original = structuredClone(legacy);
    assert.equal(summarySourceChoice(legacy), 'legacy');
    applySummarySourceChoice(legacy, 'legacy'); assert.deepEqual(legacy, original);
    const tableOnly = { turnSummary: { enabled: true, auto: true, processingMode: 'table' }, inlineGeneration: { summaryEnabled: false } };
    const tableOriginal = structuredClone(tableOnly);
    assert.equal(summarySourceChoice(tableOnly), 'legacy');
    applySummarySourceChoice(tableOnly, 'legacy'); assert.deepEqual(tableOnly, tableOriginal);
    applySummarySourceChoice(tableOnly, 'independent'); assert.equal(tableOnly.turnSummary.processingMode, 'both');
});

function turnFixture(onCall) {
    const f = summaryFixture(2);
    f.chat[0].is_user = true;
    f.state.turnSummary = { enabled: true, auto: true, includeUserMessage: true, includeCharacterContext: false,
        processingMode: 'summary', excludeTags: 'aside', saveMode: 'draft' };
    let calls = 0;
    const controller = createTurnProcessingController({
        getContext: () => ({ chat: f.chat }), getChat: () => f.chat, ensureState: () => f.state, summarySources: f.source,
        ...text, ...meta, stripPostProcessNoise, blockTypes: { STORY: 'story' },
        turnProcessingModes: { SUMMARY: 'summary', TABLE: 'table', BOTH: 'both' },
        hasAppliedTableEditForMessage: () => false, renderGenerationPrompt: (_prompt, blocks) => blocks.map(b => b.content).join('\n'),
        defaultTurnSummaryPrompt: '摘要', normalizeGeneratedBakemono: value => value,
        extractTaggedContent: value => value, createDraft: f.service.createDraft,
        saveState: noop, updateInjectionFromSummaries: noop, saveChatConditional: async () => {},
        renderWorkbenchScope: noop, workbenchRenderScopes: {}, toastr: { info: noop },
        runGeneration: async (_label, fn) => fn(), callGenerationModel: async () => { calls++; await onCall?.(f); return '已生成的摘要'; },
    });
    return { ...f, controller, calls: () => calls };
}

test('per-turn provenance accepts same-text object replacement, excluded changes and newly appended floors', async () => {
    for (const mutate of [
        f => { f.chat[1] = { ...f.chat[1] }; },
        f => { f.chat[1].mes += '<aside>不会交给摘要模型的内容</aside>'; },
        f => { f.chat.push({ mes: '下一楼', name: 'actor', send_date: 'new-date' }); },
    ]) {
        const f = turnFixture(mutate);
        await f.controller.processLatestTurnSummary({ manual: true });
        assert.equal(f.state.drafts.length, 1);
        assert.equal(f.state.turnSummary.lastRun.status, 'done');
    }
});

test('per-turn provenance rejects changed body, included user input, reply variant and chat switch', async () => {
    for (const mutate of [
        f => { f.chat[1].mes += '正文改写'; }, f => { f.chat[0].mes += '用户改写'; },
        f => { f.chat[1].swipe_id = 1; }, f => { f.replaceState(structuredClone(f.state)); },
    ]) {
        const f = turnFixture(mutate);
        await assert.rejects(f.controller.processLatestTurnSummary({ manual: true }), /变化|切换|来源|输入|版本/);
        assert.equal(f.state.drafts.length, 0);
    }
});

test('failed automatic per-turn processing waits for an explicit retry instead of calling the model on every event', async () => {
    const f = turnFixture(() => { throw Error('接口超时'); });
    await assert.rejects(f.controller.processLatestTurnSummary(), /接口超时/);
    await f.controller.processLatestTurnSummary();
    assert.equal(f.calls(), 1);
    await assert.rejects(f.controller.processLatestTurnSummary({ manual: true }), /接口超时/);
    assert.equal(f.calls(), 2);
    assert.equal(f.state.turnSummary.lastRun.status, 'failed');
});

test('RP accepts an optional JSON fence, but rejects broken JSON without guessing values', () => {
    assert.equal(parsePayload('<rpEvents>```json\n{"version":2,"events":[]}\n```</rpEvents>').length, 0);
    assert.throws(() => parsePayload('<rpEvents>{"version":2,"events":[}</rpEvents>'), /JSON/);
});

test('unchanged invalid inline RP notifies once and a corrected protocol is read again', async () => {
    const h = runtimeHost(); await h.service.enable();
    h.chat[0].mes += '<rpEvents>{"version":2,"events":[}</rpEvents>';
    for (let i = 0; i < 3; i++) await h.orchestrator.runMemoryOrchestrator('回复完成', { scan: false });
    assert.equal(h.warnings.length, 1);
    assert.equal(h.state.rpCore.facts.length, 0);
    h.chat[0].mes = '甲进入书店。<rpEvents>{"version":2,"events":[]}</rpEvents>';
    assert.equal(await h.flow.captureInline(), true);
});

test('concurrent inline events report one error, and failed-protocol dedup survives flow recreation', async () => {
    const h = runtimeHost(); await h.service.enable();
    h.chat[0].mes += '<rpEvents>{"version":2,"events":[}</rpEvents>';
    const results = await Promise.allSettled([h.flow.captureInline(), h.flow.captureInline(), h.flow.captureInline()]);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const reloaded = createRpExtractionFlow({ getState: () => h.state, getChat: () => h.chat, service: h.service });
    assert.equal(await reloaded.captureInline(), false);
    h.chat[0].mes = '甲进入书店。<rpEvents>{"version":2,"events":';
    assert.equal((await reloaded.captureInline({ detailed: true })).status, 'incomplete');
    h.chat[0].mes = '甲进入书店。<rpEvents>{"version":2,"events":[]}</rpEvents>';
    assert.equal(await reloaded.captureInline(), true);
    assert.equal(h.state.rpCore.facts.length, 0);
});

test('disclosure headings alone are not summary material; custom prose remains valid', () => {
    assert.equal(inspectSummaryMaterials([{ messageId: 98, content: '<summary>输出推理过程</summary>' }]).invalid.length, 1);
    assert.equal(inspectSummaryMaterials([{ content: '<summary>甲在书店找到了钥匙。</summary>' }]).invalid.length, 0);
    assert.equal(inspectSummaryMaterials([{ content: '<details><summary>剧情摘要</summary><p>甲进入书店。</p></details>' }]).invalid.length, 0);
});
