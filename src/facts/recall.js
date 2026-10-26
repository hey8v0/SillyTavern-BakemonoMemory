/**
 * 剧情事实 and recall working together. Pure.
 * - factsRecallKeywords: the cards the recent conversation names, as every name they go by, for the vector and
 *   keyword recall to find older summaries that used another name (“小晚” now, “林晚” back then).
 * - recallText: what the recalled hits say, so the facts injection can bring the cards they name.
 */
import { cardMentions } from './model.js';

export function factsRecallKeywords(facts, text, { max = 8 } = {}) {
    const source = String(text || '');
    if (!facts?.settings?.enabled || !source.trim()) return [];
    const named = (facts.cards || []).filter(card => card.kind !== 'note' && cardMentions(card, source) > 0);
    const names = [];
    for (const card of named) {
        for (const name of [card.name, ...card.aliases]) {
            const clean = String(name || '').trim();
            if (clean.length >= 2 && !names.includes(clean)) names.push(clean);
        }
    }
    return names.slice(0, Math.max(1, max));
}

export function recallText(hits = [], { maxChars = 6000 } = {}) {
    let text = '';
    for (const hit of Array.isArray(hits) ? hits : []) {
        const piece = [hit?.title, hit?.summary, hit?.matchedText, hit?.text].filter(value => typeof value === 'string' && value.trim()).join('\n');
        if (!piece) continue;
        if (text.length + piece.length > maxChars) break;
        text += (text ? '\n' : '') + piece;
    }
    return text;
}
