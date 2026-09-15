import { sourceSnapshot, normalizeEvidenceText } from './source.js';
import { readStoryDate } from './clock.js';

const list = value => String(value || '').split(/[\s,，;；]+/).filter(Boolean);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Supplemental sources have their own revisions; the legacy body source stays unchanged.
export function readSummarySources(raw, identity, state) {
    const tags = list(state.scanRules?.includeTags);
    const selected = [...new Set((tags.length ? tags : ['bakemono']).map(tag => tag.toLowerCase()))];
    const excluded = ['script', 'style', 'thinking', 'think', 'rpEvents', 'tableEdit',
        ...list(state.scanRules?.excludeTags), ...list(state.turnSummary?.excludeTags), ...list(state.vectorMemory?.excludeTags)];
    const result = [];
    for (const tag of selected.filter(tag => /^[\p{L}][\p{L}\p{N}_-]*$/u.test(tag) && !excluded.some(value => value.toLowerCase() === tag))) {
        let index = 0;
        for (const match of raw.matchAll(new RegExp('<' + escape(tag) + '\\b[^>]*>([\\s\\S]*?)<\\/' + escape(tag) + '\\s*>', 'gi'))) {
            // Restrict free-text evidence to the header and ordinary narrative sections.
            const end = match[1].search(/(?:➤|▶|►|#{1,4}|【)\s*(?:[^\p{L}]{0,8})?(?:第四面墙|墙外|小剧场|未回收伏笔|伏笔|推测|推理|暗线|作者的话)/u);
            const content = end < 0 ? match[1] : match[1].slice(0, end);
            const offset = match.index + match[0].indexOf('>') + 1;
            const source = sourceSnapshot(content, { ...identity, variantId: identity.variantId + ':summary:' + tag + ':' + index++ }, { excludeTags: excluded });
            source.spans = source.spans.map(span => ({ start: span.start + offset, end: span.end + offset }));
            source.sourceKind = 'summary';
            source.header = normalizeEvidenceText(content.split(/(?:➤|▶|►|\n\s*#{1,4}\s)/u)[0], { excludeTags: excluded }).text;
            if (source.text) result.push(source);
        }
    }
    return result;
}

function explicitDate(value) {
    const match = value.match(/^(\d{4})(?:年|[-/])(\d{1,2})(?:月|[-/])(\d{1,2})(?:日)?/);
    if (!match) return null;
    const time = value.slice(match[0].length).match(/^(?:[- T\s]|星期[一二三四五六日天]|周[一二三四五六日天])*(\d{1,2})[:：](\d{2})/);
    const date = match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0')
        + (time ? 'T' + time[1].padStart(2, '0') + ':' + time[2] : '');
    return readStoryDate(date) ? date : null;
}

export function summaryStateEvents(source) {
    const events = [];
    // Multiple blocks may describe different moments. Let the model resolve that context.
    if (source.supplements?.length !== 1) return events;
    for (const summary of source.supplements || []) {
        const header = summary.header;
        if (/(梦境|假设|回忆|如果|时间跨度|跨越|本阶段|多次总结|剧集终了)/u.test(header)) continue;
        const fields = [...header.matchAll(/(当前时间|剧情时间|时间|当前地点|场景地点|地点|在场角色|在场人物)[：:]\s*([^★☆|｜【】\n]+?)(?=\s*(?:当前时间|剧情时间|时间|当前地点|场景地点|地点|在场角色|在场人物)[：:]|[★☆|｜【】\n]|$)/gu)];
        if (!fields.some(field => /时间/.test(field[1]))) {
            for (const date of header.matchAll(/(?:^|[★☆|｜【】])\s*(\d{4}(?:年|[-/])\d{1,2}(?:月|[-/])\d{1,2}[^★☆|｜【】\n]*)/gu)) fields.push([date[1], '当前时间', date[1]]);
        }
        const values = new Map();
        let timeRange = false;
        for (const match of fields) {
            const kind = /时间/.test(match[1]) ? 'time' : /地点/.test(match[1]) ? 'place' : 'cast';
            if (values.has(kind)) { values.set(kind, null); continue; }
            const value = match[2].trim();
            if (kind === 'time' && (/→|至|~|～|—|–/.test(value) || [...value.matchAll(/\d{4}(?:年|[-/])\d{1,2}(?:月|[-/])\d{1,2}/g)].length > 1)) timeRange = true;
            if (!value || value.length > 300 || /未知|未定|待定|不明|→|至|~|～|—|–|可能|猜测/.test(value)
                || (kind === 'time' && [...value.matchAll(/\d{4}(?:年|[-/])\d{1,2}(?:月|[-/])\d{1,2}/g)].length > 1)) continue;
            values.set(kind, { value, excerpt: match[0].trim() });
        }
        if (timeRange) continue;
        const push = (action, data, excerpt) => events.push({ track: 'facts', action, data, excerpt, source: 'summary' });
        const time = values.get('time'), place = values.get('place'), cast = values.get('cast');
        if (time) push('clock_set', { date: explicitDate(time.value), description: time.value }, time.excerpt);
        if (place) push('scene_recorded', { location: place.value }, place.excerpt);
        if (cast) {
            const names = cast.value.split(/[、,，]/).map(name => name.trim()).filter(Boolean);
            if (names.length <= 12 && names.every(name => /^[\p{L}\p{N}·・ -]{1,40}$/u.test(name))) {
                for (const name of names) {
                    push('person_registered', { id: name, name }, cast.excerpt);
                    // An explicit cast list refers to this scene, not everybody mentioned in the summary.
                    if (place) push('person_moved', { id: name, location: place.value }, header);
                }
            }
        }
    }
    return events;
}
