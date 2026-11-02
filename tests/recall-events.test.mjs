import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupRecallCandidates, recallHitHeader, selectRecallPlan } from '../src/vector/recall-plan.js';
import { applyFactsUpdate, createDefaultFacts } from '../src/facts/model.js';
import { renderFactsSection } from '../src/facts/injection.js';
import { createInjectionService } from '../src/features/injection-service.js';
import { recallFixture } from './helpers/recall-fixture.mjs';

// A hit on one floor brings the chapter it belongs to: what happened around that floor, not only the floor.
const stage = (hash, floors, text = `第${floors[0]}到${floors.at(-1)}楼这一章的总结。`) => ({ id: `vec-saved-stage-${hash}`, hash, type: 'stage', messageId: floors[0],
    sourceStart: floors[0], sourceEnd: floors.at(-1), sourceMessageIds: floors, title: `阶段总结：${hash}`, text, preview: text });
const floorRecord = (messageId, score, extra = {}) => ({ id: `m${messageId}`, kind: 'message', messageId, text: `第${messageId}楼正文。`, score, ...extra });
const plan = (records, events, config = {}) => {
    const bodies = new Map(records.map(record => [record.messageId, record.text]));
    return selectRecallPlan(groupRecallCandidates(records, records, bodies, 20), config, { events });
};

test('a strong hit brings its chapter, once, in front of the floor; a weak one does not', () => {
    const events = [stage('a', [2, 4, 6]), stage('b', [8, 10])];
    const result = plan([floorRecord(4, .9), floorRecord(6, .8), floorRecord(10, .3)], events, { fullRecallCount: 3 });
    assert.deepEqual(result.hits.filter(hit => hit.recallTier === 'event').map(hit => hit.memoryHash), ['a'], 'two floors of one chapter: one chapter; a weak floor: none');
    assert.equal(result.hits[0].recallTier, 'event', 'in story order, the chapter starts first');
    assert.match(result.text, /第2到6楼这一章的总结。/);
    assert.match(recallHitHeader(result.hits[0]), /整段/);
    assert.match(result.hits[0].decisionReason, /第 4 楼/);
    assert.equal(result.hits[0].isSavedSummary, true);
    assert.deepEqual(result.hits[0].sourceMessageIds, [2, 4, 6]);
});

test('at most two chapters a round, the strongest first; a floor no chapter covers brings nothing; the safety cap holds', () => {
    const events = [stage('a', [2]), stage('b', [4]), stage('c', [6])];
    const records = [floorRecord(2, .7), floorRecord(4, .9), floorRecord(6, .8)];
    const result = plan(records, events, { fullRecallCount: 3 });
    assert.deepEqual(result.hits.filter(hit => hit.recallTier === 'event').map(hit => hit.memoryHash).sort(), ['b', 'c']);
    assert.equal(plan(records, [], { fullRecallCount: 3 }).hits.length, 3);
    assert.equal(plan(records, events, { fullRecallCount: 3, eventRecallCount: 0 }).hits.length, 3, 'zero turns it off');
    const big = stage('big', [2], '很长的总结。'.repeat(400));
    const capped = plan([floorRecord(2, .9)], [big], { fullRecallCount: 1, recallSafetyChars: 1000 });
    assert.equal(capped.hits.length, 1, 'over the cap the chapter stays out, whole; nothing is cut');
    assert.equal(capped.hits[0].recallTier, 'full');
    assert.match(capped.decisions.find(item => item.memoryHash === 'big').decisionReason, /放不下/);
});

test('a floor the line named brings its chapter however weak; a chapter that came on its own is not doubled; the narrowest wins', () => {
    const events = [stage('wide', [2, 3, 4, 5, 6, 7, 8]), stage('narrow', [4, 6])];
    const named = plan([floorRecord(4, .1, { guaranteed: '老周' })], events, { fullRecallCount: 1 });
    assert.deepEqual(named.hits.filter(hit => hit.recallTier === 'event').map(hit => hit.memoryHash), ['narrow']);
    const itself = { id: 'vec-saved-stage-narrow', kind: 'summary', messageId: 4, memoryHash: 'narrow', isSavedSummary: true, summaryType: 'stage', text: events[1].text, score: .95 };
    const both = plan([itself, floorRecord(4, .9)], events, { fullRecallCount: 1 });
    assert.equal(both.hits.filter(hit => hit.memoryHash === 'narrow').length, 1);
    assert.equal(both.hits.find(hit => hit.memoryHash === 'narrow').recallTier, 'event');
    // A floor inside the range but not listed (a user floor between two listed ones) still belongs to the chapter.
    const inRange = plan([floorRecord(5, .9)], [stage('r', [4, 6])], { fullRecallCount: 1 });
    assert.equal(inRange.hits.filter(hit => hit.recallTier === 'event').length, 1);
});

test('a chapter that hardly matches stays out: a long summary is not a filler for the empty slots; its count is its own', () => {
    const chapter = (hash, floor, score) => ({ id: hash, kind: 'summary', messageId: floor, memoryHash: hash, isSavedSummary: true, summaryType: 'stage', text: `${hash}的总结。`.repeat(50), score });
    const weak = plan([chapter('weak', 2, .2)], [], { maxSummaryRecall: 4 });
    assert.equal(weak.hits.length, 0);
    assert.match(weak.decisions[0].decisionReason, /不够像/);
    const many = plan([chapter('a', 2, .9), chapter('b', 4, .8), chapter('c', 6, .7), floorRecord(20, .3, { summary: '第20楼摘要。', kind: 'summary' })], [], {});
    assert.deepEqual(many.hits.filter(hit => hit.recallTier === 'event').map(hit => hit.memoryHash).sort(), ['a', 'b']);
    assert.match(many.decisions.find(item => item.memoryHash === 'c').decisionReason, /整段已满 2 段/);
    assert.equal(many.hits.filter(hit => hit.recallTier === 'summary').length, 1, 'it does not take the slots of the floor summaries');
    // A saved summary of one floor is not long, and stays as it was.
    const story = plan([{ id: 's', kind: 'summary', messageId: 2, memoryHash: 's', isSavedSummary: true, summaryType: 'story', text: '一楼的摘要。', score: .2 }], [], {});
    assert.equal(story.hits[0].recallTier, 'summary');
});

function coveredChapterFixture() {
    const chat = [{ is_user: false, mes: '外公把铜钥匙交给了我，让我收好。' }, { is_user: true, mes: '好。' }, { is_user: false, mes: '码头的货船今天来了三艘。' }, { is_user: true, mes: '嗯。' },
        { is_user: false, mes: '她推开门。' }, { is_user: true, mes: '外公把铜钥匙交给了我，让我收好吗？' }];
    const f = recallFixture(chat, { contextWindowMessages: 2, rerankThreshold: 0.2 }, { getActiveCoveredStageHashes: () => new Set(['chapter1']) });
    f.state.stageSummaries = [{ hash: 'chapter1', type: 'stage', title: '钥匙一章', content: '这一章：外公把钥匙交给我，码头来了货船。', sourceMessageIds: [0, 2], sourceStart: 0, sourceEnd: 2 }];
    return f;
}

test('through the service: a chapter not injected every round comes with its floor, also after a reload', async () => {
    const f = coveredChapterFixture();
    await f.service.buildVectorMemoryIndex();
    await f.recall();
    const event = f.state.vectorMemory.lastHits.find(hit => hit.recallTier === 'event');
    assert.ok(event, JSON.stringify(f.state.vectorMemory.lastHits.map(hit => [hit.id, hit.recallTier, hit.rerankScore])));
    assert.equal(event.memoryHash, 'chapter1');
    const text = f.service.renderVectorMemorySection();
    assert.equal(text.match(/这一章：外公把钥匙交给我/g).length, 1);
    // After a reload there is no plan in memory: the saved selection is rebuilt, the chapter counted once.
    const reloaded = JSON.parse(JSON.stringify(f.state));
    const service = f.dependencies && (await import('../src/features/vector-memory-service.js')).createVectorMemoryService({ ...f.dependencies, getState: () => reloaded });
    const again = service.renderVectorMemorySection();
    assert.equal(again.match(/这一章：外公把钥匙交给我/g).length, 1);
    assert.equal(reloaded.vectorMemory.lastHits.filter(hit => hit.recallTier === 'event').length, 1);
});

test('the 向量记忆 page shows the chapter as going in, and it does not count against the summaries', () => {
    const source = readFileSync(new URL('../src/features/vector-workbench-ui.js', import.meta.url), 'utf8');
    assert.match(source, /'整段'/);
    assert.match(source, /recallTier === 'event'/);
});

// The other unit of “one thing”: the 线索 card on that floor.
function threadWorld() {
    const facts = createDefaultFacts();
    applyFactsUpdate(facts, { cards: [
        { kind: 'thread', name: '码头之约', fields: { 内容: '第三天日落在码头见', 状态: '未了', 参与者: '林晚、沈砚' } },
        { kind: 'thread', name: '还钥匙', fields: { 内容: '把钥匙还给老板娘', 状态: '已了' } },
        { kind: 'thread', name: '别的约定', fields: { 内容: '和这一楼无关', 状态: '未了' } },
        { kind: 'person', name: '莉娜', fields: { 处境: '在柜台' } },
    ] }, { floorFrom: 2, floorTo: 30, mentionFloors: card => ({ 码头之约: [20, 26], 还钥匙: [20], 别的约定: [8], 莉娜: [20] })[card.name] || [] });
    return facts;
}

test('a recalled floor brings the 线索 on it in one line, closed ones too, though the text does not name them; others stay out', () => {
    const facts = threadWorld();
    const { text, plan: injected } = renderFactsSection(facts, { scene: '', recent: '', recalled: '', recalledFloors: [20] }, { budgetChars: 4000 });
    assert.match(text, /线索 码头之约：状态 未了/);
    assert.match(text, /线索 还钥匙：状态 已了/, 'a kept promise is still a memory');
    assert.ok(injected.short.includes('码头之约'));
    assert.ok(!injected.short.includes('别的约定') && !injected.full.includes('别的约定'));
    assert.ok(!injected.short.includes('莉娜'), 'only 线索: a person on that floor is not what the floor is about');
    const without = renderFactsSection(facts, { scene: '', recent: '', recalled: '' }, { budgetChars: 4000 });
    assert.ok(!without.plan.short.includes('码头之约'));
});

test('the injection passes the floors of floor hits; a chapter neither names cards nor points at every thread in it', () => {
    const facts = threadWorld();
    const seen = [];
    const state = { facts, storySummaries: [], stageSummaries: [], epicSummaries: [], blocks: [], memoryStrategy: 'bakemono', injection: { enabled: true }, inlineGeneration: {},
        vectorMemory: { enabled: true, lastHits: [{ messageId: 20, recallTier: 'summary', text: '第 20 楼说了别的。' },
            { messageId: 2, memoryHash: 'chapter', recallTier: 'event', isSavedSummary: true, sourceMessageIds: [2, 8], text: '这一章提到了莉娜。' }] } };
    const injection = createInjectionService({ ensureState: () => state, getChat: () => [], memoryStrategies: { GENERIC: 'generic' }, renderVectorMemorySection: () => '', defaultInjectionTemplate: '{{memory}}', renderInjectionTemplate: value => value,
        renderFactsSection: (current, parts) => { seen.push(parts); return renderFactsSection(current.facts, parts, { budgetChars: 4000 }); } });
    injection.getInjectionMemoryParts(state);
    assert.deepEqual(seen[0].recalledFloors, [20]);
    assert.doesNotMatch(seen[0].recalled, /莉娜/);
    assert.match(seen[0].recalled, /第 20 楼/);
});
