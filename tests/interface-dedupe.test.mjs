import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSummaryGenerationUi } from '../src/features/summary-generation-ui.js';
import { createWorkbenchActionController } from '../src/features/workbench-action-controller.js';
import { createWorkbenchHeaderUi } from '../src/features/workbench-header-ui.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the sticky save bar is the only save control on settings pages', async () => {
    const html = await read('settings.html');
    for (const id of ['apply-rules', 'apply-automation', 'apply-generation-api', 'apply-prompts', 'apply-injection', 'apply-turn-settings']) {
        assert.doesNotMatch(html, new RegExp(`id="bakemono-memory-${id}"`), id);
    }
    assert.doesNotMatch(html, /data-bakemono-action="vector-apply"/);
    assert.match(html, /id="bakemono-memory-page-save"/);
    assert.doesNotMatch(await read('src/ui/page-settings.js'), /\bsave: '/);
});

test('the memory body is read-only and has no no-op clear button', async () => {
    const html = await read('settings.html');
    assert.match(html, /id="bakemono-memory-source-content"[^>]*\breadonly\b/);
    assert.doesNotMatch(html, /id="bakemono-memory-clear-injection"/);
});

test('record filter chips carry their counts instead of a duplicate stat strip', async () => {
    const html = await read('settings.html');
    assert.match(html, /data-bakemono-record-status="all">全部 <strong id="bakemono-memory-record-stat-total">/);
    assert.match(html, /data-bakemono-record-status="injected">已选入 <strong id="bakemono-memory-record-stat-injected">/);
    assert.doesNotMatch(html, /bakemono-memory-record-stat-strip/);
});

function summaryCardFixture({ totalCount = 0, story = [], stage = [], epic = [] } = {}) {
    const button = () => ({ hidden: false, disabled: false, dataset: {}, querySelector: () => null });
    const primary = button(), batch = button();
    const text = {};
    const query = selector => ({ text(value) { text[selector] = value; return this; }, css() { return this; } });
    const ui = createSummaryGenerationUi({
        documentRef: {
            getElementById: id => ({ 'bakemono-memory-summary-primary-action': primary, 'bakemono-memory-summary-batch-action': batch })[id] || null,
            querySelectorAll: () => [], querySelector: () => null,
        },
        query, getState: () => ({ automation: {} }), getStageSourceModeLabel: () => '读取已有摘要',
        getStageMaterialOverview: () => ({ totalCount, coveredCount: 0, targets: new Array(totalCount).fill({}), invalid: [] }),
    });
    const render = mode => { ui.setMode(mode); ui.render({ automation: {} }, { story, stage, epic }); };
    return { primary, batch, text, render };
}

test('summary card has one generate action and disables it without material', () => {
    const empty = summaryCardFixture();
    empty.render('stage');
    assert.equal(empty.primary.disabled, true);
    assert.match(empty.text['#bakemono-memory-summary-generation-description'], /还没有剧情摘要/);

    const ready = summaryCardFixture({ totalCount: 3, story: [{}, {}, {}] });
    ready.render('stage');
    assert.deepEqual([ready.primary.disabled, ready.primary.dataset.bakemonoAction], [false, 'generate-stage']);
    ready.render('epic');
    assert.equal(ready.primary.dataset.bakemonoAction, 'generate-epic');
    assert.equal(ready.primary.disabled, false, 'story summaries are valid fallback material for multi summaries');
    ready.render('batch');
    assert.equal(ready.primary.hidden, true);
});

test('single or batch generation is chosen inside the range dialog', async () => {
    assert.doesNotMatch(await read('settings.html'), /bakemono-memory-summary-batch-action/);
    assert.match(await read('src/features/summary-target-controller.js'), /data-bakemono-target-output[\s\S]*?<option value="batch">分批生成/);
    const generation = await read('src/features/summary-generation-controller.js');
    assert.match(generation, /if \(targetConfig\.batch\) return generateStageBatchTasks\(\{ targetConfig \}\);/);
    assert.match(generation, /if \(!targetConfig\.batch\) return generateStageDraft\(\{ targetConfig \}\);/);
    assert.match(generation, /if \(targetConfig\.batch\) return generateEpicBatchTasks\(\{ targetConfig \}\);/);
    assert.match(generation, /if \(!targetConfig\.batch\) return generateEpicDraft\(\{ targetConfig \}\);/);
});

test('generate actions start the chosen generator without an extra mode popup', async () => {
    const calls = [];
    const record = name => async () => { calls.push(name); };
    const controller = createWorkbenchActionController({
        generateStageDraft: record('stage'), generateStageBatchTasks: record('stage-batch'),
        generateEpicDraft: record('epic'), generateEpicBatchTasks: record('epic-batch'),
    });
    for (const action of ['generate-stage', 'generate-stage-batch', 'generate-epic', 'generate-epic-batch']) await controller.run(action);
    assert.deepEqual(calls, ['stage', 'stage-batch', 'epic', 'epic-batch']);
    assert.doesNotMatch(await read('src/features/summary-target-controller.js'), /promptGenerationModeSelection/);
});

test('header badge states what is injected in plain words', () => {
    const status = (enabled, content) => createWorkbenchHeaderUi({ documentRef: {}, getState: () => ({ injection: { enabled } }),
        renderInjectionContent: () => content }).getInjectionStatus().short;
    assert.equal(status(false, 'x'), '注入已关');
    assert.equal(status(true, ''), '无可注入');
    assert.equal(status(true, 'x'.repeat(1367)), '注入 1,367字');
    assert.equal(status(true, 'x'.repeat(23456)), '注入 2.3万字');
});

test('status wording separates summaries from RP state and names what each RP button does', async () => {
    assert.match(await read('src/features/workflow-overview-model.js'), /title: '尚未建立摘要记忆'/);
    assert.match(await read('src/features/hub-automation-ui.js'), /楼尚无摘要/);
    const rp = await read('src/features/rp-state-ui.js');
    assert.match(rp, /button\('capture', '读取最新回复'\)/);
    assert.match(rp, /条变化没记上/);
    assert.match(rp, /progress\.latest/);
    assert.match(rp, /button\("extract", "用模型重新提取"\)/);
    assert.doesNotMatch(rp, /button\(['"](?:capture|extract)['"], ['"](?:检查最新正文|重新提取最新正文|处理最新正文)/);
});
