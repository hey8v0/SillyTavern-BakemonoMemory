import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../', import.meta.url);

function toDataModule(source) {
    return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function loadModule(path, replacements = []) {
    let source = await readFile(new URL(path, repoUrl), 'utf8');
    for (const [from, to] of replacements) {
        source = source.replace(from, to);
    }
    return await import(toDataModule(source));
}

test('table rollback planner cascades newer transactions without mutating the stack', async () => {
    const { buildTableRollbackPlan } = await loadModule('src/tables/rollback-plan.js');
    const stack = [
        { id: 'newest', profileKey: 'chat:a', sourceMessageIds: [30], tables: [{ rows: [['before-30']] }] },
        { id: 'affected', profileKey: 'chat:a', sourceMessageIds: [20], tables: [{ rows: [['before-20']] }] },
        { id: 'oldest', profileKey: 'chat:a', sourceMessageIds: [10], tables: [{ rows: [['before-10']] }] },
        { id: 'other-profile', profileKey: 'chat:b', sourceMessageIds: [20], tables: [{ rows: [['other']] }] },
    ];

    const plan = buildTableRollbackPlan(stack, [20], 'chat:a');

    assert.deepEqual(plan.rollbackSnapshotIds, ['newest', 'affected']);
    assert.deepEqual(plan.affectedSnapshotIds, ['affected']);
    assert.deepEqual(plan.cascadedSnapshotIds, ['newest']);
    assert.deepEqual(plan.cascadedSourceMessageIds, [30]);
    assert.equal(plan.restoreSnapshot.id, 'affected');
    assert.equal(stack.length, 4);
    assert.equal(buildTableRollbackPlan(stack, [999], 'chat:a'), null);
});

test('summary target selection sorts, filters ranges and partitions deterministically', async () => {
    const metadataSource = await readFile(new URL('src/summary/source-metadata.js', repoUrl), 'utf8');
    const metadataUrl = toDataModule(metadataSource);
    const targetSelection = await loadModule('src/summary/target-selection.js', [
        ["'./source-metadata.js'", `'${metadataUrl}'`],
    ]);
    const blocks = [
        { hash: 'late', messageId: 30, blockIndex: 0 },
        { hash: 'source-only', messageId: Number.MAX_SAFE_INTEGER, sourceMessageIds: [14, 12], blockIndex: 1 },
        { hash: 'early', messageId: 5, blockIndex: 2 },
    ];

    const parsed = targetSelection.parseLooseNumberRange('7-5, 11，nope');
    assert.deepEqual([...parsed.ids], [5, 6, 7, 11]);
    assert.deepEqual(parsed.invalid, ['nope']);

    assert.deepEqual(
        targetSelection.selectGenerationTargets(blocks).map(block => block.hash),
        ['early', 'source-only', 'late'],
    );
    assert.deepEqual(
        targetSelection.selectGenerationTargets(blocks, { mode: 'oldest', count: 2 }).map(block => block.hash),
        ['early', 'source-only'],
    );
    assert.deepEqual(
        targetSelection.selectGenerationTargets(blocks, { mode: 'range', range: '14, 30' }).map(block => block.hash),
        ['source-only', 'late'],
    );
    assert.deepEqual(
        targetSelection.partitionGenerationTargets(blocks, 'stage', { mode: 'all', count: 2 })
            .map(batch => batch.map(block => block.hash)),
        [['early', 'source-only'], ['late']],
    );
    assert.deepEqual(
        targetSelection.partitionGenerationTargets(blocks, 'stage', { mode: 'oldest', count: 2 })
            .map(batch => batch.map(block => block.hash)),
        [['early', 'source-only']],
    );
});

test('floor memory index derives status without mutating chat state and plans enabled tools only', async () => {
    const textSource = await readFile(new URL('src/shared/text.js', repoUrl), 'utf8');
    const textUrl = toDataModule(textSource);
    const floorModule = await loadModule('src/memory/floor-memory-index.js', [
        ["'../shared/text.js'", `'${textUrl}'`],
    ]);
    const messages = [
        { is_user: true, mes: '继续' },
        { is_user: false, mes: '<bakemono>第一段摘要</bakemono>' },
        { is_user: false, mes: '第二段正文' },
    ];
    const state = {
        blocks: [{ hash: 'story-1', type: 'story', messageId: 1, sourceKind: 'tag' }],
        storySummaries: [], stageSummaries: [], epicSummaries: [], coveredBlockHashes: [], coveredStageHashes: [],
        drafts: [], taskQueue: [], hiddenMessageIds: [], customHiddenMessageIds: [],
        tableDatabase: { enabled: true, tables: [{ name: '角色' }], editDrafts: [], history: [] },
        vectorMemory: { enabled: true, dirty: true, autoIndex: true, records: [] },
        turnSummary: { auto: true, enabled: true, processingMode: 'both', lastProcessedMessageId: null },
        inlineGeneration: { summaryEnabled: false, tableEnabled: false },
        automation: { enabled: true },
        autoHideRecent: { enabled: false, managedMessageIds: [] },
        workflowMode: 'bakemono',
    };
    const snapshot = structuredClone(state);
    const index = floorModule.buildFloorMemoryIndex({ messages, state });
    const plan = floorModule.createMemoryOrchestrationPlan(index, state);

    assert.equal(index.aggregates.total, 2);
    assert.equal(index.byId.get(1).summaryState, 'saved');
    assert.equal(index.byId.get(2).summaryState, 'missing');
    assert.equal(plan.actions.processLatestTurn, true);
    assert.equal(plan.actions.refreshVectorIndex, true);
    assert.deepEqual(state, snapshot);
});

test('built-in story ledger excludes duplicate summary tables and keeps guidance read-only', async () => {
    const { baseStoryLedgerPreset, createBaseStoryLedgerTables } = await loadModule('src/tables/builtin-presets.js');
    const tables = createBaseStoryLedgerTables();
    assert.equal(baseStoryLedgerPreset.name, '基础表格');
    assert.deepEqual(tables.map(table => table.name), ['角色特征表格', '人物关系表格', '世界设定表格', '重要物品表格', '约定表格', '剧情指导']);
    assert.equal(tables.some(table => /事件摘要|大总结/.test(table.name)), false);
    assert.equal(tables.at(-1).readOnly, true);
    assert.equal(tables.at(-1).allowAiEdit, false);
});
