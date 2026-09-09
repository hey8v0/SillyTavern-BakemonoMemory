import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureChronicle, captureChronicle, replayChronicle, markStoryChange, diffState, applyDeltas, setStoryTime, upsertEntity, bindCellEntity, getCurrentStateRows, refreshMemoryLinks, isMemoryCurrent, activeStoryCoverage } from '../src/memory/story-state.js';
import { createMemoryBackup, validateMemoryBackup, previewMemoryBackup, restoreMemoryBackup, createDiagnosticReport } from '../src/memory/backup-package.js';
import { getHash } from '../src/shared/text.js';
import { createTableMemoryModel } from '../src/features/table-memory-model.js';
import { mergeTableSchemaWithRows, toTableSchema } from '../src/tables/schema-utils.js';
import { buildPersistedChatState } from '../src/core/persisted-chat-state.js';
import { createInjectionService } from '../src/features/injection-service.js';
import { createSummaryRecoveryJournal } from '../src/core/summary-recovery-journal.js';
import { parseTableEditOperations } from '../src/tables/operation-parser.js';
import { createTableStateService } from '../src/features/table-state-service.js';

test('table undo and redo include the associated AI clock and entity state', () => {
    const { state, chat } = fixture();
    state.tableDatabase.chatProfiles = [{id:'p', tables:[]}];
    const service = createTableStateService({ getState: () => state, getHash, getFiniteMessageIds: ids => ids,
        tableSchemaScopes: {CHAT:'chat', GLOBAL:'global', CHARACTER:'character'}, normalizeTableSchemas: x => x,
        updateInjectionFromSummaries() {}, saveState: () => captureChronicle(state, chat), saveChatConditional() {},
        confirmDanger: () => true, renderWorkbenchScope() {}, workbenchRenderScopes: {}, toastr: {success(){}, info(){}} });
    const model = createTableMemoryModel({ getState: () => state, getFiniteMessageIds: ids => ids,
        pushTableUndoSnapshot: service.pushTableUndoSnapshot, normalizeTableText: String,
        saveCurrentTableProfileRows: service.saveCurrentTableProfileRows, updateInjectionFromSummaries() {} });
    model.applyTableOperations(parseTableEditOperations('setColumnKind(0, 1, "person")\nsetStoryClock({"date":"1889-10-15"})'), state, {sourceMessageIds:[1]});
    captureChronicle(state, chat);
    const entities = structuredClone(state.chronicle.entities);
    assert.ok(entities.length);
    service.undoLastTableOperation(state);
    assert.equal(state.chronicle.clock.date, '');
    assert.deepEqual(state.chronicle.entities, []);
    service.redoLastTableOperation(state);
    assert.equal(state.chronicle.clock.date, '1889-10-15');
    assert.deepEqual(state.chronicle.entities, entities);
});

test('AI table transaction maintains semantics and clock with source provenance atomically', () => {
    const { state, chat } = fixture();
    const model = createTableMemoryModel({ getState: () => state, getFiniteMessageIds: ids => ids,
        pushTableUndoSnapshot: () => ({ id: 'u' }), normalizeTableText: String,
        saveCurrentTableProfileRows() {}, updateInjectionFromSummaries() {} });
    const ops = parseTableEditOperations('<tableEdit>setColumnKind(0, 0, "item")\nsetColumnKind(0, 1, "person")\nsetStoryClock({"date":"1889-10-15","label":"夜晚"})\nupdateRow(0, 0, {"1":"Nana"})</tableEdit>');
    assert.equal(ops.length, 4);
    model.applyTableOperations(ops, state, { sourceMessageIds: [1] });
    assert.equal(state.chronicle.clock.date, '1889-10-15');
    assert.ok(state.chronicle.entities.some(e => e.name === 'Nana' && e.kind === 'person'));
    const table = state.tableDatabase.tables[0];
    const shared = { ...toTableSchema(table), columnKinds: ['text', 'text'] };
    assert.deepEqual(mergeTableSchemaWithRows(shared, table).columnKinds, ['item', 'person']);
    const reset = structuredClone(table);
    reset.columnKinds[1] = 'text'; reset.semanticOverrides[reset.columnIds[1]].kind = 'text';
    assert.equal(mergeTableSchemaWithRows({...shared, columnKinds:['item', 'person']}, reset).columnKinds[1], 'text');
    assert.equal(captureChronicle(state, chat).sources[0].floor, 1);
    const before = JSON.stringify(state);
    assert.throws(() => model.applyTableOperations(parseTableEditOperations('setStoryClock({"date":"1889-02-30"})')), /日期/);
    assert.equal(JSON.stringify(state), before);
    model.applyTableOperations(parseTableEditOperations('setStoryClock({"date":"1880-01-01","flashback":true})'), state, { sourceMessageIds: [1] });
    assert.equal(state.chronicle.clock.date, '1889-10-15');
    assert.equal(state.chronicle.clock.lastFlashback.date, '1880-01-01');
});

function fixture() {
    const chat = [{ mes: '交出银钥匙', send_date: 'a' }, { mes: '进入书房', send_date: 'b' }];
    const state = { tableDatabase: { schemaScope: 'chat', activeProfileId: 'p', profileRows: {}, chatProfiles: [],
        tables: [{ id: 't', tableIndex: 0, name: '物品', columns: ['名称', '持有人'], rows: [['银钥匙', '夏尔']], allowAiEdit: true }] },
        storySummaries: [{ hash: 's', content: '交付钥匙', sourceMessageIds: [0] }], stageSummaries: [], epicSummaries: [], drafts: [], coveredBlockHashes: [], coveredStageHashes: [],
        vectorMemory: { enabled: false, customApi: { apiKey: 'SECRET_KEY' }, records: [] }, automation: { customApi: { apiKey: 'PRIVATE' } } };
    ensureChronicle(state, chat); captureChronicle(state, chat);
    return { state, chat };
}

test('excluded widget mutations do not stale saved summaries, but actual story edits do', () => {
    const { state, chat } = fixture();
    state.vectorMemory.excludeTags = 'widget';
    refreshMemoryLinks(state, chat);
    chat[0].mes += '<widget>计时器</widget><script>run()</script>';
    refreshMemoryLinks(state, chat);
    assert.equal(isMemoryCurrent(state, state.storySummaries[0]), true);
    chat[0].mes = '没有交出银钥匙<widget>计时器</widget>';
    refreshMemoryLinks(state, chat);
    assert.equal(isMemoryCurrent(state, state.storySummaries[0]), false);
});

test('migration keeps table data, creates one baseline and does not invent prior history', () => {
    const { state, chat } = fixture();
    assert.equal(state.chronicle.baselineFloor, 1);
    assert.equal(state.chronicle.events.length, 0);
    assert.equal(state.tableDatabase.tables[0].rows[0][0], '银钥匙');
    assert.throws(() => replayChronicle(state.chronicle, { floor: 0 }), /基线/);
    assert.equal(captureChronicle(state, chat), null);
});

test('Delta stores source version, before/after values and floor cursor; snapshots are read only', () => {
    const { state, chat } = fixture();
    chat.push({ mes: '将钥匙交给Nana', send_date: 'c' });
    markStoryChange(state, { sourceMessageIds: [2], label: '转交钥匙', mode: 'source' });
    state.tableDatabase.tables[0].rows[0][1] = 'Nana';
    const event = captureChronicle(state, chat);
    assert.equal(event.sources[0].floor, 2); assert.ok(event.sources[0].revision);
    assert.ok(event.deltas.some(delta => delta.before === '夏尔' && delta.after === 'Nana'));
    const previous = replayChronicle(state.chronicle, { floor: 1 });
    assert.equal(previous.state.profiles['active:chat:p'][0].rows[0][1], '夏尔');
    previous.state.profiles['active:chat:p'][0].rows[0][1] = '篡改';
    assert.equal(state.tableDatabase.tables[0].rows[0][1], 'Nana');
    assert.equal(captureChronicle(state, chat), null);
});

test('structural edits, deletions, checkpoints and JSON reload replay to identical state', () => {
    const { state, chat } = fixture();
    for (let i = 0; i < 110; i++) {
        state.tableDatabase.tables[0].rows[0][1] = `角色${i}`;
        captureChronicle(state, chat);
    }
    assert.equal(state.chronicle.checkpoints.length, 2);
    const logOnly = { ...state.chronicle, checkpoints: [] };
    assert.deepEqual(replayChronicle(logOnly), replayChronicle(state.chronicle));
    const loaded = JSON.parse(JSON.stringify(state));
    loaded.tableDatabase.tables[0].rows = [];
    ensureChronicle(loaded, chat);
    assert.equal(loaded.tableDatabase.tables[0].rows[0][1], '角色109');
    assert.equal(captureChronicle(loaded, chat), null);
    loaded.tableDatabase.tables = [];
    captureChronicle(loaded, chat);
    assert.deepEqual(replayChronicle(loaded.chronicle).state.profiles['active:chat:p'], []);
});

test('array length changes and deletions replay with strict preconditions', () => {
    const before = { a: [1, 2], obj: { key: 2 } }, after = { a: [1, 2, 3], obj: {} };
    const changes = diffState(before, after);
    assert.deepEqual(applyDeltas(structuredClone(before), changes), after);
    assert.throws(() => applyDeltas({ a: [9] }, changes), /前置/);
    assert.throws(() => applyDeltas({}, [{ path: ['__proto__', 'polluted'], hasAfter: true, after: true }]), /非法/);
    assert.equal({}.polluted, undefined);
});

test('backfilled sources are recorded at observation floor, not retroactively at the source floor', () => {
    const { state, chat } = fixture();
    chat.push({ mes: '新的正文', send_date: 'c' });
    markStoryChange(state, { sourceMessageIds: [0], label: '旧档补课' });
    state.tableDatabase.tables[0].rows[0][1] = 'Nana';
    const event = captureChronicle(state, chat);
    assert.equal(event.observedFloor, 2);
    assert.equal(replayChronicle(state.chronicle, { floor: 1 }).sequence, 0);
    chat.pop(); state.tableDatabase.tables[0].rows[0][1] = '夏尔';
    const correction = captureChronicle(state, chat);
    assert.equal(correction.observedFloor, 2); assert.equal(correction.actualFloor, 1);
});

test('table schemas preserve stable row/column IDs and semantic bindings', () => {
    const { state } = fixture();
    const table = state.tableDatabase.tables[0];
    table.columnKinds = ['item', 'person'];
    const merged = mergeTableSchemaWithRows(toTableSchema(table), table);
    assert.deepEqual(merged.columnIds, table.columnIds);
    assert.deepEqual(merged.rowIds, table.rowIds);
    assert.deepEqual(merged.columnKinds, ['item', 'person']);
});

test('entity identity survives rename; ambiguous names are not guessed; type mismatch rejected', () => {
    const { state, chat } = fixture();
    const table = state.tableDatabase.tables[0]; table.columnKinds[1] = 'person';
    const entity = upsertEntity(state, { kind: 'person', name: '夏尔' });
    captureChronicle(state, chat);
    upsertEntity(state, { id: entity.id, kind: 'person', name: '夏尔伯爵' });
    assert.equal(getCurrentStateRows(state)[0].fields[1].value, '夏尔伯爵');
    const item = upsertEntity(state, { kind: 'item', name: '银钥匙' });
    assert.throws(() => bindCellEntity(state, table, 0, 1, item.id), /不匹配/);
    assert.throws(() => upsertEntity(state, { id: entity.id, kind: 'item', name: '错误' }), /类型/);
    table.rows[0][1] = '未知人物'; captureChronicle(state, chat);
    assert.equal(getCurrentStateRows(state)[0].fields[1].unresolved, true);
    upsertEntity(state, { kind: 'person', name: '同名' }); upsertEntity(state, { kind: 'person', name: '同名' });
    table.rows[0][1] = '同名'; captureChronicle(state, chat);
    assert.equal(getCurrentStateRows(state)[0].fields[1].unresolved, true);
});

test('story date, relative days and flashback are separate from wall clock', () => {
    const { state, chat } = fixture();
    assert.throws(() => setStoryTime(state, { relativeDays: 1 }), /锚点/);
    assert.throws(() => setStoryTime(state, { date: '2026-02-30' }), /无效/);
    setStoryTime(state, { date: '1889-10-15', label: '夜晚' }); captureChronicle(state, chat);
    setStoryTime(state, { relativeDays: 2 }); captureChronicle(state, chat);
    assert.equal(state.chronicle.clock.date, '1889-10-17');
    setStoryTime(state, { date: '1886-10-15', flashback: true }); captureChronicle(state, chat);
    assert.equal(state.chronicle.clock.date, '1889-10-17');
    assert.equal(state.chronicle.clock.lastFlashback.date, '1886-10-15');
    assert.equal(replayChronicle(state.chronicle, { sequence: 1 }).state.clock.date, '1889-10-15');
});

test('summary provenance invalidates ancestors after source edit or child replacement and retains originals', () => {
    const { state, chat } = fixture();
    state.stageSummaries.push({ hash: 'st', content: '阶段', sourceHashes: ['s'] });
    state.epicSummaries.push({ hash: 'ep', content: '长篇', sourceStageHashes: ['st'] });
    state.coveredBlockHashes = ['s']; refreshMemoryLinks(state, chat);
    assert.equal(isMemoryCurrent(state, { hash: 'ep' }), true);
    chat[0].mes = '重生成：没有交付'; refreshMemoryLinks(state, chat);
    for (const hash of ['s', 'st', 'ep']) assert.equal(isMemoryCurrent(state, { hash }), false);
    assert.equal(state.storySummaries[0].content, '交付钥匙');
    assert.equal(activeStoryCoverage(state).has('s'), false);
    state.storySummaries[0].content = '重新整理的摘要'; refreshMemoryLinks(state, chat);
    assert.equal(isMemoryCurrent(state, { hash: 's' }), true);
    assert.equal(isMemoryCurrent(state, { hash: 'st' }), false);
});

test('source identities follow unchanged messages, while shifted floor references require review', () => {
    const { state, chat } = fixture();
    state.storySummaries.push({ hash: 's2', content: '书房', sourceMessageIds: [1] }); refreshMemoryLinks(state, chat);
    const id = state.chronicle.sources[1].id;
    chat.shift(); refreshMemoryLinks(state, chat);
    assert.equal(state.chronicle.sources[0].id, id);
    assert.equal(isMemoryCurrent(state, { hash: 's2' }), false);
});

test('backup includes tag summaries and full ledger but excludes configuration, embeddings and active tasks', () => {
    const { state, chat } = fixture();
    state.taskQueue = [{ status: 'running', prompt: 'private prompt' }];
    const backup = createMemoryBackup(state, { chatKey: 'chat-a', chat, scanned: [{ type: 'story', hash: 'tag', content: '标签摘要', messageId: 1 }] });
    const raw = JSON.stringify(backup);
    assert.ok(!raw.includes('SECRET_KEY')); assert.ok(!raw.includes('PRIVATE')); assert.ok(!raw.includes('private prompt'));
    assert.equal(backup.memory.storySummaries.length, 2);
    const restored = validateMemoryBackup(raw);
    assert.equal(previewMemoryBackup(restored, { chatKey: 'chat-a', chat }).sameChat, true);
    assert.equal(previewMemoryBackup(restored, { chatKey: 'other', chat }).sameChat, false);
    restoreMemoryBackup(state, restored);
    assert.equal(state.vectorMemory.customApi.apiKey, 'SECRET_KEY');
    assert.equal(state.storySummaries[1].sourceKind, 'backup_tag');
    assert.deepEqual(state.taskQueue, []); assert.equal(state.tableDatabase.schemaScope, 'chat');
    ensureChronicle(state, chat);
    assert.equal(state.tableDatabase.tables[0].rows[0][0], '银钥匙');
});

test('backup rejects damaged checksum, future formats, malformed tables and unsafe keys', () => {
    const { state, chat } = fixture();
    const good = createMemoryBackup(state, { chat });
    assert.throws(() => validateMemoryBackup({ ...good, checksum: 'broken' }), /校验/);
    assert.throws(() => validateMemoryBackup({ ...good, formatVersion: 99 }), /支持/);
    const bad = structuredClone(good); bad.memory.tableDatabase.tables[0].rows = 'bad';
    const { checksum, ...payload } = bad; bad.checksum = getHash(JSON.stringify(payload));
    assert.throws(() => validateMemoryBackup(bad), /表格/);
    assert.throws(() => validateMemoryBackup('{"__proto__":{"polluted":true}}'), /不安全/);
});

test('diagnostic whitelist never serializes content, credentials, names, URLs or raw errors', () => {
    const { state } = fixture();
    state.lastError = 'https://secret.invalid sk-secrets'; state.chronicle.clock.label = '隐私剧情';
    const report = JSON.stringify(createDiagnosticReport(state, { storage: { localStorage: 'available', rawError: state.lastError } }));
    for (const text of ['SECRET_KEY', 'PRIVATE', '银钥匙', '夏尔', '隐私剧情', 'secret.invalid', 'sk-secrets']) assert.ok(!report.includes(text));
    assert.equal(JSON.parse(report).storage.indexedDB, 'untested');
});

test('compact chat serializer preserves authoritative ledger and semantic state', () => {
    const { state, chat } = fixture();
    setStoryTime(state, { label: '第二幕黄昏' }); captureChronicle(state, chat);
    const snapshot = buildPersistedChatState(state);
    assert.deepEqual(snapshot.chronicle, state.chronicle);
    assert.deepEqual(snapshot.tableDatabase.tables, state.tableDatabase.tables);
});

test('AI table operations validate whole transaction before mutating tables or undo history', () => {
    const { state } = fixture(); let snapshots = 0;
    const model = createTableMemoryModel({ getState: () => state, getFiniteMessageIds: ids => ids,
        pushTableUndoSnapshot: () => { snapshots++; return { id: 'undo' }; }, normalizeTableText: String,
        saveCurrentTableProfileRows: () => {}, updateInjectionFromSummaries: () => {} });
    const before = JSON.stringify(state.tableDatabase.tables);
    assert.throws(() => model.applyTableOperations([{ op: 'update', tableIndex: 0, rowIndex: 0, data: { 1: 'Nana' } }, { op: 'update', tableIndex: 99, rowIndex: 0, data: { 1: '错误' } }]), /不存在/);
    assert.equal(JSON.stringify(state.tableDatabase.tables), before); assert.equal(snapshots, 0);
    model.applyTableOperations([{ op: 'update', tableIndex: 0, rowIndex: 0, data: { 1: 'Nana' } }]);
    assert.equal(state.tableDatabase.tables[0].rows[0][1], 'Nana'); assert.equal(snapshots, 1);
});

test('injection excludes invalidated memory, releases stale coverage and includes story clock', () => {
    const { state, chat } = fixture();
    state.memoryStrategy = 'generic'; state.tableDatabase.injectMemory = false;
    state.stageSummaries = [{ hash: 'st', content: '旧阶段', sourceHashes: ['s'] }];
    state.coveredBlockHashes = ['s']; refreshMemoryLinks(state, chat);
    state.storySummaries[0].content = '新摘要'; refreshMemoryLinks(state, chat);
    setStoryTime(state, { label: '午夜' });
    const service = createInjectionService({ ensureState: () => state, getChat: () => chat,
        getActiveEpicMemoryBlocks: () => [], getActiveCoveredStageHashes: () => new Set(),
        getStageMemoryBlocks: () => state.stageSummaries.filter(item => isMemoryCurrent(state, item)),
        memoryStrategies: { GENERIC: 'generic' }, renderInjectedTablesSection: () => '', renderVectorMemorySection: () => '' });
    const text = service.getInjectionMemoryParts(state).memory;
    assert.ok(text.includes('新摘要')); assert.ok(text.includes('午夜')); assert.ok(!text.includes('旧阶段'));
});

test('missing source floors and removed summaries cannot remain valid', () => {
    const { state, chat } = fixture();
    state.stageSummaries.push({ hash: 'missing', content: '未知材料', sourceMessageIds: [99] });
    refreshMemoryLinks(state, chat);
    assert.equal(isMemoryCurrent(state, { hash: 'missing' }), false);
    state.storySummaries = []; refreshMemoryLinks(state, chat);
    assert.equal(isMemoryCurrent(state, { hash: 's' }), false);
});

test('appending a row records only the appended data rather than copying the entire array', () => {
    const before = { rows: Array.from({ length: 500 }, (_, i) => ['r' + i]) };
    const after = structuredClone(before); after.rows.push(['added']);
    const delta = diffState(before, after);
    assert.equal(delta.length, 1); assert.equal(delta[0].op, 'splice');
    assert.deepEqual(delta[0].before, []); assert.deepEqual(delta[0].after, [['added']]);
    assert.deepEqual(applyDeltas(structuredClone(before), delta), after);
});

test('recovery journal restores clock, entities and complete replay history after reload', () => {
    const { state, chat } = fixture();
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const old = JSON.parse(JSON.stringify(state));
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'recover-story' });
    journal.reconcile(state, chat);
    setStoryTime(state, { date: '1889-10-15' });
    upsertEntity(state, { kind: 'person', name: 'Nana' }); captureChronicle(state, chat);
    journal.stage(state, chat);
    const result = createSummaryRecoveryJournal({ storage, getChatId: () => 'recover-story' }).reconcile(old, chat);
    assert.equal(result.status, 'recovered');
    assert.ok(result.changedStateKeys.includes('chronicle'));
    ensureChronicle(old, chat);
    assert.equal(old.chronicle.clock.date, '1889-10-15');
    assert.equal(old.chronicle.entities[0].name, 'Nana');
    assert.deepEqual(replayChronicle(old.chronicle), replayChronicle(state.chronicle));
});

test('restoration validates full log instead of trusting an imported checkpoint', () => {
    const { state, chat } = fixture();
    state.tableDatabase.tables[0].rows[0][1] = 'Nana'; captureChronicle(state, chat);
    const backup = createMemoryBackup(state, { chat });
    backup.memory.chronicle.events[0].deltas[0].before = 'tampered';
    backup.memory.chronicle.checkpoints = [{ sequence: 1, state: replayChronicle(state.chronicle).state }];
    const { checksum, ...payload } = backup; backup.checksum = getHash(JSON.stringify(payload));
    assert.throws(() => validateMemoryBackup(backup), /前置/);
});
