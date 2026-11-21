import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfiguration } from '../src/config/defaults.js';
import { createRequestCounts } from '../src/features/request-counts.js';
import { createGenerationClient } from '../src/features/generation-client.js';
import { runApiRequest } from '../src/shared/request-policy.js';

test('factory default uses sentence search', () => {
    const defaults = createDefaultConfiguration({ memoryStrategies: {}, workflowModes: {}, stageSourceModes: {}, extensionPromptRoles: {}, defaultGenerationTargets: {} });
    assert.equal(defaults.defaultVectorMemory.queryMode, 'off');
});

test('quiet calls preserve the send window and different chats have independent totals', async () => {
    const counts = createRequestCounts(), state = { automation: {} }, other = {};
    const client = createGenerationClient({ ensureState: () => state, recordRequest: counts.record, generateRaw: async () => 'done' });
    counts.begin(state, 'normal');
    await client.callGenerationModel({ requestKind: 'facts' });
    counts.begin(state, 'quiet');
    await client.callGenerationModel({});
    assert.match(counts.describe(state), /整理事实 1 次、单独摘要／补写 1 次/);
    counts.begin(state, 'swipe');
    assert.match(counts.describe(state), /自本轮发送起：0 次。当前聊天本页累计 2 次/);
    assert.match(counts.describe(other), /首次发送前：0 次。当前聊天本页累计 0 次/);
});

test('count dispatch attempts including a retry, excluding a cancelled operation before dispatch', async () => {
    let sent = 0;
    const counts = createRequestCounts(), state = {};
    const options = { onDispatch: () => counts.record(state, 'embedding'), wait: async () => {},
        fetchImpl: async () => ++sent === 1 ? new Response('', { status: 503 }) : Response.json({}) };
    await runApiRequest(options);
    await assert.rejects(runApiRequest({ ...options, signal: AbortSignal.abort() }));
    assert.equal(sent, 2);
    assert.match(counts.describe(state), /Embedding 2 次/);
});
