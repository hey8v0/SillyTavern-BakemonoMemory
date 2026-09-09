import { getHash } from '../shared/text.js';
import { messageRevision, replayChronicle } from './story-state.js';

const arrays = ['storySummaries', 'stageSummaries', 'epicSummaries', 'drafts', 'coveredBlockHashes', 'coveredStageHashes'];
const recordFields = ['id', 'hash', 'title', 'content', 'type', 'kind', 'level', 'sourceKind', 'sourceMessageIds', 'sourceHashes', 'sourceStageHashes', 'sourceStart', 'sourceEnd', 'messageId', 'createdAt', 'trigger'];
const tableFields = ['id', 'tableIndex', 'name', 'columns', 'columnIds', 'columnKinds', 'rowIds', 'cellRefs', 'columnPrompts', 'note', 'initNode', 'insertNode', 'updateNode', 'deleteNode', 'rows', 'readOnly', 'allowAiEdit', 'injectLimit', 'required'];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const pickRecord = value => ({ ...pick(value, recordFields), metadata: pick(value?.metadata, ['sourceKind', 'sourceRange', 'sourceSortKey', 'batchIndex', 'batchTotal']) });
const clone = value => JSON.parse(JSON.stringify(value));
const rowsCount = tables => (tables || []).reduce((sum, table) => sum + (table.rows?.length || 0), 0);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function validateProjection(value) {
    if (!object(value) || !object(value.profiles) || !object(value.clock) || !Array.isArray(value.entities)
        || typeof value.clock.label !== 'string' || typeof value.clock.date !== 'string') throw new Error('历史状态格式无效');
    Object.values(value.profiles).forEach(validateTables);
    if (!value.entities.every(entity => object(entity) && typeof entity.id === 'string' && typeof entity.name === 'string'
        && ['person', 'item', 'plan', 'location'].includes(entity.kind) && Array.isArray(entity.aliases) && entity.aliases.every(alias => typeof alias === 'string'))
        || new Set(value.entities.map(entity => entity.id)).size !== value.entities.length) throw new Error('语义实体格式无效');
}

export function createMemoryBackup(state, { chatKey = '', chat = [], scanned = [], version = '1.6.0' } = {}) {
    const memory = Object.fromEntries(arrays.map(key => [key, (state[key] || []).map(item => typeof item === 'object' ? pickRecord(item) : item)]));
    for (const block of scanned) {
        const target = block.type === 'stage' ? memory.stageSummaries : block.type === 'epic' ? memory.epicSummaries : block.type === 'story' ? memory.storySummaries : null;
        if (!target || !block.content || target.some(item => item.hash === block.hash)) continue;
        target.push({ ...pickRecord(block), sourceKind: 'backup_tag', sourceMessageIds: block.sourceMessageIds?.length ? block.sourceMessageIds : [block.messageId].filter(Number.isInteger) });
    }
    const db = state.tableDatabase || {};
    memory.tableDatabase = { enabled: !!db.enabled, injectMemory: db.injectMemory !== false, autoApply: false,
        schemaScope: 'chat', activeProfileId: db.activeProfileId || '',
        tables: (db.tables || []).map(table => pick(table, tableFields)),
        chatProfiles: (db.chatProfiles || []).map(profile => ({ id: profile.id, name: profile.name, tables: (profile.tables || []).map(table => pick(table, tableFields)) })),
        profileRows: Object.fromEntries(Object.entries(db.profileRows || {}).map(([key, tables]) => [key, tables.map(table => pick(table, tableFields))])),
        editDrafts: (db.editDrafts || []).map(draft => pick(draft, ['id', 'raw', 'operations', 'sourceMessageIds', 'createdAt'])) };
    // Global/character schemas are copied into a chat-local profile on restore.
    if (!memory.tableDatabase.chatProfiles.some(profile => profile.id === db.activeProfileId)) {
        memory.tableDatabase.chatProfiles.push({ id: db.activeProfileId || 'restored', name: '恢复的当前表格', tables: memory.tableDatabase.tables });
        memory.tableDatabase.activeProfileId ||= 'restored';
    }
    const activeProfile = memory.tableDatabase.chatProfiles.find(profile => profile.id === memory.tableDatabase.activeProfileId);
    if (activeProfile) activeProfile.tables = memory.tableDatabase.tables;
    memory.tableDatabase.profileRows[`chat:default:${memory.tableDatabase.activeProfileId}`] = memory.tableDatabase.tables;
    if (state.chronicle) memory.chronicle = state.chronicle;
    const payload = clone({ format: 'bakemono-memory-backup', formatVersion: 1, pluginVersion: version,
        createdAt: new Date().toISOString(), chatKeyHash: getHash(chatKey), sources: chat.map(messageRevision), memory });
    return { ...payload, checksum: getHash(JSON.stringify(payload)) };
}

function inspectJson(value, depth = 0, budget = { count: 0 }) {
    if (++budget.count > 2000000 || depth > 80) throw new Error('备份数据过大或嵌套过深');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('备份含不安全字段');
        inspectJson(child, depth + 1, budget);
    }
}

function validateTables(tables) {
    if (!Array.isArray(tables)) throw new Error('表格列表无效');
    for (const table of tables) {
        if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.columns.every(v => typeof v === 'string')
            || !table.rows.every(row => Array.isArray(row) && row.every(v => typeof v === 'string'))) throw new Error('表格字段或数据行无效');
        for (const key of ['columnIds', 'columnKinds', 'rowIds', 'columnPrompts']) {
            if (table[key] !== undefined && (!Array.isArray(table[key]) || !table[key].every(v => typeof v === 'string'))) throw new Error('表格字段属性无效');
        }
        if (table.cellRefs !== undefined && (!object(table.cellRefs) || !Object.values(table.cellRefs).every(ref => object(ref) && typeof ref.entityId === 'string' && typeof ref.value === 'string'))) throw new Error('实体引用无效');
    }
}

export function validateMemoryBackup(raw) {
    if (typeof raw === 'string' && raw.length > 50 * 1024 * 1024) throw new Error('恢复包超过 50 MB，请拆分聊天后备份');
    const data = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
    inspectJson(data);
    if (data?.format !== 'bakemono-memory-backup' || data.formatVersion !== 1) throw new Error('不是支持的记忆恢复包');
    const { checksum, ...payload } = data;
    if (!checksum || checksum !== getHash(JSON.stringify(payload))) throw new Error('恢复包校验失败，文件可能不完整');
    const memory = data.memory;
    if (!memory || !Array.isArray(data.sources) || !data.sources.every(v => typeof v === 'string')) throw new Error('恢复包结构不完整');
    for (const key of arrays) {
        if (!Array.isArray(memory[key])) throw new Error(`恢复包缺少 ${key}`);
        if (key.startsWith('covered')) {
            if (!memory[key].every(v => typeof v === 'string')) throw new Error('覆盖标记无效');
        } else if (!memory[key].every(item => item && typeof item === 'object' && typeof item.content === 'string'
            && (!item.sourceMessageIds || (Array.isArray(item.sourceMessageIds) && item.sourceMessageIds.every(v => Number.isInteger(v) && v >= 0))))) throw new Error('摘要或草稿结构无效');
    }
    const db = memory.tableDatabase;
    validateTables(db?.tables);
    if (!Array.isArray(db.chatProfiles) || !db.profileRows || typeof db.profileRows !== 'object' || Array.isArray(db.profileRows) || !Array.isArray(db.editDrafts)) throw new Error('表格组结构无效');
    db.chatProfiles.forEach(profile => { if (!object(profile) || typeof profile.id !== 'string') throw new Error('表格组身份无效'); validateTables(profile.tables); });
    Object.values(db.profileRows).forEach(validateTables);
    if (memory.chronicle) {
        const c = memory.chronicle;
        if (c.version !== 1 || !Array.isArray(c.events) || !Array.isArray(c.entities) || !Array.isArray(c.sources) || !c.clock || !c.links || !c.baseline) throw new Error('剧情账本格式无效');
        if (!Number.isInteger(c.baselineFloor) || c.baselineFloor < -1 || !object(c.links)) throw new Error('账本基线或来源索引无效');
        validateProjection(c.baseline);
        validateProjection({ profiles: {}, clock: c.clock, entities: c.entities });
        const validRef = ref => object(ref) && typeof ref.id === 'string' && Number.isInteger(ref.floor) && (typeof ref.revision === 'string' || ref.revision === null);
        if (!c.sources.every(validRef) || !Object.values(c.links).every(link => object(link) && Array.isArray(link.refs) && link.refs.every(validRef)
            && Array.isArray(link.children) && link.children.every(child => object(child) && typeof child.hash === 'string' && typeof child.revision === 'string'))) throw new Error('记忆来源关联无效');
        let previous = 0, floor = c.baselineFloor;
        for (const event of c.events) {
            if (!object(event) || event.sequence !== previous + 1 || !Number.isInteger(event.observedFloor) || event.observedFloor < floor || !Array.isArray(event.deltas)
                || !Array.isArray(event.sources) || !event.sources.every(validRef) || typeof event.label !== 'string') throw new Error('账本序列损坏');
            previous = event.sequence; floor = event.observedFloor;
        }
        // Imported checkpoints are expendable; verify the complete authoritative log.
        c.checkpoints = [];
        validateProjection(replayChronicle(c).state);
    }
    return data;
}

export function previewMemoryBackup(data, { chatKey = '', chat = [] } = {}) {
    const sameKey = data.chatKeyHash === getHash(chatKey);
    const matchingSources = data.sources.every((revision, floor) => chat[floor] && messageRevision(chat[floor]) === revision);
    return { sameChat: chatKey ? sameKey : matchingSources, matchingSources,
        summaries: ['storySummaries', 'stageSummaries', 'epicSummaries'].reduce((n, key) => n + data.memory[key].length, 0),
        drafts: data.memory.drafts.length, tableRows: rowsCount(data.memory.tableDatabase.tables), events: data.memory.chronicle?.events.length || 0 };
}

export function restoreMemoryBackup(state, validated) {
    // Restore memory only: never import API configuration, hidden floors, or runnable tasks.
    const memory = clone(validated.memory);
    for (const key of arrays) state[key] = memory[key].map(item => typeof item === 'object' ? pickRecord(item) : item);
    state.tableDatabase = { ...state.tableDatabase, ...pick(memory.tableDatabase, ['enabled', 'injectMemory', 'tables', 'chatProfiles', 'profileRows', 'activeProfileId', 'editDrafts']), schemaScope: 'chat', autoApply: false,
        history: [], undoStack: [], redoStack: [], rollbackHistory: [], lastAppliedSourceMessageIds: [] };
    if (memory.chronicle) state.chronicle = memory.chronicle;
    else delete state.chronicle;
    state.blocks = []; state.scanPreview = []; state.memoryRecords = [];
    state.generatedMemory = '';
    state.taskQueue = []; state.taskQueuePaused = true; state.autoSummaryTransactions = [];
    state.history = [];
    if (state.vectorMemory) Object.assign(state.vectorMemory, { records: [], lastHits: [], lastEmbeddingCandidates: [], lastRerankCandidates: [], embeddingCache: {}, dirty: true, lastIndexedSignature: '' });
    return state;
}

export function createDiagnosticReport(state, { version = '1.6.0', storage = {} } = {}) {
    // Strict whitelist: no raw errors, identifiers, endpoint URLs, prompts, text, or embeddings.
    return { format: 'bakemono-diagnostic', version, createdAt: new Date().toISOString(),
        counts: { story: state.storySummaries?.length || 0, stage: state.stageSummaries?.length || 0,
            epic: state.epicSummaries?.length || 0, drafts: state.drafts?.length || 0,
            tables: state.tableDatabase?.tables?.length || 0, rows: rowsCount(state.tableDatabase?.tables),
            events: state.chronicle?.events?.length || 0, entities: state.chronicle?.entities?.length || 0,
            staleMemories: Object.values(state.chronicle?.links || {}).filter(item => item.stale).length,
            vectorRecords: state.vectorMemory?.records?.length || 0 },
        persistenceRevision: Number(state.persistenceRevision) || 0,
        vector: { enabled: !!state.vectorMemory?.enabled, dirty: !!state.vectorMemory?.dirty },
        tasks: { paused: !!state.taskQueuePaused, failed: (state.taskQueue || []).filter(task => task.status === 'failed').length },
        storage: { localStorage: ['available', 'unavailable', 'untested'].includes(storage.localStorage) ? storage.localStorage : 'untested',
            indexedDB: ['available', 'unavailable', 'untested'].includes(storage.indexedDB) ? storage.indexedDB : 'untested' } };
}
