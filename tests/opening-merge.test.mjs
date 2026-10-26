import test from 'node:test';
import assert from 'node:assert/strict';
import { openingFloors, isFirstReplyTurn } from '../src/shared/opening.js';
import { buildFloorMemoryIndex } from '../src/memory/floor-memory-index.js';
import { createSummarySourceService } from '../src/features/summary-source-service.js';

const block = events => '<rpEvents>' + JSON.stringify({ version: 2, events }) + '</rpEvents>';
const e = (action, data) => ({ action, data });

test('开场白 is the character text before the first user message, only once the user has written', () => {
    assert.deepEqual(openingFloors([{ mes: '开场白' }]), [], 'a lone reply is not a 开场白 yet');
    const chat = [{ mes: '开场白' }, { mes: '你好', is_user: true }];
    assert.deepEqual(openingFloors(chat), [0]);
    assert.equal(isFirstReplyTurn(chat), true, 'the first reply is about to be written');
    chat.push({ mes: '第一条回复' });
    assert.equal(isFirstReplyTurn(chat), true, 're-rolling the first reply still covers the 开场白');
    chat.push({ mes: '继续', is_user: true });
    assert.equal(isFirstReplyTurn(chat), false);
});

test('开场白 is never a missing summary; it takes the first reply’s state', () => {
    const messages = [{ mes: '开场白' }, { mes: '你好', is_user: true }, { mes: '回复' }];
    const empty = buildFloorMemoryIndex({ messages, state: {} });
    assert.deepEqual(empty.records.map(record => [record.id, record.summaryState]), [[2, 'missing']]);
    const saved = buildFloorMemoryIndex({ messages, state: { blocks: [{ hash: 'h', type: 'story', messageId: 2, content: '摘要' }] } });
    assert.deepEqual(saved.records.map(record => [record.id, record.summaryState]), [[0, 'saved'], [2, 'saved']]);
    assert.ok(saved.records[0].summarySources.includes('随第一轮记下'));
});

test('queuing many batches checks the chat sources once', () => {
    let reads = 0;
    const state = { storySummaries: [], stageSummaries: [], epicSummaries: [], blocks: [], tableDatabase: { tables: [] } };
    const service = createSummarySourceService({ getState: () => state, getChat: () => { reads++; return []; } });
    service.once(() => { service.refresh(); service.refresh(); service.refresh(); });
    const inside = reads;
    service.refresh();
    assert.ok(reads > inside, 'outside once() every refresh reads the chat again');
    assert.equal(inside, 2, 'one refresh reads the chat twice (chronicle + links)');
});
