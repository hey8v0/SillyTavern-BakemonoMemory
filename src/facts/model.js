/**
 * 剧情事实 (fact cards): the chat's semantic memory. Cards hold free-text fields per kind; 整理事实 rewrites the
 * cards a stage summary touched and records the diff so it can be undone. Pure: no DOM, no host, no persistence.
 */
import { getHash } from '../shared/text.js';

export const factKinds = Object.freeze(['person', 'relationship', 'place', 'item', 'thread', 'rule', 'note']);
export const factKindLabels = Object.freeze({
    person: '人物', relationship: '关系', place: '地点', item: '物品', thread: '线索', rule: '设定', note: '便签',
});
// Field order is the order they are shown and injected: what helps the next reply first.
export const factFields = Object.freeze({
    person: ['处境', '目标', '持有', '性格', '外貌', '备注'],
    relationship: ['双方', '当前关系', '态度', '基础关系'],
    place: ['描述', '常在此处'],
    item: ['持有者', '描述', '意义'],
    thread: ['内容', '状态', '参与者', '期限'],
    rule: ['说明', '影响范围'],
    note: ['内容'],
});
export const factFieldHints = Object.freeze({
    person: { 处境: '当前位置、伤势、情绪、正在做什么', 目标: '想要什么、在追求什么、动机', 持有: '随身或名下的重要物品', 性格: '稳定的性格特征', 外貌: '外貌与衣着中稳定的部分', 备注: '说法、传闻、其他' },
    relationship: { 双方: '甲 与 乙', 当前关系: '现在的流动状态，如冷战中、秘密恋人', 态度: '甲对乙 / 乙对甲，分开写', 基础关系: '稳定身份，如继母与继子、同僚' },
    place: { 描述: '是什么地方、现在的样子', 常在此处: '经常在这里的人' },
    item: { 持有者: '现在在谁手上、放在哪', 描述: '是什么', 意义: '对剧情或人物的意义' },
    thread: { 内容: '约定、任务或伏笔是什么', 状态: '未了 / 已了 / 失效', 参与者: '牵涉的人', 期限: '何时之前' },
    rule: { 说明: '设定内容', 影响范围: '影响哪些人、地方或事' },
    note: { 内容: '只由你填写，模型只读' },
});
export const factSettingKeys = Object.freeze(['version', 'enabled', 'auto', 'review', 'everySummaries', 'idleMinutes', 'budgetChars', 'maxCards', 'recentFloors', 'materialChars', 'injectReflection']);

// settings.version 2: on by default (v1.32.0). Settings saved before that carry no version and get the new default once.
export const factSettingsVersion = 2;
export function createDefaultFactSettings() {
    // everySummaries: 整理 runs once this many new 剧情摘要 have gathered; idleMinutes: or after this long without a message (0 = off).
    return { version: factSettingsVersion, enabled: true, auto: true, review: false, everySummaries: 6, idleMinutes: 10, budgetChars: 6000, maxCards: 40, recentFloors: 6, materialChars: 24000, injectReflection: true };
}

export function createDefaultFacts() {
    return { version: 1, revision: 0, cards: [], reflection: { mainline: '', threads: '', arcs: '', updatedAt: null },
        history: [], doneStages: [], settings: createDefaultFactSettings(), lastRunAt: null, lastIntegratedFloor: -1, integrated: {}, lastActivityAt: null, conflicts: [] };
}

const text = (value, max = 4000) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
export const normalizeName = value => text(value, 200).toLowerCase().replace(/[\s「」『』“”"'·・,，。.、()（）]/g, '');

export function normalizeFactSettings(value) {
    const defaults = createDefaultFactSettings();
    const source = value && typeof value === 'object' ? value : {};
    const number = (key, min, max) => Math.max(min, Math.min(max, Number(source[key] ?? defaults[key]) || defaults[key]));
    const current = Number(source.version) >= factSettingsVersion;
    return { version: factSettingsVersion, enabled: current ? !!source.enabled : defaults.enabled, auto: source.auto !== false, review: !!source.review,
        everySummaries: number('everySummaries', 1, 50), idleMinutes: Math.max(0, Math.min(240, Number(source.idleMinutes ?? defaults.idleMinutes) || 0)),
        budgetChars: number('budgetChars', 500, 60000), maxCards: number('maxCards', 5, 200), recentFloors: number('recentFloors', 1, 50),
        materialChars: number('materialChars', 2000, 120000), injectReflection: source.injectReflection !== false };
}

export function normalizeCard(value, index = 0) {
    if (!value || typeof value !== 'object') return null;
    const kind = factKinds.includes(value.kind) ? value.kind : null;
    const name = text(value.name, 200);
    if (!kind || !name) return null;
    const fields = {};
    for (const key of factFields[kind]) fields[key] = text(value.fields?.[key]);
    return {
        id: typeof value.id === 'string' && value.id ? value.id : `fact-${getHash(`${kind}|${name}|${index}`)}`,
        kind, name,
        aliases: [...new Set((Array.isArray(value.aliases) ? value.aliases : []).map(alias => text(alias, 200)).filter(alias => alias && normalizeName(alias) !== normalizeName(name)))],
        fields,
        status: value.status === 'retired' ? 'retired' : 'active',
        pinned: !!value.pinned,
        userFields: [...new Set((Array.isArray(value.userFields) ? value.userFields : []).filter(key => factFields[kind].includes(key)))],
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
        updatedBy: ['user', 'import', 'facts'].includes(value.updatedBy) ? value.updatedBy : 'facts',
        sourceStage: typeof value.sourceStage === 'string' ? value.sourceStage : null,
    };
}

export function normalizeFacts(value) {
    const defaults = createDefaultFacts();
    const source = value && typeof value === 'object' ? value : {};
    const seen = new Set();
    const cards = (Array.isArray(source.cards) ? source.cards : []).map(normalizeCard).filter(card => card && !seen.has(card.id) && seen.add(card.id));
    const reflection = source.reflection && typeof source.reflection === 'object' ? source.reflection : {};
    return {
        version: 1,
        revision: Number.isInteger(source.revision) ? source.revision : 0,
        cards,
        reflection: { mainline: text(reflection.mainline), threads: text(reflection.threads), arcs: text(reflection.arcs),
            updatedAt: typeof reflection.updatedAt === 'string' ? reflection.updatedAt : null },
        history: (Array.isArray(source.history) ? source.history : []).filter(entry => entry && typeof entry === 'object' && typeof entry.id === 'string').slice(-60),
        doneStages: [...new Set((Array.isArray(source.doneStages) ? source.doneStages : []).filter(hash => typeof hash === 'string'))],
        settings: normalizeFactSettings(source.settings),
        lastRunAt: typeof source.lastRunAt === 'string' ? source.lastRunAt : defaults.lastRunAt,
        // How far the consolidation has read, as a floor: shown to the user, and the reference point for material
        // that arrives for older floors. Progress itself is `integrated`.
        lastIntegratedFloor: Number.isInteger(source.lastIntegratedFloor) ? source.lastIntegratedFloor : -1,
        // Every 剧情摘要 consolidated so far, by its id, with the text version that was read: an edited summary
        // (same id, new text) or one written later for an older floor is pending again. null = not yet migrated
        // from the floor cursor (chats from before v1.34.1); the controller fills it once the chat is loaded.
        integrated: source.integrated && typeof source.integrated === 'object'
            ? Object.fromEntries(Object.entries(source.integrated).filter(([hash, revision]) => hash && typeof revision === 'string'))
            : null,
        // When the last message was sent or received, for the idle check after a reload or a return to the foreground.
        lastActivityAt: typeof source.lastActivityAt === 'string' ? source.lastActivityAt : null,
        // What the model could not settle, for the user to pick (see addConflict).
        conflicts: (Array.isArray(source.conflicts) ? source.conflicts : []).filter(item => item && typeof item === 'object' && typeof item.id === 'string')
            .map(item => ({ ...item, status: ['open', 'accepted', 'dismissed'].includes(item.status) ? item.status : 'open' })).slice(-40),
    };
}

// Summaries that no longer exist (deleted, or rescanned under another id) leave the record.
export function pruneIntegrated(facts, knownHashes) {
    if (!facts.integrated) return 0;
    const known = knownHashes instanceof Set ? knownHashes : new Set(knownHashes);
    let dropped = 0;
    for (const hash of Object.keys(facts.integrated)) if (!known.has(hash)) { delete facts.integrated[hash]; dropped += 1; }
    return dropped;
}

export function cardMatchesName(card, name) {
    const key = normalizeName(name);
    return !!key && (normalizeName(card.name) === key || card.aliases.some(alias => normalizeName(alias) === key));
}

// Kinds that name the same sort of thing: a 约定 the model calls a thread one time and a rule the next is one card.
// A person, a place and an item with the same name are three.
const kindGroup = { person: 'person', relationship: 'relationship', place: 'place', item: 'item', thread: 'thread', rule: 'thread', note: 'note' };
export function findCards(cards, name, kind = null) {
    const group = kind ? kindGroup[kind] : null;
    return cards.filter(card => cardMatchesName(card, name) && (!group || kindGroup[card.kind] === group));
}
// A name names one card within its kind's group; without a kind, any card of that name.
export function findCard(cards, name, kind = null) {
    const matches = findCards(cards, name, kind);
    return matches.find(card => card.kind === kind) || matches.find(card => card.status === 'active') || matches[0] || null;
}

// Fields that state what is the case now. Anything a character says, believes or guesses goes to the note field
// instead, marked, so the model sees it as hearsay and the current state is not rewritten by it.
export const currentStateFields = Object.freeze({ person: ['处境', '目标', '持有'], item: ['持有者'], relationship: ['当前关系'], thread: ['状态'], place: ['常在此处'] });
export const noteFieldOf = Object.freeze({ person: '备注', item: '描述', relationship: '态度', thread: '内容', place: '描述', rule: '说明', note: '内容' });
export const hearsayMarker = /【(?:声称|猜测|传闻|已推翻)】|【[^】\n]{1,12}认为】/;
const clearMarker = /^【?清除】?$/;
const appendLine = (base, line) => !line ? base : String(base || '').includes(line) ? base : base ? `${base}\n${line}` : line;

// Something the model could not settle: the material contradicts a card and it cannot tell which is right, or one
// name may be two things. Kept open until the user picks; the card is not changed meanwhile.
function addConflict(facts, data, { now, taskId = null, floorTo = null }) {
    facts.conflicts ||= [];
    const same = facts.conflicts.find(item => item.status === 'open' && item.cardId === data.cardId && item.field === data.field && item.says === data.says);
    if (same) return null;
    const conflict = { id: `conflict-${getHash(`${now}|${data.cardId}|${data.field}|${data.says}|${facts.conflicts.length}`)}`, ...data, at: now, taskId, floorTo, status: 'open' };
    facts.conflicts.push(conflict);
    facts.conflicts = facts.conflicts.slice(-40);
    return conflict;
}

const occurrences = (haystack, needle) => {
    if (!needle || needle.length < 2) return 0;
    let count = 0, index = 0;
    while ((index = haystack.indexOf(needle, index)) >= 0) { count += 1; index += needle.length; }
    return count;
};
export function cardMentions(card, textValue) {
    const source = String(textValue || '').toLowerCase();
    return [card.name, ...card.aliases].reduce((sum, name) => sum + occurrences(source, String(name).toLowerCase()), 0);
}

// Cards to send or inject for a piece of text: the ones it names, pinned ones, and open 线索. Notes are the
// user's own guidance and come along too. Ordered by how often the text names them.
export function selectRelevantCards(cards, textValue, { max = 40, includeNotes = true } = {}) {
    const scored = cards.filter(card => card.status === 'active').map(card => ({ card,
        score: cardMentions(card, textValue) + (card.pinned ? 1000 : 0) + (card.kind === 'thread' && !/已了|失效|完成|结束/.test(card.fields.状态) ? 100 : 0)
            + (includeNotes && card.kind === 'note' ? 500 : 0) }));
    return scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, max)).map(item => item.card);
}

// Incoming field values: a string replaces, null (or 【清除】) clears, an omitted or empty one keeps.
const cleanIncoming = (kind, fields) => {
    const set = {}, clear = [];
    for (const key of factFields[kind]) {
        const raw = fields?.[key];
        if (raw === null) { clear.push(key); continue; }
        const value = text(raw);
        if (clearMarker.test(value)) clear.push(key);
        else if (value) set[key] = value;
    }
    return { set, clear };
};

// Writes one 整理事实 result into the cards. Fields the model leaves out or empties are unchanged (省略=保持);
// fields the user edited are kept unless `overrideUser`. `sources` are the summaries this result read
// ({ hash, revision }): they are recorded as integrated, and the history entry carries them so an undo reopens them.
// Returns the history entry; a result that changed nothing still leaves a light entry (changes: []) when it read
// anything, so "checked" and "changed" are both on record. Null only when there was nothing at all to record.
export function applyFactsUpdate(facts, parsed, { trigger = 'facts', stageHash = null, taskId = null, floorTo = null, sources = [], now = new Date().toISOString(), overrideUser = false } = {}) {
    const floorBefore = facts.lastIntegratedFloor ?? -1;
    const changes = [], warnings = [], conflictIds = [];
    const touched = new Set();
    const conflict = data => { const made = addConflict(facts, data, { now, taskId, floorTo }); if (made) conflictIds.push(made.id); };
    (Array.isArray(parsed?.cards) ? parsed.cards : []).forEach((incoming, index) => {
        const name = text(incoming?.name, 200);
        const kind = factKinds.includes(incoming?.kind) ? incoming.kind : null;
        if (!name) { warnings.push(`第 ${index + 1} 张卡没有名字，已跳过`); return; }
        if (kind === 'note') { warnings.push(`「${name}」是便签，模型不能修改，已跳过`); return; }
        const aliases = (Array.isArray(incoming.aliases) ? incoming.aliases : []).map(alias => text(alias, 200)).filter(Boolean);
        // The model may lead with a new spelling and give the recorded name as an alias. A name (or the names
        // together) that could mean two cards is not guessed at: the cards stay and the user decides.
        const candidates = [...new Set([name, ...aliases].flatMap(value => findCards(facts.cards, value, kind)))];
        if (candidates.length > 1) {
            const names = candidates.map(item => item.name);
            warnings.push(`「${name}」可能指 ${names.join('、')} 中的哪一个不明确，没有改动`);
            conflict({ cardId: candidates[0].id, name: candidates[0].name, kind: candidates[0].kind, field: '身份', current: names.join(' / '),
                says: `材料里的「${name}」${aliases.length ? `（别名 ${aliases.join('、')}）` : ''}同时对上了 ${names.join(' 和 ')}，可能是同一个，也可能不是` });
            return;
        }
        let card = candidates[0] || null;
        if (!card && !kind) { warnings.push(`「${name}」类型不明（${String(incoming?.kind || '')}），已跳过`); return; }
        if (card?.kind === 'note') { warnings.push(`「${name}」是便签，模型不能修改，已跳过`); return; }
        if (card && touched.has(card.id)) return;
        const targetKind = card?.kind || kind;
        const { set: fields, clear } = cleanIncoming(targetKind, incoming.fields);
        // Hearsay in a current-state field moves to the note field, marked as it came.
        const note = noteFieldOf[targetKind];
        for (const key of currentStateFields[targetKind] || []) {
            if (!fields[key] || !hearsayMarker.test(fields[key]) || !note || key === note) continue;
            fields[note] = appendLine(fields[note] ?? card?.fields[note] ?? '', fields[key]);
            delete fields[key];
            warnings.push(`「${name}」的${key}写的是传闻或猜测，已移到${note}`);
        }
        if (!card) {
            if (!Object.keys(fields).length) { warnings.push(`「${name}」没有任何内容，已跳过`); return; }
            card = normalizeCard({ id: `fact-${getHash(`${kind}|${name}|${now}|${index}`)}`, kind, name, aliases, fields, updatedAt: now, sourceStage: stageHash }, index);
            facts.cards.push(card);
            touched.add(card.id);
            changes.push({ cardId: card.id, kind: card.kind, name: card.name, created: true, before: null, after: { ...card.fields }, statusBefore: null, statusAfter: 'active', kept: [] });
            return;
        }
        const before = { ...card.fields }, kept = [];
        const metaBefore = { updatedAt: card.updatedAt, updatedBy: card.updatedBy, sourceStage: card.sourceStage, aliases: [...card.aliases] };
        const after = { ...card.fields };
        for (const [key, value] of Object.entries(fields)) {
            if (!overrideUser && card.userFields.includes(key) && card.fields[key] && card.fields[key] !== value) { kept.push(key); continue; }
            after[key] = value;
        }
        for (const key of clear) {
            if (!card.fields[key]) continue;
            if (!overrideUser && card.userFields.includes(key)) { kept.push(key); continue; }
            after[key] = '';
        }
        const statusBefore = card.status;
        // A new spelling the model led with becomes an alias; the recorded name stays the name.
        const newAliases = [...new Set([name, ...aliases])].filter(alias => !cardMatchesName(card, alias));
        const changed = Object.keys(after).some(key => after[key] !== before[key]) || card.status !== 'active' || newAliases.length;
        if (!changed) return;
        card.fields = after;
        card.aliases = [...new Set([...card.aliases, ...newAliases])];
        card.status = 'active';
        card.updatedAt = now;
        card.updatedBy = trigger === 'user' ? 'user' : 'facts';
        card.sourceStage = stageHash ?? card.sourceStage;
        touched.add(card.id);
        changes.push({ cardId: card.id, kind: card.kind, name: card.name, created: false, before, after: { ...after }, statusBefore, statusAfter: 'active', kept, metaBefore });
    });
    for (const name of Array.isArray(parsed?.retired) ? parsed.retired : []) {
        const card = findCard(facts.cards, text(name, 200));
        if (!card || card.kind === 'note' || card.status === 'retired' || touched.has(card.id)) continue;
        const metaBefore = { updatedAt: card.updatedAt, updatedBy: card.updatedBy, sourceStage: card.sourceStage, aliases: [...card.aliases] };
        card.status = 'retired';
        card.updatedAt = now;
        touched.add(card.id);
        changes.push({ cardId: card.id, kind: card.kind, name: card.name, created: false, before: { ...card.fields }, after: { ...card.fields }, statusBefore: 'active', statusAfter: 'retired', kept: [], metaBefore });
    }
    for (const raw of Array.isArray(parsed?.conflicts) ? parsed.conflicts : []) {
        const name = text(raw?.name, 200), field = text(raw?.field, 50), says = text(raw?.says, 1000);
        if (!name || !says) continue;
        const card = findCard(facts.cards, name);
        if (!card) { warnings.push(`冲突里的「${name}」没有对应的卡片，已跳过`); continue; }
        const key = factFields[card.kind].includes(field) ? field : noteFieldOf[card.kind];
        conflict({ cardId: card.id, name: card.name, kind: card.kind, field: key, current: card.fields[key] || '', says });
    }
    const reflectionBefore = { ...facts.reflection };
    const incomingReflection = parsed?.reflection && typeof parsed.reflection === 'object' ? parsed.reflection : {};
    let reflectionChanged = false;
    for (const key of ['mainline', 'threads', 'arcs']) {
        const value = text(incomingReflection[key]);
        if (value && value !== facts.reflection[key]) { facts.reflection[key] = value; reflectionChanged = true; }
    }
    if (reflectionChanged) facts.reflection.updatedAt = now;
    if (stageHash && !facts.doneStages.includes(stageHash)) facts.doneStages.push(stageHash);
    if (Number.isInteger(floorTo) && floorTo > floorBefore) facts.lastIntegratedFloor = floorTo;
    const read = (Array.isArray(sources) ? sources : []).filter(source => source && typeof source.hash === 'string' && source.hash)
        .map(source => ({ hash: source.hash, revision: String(source.revision ?? ''), floorEnd: Number.isInteger(source.floorEnd) ? source.floorEnd : null }));
    if (read.length) {
        facts.integrated ||= {};
        for (const source of read) facts.integrated[source.hash] = source.revision;
    }
    facts.lastRunAt = now;
    if (!changes.length && !reflectionChanged && !read.length && !stageHash && !conflictIds.length) return null;
    facts.revision += 1;
    const entry = { id: `facts-${getHash(`${now}|${facts.revision}|${stageHash || ''}`)}`, at: now, trigger, stageHash, taskId, changes,
        floorBefore, floorTo: Number.isInteger(floorTo) ? floorTo : null, sources: read, conflicts: conflictIds,
        reflectionBefore, reflectionAfter: reflectionChanged ? { ...facts.reflection } : null, warnings, undone: false };
    facts.history.push(entry);
    facts.history = facts.history.slice(-60);
    return entry;
}

// Puts the cards back the way they were before one entry (the latest by default). Cards created by it are removed.
// Only the fields that entry changed go back, and a field the user edited since keeps the user's value; the
// summaries it read are pending again.
export function undoFactsUpdate(facts, entryId = null, now = new Date().toISOString()) {
    const entry = entryId ? facts.history.find(item => item.id === entryId) : [...facts.history].reverse().find(item => !item.undone);
    if (!entry || entry.undone) return null;
    for (const change of [...entry.changes].reverse()) {
        const index = facts.cards.findIndex(card => card.id === change.cardId);
        if (index < 0) continue;
        if (change.created) { facts.cards.splice(index, 1); continue; }
        const card = facts.cards[index];
        const editedSince = card.updatedBy === 'user';
        for (const key of factFields[card.kind]) {
            const before = change.before?.[key] ?? '', after = change.after?.[key] ?? '';
            if (before === after) continue;
            if (editedSince && card.userFields.includes(key) && card.fields[key] !== after) continue;
            card.fields[key] = before;
        }
        card.status = change.statusBefore || card.status;
        if (change.metaBefore && !editedSince) Object.assign(card, change.metaBefore, { aliases: [...change.metaBefore.aliases] });
        else if (!editedSince) card.updatedAt = now;
    }
    if (entry.reflectionAfter) facts.reflection = { ...entry.reflectionBefore };
    if (entry.stageHash) facts.doneStages = facts.doneStages.filter(hash => hash !== entry.stageHash);
    if (Number.isInteger(entry.floorBefore) && entry.floorTo != null) facts.lastIntegratedFloor = entry.floorBefore;
    if (facts.integrated) for (const source of entry.sources || []) delete facts.integrated[source.hash];
    if (entry.conflicts?.length) facts.conflicts = (facts.conflicts || []).filter(item => !entry.conflicts.includes(item.id));
    entry.undone = true;
    entry.undoneAt = now;
    facts.revision += 1;
    return entry;
}

// The user settles a conflict: `accept` writes what the material said into the field (protected like an edit);
// `dismiss` keeps the card. An identity conflict (field 身份) has nothing to write and is only closed.
export function resolveConflict(facts, conflictId, choice, now = new Date().toISOString()) {
    const conflict = (facts.conflicts || []).find(item => item.id === conflictId);
    if (!conflict || conflict.status !== 'open') return null;
    const card = facts.cards.find(item => item.id === conflict.cardId);
    if (choice === 'accept' && card && factFields[card.kind].includes(conflict.field)) editCard(facts, card.id, { fields: { [conflict.field]: conflict.says } }, now);
    conflict.status = choice === 'accept' ? 'accepted' : 'dismissed';
    conflict.resolvedAt = now;
    facts.revision += 1;
    return conflict;
}

// A user edit of one card: fields are the new values; a changed field is protected from later 整理.
export function editCard(facts, cardId, { name, aliases, fields = {}, status, pinned } = {}, now = new Date().toISOString()) {
    const card = facts.cards.find(item => item.id === cardId);
    if (!card) return null;
    const before = { ...card.fields }, statusBefore = card.status;
    if (typeof name === 'string' && text(name, 200)) card.name = text(name, 200);
    if (Array.isArray(aliases)) card.aliases = [...new Set(aliases.map(alias => text(alias, 200)).filter(alias => alias && normalizeName(alias) !== normalizeName(card.name)))];
    for (const key of factFields[card.kind]) {
        if (!(key in fields)) continue;
        const value = text(fields[key]);
        if (value === card.fields[key]) continue;
        card.fields[key] = value;
        if (!card.userFields.includes(key)) card.userFields.push(key);
    }
    if (status === 'active' || status === 'retired') card.status = status;
    if (typeof pinned === 'boolean') card.pinned = pinned;
    card.updatedAt = now;
    card.updatedBy = 'user';
    facts.revision += 1;
    const entry = { id: `facts-${getHash(`${now}|${facts.revision}|${cardId}`)}`, at: now, trigger: 'user', stageHash: null, taskId: null,
        changes: [{ cardId, kind: card.kind, name: card.name, created: false, before, after: { ...card.fields }, statusBefore, statusAfter: card.status, kept: [] }],
        reflectionBefore: { ...facts.reflection }, reflectionAfter: null, warnings: [], undone: false };
    facts.history.push(entry);
    facts.history = facts.history.slice(-60);
    return card;
}

export function createCard(facts, { kind, name, aliases = [], fields = {}, pinned = false }, now = new Date().toISOString()) {
    const card = normalizeCard({ kind, name, aliases, fields, pinned, updatedAt: now, updatedBy: 'user' }, facts.cards.length);
    if (!card) return null;
    card.id = `fact-${getHash(`${kind}|${name}|${now}|${facts.cards.length}`)}`;
    card.userFields = Object.keys(card.fields).filter(key => card.fields[key]);
    facts.cards.push(card);
    facts.revision += 1;
    facts.history.push({ id: `facts-${getHash(`${now}|${facts.revision}|${card.id}`)}`, at: now, trigger: 'user', stageHash: null, taskId: null,
        changes: [{ cardId: card.id, kind: card.kind, name: card.name, created: true, before: null, after: { ...card.fields }, statusBefore: null, statusAfter: 'active', kept: [] }],
        reflectionBefore: { ...facts.reflection }, reflectionAfter: null, warnings: [], undone: false });
    facts.history = facts.history.slice(-60);
    return card;
}

// Two cards were one thing: the kept card gains the other's names and empty fields; the other is removed.
export function mergeCards(facts, keepId, removeId, now = new Date().toISOString()) {
    const keep = facts.cards.find(card => card.id === keepId), remove = facts.cards.find(card => card.id === removeId);
    if (!keep || !remove || keep === remove || keep.kind !== remove.kind) return null;
    keep.aliases = [...new Set([...keep.aliases, remove.name, ...remove.aliases])].filter(alias => normalizeName(alias) !== normalizeName(keep.name));
    for (const key of factFields[keep.kind]) if (!keep.fields[key] && remove.fields[key]) keep.fields[key] = remove.fields[key];
    keep.pinned = keep.pinned || remove.pinned;
    keep.updatedAt = now;
    keep.updatedBy = 'user';
    facts.cards = facts.cards.filter(card => card.id !== removeId);
    facts.revision += 1;
    return keep;
}

export function removeCard(facts, cardId) {
    const before = facts.cards.length;
    facts.cards = facts.cards.filter(card => card.id !== cardId);
    if (facts.cards.length === before) return false;
    facts.revision += 1;
    return true;
}

export function describeCard(card, { separator = '；', includeEmpty = false } = {}) {
    return factFields[card.kind].filter(key => includeEmpty || card.fields[key]).map(key => `${key} ${card.fields[key]}`).join(separator);
}

export function countCardsByKind(cards) {
    const counts = Object.fromEntries(factKinds.map(kind => [kind, 0]));
    for (const card of cards) if (card.status === 'active') counts[card.kind] += 1;
    return counts;
}
