/**
 * What to search for in one round, without asking a model. Pure.
 * A query made of many messages is a blur: a short line that reaches back drowns in what surrounds it, and the term
 * list runs out before it gets to the newest message. So the latest user messages are searched one by one, long ones
 * sentence by sentence as well; what came just before goes in as one query that counts for less.
 */
export const contextQueryWeight = 0.5;

const sentenceEnd = /[。！？!?；;…\n]+/;
const outerMarks = /^[\s*_~“”"'‘’「」『』（）()【】《》—-]+|[\s*_~“”"'‘’「」『』（）()【】《》—-]+$/gu;
const meaningful = text => String(text || '').replace(/[\s\p{P}\p{S}]/gu, '');

// `messages`: [{ isUser, text }] in chat order, cleaned of tags. Returns [{ text, weight }], the newest line first.
export function splitRecallQueries(messages = [], { maxQueries = 6, maxQueryChars = 300, contextChars = 600, minSentenceChars = 4, maxUserMessages = 3 } = {}) {
    const list = messages.filter(message => String(message?.text || '').trim());
    let end = list.length - 1;
    while (end >= 0 && !list[end].isUser) end--;
    let start = end;
    while (start > 0 && list[start - 1].isUser && end - start + 1 < maxUserMessages) start--;
    const seen = new Set(), lines = [];
    const add = text => {
        const clean = String(text || '').trim(), key = meaningful(clean);
        if (!key || seen.has(key)) return;
        seen.add(key);
        lines.push(clean);
    };
    for (let index = end; index >= start && end >= 0; index--) {
        const text = String(list[index].text).trim();
        if (meaningful(text).length >= 2) add(text.slice(0, maxQueryChars));
        const sentences = text.split(sentenceEnd).map(part => part.replace(outerMarks, '')).filter(part => meaningful(part).length >= minSentenceChars);
        // The end of a message is nearest to what is being asked.
        for (const sentence of sentences.reverse().slice(0, maxQueries)) add(sentence.slice(0, maxQueryChars));
    }
    // What came just before: the reply and the message in front of it, or a reply written after the user's line.
    const around = [...list.slice(end + 1), ...list.slice(Math.max(0, start - 2), Math.max(0, start))];
    const contextText = (end >= 0 ? around : list.slice(-2)).map(message => String(message.text).trim()).join('\n').slice(-contextChars);
    const queries = lines.slice(0, Math.max(1, maxQueries - (contextText ? 1 : 0))).map(text => ({ text, weight: 1 }));
    if (contextText && !seen.has(meaningful(contextText))) queries.push({ text: contextText, weight: queries.length ? contextQueryWeight : 1 });
    return queries;
}
