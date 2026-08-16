import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../', import.meta.url);

function toDataModule(source) {
    return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function loadModule(path) {
    return import(toDataModule(await readFile(new URL(path, repoUrl), 'utf8')));
}

test('automatic memory applies its own assistant tag filters without dropping the user turn', async () => {
    const text = await loadModule('src/shared/text.js');
    const { createTurnProcessingController } = await loadModule('src/features/turn-processing-controller.js');
    const chat = [
        { is_user: true, mes: '请继续刚才的剧情' },
        { is_user: false, mes: '<正文>真正剧情</正文><小剧场>番外内容</小剧场><thinking>推理</thinking>' },
    ];
    const state = {
        scanRules: { excludeTags: 'thinking' },
        turnSummary: { includeUserMessage: true, includeTags: '正文', excludeTags: '小剧场' },
    };
    const controller = createTurnProcessingController({
        getContext: () => ({ chat }),
        getChat: () => chat,
        ensureState: () => state,
        getHash: text.getHash,
        blockTypes: { STORY: 'story' },
        stripPostProcessNoise: value => String(value || '').trim(),
        stripConfiguredTags: text.stripConfiguredTags,
        filterTextByConfiguredTags: text.filterTextByConfiguredTags,
        parseList: text.parseList,
    });

    const blocks = controller.buildLatestTurnBlocks(state);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].content, '请继续刚才的剧情');
    assert.equal(blocks[1].content, '<正文>真正剧情</正文>');

    state.turnSummary.includeTags = '不存在';
    assert.deepEqual(controller.buildLatestTurnBlocks(state), []);
});

test('shared table schemas retain current chat rows when global config is reapplied', async () => {
    const { createConfigurationController } = await loadModule('src/features/configuration-controller.js');
    const state = {
        generationPrompts: {},
        injection: {},
        automation: {},
        turnSummary: {},
        inlineGeneration: {},
        vectorMemory: {},
        tableDatabase: {
            enabled: true,
            injectMemory: true,
            autoApply: true,
            schemaScope: 'chat',
            tables: [{ id: 'people', tableIndex: 0, name: '人物', columns: ['姓名'], rows: [['阿青']] }],
            editDrafts: [],
            history: [],
        },
    };
    const controller = createConfigurationController({
        getState: () => state,
        defaultStoryGenerationPrompt: 'story',
        defaultMissingSummaryPrompt: 'missing',
        defaultStageGenerationPrompt: 'stage',
        defaultEpicGenerationPrompt: 'epic',
        defaultScanRules: {},
        defaultClassificationRules: {},
        defaultPreviewLayouts: {},
        defaultPromptPreset: { id: 'default' },
        defaultGenericPromptPreset: { id: 'generic' },
        memoryStrategies: { BAKEMONO: 'bakemono', GENERIC: 'generic' },
        workflowModes: { BAKEMONO: 'bakemono', GENERIC: 'generic' },
        stageSourceModes: { SUMMARIES: 'summaries', BACKFILL: 'backfill' },
        defaultGenerationTargets: {},
        defaultInjectionTemplate: '',
        defaultAutomation: {},
        defaultState: { turnSummary: { worldInfoMaxContext: 4096 }, inlineGeneration: {} },
        defaultTurnSummaryPrompt: '',
        defaultTableEditPrompt: '',
        turnProcessingModes: { BOTH: 'both' },
        defaultVectorMemory: {},
        tableSchemaScopes: { CHAT: 'chat' },
        normalizeImportedTablesFromJson: value => structuredClone(value.tables),
        findMatchingTable: (schema, tables) => tables.find(table => table.id === schema.id),
        mergeTableSchemaWithRows: (schema, current) => ({ ...schema, rows: structuredClone(current?.rows || []) }),
        setTableSchemaScope: () => {},
        scanBlocks: () => {},
        updateInjectionFromSummaries: () => {},
        saveState: () => {},
    });

    controller.applyPromptPresetToState({
        id: 'shared',
        tableDatabase: {
            enabled: true,
            injectMemory: true,
            autoApply: true,
            schemaScope: 'chat',
            tables: [{ id: 'people', tableIndex: 0, name: '人物', columns: ['姓名'], rows: [] }],
        },
    }, { state, silent: true, skipScan: true, skipSave: true, skipVectorSchedule: true });

    assert.deepEqual(state.tableDatabase.tables[0].rows, [['阿青']]);
});

test('changing the vector enable switch persists globally and requests an immediate chat save', async () => {
    const { createVectorActionsController } = await loadModule('src/features/vector-actions-controller.js');
    let changeHandler = null;
    let persisted = 0;
    let saved = 0;
    const state = { vectorMemory: { enabled: false, records: [], lastHits: [] } };
    const query = () => ({
        off() { return this; },
        on(_event, handler) { changeHandler = handler; return this; },
    });
    const controller = createVectorActionsController({
        query,
        getState: () => state,
        readVectorMemoryFieldsFromUi(current) { current.vectorMemory.enabled = true; },
        persistSharedConfigurationFromState() { persisted += 1; },
        markVectorIndexDirty() {},
        saveChatConditional: async () => { saved += 1; },
        syncInjection() {},
        renderWorkbenchScope() {},
        workbenchRenderScopes: { VECTOR: 'vector' },
        toastr: { error() {} },
    });

    controller.bind();
    await changeHandler();
    assert.equal(persisted, 1);
    assert.equal(saved, 1);
    assert.equal(state.vectorMemory.enabled, true);
});
