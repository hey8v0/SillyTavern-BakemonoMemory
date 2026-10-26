import test from 'node:test';
import assert from 'node:assert/strict';
import { factsRecallKeywords, recallText } from '../src/facts/recall.js';
import { applyFactsUpdate, createDefaultFacts } from '../src/facts/model.js';
import { renderFactsSection } from '../src/facts/injection.js';
import { createSummaryMemoryModel } from '../src/features/summary-memory-model.js';
import { createInjectionService } from '../src/features/injection-service.js';
import { dedupeByHash, unique } from '../src/shared/collections.js';
import * as meta from '../src/summary/source-metadata.js';
import * as levels from '../src/summary/levels.js';

function world() {
    const facts = createDefaultFacts();
    applyFactsUpdate(facts, { cards: [
        { kind: 'person', name: '林晚', aliases: ['小晚', '晚姐'], fields: { 处境: '在书店' } },
        { kind: 'person', name: '沈砚', fields: { 处境: '在码头等人' } },
        { kind: 'place', name: '码头', fields: { 描述: '雾港镇的旧码头' } },
        { kind: 'note', name: '写作要求', fields: { 内容: '少写环境' } },
    ] }, { now: '2026-10-26T12:00:00.000Z' });
    return facts;
}

test('场景 1/4 长距离回忆：最近对话点到的卡片把它的每个称呼都交给召回当关键词，便签不算，没开就没有', () => {
    const facts = world();
    assert.deepEqual(factsRecallKeywords(facts, '小晚盯着墙缝发呆。'), ['林晚', '小晚', '晚姐'], 'an alias in the chat finds the recorded name for older summaries');
    assert.deepEqual(factsRecallKeywords(facts, '她们在码头见面。'), ['码头']);
    assert.deepEqual(factsRecallKeywords(facts, '写作要求：少写环境'), []);
    assert.deepEqual(factsRecallKeywords(facts, ''), []);
    assert.deepEqual(factsRecallKeywords(facts, '林晚、沈砚、码头都在', { max: 2 }), ['林晚', '小晚']);
    facts.settings.enabled = false;
    assert.deepEqual(factsRecallKeywords(facts, '林晚'), []);
    assert.equal(recallText([{ title: '第 12 楼', text: '沈砚在码头等人' }, { summary: '旧信' }, {}]), '第 12 楼\n沈砚在码头等人\n旧信');
    assert.equal(recallText([{ text: 'a'.repeat(50) }, { text: 'b'.repeat(50) }], { maxChars: 60 }), 'a'.repeat(50));
});

test('召回带回的旧摘要点到的卡片也进注入；向量记忆没开时只看最近楼层', () => {
    const facts = world();
    const chat = [{ mes: '林晚走进书店。', is_user: false }, { mes: '她翻着旧信。', is_user: true }];
    const statuses = Object.fromEntries(['source', 'covered', 'saved', 'injected', 'archived', 'draft', 'stale'].map(k => [k.toUpperCase(), k]));
    const types = { STORY: 'story', STAGE: 'stage', EPIC: 'epic' };
    const state = { facts, outputMode: 'plain', storySummaries: [], stageSummaries: [], epicSummaries: [], blocks: [], drafts: [], history: [], coveredBlockHashes: [], coveredStageHashes: [],
        injection: { enabled: true }, inlineGeneration: {}, automation: {}, memoryStrategy: 'generic', scanRules: {}, generatedMemory: '',
        vectorMemory: { enabled: true, lastHits: [{ title: '第 12 楼', text: '沈砚在码头等人，雨下了一夜。' }] } };
    const model = createSummaryMemoryModel({ blockTypes: types, memoryStrategies: { GENERIC: 'generic' }, memoryRecordStatuses: statuses, dedupeByHash, ...meta, ...levels, unique,
        getBlockTitle: (_, fallback) => fallback, getKindLabel: x => x, getDefaultDraftTitle: x => x });
    const injection = createInjectionService({ ensureState: () => state, getChat: () => chat, ...model, ...levels, memoryStrategies: { GENERIC: 'generic' },
        defaultInjectionTemplate: '{{memory}}', renderVectorMemorySection: () => '', renderFactsSection: (current, text) => renderFactsSection(current.facts, text) });
    const withHits = injection.getInjectionMemoryParts(state).sources.facts;
    assert.match(withHits, /人物 林晚/);
    assert.match(withHits, /人物 沈砚/, 'named only by the recalled summary');
    assert.match(withHits, /地点 码头/);
    state.vectorMemory.enabled = false;
    const without = injection.getInjectionMemoryParts(state).sources.facts;
    assert.match(without, /人物 林晚/);
    assert.doesNotMatch(without, /沈砚/);
});
