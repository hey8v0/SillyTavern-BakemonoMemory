/**
 * The 剧情事实 section of the injected memory: cards the recent floors name, pinned cards, open 线索, then the
 * reflection. Fits the character budget card by card, most relevant first.
 */
import { describeCard, factKindLabels, selectRelevantCards } from './model.js';

export function renderFactCardLine(card) {
    const body = describeCard(card);
    return `${factKindLabels[card.kind]} ${card.name}${card.aliases.length ? `（${card.aliases.join('、')}）` : ''}${body ? '：' + body : ''}`;
}

export function renderReflection(reflection) {
    const lines = [['mainline', '主线'], ['threads', '伏笔与约定'], ['arcs', '人物弧线']].filter(([key]) => reflection?.[key]).map(([key, label]) => `${label}：${reflection[key]}`);
    return lines.length ? '## 主线与伏笔\n' + lines.join('\n') : '';
}

export function renderFactsSection(facts, recentText, { budgetChars = facts?.settings?.budgetChars || 6000, injectReflection = facts?.settings?.injectReflection !== false } = {}) {
    if (!facts?.settings?.enabled) return { text: '', cards: [], omitted: 0 };
    const reflection = injectReflection ? renderReflection(facts.reflection) : '';
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
