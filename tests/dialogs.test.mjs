import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmButtonLabel } from '../src/ui/dialogs.js';
import { createSummaryGenerationController } from '../src/features/summary-generation-controller.js';
import { selectGenerationTargets, partitionGenerationTargets } from '../src/summary/target-selection.js';

test('the confirm button says what happens', () => {
    assert.equal(confirmButtonLabel('删除配置「硅基流动」？'), '删除');
    assert.equal(confirmButtonLabel('清空全部表格？'), '清空');
    assert.equal(confirmButtonLabel('使用配置「通用正文压缩」？'), '使用');
    assert.equal(confirmButtonLabel('生成【阶段总结】草稿？', '确认生成吗？'), '生成');
    assert.equal(confirmButtonLabel('阶段材料中间存在记忆缺口，仍要继续吗？'), '继续');
});

// Stage generation from the panel: the panel is told what a selection sends, and once it was confirmed there,
// neither the gap question nor the material question is asked again.
function stageFixture() {
    const blocks = [3, 5, 9].map(id => ({ hash: 'h' + id, type: 'story', messageId: id, sourceMessageIds: [id],
        content: `<bakemono>第 ${id} 楼：旅人和莉娜说话，约定天亮前还钥匙。</bakemono>` }));
    const state = { generationTargets: { stage: { mode: 'all', count: 20 } }, generationPrompts: { stage: '{{blocks}}' },
        storySummaries: [], stageSummaries: [], epicSummaries: [], blocks, taskQueue: [], drafts: [] };
    const asked = [], queued = [];
    let described = null;
    const controller = createSummaryGenerationController({
        getIsBusy: () => false, scanBlocks() {}, getState: () => state,
        getUnsummarizedStoryBlocks: () => blocks, readGenerationTargetSettings() {},
        promptGenerationTargetSelection: async (kind, total, options) => {
            described = options.describe({ mode: 'all', batch: false });
            return { mode: 'all', batch: false, count: 20, reviewed: true };
        },
        selectGenerationTargets, partitionGenerationTargets,
        // floor 7 has no summary between 5 and 9
        findTargetContinuityGaps: () => [{ id: 7 }], getFloorMemoryIndex: () => ({ records: [] }),
        confirmGenerationTargets: async () => { asked.push('material'); return true; },
        confirmDanger: async title => { asked.push(title); return true; },
        getTargetSelectionLabel: () => 'all', getStageSourceMode: () => 'summaries',
        renderGenerationPrompt: (_, list) => list.map(block => block.content).join('\n'),
        getSourceMessageIdsFromBlocks: list => list.flatMap(block => block.sourceMessageIds),
        formatSourceRange: ids => `楼层 ${Math.min(...ids)}-${Math.max(...ids)}`,
        getSourceStart: ids => Math.min(...ids), getSourceEnd: ids => Math.max(...ids),
        enqueueSummaryTask: task => { queued.push(task); return task; },
        blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' }, defaultGenerationTargets: { stage: { count: 20 } },
        renderWorkbenchScope() {}, workbenchRenderScopes: {}, toastr: { info() {}, warning() {}, success() {} },
    });
    return { controller, asked, queued, described: () => described };
}

test('a selection confirmed in the generation panel is not asked about again', async () => {
    const f = stageFixture();
    await f.controller.generateStageDraft();
    const info = f.described();
    assert.equal(info.count, 3);
    assert.equal(info.range, '楼层 3-9');
    assert.deepEqual(info.gaps, [7], 'the panel shows the floor without a summary');
    assert.equal(info.requests, 1);
    assert.equal(info.samples.length, 2);
    assert.doesNotMatch(info.samples[0].text, /<bakemono>/, 'material starts are shown without tags');
    assert.deepEqual(f.asked, [], 'no gap or material question after the panel');
    assert.equal(f.queued.length, 1);
});

test('every confirm is awaited: the dialog does not block the page the way confirm() did', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const walk = async dir => (await readdir(dir, { withFileTypes: true })).flatMap(entry => entry.isDirectory() ? [] : [join(dir, entry.name)]);
    const dirs = ['src/features', 'src/ui', 'src/core', 'src/rp-core'].map(dir => new URL('../' + dir + '/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const files = [new URL('../index.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...(await Promise.all(dirs.map(walk))).flat()].filter(file => file.endsWith('.js'));
    const missing = [];
    for (const file of files) {
        // Comments may mention confirm(); only code counts.
        const source = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
        for (const match of source.matchAll(/(?<![\w.])(confirmDanger|confirm)\(/g)) {
            const before = source.slice(Math.max(0, match.index - 12), match.index);
            if (/await\s+$|function\s+$|return\s+$/.test(before)) continue;
            missing.push(file.split(/[\/]/).slice(-2).join('/') + ': ' + source.slice(match.index, match.index + 50).replace(/\s+/g, ' '));
        }
    }
    assert.deepEqual(missing, []);
    assert.doesNotMatch(await readFile(files[0], 'utf8'), /window\.confirm\(/);
});

// User report (v1.38.0): nine chapters, the first five already in one 多次总结. The panel's header said 4 条材料
// (what is sent), but “阶段总结 9 条” and “全部没整理的 9 条” counted the covered five as well.
test('the epic panel counts only what the selection would use: covered chapters only with 重新整理', async () => {
    const stages = Array.from({ length: 9 }, (_, i) => ({ hash: 'st' + i, id: 'st' + i, type: 'stage', title: `第 ${i + 1} 章`,
        sourceMessageIds: [i * 20 + 2, i * 20 + 20], content: `<bakemono>第 ${i + 1} 章：旅人和莉娜赶路。</bakemono>` }));
    const state = { generationTargets: { epic: { mode: 'all', count: 5 } }, generationPrompts: { epic: '{{blocks}}' },
        storySummaries: [], stageSummaries: stages, blocks: [], taskQueue: [], drafts: [],
        epicSummaries: [{ hash: 'ep1', id: 'ep1', type: 'epic', content: '<bakemono>第一卷</bakemono>', sourceStageHashes: stages.slice(0, 5).map(s => s.hash), sourceHashes: [] }] };
    let seen = null;
    const controller = createSummaryGenerationController({
        getIsBusy: () => false, scanBlocks() {}, getState: () => state, readGenerationTargetSettings() {},
        getUnsummarizedStageBlocks: () => stages, getUnsummarizedMultiSummaryBlocks: () => state.epicSummaries,
        promptGenerationTargetSelection: async (kind, total, options) => { seen = options; return null; },
        selectGenerationTargets, partitionGenerationTargets, getMultiSummaryLabel: () => '多次总结',
        getSourceMessageIdsFromBlocks: list => list.flatMap(block => block.sourceMessageIds),
        formatSourceRange: ids => `${Math.min(...ids)}-${Math.max(...ids)}`, getSourceStart: ids => Math.min(...ids), getSourceEnd: ids => Math.max(...ids),
        renderGenerationPrompt: (_, list) => list.map(block => block.content).join('\n'),
        blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' }, defaultGenerationTargets: { epic: { count: 5 } },
        renderWorkbenchScope() {}, workbenchRenderScopes: {}, toastr: { info() {}, warning() {}, success() {} },
    });
    await controller.generateEpicDraft();
    assert.equal(typeof seen.sourceCounts, 'function', 'counts follow the 重新整理 / 有效材料 switches');
    assert.deepEqual(seen.sourceCounts({ mode: 'all' }), { stage: 4, epic: 1 });
    assert.deepEqual(seen.sourceCounts({ mode: 'all', includeCovered: true }), { stage: 9, epic: 1 });
    assert.equal(seen.describe({ mode: 'all', sourceMode: 'stage', batch: false }).count, 4, 'the header agrees');
});
