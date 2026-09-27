import test from 'node:test';
import assert from 'node:assert/strict';
import { applySummarySourceChoice, applyTableModeChoice, summarySourceChoice, tableModeChoice } from '../src/features/turn-trigger-policy.js';
import { createConfigurationService } from '../src/features/configuration-service.js';
import { parseVectorQueryRewritePayload } from '../src/vector/query-parser.js';

const baseState = () => ({
    turnSummary: { enabled: false, auto: false, processingMode: 'both', triggerTiming: 'immediate', saveMode: 'draft' },
    inlineGeneration: { summaryEnabled: true, tableEnabled: false },
    tableDatabase: { enabled: true, autoApply: false, schemaScope: 'chat' },
});

test('each table mode keeps its summary source and never produces the legacy combination', () => {
    for (const source of ['existing', 'inline', 'independent', 'manual']) {
        for (const table of ['inline', 'after', 'manual']) {
            const state = baseState();
            applySummarySourceChoice(state, source);
            applyTableModeChoice(state, table);
            assert.equal(summarySourceChoice(state), source, `${source} + ${table}`);
            // A manual summary turns automatic processing off, so a separate table request falls back to manual.
            assert.equal(tableModeChoice(state), source === 'manual' && table === 'after' ? 'manual' : table, `${source} + ${table}`);
        }
    }
});

test('saving 自动记忆 applies the chosen source with its default combination and keeps flags whose inputs are gone', () => {
    const state = { ...baseState(), workflowMode: 'bakemono', memoryStrategy: 'bakemono', stageSourceMode: 'summaries', outputMode: 'bakemono' };
    state.inlineGeneration.tableEnabled = true;
    const values = new Map([
        ['#bakemono-memory-turn-trigger-timing', 'immediate'],
        ['#bakemono-memory-turn-summary-source', 'independent'],
        ['#bakemono-memory-turn-table-mode', 'inline'],
    ]);
    const query = selector => ({ length: values.has(selector) ? 1 : 0, val: () => values.get(selector), prop: () => values.get(selector) });
    const service = createConfigurationService({ query, getState: () => state, defaultState: { turnSummary: { worldInfoMaxContext: 4096 } },
        turnProcessingModes: { BOTH: 'both' }, tableSchemaScopes: { CHAT: 'chat' }, setTableSchemaScope() {} });
    service.readTurnSummaryFieldsFromUi(state);
    assert.equal(summarySourceChoice(state), 'independent');
    assert.equal(state.workflowMode, 'generic');
    assert.equal(tableModeChoice(state), 'inline');
    assert.equal(state.inlineGeneration.tableEnabled, true);
    assert.equal(state.tableDatabase.enabled, true);
});

test('the rewrite reply can carry this turn’s keywords on one line', () => {
    const payload = parseVectorQueryRewritePayload('INTENT: 找钥匙的下落\nQ1: 莉娜把后门钥匙交给了谁\nKEYWORDS: 莉娜、后门钥匙, 渡鸦酒馆 无');
    assert.deepEqual(payload.queries, ['莉娜把后门钥匙交给了谁']);
    assert.deepEqual(payload.keywords, ['莉娜', '后门钥匙', '渡鸦酒馆']);
});

test('自动总结 says how far the next chapter is and lists the latest chapters, drafts first', async () => {
    const { createHubAutomationUi } = await import('../src/features/hub-automation-ui.js');
    const texts = new Map(), nodes = new Map();
    const query = selector => ({ text(value) { texts.set(selector, value); return this; }, css() { return this; }, toggleClass() { return this; },
        prop() { return this; }, val: () => ({ '#bakemono-memory-auto-mode': 'draft', '#bakemono-memory-auto-trigger': 'floors' })[selector] });
    const node = id => { if (!nodes.has(id)) nodes.set(id, { id, innerHTML: '', dataset: {}, hidden: false, remove() {} }); return nodes.get(id); };
    const state = {
        automation: { enabled: true, mode: 'draft', triggerType: 'floors', floorInterval: 10 },
        stageSummaries: [{ hash: 's1', title: '雾港镇的雨夜', sourceMessageIds: [1, 60], createdAt: '2026-09-20T10:00:00Z' }],
        drafts: [{ id: 'd1', kind: 'stage', title: '钟楼下的约定', sourceMessageIds: [151, 172], createdAt: '2026-09-27T10:00:00Z' }],
    };
    const targets = Array.from({ length: 7 }, (_, i) => ({ hash: `b${i}`, content: '摘要', messageId: 100 + i }));
    const ui = createHubAutomationUi({ query, getState: () => state, documentRef: { getElementById: node, querySelectorAll: () => [] },
        getStageMaterialOverview: () => ({ targets, issues: [], coveredCount: 0, excludedCount: 0 }), getCurrentFloorMemoryIndex: () => ({ records: [] }),
        defaultAutomation: { mode: 'remind', triggerType: 'floors', floorInterval: 10, charInterval: 12000 }, describeSummary: block => ({ title: block.title }) });
    ui.renderAutomationOverview();
    assert.equal(texts.get('#bakemono-memory-automation-runtime-title'), '再攒 3 条摘要就整理成下一章');
    assert.match(texts.get('#bakemono-memory-automation-rule-status'), /7 \/ 10/);
    assert.equal(texts.get('#bakemono-memory-automation-mode-badge'), '生成草稿等我确认');
    const recent = node('bakemono-memory-automation-recent').innerHTML;
    assert.ok(recent.indexOf('钟楼下的约定') < recent.indexOf('雾港镇的雨夜'));
    assert.match(recent, /第 151–172 楼/); assert.match(recent, /草稿等确认/); assert.match(recent, /data-bakemono-summary-focus="s1"/);
    assert.match(node('bakemono-memory-automation-ways').innerHTML, /整理完怎么办[\s\S]*生成草稿等我确认/);
});

test('自动与数据 frames say each tool’s state and colour it', async () => {
    const { createHubAutomationUi } = await import('../src/features/hub-automation-ui.js');
    const texts = new Map(), tones = new Map();
    const query = selector => ({ text(value) { texts.set(selector, value); return this; }, css() { return this; }, toggleClass() { return this; },
        prop() { return this; }, attr(name, value) { tones.set(selector, value); return this; }, val: () => undefined });
    const state = {
        turnSummary: { enabled: false, auto: false, processingMode: 'both' }, inlineGeneration: { summaryEnabled: true, tableEnabled: true },
        automation: { enabled: true, mode: 'draft', triggerType: 'floors', floorInterval: 10 },
        tableDatabase: { enabled: false, tables: [{ rows: [[1], [2]] }], editDrafts: [{ operations: [{}] }], history: [] },
        vectorMemory: { enabled: true, dirty: false, records: [{ messageId: 1 }, { messageId: 2 }], lastHits: [{}, {}] },
        drafts: [{ id: 'x' }], scanRules: {}, autoHideRecent: { enabled: true, preserveRecent: 3 },
    };
    const ui = createHubAutomationUi({ query, getState: () => state, documentRef: { getElementById: () => null, querySelectorAll: () => [] },
        getCurrentFloorMemoryIndex: () => ({ aggregates: { pendingDraftCount: 1, total: 2 }, latest: { id: 2, summaryState: 'saved' }, records: [] }),
        getStageMaterialOverview: () => ({ targets: Array.from({ length: 7 }, (_, i) => ({ hash: `b${i}`, content: '摘要' })), issues: [] }),
        getInjectionHeaderStatus: () => ({ short: '注入 1,000 字' }), getAppearanceSettings: () => ({}), getActiveGlobalConfig: () => null,
        getPromptPresets: () => [], getSelectedPromptPresetId: () => '', defaultAutomation: { triggerType: 'floors', floorInterval: 10 }, defaultScanRules: { mode: 'tags' } });
    ui.renderHubPanels();
    assert.equal(texts.get('#bakemono-memory-data-hub-title'), '1 条内容待确认');
    assert.equal(texts.get('#bakemono-memory-data-hub-turn-line'), '第 2 楼已记好');
    assert.equal(texts.get('#bakemono-memory-data-hub-auto-line'), '再攒 3 条摘要就整理成下一章');
    assert.equal(texts.get('#bakemono-memory-data-hub-table-copy'), '1 处修改等你应用');
    assert.equal(texts.get('#bakemono-memory-data-hub-vector-line'), '2 楼都已建索引');
    assert.deepEqual(['turn', 'auto', 'table', 'vector'].map(key => tones.get(`[data-hub-frame="${key}"]`)), ['ok', 'wait', 'wait', 'ok']);
    assert.equal(texts.get('#bakemono-memory-settings-hub-archive'), '自动 · 保留 3 楼');
});
