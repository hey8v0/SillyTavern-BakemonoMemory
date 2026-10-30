import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyFactsUpdate, createDefaultFacts, editCard, factFieldLimits, findCard, injectionBudget, normalizeFactSettings, overlongFields, undoFactsUpdate } from '../src/facts/model.js';
import { buildFactsPrompt, cardForPrompt, defaultFactsPrompt, describeFactFields, effectiveFactsPrompt, factsSystemPrompt, isStockFactsPrompt } from '../src/facts/prompt.js';
import { parseFactCards } from '../src/facts/parser.js';
import { renderFactCardLine, renderFactsSection } from '../src/facts/injection.js';
import { createGenerationClient, thinkingOffParams } from '../src/features/generation-client.js';
import { createFactsUi } from '../src/features/facts-ui.js';
import { createInjectionService } from '../src/features/injection-service.js';
import { buildPersistedChatState } from '../src/core/persisted-chat-state.js';
import { createOverviewTokenManifest } from '../src/features/overview-token-manifest.js';
import { createSummaryMemoryModel } from '../src/features/summary-memory-model.js';
import { renderInjectionTemplate } from '../src/shared/injection-template.js';
import * as provider from '../src/vector/provider-config.js';
import { factsRuntime, reply, lin } from './helpers/facts-runtime.mjs';
import { longCardsWorld, longMaterial, longThreadNames } from './helpers/facts-world.mjs';
import { retiredFactsPrompts } from './helpers/retired-facts-prompts.mjs';

// A user's 整理 request took 52,168 tokens: 17,168 in, 35,000 out, 27,024 of those thinking. The model copied whole
// cards ("每张写全", fields replaced whole), cards had grown without limit, and every open thread went along in full.

// 1. Changed fields only; 备注 can be added to without copying.
test('the prompt asks for changed fields only, with a limit per field, and shows no empty form to fill', () => {
    assert.doesNotMatch(defaultFactsPrompt, /每张写全/);
    assert.match(defaultFactsPrompt, /只写变了的字段/);
    assert.match(defaultFactsPrompt, /"add":\{"备注"/);
    assert.doesNotMatch(defaultFactsPrompt, /"处境":"","目标":""/, 'an example with every field invites writing every field');
    assert.match(factsSystemPrompt, /只写变了的字段/, 'the system prompt says it too, for prompts the user customised');
    assert.match(describeFactFields(), /处境（60 字内）=当前位置/);
    assert.match(describeFactFields(), /当前关系（40 字内）=/);
    assert.deepEqual(Object.keys(factFieldLimits.person), ['处境', '目标', '持有', '性格', '外貌', '备注']);
});

test('add appends to a field without copying it; fields still replace; undo takes both back', () => {
    const facts = createDefaultFacts();
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '林晚', fields: { 处境: '在书店', 备注: '怕黑' } }, { kind: 'person', name: '沈砚', fields: { 处境: '在码头' } }] }, { floorFrom: 2, floorTo: 10 });
    const card = findCard(facts.cards, '林晚');
    const entry = applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '林晚', fields: { 处境: '在码头' }, add: { 备注: '会游泳' } }] }, { floorFrom: 12, floorTo: 20 });
    assert.deepEqual([card.fields.处境, card.fields.备注], ['在码头', '怕黑；会游泳']);
    assert.deepEqual(Object.keys(entry.changes[0].after).sort(), ['备注', '处境'].sort());
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '林晚', add: { 备注: '会游泳' } }] }, { floorFrom: 22, floorTo: 24 });
    assert.equal(card.fields.备注, '怕黑；会游泳', 'the same sentence is not added twice');
    undoFactsUpdate(facts, entry.id, '2026-10-31T00:00:00.000Z');
    assert.deepEqual([card.fields.处境, card.fields.备注], ['在书店', '怕黑']);
    // A new card may come with add alone.
    applyFactsUpdate(facts, { cards: [{ kind: 'item', name: '旧信', add: { 描述: '姐姐留下的' } }] }, { floorFrom: 26, floorTo: 28 });
    assert.equal(findCard(facts.cards, '旧信').fields.描述, '姐姐留下的');
    // What the user wrote is not added to.
    editCard(facts, card.id, { fields: { 备注: '用户写的' } });
    const kept = applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '林晚', add: { 备注: '模型想补的' } }] }, { floorFrom: 30, floorTo: 32 });
    assert.equal(card.fields.备注, '用户写的');
    assert.ok(!kept?.changes.length, 'nothing happened, so nothing is recorded as a change');
    // Hearsay added to a state field goes to the note, marked, as with fields.
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '沈砚', add: { 处境: '林晚说他去了北方' } }] }, { floorFrom: 34, floorTo: 36 });
    const shen = findCard(facts.cards, '沈砚');
    assert.equal(shen.fields.处境, '在码头');
    assert.match(shen.fields.备注, /【声称】林晚说他去了北方/);
    // Older material cannot add to a state field that holds from a later floor.
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '沈砚', add: { 目标: '回家' } }] }, { floorFrom: 40, floorTo: 42 });
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '沈砚', add: { 目标: '找船' } }] }, { floorFrom: 4, floorTo: 6 });
    assert.equal(shen.fields.目标, '回家');
    assert.ok(shen.timeline.some(item => item.past && item.from === '找船' && item.floor === 6));
    assert.equal(parseFactCards('<factCards>{"cards":[{"kind":"person","name":"林晚","add":{"备注":"x"}}]}</factCards>').cards[0].add.备注, 'x');
});

// 2. A limit per field; what is past it gets rewritten once, and that rewrite is not a change in the story.
test('a field past its limit is asked to be rewritten; the user\'s fields are not', () => {
    const facts = longCardsWorld();
    const yan = findCard(facts.cards, '严则');
    assert.deepEqual(overlongFields(yan), ['处境', '目标', '备注']);
    assert.deepEqual(cardForPrompt(yan)['请精简'], ['处境', '目标', '备注']);
    assert.equal(overlongFields(findCard(facts.cards, '红纸')).length, 2);
    editCard(facts, yan.id, { fields: { 目标: '用户自己写的长目标'.repeat(30) } });
    assert.ok(!overlongFields(yan).includes('目标'));
    assert.equal(cardForPrompt({ kind: 'person', name: '短', aliases: [], fields: { 处境: '在家' }, userFields: [], status: 'active', timeline: [] })['请精简'], undefined);
    // A table row imported as a card is the user's text, however long; once the story changes the card it is the model's.
    const imported = { kind: 'rule', name: '门规', aliases: [], fields: { 说明: '门规第一条。'.repeat(40) }, userFields: [], status: 'active', timeline: [], updatedBy: 'import' };
    assert.deepEqual(overlongFields(imported), []);
    assert.deepEqual(overlongFields({ ...imported, updatedBy: 'facts' }), ['说明']);
    for (const needle of ['请精简', '事件经过交给剧情摘要', '一两句']) assert.ok(defaultFactsPrompt.includes(needle), needle);
});

test('rewriting a long field short is not a change in the story; a real change still is', () => {
    const facts = createDefaultFacts();
    const long = '在葛记铺子门口蹲着，手里攥着那张剪空的红纸'.repeat(6);
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '严则', fields: { 处境: long } }] }, { floorFrom: 2, floorTo: 10 });
    const card = findCard(facts.cards, '严则');
    const compact = applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '严则', fields: { 处境: '蹲在葛记铺子门口' } }] }, { floorFrom: 12, floorTo: 20 });
    assert.deepEqual(card.timeline, [], 'no 经过 entry for the rewrite');
    assert.deepEqual(compact.changes[0].compacted, ['处境']);
    assert.equal(card.asOf.处境, 2, 'and the field still holds from the floor it did');
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '严则', fields: { 处境: '在码头' } }] }, { floorFrom: 22, floorTo: 30 });
    assert.deepEqual(card.timeline.map(item => [item.from, item.to]), [['蹲在葛记铺子门口', '在码头']]);
});

test('经过 keeps short values: stored at 80 characters, 24 in the injected line, 20 in the request', () => {
    const facts = createDefaultFacts();
    const long = name => `${name}${'在葛记铺子门口蹲着，手里攥着红纸'.repeat(10)}`;
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '严则', fields: { 处境: long('甲') } }] }, { floorFrom: 2, floorTo: 10 });
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '严则', fields: { 处境: long('乙') } }] }, { floorFrom: 12, floorTo: 20 });
    const card = findCard(facts.cards, '严则');
    assert.equal(card.timeline[0].from.length, 81, 'clipped with …');
    assert.ok(card.timeline[0].from.endsWith('…'));
    assert.match(renderFactCardLine(card, { timeline: 1 }), /曾经：处境 甲.{23}…（到第 20 楼）/);
    const shown = cardForPrompt(card)['经过'];
    assert.ok(shown.length <= 2 && shown.every(line => line.length < 70), shown.join('|'));
});

// 3. What goes into the request.
test('only the cards the material names go in full; other open threads are a short list', () => {
    const facts = longCardsWorld();
    const { prompt, cardIds } = buildFactsPrompt(facts, '严则把纸人送回铺子。');
    const sent = facts.cards.filter(card => cardIds.includes(card.id)).map(card => card.name);
    assert.ok(sent.includes('严则') && sent.includes('纸人'));
    assert.ok(!longThreadNames.some(name => sent.includes(name)), 'threads the material does not name are not cards here');
    assert.equal(sent.length, 4, 'the two named, and two long ones to rewrite');
    const row = prompt.split('\n').find(line => line.startsWith('- 问时辰：'));
    assert.ok(row && row.length < 80, row);
    assert.match(row, /…/);
    assert.doesNotMatch(prompt, /"name":"问时辰"/);
});

test('a request over cards this long stays bounded, and is small once the cards are short', () => {
    const facts = longCardsWorld();
    const material = longMaterial();
    const { prompt } = buildFactsPrompt(facts, material);
    assert.ok(prompt.length < 15000, `${prompt.length} 字；v1.40 这里是 22,415 字`);
    // Everyone named at once: the budget holds, the rest go in brief.
    const everyone = buildFactsPrompt(facts, facts.cards.map(card => card.name).join('、'));
    assert.ok(everyone.prompt.length < 14000, `${everyone.prompt.length} 字`);
    const rows = everyone.prompt.split('\n').filter(line => line.startsWith('{"kind"'));
    assert.equal(rows.length, facts.cards.length, 'all of them are there');
    const brief = rows.filter(row => !row.includes('"请精简"'));
    assert.ok(brief.length >= 1, 'the ones past the budget in brief');
    for (const row of brief) assert.doesNotMatch(row, /经过|描述|意义|性格/);
    assert.match(rows.find(row => row.includes('"name":"问时辰"')), /"内容":.+"状态":/, 'a thread still says what it is about');
    // After the rewrite: every field within its limit.
    for (const card of facts.cards) for (const key of Object.keys(card.fields)) card.fields[key] = String(card.fields[key] || '').slice(0, factFieldLimits[card.kind]?.[key] || 60);
    for (const card of facts.cards) card.timeline = card.timeline.map(item => ({ ...item, from: item.from.slice(0, 20), to: item.to.slice(0, 20) }));
    const compact = buildFactsPrompt(facts, material);
    assert.ok(compact.prompt.length < 9000, `${compact.prompt.length} 字`);
});

test('the other open threads come most recent first, and the list has an end', () => {
    const facts = createDefaultFacts();
    applyFactsUpdate(facts, { cards: Array.from({ length: 45 }, (_, i) => ({ kind: 'thread', name: `线索${i}`, fields: { 内容: `内容${i}`, 状态: '未了' } })) }, { floorFrom: 2, floorTo: 10 });
    applyFactsUpdate(facts, { cards: [{ kind: 'thread', name: '线索44', fields: { 状态: '未了，有进展' } }] }, { floorFrom: 50, floorTo: 60 });
    const list = buildFactsPrompt(facts, '无关的材料。').prompt.split('未了的线索：\n')[1].split('\n\n')[0].split('\n');
    assert.equal(list[0], '- 线索44：内容44');
    assert.equal(list.length, 41);
    assert.equal(list.at(-1), '另有 5 条');
});

// 6. The automatic budget: a slider at a million is not a wish for 30,000 characters.
test('the automatic budget stops at 8,000 characters; more takes a fixed number', () => {
    const auto = normalizeFactSettings({});
    assert.equal(injectionBudget(auto, 128000).chars, 7680);
    assert.equal(injectionBudget(auto, 200000).chars, 8000);
    assert.equal(injectionBudget(auto, 2000000).chars, 8000);
    assert.equal(injectionBudget(normalizeFactSettings({ version: 3, budgetAuto: false, budgetChars: 20000 }), 2000000).chars, 20000);
});

// A chat or a saved configuration keeps the default prompt of its day: rule changes never reached it.
test('a saved prompt that is an old default counts as the default; a prompt the user wrote stays', () => {
    assert.equal(retiredFactsPrompts.length, 6);
    assert.ok(isStockFactsPrompt(defaultFactsPrompt), 'a changed default goes on the list, or the next change cannot reach the chats that saved it');
    for (const old of retiredFactsPrompts) {
        assert.equal(effectiveFactsPrompt(old), defaultFactsPrompt);
        assert.equal(effectiveFactsPrompt(`\n${old.replace(/\n/g, '\r\n')}  \n`), defaultFactsPrompt, 'line endings and outer spaces from a text box');
    }
    assert.equal(effectiveFactsPrompt(''), defaultFactsPrompt);
    assert.equal(effectiveFactsPrompt(undefined), defaultFactsPrompt);
    assert.equal(effectiveFactsPrompt(defaultFactsPrompt), defaultFactsPrompt);
    assert.equal(effectiveFactsPrompt('我自己写的 {{material}}'), '我自己写的 {{material}}');
    assert.equal(effectiveFactsPrompt(retiredFactsPrompts[0] + '\n多写了一条规则'), retiredFactsPrompts[0] + '\n多写了一条规则', 'edited, so it is theirs');
    const r = factsRuntime({ every: 3, summaries: 3 });
    r.state.generationPrompts.facts = retiredFactsPrompts.at(-1);
    assert.doesNotMatch(r.controller.maybeRun().prompt, /每张写全/);
    const own = factsRuntime({ every: 3, summaries: 3 });
    own.state.generationPrompts.facts = '自定义提示词 {{material}}';
    assert.match(own.controller.maybeRun().prompt, /^自定义提示词/);
});

// 4. Thinking off where the API has a switch for it.
test('the switch for thinking follows the model or the address', () => {
    const off = { thinking: { type: 'disabled' } };
    assert.deepEqual(thinkingOffParams('glm-5.3-flashx', 'https://open.bigmodel.cn/api/paas/v4'), off);
    assert.deepEqual(thinkingOffParams('some-model', 'https://api.z.ai/api/paas/v4'), off);
    assert.deepEqual(thinkingOffParams('kimi-k2.5', 'https://api.moonshot.cn/v1'), off);
    assert.deepEqual(thinkingOffParams('doubao-seed-1-6', 'https://ark.cn-beijing.volces.com/api/v3'), off);
    assert.deepEqual(thinkingOffParams('deepseek-v4-flash', 'https://api.deepseek.com/v1'), off);
    assert.deepEqual(thinkingOffParams('qwen3-max', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), { enable_thinking: false });
    assert.deepEqual(thinkingOffParams('Qwen/Qwen3-235B', 'https://api.siliconflow.cn/v1'), { enable_thinking: false });
    assert.deepEqual(thinkingOffParams('gemini-2.5-flash', 'https://generativelanguage.googleapis.com/v1beta/openai'), { reasoning_effort: 'low' });
    assert.deepEqual(thinkingOffParams('gpt-5.1', 'https://api.openai.com/v1'), { reasoning_effort: 'low' });
    assert.deepEqual(thinkingOffParams('o3-mini', 'https://api.openai.com/v1'), { reasoning_effort: 'low' });
    assert.equal(thinkingOffParams('claude-sonnet-5', 'https://proxy.example/v1'), null, 'off unless asked for');
    assert.equal(thinkingOffParams('my-local-model', 'http://127.0.0.1:5000/v1'), null);
});

function clientFixture(responses, customApi = {}) {
    const calls = [];
    const queue = [...responses];
    const client = createGenerationClient({ ...provider, getTavernHeaders: () => ({}), normalizeCustomApiBaseUrl: provider.normalizeCustomApiBaseUrl, getCustomChatCompletionsUrl: provider.getCustomChatCompletionsUrl,
        ensureState: () => ({ automation: { apiProvider: 'custom', customApi: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flashx', ...customApi } } }),
        defaultAutomation: { customApi: { temperature: 0.5, maxTokens: 1000 } },
        formatApiFailure: (response, action) => `${action}：${response.status}`,
        fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return queue.shift() ?? new Response(JSON.stringify({ choices: [{ message: { content: '好' }, finish_reason: 'stop' }] })); } });
    return { client, calls };
}
const okBody = usage => new Response(JSON.stringify({ choices: [{ message: { content: '好' }, finish_reason: 'stop' }], usage }));

test('the request turns thinking off directly or through the tavern relay, and only when the switch is on', async () => {
    const direct = clientFixture([]);
    await direct.client.callGenerationModel({ prompt: 'p' });
    assert.deepEqual(direct.calls[0].body.thinking, { type: 'disabled' });
    const relay = clientFixture([], { viaTavern: true });
    await relay.client.callGenerationModel({ prompt: 'p' });
    assert.equal(relay.calls[0].body.thinking, undefined, 'the relay only passes known fields on');
    assert.deepEqual(JSON.parse(relay.calls[0].body.custom_include_body), { thinking: { type: 'disabled' } });
    const off = clientFixture([], { disableThinking: false });
    await off.client.callGenerationModel({ prompt: 'p' });
    assert.equal(off.calls[0].body.thinking, undefined);
    assert.equal(off.calls[0].body.custom_include_body, undefined);
});

test('an API that rejects the switch gets the request again without it, once, and is remembered', async () => {
    const f = clientFixture([new Response('bad param', { status: 400 })]);
    assert.equal(await f.client.callGenerationModel({ prompt: 'p' }), '好');
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls[0].body.thinking, { type: 'disabled' });
    assert.equal(f.calls[1].body.thinking, undefined);
    await f.client.callGenerationModel({ prompt: 'p' });
    assert.equal(f.calls.length, 3, 'no second rejected request');
    assert.equal(f.calls[2].body.thinking, undefined);
    // Through the relay a rejection arrives as 200 with { error }.
    const relay = clientFixture([new Response(JSON.stringify({ error: { message: 'unknown field thinking' } }))], { viaTavern: true });
    assert.equal(await relay.client.callGenerationModel({ prompt: 'p' }), '好');
    assert.equal(relay.calls.length, 2);
    assert.equal(relay.calls[1].body.custom_include_body, undefined);
    // A wrong key is not the switch's fault: one request, the real error.
    const denied = clientFixture([new Response('no', { status: 401 })]);
    await assert.rejects(denied.client.callGenerationModel({ prompt: 'p' }), /401/);
    assert.equal(denied.calls.length, 1);
});

test('usage is reported, also when the output limit stops the reply, and the message says what to do', async () => {
    const usage = { prompt_tokens: 17168, completion_tokens: 35000, completion_tokens_details: { reasoning_tokens: 27024 } };
    const seen = [];
    const f = clientFixture([okBody({ prompt_tokens: 900, completion_tokens: 120 }), new Response(JSON.stringify({ choices: [{ message: { content: '半截' }, finish_reason: 'length' }], usage }))]);
    await f.client.callGenerationModel({ prompt: 'p', onUsage: value => seen.push(value) });
    assert.deepEqual(seen[0], { input: 900, output: 120, reasoning: 0 });
    await assert.rejects(f.client.callGenerationModel({ prompt: 'p', onUsage: value => seen.push(value) }), error => {
        assert.equal(error.code, 'output_limit');
        assert.match(error.message, /思考/);
        assert.match(error.message, /27,024/);
        assert.match(error.message, /没有理会“关闭模型思考”/, 'the field was sent, and the model thought anyway');
        assert.doesNotMatch(error.message, /提高输出上限/, 'raising the limit only costs more');
        return true;
    });
    const thought = () => new Response(JSON.stringify({ choices: [{ message: { content: '半截' }, finish_reason: 'length' }], usage }));
    const switchedOff = clientFixture([thought()], { disableThinking: false });
    await assert.rejects(switchedOff.client.callGenerationModel({ prompt: 'p' }), /请在接口设置里打开“关闭模型思考”/);
    const unknown = clientFixture([thought()], { model: 'my-model', baseUrl: 'https://proxy.example/v1' });
    await assert.rejects(unknown.client.callGenerationModel({ prompt: 'p' }), /服务商那边关掉/, 'on, but nothing was sent: no field known for this API');
    assert.deepEqual(seen[1], { input: 17168, output: 35000, reasoning: 27024 });
    const plain = clientFixture([new Response(JSON.stringify({ choices: [{ message: { content: '半截' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 1000 } }))]);
    await assert.rejects(plain.client.callGenerationModel({ prompt: 'p' }), error => error.code === 'output_limit' && /长度上限/.test(error.message));
    // Streaming: usage from the last chunk if the API sends one.
    const streamed = [];
    const stream = clientFixture([new Response('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":6,"reasoning_tokens":2}}\n\n')], { stream: true });
    assert.equal(await stream.client.callGenerationModel({ prompt: 'p', onUsage: value => streamed.push(value) }), '好');
    assert.deepEqual(streamed[0], { input: 5, output: 6, reasoning: 2 });
});

// The two shapes a real SillyTavern 1.19 answers a failed upstream with: 200 and { error }, or 400 when streaming.
test('through the relay a rejected field gets the request again, also streaming; a failure that is not the switch\'s fault is not blamed on it', async () => {
    const asJson = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const stream = clientFixture([new Response('bad request', { status: 400 }), new Response('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\n')], { viaTavern: true, stream: true });
    assert.equal(await stream.client.callGenerationModel({ prompt: 'p' }), '好');
    assert.equal(stream.calls.length, 2);
    assert.equal(stream.calls[1].body.custom_include_body, undefined);
    const denied = clientFixture([asJson({ error: { message: 'Unauthorized' } }), asJson({ error: { message: 'Unauthorized' } })], { viaTavern: true });
    await assert.rejects(denied.client.callGenerationModel({ prompt: 'p' }), /Unauthorized/);
    assert.equal(denied.calls.length, 2, 'the relay does not say why: one try without the field tells');
    await denied.client.callGenerationModel({ prompt: 'p' });
    assert.ok(denied.calls[2].body.custom_include_body, 'that try failed too, so the field goes on being sent');
    // No field to blame: no second request.
    const plain = clientFixture([asJson({ error: { message: 'Unauthorized' } })], { viaTavern: true, model: 'my-local-model', baseUrl: 'http://127.0.0.1:5000/v1' });
    await assert.rejects(plain.client.callGenerationModel({ prompt: 'p' }), /Unauthorized/);
    assert.equal(plain.calls.length, 1);
});

const failWithOutputLimit = () => { const error = new Error('模型输出到了上限'); error.code = 'output_limit'; throw error; };

// 5. Past the limit: no second expensive try on its own.
test('a batch that hit the output limit is not sent again on its own; by hand it goes in half the size', async () => {
    const r = factsRuntime({ every: 4, summaries: 4, floors: 20 });
    const task = r.controller.maybeRun();
    r.setResult(() => { const error = new Error('模型输出到了上限'); error.code = 'output_limit'; throw error; });
    await r.queue.processTaskQueue();
    assert.deepEqual([task.status, task.errorCode], ['failed', 'output_limit']);
    assert.equal(r.controller.maybeRun(), null, 'one failure is enough: it would fail the same way');
    assert.equal(r.controller.maybeRun({ trigger: 'idle' }), null);
    assert.equal(r.controller.blockedBatch().reason, 'output_limit');
    const manual = await r.controller.runManual();
    assert.equal(manual.metadata.factsCount, 2, 'half of the four that did not fit');
    r.setResult(reply([lin()]));
    await r.queue.processTaskQueue();
    assert.equal(manual.status, 'done');
    assert.equal(r.controller.blockedBatch(), null);
});

test('a longer batch starting with what did not fit stays waiting too; other failures keep their two tries; a reload forgets nothing', async () => {
    const r = factsRuntime({ every: 4, summaries: 4, floors: 30 });
    r.controller.maybeRun();
    r.setResult(failWithOutputLimit);
    await r.queue.processTaskQueue();
    r.addSummary(10);
    assert.equal(r.controller.maybeRun({ trigger: 'idle' }), null, 'five summaries, starting with the four');
    assert.equal(r.controller.maybeRun(), null, 'the same four');
    r.state.taskQueue = JSON.parse(JSON.stringify(buildPersistedChatState(r.state).taskQueue));
    assert.equal(r.controller.blockedBatch().reason, 'output_limit', 'after a reload');
    r.state.taskQueue = [];
    assert.ok(r.controller.maybeRun(), 'clearing the failed task from the queue lets the batch go again');
    const other = factsRuntime({ every: 3, summaries: 3 });
    const first = other.controller.maybeRun();
    other.setResult(() => { throw new Error('断网了'); });
    await other.queue.processTaskQueue();
    assert.equal(first.errorCode, '');
    assert.ok(other.controller.maybeRun(), 'a network failure may pass: it gets a second try');
    await other.queue.processTaskQueue();
    assert.equal(other.controller.maybeRun(), null);
    assert.equal(other.controller.blockedBatch().reason, 'failures');
});

test('a reply cut off in the middle counts as the output limit, also through the tavern main model', async () => {
    assert.throws(() => parseFactCards('好的。\n<factCards>\n{"cards":[{"kind":"person","name":"林晚","fields":{"处境":"在'), error => error.code === 'output_limit' && /输出上限/.test(error.message));
    assert.throws(() => parseFactCards('<factCards>{"cards": [}</factCards>'), error => error.code !== 'output_limit', 'complete but broken is not that');
    const r = factsRuntime({ every: 3, summaries: 3 });
    const task = r.controller.maybeRun();
    r.setResult('<factCards>{"cards":[{"kind":"person","name":"林晚","fields":{"处境":"在');
    await r.queue.processTaskQueue();
    assert.equal(task.errorCode, 'output_limit');
    assert.equal(r.controller.maybeRun(), null);
});

test('the page can show what the last 整理 cost, measured or estimated', async () => {
    const r = factsRuntime({ every: 3, summaries: 3, floors: 20 });
    assert.equal(r.controller.lastRequest(), null);
    r.state.taskQueue.push({ kind: 'facts', status: 'done', updatedAt: '2026-01-01T00:00:00.000Z', metadata: { factsFloorFrom: 2, factsFloorTo: 6 } });
    assert.equal(r.controller.lastRequest(), null, 'from before these numbers were kept: nothing to say');
    r.state.taskQueue.length = 0;
    r.controller.maybeRun();
    r.setResult(args => { args.onUsage?.({ input: 900, output: 120, reasoning: 30 }); return reply([lin()]); });
    await r.queue.processTaskQueue();
    assert.deepEqual(r.controller.lastRequest(), { status: 'done', floorFrom: 2, floorTo: 6, input: 900, output: 120, reasoning: 30, estimated: false });
    [8, 10, 12].forEach(floor => r.addSummary(floor));
    r.chat.push({ mes: '继续。', is_user: true });
    const second = r.controller.maybeRun();
    const answer = reply([lin('在码头')]);
    r.setResult(answer);
    await r.queue.processTaskQueue();
    const last = r.controller.lastRequest();
    assert.deepEqual([last.floorFrom, last.floorTo, last.estimated, last.reasoning], [8, 12, true, 0]);
    assert.equal(last.input, second.metadata.promptChars);
    assert.equal(last.output, answer.length);
});

test('after a reload the last request is still the latest by time, though failed tasks come first in the saved queue', () => {
    const r = factsRuntime({ every: 3, summaries: 3 });
    r.state.taskQueue = [{ kind: 'facts', status: 'done', updatedAt: '2026-10-31T09:00:00.000Z', metadata: { factsFloorFrom: 2, factsFloorTo: 6, usage: { input: 1, output: 2, reasoning: 0 } } },
        { kind: 'facts', status: 'failed', updatedAt: '2026-10-31T10:00:00.000Z', metadata: { factsFloorFrom: 8, factsFloorTo: 12, promptChars: 500 } }];
    r.state.taskQueue = buildPersistedChatState(r.state).taskQueue;
    assert.equal(r.state.taskQueue[0].status, 'failed');
    assert.deepEqual(r.controller.lastRequest(), { status: 'failed', floorFrom: 8, floorTo: 12, input: 500, output: 0, reasoning: 0, estimated: true });
});

const pageOf = r => {
    const root = { innerHTML: '' };
    createFactsUi({ documentRef: { getElementById: () => root }, getState: () => r.state, controller: r.controller, escapeHtml: value => String(value ?? '') }).render();
    return root.innerHTML;
};

test('the 剧情事实 page says what the last 整理 took, why a batch waits, and where the section goes', async () => {
    const r = factsRuntime({ every: 3, summaries: 3, floors: 20, contextTokens: 1000000 });
    assert.doesNotMatch(pageOf(r), /上次整理（/);
    r.controller.maybeRun();
    r.setResult(args => { args.onUsage?.({ input: 900, output: 120, reasoning: 30 }); return reply([lin()]); });
    await r.queue.processTaskQueue();
    assert.match(pageOf(r), /上次整理（第 2–6 楼）：输入 900 · 输出 120（思考 30） token/);
    assert.match(pageOf(r), /data-facts-setting="injectDepth"[^>]*value="2"/);
    assert.match(pageOf(r), /自动最多 8.000 字/);
    assert.equal(r.controller.updateSettings({ injectDepth: 0 }).injectDepth, 0, '0 is a place, not a missing value');
    assert.match(pageOf(r), /data-facts-setting="injectDepth"[^>]*value="0"/);
    [8, 10, 12].forEach(floor => r.addSummary(floor));
    r.controller.maybeRun();
    r.setResult('<factCards>{"cards":[{"kind":"person","name":"林晚","fields":{"处境":"在');
    await r.queue.processTaskQueue();
    const page = pageOf(r);
    assert.match(page, /第 8–12 楼这批超过了模型的输出上限/);
    assert.match(page, /减半/);
    assert.match(page, /上次整理（第 8–12 楼）没有保存：输入约 .+ 字 · 输出约 .+ 字（接口没有返回 token 用量）/);
});

test('the switch is on the generation page, on unless turned off; the pages show both blocks; the prompt view knows the new block', () => {
    const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(read('settings.html'), /<input type="checkbox" id="bakemono-memory-custom-no-thinking" role="switch">/);
    assert.match(read('src/features/configuration-service.js'), /disableThinking: !!query\('#bakemono-memory-custom-no-thinking'\)\.prop\('checked'\)/);
    assert.match(read('src/features/workbench-renderer.js'), /no-thinking'\)\.prop\('checked', state\.automation\.customApi\?\.disableThinking !== false\)/);
    assert.equal(read('src/config/defaults.js').match(/disableThinking: true/g).length, 2);
    const index = read('index.js');
    assert.equal(index.match(/renderInjectionContent: renderInjectionDisplay/g).length, 4, 'header, preview, overview, renderer');
    assert.match(index, /const pieces = \[[^\]]*parts\.sources\?\.facts/);
});

// Near the latest message: the block changes every round, so it must not sit in front of the whole chat.
function injectionFixture() {
    const facts = createDefaultFacts();
    applyFactsUpdate(facts, { cards: [{ kind: 'person', name: '林晚', fields: { 处境: '在书店' } }] }, { floorFrom: 2, floorTo: 10 });
    const state = { facts, storySummaries: [], epicSummaries: [], blocks: [], memoryStrategy: 'bakemono', injection: { enabled: true, depth: 999, role: 0, template: '【记忆】\n{{memory}}' }, inlineGeneration: {}, automation: {},
        stageSummaries: [{ hash: 'stage0', type: 'stage', content: '阶段总结0', sourceMessageIds: [0] }] };
    const chat = [{ mes: '林晚走进书店。' }];
    const model = createSummaryMemoryModel({ blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' }, memoryStrategies: { GENERIC: 'generic' }, memoryRecordStatuses: { INJECTED: 'injected', SAVED: 'saved' },
        dedupeByHash: a => a, getSummarySortKey: s => s.sourceMessageIds?.[0] || 0, getSummaryLevel: () => 1, getFiniteMessageIds: a => a, unique: a => [...new Set(a)], getBlockTitle: String, formatSourceRange: a => a.join('-'), getKindLabel: String });
    const prompts = [];
    const injection = createInjectionService({ ...model, ensureState: () => state, getChat: () => chat, memoryStrategies: { GENERIC: 'generic' }, renderVectorMemorySection: () => '', setExtensionPrompt: (...args) => prompts.push(args),
        injectionKey: 'memory', extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 }, defaultState: { injection: { depth: 999 } }, inlinePromptKeys: {}, defaultInjectionTemplate: '{{memory}}', renderInjectionTemplate,
        renderFactsSection: (current, parts) => renderFactsSection(current.facts, parts, { budgetChars: 4000 }) });
    const overview = createOverviewTokenManifest({ ...injection, getState: () => state, defaultInjectionTemplate: '{{memory}}' });
    return { state, chat, prompts, injection, overview, sent: key => prompts.filter(args => args[0] === key).at(-1) };
}

test('剧情事实 is its own block near the latest message; the summaries stay in front of the chat', () => {
    const f = injectionFixture();
    f.injection.syncInjection();
    const main = f.sent('memory'), block = f.sent('memory_facts');
    assert.match(main[1], /阶段总结0/);
    assert.doesNotMatch(main[1], /剧情事实|林晚/, 'the summaries block stays the same from round to round');
    assert.equal(main[3], 999);
    assert.match(block[1], /^【剧情剪辑台：当前局面】/);
    assert.match(block[1], /人物 林晚：处境 在书店/);
    assert.match(block[1], /不要复述/);
    assert.deepEqual([block[2], block[3], block[4], block[5]], [1, 2, false, 0], 'in chat, two messages from the end, same role');
    // The setting moves it; 999 puts it back in front.
    for (const depth of [0, 4, 999]) {
        f.state.facts.settings.injectDepth = depth;
        f.injection.syncInjection();
        assert.equal(f.sent('memory_facts')[3], depth);
    }
    assert.deepEqual([normalizeFactSettings({}).injectDepth, normalizeFactSettings({ injectDepth: 0 }).injectDepth, normalizeFactSettings({ injectDepth: 'x' }).injectDepth, normalizeFactSettings({ injectDepth: 999 }).injectDepth], [2, 0, 2, 999]);
    // Injection off or 剧情事实 off: the block is empty, nothing stale stays behind.
    f.state.facts.settings.enabled = false;
    f.injection.syncInjection();
    assert.equal(f.sent('memory_facts')[1], '');
    f.state.facts.settings.enabled = true;
    f.state.injection.enabled = false;
    f.injection.syncInjection();
    assert.equal(f.sent('memory_facts')[1], '');
    assert.equal(f.sent('memory')[1], '');
});

test('what the page shows and counts includes both blocks; the check against the last prompt looks at the stable one', () => {
    const f = injectionFixture();
    const parts = f.injection.getInjectionMemoryParts(f.state);
    assert.doesNotMatch(f.injection.renderInjectionContent(f.state, parts), /林晚/);
    assert.match(f.injection.renderInjectionDisplay(f.state, parts), /阶段总结0[\s\S]*林晚/);
    assert.match(f.injection.renderInjectionDisplay(f.state, { memory: '只是预览' }), /只是预览[\s\S]*林晚/, 'the template preview passes only the memory');
    assert.match(f.overview.getOverviewInjectionSources().facts, /林晚/);
    // Facts alone (no summaries yet) are still counted and do not read as "nothing to inject".
    f.state.stageSummaries = [];
    const alone = f.injection.getInjectionMemoryParts(f.state);
    assert.equal(f.injection.renderInjectionContent(f.state, alone), '');
    assert.match(f.overview.getOverviewInjectionSources().facts, /林晚/);
    assert.doesNotMatch(alone.diagnostic, /没有可注入/);
    // The block depends on the latest floors, so a last prompt with other cards still counts as verified.
    f.state.stageSummaries = [{ hash: 'stage0', type: 'stage', content: '阶段总结0', sourceMessageIds: [0] }];
    const main = f.injection.renderInjectionContent(f.state);
    assert.equal(f.overview.doesLastPromptMatchCurrentInjection(`${main}\n【剧情剪辑台：当前局面】上一轮的卡片`), true);
    assert.equal(f.overview.doesLastPromptMatchCurrentInjection('别的上下文'), false);
});
