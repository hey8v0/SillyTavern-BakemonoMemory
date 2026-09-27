import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySummaryLine, parseSummaryHeader, splitSummarySections } from '../src/features/summary-preview-renderer.js';
import { createSummaryGenerationUi } from '../src/features/summary-generation-ui.js';

const story = `【☆『第4章：北境地图』★时间：深夜★铁匠铺|旅人、格伦☆】

➤ 🎬 【场记打板】
- 格伦把北境地图摊在铁砧上。
➤ 🎙️ 【高光收音】
> “这条路三年前就没人走了。” —— [格伦]
➤ 🌍 【副镜监视器】
无
➤ 🪢 【剧本暗线】
[未回收伏笔]：地图上的炭笔圈
[✅ 本回合回收]：无
➤ 💡 【第四面墙】
*格伦认得那道炭笔印。*`;

test('a story summary splits into the sections its prompt asks for', () => {
    const { intro, sections } = splitSummarySections(story);
    assert.deepEqual(sections.map(section => section.name), ['场记打板', '高光收音', '副镜监视器', '剧本暗线', '第四面墙']);
    assert.deepEqual(parseSummaryHeader(intro[0]), { title: '第4章：北境地图', bits: ['时间：深夜', '铁匠铺|旅人、格伦'] });
    assert.deepEqual(parseSummaryHeader('【👑『第3章：钟楼下的交易』★ 跨度：第121至150楼 ★ 时间跨度：10月14日深夜-15日清晨 ☆】').bits,
        ['跨度：第121至150楼', '时间跨度：10月14日深夜-15日清晨']);
});

test('leading marks decide how a summary line is drawn', () => {
    assert.deepEqual(classifySummaryLine('- 格伦把地图摊开。'), { kind: 'item', text: '格伦把地图摊开。' });
    assert.deepEqual(classifySummaryLine('> “走吧。” —— [格伦]'), { kind: 'quote', text: '“走吧。”', who: '格伦' });
    assert.deepEqual(classifySummaryLine('1. > “台词”——【格伦】'), { kind: 'quote', text: '“台词”', who: '格伦' });
    assert.deepEqual(classifySummaryLine('[未回收伏笔]：炭笔圈'), { kind: 'label', key: '未回收伏笔', text: '炭笔圈' });
    assert.deepEqual(classifySummaryLine('* 信：内容不明。'), { kind: 'label', key: '信', text: '内容不明。' });
    assert.deepEqual(classifySummaryLine('*隐藏信息*'), { kind: 'aside', text: '隐藏信息' });
    assert.deepEqual(classifySummaryLine('- [谈价] (121–132 楼 | 深夜 | 铁匠铺)'), { kind: 'event', text: '谈价', meta: '121–132 楼 | 深夜 | 铁匠铺' });
    assert.deepEqual(classifySummaryLine('  - 经过：旅人答应送信。', true), { kind: 'detail', key: '经过', text: '旅人答应送信。' });
    assert.equal(classifySummaryLine('  - 经过：旅人答应送信。', false).kind, 'item');
    assert.equal(classifySummaryLine('普通的一句话。').kind, 'text');
});

test('each level of the summary page has its own next step', () => {
    const text = {};
    const primary = { hidden: false, disabled: false, dataset: {}, querySelector: () => null };
    const ui = createSummaryGenerationUi({
        documentRef: { getElementById: id => id === 'bakemono-memory-summary-primary-action' ? primary : null, querySelectorAll: () => [], querySelector: () => null },
        query: selector => ({ text(value) { text[selector] = value; return this; }, css() { return this; } }),
        getState: () => ({ automation: {} }),
        getStageSourceModeLabel: () => '读取已有摘要',
        getStageMaterialOverview: () => ({ totalCount: 5, coveredCount: 2, targets: [{ messageId: 7 }, { messageId: 11 }, { messageId: 13 }], invalid: [] }),
        getCurrentFloorMemoryIndex: () => ({ aggregates: { missing: 4, firstMissingFloor: 2 } }),
    });
    const blocks = { story: [{}, {}, {}, {}, {}], stage: [{}], epic: [] };
    ui.setMode('stage'); ui.render({ automation: {} }, blocks);
    assert.equal(text['#bakemono-memory-summary-generation-title'], '3 条剧情摘要还没整理成阶段总结');
    assert.match(text['#bakemono-memory-summary-generation-description'], /^第 7–13 楼/);
    assert.equal(text['#bakemono-memory-summary-generation-kicker'], '阶段总结 · 下一步');
    assert.equal(ui.setMode('story'), 'batch');
    ui.render();
    assert.equal(text['#bakemono-memory-summary-generation-title'], '有 4 楼还没有摘要');
    assert.equal(primary.dataset.bakemonoBatchToggle, '', '补写旧聊天 unfolds the form; its own button starts the work');
    assert.equal(primary.dataset.bakemonoAction, undefined);
    ui.setMode('epic'); ui.render();
    assert.equal(text['#bakemono-memory-summary-generation-title'], '1 条阶段总结可以串成一卷');
    assert.equal(primary.dataset.bakemonoAction, 'generate-epic');
});

test('the summary tree strip merges floors into runs by the highest level that holds them', async () => {
    const { coverageRuns } = await import('../src/features/summary-timeline-ui.js');
    const records = [[1, 'covered'], [3, 'covered'], [5, 'covered'], [7, 'saved'], [9, 'missing'], [11, 'missing']].map(([id, summaryState]) => ({ id, summaryState }));
    assert.deepEqual(coverageRuns(records, new Set([1, 3])), [
        { band: 'epic', from: 1, to: 3, count: 2 },
        { band: 'stage', from: 5, to: 5, count: 1 },
        { band: 'story', from: 7, to: 7, count: 1 },
        { band: 'missing', from: 9, to: 11, count: 2 },
    ]);
});
