import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultRecentStages, planStageInjection, stageIndexLine, stageOnDemandConfigured } from '../src/memory/stage-on-demand.js';
import { createInjectionService } from '../src/features/injection-service.js';
import { createSummaryMemoryModel } from '../src/features/summary-memory-model.js';
import { createVectorAutoRecall } from '../src/features/vector-auto-recall.js';
import { renderInjectionTemplate } from '../src/shared/injection-template.js';
import { createLocalEmbedding } from '../src/vector/math.js';
import { dedupeByHash, unique } from '../src/shared/collections.js';
import * as meta from '../src/summary/source-metadata.js';
import * as levels from '../src/summary/levels.js';
import { recallFixture } from './helpers/recall-fixture.mjs';

const stage = (hash, floors, content = `${hash}这一章的总结内容。`, extra = {}) => ({ hash, type: 'stage', content, sourceMessageIds: floors, sourceStart: floors[0], sourceEnd: floors.at(-1), createdAt: '2026-11-01', ...extra });
const configured = (extra = {}) => ({ injection: { stageOnDemand: true, ...extra }, vectorMemory: { enabled: true, embeddingProvider: 'custom-openai' } });

test('the newest chapters stay, by the floors they cover; older ones go on demand; only saved ones do', () => {
    assert.equal(defaultRecentStages, 3);
    const stages = [stage('c', [20, 22]), stage('a', [2, 4]), stage('e', [40]), stage('b', [10, 12]), stage('d', [30, 32])];
    const state = { ...configured(), stageSummaries: stages };
    const { always, onDemand } = planStageInjection(state, stages);
    assert.deepEqual(always.map(item => item.hash), ['c', 'e', 'd'], 'in the order given');
    assert.deepEqual(onDemand.map(item => item.hash), ['a', 'b']);
    assert.deepEqual(planStageInjection({ ...configured({ recentStages: 1 }), stageSummaries: stages }, stages).always.map(item => item.hash), ['e']);
    // A chapter read from a reply is not in the index whole: it stays.
    const scanned = stage('scan', [1], '回复里的阶段总结。');
    assert.ok(planStageInjection(state, [scanned, ...stages]).always.some(item => item.hash === 'scan'));
    const few = stages.slice(0, 3);
    assert.deepEqual(planStageInjection({ ...configured(), stageSummaries: few }, few).onDemand, []);
});

test('it needs the switch and an embedding that works on meaning', () => {
    assert.equal(stageOnDemandConfigured(configured()), true);
    assert.equal(stageOnDemandConfigured({ ...configured(), injection: { stageOnDemand: false } }), false);
    assert.equal(stageOnDemandConfigured({ ...configured(), injection: {} }), false, 'a chat from before has no opinion: it stays as it was');
    assert.equal(stageOnDemandConfigured({ ...configured(), vectorMemory: { enabled: false, embeddingProvider: 'custom-openai' } }), false);
    assert.equal(stageOnDemandConfigured({ ...configured(), vectorMemory: { enabled: true, embeddingProvider: 'local' } }), false, 'the hash embedding only knows the same words');
    const stages = [1, 2, 3, 4, 5].map(i => stage(`s${i}`, [i]));
    assert.equal(planStageInjection({ injection: {}, vectorMemory: {}, stageSummaries: stages }, stages).onDemand.length, 0);
});

test('the index line keeps the chapters in view, in story order, by the name they gave themselves', () => {
    const line = stageIndexLine([stage('b', [42, 80], '【👑『第二卷：灰盆』★ 跨度】'), stage('a', [2, 40], '<details><summary>【剧集终了·点击回看】</summary>【👑『第一卷：红纸』★】</details>', { title: '【剧集终了·点击回看】' })]);
    assert.match(line, /第 2–40 楼 第一卷：红纸；第 42–80 楼 第二卷：灰盆/);
    assert.match(line, /不要编/);
    assert.match(stageIndexLine([stage('t', [5], '没有名字。', { title: '码头那一夜' })]), /第 5 楼 码头那一夜/);
    assert.doesNotMatch(stageIndexLine([stage('t', [5], '没有名字。', { title: '【剧集终了·点击回看】' })]), /点击回看/, 'the same default title on all of them says nothing');
    assert.equal(stageIndexLine([]), '');
    const many = Array.from({ length: 45 }, (_, i) => stage(`s${i}`, [i * 2]));
    assert.match(stageIndexLine(many), /更早还有 5 段；第 10 楼/);
});

// The real services: a chat, six saved chapters, real injection over real recall, an embedding endpoint of our own.
function world({ onDemand = true, recent = 3, provider = 'custom-openai' } = {}) {
    const stories = ['外公把铜钥匙交给了我让我收好', '灯塔的看守说夜里不要靠近礁石', '集市上卖鱼的和药铺吵了一架', '她在书店翻到一封没有署名的信', '货船带来了北方打仗的消息', '雪下了三天镇上的路都封了'];
    const chat = stories.flatMap(text => [{ is_user: false, mes: text }, { is_user: true, mes: '嗯。' }]);
    chat.push({ is_user: false, mes: '她推开门。' }, { is_user: true, mes: '外公把铜钥匙交给了我让我收好吗？' });
    const endpoint = { fail: false, hang: false, calls: 0 };
    const fetchImpl = async (_url, init) => {
        endpoint.calls++;
        if (endpoint.hang) return new Promise(() => {});
        if (endpoint.fail) return new Response('down', { status: 500 });
        const { input } = JSON.parse(init.body);
        const list = Array.isArray(input) ? input : [input];
        return new Response(JSON.stringify({ data: list.map((text, index) => ({ index, embedding: createLocalEmbedding(text, 192) })) }));
    };
    const types = { STORY: 'story', STAGE: 'stage', EPIC: 'epic' };
    const statuses = Object.fromEntries(['source', 'covered', 'saved', 'injected', 'archived', 'draft', 'stale'].map(key => [key.toUpperCase(), key]));
    const model = createSummaryMemoryModel({ blockTypes: types, memoryStrategies: { GENERIC: 'generic' }, memoryRecordStatuses: statuses, dedupeByHash, ...meta, ...levels, unique,
        getBlockTitle: (_, fallback) => fallback, getKindLabel: kind => kind, getDefaultDraftTitle: kind => kind });
    const f = recallFixture(chat, { embeddingProvider: provider, customApi: { baseUrl: 'https://example.test/v1', model: 'm' }, contextWindowMessages: 2, rerankThreshold: 0.3 },
        { fetchImpl, getStageMemoryBlocks: state => model.getStageMemoryBlocks(state), getActiveCoveredStageHashes: state => model.getActiveCoveredStageHashes(state), getActiveEpicMemoryBlocks: state => model.getActiveEpicMemoryBlocks(state) });
    const state = f.state;
    Object.assign(state, { blocks: [], drafts: [], history: [], coveredBlockHashes: [], coveredStageHashes: [], outputMode: 'plain', scanRules: {}, inlineGeneration: {},
        injection: { enabled: true, depth: 999, role: 0, template: '{{memory}}', stageOnDemand: onDemand, recentStages: recent } });
    state.stageSummaries = stories.map((text, i) => stage(`chapter${i}`, [i * 2], `第${i}章：${text}。`));
    const injection = createInjectionService({ ...model, ...levels, ensureState: () => state, getChat: () => chat, memoryStrategies: { GENERIC: 'generic' }, setExtensionPrompt: () => {},
        injectionKey: 'memory', extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 }, defaultState: { injection: { depth: 999 } }, inlinePromptKeys: {},
        defaultInjectionTemplate: '{{memory}}', renderInjectionTemplate, renderVectorMemorySection: current => f.service.renderVectorMemorySection(current), isRecallReady: current => f.service.isRecallReady(current) });
    const main = () => injection.renderInjectionContent(state);
    return { ...f, state, endpoint, injection, model, main, chapter: i => `第${i}章：${stories[i]}。`, stories };
}
const has = (text, needle) => text.includes(needle);

test('off, or for a chat from before: every chapter goes every round, and none of them is in the index', async () => {
    const w = world({ onDemand: false });
    await w.service.buildVectorMemoryIndex();
    await w.recall();
    for (let i = 0; i < 6; i++) assert.ok(has(w.main(), w.chapter(i)), `第 ${i} 章`);
    assert.doesNotMatch(w.main(), /更早的阶段/);
    assert.ok(!w.state.vectorMemory.records.some(record => record.summaryType === 'stage'));
    assert.match(w.injection.getStageOnDemandStatus(w.state), /6 段全部常驻.*打开后常驻最近 3 段.*更早的 3 段/);
});

test('on: the latest three stay, the older ones wait in the index, one line keeps them in view', async () => {
    const w = world();
    await w.service.buildVectorMemoryIndex();
    assert.deepEqual(w.state.vectorMemory.records.filter(record => record.summaryType === 'stage').map(record => record.memoryHash).sort(), ['chapter0', 'chapter1', 'chapter2']);
    w.chat.at(-1).mes = '今天的天气不错吧？';
    await w.recall();
    const main = w.main();
    for (const i of [3, 4, 5]) assert.ok(has(main, w.chapter(i)), `第 ${i} 章常驻`);
    for (const i of [1, 2]) assert.ok(!has(main, w.chapter(i)), `第 ${i} 章不发`);
    assert.match(main, /更早的阶段（提到时才带上详情/);
    assert.match(main, /第 0 楼/);
    assert.match(w.injection.getStageOnDemandStatus(w.state), /常驻最近 3 段.*更早的 3 段按需带上/);
});

test('the story reaches back: the floor brings its chapter, whole and once', async () => {
    const w = world();
    await w.service.buildVectorMemoryIndex();
    await w.recall();
    assert.ok(w.state.vectorMemory.lastHits.some(hit => hit.memoryHash === 'chapter0'), JSON.stringify(w.state.vectorMemory.lastHits.map(hit => [hit.id, hit.recallTier, hit.rerankScore])));
    const main = w.main();
    assert.equal(main.split(w.chapter(0)).length - 1, 1, 'the chapter, once');
    assert.ok(!has(main, w.chapter(1)), 'the chapters nothing reached for stay out');
    assert.match(w.injection.getStageOnDemandStatus(w.state), /这一轮带上了 1 段/);
});

test('when recall fails this round nothing is lost: every chapter goes, and the next good round goes back to the short form', async () => {
    const w = world();
    await w.service.buildVectorMemoryIndex();
    w.endpoint.fail = true;
    w.chat.at(-1).mes = '换一句没问过的话，好让它去请求接口。';
    await w.recall();
    assert.match(w.state.vectorMemory.lastRecallSkippedReason, /嵌入请求失败/);
    assert.equal(w.service.isRecallReady(w.state), false);
    for (let i = 0; i < 6; i++) assert.ok(has(w.main(), w.chapter(i)), `第 ${i} 章`);
    assert.doesNotMatch(w.main(), /更早的阶段/);
    assert.match(w.injection.getStageOnDemandStatus(w.state), /这一轮.*全部带上/);
    w.endpoint.fail = false;
    await w.recall();
    assert.equal(w.service.isRecallReady(w.state), true);
    assert.ok(!has(w.main(), w.chapter(1)));
});

test('an automatic recall that times out: the prompt the host assembles has every chapter', async () => {
    const w = world();
    await w.service.buildVectorMemoryIndex();
    w.endpoint.hang = true;
    w.chat.at(-1).mes = '又是一句新的话，接口这回不答。';
    let prompt = '', fire = null;
    const auto = createVectorAutoRecall({ getState: () => w.state, retrieve: w.service.retrieveVectorMemoryHits, cancelRecall: w.service.cancelVectorRecall, clear: w.service.clearVectorRecall,
        syncInjection: () => { prompt = w.main(); }, saveState: () => {}, setTimer: fn => { fire = fn; return 1; }, clearTimer: () => {} });
    const running = auto.intercept([], 8000, () => {}, 'normal');
    await new Promise(resolve => setTimeout(resolve, 20));
    fire();
    await running;
    assert.match(w.state.vectorMemory.lastRecallSkippedReason, /超时/);
    for (let i = 0; i < 6; i++) assert.ok(has(prompt, w.chapter(i)), `第 ${i} 章`);
    auto.dispose();
});

test('an index out of date, or a recall skipped on purpose: every chapter too; nothing similar found, or everything still visible: the short form', async () => {
    const w = world();
    assert.equal(w.service.isRecallReady(w.state), false, 'no index yet');
    assert.ok(has(w.main(), w.chapter(0)));
    await w.service.buildVectorMemoryIndex();
    assert.equal(w.service.isRecallReady(w.state), true);
    w.state.vectorMemory.dirty = true;
    assert.equal(w.service.isRecallReady(w.state), false);
    await w.recall();
    assert.equal(w.state.vectorMemory.dirty, false, 'a recall that finds the index current clears a mark left over');
    assert.equal(w.service.isRecallReady(w.state), true);
    const reason = text => { w.state.vectorMemory.lastRecallSkippedReason = text; return w.service.isRecallReady(w.state); };
    assert.equal(reason('当前 AI 楼数少于 10，已跳过召回。'), false);
    assert.equal(reason('查询重写没有生成有效检索句，本轮不召回。'), false);
    assert.equal(reason('向量维度不一致，请刷新索引；本次未混用不同维度。'), false);
    assert.equal(reason('没有找到够像的内容。'), true);
    assert.equal(reason('已索引内容都还在可见最近 20 楼内，已跳过向量召回。'), true);
    assert.equal(reason(''), true);
});

test('the hash embedding, or recall switched off: every chapter, and the page says why', async () => {
    const local = world({ provider: 'local' });
    await local.service.buildVectorMemoryIndex();
    await local.recall();
    for (let i = 0; i < 6; i++) assert.ok(has(local.main(), local.chapter(i)));
    assert.match(local.injection.getStageOnDemandStatus(local.state), /嵌入接口/);
    const off = world();
    off.state.vectorMemory.enabled = false;
    for (let i = 0; i < 6; i++) assert.ok(has(off.main(), off.chapter(i)));
    assert.match(off.injection.getStageOnDemandStatus(off.state), /向量记忆/);
});

test('a new chapter pushes the oldest of the three into the index; a chapter under a 多次总结 stays out of the prompt as before', async () => {
    const w = world();
    await w.service.buildVectorMemoryIndex();
    const before = w.service.getVectorSourceSignature(w.state);
    w.state.stageSummaries.push(stage('chapter6', [20, 21], '第6章：又是一段新的剧情。'));
    assert.notEqual(w.service.getVectorSourceSignature(w.state), before);
    await w.service.buildVectorMemoryIndex();
    assert.ok(w.state.vectorMemory.records.some(record => record.memoryHash === 'chapter3'));
    assert.ok(!w.state.vectorMemory.records.some(record => record.memoryHash === 'chapter4'));
});

test('the record of a chapter on demand says so: saved, not injected', async () => {
    const w = world();
    const records = w.model.buildMemoryRecords(w.state);
    const of = hash => records.find(record => record.hash === hash);
    assert.equal(of('chapter0').status, 'saved');
    assert.equal(of('chapter0').usage, 'on_demand');
    assert.match(of('chapter0').reason, /提到时/);
    assert.equal(of('chapter5').status, 'injected');
    w.state.injection.stageOnDemand = false;
    assert.equal(w.model.buildMemoryRecords(w.state).find(record => record.hash === 'chapter0').status, 'injected');
});

test('a new chat starts with it on, a chat from before with it off; the switch and the number are on the injection page', () => {
    const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(read('src/core/chat-state-service.js'), /if \(isNewChatState\) \{[^}]*stageOnDemand = true/);
    assert.match(read('src/config/defaults.js'), /injection: \{[^}]*stageOnDemand: false,[^}]*recentStages: 3/);
    const html = read('settings.html');
    assert.match(html, /id="bakemono-memory-stage-on-demand"/);
    assert.match(html, /id="bakemono-memory-recent-stages"/);
    assert.match(html, /id="bakemono-memory-stage-on-demand-status"/);
    assert.match(read('src/ui/page-settings.js'), /injection: \{[^}]*stage-on-demand\|recent-stages/);
    const service = read('src/features/configuration-service.js');
    assert.match(service, /stageOnDemand: !!query\('#bakemono-memory-stage-on-demand'\)\.prop\('checked'\)/);
    assert.match(service, /recentStages: /);
    assert.match(read('src/features/workbench-renderer.js'), /#bakemono-memory-stage-on-demand/);
    assert.match(read('src/features/workbench-page-overviews.js'), /#bakemono-memory-stage-on-demand-status/);
    const index = read('index.js');
    assert.match(index, /isRecallReady: \(\.\.\.args\) => vectorMemoryService\.isRecallReady\(\.\.\.args\)|isRecallReady,/);
    assert.match(index, /getStageMemoryBlocks/);
});
