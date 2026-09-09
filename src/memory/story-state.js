import { getHash } from '../shared/text.js';

export const semanticKinds = ['text', 'person', 'item', 'plan', 'location'];
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const runtime = new WeakMap();
const pending = new WeakMap();
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function ensureTableIdentity(table) {
    table.id ||= uid('table');
    table.columnIds = (table.columns || []).map((_, i) => table.columnIds?.[i] || uid('column'));
    table.rowIds = (table.rows || []).map((_, i) => table.rowIds?.[i] || uid('row'));
    table.columnKinds = (table.columns || []).map((_, i) => semanticKinds.includes(table.columnKinds?.[i]) ? table.columnKinds[i] : 'text');
    table.cellRefs ||= {};
    const validCells = new Set(table.rowIds.flatMap(row => table.columnIds.map(column => `${row}:${column}`)));
    for (const key of Object.keys(table.cellRefs)) if (!validCells.has(key)) delete table.cellRefs[key];
    return table;
}

export function messageRevision(message) {
    return getHash(`${message?.mes || ''}|${message?.swipe_id ?? ''}|${!!message?.is_user}`);
}

function captureSources(previous = [], chat = []) {
    const used = new Set();
    const exact = new Map(), anchors = new Map();
    for (const item of previous) {
        const key = `${item.anchor}:${item.revision}`;
        if (!exact.has(key)) exact.set(key, []);
        if (!anchors.has(item.anchor)) anchors.set(item.anchor, []);
        exact.get(key).push(item); anchors.get(item.anchor).push(item);
    }
    const sources = chat.map((message, floor) => {
        const revision = messageRevision(message);
        const anchor = getHash(JSON.stringify([message?.send_date || '', message?.name || '', !!message?.is_user]));
        let match = exact.get(`${anchor}:${revision}`)?.find(item => !used.has(item.id));
        if (!match) {
            const candidates = (anchors.get(anchor) || []).filter(item => !used.has(item.id));
            if (candidates.length === 1) match = candidates[0];
        }
        const id = match?.id || uid('source');
        used.add(id);
        return { id, floor, anchor, revision };
    });
    return sources;
}

function projection(state) {
    const db = state.tableDatabase || {};
    const profiles = clone(db.profileRows || {});
    const activeKey = `${db.schemaScope || 'chat'}:${db.activeProfileId || 'default'}`;
    profiles[`active:${activeKey}`] = clone(db.tables || []);
    return { profiles, clock: clone(state.chronicle.clock), entities: clone(state.chronicle.entities) };
}

export function ensureChronicle(state, chat = []) {
    if (!state || !state.tableDatabase) return null;
    if (state.chronicle && state.chronicle.version !== 1) throw new Error('不支持的剧情状态版本，请更新插件后再保存。');
    if (!state.chronicle) {
        (state.tableDatabase.tables || []).forEach(ensureTableIdentity);
        state.chronicle = { version: 1, clock: { label: '', date: '', precision: 'unknown' }, entities: [],
            sources: captureSources([], chat), links: {}, events: [], checkpoints: [], baselineFloor: chat.length - 1 };
        state.chronicle.baseline = projection(state);
        state.chronicle.createdAt = new Date().toISOString();
    }
    if (!runtime.has(state) || runtime.get(state).owner !== state.chronicle) {
        const restored = replayChronicle(state.chronicle).state;
        const key = `active:${state.tableDatabase.schemaScope || 'chat'}:${state.tableDatabase.activeProfileId || 'default'}`;
        if (restored.profiles[key]) state.tableDatabase.tables = clone(restored.profiles[key]);
        state.chronicle.clock = clone(restored.clock);
        state.chronicle.entities = clone(restored.entities);
        runtime.set(state, { owner: state.chronicle, current: restored });
    }
    return state.chronicle;
}

export function diffState(before, after, path = [], result = []) {
    if (equal(before, after)) return result;
    if (before && after && typeof before === 'object' && typeof after === 'object'
        && !Array.isArray(before) && !Array.isArray(after)) {
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (blockedKeys.has(key)) throw new Error('不安全的状态字段');
            diffState(before[key], after[key], [...path, key], result);
        }
    } else if (Array.isArray(before) && Array.isArray(after)) {
        const common = Math.min(before.length, after.length);
        for (let i = 0; i < common; i++) diffState(before[i], after[i], [...path, i], result);
        if (before.length !== after.length) result.push({ path, op: 'splice', index: common, before: clone(before.slice(common)), after: clone(after.slice(common)) });
    } else {
        result.push({ path, hadBefore: before !== undefined, hasAfter: after !== undefined,
            before: before === undefined ? null : clone(before), after: after === undefined ? null : clone(after) });
    }
    return result;
}

export function applyDeltas(document, deltas) {
    for (const delta of deltas) {
        if (!Array.isArray(delta.path) || !delta.path.length || delta.path.some(key => blockedKeys.has(String(key)))) throw new Error('非法 Delta 路径');
        if (delta.op === 'splice') {
            let array = document;
            for (const key of delta.path) {
                if (!array || !Object.hasOwn(array, key)) throw new Error('Delta 缺少前置状态');
                array = array[key];
            }
            if (!Array.isArray(array) || !Number.isInteger(delta.index) || delta.index < 0 || !Array.isArray(delta.before) || !Array.isArray(delta.after)
                || array.length !== delta.index + delta.before.length || !equal(array.slice(delta.index), delta.before)) throw new Error('Delta 前置数组不一致');
            array.splice(delta.index, delta.before.length);
            for (const value of clone(delta.after)) array.push(value);
            continue;
        }
        if (delta.op) throw new Error('未知 Delta 操作');
        let parent = document;
        for (const key of delta.path.slice(0, -1)) {
            if (!parent || !Object.hasOwn(parent, key)) throw new Error('Delta 缺少前置状态');
            parent = parent[key];
        }
        const key = delta.path.at(-1);
        if (!parent || Object.hasOwn(parent, key) !== delta.hadBefore || (delta.hadBefore && !equal(parent[key], delta.before))) throw new Error('Delta 前置值不一致，未重放');
        if (delta.hasAfter) parent[key] = clone(delta.after);
        else delete parent[key];
    }
    return document;
}

export function replayChronicle(chronicle, { sequence = Infinity, floor = Infinity } = {}) {
    if (floor < chronicle.baselineFloor) throw new Error(`只能查看迁移基线（第 ${chronicle.baselineFloor} 楼）之后的历史。`);
    // Floor is the observation cursor, not the story date or a backfilled source floor.
    const events = chronicle.events.filter(event => event.sequence <= sequence && event.observedFloor <= floor);
    const last = events.at(-1)?.sequence || 0;
    const checkpoint = [...chronicle.checkpoints].reverse().find(item => item.sequence <= last);
    const state = clone(checkpoint?.state || chronicle.baseline);
    for (const event of events) if (event.sequence > (checkpoint?.sequence || 0)) applyDeltas(state, event.deltas);
    return { state, sequence: last, baselineFloor: chronicle.baselineFloor };
}

export function markStoryChange(state, { label = '手动修改', sourceMessageIds = [], mode = 'manual', storyTime = null } = {}) {
    if (!state.chronicle) return;
    pending.set(state, { label, sourceMessageIds, mode, storyTime });
}

export function summaryItems(state) {
    return ['storySummaries', 'stageSummaries', 'epicSummaries'].flatMap(key => (state[key] || []).map(item => ({ ...item, memoryKind: key })));
}

export function refreshMemoryLinks(state, chat = []) {
    const c = state.chronicle;
    if (!c) return {};
    c.sources = captureSources(c.sources, chat);
    const items = summaryItems(state);
    const byHash = new Map(items.filter(item => item.hash).map(item => [item.hash, item]));
    const current = new Map(c.sources.map(source => [source.id, source]));
    for (const item of items) {
        if (!item.hash) continue;
        const revision = getHash(item.content || '');
        const previous = c.links[item.hash];
        if (!previous || previous.revision !== revision) {
            const ids = item.sourceMessageIds?.length ? item.sourceMessageIds : Number.isInteger(item.messageId) ? [item.messageId] : [];
            c.links[item.hash] = { revision, refs: ids.map(floor => c.sources[floor] || { id: `missing:${floor}`, floor, revision: null }).map(clone),
                children: [...new Set([...(item.sourceHashes || []), ...(item.sourceStageHashes || [])])].filter(hash => byHash.has(hash)).map(hash => ({ hash, revision: getHash(byHash.get(hash).content || '') })),
                recordedAt: new Date().toISOString(), storyTime: clone(c.clock), stale: false };
        }
    }
    const checking = new Set();
    const done = new Map();
    const check = hash => {
        if (done.has(hash)) return done.get(hash);
        if (checking.has(hash)) return true;
        checking.add(hash);
        const link = c.links[hash];
        const stale = !!link && (link.refs.some(ref => current.get(ref.id)?.revision !== ref.revision || current.get(ref.id)?.floor !== ref.floor)
            || link.children.some(child => !byHash.has(child.hash) || getHash(byHash.get(child.hash).content || '') !== child.revision || check(child.hash)));
        checking.delete(hash);
        done.set(hash, stale);
        if (link) link.stale = stale;
        return stale;
    };
    items.forEach(item => check(item.hash));
    for (const hash of Object.keys(c.links)) if (!byHash.has(hash)) c.links[hash].stale = true;
    return c.links;
}

export function isMemoryCurrent(state, item) {
    return state.chronicle?.links?.[item?.hash]?.stale !== true;
}

export function activeStoryCoverage(state) {
    const stale = new Set(), current = new Set();
    for (const item of [...(state.stageSummaries || []), ...(state.epicSummaries || [])]) {
        const target = isMemoryCurrent(state, item) ? current : stale;
        (item.sourceHashes || []).forEach(hash => target.add(hash));
    }
    return new Set((state.coveredBlockHashes || []).filter(hash => !stale.has(hash) || current.has(hash)));
}

export function captureChronicle(state, chat = []) {
    const c = ensureChronicle(state, chat);
    if (!c) return null;
    (state.tableDatabase.tables || []).forEach(ensureTableIdentity);
    for (const table of state.tableDatabase.tables || []) {
        table.rows.forEach((row, i) => table.columns.forEach((_, j) => {
            const key = `${table.rowIds[i]}:${table.columnIds[j]}`;
            const ref = table.cellRefs[key];
            const value = String(row[j] ?? '');
            if (ref && ref.value === value && resolveEntity(state, table.columnKinds[j], '', ref.entityId)) return;
            delete table.cellRefs[key];
            const entity = resolveEntity(state, table.columnKinds[j], value);
            if (entity) table.cellRefs[key] = { entityId: entity.id, value };
        }));
    }
    refreshMemoryLinks(state, chat);
    const next = projection(state);
    const cached = runtime.get(state);
    const deltas = diffState(cached.current, next);
    const metadata = pending.get(state) || { label: '表格 / 状态修改', sourceMessageIds: [], mode: 'manual' };
    pending.delete(state);
    if (!deltas.length) return null;
    const last = c.events.at(-1);
    const event = { id: uid('delta'), sequence: (last?.sequence || 0) + 1,
        observedFloor: Math.max(c.baselineFloor, last?.observedFloor ?? -1, chat.length - 1),
        actualFloor: chat.length - 1, recordedAt: new Date().toISOString(), label: metadata.label, mode: metadata.mode,
        sources: metadata.sourceMessageIds.map(floor => c.sources[floor]).filter(Boolean).map(clone),
        storyTime: clone(metadata.storyTime || c.clock), deltas };
    c.events.push(event);
    cached.current = next;
    if (event.sequence % 50 === 0) {
        c.checkpoints.push({ sequence: event.sequence, state: clone(next) });
        c.checkpoints = c.checkpoints.slice(-4);
    }
    return event;
}

export function setStoryTime(state, { label = '', date = '', relativeDays = null, flashback = false, sourceMessageIds = [] } = {}) {
    const c = state.chronicle;
    if (!c) throw new Error('剧情状态尚未初始化');
    let nextDate = String(date).trim();
    if (relativeDays !== null) {
        if (!c.clock.date || !Number.isInteger(Number(relativeDays)) || Math.abs(Number(relativeDays)) > 365000) throw new Error('相对日期需要明确日期锚点和有效天数');
        const anchor = new Date(`${c.clock.date}T00:00:00Z`);
        anchor.setUTCDate(anchor.getUTCDate() + Number(relativeDays));
        nextDate = anchor.toISOString().slice(0, 10);
    }
    if (nextDate && (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || !Number.isFinite(Date.parse(`${nextDate}T00:00:00Z`)) || new Date(`${nextDate}T00:00:00Z`).toISOString().slice(0, 10) !== nextDate)) throw new Error('日期无效，请使用 YYYY-MM-DD；架空时间可填写时间描述');
    if (String(label).length > 500) throw new Error('剧情时间描述请控制在 500 字以内');
    const time = { label: String(label).trim(), date: nextDate, precision: nextDate ? 'day' : label ? 'approximate' : 'unknown' };
    if (flashback) {
        c.clock = { ...c.clock, lastFlashback: time };
        markStoryChange(state, { label: '记录回忆时间（当前时钟未前进）', sourceMessageIds, mode: 'flashback', storyTime: time });
    } else {
        c.clock = { ...time, lastFlashback: c.clock.lastFlashback || null };
        markStoryChange(state, { label: '更新当前剧情时间', sourceMessageIds });
    }
    return time;
}

export function upsertEntity(state, { id = '', kind, name, aliases = [] }) {
    if (!semanticKinds.includes(kind) || kind === 'text' || !String(name).trim()) throw new Error('请选择实体类型并填写名称');
    const entities = state.chronicle.entities;
    let entity = id ? entities.find(item => item.id === id) : null;
    if (id && !entity) throw new Error('实体不存在');
    if (entity && entity.kind !== kind) throw new Error('已有实体不能直接更改类型，请新建另一实体');
    if (String(name).length > 200 || aliases.length > 30 || aliases.some(value => String(value).length > 200)) throw new Error('实体名称或别名过长');
    if (!entity) { entity = { id: uid(kind), kind }; entities.push(entity); }
    Object.assign(entity, { name: String(name).trim(), aliases: [...new Set(aliases.map(String).map(value => value.trim()).filter(Boolean))] });
    markStoryChange(state, { label: '更新语义实体' });
    return entity;
}

export function resolveEntity(state, kind, value, explicitId = '') {
    const entities = state.chronicle?.entities || [];
    if (explicitId) return entities.find(item => item.id === explicitId && item.kind === kind) || null;
    const matches = entities.filter(item => item.kind === kind && [item.name, ...(item.aliases || [])].includes(String(value).trim()));
    return matches.length === 1 ? matches[0] : null;
}

export function bindCellEntity(state, table, rowIndex, colIndex, entityId) {
    ensureTableIdentity(table);
    const kind = table.columnKinds[colIndex];
    const entity = resolveEntity(state, kind, '', entityId);
    if (!entity || !table.rows[rowIndex]) throw new Error('字段类型与实体不匹配，或数据行不存在');
    const key = `${table.rowIds[rowIndex]}:${table.columnIds[colIndex]}`;
    table.cellRefs[key] = { entityId: entity.id, value: String(table.rows[rowIndex][colIndex] || '') };
    markStoryChange(state, { label: '绑定表格语义实体' });
}

export function getCurrentStateRows(state, tables = state.tableDatabase?.tables || []) {
    return tables.flatMap(table => (table.rows || []).map((row, i) => ({ table: table.name, rowId: table.rowIds?.[i] || '',
        fields: (table.columns || []).map((name, j) => {
            const kind = table.columnKinds?.[j] || 'text';
            const ref = table.cellRefs?.[`${table.rowIds?.[i]}:${table.columnIds?.[j]}`];
            const entity = resolveEntity(state, kind, row[j], ref?.value === String(row[j] || '') ? ref.entityId : '');
            return { name, kind, value: entity?.name || String(row[j] ?? ''), entityId: entity?.id || '', unresolved: kind !== 'text' && !entity };
        }) })));
}

export function storyTimeContext(state) {
    const time = state.chronicle?.clock;
    if (!time || (!time.date && !time.label)) return '';
    return `当前剧情时间：${[time.date, time.label].filter(Boolean).join(' · ')}。回忆不改变当前时钟。`;
}
