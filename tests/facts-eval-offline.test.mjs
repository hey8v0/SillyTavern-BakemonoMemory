import test from 'node:test';
import assert from 'node:assert/strict';
import { runEval, formatReport } from '../scripts/facts-eval/run.mjs';
import { checks, summaries, scriptedReplies } from '../scripts/facts-eval/corpus.mjs';

// The evaluation corpus run offline with the scripted replies: a careful model's answers must satisfy every
// scenario through the real pipeline, so the corpus, the checks and the runner stay in step with the code.
test('the RP memory corpus passes all ten scenarios offline through the real 整理 pipeline', async () => {
    assert.equal(summaries.length, 60);
    assert.equal(Object.keys(scriptedReplies).length, 12);
    const report = await runEval({});
    const text = formatReport(report);
    assert.equal(report.passed, report.total, text);
    assert.equal(report.total, checks.length);
    assert.equal(report.metrics.requests, 12, 'ten batches, the backfill and the reroll');
    assert.deepEqual(report.metrics.failures, []);
    assert.equal(report.pending, 0);
    assert.deepEqual(report.unknownCards, []);
    assert.match(text, /通过 \d+\/\d+/);
});
