import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../', import.meta.url);

function toDataModule(source) {
    return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function loadModule(path) {
    const source = await readFile(new URL(path, repoUrl), 'utf8');
    return await import(toDataModule(source));
}

test('vector storage compacts and normalizes embeddings deterministically', async () => {
    const storage = await loadModule('src/vector/storage.js');
    const source = Array.from({ length: 64 }, (_, index) => index + 1);
    const compact = storage.compactEmbedding(source, 32);

    assert.equal(compact.length, 32);
    const norm = Math.sqrt(compact.reduce((sum, value) => sum + value * value, 0));
    assert.ok(Math.abs(norm - 1) < 0.00001);
    assert.deepEqual(storage.compactEmbedding(['bad'], 32), []);
    assert.deepEqual(storage.compactEmbedding([3, 4], 32), [0.6, 0.8]);
});

test('save preparation clears runtime cache and bounds stored vector text', async () => {
    const storage = await loadModule('src/vector/storage.js');
    const vectorMemory = {
        embeddingDimensions: 32,
        maxStoredTextChars: 240,
        perMessageMaxChars: 300,
        embeddingCache: { stale: [1, 2, 3] },
        records: [{
            id: 'record-a',
            text: 'x'.repeat(260),
            matchedText: 'y'.repeat(260),
            embedding: Array.from({ length: 64 }, (_, index) => index + 1),
        }],
        lastHits: [{
            id: 'hit-a',
            text: 'z'.repeat(320),
            matchedText: 'm'.repeat(260),
        }],
    };

    storage.slimVectorMemoryForSave(vectorMemory, {
        embeddingDimensions: 128,
        maxStoredTextChars: 1200,
        perMessageMaxChars: 1600,
    });

    assert.deepEqual(vectorMemory.embeddingCache, {});
    assert.equal(vectorMemory.records[0].id, 'record-a');
    assert.equal(vectorMemory.records[0].text.length, 243);
    assert.equal(vectorMemory.records[0].matchedText.length, 243);
    assert.equal(vectorMemory.records[0].embedding.length, 32);
    assert.equal(vectorMemory.lastHits[0].text.length, 303);
    assert.equal(vectorMemory.lastHits[0].matchedText.length, 243);
});

test('persistence adapter prepares the current chat state before scheduling save', async () => {
    const persistence = await loadModule('src/core/persistence.js');
    const calls = [];
    const state = { id: 'current-chat' };
    const result = persistence.persistChatState(state, {
        prepare(current) {
            calls.push(`prepare:${current.id}`);
            current.prepared = true;
        },
        save() {
            calls.push(`save:${state.prepared}`);
            return 'queued';
        },
    });

    assert.equal(result, 'queued');
    assert.deepEqual(calls, ['prepare:current-chat', 'save:true']);
    assert.equal(state.prepared, true);
});

test('global persistence delegates once and missing callbacks remain safe', async () => {
    const persistence = await loadModule('src/core/persistence.js');
    let saves = 0;

    assert.equal(persistence.persistGlobalSettings(() => ++saves), 1);
    assert.equal(saves, 1);
    assert.equal(persistence.persistGlobalSettings(null), undefined);
    assert.equal(persistence.persistChatState(null, {}), undefined);
});

test('summary confirmation rolls back explicit save rejection and succeeds after staged persistence', async () => {
    const { createSummaryDraftService } = await loadModule('src/features/summary-draft-service.js');
    const state = {
        outputMode: 'plain',
        blocks: [], storySummaries: [], stageSummaries: [], epicSummaries: [],
        drafts: [{ id: 'draft-1', kind: 'stage', title: '阶段一', content: '内容', sourceHashes: ['story-1'], sourceMessageIds: [8], metadata: {} }],
        history: [], coveredBlockHashes: [], coveredStageHashes: [],
        generatedMemory: '', injection: {}, autoSummaryTransactions: [],
    };
    let shouldFail = true;
    let saveChatCalls = 0;
    const toastCalls = [];
    const service = createSummaryDraftService({
        getChat: () => [],
        ensureState: () => state,
        getHash: value => `hash:${String(value)}`,
        getBlockTitle: (_content, fallback) => fallback,
        blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' },
        toastr: {
            success: message => toastCalls.push(['success', message]),
            error: message => toastCalls.push(['error', message]),
            warning() {}, info() {}, clear() {},
        },
        saveChatConditional: async () => {
            saveChatCalls += 1;
            if (shouldFail) throw new Error('disk unavailable');
        },
        updateInjectionFromSummaries: () => { state.generatedMemory = state.stageSummaries.map(item => item.content).join('\n'); },
        saveState() {},
        renderWorkbenchScope() {},
        workbenchRenderScopes: { DRAFTS: 'drafts' },
        getSourceStart: ids => Math.min(...ids),
        getSourceEnd: ids => Math.max(...ids),
        getSummaryLevel: () => 1,
        sortSummariesBySource: items => items,
        unique: values => [...new Set(values)],
        mergeBlocks: (current, next) => [...current, ...next],
        getKindLabel: kind => kind,
        parseList: () => [],
        extractConfiguredSegments: () => [],
    });

    const failed = await service.commitDraft('draft-1');
    assert.equal(failed, null);
    assert.equal(state.drafts.length, 1);
    assert.equal(state.stageSummaries.length, 0);
    assert.equal(toastCalls.some(([type]) => type === 'success'), false);
    assert.equal(toastCalls.some(([type]) => type === 'error'), true);

    shouldFail = false;
    const saved = await service.commitDraft('draft-1');
    assert.equal(saved.title, '阶段一');
    assert.equal(state.drafts.length, 0);
    assert.equal(state.stageSummaries.length, 1);
    assert.equal(saveChatCalls, 2);
    assert.equal(toastCalls.at(-1)[0], 'success');
});

test('summary confirmation still writes to tavern when TT recovery storage quota is full', async () => {
    const { createSummaryDraftService } = await loadModule('src/features/summary-draft-service.js');
    const state = {
        outputMode: 'plain',
        blocks: [], storySummaries: [], stageSummaries: [], epicSummaries: [],
        drafts: [{ id: 'draft-quota', kind: 'stage', title: '阶段配额', content: '仍需保存', sourceHashes: ['story-1'], sourceMessageIds: [8], metadata: {} }],
        history: [], coveredBlockHashes: [], coveredStageHashes: [],
        generatedMemory: '', injection: {}, autoSummaryTransactions: [],
    };
    let saveChatCalls = 0;
    const toastCalls = [];
    const service = createSummaryDraftService({
        getChat: () => [],
        ensureState: () => state,
        getHash: value => `hash:${String(value)}`,
        getBlockTitle: (_content, fallback) => fallback,
        blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' },
        toastr: {
            success: message => toastCalls.push(['success', message]),
            error: message => toastCalls.push(['error', message]),
            warning: message => toastCalls.push(['warning', message]),
            info() {}, clear() {},
        },
        saveChatConditional: async () => { saveChatCalls += 1; },
        updateInjectionFromSummaries: () => { state.generatedMemory = state.stageSummaries.map(item => item.content).join('\n'); },
        saveState: () => ({ status: 'quota-exceeded', error: new Error('The quota has been exceeded') }),
        renderWorkbenchScope() {},
        workbenchRenderScopes: { DRAFTS: 'drafts' },
        getSourceStart: ids => Math.min(...ids),
        getSourceEnd: ids => Math.max(...ids),
        getSummaryLevel: () => 1,
        sortSummariesBySource: items => items,
        unique: values => [...new Set(values)],
        mergeBlocks: (current, next) => [...current, ...next],
        getKindLabel: kind => kind,
        parseList: () => [],
        extractConfiguredSegments: () => [],
    });

    const saved = await service.commitDraft('draft-quota');

    assert.equal(saved?.title, '阶段配额');
    assert.equal(saveChatCalls, 1);
    assert.equal(state.drafts.length, 0);
    assert.equal(state.stageSummaries.length, 1);
    assert.equal(toastCalls.some(([type]) => type === 'error'), false);
    assert.equal(toastCalls.some(([type]) => type === 'warning'), true);
});

test('scanned source-only summary can be removed from its original message', async () => {
    const { createSummaryDraftService } = await loadModule('src/features/summary-draft-service.js');
    const messages = Array.from({ length: 5 }, () => null);
    messages[4] = { mes: '正文\n<bakemono>幽灵摘要</bakemono>', swipes: ['正文\n<bakemono>幽灵摘要</bakemono>'], swipe_id: 0 };
    const state = {
        outputMode: 'plain',
        blocks: [{ hash: 'scan-4-1', messageId: 4, blockIndex: 0, sourceKind: 'tag', content: '<bakemono>幽灵摘要</bakemono>', title: '#4.1' }],
        storySummaries: [], stageSummaries: [], epicSummaries: [], drafts: [], history: [],
        coveredBlockHashes: [], coveredStageHashes: [], generatedMemory: '', injection: {}, autoSummaryTransactions: [],
    };
    let recoveryMessageIds = [];
    const service = createSummaryDraftService({
        getChat: () => messages,
        ensureState: () => state,
        blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' },
        toastr: { success() {}, error() {}, warning() {}, info() {}, clear() {} },
        saveChatConditional: async () => {},
        saveState: options => {
            recoveryMessageIds = options?.recoveryMessageIds || [];
            return { status: 'staged' };
        },
        scanBakemonoBlocks() {},
        updateInjectionFromSummaries() {},
        renderWorkbenchScope() {},
        workbenchRenderScopes: { SUMMARY: 'summary', DRAFTS: 'drafts' },
        confirmDanger: () => true,
        removeExactTextBlock: (text, block) => text.replace(block, '').trim(),
    });

    assert.equal(await service.removeScannedSummaryBlock('scan-4-1'), true);
    assert.equal(messages[4].mes, '正文');
    assert.equal(messages[4].swipes[0], '正文');
    assert.equal(state.blocks.length, 0);
    assert.deepEqual(recoveryMessageIds, [4]);
});

test('recovery journal restores newer summary state and patched message text after a crash', async () => {
    const { createSummaryRecoveryJournal } = await loadModule('src/core/summary-recovery-journal.js');
    const values = new Map();
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
    const chat = [{ mes: '旧正文', swipes: ['旧正文'], swipe_id: 0 }];
    const state = {
        persistenceRevision: 0,
        storySummaries: [], stageSummaries: [], epicSummaries: [], drafts: [], history: [],
        coveredBlockHashes: [], coveredStageHashes: [], autoSummaryTransactions: [], taskQueue: [],
        hiddenMessageIds: [1], customHiddenMessageIds: [], autoHideRecent: { managedMessageIds: [1] },
        turnSummary: { lastProcessedMessageId: null },
    };
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'chat-a' });

    state.storySummaries.push({ hash: 'saved-1', title: '第1楼', content: '不会再丢' });
    chat[0].mes = '旧正文\n\n<bakemono>补写摘要</bakemono>';
    chat[0].swipes[0] = chat[0].mes;
    const staged = journal.stage(state, chat, { messageIds: [0] });

    assert.equal(staged.status, 'staged');
    assert.equal(state.persistenceRevision, 1);

    const reloadedState = {
        persistenceRevision: 0,
        storySummaries: [], stageSummaries: [], epicSummaries: [], drafts: [], history: [],
        coveredBlockHashes: [], coveredStageHashes: [], autoSummaryTransactions: [], taskQueue: [],
        turnSummary: { lastProcessedMessageId: null },
    };
    const reloadedChat = [{ mes: '旧正文', swipes: ['旧正文'], swipe_id: 0 }];
    const recovered = journal.reconcile(reloadedState, reloadedChat);

    assert.equal(recovered.status, 'recovered');
    assert.equal(reloadedState.persistenceRevision, 1);
    assert.equal(reloadedState.storySummaries[0].content, '不会再丢');
    assert.deepEqual(reloadedState.hiddenMessageIds, [1]);
    assert.match(reloadedChat[0].mes, /补写摘要/);
    assert.equal(reloadedChat[0].swipes[0], reloadedChat[0].mes);
});

test('recovery journal clears itself after the same revision is observed in chat metadata', async () => {
    const { createSummaryRecoveryJournal } = await loadModule('src/core/summary-recovery-journal.js');
    const values = new Map();
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
    const state = {
        persistenceRevision: 0,
        storySummaries: [], stageSummaries: [], epicSummaries: [], drafts: [], history: [],
        coveredBlockHashes: [], coveredStageHashes: [], autoSummaryTransactions: [], taskQueue: [],
        turnSummary: {},
    };
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'chat-b' });
    journal.stage(state, []);

    const freshlyLoadedState = structuredClone(state);
    assert.equal(journal.reconcile(freshlyLoadedState, []).status, 'verified');
    assert.equal(journal.peek(), null);
});

test('recovery journal does not create a phantom revision when protected data is unchanged', async () => {
    const { createSummaryRecoveryJournal } = await loadModule('src/core/summary-recovery-journal.js');
    const values = new Map();
    let writes = 0;
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => {
            writes += 1;
            values.set(key, value);
        },
        removeItem: key => values.delete(key),
    };
    const state = {
        persistenceRevision: 0,
        storySummaries: [], stageSummaries: [], epicSummaries: [], drafts: [], history: [],
        coveredBlockHashes: [], coveredStageHashes: [], hiddenMessageIds: [], customHiddenMessageIds: [],
        autoHideRecent: {}, autoSummaryTransactions: [], taskQueue: [], turnSummary: {},
        tableDatabase: { tables: [], chatProfiles: [], profileRows: {} },
    };
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'chat-baseline' });

    assert.equal(journal.reconcile(state, []).status, 'none');
    assert.equal(journal.stage(state, []).status, 'unchanged');
    assert.equal(state.persistenceRevision, 0);
    assert.equal(writes, 0);
});

test('recovery journal keeps an unverified write-ahead copy until a fresh chat state confirms it', async () => {
    const { createSummaryRecoveryJournal } = await loadModule('src/core/summary-recovery-journal.js');
    const values = new Map();
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
    const makeState = () => ({
        persistenceRevision: 0,
        storySummaries: [], stageSummaries: [], epicSummaries: [], drafts: [], history: [],
        coveredBlockHashes: [], coveredStageHashes: [], hiddenMessageIds: [], customHiddenMessageIds: [],
        autoHideRecent: {}, autoSummaryTransactions: [], taskQueue: [], turnSummary: {},
        tableDatabase: { tables: [], chatProfiles: [], profileRows: {} },
    });
    const state = makeState();
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'chat-runtime-verification' });
    journal.reconcile(state, []);
    state.stageSummaries.push({ hash: 'stage-1', content: '不能提前删除' });

    assert.equal(journal.stage(state, []).status, 'staged');
    assert.equal(journal.reconcile(state, []).status, 'pending-verification');
    assert.notEqual(journal.peek(), null);

    const freshlyLoadedState = makeState();
    freshlyLoadedState.persistenceRevision = state.persistenceRevision;
    freshlyLoadedState.stageSummaries = structuredClone(state.stageSummaries);
    assert.equal(journal.reconcile(freshlyLoadedState, []).status, 'verified');
    assert.equal(journal.peek(), null);
});

test('recovery journal restores table rows together with summaries and drafts', async () => {
    const { createSummaryRecoveryJournal } = await loadModule('src/core/summary-recovery-journal.js');
    const values = new Map();
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
    const makeState = rows => ({
        persistenceRevision: 0,
        storySummaries: [], stageSummaries: [], epicSummaries: [], drafts: [], history: [],
        coveredBlockHashes: [], coveredStageHashes: [], hiddenMessageIds: [], customHiddenMessageIds: [],
        autoHideRecent: {}, autoSummaryTransactions: [], taskQueue: [], turnSummary: {},
        tableDatabase: {
            enabled: true,
            schemaScope: 'chat',
            tables: [{ id: 'characters', tableIndex: 0, name: '角色', columns: ['姓名'], rows }],
            chatProfiles: [],
            profileRows: {},
        },
    });
    const state = makeState([]);
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'chat-table-recovery' });
    journal.reconcile(state, []);
    state.tableDatabase.tables[0].rows.push(['阿青']);
    assert.equal(journal.stage(state, []).status, 'staged');

    const reloadedState = makeState([]);
    const recovered = journal.reconcile(reloadedState, []);
    assert.equal(recovered.status, 'recovered');
    assert.deepEqual(reloadedState.tableDatabase.tables[0].rows, [['阿青']]);
    assert.equal(recovered.tableRows, 1);
});

test('recovery journal suppresses recovered-data notices when only the revision is stale', async () => {
    const { createSummaryRecoveryJournal } = await loadModule('src/core/summary-recovery-journal.js');
    const values = new Map();
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
    const makeState = () => ({
        persistenceRevision: 0,
        storySummaries: [{ hash: 'same', content: '已经存在' }],
        stageSummaries: [], epicSummaries: [], drafts: [], history: [],
        coveredBlockHashes: [], coveredStageHashes: [], hiddenMessageIds: [], customHiddenMessageIds: [],
        autoHideRecent: {}, autoSummaryTransactions: [], taskQueue: [], turnSummary: {},
        tableDatabase: { tables: [], chatProfiles: [], profileRows: {} },
    });
    const state = makeState();
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'chat-revision-only' });
    journal.reconcile(state, []);
    state.drafts.push({ id: 'temporary', content: 'change' });
    journal.stage(state, []);

    const reloadedState = makeState();
    reloadedState.drafts = [{ id: 'temporary', content: 'change' }];
    assert.equal(journal.reconcile(reloadedState, []).status, 'revision-only');
});

test('chat state cleanup waits for a known complete baseline before pruning shorter chats', async () => {
    const { shouldSanitizeChatState } = await loadModule('src/core/chat-state-service.js');

    assert.equal(shouldSanitizeChatState(undefined, 12), false);
    assert.equal(shouldSanitizeChatState(12, 20), false);
    assert.equal(shouldSanitizeChatState(20, 12), true);
});

test('chat state slot follows SillyTavern when chat_metadata is replaced', async () => {
    const { ensureCurrentChatStateSlot } = await loadModule('src/core/chat-state-service.js');
    const storageKey = 'bakemonoMemory';
    let currentMetadata = {};

    const first = ensureCurrentChatStateSlot({
        getChatMetadata: () => currentMetadata,
        storageKey,
        createState: () => ({ marker: 'first' }),
    });
    assert.equal(first.isNewChatState, true);
    assert.equal(first.state, currentMetadata[storageKey]);

    const previousMetadata = currentMetadata;
    currentMetadata = { [storageKey]: { marker: 'loaded-by-sillytavern' } };
    const loaded = ensureCurrentChatStateSlot({
        getChatMetadata: () => currentMetadata,
        storageKey,
        createState: () => ({ marker: 'wrong-default' }),
    });

    assert.equal(loaded.isNewChatState, false);
    assert.equal(loaded.state, currentMetadata[storageKey]);
    assert.equal(loaded.state.marker, 'loaded-by-sillytavern');
    assert.equal(previousMetadata[storageKey].marker, 'first');
});

test('recovery journal retries quota failures with an essential payload', async () => {
    const { createSummaryRecoveryJournal } = await loadModule('src/core/summary-recovery-journal.js');
    const values = new Map();
    const attempts = [];
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => {
            const payload = JSON.parse(value);
            attempts.push(payload);
            if (attempts.length === 1) {
                const error = new Error('The quota has been exceeded');
                error.name = 'QuotaExceededError';
                throw error;
            }
            values.set(key, value);
        },
        removeItem: key => values.delete(key),
    };
    const state = {
        persistenceRevision: 0,
        storySummaries: [{ hash: 'story-1', content: '必须恢复' }],
        stageSummaries: [], epicSummaries: [], drafts: [{ id: 'draft-1', content: '草稿' }],
        history: [{ id: 'history-1', draft: { content: '重复历史', prompt: '很长提示词' } }],
        coveredBlockHashes: [], coveredStageHashes: [], hiddenMessageIds: [], customHiddenMessageIds: [],
        autoHideRecent: {}, autoSummaryTransactions: [{ id: 'transaction-1' }],
        taskQueue: [{ id: 'task-1', status: 'done', rawResult: '很长结果' }],
        turnSummary: { lastProcessedMessageId: 8 },
    };
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'tt-quota-chat' });

    const staged = journal.stage(state, []);

    assert.equal(staged.status, 'staged-compact');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].recoveryLevel, 'essential');
    assert.equal(attempts[1].state.storySummaries[0].content, '必须恢复');
    assert.equal(attempts[1].state.drafts[0].content, '草稿');
    assert.equal('history' in attempts[1].state, false);
    assert.equal('taskQueue' in attempts[1].state, false);
    assert.equal('autoSummaryTransactions' in attempts[1].state, false);
});

test('recovery journal reports quota degradation only after both payload sizes fail', async () => {
    const { createSummaryRecoveryJournal } = await loadModule('src/core/summary-recovery-journal.js');
    let attempts = 0;
    const storage = {
        getItem: () => null,
        setItem: () => {
            attempts += 1;
            const error = new Error('The quota has been exceeded');
            error.name = 'QuotaExceededError';
            throw error;
        },
        removeItem() {},
    };
    const state = {
        persistenceRevision: 4,
        storySummaries: [{ hash: 'story-1', content: '摘要' }],
        stageSummaries: [], epicSummaries: [], drafts: [], history: [],
        coveredBlockHashes: [], coveredStageHashes: [], hiddenMessageIds: [], customHiddenMessageIds: [],
        autoHideRecent: {}, autoSummaryTransactions: [], taskQueue: [], turnSummary: {},
    };
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'tt-full-chat' });

    const staged = journal.stage(state, []);

    assert.equal(staged.status, 'quota-exceeded');
    assert.equal(attempts, 2);
    assert.equal(state.persistenceRevision, 4);
});

test('persisted chat state omits rebuildable copies and compacts duplicate history payloads', async () => {
    const { buildPersistedChatState, installCompactStateSerializer } = await loadModule('src/core/persisted-chat-state.js');
    const state = {
        blocks: [{ hash: 'runtime', content: '重复正文' }],
        scanPreview: [{ preview: '重复预览' }],
        memoryRecords: [{ id: 'derived' }],
        generatedMemory: '长期记忆正文',
        injection: { enabled: true, template: '{{memory}}', content: '长期记忆正文' },
        history: [{
            id: 'commit-1',
            draft: { id: 'draft-1', content: '摘要正文', prompt: '很长的旧提示词' },
            summary: { hash: 'summary-1', title: '摘要', content: '摘要正文' },
        }],
        storySummaries: [{ hash: 'summary-1', content: '摘要正文' }],
        taskQueue: [{ id: 'done-1', status: 'done', prompt: '旧任务提示词', blocks: [{ content: '旧正文' }], rawResult: '旧结果' }],
    };

    const compact = buildPersistedChatState(state);
    assert.equal('blocks' in compact, false);
    assert.equal('scanPreview' in compact, false);
    assert.equal('memoryRecords' in compact, false);
    assert.equal('content' in compact.injection, false);
    assert.equal('content' in compact.history[0].summary, false);
    assert.equal(compact.storySummaries[0].content, '摘要正文');
    assert.equal(compact.taskQueue[0].prompt, '');
    assert.deepEqual(compact.taskQueue[0].blocks, []);
    assert.equal(state.blocks.length, 1);

    installCompactStateSerializer(state);
    const serialized = JSON.parse(JSON.stringify(state));
    assert.equal('blocks' in serialized, false);
    assert.equal(serialized.generatedMemory, '长期记忆正文');
});
