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
export const factSettingKeys = Object.freeze(['version', 'enabled', 'auto', 'review', 'everySummaries', 'idleMinutes', 'budgetAuto', 'budgetRatio', 'budgetChars', 'maxCards', 'recentFloors', 'materialChars', 'injectReflection', 'injectDepth']);

// settings.version 2: on by default (v1.32.0). Settings saved before that carry no version and get the new default once.
// settings.version 3: the injection budget follows the model's context (v1.40.0).
export const factSettingsVersion = 3;
export function createDefaultFactSettings() {
    // everySummaries: 整理 runs once this many new 剧情摘要 have gathered; idleMinutes: or after this long without a message (0 = off).
    // budgetAuto: inject up to budgetRatio % of the model's context; off: up to budgetChars characters.
    // injectDepth: how many messages before the latest one the section goes (0 = after the last, 999 = before the whole chat).
    return { version: factSettingsVersion, enabled: true, auto: true, review: false, everySummaries: 6, idleMinutes: 10, budgetAuto: true, budgetRatio: 6, budgetChars: 6000,
        maxCards: 40, recentFloors: 6, materialChars: 24000, injectReflection: true, injectDepth: 2 };
}
// The automatic budget in characters (Chinese text runs close to one token per character): never below `min`, never
// above `max`, and `unknown` when the model's context cannot be read. A context slider at a million says nothing about
// how much a section should take of it; more than `max` is a fixed number the user sets.
export const budgetLimits = Object.freeze({ min: 800, max: 8000, unknown: 4000 });
export function injectionBudget(settings = {}, contextTokens = 0) {
    const ratio = Number(settings.budgetRatio) || 6;
    const context = Number(contextTokens) > 0 ? Math.round(Number(contextTokens)) : 0;
    if (settings.budgetAuto === false) return { chars: Number(settings.budgetChars) || 6000, auto: false, ratio, contextTokens: context };
    const chars = context ? Math.max(budgetLimits.min, Math.min(budgetLimits.max, Math.round(context * ratio / 100))) : budgetLimits.unknown;
    return { chars, auto: true, ratio, contextTokens: context };
}
// How long a field should be, told to the model. Nothing is cut when written: a field well past its limit is asked to
// be rewritten at the next 整理. Fields the user wrote and cards just imported are left as they are.
export const factFieldLimits = Object.freeze({
    person: { 处境: 60, 目标: 60, 持有: 40, 性格: 40, 外貌: 40, 备注: 120 },
    relationship: { 双方: 20, 当前关系: 40, 态度: 60, 基础关系: 20 },
    place: { 描述: 60, 常在此处: 30 },
    item: { 持有者: 20, 描述: 40, 意义: 40 },
    thread: { 内容: 60, 状态: 20, 参与者: 30, 期限: 20 },
    rule: { 说明: 100, 影响范围: 30 },
    note: {},
});
const pastLimit = (kind, key, value) => { const limit = factFieldLimits[kind]?.[key]; return !!limit && String(value || '').length > limit * 1.3; };
export const overlongFields = card => card.updatedBy === 'import' ? []
    : factFields[card.kind].filter(key => !card.userFields?.includes(key) && pastLimit(card.kind, key, card.fields[key]));
export const cardTextLength = card => Object.values(card?.fields || {}).reduce((sum, value) => sum + String(value || '').length, 0);

export function createDefaultFacts() {
    return { version: 1, revision: 0, cards: [], reflection: { mainline: '', threads: '', arcs: '', updatedAt: null },
        history: [], doneStages: [], settings: createDefaultFactSettings(), lastRunAt: null, lastIntegratedFloor: -1, integrated: {}, lastActivityAt: null, conflicts: [], timelineVersion: 1 };
}

const text = (value, max = 4000) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
export const clip = (value, max) => { const source = String(value ?? ''); return source.length > max ? `${source.slice(0, max)}…` : source; };
export const normalizeName = value => text(value, 200).toLowerCase().replace(/[\s「」『』“”"'·・,，。.、()（）]/g, '');

export function normalizeFactSettings(value) {
    const defaults = createDefaultFactSettings();
    const source = value && typeof value === 'object' ? value : {};
    const number = (key, min, max) => Math.max(min, Math.min(max, Number(source[key] ?? defaults[key]) || defaults[key]));
    const version = Number(source.version) || 0;
    // Before v1.40 the budget was a fixed 6000 nobody could change: that moves to the automatic budget once; another
    // number someone set (an imported configuration) stays as a fixed budget.
    const budgetAuto = version >= 3 ? source.budgetAuto !== false : !(Number(source.budgetChars) && Number(source.budgetChars) !== 6000);
    const depth = source.injectDepth === '' || source.injectDepth == null ? NaN : Number(source.injectDepth);
    return { version: factSettingsVersion, enabled: version >= 2 ? !!source.enabled : defaults.enabled, auto: source.auto !== false, review: !!source.review,
        everySummaries: number('everySummaries', 1, 50), idleMinutes: Math.max(0, Math.min(240, Number(source.idleMinutes ?? defaults.idleMinutes) || 0)),
        budgetAuto, budgetRatio: number('budgetRatio', 1, 30),
        budgetChars: number('budgetChars', 500, 60000), maxCards: number('maxCards', 5, 200), recentFloors: number('recentFloors', 1, 50),
        materialChars: number('materialChars', 2000, 120000), injectReflection: source.injectReflection !== false,
        injectDepth: Number.isFinite(depth) ? Math.max(0, Math.min(999, Math.round(depth))) : defaults.injectDepth };
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
        // Who set the status last: a status the user set is not changed by 整理 (it becomes a conflict instead).
        statusBy: value.statusBy === 'user' ? 'user' : 'facts',
        pinned: !!value.pinned,
        userFields: [...new Set((Array.isArray(value.userFields) ? value.userFields : []).filter(key => factFields[kind].includes(key)))],
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
        updatedBy: ['user', 'import', 'facts'].includes(value.updatedBy) ? value.updatedBy : 'facts',
        sourceStage: typeof value.sourceStage === 'string' ? value.sourceStage : null,
        // Key transitions of this card (see recordTransition): where it was, who held it, how the relationship stood.
        timeline: (Array.isArray(value.timeline) ? value.timeline : []).filter(item => item && typeof item === 'object' && typeof item.field === 'string')
            .map(item => ({ field: item.field, from: text(item.from, 400), to: text(item.to, 400), floor: Number.isInteger(item.floor) ? item.floor : null,
                at: typeof item.at === 'string' ? item.at : null, entryId: typeof item.entryId === 'string' ? item.entryId : null, ...(item.past ? { past: true } : {}),
                ...(Array.isArray(item.floors) && item.floors.length ? { floors: floorList(item.floors, 8) } : {}) })).slice(-timelineCap),
        // The floors whose 剧情摘要 mention this card (when it was consolidated): where its facts come from, and where
        // recall can look for the old events. Floors only; the text stays in the summaries.
        floors: floorList(value.floors, cardFloorCap),
        // From which floor each current-state field (and `__status`) holds: the first floor of the batch that set it.
        // Material from before that floor cannot replace it (see applyFactsUpdate).
        asOf: Object.fromEntries(Object.entries(value.asOf && typeof value.asOf === 'object' ? value.asOf : {})
            .filter(([key, floor]) => (key === '__status' || factFields[kind].includes(key)) && Number.isInteger(floor))),
    };
}

export const cardFloorCap = 40;
// Sorted, unique, whole floors; the latest `max` are kept.
export function floorList(values, max = cardFloorCap) {
    return [...new Set((Array.isArray(values) ? values : []).filter(Number.isInteger))].sort((a, b) => a - b).slice(-max);
}

// The transitions worth keeping per card: the current-state fields changing from one value to another, and the
// card ending. Capped; the oldest give way. The first value of a field is not a transition. A value is kept short:
// the whole of it is in the history entry, and 经过 goes into every request and injected line.
export const timelineCap = 12;
const transitionChars = 80;
export function recordTransition(card, { field, from = '', to = '', floor = null, at = null, entryId = null, past = false, floors = [] }) {
    if (field !== '已结束' && field !== '恢复' && !from) return null;
    const item = { field, from: clip(text(from), transitionChars), to: clip(text(to), transitionChars), floor: Number.isInteger(floor) ? floor : null, at, entryId, ...(past ? { past: true } : {}),
        ...(floors.length ? { floors: floorList(floors, 8) } : {}) };
    card.timeline = [...(card.timeline || []), item].slice(-timelineCap);
    return item;
}
const transitionFields = kind => currentStateFields[kind] || [];
function recordChangeTransitions(card, change, { floor, at, entryId, floors = [] }) {
    if (change.created) return;
    for (const field of transitionFields(card.kind)) {
        // A long value rewritten short (请精简) says the same thing: nothing happened in the story.
        if (change.compacted?.includes(field)) continue;
        const from = change.before?.[field] || '', to = change.after?.[field] || '';
        if (from !== to) recordTransition(card, { field, from, to, floor, at, entryId, floors });
    }
    if (change.statusAfter === 'retired' && change.statusBefore !== 'retired') recordTransition(card, { field: '已结束', floor, at, entryId, floors });
    if (change.statusAfter === 'active' && change.statusBefore === 'retired') recordTransition(card, { field: '恢复', floor, at, entryId, floors });
}

// The floor from which a card's field (or `__status`) holds. Cards from before v1.38.1 have no asOf: the latest
// 整理 that changed it tells, as the first floor after what had been consolidated before it.
export function stateFloor(facts, card, field) {
    if (Number.isInteger(card.asOf?.[field])) return card.asOf[field];
    for (const entry of [...(facts.history || [])].reverse()) {
        if (entry.undone || entry.trigger === 'user') continue;
        const change = entry.changes?.find(item => item.cardId === card.id);
        if (!change) continue;
        const moved = field === '__status' ? change.statusBefore !== change.statusAfter
            : (change.before?.[field] || '') !== (change.after?.[field] || '');
        if (!moved) continue;
        if (Number.isInteger(entry.floorFrom)) return entry.floorFrom;
        if (Number.isInteger(entry.floorBefore) && Number.isInteger(entry.floorTo)) return Math.min(entry.floorTo, entry.floorBefore + 1);
        return null;
    }
    return null;
}
// Chats from before v1.36.0 have the diffs in their history but no timelines: build them once from what is there.
export function seedTimelines(facts) {
    if (facts.timelineVersion === 1) return 0;
    let count = 0;
    for (const entry of facts.history || []) {
        if (entry.undone || entry.trigger === 'user') continue;
        for (const change of entry.changes || []) {
            const card = facts.cards.find(item => item.id === change.cardId);
            if (!card) continue;
            const before = card.timeline?.length || 0;
            recordChangeTransitions(card, change, { floor: entry.floorTo ?? null, at: entry.at, entryId: entry.id });
            count += (card.timeline?.length || 0) - before;
        }
    }
    facts.timelineVersion = 1;
    return count;
}
// The timeline in story order (a value recorded later from backfilled floors sits where it happened), and how one
// item reads: a change (from → to), a value that held at an older floor (past), an end or a return.
export const storyOrder = timeline => (timeline || []).map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.floor ?? Infinity) - (b.item.floor ?? Infinity) || a.index - b.index).map(({ item }) => item);
export function describeTransition(item, { max = 0 } = {}) {
    if (item.field === '已结束' || item.field === '恢复') return item.field;
    const show = value => max ? clip(value, max) : value;
    if (item.past) return `${item.field}：${show(item.from)}（当时）`;
    return `${item.field}：${show(item.from) || '（空）'} → ${show(item.to) || '（清空）'}`;
}
// A 线索 still standing: its 状态 does not say it ended.
export const isOpenThread = card => card.kind === 'thread' && card.status === 'active' && !/已了|失效|完成|结束|放弃|作废|取消/.test(card.fields.状态 || '');
// The latest floor a card was touched at, for putting recent threads first.
export const latestFloor = card => Math.max(-1, ...(card.floors || []), ...Object.values(card.asOf || {}).filter(Number.isInteger), ...(card.timeline || []).map(item => item.floor).filter(Number.isInteger));

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
        // 0 = card timelines not built yet from the history (chats from before v1.36.0); seedTimelines sets 1.
        timelineVersion: source.timelineVersion === 1 ? 1 : 0,
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
export const hearsayMarker = /【(?:声称|猜测|推测|传闻|已推翻|秘密)】|【[^】\n]{1,12}(?:认为|知道)】/;
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// What a current-state field must not hold even when the model left out the marks: a value that opens with hearsay
// or a hedge, or with a known person saying or believing something. Returns the mark to add, or ''. Conservative:
// a value that opens with a place or an action (在酒馆听说了…, 沈砚说服了船长) is left alone.
export function reportedSpeech(value, people = []) {
    const source = String(value || '').trim();
    if (!source) return '';
    if (/^(?:据说|听说|传闻|传言|有人说|有传言|坊间传)/.test(source)) return '【传闻】';
    if (/^(?:似乎|好像|也许|或许|大概|可能|疑似|估计|兴许)/.test(source)) return '【猜测】';
    const names = [...new Set(people.map(name => String(name || '').trim()).filter(name => name.length >= 2))].sort((a, b) => b.length - a.length);
    if (!names.length) return '';
    const subject = `(${names.map(escapeRegExp).join('|')})`;
    if (new RegExp(`^${subject}(?:说(?![服明话笑书和情])|声称|自称|坚称|宣称|表示|承认自己)`).test(source)) return '【声称】';
    const belief = new RegExp(`^${subject}(?:以为|认为|相信|怀疑|猜测|觉得|坚信)`).exec(source);
    return belief ? `【${belief[1]}认为】` : '';
}
const clearMarker = /^【?清除】?$/;
// Added text joins the field on one line: an injected card is one line.
const appendText = (base, piece) => !piece ? base : String(base || '').includes(piece) ? base : base ? `${base}；${piece}` : piece;

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
// user's own guidance and come along too. A card that ended (a death, a closed 约定) comes only when the text
// names it. Ordered by how often the text names them. `namedOnly`: just the ones it names (a 整理 request).
export function selectRelevantCards(cards, textValue, { max = 40, includeNotes = true, namedOnly = false } = {}) {
    const scored = cards.map(card => ({ card,
        score: cardMentions(card, textValue) + (namedOnly || card.status !== 'active' ? 0
            : (card.pinned ? 1000 : 0) + (isOpenThread(card) ? 100 : 0) + (includeNotes && card.kind === 'note' ? 500 : 0)) }));
    return scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, max)).map(item => item.card);
}

// Incoming field values: a string replaces, null (or 【清除】) clears, an omitted or empty one keeps. `add` holds
// sentences to append instead, so a model that has one thing to add need not copy the field to say it.
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
// Time order: `floorFrom`–`floorTo` are the floors the material covers. A current-state field (or the card's end)
// set from a later floor is not replaced by material from before it: the older value goes into 经过 as what was
// true then. A card's status changes only through `retired` / `revived`, never because the card was mentioned.
// `mentionFloors(card)`: the floors of this result's material that mention the card (the controller reads the
// summaries); they go onto the card and the changes in its 经过.
export function applyFactsUpdate(facts, parsed, { trigger = 'facts', stageHash = null, taskId = null, floorFrom = null, floorTo = null, sources = [], mentionFloors = null, now = new Date().toISOString(), overrideUser = false } = {}) {
    const floorBefore = facts.lastIntegratedFloor ?? -1;
    const from = Number.isInteger(floorFrom) ? floorFrom : Number.isInteger(floorTo) ? floorTo : null;
    // Material older than what the field already says: its last floor is before the floor the field holds from.
    const older = (card, field) => { const since = Number.isInteger(floorTo) ? stateFloor(facts, card, field) : null; return since != null && floorTo < since ? since : null; };
    const markState = (card, fields) => { if (from == null) return; card.asOf = { ...(card.asOf || {}) }; for (const field of fields) card.asOf[field] = from; };
    const pastIds = new Set();
    // Speakers for the hearsay check: the people on record and the ones this result names.
    const people = [...facts.cards, ...(Array.isArray(parsed?.cards) ? parsed.cards : [])].filter(card => card?.kind === 'person')
        .flatMap(card => [card.name, ...(Array.isArray(card.aliases) ? card.aliases : [])]);
    const changes = [], warnings = [], conflictIds = [];
    const entryId = `facts-${getHash(`${now}|${(facts.revision || 0) + 1}|${stageHash || ''}`)}`;
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
        const { set: added } = cleanIncoming(targetKind, incoming.add);
        // Hearsay in a current-state field moves to the note field, marked as it came.
        const note = noteFieldOf[targetKind];
        for (const key of currentStateFields[targetKind] || []) {
            if (!note || key === note) continue;
            for (const incomingFields of [fields, added]) {
                if (!incomingFields[key]) continue;
                const mark = hearsayMarker.test(incomingFields[key]) ? '' : reportedSpeech(incomingFields[key], people);
                if (!mark && !hearsayMarker.test(incomingFields[key])) continue;
                if (incomingFields === fields) fields[note] = appendText(fields[note] ?? card?.fields[note] ?? '', mark + fields[key]);
                else added[note] = appendText(added[note], mark + added[key]);
                delete incomingFields[key];
                warnings.push(`「${name}」的${key}写的是传闻或猜测，已移到${note}`);
            }
        }
        if (!card) {
            for (const [key, value] of Object.entries(added)) fields[key] = appendText(fields[key], value);
            if (!Object.keys(fields).length) { warnings.push(`「${name}」没有任何内容，已跳过`); return; }
            card = normalizeCard({ id: `fact-${getHash(`${kind}|${name}|${now}|${index}`)}`, kind, name, aliases, fields, updatedAt: now, sourceStage: stageHash }, index);
            markState(card, transitionFields(kind).filter(key => card.fields[key]));
            facts.cards.push(card);
            touched.add(card.id);
            changes.push({ cardId: card.id, kind: card.kind, name: card.name, created: true, before: null, after: { ...card.fields }, statusBefore: null, statusAfter: 'active', kept: [] });
            return;
        }
        const before = { ...card.fields }, kept = [];
        const metaBefore = { updatedAt: card.updatedAt, updatedBy: card.updatedBy, sourceStage: card.sourceStage, aliases: [...card.aliases], asOf: { ...(card.asOf || {}) }, statusBy: card.statusBy };
        const after = { ...card.fields };
        const stateKeys = transitionFields(card.kind);
        const stale = (key, value) => {
            if (!stateKeys.includes(key) || (card.fields[key] || '') === value) return false;
            const since = older(card, key);
            if (since == null) return false;
            warnings.push(`「${card.name}」的${key}来自第 ${floorTo} 楼，早于现状（第 ${since} 楼起），保留现状${value ? '，旧的记进经过' : ''}`);
            if (value) { recordTransition(card, { field: key, from: value, to: card.fields[key] || '', floor: floorTo, at: now, entryId, past: true }); pastIds.add(card.id); }
            return true;
        };
        for (const [key, value] of Object.entries(fields)) {
            if (!overrideUser && card.userFields.includes(key) && card.fields[key] && card.fields[key] !== value) { kept.push(key); continue; }
            if (stale(key, value)) continue;
            after[key] = value;
        }
        for (const key of clear) {
            if (!card.fields[key]) continue;
            if (!overrideUser && card.userFields.includes(key)) { kept.push(key); continue; }
            if (stale(key, '')) continue;
            after[key] = '';
        }
        for (const [key, value] of Object.entries(added)) {
            if (String(after[key] || '').includes(value)) continue;
            if (!overrideUser && card.userFields.includes(key) && card.fields[key]) { kept.push(key); continue; }
            if (stale(key, value)) continue;
            after[key] = appendText(after[key], value);
        }
        // A new spelling the model led with becomes an alias; the recorded name stays the name.
        const newAliases = [...new Set([name, ...aliases])].filter(alias => !cardMatchesName(card, alias));
        const changed = Object.keys(after).some(key => after[key] !== before[key]) || newAliases.length;
        if (!changed) return;
        const moved = Object.keys(after).filter(key => after[key] !== before[key]);
        const compacted = moved.filter(key => after[key] && pastLimit(card.kind, key, before[key]) && !pastLimit(card.kind, key, after[key]));
        card.fields = after;
        card.aliases = [...new Set([...card.aliases, ...newAliases])];
        markState(card, stateKeys.filter(key => moved.includes(key) && !compacted.includes(key)));
        card.updatedAt = now;
        card.updatedBy = trigger === 'user' ? 'user' : 'facts';
        card.sourceStage = stageHash ?? card.sourceStage;
        touched.add(card.id);
        // Only the fields that changed are kept: undo, the diff and the timeline all read just those (history is part of
        // the chat file, which is written whole on every save).
        changes.push({ cardId: card.id, kind: card.kind, name: card.name, created: false, before: Object.fromEntries(moved.map(key => [key, before[key]])),
            after: Object.fromEntries(moved.map(key => [key, after[key]])), statusBefore: card.status, statusAfter: card.status, kept, metaBefore, ...(compacted.length ? { compacted } : {}) });
    });
    // Status changes: an end or a return the result names, from material not older than the current status, and not
    // over a status the user set (that becomes a conflict for the user).
    const setStatus = (card, status, label) => {
        const since = older(card, '__status');
        if (since != null) { warnings.push(`「${card.name}」${label}的材料（第 ${floorTo} 楼）早于它现在的状态（第 ${since} 楼起），没有改`); return; }
        if (card.statusBy === 'user') {
            conflict({ cardId: card.id, name: card.name, kind: card.kind, field: status === 'active' ? '恢复' : '结束', current: card.status === 'retired' ? '已结束（你设的）' : '在场（你设的）',
                says: `第 ${floorTo ?? '?'} 楼的材料说「${card.name}」${label}` });
            return;
        }
        let change = changes.find(item => item.cardId === card.id);
        if (!change) {
            change = { cardId: card.id, kind: card.kind, name: card.name, created: false, before: {}, after: {}, statusBefore: card.status, statusAfter: card.status, kept: [],
                metaBefore: { updatedAt: card.updatedAt, updatedBy: card.updatedBy, sourceStage: card.sourceStage, aliases: [...card.aliases], asOf: { ...(card.asOf || {}) }, statusBy: card.statusBy } };
            changes.push(change);
            card.updatedAt = now;
        }
        card.status = status;
        card.statusBy = 'facts';
        markState(card, ['__status']);
        change.statusAfter = status;
        touched.add(card.id);
    };
    // The same result may give a card its last state and end it (a death with where it happened).
    for (const name of Array.isArray(parsed?.retired) ? parsed.retired : []) {
        const card = findCard(facts.cards, text(name, 200));
        if (!card || card.kind === 'note' || card.status === 'retired') continue;
        setStatus(card, 'retired', '结束');
    }
    for (const name of Array.isArray(parsed?.revived) ? parsed.revived : []) {
        const card = findCard(facts.cards, text(name, 200));
        if (!card || card.kind === 'note' || card.status !== 'retired') continue;
        setStatus(card, 'active', '恢复');
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
    if (!changes.length && !reflectionChanged && !read.length && !stageHash && !conflictIds.length && !pastIds.size) return null;
    facts.revision += 1;
    for (const change of changes) {
        const card = facts.cards.find(item => item.id === change.cardId);
        if (!card) continue;
        let floors = [];
        try { floors = floorList(mentionFloors?.(card) || []); } catch { floors = []; }
        if (floors.length) {
            // What this 整理 added (and what the cap pushed out), so an undo takes exactly that back.
            const before = card.floors || [];
            card.floors = floorList([...before, ...floors]);
            const added = card.floors.filter(floor => !before.includes(floor)), dropped = before.filter(floor => !card.floors.includes(floor));
            if (added.length) change.floorsAdded = added;
            if (dropped.length) change.floorsDropped = dropped;
        }
        recordChangeTransitions(card, change, { floor: Number.isInteger(floorTo) ? floorTo : null, at: now, entryId, floors });
        // The undo record keeps only what this change moved (aliases, state floors, who set the status, stage).
        const meta = change.metaBefore;
        if (meta) for (const key of ['aliases', 'asOf', 'statusBy', 'sourceStage']) if (JSON.stringify(meta[key] ?? null) === JSON.stringify(card[key] ?? null)) delete meta[key];
    }
    const entry = { id: entryId, at: now, trigger, stageHash, taskId, changes,
        floorBefore, floorFrom: from, floorTo: Number.isInteger(floorTo) ? floorTo : null, sources: read, conflicts: conflictIds,
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
        if (change.metaBefore && !editedSince) Object.assign(card, change.metaBefore, { ...(change.metaBefore.aliases ? { aliases: [...change.metaBefore.aliases] } : {}), ...(change.metaBefore.asOf ? { asOf: { ...change.metaBefore.asOf } } : {}) });
        else if (!editedSince) card.updatedAt = now;
        else if (change.metaBefore?.asOf) card.asOf = { ...change.metaBefore.asOf };
        if (change.floorsAdded || change.floorsDropped) card.floors = floorList([...(card.floors || []).filter(floor => !(change.floorsAdded || []).includes(floor)), ...(change.floorsDropped || [])]);
    }
    for (const card of facts.cards) if (card.timeline?.some(item => item.entryId === entry.id)) card.timeline = card.timeline.filter(item => item.entryId !== entry.id);
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
    if (choice === 'accept' && card && factFields[card.kind].includes(conflict.field)) {
        const from = card.fields[conflict.field] || '';
        editCard(facts, card.id, { fields: { [conflict.field]: conflict.says } }, now);
        // What the user accepted is a change in the story, not a correction: it counts as a transition.
        if (transitionFields(card.kind).includes(conflict.field) && from !== card.fields[conflict.field]) {
            recordTransition(card, { field: conflict.field, from, to: card.fields[conflict.field], floor: conflict.floorTo ?? null, at: now, entryId: facts.history.at(-1)?.id || null });
        }
    }
    if (choice === 'accept' && card && (conflict.field === '恢复' || conflict.field === '结束')) {
        editCard(facts, card.id, { status: conflict.field === '恢复' ? 'active' : 'retired' }, now);
        recordTransition(card, { field: conflict.field === '恢复' ? '恢复' : '已结束', floor: conflict.floorTo ?? null, at: now, entryId: facts.history.at(-1)?.id || null });
    }
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
    if ((status === 'active' || status === 'retired') && status !== card.status) { card.status = status; card.statusBy = 'user'; }
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
