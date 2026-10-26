import test from 'node:test';
import assert from 'node:assert/strict';
import { runEval, formatReport, passed } from '../scripts/facts-eval/run.mjs';
import { compareReports } from '../scripts/facts-eval/compare.mjs';
import { measure } from '../scripts/facts-eval/perf.mjs';
import { checks, summaries, scriptedReplies } from '../scripts/facts-eval/corpus.mjs';
import { keyFacts, recallQueries, wrongFacts } from '../scripts/facts-eval/measures.mjs';

// The evaluation corpus run offline with the scripted replies: a careful model's answers (and two careless ones the
// code must stop) through the real pipeline. Keeps the corpus, the measures and the runner in step with the code.
test('the RP memory corpus passes every scenario offline: all key facts, no wrong ones, the flows hold', async () => {
    assert.equal(summaries.length, 60);
    assert.equal(Object.keys(scriptedReplies).length, 12);
    const report = await runEval({});
    const text = formatReport(report);
    assert.ok(passed(report), text);
    assert.equal(report.total, checks.length);
    assert.deepEqual([report.keyFacts.hit, report.keyFacts.total], [keyFacts.length, keyFacts.length], text);
    assert.deepEqual([report.wrongFacts.hit, report.wrongFacts.total], [0, wrongFacts.length], text);
    assert.equal(report.flows.length, 2);
    assert.equal(report.metrics.requests, 12, 'ten batches, the backfill and the reroll');
    assert.deepEqual(report.metrics.failures, []);
    assert.equal(report.pending, 0);
    assert.deepEqual(report.unknownCards, []);
    assert.equal(report.recall.total, recallQueries.length);
    assert.ok(report.recall.withFacts > report.recall.base, `the cards help recall: ${report.recall.base} → ${report.recall.withFacts}`);
    assert.ok(report.recall.rows.find(row => /答应过我的事/.test(row.query)).factsHit);
});

test('stretched over about a thousand floors the memory is the same, and comparing two runs says what changed', async () => {
    const short = await runEval({});
    const long = await runEval({ long: 1000 });
    assert.ok(long.floors >= 1000);
    assert.ok(passed(long), formatReport(long));
    assert.equal(long.keyFacts.hit, short.keyFacts.hit);
    assert.ok(long.recall.rows.find(row => /答应过我的事/.test(row.query)).factsHit, 'a promise ~900 floors back is still found');
    assert.ok(long.metrics.requests > short.metrics.requests);
    const diff = compareReports(short, long);
    assert.match(diff, /请求次数：12 → \d+  ↓ 更差/);
    assert.match(diff, /关键事实：14 → 14  =/);
});

test('a dry run against an API sends nothing and says what it would cost', async () => {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => { calls.push(args); throw new Error('no network in a dry run'); };
    try {
        const report = await runEval({ api: 'http://127.0.0.1:9/v1', model: 'x', dry: true });
        assert.equal(calls.length, 0);
        assert.equal(report.metrics.requests, 12);
        assert.ok(report.metrics.promptChars > 10000);
    } finally { globalThis.fetch = original; }
});

// Long chats: the paths that run on every message stay cheap, and the facts stay a modest part of the chat file.
test('with 2,000 summaries the per-message paths stay in milliseconds and the facts stay under 700 KB', async () => {
    const r = await measure(2000, { repeat: 3 });
    assert.ok(r.pendingMs < 50, `选材 ${r.pendingMs} ms`);
    assert.ok(r.injectionMs < 20, `注入 ${r.injectionMs} ms`);
    assert.ok(r.hintsMs < 20, `召回提示 ${r.hintsMs} ms`);
    assert.ok(r.factsKB < 700, `剧情事实 ${r.factsKB} KB`);
});
