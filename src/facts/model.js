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
export const factSettingKeys = Object.freeze(['version', 'enabled', 'auto', 'review', 'budgetChars', 'maxCards', 'recentFloors', 'materialChars', 'injectReflection']);

// settings.version 2: on by default (v1.32.0). Settings saved before that carry no version and get the new default once.
export const factSettingsVersion = 2;
export function createDefaultFactSettings() {
    return { version: factSettingsVersion, enabled: true, auto: true, review: false, budgetChars: 6000, maxCards: 40, recentFloors: 6, materialChars: 24000, injectReflection: true };
}

export function createDefaultFacts() {
    return { version: 1, revision: 0, cards: [], reflection: { mainline: '', threads: '', arcs: '', updatedAt: null },
        history: [], doneStages: [], settings: createDefaultFactSettings(), lastRunAt: null };
}

const text = (value, max = 4000) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
export const normalizeName = value => text(value, 200).toLowerCase().replace(/[\s「」『』“”"'·・,，。.、()（）]/g, '');

export function normalizeFactSettings(value) {
    const defaults = createDefaultFactSettings();
    const source = value && typeof value === 'object' ? value : {};
    const number = (key, min, max) => Math.max(min, Math.min(max, Number(source[key] ?? defaults[key]) || defaults[key]));
    const current = Number(source.version) >= factSettingsVersion;
    return { version: factSettingsVersion, enabled: current ? !!source.enabled : defaults.enabled, auto: source.auto !== false, review: !!source.review,
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
    };
}

export function cardMatchesName(card, name) {
    const key = normalizeName(name);
    return !!key && (normalizeName(card.name) === key || card.aliases.some(alias => normalizeName(alias) === key));
}

// A name names one card. Same kind first; a card of another kind with that name is still the same thing
// (the model may call a 约定 a thread one time and a rule the next), and keeps its kind.
export function findCard(cards, name, kind = null) {
    const matches = cards.filter(card => cardMatchesName(card, name));
    return matches.find(card => card.kind === kind) || matches.find(card => card.status === 'active') || matches[0] || null;
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

const cleanIncoming = (kind, fields) => {
    const result = {};
    for (const key of factFields[kind]) {
        const value = text(fields?.[key]);
        if (value) result[key] = value;
    }
    return result;
};

// Writes one 整理事实 result into the cards. Fields the model leaves out or empties are unchanged (省略=保持);
// fields the user edited are kept unless `overrideUser`. Returns the history entry, or null when nothing changed.
export function applyFactsUpdate(facts, parsed, { trigger = 'facts', stageHash = null, taskId = null, now = new Date().toISOString(), overrideUser = false } = {}) {
    const changes = [], warnings = [];
    const touched = new Set();
    (Array.isArray(parsed?.cards) ? parsed.cards : []).forEach((incoming, index) => {
        const name = text(incoming?.name, 200);
        const kind = factKinds.includes(incoming?.kind) ? incoming.kind : null;
        if (!name) { warnings.push(`第 ${index + 1} 张卡没有名字，已跳过`); return; }
        if (kind === 'note') { warnings.push(`「${name}」是便签，模型不能修改，已跳过`); return; }
        const aliases = (Array.isArray(incoming.aliases) ? incoming.aliases : []).map(alias => text(alias, 200)).filter(Boolean);
        // The model may lead with a new spelling and give the recorded name as an alias.
        let card = findCard(facts.cards, name) || aliases.map(alias => findCard(facts.cards, alias)).find(Boolean) || null;
        if (!card && !kind) { warnings.push(`「${name}」类型不明（${String(incoming?.kind || '')}），已跳过`); return; }
        if (card?.kind === 'note') { warnings.push(`「${name}」是便签，模型不能修改，已跳过`); return; }
        if (card && touched.has(card.id)) return;
        const fields = cleanIncoming(card?.kind || kind, incoming.fields);
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
    const reflectionBefore = { ...facts.reflection };
    const incomingReflection = parsed?.reflection && typeof parsed.reflection === 'object' ? parsed.reflection : {};
    let reflectionChanged = false;
    for (const key of ['mainline', 'threads', 'arcs']) {
        const value = text(incomingReflection[key]);
        if (value && value !== facts.reflection[key]) { facts.reflection[key] = value; reflectionChanged = true; }
    }
    if (reflectionChanged) facts.reflection.updatedAt = now;
    if (stageHash && !facts.doneStages.includes(stageHash)) facts.doneStages.push(stageHash);
    facts.lastRunAt = now;
    if (!changes.length && !reflectionChanged) return null;
    facts.revision += 1;
    const entry = { id: `facts-${getHash(`${now}|${facts.revision}|${stageHash || ''}`)}`, at: now, trigger, stageHash, taskId, changes,
        reflectionBefore, reflectionAfter: reflectionChanged ? { ...facts.reflection } : null, warnings, undone: false };
    facts.history.push(entry);
    facts.history = facts.history.slice(-60);
    return entry;
}

// Puts the cards back the way they were before one entry (the latest by default). Cards created by it are removed.
export function undoFactsUpdate(facts, entryId = null, now = new Date().toISOString()) {
    const entry = entryId ? facts.history.find(item => item.id === entryId) : [...facts.history].reverse().find(item => !item.undone);
    if (!entry || entry.undone) return null;
    for (const change of [...entry.changes].reverse()) {
        const index = facts.cards.findIndex(card => card.id === change.cardId);
        if (index < 0) continue;
        if (change.created) { facts.cards.splice(index, 1); continue; }
        const card = facts.cards[index];
        card.fields = { ...card.fields, ...change.before };
        card.status = change.statusBefore || card.status;
        if (change.metaBefore) Object.assign(card, change.metaBefore, { aliases: [...change.metaBefore.aliases] });
        else card.updatedAt = now;
    }
    if (entry.reflectionAfter) facts.reflection = { ...entry.reflectionBefore };
    if (entry.stageHash) facts.doneStages = facts.doneStages.filter(hash => hash !== entry.stageHash);
    entry.undone = true;
    entry.undoneAt = now;
    facts.revision += 1;
    return entry;
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
