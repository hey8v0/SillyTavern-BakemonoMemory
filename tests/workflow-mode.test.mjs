import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../', import.meta.url);

function toDataModule(source) {
    return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function loadModule(path) {
    const source = await readFile(new URL(path, repoUrl), 'utf8');
    return await import(toDataModule(source));
}

test('workflow normalization preserves every valid mode and the state identity', async () => {
    const workflow = await loadModule('src/core/workflow-mode.js');
    const state = {
        memoryStrategy: workflow.memoryStrategies.BAKEMONO,
        workflowMode: workflow.workflowModes.MIXED,
        stageSourceMode: workflow.stageSourceModes.AUTO,
        outputMode: workflow.outputModes.CUSTOM,
    };

    const result = workflow.normalizeWorkflowState(state);

    assert.equal(result, state);
    assert.deepEqual(state, {
        memoryStrategy: 'bakemono',
        workflowMode: 'mixed',
        stageSourceMode: 'auto',
        outputMode: 'custom',
    });
});

test('workflow normalization derives generic fallbacks in the original dependency order', async () => {
    const workflow = await loadModule('src/core/workflow-mode.js');
    const state = {
        memoryStrategy: 'generic',
        workflowMode: 'invalid',
        stageSourceMode: null,
        outputMode: '',
    };

    workflow.normalizeWorkflowState(state);

    assert.deepEqual(state, {
        memoryStrategy: 'generic',
        workflowMode: 'generic',
        stageSourceMode: 'backfill',
        outputMode: 'plain',
    });
});

test('workflow normalization keeps valid downstream choices while repairing invalid fields independently', async () => {
    const workflow = await loadModule('src/core/workflow-mode.js');
    const state = {
        memoryStrategy: 'invalid',
        workflowMode: 'generic',
        stageSourceMode: 'raw',
        outputMode: 'custom',
    };

    workflow.normalizeWorkflowState(state);

    assert.deepEqual(state, {
        memoryStrategy: 'bakemono',
        workflowMode: 'generic',
        stageSourceMode: 'raw',
        outputMode: 'custom',
    });
});
