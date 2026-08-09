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
