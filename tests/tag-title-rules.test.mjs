import test from 'node:test';
import assert from 'node:assert/strict';
import * as text from '../src/shared/text.js';
import { createContentBlockService } from '../src/features/content-block-service.js';

// One reply, three <details> blocks that differ only in their title (reported by a user).
const reply = '甲推开门。\n'
    + '<details><summary>章节摘要</summary>甲找到旧信，约定明天去码头见乙。</details>\n'
    + '<details><summary>剧情选项</summary>A. 去码头 B. 回书店</details>\n'
    + '<details><summary><b>反馈</b></summary>本轮节奏偏慢。</details>';

test('a titled tag rule reads only the blocks with that title', () => {
    const chapter = text.extractConfiguredTagBlocks(reply, ['details:章节摘要']);
    assert.equal(chapter.length, 1);
    assert.match(chapter[0].content, /旧信/);
    assert.equal(chapter[0].matchedTag, 'details:章节摘要');
    // Full-width colon, spaces and a bracketed tag name mean the same rule.
    assert.deepEqual(text.extractConfiguredTagBlocks(reply, ['<details> ： 章节摘要']), chapter);
    // The title only has to contain the words; markup inside <summary> is ignored.
    assert.equal(text.extractConfiguredTagBlocks(reply, ['details:反馈'])[0]?.content.includes('节奏'), true);
    assert.equal(text.extractConfiguredTagBlocks(reply, ['details:不存在']).length, 0);
});

test('plain tag rules behave as before', () => {
    const all = text.extractConfiguredTagBlocks(reply, ['details']);
    assert.equal(all.length, 3);
    assert.ok(all.every(block => block.matchedTag === 'details'));
    assert.deepEqual(text.parseTagRule('<bakemono>'), { name: 'bakemono', title: '', key: 'bakemono' });
    assert.equal(text.stripConfiguredTags(reply, ['details']).trim(), '甲推开门。');
});

test('a titled exclude removes only those blocks and keeps the rest whole', () => {
    const kept = text.stripConfiguredTags(reply, ['details:剧情选项', 'details：反馈']);
    assert.match(kept, /<details><summary>章节摘要<\/summary>甲找到旧信/);
    assert.doesNotMatch(kept, /剧情选项|反馈/);
    assert.equal(text.filterTextByConfiguredTags(reply, { includeTags: ['details'], excludeTags: ['details:剧情选项', 'details:反馈'] }),
        text.extractConfiguredTagBlocks(reply, ['details:章节摘要'])[0].content);
});

test('scanning with a titled rule finds one summary per reply', () => {
    let state = { scanRules: { mode: 'tag', includeTags: 'details:章节摘要', excludeTags: 'thinking' } };
    const service = createContentBlockService({ getState: () => state, ...text });
    const segments = service.extractConfiguredSegments(reply);
    assert.equal(segments.length, 1);
    assert.equal(text.readBlockTitle(segments[0].content), '章节摘要');
    // In 全文管线 a block read through a titled rule still counts as a tag block, however the rule was typed.
    state = { scanRules: { mode: 'full', includeTags: 'details：章节摘要', excludeTags: '' } };
    const full = service.extractConfiguredSegments(reply);
    assert.equal(full.length, 1);
    assert.equal(service.getSegmentSourceKind(full[0]), 'tag');
    // The same result by excluding the other two titles.
    state = { scanRules: { mode: 'tag', includeTags: 'details', excludeTags: 'details:剧情选项, details:反馈' } };
    assert.deepEqual(service.extractConfiguredSegments(reply).map(segment => segment.content), [segments[0].content]);
});
