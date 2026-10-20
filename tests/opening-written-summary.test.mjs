import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/summary-runtime.mjs';
import { createSummaryBackfillController } from '../src/features/summary-backfill-controller.js';
import { createContentBlockService } from '../src/features/content-block-service.js';
import { buildFloorMemoryIndex } from '../src/memory/floor-memory-index.js';
import { openingFloors } from '../src/shared/opening.js';
import * as text from '../src/shared/text.js';
import * as meta from '../src/summary/source-metadata.js';
import { unique } from '../src/shared/collections.js';
import { stripPostProcessNoise } from '../src/shared/prompt-utils.js';

const noop = () => {};
const own = i => `<details><summary>🌀摘要</summary>甲在第 ${i} 楼找到旧信。</details>`;
const written = '<bakemono>\n<details>\n<summary>📋 剧情摘要</summary>\n【☆『第0楼：初遇』★】\n➤ 🎬 【场记打板】\n- 甲在书店遇见乙。\n</details>\n</bakemono>';

// A reported chat: the 开场白 (floor 0) was hidden by 只留最近 N 楼, and replies carry their own titled summary.
function chat() {
    const f = fixture(7);
    f.chat.forEach((message, i) => {
        if (i % 2) Object.assign(message, { is_user: true, mes: '用户 ' + i });
        else message.mes = i ? `正文 ${i}\n${own(i)}` : '开场白：书店里下着雨。';
    });
    f.chat[0].is_system = true; f.chat[1].is_system = true;
    f.state.hiddenMessageIds = [0, 1];
    f.state.scanRules = { mode: 'tag', includeTags: 'details:🌀摘要', excludeTags: 'thinking', includeHidden: true };
    f.state.stageSourceMode = 'summaries';
    f.source.refresh();
    return f;
}
function scan(f) {
    const service = createContentBlockService({ getState: () => f.state, ...text });
    f.state.blocks = f.chat.flatMap((message, messageId) => message.is_user ? [] : service.extractConfiguredSegments(message.mes)
        .map((segment, blockIndex) => ({ hash: `${messageId}.${blockIndex}.${text.getHash(segment.content)}`, type: 'story', messageId, blockIndex,
            content: segment.content, matchedTag: segment.matchedTag, scanMode: segment.mode, sourceKind: service.getSegmentSourceKind(segment) })));
    return buildFloorMemoryIndex({ messages: f.chat, state: f.state });
}
function backfill(f) {
    return createSummaryBackfillController({ getState: () => f.state, getContext: () => ({ chat: f.chat }),
        summarySources: f.source, ...text, ...meta, unique, stripPostProcessNoise,
        getMessageVariantKey: message => String(message.swipe_id ?? ''), blockTypes: { STORY: 'story' },
        defaultAutomation: { backfillBatchSize: 10 }, getIsBusy: noop, renderWorkbenchScope: noop,
        workbenchRenderScopes: {}, toastr: { info: noop }, confirmDanger: noop });
}

test('a 开场白 the plugin hid is still the 开场白, never a missing floor', () => {
    const f = chat();
    assert.deepEqual(openingFloors(f.chat), [], 'SillyTavern marks the hidden floor as a system message');
    assert.deepEqual(openingFloors(f.chat, { hidden: new Set([0]) }), [0]);
    const index = scan(f);
    assert.equal(index.aggregates.missing, 0);
    assert.notEqual(index.byId.get(0)?.summaryState, 'missing');
    assert.deepEqual(backfill(f).buildMissingSummaryTargets().map(target => target.messageId), []);
    // Naming the floor in the range still lets the user write one on purpose.
    assert.deepEqual(backfill(f).buildMissingSummaryTargets({ rangeIds: new Set([0]) }).map(target => target.messageId), [0]);
});

test('a summary 补写 wrote into a floor counts there too, whatever the reading tags are', () => {
    const f = chat();
    f.chat[0].mes += '\n\n' + written;
    const index = scan(f);
    const block = f.state.blocks.find(item => item.messageId === 0);
    assert.equal(block?.matchedTag, 'bakemono');
    assert.equal(block.sourceKind, 'tag');
    assert.equal(index.byId.get(0).summaryState, 'saved');
    assert.equal(index.aggregates.missing, 0);
    assert.deepEqual(backfill(f).buildMissingSummaryTargets({ rangeIds: new Set([0]) }), [], '补写 and the index agree');
});

test('written summaries are not read twice when the reading tags already reach them', () => {
    const service = createContentBlockService({ getState: () => ({}), ...text });
    const read = includeTags => service.extractConfiguredSegments('正文\n' + written, { mode: 'tag', includeTags, excludeTags: '' })
        .map(segment => segment.matchedTag);
    assert.deepEqual(read('details'), ['details'], 'the inner block is enough');
    assert.deepEqual(read('bakemono'), ['bakemono']);
    assert.deepEqual(read('details:🌀摘要'), ['bakemono']);
    // A reply that holds only its own summary is read exactly as before.
    assert.deepEqual(service.extractConfiguredSegments(own(2), { mode: 'tag', includeTags: 'details:🌀摘要' }).map(s => s.matchedTag), ['details:🌀摘要']);
    // Excluding bakemono is respected.
    assert.deepEqual(service.extractConfiguredSegments(written, { mode: 'tag', includeTags: 'details:🌀摘要', excludeTags: 'bakemono' }), []);
});
