import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFinalPromptEntries, buildPromptSourceEntries, countNativePromptTokens } from '../src/features/prompt-inspector.js';

const countTokens = async value => String(value || '').length;

test('prompt inspector counts the final chat-completion messages instead of the legacy itemized sum', async () => {
    const total = await countNativePromptTokens([
        { role: 'system', content: '1234' },
        { role: 'user', content: '123456' },
        { role: 'assistant', content: '12' },
    ], { countTokens });
    assert.equal(total, 12);
});

test('prompt inspector includes multimodal content using the same per-part accounting as Prompt Viewer', async () => {
    const total = await countNativePromptTokens([
        {
            role: 'user',
            content: [
                { type: 'text', text: '123' },
                { type: 'image_url', image_url: { url: 'image', detail: 'high' } },
                { type: 'video_url', video_url: { url: 'video' } },
            ],
        },
    ], {
        countTokens,
        countImageTokens: async (_url, detail) => detail === 'high' ? 255 : 85,
        countVideoTokens: async () => 1000,
    });
    assert.equal(total, 1258);
});

test('prompt inspector preserves an omitted image detail so Prompt Viewer can apply its high-detail fallback', async () => {
    let receivedDetail = 'not-called';
    await countNativePromptTokens([
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'image' } }] },
    ], {
        countTokens,
        countImageTokens: async (_url, detail) => {
            receivedDetail = detail;
            return 85;
        },
    });
    assert.equal(receivedDetail, undefined);
});

test('prompt inspector counts assistant tool calls when message content is empty', async () => {
    const toolCalls = [{ id: 'call_1', function: { name: 'lookup', arguments: '{}' } }];
    const total = await countNativePromptTokens([
        { role: 'assistant', content: '', tool_calls: toolCalls },
    ], { countTokens });
    assert.equal(total, JSON.stringify(toolCalls).length);
});

test('prompt inspector lists the authoritative final request in message order', async () => {
    const entries = await buildFinalPromptEntries([
        { role: 'system', content: 'world book and preset' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
    ], { countTokens });
    assert.deepEqual(entries.map(entry => entry.key), ['message-1', 'message-2', 'message-3']);
    assert.deepEqual(entries.map(entry => entry.label), ['01 · 系统消息', '02 · 用户消息', '03 · 助手消息']);
    assert.deepEqual(entries.map(entry => entry.tokens), [21, 5, 2]);
    assert.equal(entries[0].getContent(), 'world book and preset');
    assert.equal(entries.reduce((sum, entry) => sum + entry.tokens, 0), 28);
});

test('prompt inspector keeps tool calls inside the corresponding final assistant message', async () => {
    const toolCalls = [{ id: 'call_1', function: { name: 'lookup', arguments: '{}' } }];
    const entries = await buildFinalPromptEntries([
        { role: 'assistant', content: '', tool_calls: toolCalls },
        { role: 'tool', content: 'result' },
    ], { countTokens });
    assert.equal(entries.length, 2);
    assert.match(entries[0].getContent(), /【工具调用】/);
    assert.match(entries[0].getContent(), /lookup/);
    assert.equal(entries[1].label, '02 · 工具结果');
});

test('prompt inspector keeps source browsing separate from the authoritative final message total', async () => {
    const entries = await buildPromptSourceEntries({
        charDescription: 'character',
        userPersona: 'persona',
        worldInfoString: 'triggered world book',
        mesSendString: 'chat history',
        allAnchors: 'extension memory',
    }, { countTokens });
    assert.deepEqual(entries.map(entry => entry.label), ['角色卡', 'User 人设', '世界书', '聊天记录', '扩展注入']);
    assert.equal(entries.find(entry => entry.label === '世界书').getContent(), 'triggered world book');
});
