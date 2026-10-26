// How the 剧情事实 hot paths scale with a long chat: node scripts/facts-eval/perf.mjs [500 1000 2000 5000]
// For each size: a chat with that many 剧情摘要 already consolidated, ~150 cards with full timelines and floors, and
// one new batch pending. Measures what runs on every message or reply (pendingSummaries, the facts injection, the
// recall hints, the hybrid recall over all summaries with a local embedding) and once per 整理 (applyFactsUpdate),
// plus the size the facts add to the chat file. Phones are slower than a desktop: read these as relative numbers.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const mod = file => import(pathToFileURL(path.join(repo, 'src', file)).href);

export async function measure(size, { repeat = 5 } = {}) {
    const [model, { createFactsController }, { renderFactsSection }, { factsRecallHints }, { getHash, countKeywordHits }, { selectHybridCandidates }, { createLocalEmbedding, cosineSimilarity }] = await Promise.all([
        mod('facts/model.js'), mod('features/facts-controller.js'), mod('facts/injection.js'), mod('facts/recall.js'), mod('shared/text.js'), mod('vector/hybrid-retrieval.js'), mod('vector/math.js')]);
    const people = Array.from({ length: 60 }, (_, i) => `人物${i}`), items = Array.from({ length: 40 }, (_, i) => `物品${i}`), threads = Array.from({ length: 50 }, (_, i) => `约定${i}`);
    const summaryText = floor => `第 ${floor} 楼：${people[floor % 60]}把${items[floor % 40]}交给了${people[(floor + 7) % 60]}，想起${threads[floor % 50]}。雨还在下。`;
    const facts = model.createDefaultFacts();
    facts.settings.enabled = true;
    const summaries = Array.from({ length: size }, (_, i) => { const floor = 2 + i * 2; const text = summaryText(floor); return { hash: `s${floor}`, contentHash: getHash(text), content: text, sourceMessageIds: [floor] }; });
    // Build the cards the way 整理 would, batch by batch, so timelines, floors and history are realistic.
    for (let start = 0; start < size; start += 6) {
        const batch = summaries.slice(start, start + 6);
        const floorFrom = batch[0].sourceMessageIds[0], floorTo = batch.at(-1).sourceMessageIds[0];
        const cards = batch.flatMap(summary => { const f = summary.sourceMessageIds[0];
            return [{ kind: 'person', name: people[f % 60], fields: { 处境: `第 ${f} 楼在镇上`, 持有: items[f % 40] } }, { kind: 'item', name: items[f % 40], fields: { 持有者: people[(f + 7) % 60] } },
                { kind: 'thread', name: threads[f % 50], fields: { 内容: `${people[f % 60]}答应的事`, 状态: f % 4 ? '未了' : '已了' } }]; });
        model.applyFactsUpdate(facts, { cards }, { floorFrom, floorTo, sources: batch.map(s => ({ hash: s.hash, revision: s.contentHash, floorEnd: s.sourceMessageIds[0] })),
            mentionFloors: card => batch.filter(s => model.cardMentions(card, s.content) > 0).map(s => s.sourceMessageIds[0]) });
    }
    const pendingFloor = 2 + size * 2;
    const state = { facts, storySummaries: [...summaries, { hash: `s${pendingFloor}`, contentHash: 'x', content: summaryText(pendingFloor), sourceMessageIds: [pendingFloor] }],
        blocks: [], taskQueue: [], drafts: [], stageSummaries: [], epicSummaries: [], generationPrompts: {} };
    const chat = Array.from({ length: pendingFloor + 2 }, (_, i) => ({ mes: '', is_user: i % 2 === 1 }));
    const controller = createFactsController({ getState: () => state, getChat: () => chat, saveState: () => {}, enqueueSummaryTask: () => null,
        blockTypes: { STORY: 'story', FACTS: 'facts' }, storyTimeContext: () => '', setTimer: () => 0, clearTimer: () => {} });
    const time = fn => { fn(); const started = performance.now(); for (let i = 0; i < repeat; i++) fn(); return (performance.now() - started) / repeat; };
    const recent = `${people[3]}问起${items[5]}的下落。那天晚上你答应过我的事情，还记得吗？`;
    const records = summaries.map(s => ({ id: s.hash, messageId: s.sourceMessageIds[0], text: s.content, title: '', summary: '', embedding: createLocalEmbedding(s.content) }));
    const hybrid = () => {
        const hints = factsRecallHints(facts, recent), floors = new Set(hints.floors), query = createLocalEmbedding(recent);
        const scored = records.map(r => ({ ...r, embeddingScore: cosineSimilarity(query, r.embedding), keywordHits: countKeywordHits(r.text, hints.keywords), ...(floors.has(r.messageId) ? { factsHint: true } : {}) }));
        return selectHybridCandidates(scored, [recent], hints.keywords, { candidateCount: 20 });
    };
    const batch = { cards: [{ kind: 'person', name: people[1], fields: { 处境: '在码头' } }, { kind: 'item', name: items[1], fields: { 持有者: people[2] } }] };
    return {
        summaries: size, cards: facts.cards.length, history: facts.history.length,
        pendingMs: time(() => controller.pendingSummaries(state)),
        injectionMs: time(() => renderFactsSection(facts, recent)),
        hintsMs: time(() => factsRecallHints(facts, recent)),
        hybridRecallMs: time(hybrid),
        applyMs: time(() => model.applyFactsUpdate(structuredClone(facts), batch, { floorFrom: pendingFloor, floorTo: pendingFloor })),
        factsKB: Math.round(JSON.stringify(facts).length / 1024),
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const sizes = process.argv.slice(2).map(Number).filter(Boolean);
    const rows = [];
    for (const size of sizes.length ? sizes : [500, 1000, 2000]) rows.push(await measure(size));
    const fmt = value => typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : String(value);
    console.log('摘要条数 | 卡片 | 选材 ms | 注入 ms | 召回提示 ms | 混合召回 ms | 一次整理写入 ms | 剧情事实 KB');
    for (const r of rows) console.log([r.summaries, r.cards, r.pendingMs, r.injectionMs, r.hintsMs, r.hybridRecallMs, r.applyMs, r.factsKB].map(fmt).join(' | '));
    console.log('（电脑上测得；手机通常慢 3–5 倍。选材、注入和召回提示每条消息都会跑，混合召回只在开了向量记忆时每轮跑一次。）');
}
