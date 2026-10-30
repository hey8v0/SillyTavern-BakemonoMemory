/**
 * The 剧情事实 section of the injected memory, in layers (v1.40.0):
 * - the user's notes, always;
 * - 当前局面: the cards the latest floors name (the scene), pinned cards and the relationship of two people in the
 *   scene, with every field and their latest change;
 * - 其他相关: cards named a few floors back or by a recalled old summary, relationships and open threads of someone in
 *   the scene, in one line of what is the case now;
 * - the rest is not injected; it comes back when the story names it or reaches back to it.
 * When the budget runs out, the least relevant cards step down one rung at a time (one line → name only → left out),
 * the scene last. A card is never cut in the middle.
 */
import { cardMentions, describeCard, factFields, factKindLabels, injectionBudget, isOpenThread, storyOrder } from './model.js';

// The last couple of transitions of a card, as one clause: 曾经：持有者 林晚（到第 24 楼）、沈砚（到第 51 楼）.
export function describeTimeline(card, { max = 2 } = {}) {
    const items = storyOrder(card.timeline).filter(item => item.from && item.field !== '已结束' && item.field !== '恢复').slice(-max);
    if (!items.length) return '';
    const byField = new Map();
    for (const item of items) byField.set(item.field, [...(byField.get(item.field) || []), item]);
    const when = item => item.floor == null ? '' : item.past ? `（第 ${item.floor} 楼时）` : `（到第 ${item.floor} 楼）`;
    return '曾经：' + [...byField.entries()].map(([field, list]) => `${field} ${list.map(item => `${item.from}${when(item)}`).join('、')}`).join('；');
}

const cardHead = card => `${factKindLabels[card.kind]} ${card.name}${card.aliases.length ? `（${card.aliases.join('、')}）` : ''}${card.status === 'retired' ? '（已结束）' : ''}`;
// Every field, and the last `timeline` changes.
export function renderFactCardLine(card, { timeline = 2 } = {}) {
    const body = [describeCard(card), describeTimeline(card, { max: timeline })].filter(Boolean).join('；');
    return `${cardHead(card)}${body ? '：' + body : ''}`;
}
// One line of what is the case now; a card with none of those fields gives its first field instead.
const shortFields = { person: ['处境', '目标'], relationship: ['当前关系'], place: ['常在此处'], item: ['持有者'], thread: ['状态', '参与者'], rule: ['说明'], note: ['内容'] };
export function renderFactCardShort(card) {
    let keys = (shortFields[card.kind] || []).filter(key => card.fields[key]);
    if (!keys.length) { const first = factFields[card.kind].find(key => card.fields[key]); keys = first ? [first] : []; }
    const body = keys.map(key => `${key} ${card.fields[key]}`).join('；');
    return `${cardHead(card)}${body ? '：' + body : ''}`;
}

// 伏笔与约定 come from the 线索 cards still open, so a closed one leaves the reminder by itself; the text the model
// wrote into reflection.threads is used only by chats that have no 线索 cards (from before v1.36.0).
export function renderOpenThreads(cards = []) {
    return cards.filter(isOpenThread).map(card => `${card.name}（${[card.fields.状态 || '未了', card.fields.参与者, card.fields.期限 ? `期限 ${card.fields.期限}` : ''].filter(Boolean).join('；')}）`).join('、');
}
export function renderReflection(reflection, cards = []) {
    const threads = cards.some(card => card.kind === 'thread') ? renderOpenThreads(cards) : reflection?.threads || '';
    const lines = [['mainline', '主线', reflection?.mainline], ['threads', '伏笔与约定', threads], ['arcs', '人物弧线', reflection?.arcs]]
        .filter(([, , value]) => value).map(([, label, value]) => `${label}：${value}`);
    return lines.length ? '## 主线与伏笔\n' + lines.join('\n') : '';
}

const latestFloor = card => Math.max(-1, ...(card.floors || []), ...Object.values(card.asOf || {}).filter(Number.isInteger), ...(card.timeline || []).map(item => item.floor).filter(Number.isInteger));
const marksLine = '（【】里是传闻、推测或只有部分人物知道的事，不是所有人物都知道的事实。）';
const emptyPlan = budget => ({ budget, used: 0, full: [], short: [], named: [], dropped: [], over: false });

// `recent`: { scene, recent, recalled } (the latest floors, a few floors back, recalled old summaries), or one
// string that counts as the scene. Returns the text and a plan: which cards went in full, in one line, by name, or
// not at all, and how much of the budget was used.
export function renderFactsSection(facts, recent, { budgetChars = injectionBudget(facts?.settings || {}, 0).chars, injectReflection = facts?.settings?.injectReflection !== false } = {}) {
    if (!facts?.settings?.enabled) return { text: '', cards: [], omitted: 0, plan: emptyPlan(budgetChars) };
    const parts = recent && typeof recent === 'object' ? recent : { scene: String(recent || '') };
    const scene = String(parts.scene || ''), wide = [parts.scene, parts.recent, parts.recalled].filter(Boolean).join('\n');
    const cards = facts.cards || [];
    const entries = new Map();
    const add = (card, tier, want, priority) => {
        const previous = entries.get(card.id);
        if (previous && previous.priority >= priority) return;
        entries.set(card.id, { card, tier, want, level: want, priority });
    };
    const scenePeople = cards.filter(card => card.kind === 'person' && cardMentions(card, scene) > 0);
    const involves = (person, card) => cardMentions(person, [card.name, ...Object.values(card.fields)].join('\n')) > 0;
    for (const card of cards) {
        if (card.kind === 'note') { if (card.status === 'active' && card.fields.内容) add(card, 'note', 'full', 1e7); continue; }
        const active = card.status === 'active';
        const inScene = cardMentions(card, scene), around = cardMentions(card, wide);
        if (active && card.pinned) add(card, 'scene', 'full', 1e6 + inScene);
        if (inScene) add(card, 'scene', 'full', (active ? 1e5 : 5e4) + inScene * 10 + around);
        if (active && card.kind === 'relationship') {
            const parties = scenePeople.filter(person => involves(person, card)).length;
            if (parties >= 2) add(card, 'scene', 'full', 9e4 + parties);
            else if (parties === 1) add(card, 'related', 'short', 3e4);
        }
        if (isOpenThread(card) && scenePeople.some(person => involves(person, card))) add(card, 'related', 'short', 2e4 + around);
        if (around) add(card, 'related', 'short', (active ? 1e4 : 5e3) + around);
    }
    const ordered = [...entries.values()].sort((a, b) => b.priority - a.priority);
    const shownThreads = new Set(ordered.filter(entry => entry.card.kind === 'thread').map(entry => entry.card.id));
    // Open threads of people who are not here: names in the reminder, the most recent first.
    let otherThreads = cards.filter(card => isOpenThread(card) && !shownThreads.has(card.id))
        .map((card, index) => ({ card, index })).sort((a, b) => latestFloor(b.card) - latestFloor(a.card) || a.index - b.index).map(({ card }) => card.name);
    const legacyThreads = cards.some(card => card.kind === 'thread') ? '' : facts.reflection?.threads || '';
    const lines = new Map();
    const lineOf = entry => {
        const key = `${entry.card.id}|${entry.level}`;
        if (!lines.has(key)) lines.set(key, entry.level === 'full' ? renderFactCardLine(entry.card, { timeline: 1 }) : renderFactCardShort(entry.card));
        return lines.get(key);
    };
    const compose = () => {
        const shown = level => tier => ordered.filter(entry => entry.tier === tier && (level ? entry.level === level : ['full', 'short'].includes(entry.level))).map(lineOf);
        const notes = shown()('note'), now = shown()('scene'), related = shown()('related');
        const named = ordered.filter(entry => entry.level === 'name').map(entry => entry.card.name);
        const cardLines = [...notes, ...now, ...related];
        const body = [
            ...notes,
            ...(now.length ? ['### 当前局面', ...now] : []),
            ...(related.length ? ['### 其他相关', ...related] : []),
            ...(named.length ? [`另有：${named.join('、')}（这一轮没写详情，提到时会写出）`] : []),
        ];
        const factsText = body.length ? ['## 剧情事实', ...(cardLines.some(line => /【[^】\n]{1,14}】/.test(line)) ? [marksLine] : []), ...body].join('\n') : '';
        const threads = otherThreads.length ? otherThreads.join('、') : legacyThreads;
        const reflectionLines = injectReflection ? [['主线', facts.reflection?.mainline], ['伏笔与约定', threads], ['人物弧线', facts.reflection?.arcs]].filter(([, value]) => value).map(([label, value]) => `${label}：${value}`) : [];
        const reflectionText = reflectionLines.length ? '## 主线与伏笔\n' + reflectionLines.join('\n') : '';
        return [factsText, reflectionText].filter(Boolean).join('\n\n');
    };
    // Steps down, least relevant first: other cards to a name, the open-thread names past the five most recent, the
    // scene to one line, the remaining thread names, other names out, the scene to a name, pinned cards to one line,
    // then out. The user's notes never step down.
    const lowFirst = [...ordered].reverse().filter(entry => entry.tier !== 'note');
    const dropThread = () => { otherThreads = otherThreads.slice(0, -1); };
    const steps = [
        ...lowFirst.filter(entry => entry.tier === 'related').map(entry => () => { entry.level = 'name'; }),
        ...otherThreads.slice(5).map(() => dropThread),
        ...lowFirst.filter(entry => entry.tier === 'scene' && !entry.card.pinned).map(entry => () => { entry.level = 'short'; }),
        ...otherThreads.slice(0, 5).map(() => dropThread),
        ...lowFirst.filter(entry => entry.tier === 'related').map(entry => () => { entry.level = 'drop'; }),
        ...lowFirst.filter(entry => entry.tier === 'scene' && !entry.card.pinned).map(entry => () => { entry.level = 'name'; }),
        ...lowFirst.filter(entry => entry.card.pinned).map(entry => () => { entry.level = 'short'; }),
        ...lowFirst.filter(entry => entry.tier === 'scene').map(entry => () => { entry.level = 'drop'; }),
    ];
    let text = compose();
    for (const step of steps) {
        if (text.length <= budgetChars) break;
        step();
        text = compose();
    }
    const names = level => ordered.filter(entry => entry.level === level).map(entry => entry.card.name);
    const plan = { budget: budgetChars, used: text.length, full: names('full'), short: names('short'), named: names('name'), dropped: names('drop'), over: text.length > budgetChars };
    return { text, cards: ordered.filter(entry => ['full', 'short'].includes(entry.level)).map(entry => entry.card), omitted: plan.named.length + plan.dropped.length, plan };
}
