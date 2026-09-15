import { getMatchedPhrases } from './matched-phrases.js';

const score = item => Number(item.hybridScore ?? item.rerankScore ?? item.score ?? 0);
const compare = (a, b) => score(b) - score(a)
    || Number(b.embeddingScore ?? b.similarity ?? 0) - Number(a.embeddingScore ?? a.similarity ?? 0)
    || Number(b.messageId || 0) - Number(a.messageId || 0) || String(a.id).localeCompare(String(b.id));
const sourceKey = item => item.isSavedSummary || item.memoryHash
    ? `memory:${item.memoryHash || item.id}` : `floor:${item.messageId}`;
const normalText = text => String(text || '').normalize('NFKC').replace(/\s+/g, ' ').trim();

export function groupRecallCandidates(candidates, records, bodies, limit, config = {}, queries = []) {
    const related = new Map();
    for (const record of records) {
        const key = sourceKey(record);
        if (!related.has(key)) related.set(key, []);
        related.get(key).push(record);
    }
    const groups = new Map();
    for (const item of candidates) {
        const key = config.injectMode === 'chunk' && !item.isSavedSummary && !item.memoryHash ? `chunk:${item.id}` : sourceKey(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return [...groups.entries()].map(([key, matches]) => {
        const best = matches.slice().sort(compare)[0];
        const siblings = related.get(sourceKey(best)) || [];
        const independent = !!(best.isSavedSummary || best.memoryHash);
        const summary = matches.filter(r => r.kind === 'summary').sort(compare)[0]
            || siblings.find(r => r.kind === 'summary');
        const bodyText = !independent && siblings.some(r => r.kind !== 'summary') ? String(bodies.get(Number(best.messageId)) || '').trim() : '';
        const label = best.role === 'user' ? '用户' : best.isHidden ? '隐藏楼层' : '助手';
        const bodyMatch = matches.filter(r => r.kind !== 'summary').sort(compare)[0];
        return { ...best, sourceGroup: key, rerankScore: score(best), score: score(best), matchedText: best.text,
            matchedChunks: matches.length,
            bodyText, bodyTitle: `${label} #${best.messageId}`,
            bodyPhrases: bodyText ? getMatchedPhrases({ text: bodyText }, queries, []) : [],
            bodyMatch: bodyMatch?.kind === 'chunk' ? bodyMatch.text : '', bodyMatchStart: bodyMatch?.chunkStart,
            chunkText: !independent && best.kind !== 'summary' ? best.text : '', chunkTitle: best.title || `${label} #${best.messageId}`,
            summaryText: String(summary?.text || best.summary || '').trim(),
            summaryTitle: independent ? best.title : `${best.role === 'user' ? '用户摘要' : best.isHidden ? '隐藏摘要' : '助手摘要'} #${best.messageId}`,
        };
    }).sort(compare).slice(0, limit);
}

function bodyAnchor(text, group) {
    const fragment = String(group.bodyMatch || '').replace(/(?:\.\.\.|…)$/, '');
    let start = Number.isInteger(group.bodyMatchStart) && text.slice(group.bodyMatchStart).startsWith(fragment)
        ? group.bodyMatchStart : fragment && text.indexOf(fragment);
    if (start === '' || start < 0) start = -1;
    const region = start >= 0 ? fragment : text;
    for (const phrase of [...(group.bodyPhrases || []), ...(group.matchedPhrases || [])]) {
        const at = region.toLowerCase().indexOf(String(phrase).toLowerCase());
        if (at >= 0) return (start >= 0 ? start : 0) + at;
    }
    return Math.max(0, start);
}

export function recallContextWindow(value, max, anchor = 0) {
    const text = String(value || '');
    if (text.length <= max) return { text, sourceTextStart: 0, sourceTextEnd: text.length };
    const room = Math.max(0, max - 2);
    let start = Math.max(0, Math.min(text.length - room, anchor - Math.floor(room / 3)));
    let end = Math.min(text.length, start + room);
    if (/[\uDC00-\uDFFF]/.test(text[start] || '')) start++;
    if (/[\uD800-\uDBFF]/.test(text[end - 1] || '')) end--;
    return { text: (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''), sourceTextStart: start, sourceTextEnd: end };
}

function clip(text, max) {
    const value = String(text || '').trim();
    if (value.length <= max) return value;
    if (max < 2) return '';
    let end = max - 1;
    if (/[\uD800-\uDBFF]/.test(value[end - 1] || '')) end--;
    return value.slice(0, end) + '…';
}

const heading = '## 向量召回记忆\n';
export function recallHitHeader(hit) {
    const tier = hit.recallTier === 'full' ? '全文' : hit.recallTier === 'chunk' ? '正文片段' : '摘要';
    return `- 来源：${hit.title}（${tier}${hit.truncated ? '，已截断' : ''}，重排 ${hit.rerankScore ?? hit.score ?? 0}，相似度 ${hit.similarity ?? 0}）\n`;
}
export function renderRecallPlan(hits) {
    return hits.length ? heading + hits.map(hit => recallHitHeader(hit) + hit.text).join('\n\n') : '';
}

export function selectRecallPlan(groups, config, { isCurrent = () => true } = {}) {
    const hits = [], decisions = [], seen = new Set();
    const mode = ['message', 'chunk'].includes(config.injectMode) ? config.injectMode : 'tiered';
    const floorCounts = new Map();
    const maxHits = Math.max(1, Number(config.finalRecallCount ?? config.maxRecallMessages ?? 5));
    const maxFull = Math.max(0, Number(config.fullRecallCount ?? 2));
    const threshold = Math.max(0, Number(config.rerankThreshold ?? .45));
    const budget = Math.max(200, Number(config.maxInjectChars ?? 2600));
    let fullCount = 0, used = heading.length;
    for (const group of groups) {
        const decision = { ...group, recallTier: 'dropped', decisionReason: '' };
        decisions.push(decision);
        const drop = reason => { decision.decisionReason = reason; };
        if (!isCurrent(group)) { drop('来源已变化'); continue; }
        if (hits.length >= maxHits) { drop('已达召回条数上限'); continue; }
        const floorKey = sourceKey(group);
        if (mode === 'chunk' && !group.memoryHash && !group.isSavedSummary
            && (floorCounts.get(floorKey) || 0) >= Math.max(1, Number(config.maxPerMessage ?? 2))) { drop('已达每楼层片段上限'); continue; }
        const chunk = mode === 'chunk' && !!group.chunkText;
        const qualifies = !!group.bodyText && (mode === 'message' || mode === 'tiered' && group.rerankScore >= threshold);
        if (qualifies && seen.has(`text:${normalText(group.bodyText)}`)) { drop('相同内容已合并'); continue; }
        let full = qualifies && (mode === 'message' || fullCount < maxFull);
        let reason = chunk ? '按命中片段召回' : full ? mode === 'message' ? '按楼层召回' : '达到全文阈值' : !group.bodyText || mode === 'chunk' ? '摘要来源' : !qualifies ? '未达全文阈值，使用摘要' : '全文名额已满，使用摘要';
        let raw = chunk ? group.chunkText : full ? group.bodyText : group.summaryText;
        if (!raw) { drop(!qualifies ? '未达全文阈值，且无可用摘要' : '全文名额已满，且无可用摘要'); continue; }
        const makeHit = (asFull, content, budgetLimit = Infinity) => {
            const limit = Math.min(budgetLimit, Math.max(asFull || chunk ? 200 : 120, Number(asFull || chunk ? config.perMessageMaxChars ?? 1600 : config.summaryMaxChars ?? 520)));
            const window = asFull ? recallContextWindow(content, limit, bodyAnchor(content, group)) : { text: clip(content, limit) };
            return { ...group, ...window, kind: asFull ? 'message' : chunk ? 'chunk' : 'summary', recallTier: asFull ? 'full' : chunk ? 'chunk' : 'summary',
                title: asFull ? group.bodyTitle : chunk ? group.chunkTitle : group.summaryTitle, truncated: !!group.truncated || window.text !== content,
                score: Number(group.rerankScore.toFixed(4)), rerankScore: Number(group.rerankScore.toFixed(4)),
                similarity: Number(Number(group.embeddingScore ?? group.similarity ?? 0).toFixed(4)),
            };
        };
        let hit = makeHit(full, raw);
        const remaining = budget - used - (hits.length ? 2 : 0);
        if (mode === 'tiered' && full && recallHitHeader(hit).length + hit.text.length > remaining && group.summaryText) {
            const fallback = makeHit(false, group.summaryText);
            if (recallHitHeader(fallback).length + fallback.text.length <= remaining) {
                hit = fallback; full = false; raw = group.summaryText; reason = '全文超出剩余预算，使用摘要';
            }
        }
        const identity = `${group.memoryHash ? group.sourceGroup : 'text'}:${normalText(raw)}`;
        if (seen.has(identity)) { drop('相同内容已合并'); continue; }
        if (recallHitHeader(hit).length + hit.text.length > remaining) {
            hit.truncated = true;
            const available = remaining - recallHitHeader(hit).length;
            if (available < 20) { drop('剩余字数预算不足'); continue; }
            hit = makeHit(full, raw, available); reason += '；按剩余预算截断';
        } else if (hit.truncated) reason += '；按单条上限截断';
        seen.add(identity);
        hit.preview = hit.text.slice(0, 220);
        hit.decisionReason = reason;
        decision.recallTier = hit.recallTier; decision.decisionReason = reason; decision.truncated = hit.truncated;
        used += (hits.length ? 2 : 0) + recallHitHeader(hit).length + hit.text.length;
        hits.push(hit); if (full) fullCount++;
        floorCounts.set(floorKey, (floorCounts.get(floorKey) || 0) + 1);
    }
    hits.sort((a, b) => Number(a.messageId) - Number(b.messageId) || String(a.id).localeCompare(String(b.id)));
    return { hits, decisions, text: renderRecallPlan(hits) };
}
