/**
 * Reads the model's <factCards> block. Tolerates code fences, text around the block, trailing commas and
 * single-quoted keys; anything else fails the whole run so no half-read result reaches the cards.
 */
import { parseLooseObject } from '../shared/loose-json.js';

export function extractFactCardsBlock(raw) {
    const source = String(raw || '');
    const tagged = source.match(/<factCards\b[^>]*>([\s\S]*?)<\/factCards\s*>/i);
    let body = tagged ? tagged[1] : source;
    body = body.replace(/```(?:json)?/gi, '').trim();
    const start = body.indexOf('{'), end = body.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('没有找到 <factCards> 里的 JSON 内容。');
    return body.slice(start, end + 1);
}

export function parseFactCards(raw) {
    const json = extractFactCardsBlock(raw);
    let data;
    try { data = JSON.parse(json); }
    catch {
        try { data = parseLooseObject(json); }
        catch { throw new Error('整理结果的 JSON 无法解析，本次没有改动任何卡片；可以重试。'); }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('整理结果不是一个对象。');
    // Field values stay as written: a string replaces, null clears, a missing field keeps (the model decides).
    const cards = Array.isArray(data.cards) ? data.cards.filter(card => card && typeof card === 'object') : [];
    const retired = (Array.isArray(data.retired) ? data.retired : []).map(item => typeof item === 'string' ? item : item?.name).filter(name => typeof name === 'string');
    const reflection = data.reflection && typeof data.reflection === 'object' ? data.reflection : {};
    // What the model could not settle: { name, field, says }, left to the user.
    const conflicts = (Array.isArray(data.conflicts) ? data.conflicts : [])
        .filter(item => item && typeof item === 'object' && typeof item.name === 'string' && typeof item.says === 'string')
        .map(item => ({ name: item.name, field: typeof item.field === 'string' ? item.field : '', says: item.says }));
    if (!Array.isArray(data.cards) && !retired.length && !Object.keys(reflection).length && !conflicts.length) throw new Error('整理结果里没有 cards、retired 或 reflection。');
    return { cards, retired, reflection, conflicts };
}
