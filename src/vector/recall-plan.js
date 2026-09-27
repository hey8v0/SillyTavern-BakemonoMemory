import { getMatchedPhrases } from './matched-phrases.js';

const score = item => Number(item.hybridScore ?? item.rerankScore ?? item.score ?? 0);
const compare = (a, b) => score(b) - score(a)
    || Number(b.embeddingScore ?? b.similarity ?? 0) - Number(a.embeddingScore ?? a.similarity ?? 0)
    || Number(b.messageId || 0) - Number(a.messageId || 0) || String(a.id).localeCompare(String(b.id));
const sourceKey = item => item.isSavedSummary || item.memoryHash
    ? `memory:${item.memoryHash || item.id}` : `floor:${item.messageId}`;
const normalText = text => String(text || '').normalize('NFKC').replace(/\s+/g, ' ').trim();

// One group per floor (or per saved summary): the floor's inline summary and its cleaned body travel together.
export function groupRecallCandidates(candidates, records, bodies, limit, config = {}, queries = []) {
    const related = new Map();
    for (const record of records) {
        const key = sourceKey(record);
        if (!related.has(key)) related.set(key, []);
        related.get(key).push(record);
    }
    const groups = new Map();
    for (const item of candidates) {
        const key = sourceKey(item);
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
        return { ...best, sourceGroup: key, rerankScore: score(best), score: score(best), matchedText: best.text,
            matchedChunks: matches.length,
            bodyText, bodyTitle: `${label} #${best.messageId}`,
            bodyPhrases: bodyText ? getMatchedPhrases({ text: bodyText }, queries, []) : [],
            summaryText: String(summary?.text || best.summary || '').trim(),
            summaryTitle: independent ? best.title : `${best.role === 'user' ? '用户摘要' : best.isHidden ? '隐藏摘要' : '助手摘要'} #${best.messageId}`,
        };
    }).sort(compare).slice(0, limit);
}

const heading = '## 向量召回记忆\n';
export function recallHitHeader(hit) {
    const tier = hit.recallTier === 'full' ? '全文' : '摘要';
    return `- 来源：${hit.title}（${tier}，重排 ${hit.rerankScore ?? hit.score ?? 0}，相似度 ${hit.similarity ?? 0}）\n`;
}
export function renderRecallPlan(hits) {
    return hits.length ? heading + hits.map(hit => recallHitHeader(hit) + hit.text).join('\n\n') : '';
}

export function recallLimits(config = {}) {
    const count = (value, fallback) => Math.max(0, Math.floor(Number(value ?? fallback)) || 0);
    return {
        maxSummary: count(config.maxSummaryRecall, 4),
        maxFull: count(config.fullRecallCount, 2),
        threshold: Math.max(0, Number(config.rerankThreshold ?? .45)),
        cap: Math.max(1000, Number(config.recallSafetyChars ?? 12000) || 12000),
    };
}

// Summaries and full texts have their own counts. Nothing is cut: an item that would push the injection over the
// safety cap is left out whole (a full text first falls back to the floor's summary).
export function selectRecallPlan(groups, config = {}, { isCurrent = () => true } = {}) {
    const { maxSummary, maxFull, threshold, cap } = recallLimits(config);
    const hits = [], decisions = [], seen = new Set();
    let summaries = 0, fulls = 0, used = heading.length;
    for (const group of groups) {
        const decision = { ...group, recallTier: 'dropped', decisionReason: '' };
        decisions.push(decision);
        const drop = reason => { decision.decisionReason = reason; };
        if (!isCurrent(group)) { drop('来源已变化'); continue; }
        const closeEnough = !!group.bodyText && group.rerankScore >= threshold;
        const options = [];
        if (closeEnough && fulls < maxFull) options.push('full');
        if (group.summaryText && summaries < maxSummary) options.push('summary');
        if (!options.length) {
            drop(!group.summaryText && !group.bodyText ? '没有可用内容'
                : !group.summaryText && seen.has(`text:${normalText(group.bodyText)}`) ? '相同内容已经带上'
                : group.summaryText ? `摘要已满 ${maxSummary} 条`
                : closeEnough ? `正文已满 ${maxFull} 条，这一楼没有摘要`
                : '这一楼没有摘要，正文又不够像');
            continue;
        }
        let chosen = null, reason = '';
        for (const tier of options) {
            const text = tier === 'full' ? group.bodyText : group.summaryText;
            const identity = `${group.memoryHash ? group.sourceGroup : 'text'}:${normalText(text)}`;
            if (seen.has(identity)) { reason = '相同内容已经带上'; continue; }
            const hit = { ...group, text, kind: tier === 'full' ? 'message' : 'summary', recallTier: tier,
                title: tier === 'full' ? group.bodyTitle : group.summaryTitle, truncated: false,
                score: Number(group.rerankScore.toFixed(4)), rerankScore: Number(group.rerankScore.toFixed(4)),
                similarity: Number(Number(group.embeddingScore ?? group.similarity ?? 0).toFixed(4)),
            };
            const cost = (hits.length ? 2 : 0) + recallHitHeader(hit).length + text.length;
            if (used + cost > cap) { reason = `放不下：超过保险上限 ${cap} 字`; continue; }
            chosen = { hit, cost, identity };
            break;
        }
        if (!chosen) { drop(reason); continue; }
        const { hit } = chosen;
        hit.decisionReason = hit.recallTier === 'full' ? '够像，带正文'
            : !group.bodyText ? (group.isSavedSummary || group.memoryHash ? '已存的总结' : '带摘要')
            : !closeEnough ? '没到带正文的程度，带摘要'
            : fulls >= maxFull ? `正文已满 ${maxFull} 条，带摘要`
            : '正文放不下或重复，带摘要';
        hit.preview = hit.text.slice(0, 220);
        seen.add(chosen.identity);
        used += chosen.cost;
        decision.recallTier = hit.recallTier; decision.decisionReason = hit.decisionReason; decision.truncated = false;
        hits.push(hit);
        if (hit.recallTier === 'full') fulls++; else summaries++;
    }
    hits.sort((a, b) => Number(a.messageId) - Number(b.messageId) || String(a.id).localeCompare(String(b.id)));
    return { hits, decisions, text: renderRecallPlan(hits) };
}
