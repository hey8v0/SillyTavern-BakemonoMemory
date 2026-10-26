/**
 * The 剧情事实 section of the injected memory: cards the recent floors name, pinned cards, open 线索, then the
 * reflection. Fits the character budget card by card, most relevant first.
 */
import { describeCard, factKindLabels, isOpenThread, selectRelevantCards, storyOrder } from './model.js';

// The last couple of transitions of a card, as one clause: 曾经：持有者 林晚（到第 24 楼）、沈砚（到第 51 楼）.
export function describeTimeline(card, { max = 2 } = {}) {
    const items = storyOrder(card.timeline).filter(item => item.from && item.field !== '已结束' && item.field !== '恢复').slice(-max);
    if (!items.length) return '';
    const byField = new Map();
    for (const item of items) byField.set(item.field, [...(byField.get(item.field) || []), item]);
    const when = item => item.floor == null ? '' : item.past ? `（第 ${item.floor} 楼时）` : `（到第 ${item.floor} 楼）`;
    return '曾经：' + [...byField.entries()].map(([field, list]) => `${field} ${list.map(item => `${item.from}${when(item)}`).join('、')}`).join('；');
}

export function renderFactCardLine(card) {
    const body = [describeCard(card), describeTimeline(card)].filter(Boolean).join('；');
    return `${factKindLabels[card.kind]} ${card.name}${card.aliases.length ? `（${card.aliases.join('、')}）` : ''}${card.status === 'retired' ? '（已结束）' : ''}${body ? '：' + body : ''}`;
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

export function renderFactsSection(facts, recentText, { budgetChars = facts?.settings?.budgetChars || 6000, injectReflection = facts?.settings?.injectReflection !== false } = {}) {
    if (!facts?.settings?.enabled) return { text: '', cards: [], omitted: 0 };
    const reflection = injectReflection ? renderReflection(facts.reflection, facts.cards) : '';
    const header = '## 剧情事实\n';
    const candidates = selectRelevantCards(facts.cards, recentText, { max: 200, includeNotes: true });
    const lines = [];
    let used = header.length + (reflection ? reflection.length + 2 : 0);
    const selected = [];
    for (const card of candidates) {
        const line = renderFactCardLine(card);
        if (used + line.length + 1 > budgetChars) continue;
        lines.push(line);
        selected.push(card);
        used += line.length + 1;
    }
    const text = [lines.length ? header + lines.join('\n') : '', reflection].filter(Boolean).join('\n\n');
    return { text, cards: selected, omitted: candidates.length - selected.length };
}
