// RP memory evaluation for 剧情事实 (第三阶段): runs the corpus through the real 整理 pipeline (controller + task
// queue + prompt + parser + injection), with a scripted model (offline) or an OpenAI-compatible chat endpoint,
// then scores the ten scenarios and the cost.
//
//   node scripts/facts-eval/run.mjs                       # offline: scripted replies, checks the pipeline
//   node scripts/facts-eval/run.mjs --api https://host/v1 --key sk-… --model gpt-4.1 [--temperature 0.2] [--name run1]
//
// Results print as a table and go to scripts/facts-eval/.output/<name>.json. Compare two runs by their JSON.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as corpus from './corpus.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const mod = file => import(pathToFileURL(path.join(repo, 'src', file)).href);

export async function runEval({ api = '', key = '', model = '', temperature = 0.2, every = corpus.everySummaries, name = '', log = () => {} } = {}) {
    const [{ createDefaultFacts, findCard }, { createFactsController }, { createSummaryTaskQueue }, { renderFactsSection }, { getHash }] = await Promise.all([
        mod('facts/model.js'), mod('features/facts-controller.js'), mod('features/summary-task-queue.js'), mod('facts/injection.js'), mod('shared/text.js')]);
    const blockTypes = { STORY: 'story', STAGE: 'stage', EPIC: 'epic', FACTS: 'facts' };
    const floors = 122;
    const chat = Array.from({ length: floors }, (_, i) => ({ mes: `第 ${i} 楼正文`, is_user: i % 2 === 1 }));
    const state = { facts: { ...createDefaultFacts(), settings: { ...createDefaultFacts().settings, enabled: true, auto: true, everySummaries: every, idleMinutes: 0 } },
        generationPrompts: {}, taskQueue: [], drafts: [], storySummaries: [], blocks: [], stageSummaries: [], epicSummaries: [], automation: {}, vectorMemory: { enabled: false } };
    const addSummary = (floor, text) => state.storySummaries.push({ hash: `s${floor}`, contentHash: getHash(text), content: text, sourceMessageIds: [floor] });
    for (const [floor, text] of corpus.summaries) if (floor !== corpus.backfillFloor) addSummary(floor, text);

    const metrics = { requests: 0, promptChars: 0, replyChars: 0, promptTokens: 0, completionTokens: 0, ms: 0, failures: [] };
    const offline = !api;
    const runningTask = () => state.taskQueue.find(task => task.status === 'running');
    async function callGenerationModel({ prompt, systemPrompt, signal }) {
        metrics.requests += 1;
        metrics.promptChars += prompt.length + (systemPrompt || '').length;
        const started = Date.now();
        try {
            if (offline) {
                const from = runningTask()?.metadata?.factsFloorFrom;
                const keyName = from === corpus.backfillFloor ? 'backfill' : from === corpus.rerollFloor ? 'reroll' : from;
                const reply = corpus.scriptedReplies[keyName];
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

    const scopes = [];
    const toastr = { info: () => {}, warning: () => {}, error: (m) => scopes.push(['error', m]), success: () => {}, clear: () => {} };
    const queue = createSummaryTaskQueue({ getState: () => state, getHash, getKindLabel: k => k, saveState: () => {}, renderWorkbenchScope: (s, t) => scopes.push(['scope', t]), renderTaskQueueProgress: () => {},
        workbenchRenderScopes: { DRAFTS: 'drafts' }, getIsBusy: () => false, setBusy: () => {}, toastr, callGenerationModel, normalizeGeneratedBakemono: v => v,
        createDraft: () => { throw Error('no drafts'); }, commitDraft: async () => null, blockTypes, defaultAutomation: {}, switchWorkbenchTab: () => {},
        getTaskSourceSignature: task => controller.sourceSignature(task, state), resultHandlers: { facts: (...args) => controller.handleTaskResult(...args) } });
    const controller = createFactsController({ getState: () => state, getChat: () => chat, saveState: () => {}, enqueueSummaryTask: task => queue.enqueueSummaryTask({ ...task, autoStart: false }),
        blockTypes, getBlockPlainText: text => String(text).replace(/<[^>]+>/g, ''), toastr, renderWorkbenchScope: (s, t) => scopes.push(['scope', t]), workbenchRenderScopes: { DRAFTS: 'drafts' },
        confirm: async () => true, storyTimeContext: () => '', setTimer: () => 0, clearTimer: () => {} });

    // The main pass: batches of `every`, chained by the controller the way a chat would do it.
    async function drain(trigger) {
        for (let guard = 0; guard < 40 && controller.pendingSummaries(state).length; guard++) {
            const before = state.taskQueue.length;
            if (trigger === 'manual') await controller.runManual(); else controller.maybeRun({ trigger });
            if (state.taskQueue.length === before) break;
            await queue.processTaskQueue();
            const failed = state.taskQueue.filter(task => task.status === 'failed' && !metrics.failures.includes(task.error));
            for (const task of failed) metrics.failures.push(task.error);
            if (failed.length) break;
        }
    }
    log('整理：主流程');
    await drain('auto');
    log('整理：补写旧摘要');
    addSummary(corpus.backfillFloor, corpus.backfillText);
    await drain('manual');
    log('整理：重 roll 改写');
    const target = state.storySummaries.find(item => item.hash === `s${corpus.rerollFloor}`);
    Object.assign(target, { content: corpus.rerollText, contentHash: getHash(corpus.rerollText) });
    await drain('manual');

    const facts = controller.facts(state);
    const inject = text => renderFactsSection(facts, text).text;
    const card = (name, kind = null) => findCard(facts.cards, name, kind);
    const results = corpus.checks.map(check => { let ok = false, error = ''; try { ok = !!check.run({ facts, inject, card }); } catch (e) { error = e.message; } return { id: check.id, name: check.name, ok, error }; });
    const known = corpus.knownNames;
    const unknownCards = facts.cards.filter(c => !known.some(n => c.name.includes(n) || n.includes(c.name))).map(c => `${c.kind}:${c.name}`);
    const report = {
        name: name || (offline ? 'offline' : model), model: offline ? 'scripted' : model, at: new Date().toISOString(), every,
        passed: results.filter(r => r.ok).length, total: results.length, results,
        cards: facts.cards.length, unknownCards, conflicts: (facts.conflicts || []).filter(c => c.status === 'open').length,
        warnings: facts.history.flatMap(h => h.warnings || []).length, pending: controller.pendingSummaries(state).length,
        metrics: { ...metrics, tokensEstimated: metrics.promptTokens ? null : Math.round((metrics.promptChars + metrics.replyChars) / 1.6) },
        cardsSnapshot: facts.cards.map(c => ({ kind: c.kind, name: c.name, status: c.status, fields: c.fields, timeline: c.timeline })),
    };
    return report;
}

export function formatReport(report) {
    const lines = [`剧情事实评测 · ${report.name} · ${report.model} · 每 ${report.every} 条一批`,
        ...report.results.map(r => `${r.ok ? '✔' : '✖'} ${String(r.id).padEnd(3)} ${r.name}${r.error ? `（出错：${r.error}）` : ''}`),
        `通过 ${report.passed}/${report.total} · 卡片 ${report.cards} 张 · 无据新增 ${report.unknownCards.length}${report.unknownCards.length ? `（${report.unknownCards.join('、')}）` : ''} · 待裁决 ${report.conflicts} · 整理警告 ${report.warnings} · 未整理 ${report.pending}`,
        `请求 ${report.metrics.requests} 次 · 失败 ${report.metrics.failures.length} · Token ${report.metrics.promptTokens ? `${report.metrics.promptTokens}+${report.metrics.completionTokens}` : `约 ${report.metrics.tokensEstimated}（按字数估）`} · 耗时 ${(report.metrics.ms / 1000).toFixed(1)} 秒`];
    return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = Object.fromEntries(process.argv.slice(2).map((arg, i, all) => arg.startsWith('--') ? [arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true'] : null).filter(Boolean));
    const report = await runEval({ api: args.api || '', key: args.key || process.env.FACTS_EVAL_KEY || '', model: args.model || '', temperature: Number(args.temperature ?? 0.2),
        every: Number(args.every) || corpus.everySummaries, name: args.name || '', log: message => console.error(message) });
    console.log(formatReport(report));
    const out = path.join(here, '.output');
    await mkdir(out, { recursive: true });
    const file = path.join(out, `${(report.name || 'run').replace(/[^\w.-]+/g, '_')}-${report.at.replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify(report, null, 2));
    console.log(`结果：${file}`);
    process.exitCode = report.passed === report.total ? 0 : 1;
}
