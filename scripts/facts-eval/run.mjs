// RP memory evaluation for 剧情事实: runs the corpus through the real 整理 pipeline (controller + task queue + prompt +
// parser + injection) with a scripted model (offline) or an OpenAI-compatible chat endpoint, then reports
// - the scenario checks (corpus.mjs) and the key-fact / wrong-fact rates (measures.mjs),
// - recall: the plugin's hybrid retrieval over the summaries with a local embedding, with and without the cards,
// - flows: code paths that need no model (a held result whose material changed is not applied),
// - cost: requests, tokens (from the API's usage, or estimated), time.
//
//   node scripts/facts-eval/run.mjs                                  # offline, scripted replies (no requests)
//   node scripts/facts-eval/run.mjs --long 1000                      # the story stretched over ~1000 floors
//   node scripts/facts-eval/run.mjs --api https://host/v1 --model m --dry          # what a real run would send
//   node scripts/facts-eval/run.mjs --api https://host/v1 --model m [--key sk-…]   # real model (key or FACTS_EVAL_KEY)
//   node scripts/facts-eval/compare.mjs a.json b.json                # two runs side by side
//
// Nothing is sent unless --api is given and --dry is not. The key is read from --key or FACTS_EVAL_KEY only.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as corpus from './corpus.mjs';
import { judge, keyFacts, recallQueries, wrongFacts } from './measures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const mod = file => import(pathToFileURL(path.join(repo, 'src', file)).href);
const fillerLines = ['雨停了又下，镇上一切照旧。', '集市上来了卖鱼的船，吵了一上午。', '风从海上吹来，屋檐滴着水。', '夜里有人唱歌，到天亮才停。', '码头的钟慢了半刻，没人去修。', '街角的面馆换了招牌。'];

async function load() {
    const [model, controllerModule, queueModule, injection, textModule, recall, hybrid, math] = await Promise.all([
        mod('facts/model.js'), mod('features/facts-controller.js'), mod('features/summary-task-queue.js'), mod('facts/injection.js'),
        mod('shared/text.js'), mod('facts/recall.js'), mod('vector/hybrid-retrieval.js'), mod('vector/math.js')]);
    return { ...model, ...controllerModule, ...queueModule, ...injection, ...textModule, ...recall, ...hybrid, ...math };
}

// One chat with the facts controller and the real task queue around `callModel`.
function pipeline(m, { floors, every, review = false, callModel }) {
    const blockTypes = { STORY: 'story', STAGE: 'stage', EPIC: 'epic', FACTS: 'facts' };
    const chat = Array.from({ length: floors }, (_, i) => ({ mes: `第 ${i} 楼正文`, is_user: i % 2 === 1 }));
    const defaults = m.createDefaultFacts();
    const state = { facts: { ...defaults, settings: { ...defaults.settings, enabled: true, auto: true, review, everySummaries: every, idleMinutes: 0 } },
        generationPrompts: {}, taskQueue: [], drafts: [], storySummaries: [], blocks: [], stageSummaries: [], epicSummaries: [], automation: {}, vectorMemory: { enabled: false } };
    const toastr = { info: () => {}, warning: () => {}, error: () => {}, success: () => {}, clear: () => {} };
    let controller = null;
    const queue = m.createSummaryTaskQueue({ getState: () => state, getHash: m.getHash, getKindLabel: k => k, saveState: () => {}, renderWorkbenchScope: () => {}, renderTaskQueueProgress: () => {},
        workbenchRenderScopes: { DRAFTS: 'drafts' }, getIsBusy: () => false, setBusy: () => {}, toastr, callGenerationModel: args => callModel(args, state), normalizeGeneratedBakemono: v => v,
        createDraft: () => { throw Error('no drafts'); }, commitDraft: async () => null, blockTypes, defaultAutomation: {}, switchWorkbenchTab: () => {},
        getTaskSourceSignature: task => controller.sourceSignature(task, state), resultHandlers: { facts: (...args) => controller.handleTaskResult(...args) } });
    controller = m.createFactsController({ getState: () => state, getChat: () => chat, saveState: () => {}, enqueueSummaryTask: task => queue.enqueueSummaryTask({ ...task, autoStart: false }),
        blockTypes, getBlockPlainText: text => String(text).replace(/<[^>]+>/g, ''), toastr, renderWorkbenchScope: () => {}, workbenchRenderScopes: { DRAFTS: 'drafts' },
        confirm: async () => true, storyTimeContext: () => '', setTimer: () => 0, clearTimer: () => {},
        createDraft: data => { const draft = { id: 'draft-' + state.drafts.length, title: '', ...data }; state.drafts.unshift(draft); return draft; } });
    const addSummary = (floor, text) => state.storySummaries.push({ hash: `s${floor}`, contentHash: m.getHash(text), content: text, sourceMessageIds: [floor] });
    const setSummary = (floor, text) => Object.assign(state.storySummaries.find(item => item.hash === `s${floor}`), { content: text, contentHash: m.getHash(text) });
    const failures = [];
    async function drain(trigger) {
        for (let guard = 0; guard < 2000 && controller.pendingSummaries(state).length; guard++) {
            const before = state.taskQueue.length;
            if (trigger === 'manual') await controller.runManual(); else controller.maybeRun({ trigger });
            if (state.taskQueue.length === before) break;
            await queue.processTaskQueue();
            const failed = state.taskQueue.filter(task => task.status === 'failed' && !failures.includes(task.error));
            for (const task of failed) failures.push(task.error);
            if (failed.length) break;
        }
    }
    return { state, chat, queue, controller, addSummary, setSummary, drain, failures };
}

// Local recall over the summaries: the plugin's hybrid scoring with a hashed local embedding (no API). The same
// queries with and without the cards' keywords and floors; a query counts when an answering floor is in the top 3.
function recallEval(m, facts, summaries, shift) {
    const records = summaries.map(([floor, text]) => ({ id: `s${floor}`, messageId: floor, text, title: '', summary: '', embedding: m.createLocalEmbedding(text) }));
    const rank = (query, hints) => {
        const embedding = m.createLocalEmbedding(query);
        const floors = new Set(hints.floors || []);
        const scored = records.map(record => ({ ...record, embeddingScore: m.cosineSimilarity(embedding, record.embedding),
            keywordHits: m.countKeywordHits(record.text, hints.keywords || []), ...(floors.has(record.messageId) ? { factsHint: true } : {}) }));
        return m.selectHybridCandidates(scored, [query], hints.keywords || [], { candidateCount: 20 }).map(record => record.messageId);
    };
    const rows = recallQueries.map(([query, answers]) => {
        const expected = answers.map(shift);
        const base = rank(query, { keywords: [], floors: [] }).slice(0, 3);
        const hints = m.factsRecallHints(facts, query);
        const withFacts = rank(query, hints).slice(0, 3);
        return { query, expected, base, withFacts, baseHit: base.some(floor => expected.includes(floor)), factsHit: withFacts.some(floor => expected.includes(floor)), hints };
    });
    return { rows, base: rows.filter(row => row.baseHit).length, withFacts: rows.filter(row => row.factsHit).length, total: rows.length };
}

// Code paths that need no model: they run with scripted replies whatever --api says.
async function flowChecks(m) {
    const results = [];
    const reply = cards => `<factCards>${JSON.stringify({ cards })}</factCards>`;
    {
        const p = pipeline(m, { floors: 12, every: 3, review: true, callModel: async () => reply([{ kind: 'person', name: '林晚', fields: { 处境: '在码头' } }]) });
        [2, 4, 6].forEach(floor => p.addSummary(floor, `第 ${floor} 楼：林晚去码头。`));
        await p.drain('auto');
        p.setSummary(4, '第 4 楼：林晚其实留在书店。');
        const applied = await p.controller.applyDraft(p.state.drafts[0]?.id);
        results.push({ name: '待确认的整理结果读过的摘要被改了，不会被应用', ok: !!p.state.drafts.length && applied === null && !p.state.facts.cards.length && /改过/.test(p.state.drafts[0].metadata.inputError || '') });
    }
    {
        const p = pipeline(m, { floors: 30, every: 3, callModel: async (args, state) => {
            const from = state.taskQueue.find(task => task.status === 'running')?.metadata.factsFloorFrom;
            return from === 20 ? `<factCards>${JSON.stringify({ cards: [{ kind: 'person', name: '老看守', fields: { 处境: '死于塌方' } }], retired: ['老看守'] })}</factCards>`
                : `<factCards>${JSON.stringify({ cards: [{ kind: 'person', name: '老看守', fields: { 处境: '在门口守夜' } }], revived: ['老看守'] })}</factCards>`;
        } });
        [20, 22, 24].forEach(floor => p.addSummary(floor, `第 ${floor} 楼：老看守死于塌方。`));
        await p.drain('auto');
        p.addSummary(2, '第 2 楼：老看守在门口守夜。');
        await p.drain('manual');
        const keeper = p.state.facts.cards.find(card => card.name === '老看守');
        results.push({ name: '补写的旧楼层说他还活着、模型也写了 revived，死人也不会复活', ok: keeper?.status === 'retired' && /死/.test(keeper.fields.处境) });
    }
    return results;
}

export async function runEval({ api = '', key = '', model = '', temperature = 0.2, every = corpus.everySummaries, name = '', long = 0, dry = false, log = () => {} } = {}) {
    const m = await load();
    const offline = !api || dry;
    // --long N stretches the story: neutral filler floors after floor 60 push the second half N floors further away.
    const gap = long > 122 ? Math.ceil((long - 122) / 12) * 12 : 0;
    const shift = floor => floor > 60 ? floor + gap : floor;
    const story = corpus.summaries.map(([floor, text]) => [shift(floor), text]);
    const filler = Array.from({ length: gap / 2 }, (_, i) => [62 + i * 2, `第 ${62 + i * 2} 楼：${fillerLines[i % fillerLines.length]}`]);
    const metrics = { requests: 0, promptChars: 0, replyChars: 0, promptTokens: 0, completionTokens: 0, ms: 0, batches: [] };
    const fillerFloors = new Set(filler.map(([floor]) => floor));
    const runningTask = state => state.taskQueue.find(task => task.status === 'running');
    async function callModel({ prompt, systemPrompt, signal }, state) {
        const task = runningTask(state);
        metrics.requests += 1;
        metrics.promptChars += prompt.length + (systemPrompt || '').length;
        metrics.batches.push({ from: task?.metadata.factsFloorFrom, to: task?.metadata.factsFloorTo, count: task?.metadata.factsCount, promptChars: prompt.length });
        const started = Date.now();
        try {
            if (offline) {
                const from = task?.metadata?.factsFloorFrom;
                if (fillerFloors.has(from)) return '<factCards>{"cards":[]}</factCards>';
                const original = from > 60 + gap ? from - gap : from;
                const keyName = original === corpus.backfillFloor ? 'backfill' : original === corpus.rerollFloor ? 'reroll' : original;
                const reply = dry ? '<factCards>{"cards":[]}</factCards>' : corpus.scriptedReplies[keyName];
                if (!reply) throw new Error(`没有第 ${from} 楼这批的脚本回复`);
                metrics.replyChars += reply.length;
                return reply;
            }
            const response = await fetch(`${api.replace(/\/+$/, '')}/chat/completions`, { method: 'POST', signal,
                headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
                body: JSON.stringify({ model, temperature, stream: false, messages: [...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []), { role: 'user', content: prompt }] }) });
            if (!response.ok) throw new Error(`接口返回 ${response.status} ${response.statusText}`);
            const data = await response.json();
            if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message || '接口报错');
            const text = data?.choices?.[0]?.message?.content || '';
            metrics.replyChars += text.length;
            metrics.promptTokens += Number(data?.usage?.prompt_tokens) || 0;
            metrics.completionTokens += Number(data?.usage?.completion_tokens) || 0;
            return text;
        } finally { metrics.ms += Date.now() - started; }
    }

    const p = pipeline(m, { floors: 122 + gap, every, callModel });
    for (const [floor, text] of [...story, ...filler].sort((a, b) => a[0] - b[0])) if (floor !== corpus.backfillFloor) p.addSummary(floor, text);
    log('整理：主流程');
    await p.drain('auto');
    log('整理：补写旧摘要');
    p.addSummary(corpus.backfillFloor, corpus.backfillText);
    await p.drain('manual');
    log('整理：重 roll 改写');
    p.setSummary(shift(corpus.rerollFloor), corpus.rerollText);
    await p.drain('manual');

    const facts = p.controller.facts(p.state);
    const inject = text => m.renderFactsSection(facts, text).text;
    const card = (cardName, kind = null) => m.findCard(facts.cards, cardName, kind);
    const hints = text => m.factsRecallHints(facts, text);
    const results = corpus.checks.map(check => { let ok = false, error = ''; try { ok = !!check.run({ facts, inject, card, hints, shift }); } catch (e) { error = e.message; } return { id: check.id, name: check.name, ok, error }; });
    const known = corpus.knownNames;
    const unknownCards = facts.cards.filter(c => !known.some(n => c.name.includes(n) || n.includes(c.name))).map(c => `${c.kind}:${c.name}`);
    const keys = judge(facts, m.findCard, keyFacts), wrongs = judge(facts, m.findCard, wrongFacts);
    const injected = inject('林晚和沈砚在青石镇的铺子里说话。');
    // One round as the plugin builds it: the latest two floors as the scene, a few floors back, a 32k model's budget.
    const round = m.renderFactsSection(facts, { scene: '林晚和沈砚在青石镇的铺子里说话。', recent: '阿砚和林霜去了北方，青石的手指断了。', recalled: '' },
        { budgetChars: m.injectionBudget(facts.settings, 32000).chars });
    const report = {
        name: name || (dry ? 'dry-run' : offline ? 'offline' : model), model: dry ? `${model || '?'}（未发送）` : offline ? 'scripted' : model, at: new Date().toISOString(), every, floors: 122 + gap,
        passed: results.filter(r => r.ok).length, total: results.length, results,
        keyFacts: { hit: keys.filter(k => k.hit).length, total: keys.length, missed: keys.filter(k => !k.hit) },
        wrongFacts: { hit: wrongs.filter(w => w.hit).length, total: wrongs.length, found: wrongs.filter(w => w.hit) },
        recall: recallEval(m, facts, [...story, ...filler], shift),
        flows: await flowChecks(m),
        cards: facts.cards.length, unknownCards, conflicts: (facts.conflicts || []).filter(c => c.status === 'open').length,
        warnings: facts.history.flatMap(h => h.warnings || []).length, pending: p.controller.pendingSummaries(p.state).length,
        injectedChars: injected.length,
        injection: { budget: round.plan.budget, used: round.plan.used, full: round.plan.full.length, short: round.plan.short.length, named: round.plan.named.length, dropped: round.plan.dropped.length },
        metrics: { ...metrics, failures: p.failures, tokensEstimated: metrics.promptTokens ? null : Math.round((metrics.promptChars + metrics.replyChars) / 1.6) },
        cardsSnapshot: facts.cards.map(c => ({ kind: c.kind, name: c.name, status: c.status, fields: c.fields, timeline: c.timeline, floors: c.floors })),
    };
    return report;
}

export function formatReport(report) {
    const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : '—';
    const lines = [`剧情事实评测 · ${report.name} · ${report.model} · ${report.floors} 楼 · 每 ${report.every} 条一批`,
        ...report.results.map(r => `${r.ok ? '✔' : '✖'} ${String(r.id).padEnd(3)} ${r.name}${r.error ? `（出错：${r.error}）` : ''}`),
        `场景 ${report.passed}/${report.total}`,
        `关键事实 ${report.keyFacts.hit}/${report.keyFacts.total}（遗漏 ${report.keyFacts.total - report.keyFacts.hit}${report.keyFacts.missed.length ? '：' + report.keyFacts.missed.map(k => `${k.name}${k.field ? '.' + k.field : ''}=${k.value ?? '无此卡'}`).join('；') : ''}）`,
        `错误事实 ${report.wrongFacts.hit}/${report.wrongFacts.total}${report.wrongFacts.found.length ? '：' + report.wrongFacts.found.map(w => `${w.name}${w.field ? '.' + w.field : ''}=${w.value}`).join('；') : ''} · 无据新增卡 ${report.unknownCards.length}${report.unknownCards.length ? `（${report.unknownCards.join('、')}）` : ''}`,
        `召回（本地嵌入，前 3 条命中）：不用卡片 ${report.recall.base}/${report.recall.total} · 用卡片 ${report.recall.withFacts}/${report.recall.total}`,
        ...report.recall.rows.filter(row => row.baseHit !== row.factsHit || !row.factsHit).map(row => `   ${row.factsHit ? '↑' : '·'} ${row.query} 期望第 ${row.expected.join('/')} 楼，不用卡片 ${row.base.join(',')}，用卡片 ${row.withFacts.join(',')}`),
        ...report.flows.map(flow => `${flow.ok ? '✔' : '✖'} 流程 · ${flow.name}`),
        `卡片 ${report.cards} 张 · 待裁决 ${report.conflicts} · 整理警告 ${report.warnings} · 未整理 ${report.pending} · 一轮注入约 ${report.injectedChars} 字`,
        ...(report.injection ? [`分层注入（32k 模型）：${report.injection.used} / ${report.injection.budget} 字 · 完整 ${report.injection.full} · 一行 ${report.injection.short} · 只列名字 ${report.injection.named} · 没放进去 ${report.injection.dropped}`] : []),
        `请求 ${report.metrics.requests} 次（平均每次 ${Math.round(report.metrics.promptChars / Math.max(1, report.metrics.requests))} 字提示词）· 失败 ${report.metrics.failures.length} · Token ${report.metrics.promptTokens ? `${report.metrics.promptTokens}+${report.metrics.completionTokens}` : `约 ${report.metrics.tokensEstimated}（按字数估）`} · 耗时 ${(report.metrics.ms / 1000).toFixed(1)} 秒`,
        `关键事实命中率 ${pct(report.keyFacts.hit, report.keyFacts.total)} · 错误率 ${pct(report.wrongFacts.hit, report.wrongFacts.total)}`];
    return lines.join('\n');
}

export function passed(report) {
    return report.passed === report.total && report.wrongFacts.hit === 0 && report.flows.every(flow => flow.ok);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = Object.fromEntries(process.argv.slice(2).map((arg, i, all) => arg.startsWith('--') ? [arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true'] : null).filter(Boolean));
    const report = await runEval({ api: args.api || '', key: args.key || process.env.FACTS_EVAL_KEY || '', model: args.model || '', temperature: Number(args.temperature ?? 0.2),
        every: Number(args.every) || corpus.everySummaries, name: args.name || '', long: Number(args.long) || 0, dry: args.dry === 'true', log: message => console.error(message) });
    if (args.dry === 'true') {
        console.log(`预估：会发 ${report.metrics.requests} 次请求，提示词共约 ${report.metrics.promptChars} 字（约 ${Math.round(report.metrics.promptChars / 1.6)} Token 输入，不含回复；真实运行时卡片越来越多，提示词会再长一些）。没有发送任何请求。`);
    } else console.log(formatReport(report));
    const out = path.join(here, '.output');
    await mkdir(out, { recursive: true });
    const file = path.join(out, `${(report.name || 'run').replace(/[^\w.-]+/g, '_')}-${report.at.replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify(report, null, 2));
    console.log(`结果：${file}`);
    process.exitCode = args.dry === 'true' || passed(report) ? 0 : 1;
}
