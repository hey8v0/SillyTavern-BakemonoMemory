import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTableEditOperations } from '../src/tables/operation-parser.js';
import { createTableMemoryModel } from '../src/features/table-memory-model.js';
import { ensureChronicle, captureChronicle } from '../src/memory/story-state.js';
import { getHash } from '../src/shared/text.js';
import * as text from '../src/shared/text.js';
import { createTableWorkflowController } from '../src/features/table-workflow-controller.js';
import { createTurnProcessingController } from '../src/features/turn-processing-controller.js';

function fixture() {
    const state = { tableDatabase: { schemaScope: 'chat', activeProfileId: 'p', profileRows: {}, chatProfiles: [], editDrafts: [],
        tables: [{ id: 't', tableIndex: 0, name: '成员', columns: ['名称', '状态'], rows: [], allowAiEdit: true }] },
        storySummaries: [], stageSummaries: [], epicSummaries: [], drafts: [], coveredBlockHashes: [], coveredStageHashes: [] };
    ensureChronicle(state, []);
    captureChronicle(state, []);
    const calls = { undo: 0, save: 0, inject: 0 };
    const model = createTableMemoryModel({ getState: () => state, getFiniteMessageIds: x => x,
        getHash, getSourceMessageIdsFromBlocks: () => [1], parseTableEditOperations,
        pushTableUndoSnapshot: () => { calls.undo++; return { id: 'u' }; }, normalizeTableText: String,
        saveCurrentTableProfileRows: () => calls.save++, updateInjectionFromSummaries: () => calls.inject++ });
    return { state, calls, model };
}

test('yearless clock preserves date as label and does not block table transaction', () => {
    const { state, calls, model } = fixture();
    const raw = '<tableEdit>setStoryClock({"date":"11月14日","label":"深夜 23:45","flashback":false})\nsetColumnKind(0,0,"person")\ninsertRow(0,{"0":"林舟","1":"值班"})</tableEdit>';
    const draft = model.createTableEditDraft(raw, [], state);
    const before = JSON.stringify(state);
    const feedback = model.inspectTableEditDraft(draft, state);
    assert.equal(feedback.error, '');
    assert.match(feedback.warnings.join(' '), /未提供年份/);
    assert.equal(JSON.stringify(state), before, 'preflight must not mutate state');
    assert.deepEqual(calls, { undo: 0, save: 0, inject: 0 });
    model.applyTableOperations(draft.operations, state, { raw: draft.raw });
    assert.equal(state.chronicle.clock.date, '');
    assert.equal(state.chronicle.clock.label, '11月14日 深夜 23:45');
    assert.equal(state.chronicle.clock.precision, 'approximate');
    assert.deepEqual(state.tableDatabase.tables[0].rows, [['林舟', '值班']]);
    assert.equal(draft.raw, raw);
    assert.deepEqual(calls, { undo: 1, save: 1, inject: 1 });
});

test('clock accepts unambiguous complete formatting, but never invents a year', () => {
    const { state, model } = fixture();
    for (const date of ['2024年2月29日', '2024/2/29', '2024-2-29']) {
        model.applyTableOperations([{ op: 'clock', data: { date } }], state);
        assert.equal(state.chronicle.clock.date, '2024-02-29');
    }
    model.applyTableOperations([{ op: 'clock', data: { date: '11月14日', flashback: true } }], state);
    assert.equal(state.chronicle.clock.date, '2024-02-29');
    assert.equal(state.chronicle.clock.lastFlashback.label, '11月14日');
    model.applyTableOperations([{ op: 'clock', data: { date: '11月14日' } }], state);
    assert.equal(state.chronicle.clock.date, '');
});

test('invalid dates, ambiguous clock and invalid fields stay atomic with actionable errors', () => {
    const { state, calls, model } = fixture();
    for (const [operation, expected] of [
        [{ op: 'clock', data: { date: '2026-02-30' } }, /setStoryClock.*日期/],
        [{ op: 'clock', data: { date: '11月99日' } }, /setStoryClock.*日期/],
        [{ op: 'clock', data: { date: '11月14日', relativeDays: 1 } }, /setStoryClock.*同时/],
        [{ op: 'insert', tableIndex: 0, data: { 3: '值班' } }, /insertRow.*表格 #0.*第 3 列/],
        [{ op: 'insert', tableIndex: 0, data: { '01': '值班' } }, /insertRow.*第 01 列/],
        [{ op: 'insert', tableIndex: 0, data: ['值班'] }, /insertRow.*对象/],
        [{ op: 'insert', tableIndex: 0, data: { 0: { name: '林舟' } } }, /insertRow.*第 0 列.*文本/],
        [{ op: 'update', tableIndex: 0, rowIndex: 99, data: { 0: '林舟' } }, /updateRow.*第 99 行/],
    ]) {
        const before = JSON.stringify(state);
        assert.throws(() => model.applyTableOperations([{ op: 'insert', tableIndex: 0, data: { 0: '林舟' } }, operation], state), expected);
        assert.equal(JSON.stringify(state), before);
    }
    assert.deepEqual(calls, { undo: 0, save: 0, inject: 0 });
    state.tableDatabase.tables[0].readOnly = true;
    assert.throws(() => model.applyTableOperations([{ op: 'insert', tableIndex: 0, data: { 0: '林舟' } }], state), /只读/);
});

test('parser accepts safe quote/key/trailing comma variants without altering cell strings', () => {
    assert.equal(parseTableEditOperations('insertRow(0,{"0":"林舟" "1":"值班"})')[0].data[1], '值班');
    const ops = parseTableEditOperations(`<tableEdit>\n<!--\n// example comment\nsetStoryClock({date: '11月14日', label: '深夜',})\nsetColumnKind(0, 0, 'person')\ninsertRow(0, {0: '林舟', 1: "保留 insertRow(0, {}) 和 {0: x}，还有 -->",})\n-->\n</tableEdit>`);
    assert.equal(ops.length, 3);
    assert.equal(ops.find(op => op.op === 'insert').data[1], '保留 insertRow(0, {}) 和 {0: x}，还有 -->');
    assert.equal(ops.find(op => op.op === 'clock').data.label, '深夜');
});

test('malformed and unknown instructions are not silently dropped or executed', () => {
    for (const raw of [
        'insertRow(0,{"0":"林舟"})\nupdateRow(0,nope,{"1":"休息"})',
        'insertRow(0,{"0":"林舟"})\ndeleteRow(0,)',
        'insertRow(0,{"0":"林舟"}',
        'insertRow(0,{"0":"林舟"})\nreplaceRow(0,{"0":"夏明"})',
        'setColumnKind(0,0,"dragon")',
    ]) assert.throws(() => parseTableEditOperations(`<tableEdit>${raw}</tableEdit>`), /第 \d+ 行.*(?:Row|Kind)/);
    assert.deepEqual(parseTableEditOperations('<tableEdit>\n// 无修改\n</tableEdit>'), []);
});

test('all tableEdit blocks are validated, including a truncated final block', () => {
    const first = '<tableEdit>insertRow(0,{"0":"林舟"})</tableEdit>';
    assert.equal(parseTableEditOperations(first + '<tableEdit>setColumnKind(0,0,"person")</tableEdit>').length, 2);
    assert.throws(() => parseTableEditOperations(first + '<tableEdit>deleteRow(0,nope)</tableEdit>'), /deleteRow/);
    assert.throws(() => parseTableEditOperations(first + '<tableEdit>deleteRow(0,'), /不完整/);
});

test('invalid generated drafts preserve raw text and cannot apply an empty fallback', () => {
    const { state, model, calls } = fixture();
    const raw = '<tableEdit>insertRow(0, {"0":"林舟"})\nupdateRow(0, nope, {"1":"休息"})</tableEdit>';
    const draft = model.createTableEditDraft(raw, [], state);
    assert.equal(draft.raw, raw);
    assert.equal(state.tableDatabase.editDrafts[0], draft);
    assert.match(model.inspectTableEditDraft(draft, state).error, /updateRow/);
    assert.throws(() => model.applyTableOperations(draft.operations, state, { raw }), /updateRow/);
    assert.deepEqual(state.tableDatabase.tables[0].rows, []);
    assert.deepEqual(calls, { undo: 0, save: 0, inject: 0 });
    draft.raw = '<tableEdit>insertRow(0,{"0":"林舟"})</tableEdit>';
    assert.equal(model.inspectTableEditDraft(draft, state).error, '');
});

for (const raw of ['<tableEdit>insertRow(0,{"0":"林舟"})\nsetStoryClock({"date":"11月14日","label":"深夜"})</tableEdit>',
    '<tableEdit>insertRow(0,{"0":"林舟"})\nsetStoryClock({"date":"2026-02-30"})</tableEdit>',
    '<tableEdit>insertRow(0,{"0":"林舟"})\ndeleteRow(0,nope)</tableEdit>']) {
    const valid = raw.includes('11月14日');
    for (const inline of [true, false]) test(`${inline ? 'inline' : 'independent'} table flow ${valid ? 'applies' : 'retains failed draft'}: ${raw.slice(-45)}`, async () => {
        const { state, model } = fixture();
        state.turnSummary = {};
        state.inlineGeneration = { tableEnabled: true, summaryEnabled: false, hideTableEdit: false };
        state.tableDatabase.autoApply = true;
        state.tableDatabase.history = [];
        const chat = [{ mes: '开始值班。' + raw }];
        let saved = 0, rendered = 0;
        const warnings = [];
        const deps = { ...text, getState: () => state, ensureState: () => state, getContext: () => ({ chat }), getChat: () => chat,
            stripPostProcessNoise: String,
            blockTypes: { STORY: 'story' }, createTableEditDraft: model.createTableEditDraft, applyTableOperations: model.applyTableOperations,
            getAppliedTableHistoriesForMessage: () => [], updateInjectionFromSummaries() {}, formatSourceRange: String,
            saveState() {}, saveChatConditional: async () => { saved++; },
            scheduleRenderAll: () => rendered++, renderWorkbenchScope: () => rendered++, workbenchRenderScopes: { TABLES: 'tables' },
            toastr: { success() {}, info() {}, warning: message => warnings.push(message) },
        };
        if (inline) {
            const controller = createTurnProcessingController(deps);
            assert.equal(await controller.captureInlineGenerationFromLatestMessage(), true);
            await controller.captureInlineGenerationFromLatestMessage();
        } else {
            const controller = createTableWorkflowController({ ...deps,
                findLatestAssistantTurn: () => ({ assistantMessage: { messageId: 0 } }), buildLatestTurnBlocks: () => [{ content: chat[0].mes }],
                runGeneration: async (_label, fn) => fn(), callGenerationModel: async () => raw,
                buildTableEditPrompt: () => '', buildTurnReferenceSystemPrompt: () => '', switchWorkbenchTab() {} });
            if (valid) await controller.processLatestTableEdit();
            else await assert.rejects(controller.processLatestTableEdit(), /setStoryClock|deleteRow/);
        }
        assert.ok(saved >= 1, 'save retained drafts even when automatic application fails');
        assert.ok(rendered >= 1);
        assert.equal(state.tableDatabase.tables[0].rows.length, valid ? 1 : 0);
        assert.equal(state.tableDatabase.history.length, valid ? 1 : 0);
        assert.equal(state.tableDatabase.editDrafts.length, valid ? 0 : 1);
        if (!valid) assert.equal(state.tableDatabase.editDrafts[0].raw, inline ? chat[0].mes : raw);
    });
}
