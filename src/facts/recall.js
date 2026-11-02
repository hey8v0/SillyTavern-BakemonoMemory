/**
 * 剧情事实 and recall working together. Pure.
 * - factsRecallKeywords: the cards the recent conversation names, as every name they go by, for the vector and
 *   keyword recall to find older summaries that used another name (“小晚” now, “林晚” back then).
 * - recallText: what the recalled hits say, so the facts injection can bring the cards they name.
 * - factsRecallHints: the same names, the floors a line that reaches back may mean, and the cards a line names that
 *   the visible chat does not, whose floors recall brings whatever the similarity says.
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

// A line that reaches back without naming what it means: “那天晚上你答应过我的事”, “还记得吗”.
const callbackCue = /答应|约定|承诺|发誓|说好|保证过|许诺|还记得|记不记得|记得吗|那天|那晚|那夜|那次|那一次|当初|当年|上次|上回|以前你|那时候/;

// The floors a card's story is on; cards from before floors were kept go by the floors of their changes.
const floorsOf = card => card.floors?.length ? card.floors
    : [...new Set([...Object.values(card.asOf || {}), ...(card.timeline || []).map(item => item.floor)].filter(Number.isInteger))];

// Recall hints from the cards: every name of the cards the line mentions (keywords), and, when the line reaches
// back without naming its subject, the floors where the promises and threads were told (floors). Threads of the
// people the line names come first; with no name, every thread, closed ones too (a kept promise is still a memory).
// `line` is what the user just wrote and `visible` the rest of the chat the model can see: a card the line names and
// the visible chat does not is someone being reached back for (named), not someone who is simply around.
export function factsRecallHints(facts, text, { maxKeywords = 8, maxFloors = 12, line = '', visible = '', maxNamed = 3 } = {}) {
    const source = String(text || '');
    if (!facts?.settings?.enabled || !(source.trim() || String(line).trim())) return { keywords: [], floors: [], named: [] };
    const keywords = factsRecallKeywords(facts, source, { max: maxKeywords });
    const cards = facts.cards || [];
    const named = !String(line).trim() ? [] : cards.filter(card => card.kind !== 'note' && cardMentions(card, line) > 0 && !cardMentions(card, visible))
        .map(card => ({ name: card.name, floors: floorsOf(card) })).filter(item => item.floors.length).slice(0, Math.max(0, maxNamed));
    if (!callbackCue.test(source)) return { keywords, floors: [], named };
    const people = cards.filter(card => card.kind === 'person' && cardMentions(card, source) > 0);
    const threads = cards.filter(card => card.kind === 'thread')
        .filter(card => !people.length || people.some(person => cardMentions(person, [card.name, ...Object.values(card.fields)].join('\n')) > 0));
    const floors = [...new Set(threads.flatMap(floorsOf))].sort((a, b) => b - a).slice(0, maxFloors);
    return { keywords, floors, named };
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
