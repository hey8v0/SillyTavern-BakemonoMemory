import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFactsUpdate, createDefaultFacts, findCard, injectionBudget, normalizeFactSettings } from '../src/facts/model.js';
import { renderFactCardLine, renderFactCardShort, renderFactsSection } from '../src/facts/injection.js';
import { buildFactsPrompt, cardForPrompt, defaultFactsPrompt } from '../src/facts/prompt.js';
import { factsRuntime, reply } from './helpers/facts-runtime.mjs';

// v1.40.0: the facts section in layers. Cards in the scene (the latest floors) in full, others the story touches in
// one line, the rest only by name when room runs out; the budget follows the model's context.
import { recentParts, verboseWorld } from './helpers/facts-world.mjs';

test('the scene in full, what else the story touches in one line, nothing unrelated as a line, within the budget', () => {
    const facts = verboseWorld();
    const result = renderFactsSection(facts, recentParts, { budgetChars: 20000 });
    const text = result.text;
    const line = name => text.split('\n').find(row => row.startsWith(name));
    assert.match(text, /^## 剧情事实\n/);
    assert.match(text, /### 当前局面\n/);
    assert.match(line('人物 林晚'), /性格 /, 'in the scene: every field');
    assert.match(line('人物 沈砚'), /外貌 /);
    assert.match(line('关系 恋人'), /当前关系 公开的恋人；态度/, 'the relationship of two people in the scene, though its name is not in the text');
    assert.match(text, /### 其他相关\n/);
    assert.match(line('人物 阿砚'), /^人物 阿砚：处境 .+；目标 .+$/, 'named a few floors back: one line of what is the case now');
    assert.doesNotMatch(line('人物 阿砚'), /性格|外貌|备注/);
    assert.match(line('关系 兄弟'), /当前关系 和好/, 'one of the two is in the scene: one line');
    assert.match(line('线索 还钥匙'), /状态 未了/, 'a thread of someone in the scene');
    assert.match(line('人物 老看守（已结束）'), /死于矿坑口/, 'named by a recalled summary');
    assert.ok(!text.split('\n').some(row => /^线索 无关约定/.test(row)), 'threads of people who are not here are not lines');
    assert.match(text, /伏笔与约定：.*无关约定0/, 'they stay as names in the reminder of open threads');
    assert.ok(!line('关系 旧识') && !line('人物 莉娜'), 'nothing that is not in the story right now');
    assert.match(text, /便签 写作要求：内容 少写环境描写/);
    assert.deepEqual(result.plan.full.slice(0, 3).sort(), ['写作要求', '林晚', '沈砚'].sort());
    assert.ok(result.plan.used <= 20000);
});

test('when room runs out the least relevant step down (one line → name only), the scene last; nothing is cut mid-card', () => {
    const facts = verboseWorld();
    const roomy = renderFactsSection(facts, recentParts, { budgetChars: 20000 });
    // A little less room than everything takes: only the least relevant step down.
    const budget = roomy.plan.used - 100;
    const tight = renderFactsSection(facts, recentParts, { budgetChars: budget });
    assert.ok(tight.text.length <= budget, `${tight.text.length} / ${budget} 字`);
    assert.ok(tight.plan.used <= budget);
    assert.ok(tight.plan.named.length > 0, 'some cards only by name');
    assert.match(tight.text, /另有：.*（这一轮没写详情，提到时会写出）/);
    assert.ok(tight.plan.full.includes('林晚') && tight.plan.full.includes('沈砚'), 'the scene keeps its detail while others step down');
    for (const name of tight.plan.named) assert.ok(!['林晚', '沈砚'].includes(name));
    // Tighter still: the scene steps down to one line too; the user's note stays.
    const tighter = renderFactsSection(facts, recentParts, { budgetChars: 700 });
    assert.ok(tighter.text.length <= 700, `${tighter.text.length} 字`);
    assert.match(tighter.text, /便签 写作要求/);
    assert.ok(tighter.plan.short.includes('林晚') || tighter.plan.full.includes('林晚'), 'the scene is the last to go');
    // Every card line is whole: exactly the card's full line or its one-line form, never cut in the middle.
    const allowed = new Set(facts.cards.flatMap(card => [renderFactCardLine(card, { timeline: 1 }), renderFactCardShort(card)]));
    for (const result of [tight, tighter]) {
        for (const row of result.text.split('\n').filter(row => /^(人物|关系|线索|物品|地点|设定|便签) /.test(row))) assert.ok(allowed.has(row), row);
    }
});

test('open threads of other people no longer push the scene out (v1.39 ranked every open thread above the scene)', () => {
    const facts = verboseWorld({ threads: 40 });
    const result = renderFactsSection(facts, { scene: '林晚推开门。', recent: '', recalled: '' }, { budgetChars: 1200 });
    assert.ok(result.plan.full.includes('林晚') || result.plan.short.includes('林晚'), result.text);
    assert.ok(!result.text.split('\n').some(row => /^线索 无关约定/.test(row)));
});

test('a plain string still works as before: everything it names counts as the scene', () => {
    const facts = verboseWorld();
    const text = renderFactsSection(facts, '林晚和阿砚', { budgetChars: 20000 }).text;
    assert.match(text.split('\n').find(row => row.startsWith('人物 阿砚')), /性格/);
});

test('the budget follows the model: a share of its context, with a floor and a ceiling; or a fixed number', () => {
    const auto = normalizeFactSettings({});
    assert.deepEqual([auto.budgetAuto, auto.budgetRatio], [true, 6]);
    assert.equal(injectionBudget(auto, 128000).chars, 7680);
    assert.equal(injectionBudget(auto, 32000).chars, 1920);
    assert.equal(injectionBudget(auto, 8000).chars, 800, 'never below 800');
    assert.equal(injectionBudget(auto, 2000000).chars, 30000, 'never above 30000');
    assert.deepEqual([injectionBudget(auto, 0).chars, injectionBudget(auto, 0).contextTokens], [4000, 0], 'context unknown: 4000');
    const fixed = normalizeFactSettings({ version: 3, budgetAuto: false, budgetChars: 2500 });
    assert.deepEqual([injectionBudget(fixed, 128000).chars, injectionBudget(fixed, 128000).auto], [2500, false]);
    assert.equal(normalizeFactSettings({ version: 3, budgetRatio: 50 }).budgetRatio, 30);
    assert.equal(normalizeFactSettings({ version: 3, budgetRatio: 0 }).budgetRatio, 6);
});

test('settings from v1.39 move to the automatic budget once; a deliberate off or a changed budget stays', () => {
    const offBefore = normalizeFactSettings({ version: 2, enabled: false, budgetChars: 6000 });
    assert.deepEqual([offBefore.version, offBefore.enabled, offBefore.budgetAuto], [3, false, true], 'switching facts off in v1.39 stays off');
    const custom = normalizeFactSettings({ version: 2, enabled: true, budgetChars: 3000 });
    assert.deepEqual([custom.budgetAuto, custom.budgetChars], [false, 3000], 'a budget someone set by hand is kept as a fixed one');
    assert.equal(normalizeFactSettings({ settings: undefined }).enabled, true);
    assert.equal(normalizeFactSettings({ version: 3, budgetAuto: false }).budgetAuto, false);
    assert.equal(normalizeFactSettings({ enabled: false }).enabled, true, 'no version (before v1.32): the default once, as before');
});

test('consolidation keeps cards short: long cards are marked to be rewritten, and up to two long ones come along unnamed', () => {
    const facts = verboseWorld();
    const lin = findCard(facts.cards, '林晚');
    assert.equal(cardForPrompt(lin)['请精简'], true);
    assert.equal(cardForPrompt(findCard(facts.cards, '铜钥匙'))['请精简'], undefined);
    const { prompt, cardIds } = buildFactsPrompt(facts, '铜钥匙被阿砚收好了。');
    const longOnes = facts.cards.filter(card => card.kind === 'person' && card.status === 'active' && card.name !== '阿砚' && cardIds.includes(card.id));
    assert.equal(longOnes.length, 2, 'two long cards the material does not name, for 精简');
    assert.match(prompt, /"name": "阿砚"[\s\S]*?"请精简": true/);
    for (const needle of ['请精简', '事件经过交给剧情摘要', '一两句']) assert.ok(defaultFactsPrompt.includes(needle), needle);
});

test('the controller works out the budget from the model context and remembers what the last round injected', async () => {
    const r = factsRuntime({ every: 3, summaries: 3, contextTokens: 128000 });
    assert.deepEqual([r.controller.injectionBudget().chars, r.controller.injectionBudget().contextTokens], [7680, 128000]);
    r.controller.updateSettings({ budgetAuto: false, budgetChars: 3000 });
    assert.equal(r.controller.injectionBudget().chars, 3000);
    const result = { text: 'x', plan: { budget: 3000, used: 1, full: ['林晚'], short: [], named: [], dropped: 0 } };
    r.controller.noteInjection(r.state, result);
    assert.equal(r.controller.lastInjection(r.state), result.plan);
    r.controller.maybeRun();
    r.setResult(reply([{ kind: 'person', name: '林晚', fields: { 处境: '在码头' } }]));
    await r.queue.processTaskQueue();
    assert.equal(r.state.facts.settings.budgetChars, 3000);
});

test('through the injection service: the latest two floors are the scene, a few floors back gives one line', async () => {
    const { createSummaryMemoryModel } = await import('../src/features/summary-memory-model.js');
    const { createInjectionService } = await import('../src/features/injection-service.js');
    const { dedupeByHash, unique } = await import('../src/shared/collections.js');
    const meta = await import('../src/summary/source-metadata.js');
    const levels = await import('../src/summary/levels.js');
    const facts = verboseWorld();
    const chat = ['阿砚把钥匙收好了。', '……', '……', '……', '林晚推开门。', '沈砚抬起头。'].map((mes, i) => ({ mes, is_user: i % 2 === 1 }));
    const statuses = Object.fromEntries(['source', 'covered', 'saved', 'injected', 'archived', 'draft', 'stale'].map(k => [k.toUpperCase(), k]));
    const state = { facts, outputMode: 'plain', storySummaries: [], stageSummaries: [], epicSummaries: [], blocks: [], drafts: [], history: [], coveredBlockHashes: [], coveredStageHashes: [],
        injection: { enabled: true }, inlineGeneration: {}, automation: {}, memoryStrategy: 'generic', scanRules: {}, generatedMemory: '', vectorMemory: { enabled: false } };
    const model = createSummaryMemoryModel({ blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' }, memoryStrategies: { GENERIC: 'generic' }, memoryRecordStatuses: statuses,
        dedupeByHash, ...meta, ...levels, unique, getBlockTitle: (_, fallback) => fallback, getKindLabel: x => x, getDefaultDraftTitle: x => x });
    let seen = null;
    const injection = createInjectionService({ ensureState: () => state, getChat: () => chat, ...model, ...levels, memoryStrategies: { GENERIC: 'generic' },
        defaultInjectionTemplate: '{{memory}}', renderVectorMemorySection: () => '',
        renderFactsSection: (current, parts) => { seen = parts; return renderFactsSection(current.facts, parts, { budgetChars: 20000 }); } });
    const text = injection.getInjectionMemoryParts(state).sources.facts;
    assert.deepEqual([seen.scene, seen.recalled], ['林晚推开门。\n沈砚抬起头。', '']);
    assert.match(seen.recent, /阿砚把钥匙收好了/);
    assert.match(text.split('\n').find(row => row.startsWith('人物 林晚')), /性格/);
    assert.doesNotMatch(text.split('\n').find(row => row.startsWith('人物 阿砚')), /性格/, 'five floors back: one line');
});
