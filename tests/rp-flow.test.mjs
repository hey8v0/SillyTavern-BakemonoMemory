import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpCoreService } from '../src/rp-core/service.js';
import { createRpExtractionFlow, stripRpProtocol } from '../src/rp-core/extraction-flow.js';
import { createTurnProcessingController } from '../src/features/turn-processing-controller.js';
import { createTableWorkflowController } from '../src/features/table-workflow-controller.js';
import { createInjectionService } from '../src/features/injection-service.js';
import { createMemoryOrchestrator } from '../src/features/memory-orchestrator.js';

async function fixture() {
    let state = { inlineGeneration: {}, turnSummary: { enabled: true }, tableDatabase: { tables: [] } }, saves = 0, id = 0;
    const chat = [{ mes: '甲来到这里。' }];
    const getState = () => state;
    let afterSave = () => {};
    const service = createRpCoreService({ getState, getChat: () => chat, saveState: () => ({}), saveChat: async () => { saves++; afterSave(); }, makeSourceId: () => String(++id) });
    await service.enable();
    const flow = createRpExtractionFlow({ getState, getChat: () => chat, service, makeSourceId: () => String(++id) });
    return { flow, service, chat, getState, switchChat: () => { state = { ...state }; }, saves: () => saves,
        onSave: callback => { afterSave = callback; } };
}
const response = '<summaryDraft>摘要</summaryDraft><rpEvents>' + JSON.stringify({ version: 1, events: [
    { track: 'facts', action: 'person_created', data: { id: 'temporary', name: '甲' }, excerpt: '甲来到这里' },
] }) + '</rpEvents>';

test('unknown ledger versions disable extraction and memory projection without changing saved data', async () => {
    const f = await fixture();
    f.getState().rpCore.schemaVersion = 99;
    const before = JSON.stringify(f.getState());
    assert.equal(f.flow.channel(), null);
    assert.equal(f.flow.prompt('reply'), '');
    assert.equal(f.service.memoryView(), null);
    assert.throws(() => f.service.view(), /不支持/);
    assert.equal(JSON.stringify(f.getState()), before);
});

test('reply reuse consumes existing response and suppresses identical automatic reprocessing', async () => {
    const f = await fixture();
    assert.equal(f.flow.channel(), 'reply');
    const ticket = f.flow.capture(0, 'reply');
    assert.match(f.flow.prompt('reply'), /rpEvents/);
    await f.flow.consume(ticket, response);
    assert.equal(f.getState().rpCore.facts.length, 1);
    const saves = f.saves();
    assert.equal((await f.flow.consume(f.flow.capture(0, 'reply'), response)).status, 'unchanged');
    assert.equal(f.saves(), saves);
    assert.equal(stripRpProtocol(response), '<summaryDraft>摘要</summaryDraft>');
});

test('source edits, chat changes and newer ledger revisions reject old extraction results', async () => {
    for (const mutation of ['source', 'chat', 'revision']) {
        const f = await fixture(), ticket = f.flow.capture(0, 'reply');
        if (mutation === 'source') f.chat[0].mes = '甲没有来。';
        if (mutation === 'chat') f.switchChat();
        if (mutation === 'revision') f.getState().rpCore.revision++;
        await assert.rejects(f.flow.consume(ticket, response), /变化/);
        assert.equal(f.getState().rpCore.facts.length, 0);
    }
});

test('source changes while saving cannot resume downstream work on the stale response', async () => {
    const f = await fixture(), ticket = f.flow.capture(0, 'reply');
    f.onSave(() => { f.chat[0].mes = '甲没有来。'; });
    await assert.rejects(f.flow.consume(ticket, response), /变化/);
    assert.equal(f.service.view().projection.people.length, 0);
    assert.equal(f.service.view().pending.length, 1);
});

test('inline and reply reuse select one channel and delay stays bound to the original reply', async () => {
    const f = await fixture();
    Object.assign(f.getState().inlineGeneration, { summaryEnabled: true });
    f.getState().turnSummary.triggerTiming = 'next_user';
    f.chat[0].mes += response;
    assert.equal(f.flow.channel(), 'inline');
    assert.equal(f.flow.capture(0, 'reply'), null);
    assert.equal(await f.flow.captureInline(), false);
    f.chat.push({ is_user: true, mes: '继续' });
    assert.equal(await f.flow.captureInline(), true);
    assert.equal(f.getState().rpCore.facts[0].order, 0);
    assert.equal(f.getState().rpCore.facts[0].floor, 1);
});

test('no compatible workflow is reported as unavailable and missing protocol does not create a batch', async () => {
    const f = await fixture();
    assert.equal((await f.flow.consume(f.flow.capture(0, 'reply'), '只有摘要')).status, 'missing');
    assert.equal(f.getState().rpCore.batches.length, 0);
    f.getState().turnSummary.enabled = false;
    assert.equal(f.flow.channel(), null);
    assert.equal(f.flow.prompt('reply'), '');
});

test('the real summary controller reuses one response and rejects changed source before creating a draft', async () => {
    for (const stale of [false, true]) {
        const f = await fixture(), state = f.getState();
        Object.assign(state.turnSummary, { processingMode: 'summary', includeCharacterContext: false, includeUserMessage: false, saveMode: 'draft' });
        state.drafts = []; state.storySummaries = [];
        let requests = 0;
        const controller = createTurnProcessingController({ getContext: () => ({ chat: f.chat }), getChat: () => f.chat,
            ensureState: f.getState, rpExtractionFlow: f.flow, getHash: String, blockTypes: { STORY: 'story' },
            turnProcessingModes: { SUMMARY: 'summary', TABLE: 'table', BOTH: 'both' },
            stripPostProcessNoise: String, filterTextByConfiguredTags: String, parseList: () => [],
            getSourceMessageIdsFromBlocks: blocks => blocks.map(block => block.messageId), getSourceStart: () => 0,
            renderGenerationPrompt: () => '处理这段正文', formatSourceRange: String,
            runGeneration: async (_title, fn) => fn(), callGenerationModel: async request => {
                requests++; assert.match(request.systemPrompt, /rpEvents/);
                if (stale) f.chat[0].mes = '甲没有来';
                return response;
            },
            extractTaggedContent: value => /<summaryDraft>([\s\S]*?)<\/summaryDraft>/.exec(value)?.[1] || '',
            normalizeGeneratedBakemono: String, createDraft: draft => { state.drafts.push(draft); return draft; },
            saveState() {}, saveChatConditional: async () => {}, updateInjectionFromSummaries() {},
            renderWorkbenchScope() {}, workbenchRenderScopes: {}, toastr: { info() {}, warning() {} },
            hasAppliedTableEditForMessage: () => false,
        });
        if (stale) await assert.rejects(controller.processLatestTurnSummary({ manual: true }), /变化/);
        else await controller.processLatestTurnSummary({ manual: true });
        assert.equal(requests, 1);
        assert.equal(state.drafts.length, stale ? 0 : 1);
        assert.equal(state.rpCore.candidates.length, stale ? 0 : 1);
        if (!stale) assert.equal(state.drafts[0].content, '摘要');
    }
});

test('table-only processing can consume RP events without an extra model request', async () => {
    const f = await fixture(), state = f.getState();
    state.turnSummary.enabled = false;
    state.tableDatabase = { enabled: true, tables: [{}], editDrafts: [] };
    let requests = 0;
    const controller = createTableWorkflowController({ getState: f.getState, rpExtractionFlow: f.flow,
        findLatestAssistantTurn: () => ({ assistantMessage: { messageId: 0 } }),
        buildLatestTurnBlocks: () => [{ content: f.chat[0].mes, messageId: 0 }],
        runGeneration: async (_title, fn) => fn(), buildTableEditPrompt: () => '',
        buildTurnReferenceSystemPrompt: () => '', callGenerationModel: async () => { requests++; return response; },
        createTableEditDraft: () => null, saveState() {}, saveChatConditional: async () => {},
        renderWorkbenchScope() {}, workbenchRenderScopes: {}, toastr: { info() {}, warning() {} },
    });
    await controller.processLatestTableEdit();
    assert.equal(requests, 1);
    assert.equal(state.rpCore.facts.length, 1);
});

test('inline prompts use exactly one existing slot, including when both legacy outputs are enabled', async () => {
    const f = await fixture(), state = f.getState();
    const prompts = new Map();
    const injection = createInjectionService({ ensureState: f.getState, rpExtractionFlow: f.flow,
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        inlinePromptKeys: { SUMMARY: 'summary', TABLE: 'table' },
        defaultInlineSummaryPrompt: '生成摘要', defaultInlineTablePrompt: '生成表格',
        formatTableDataForPrompt: () => '', formatTableGuideForPrompt: () => '',
        formatSpecificTablesForPrompt: () => '', getReadonlyTables: () => [], getWritableTables: () => [],
        setExtensionPrompt: (key, value) => prompts.set(key, value),
    });
    for (const summaryEnabled of [true, false]) {
        Object.assign(state.inlineGeneration, { summaryEnabled, tableEnabled: true });
        injection.syncInlineGenerationPrompts();
        assert.equal([...prompts.values()].filter(text => text.includes('<rpEvents>')).length, 1);
        assert.match(prompts.get(summaryEnabled ? 'summary' : 'table'), /rpEvents/);
    }
    state.rpCore.settings.enabled = false;
    injection.syncInlineGenerationPrompts();
    assert.equal([...prompts.values()].some(text => text.includes('<rpEvents>')), false);
});

test('new-user orchestration captures delayed inline events even after legacy inline capture was marked processed', async () => {
    const f = await fixture(), state = f.getState();
    Object.assign(state.inlineGeneration, { summaryEnabled: true });
    state.turnSummary.triggerTiming = 'next_user';
    state.turnSummary.auto = false;
    f.chat[0].mes += response;
    f.chat.push({ is_user: true, mes: '继续' });
    const orchestrator = createMemoryOrchestrator({ ensureState: f.getState, rpExtractionFlow: f.flow,
        getCurrentFloorMemoryIndex: () => ({}), getMemoryOrchestrationPlan: () => ({ actions: {} }),
        shouldRunTurnProcessing: () => true, syncInjection() {},
    });
    await orchestrator.runMemoryOrchestrator('新一轮', { scan: false, turnOnly: true });
    assert.equal(state.rpCore.facts.length, 1);
    assert.equal(state.rpCore.facts[0].order, 0);
    await orchestrator.runMemoryOrchestrator('重复通知', { scan: false, turnOnly: true });
    assert.equal(state.rpCore.facts.length, 1);
});

test('independent extraction is opt-in, records progress and never silently retries a failed paid request', async () => {
    const f = await fixture(); let requests = 0, fails = true;
    const flow = createRpExtractionFlow({ getState: f.getState, getChat: () => f.chat, service: f.service,
        callGenerationModel: async request => { requests++; assert.match(request.systemPrompt, /rpEvents/); assert.equal(request.prompt, '甲来到这里。'); if (fails) throw new Error('接口失败'); return response; } });
    assert.equal(await flow.runIndependent(), false);
    assert.equal(requests, 0);
    await f.service.configure({ mode: 'independent' });
    await assert.rejects(flow.runIndependent(), /接口失败/);
    assert.equal(f.getState().rpCore.extractionJobs[0].status, 'failed');
    assert.equal(await flow.runIndependent(), false);
    assert.equal(requests, 1);
    fails = false;
    assert.equal(await flow.runIndependent({ manual: true }), true);
    assert.equal(f.getState().rpCore.extractionJobs[0].status, 'done');
    assert.equal(f.getState().rpCore.candidates.length, 1);
    assert.equal(await flow.runIndependent(), false);
    assert.equal(requests, 2);
});

test('stopping an independent request rejects a late host response without facts', async () => {
    const f = await fixture(); await f.service.configure({ mode: 'independent' });
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const flow = createRpExtractionFlow({ getState: f.getState, getChat: () => f.chat, service: f.service,
        callGenerationModel: async () => { started(); return new Promise(resolve => { release = resolve; }); } });
    const running = flow.runIndependent(); await ready;
    flow.stopIndependent(); release(response);
    await assert.rejects(running, /停止/);
    assert.equal(f.getState().rpCore.facts.length, 0);
    assert.equal(f.getState().rpCore.extractionJobs[0].status, 'paused');
});
