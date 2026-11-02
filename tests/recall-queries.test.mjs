import test from 'node:test';
import assert from 'node:assert/strict';
import { contextQueryWeight, splitRecallQueries } from '../src/vector/query-split.js';
import { cosineSimilarity, createLocalEmbedding } from '../src/vector/math.js';
import { selectHybridCandidates } from '../src/vector/hybrid-retrieval.js';
import { longReply, recallFixture } from './helpers/recall-fixture.mjs';

const user = text => ({ isUser: true, text });
const reply = text => ({ isUser: false, text });
const texts = queries => queries.map(query => query.text);

// A short line that reaches back drowns in a query made of everything around it. Each latest user line is searched by
// itself, long ones sentence by sentence; what came just before goes in as one query that counts for less.
test('the latest user message is a query of its own, and what came before counts for less', () => {
    const queries = splitRecallQueries([reply('雨下了一整夜，她站在门口。'), user('外公呢')]);
    assert.deepEqual(queries, [{ text: '外公呢', weight: 1 }, { text: '雨下了一整夜，她站在门口。', weight: contextQueryWeight }]);
    assert.ok(contextQueryWeight > 0 && contextQueryWeight < 1);
});

test('a message of several sentences is searched whole and by sentence; marks and scraps do not become queries', () => {
    const queries = texts(splitRecallQueries([user('*我推开门，看着她。*“那天晚上你答应过我的事情，还记得吗？”嗯。')]));
    assert.equal(queries[0], '*我推开门，看着她。*“那天晚上你答应过我的事情，还记得吗？”嗯。');
    assert.ok(queries.includes('那天晚上你答应过我的事情，还记得吗'), queries.join('|'));
    assert.ok(queries.includes('我推开门，看着她'), queries.join('|'));
    assert.ok(!queries.includes('嗯'), 'a scrap has nothing to search for');
    assert.deepEqual(texts(splitRecallQueries([user('还记得那把钥匙吗？')])), ['还记得那把钥匙吗？'], 'one sentence is one query, not two');
    assert.deepEqual(splitRecallQueries([user('。。。')]), [], 'nothing to search for');
    assert.deepEqual(texts(splitRecallQueries([user('外公')])), ['外公'], 'a whole message of two characters is a real question');
});

test('several user messages in a row each count, the newest first; a reply after them (continue, swipe) is context', () => {
    const queries = texts(splitRecallQueries([reply('上一段回复。'), user('晚上好'), user('今天我要回家看外公'), reply('她点点头，没有说话。')]));
    assert.deepEqual(queries.slice(0, 2), ['今天我要回家看外公', '晚上好']);
    assert.match(queries.at(-1), /她点点头/);
    assert.equal(splitRecallQueries([reply('她点点头。'), user('嗯嗯'), reply('门开了。')]).at(-1).weight, contextQueryWeight);
});

test('with nothing from the user the latest reply is the query at full weight; the count and the length have limits', () => {
    assert.deepEqual(splitRecallQueries([reply('她站在门口。')]), [{ text: '她站在门口。', weight: 1 }]);
    assert.deepEqual(splitRecallQueries([]), []);
    const many = Array.from({ length: 30 }, (_, i) => `第${i}句话说的是不同的事情。`).join('');
    const queries = splitRecallQueries([reply('之前的回复写得很长。'.repeat(200)), user(many)]);
    assert.ok(queries.length <= 6, String(queries.length));
    assert.ok(queries.every(query => query.text.length <= 620), 'a query stays short');
    assert.ok(texts(queries).some(text => text.includes('第29句')), 'the last sentences are the ones kept');
    assert.ok(queries.at(-1).text.endsWith('写得很长。'), 'the end of the reply is nearest to now');
});

test('the line that reaches back is found by itself where a query of everything misses it', () => {
    const scene = longReply('雨夜的铺子里灯火摇晃掌柜低头算账', 1200);
    const old = '外公把铜钥匙交给了我';
    const others = ['码头的货船今天来了三艘', '集市上卖鱼的又吵起来了', '灯火下掌柜算了一整夜的账'];
    const line = '外公的铜钥匙还在吗';
    // Wide enough that hash collisions do not stand in for what the text says.
    const score = query => cosineSimilarity(createLocalEmbedding(query, 1024), createLocalEmbedding(old, 1024));
    assert.ok(score(line) > score(`助手 #1: ${scene}\n用户 #2: ${line}`) * 5, 'the rest of the query drowns it');
    // The lexical side too: a query of everything runs past the term limit before it reaches the newest message.
    const records = [old, ...others].map((text, i) => ({ id: `r${i}`, text, embeddingScore: 0 }));
    const blurred = selectHybridCandidates(records, [`助手 #1: ${scene}\n用户 #2: ${line}`], [], { candidateCount: 2 });
    const split = selectHybridCandidates(records, [line, scene.slice(-600)], [], { candidateCount: 2 });
    assert.equal(split[0].id, 'r0');
    assert.ok(!blurred.length || blurred[0].id !== 'r0' || Number(blurred[0].lexicalScore) < Number(split[0].lexicalScore));
});

const chatOf = (...replies) => replies.flatMap((text, i) => [{ is_user: false, mes: text }, { is_user: true, mes: `第${i}轮的回应。` }]);

test('without a rewrite: each query is embedded, and the hits come from the line, not from the size of the blur', async () => {
    const chat = chatOf('外公把铜钥匙交给了我，让我收好。', '码头的货船今天来了三艘。', '集市上卖鱼的又吵起来了。', longReply('灯火下掌柜', 1500));
    chat.push({ is_user: true, mes: '外公的铜钥匙还在吗？' });
    const f = recallFixture(chat, { contextWindowMessages: 3, rerankThreshold: 0.1 });
    await f.service.buildVectorMemoryIndex();
    const hits = await f.recall();
    assert.ok(f.state.vectorMemory.lastQueries.includes('外公的铜钥匙还在吗？'));
    assert.ok(f.state.vectorMemory.lastQueries.every(query => query.length <= 620));
    assert.equal(hits[0].messageId, 0);
    const everything = chat.slice(-8).map((message, i) => `${message.is_user ? '用户' : '助手'} #${i}: ${message.mes}`).join('\n');
    const blurred = cosineSimilarity(createLocalEmbedding(everything, 192), createLocalEmbedding(chat[0].mes, 192));
    assert.ok(hits[0].similarity > blurred, `${hits[0].similarity} 比拼成一条的 ${blurred} 高`);
});

test('in the local mode the keywords stay queries; an explicit search is still one query', async () => {
    const chat = chatOf('旧事。', '又一件旧事。');
    chat.push({ is_user: true, mes: '她去了哪里？' });
    const f = recallFixture(chat, { queryMode: 'local', keywordTriggers: '铜钥匙，旧信' });
    await f.service.buildVectorMemoryIndex();
    await f.recall();
    for (const query of ['她去了哪里？', '铜钥匙', '旧信']) assert.ok(f.state.vectorMemory.lastQueries.includes(query), query);
    await f.service.retrieveVectorMemoryHits('只查这一句');
    assert.ok(f.state.vectorMemory.lastQueries.length <= 3);
    assert.match(f.state.vectorMemory.lastQueries[0], /^只查这一句/);
});

test('all the queries of a round go in one embedding request, and what was asked before costs nothing', async () => {
    const calls = [];
    const fetchImpl = async (_url, init) => {
        const { input } = JSON.parse(init.body);
        calls.push(input);
        const list = Array.isArray(input) ? input : [input];
        return new Response(JSON.stringify({ data: list.map((_, index) => ({ index, embedding: [1, 0.5, index + 1] })) }));
    };
    const chat = chatOf('外公的事。', '码头的事。');
    chat.push({ is_user: true, mes: '我推开门。外公的铜钥匙还在吗？你一定记得。' });
    const f = recallFixture(chat, { embeddingProvider: 'custom-openai', customApi: { baseUrl: 'https://example.test/v1', model: 'm' } }, { fetchImpl });
    await f.service.buildVectorMemoryIndex();
    calls.length = 0;
    await f.recall();
    assert.equal(calls.length, 1, '一次请求');
    assert.ok(calls[0].length >= 3, '一次带上几句');
    await f.recall();
    assert.equal(calls.length, 1, 'the same line again: no request at all');
});

test('a model rewrite keeps the user\'s own line as a query; when the rewrite fails the line is searched anyway', async () => {
    const chat = chatOf('外公把铜钥匙交给了我。', '码头的货船来了。');
    chat.push({ is_user: true, mes: '外公的铜钥匙还在吗？' });
    const payload = { intent: '找钥匙', queries: ['关于钥匙的旧事'], keywords: [] };
    const good = recallFixture(chat, { queryMode: 'model-required' }, { rewriteWithTavern: async () => 'x', parseVectorQueryRewritePayload: () => payload });
    await good.service.buildVectorMemoryIndex();
    await good.recall();
    assert.deepEqual(good.state.vectorMemory.lastQueries.slice(0, 2), ['关于钥匙的旧事', '外公的铜钥匙还在吗？']);
    const failing = recallFixture(chat, { queryMode: 'model-required', contextWindowMessages: 3, rerankThreshold: 0.1 }, { rewriteWithTavern: async () => { throw new Error('模型挂了'); }, parseVectorQueryRewritePayload: () => payload });
    await failing.service.buildVectorMemoryIndex();
    const hits = await failing.recall();
    assert.equal(hits[0].messageId, 0, 'recall still runs');
    assert.match(failing.state.vectorMemory.lastRewriteIntent, /改写失败/);
    // A search by hand has nothing else to go on: a failed rewrite stays a failure there.
    assert.deepEqual(await failing.service.retrieveVectorMemoryHits('手动查'), []);
    assert.match(failing.state.vectorMemory.lastRecallSkippedReason, /查询重写失败/);
});
