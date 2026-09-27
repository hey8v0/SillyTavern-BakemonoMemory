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
