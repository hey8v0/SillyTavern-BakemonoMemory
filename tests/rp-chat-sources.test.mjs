import test from 'node:test';
import assert from 'node:assert/strict';
import { readChatSource, findChatSource } from '../src/rp-core/chat-sources.js';
test('chat source identity follows the message, survives serialization and isolates swipes', () => {
    let n = 0;
    const message = { mes: '她答应了', extra: { otherPlugin: true } };
    const a = readChatSource(message, {}, { allocate: true, makeId: () => String(++n) });
    const key = a.messageId + '|' + a.variantId;
    const restored = JSON.parse(JSON.stringify(message));
    assert.equal(findChatSource([null, restored], {}, key).floor, 1);
    restored.swipe_id = 1;
    const b = readChatSource(restored, {}, { allocate: true, makeId: () => String(++n) });
    assert.equal(b.messageId, a.messageId);
    assert.notEqual(b.variantId, a.variantId);
    assert.equal(restored.extra.otherPlugin, true);
    assert.equal(message.mes, '她答应了');
    assert.equal(findChatSource([message, structuredClone(message)], {}, key), null);
    message.is_system = true;
    assert.equal(findChatSource([message], {}, key).messageId, a.messageId);
});
test('RP source filtering preserves source spans and rejects missing include tags', () => {
    const state = { turnSummary: { includeTags: '正文', excludeTags: '小剧场' } };
    const message = { mes: '忽略<正文>真实剧情<小剧场>番外</小剧场></正文>' };
    const source = readChatSource(message, state, { allocate: true, makeId: () => 'id' });
    assert.equal(source.text, '真实剧情');
    assert.equal(message.mes.slice(source.spans[0].start, source.spans.at(-1).end), '真实剧情');
    assert.equal(readChatSource({ ...message, mes: '没有读取标签的正文' }, state).text, '');
});
