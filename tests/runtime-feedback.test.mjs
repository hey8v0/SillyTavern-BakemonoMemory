import test from 'node:test';
import assert from 'node:assert/strict';
import * as text from '../src/shared/text.js';
import { createTurnProcessingController } from '../src/features/turn-processing-controller.js';
import { createTableWorkflowController } from '../src/features/table-workflow-controller.js';
import { createVectorMemoryService } from '../src/features/vector-memory-service.js';
import { createInjectionService } from '../src/features/injection-service.js';
import { createSummaryMemoryModel } from '../src/features/summary-memory-model.js';
import { createOverviewTokenManifest } from '../src/features/overview-token-manifest.js';
import { renderInjectionTemplate } from '../src/shared/injection-template.js';
import { createVectorAutoRecall } from '../src/features/vector-auto-recall.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const noop = () => {};
function tableFixture() {
    const chat = [{ is_user: true, mes: '继续' }, { is_user: false, mes: '甲走进书店。' }];
    const state = { scanRules: {}, turnSummary: { includeUserMessage: true, lastProcessedMessageId: -1 }, tableDatabase: { tables: [{}], editDrafts: [] } };
    const turns = createTurnProcessingController({ ...text, getContext: () => ({ chat }), getChat: () => chat,
        ensureState: () => state, blockTypes: { STORY: 'story' }, stripPostProcessNoise: String });
    const calls = [], errors = [];
    let fail = false;
    const workflow = createTableWorkflowController({ ...turns, getState: () => state, toastr: { info: noop, warning: noop },
        runGeneration: async (_label, action) => { try { await action(); } catch (error) { errors.push(error.message); } },
        workbenchRenderScopes: { TABLES: 'tables' }, buildTableEditPrompt: () => 'prompt', buildTurnReferenceSystemPrompt: () => '',
        callGenerationModel: async () => { calls.push('model'); if (fail) throw Error('offline failure'); return ''; },
        createTableEditDraft: () => null, saveState: noop, renderWorkbenchScope: noop });
    return { state, chat, workflow, calls, errors, fail: () => { fail = true; } };
}

test('table generation passes state to source checks and reaches the model without includeUserMessage errors', async () => {
    const f = tableFixture();
    await f.workflow.processLatestTableEdit({ manual: true });
    assert.deepEqual(f.errors, []);
    assert.equal(f.calls.length, 1);
    assert.equal(f.state.turnSummary.lastProcessedMessageId, 1);
});

test('failed automatic table work waits for manual retry or changed source instead of resuming endlessly', async () => {
    const f = tableFixture(); f.fail();
    await f.workflow.processLatestTableEdit();
    await f.workflow.processLatestTableEdit();
    assert.equal(f.calls.length, 1);
    await f.workflow.processLatestTableEdit({ manual: true });
    assert.equal(f.calls.length, 2);
    f.chat[1].mes += '他拿起钥匙。';
    await f.workflow.processLatestTableEdit();
    assert.equal(f.calls.length, 3);
});

test('one failed auto index emits one warning and pauses automatic work until explicit retry', async () => {
    const state = { vectorMemory: { enabled: true, records: [], embeddingProvider: 'local' } };
    const timers = [], warnings = []; let attempts = 0;
    const service = createVectorMemoryService({ getState: () => state, defaultVectorMemory: { embeddingDimensions: 128 },
        setTimer: cb => { timers.push(cb); return timers.length; }, clearTimer: noop,
        getContext: () => { attempts++; throw Error('offline timeout'); }, toastr: { warning: t => warnings.push(t) },
        saveState: noop, renderWorkbenchScope: noop, workbenchRenderScopes: {} });
    const pending = [];
    for (let i = 0; i < 3; i++) { service.scheduleVectorAutoIndex(); pending.push(timers.at(-1)()); }
    await Promise.all(pending);
    assert.equal(attempts, 1); assert.equal(warnings.length, 1);
    const before = timers.length;
    service.scheduleVectorAutoIndex('focus');
    assert.equal(timers.length, before);
    assert.match(state.vectorMemory.lastIndexError, /暂停/);
    await assert.rejects(service.buildVectorMemoryIndex(), /offline timeout/);
    assert.equal(attempts, 2);
});

export function injectionFixture() {
    const state = { injection: { enabled: true, template: '{{memory}}', depth: 999 }, inlineGeneration: {}, generatedMemory: '',
        memoryStrategy: 'bakemono', blocks: [], storySummaries: [], epicSummaries: [],
        stageSummaries: [0, 1, 2].map(i => ({ hash: 'stage' + i, type: 'stage', content: '阶段总结' + i, sourceMessageIds: [i] })) };
    const model = createSummaryMemoryModel({ blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' },
        memoryStrategies: { GENERIC: 'generic' }, memoryRecordStatuses: { INJECTED: 'injected', SAVED: 'saved' },
        dedupeByHash: a => a, getSummarySortKey: s => s.sourceMessageIds?.[0] || 0, getSummaryLevel: () => 1,
        getFiniteMessageIds: a => a, unique: a => [...new Set(a)], getBlockTitle: String, formatSourceRange: a => a.join('-'), getKindLabel: String });
    const prompts = [];
    const injection = createInjectionService({ ...model, ensureState: () => state, memoryStrategies: { GENERIC: 'generic' },
        renderInjectedTablesSection: () => '', renderVectorMemorySection: () => '', setExtensionPrompt: (...args) => prompts.push(args),
        injectionKey: 'memory', extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        defaultState: { injection: { depth: 999 } }, inlinePromptKeys: {}, defaultInjectionTemplate: '{{memory}}', renderInjectionTemplate });
    const overview = createOverviewTokenManifest({ ...injection, getState: () => state, defaultInjectionTemplate: '{{memory}}' });
    return { state, model, injection, overview, prompts };
}

test('three selected stage summaries render and preview even when the persisted assembly cache is empty', () => {
    const f = injectionFixture();
    assert.equal(f.model.buildMemoryRecords(f.state).filter(r => r.status === 'injected').length, 3);
    assert.match(f.injection.renderInjectionContent(), /阶段总结2/);
    assert.match(f.overview.getOverviewInjectionSources().summary, /阶段总结2/);
    f.injection.syncInjection();
    assert.equal(f.prompts[0][1], f.injection.renderInjectionContent());
    f.state.stageSummaries[0].content = '新的阶段记忆';
    assert.match(f.injection.renderInjectionContent(), /新的阶段记忆/);
});

test('empty expected injection cannot claim that a previous model prompt verified it', () => {
    const f = injectionFixture(); f.state.stageSummaries = [];
    assert.equal(f.overview.doesLastPromptMatchCurrentInjection('别的上下文'), false);
});

test('main generation rebuilds stage injection even with vectors disabled and an empty cache', async () => {
    const f = injectionFixture(); f.state.vectorMemory = { enabled: false };
    const auto = createVectorAutoRecall({ getState: () => f.state, retrieve: () => assert.fail('no vector/model calls'),
        cancelRecall: noop, clear: noop, syncInjection: f.injection.syncInjection });
    await auto.intercept([], 8000, noop, 'normal');
    assert.match(f.prompts[0][1], /阶段总结2/);
    assert.equal(f.state.injection.content, f.prompts[0][1]);
});

// Execute the production save adapter, replacing only host I/O and form readers.
function saveAdapterFixture(globalSave, chatSave) {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const body = source.match(/async savePage\(tab, state\) \{([\s\S]*?)\n    \},\n\}\);/)[1];
    const state = { activeConfigSignature: 'initial' }, calls = [];
    const f = { state, current: state, calls };
    const readerNames = ['readRuleFieldsFromUi', 'readAutomationFieldsFromUi', 'readCustomApiFieldsFromUi',
        'readPromptFieldsFromUi', 'readInjectionFieldsFromUi', 'readTurnSummaryFieldsFromUi', 'readWorkflowFieldsFromUi'];
    const host = Object.fromEntries(readerNames.map(name => [name, s => { assert.equal(s, state); calls.push(name); }]));
    f.save = vm.runInNewContext('(async function(tab, state) {' + body + '\n})', { ...host,
        ensureState: () => f.current, applyVectorMemorySettings: async () => true,
        syncInjection: () => calls.push('sync'), scanBakemonoBlocks: () => calls.push('scan'),
        persistSharedConfigurationFromState: s => { s.activeConfigSignature = 'saved'; return {}; },
        confirmGlobalConfiguration: globalSave, saveChatConditional: chatSave });
    return f;
}

test('page save reads only its own form and waits for both global verification and chat save', async () => {
    let globalDone, chatDone;
    const f = saveAdapterFixture(() => new Promise(resolve => { globalDone = resolve; }),
        () => new Promise(resolve => { chatDone = resolve; }));
    let completed = false;
    const pending = f.save('injection', f.state).then(result => { completed = true; return result; });
    assert.deepEqual(f.calls, ['readInjectionFieldsFromUi', 'sync']);
    globalDone({ status: 'confirmed' }); await Promise.resolve(); await Promise.resolve();
    assert.equal(completed, false);
    chatDone(); assert.equal(await pending, true);
});

test('page save cannot report success on unconfirmed global save or failed chat save', async () => {
    for (const [globalSave, chatSave] of [
        [async () => ({ status: 'unconfirmed' }), async () => {}],
        [async () => ({ status: 'confirmed' }), async () => { throw Error('offline'); }],
    ]) {
        const f = saveAdapterFixture(globalSave, chatSave);
        assert.equal(await f.save('automation', f.state), false);
        assert.deepEqual(f.calls, ['readAutomationFieldsFromUi', 'sync']);
    }
});

test('page save rejects stale completion after switching chats', async () => {
    let done;
    const f = saveAdapterFixture(() => new Promise(resolve => { done = resolve; }), async () => {});
    const pending = f.save('prompts', f.state);
    f.current = { activeConfigSignature: 'other-chat' };
    done({ status: 'confirmed' });
    await assert.rejects(pending, /聊天或配置已变化/);
});
