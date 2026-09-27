import test from 'node:test';
import assert from 'node:assert/strict';
import { getSummaryStatus, registerSummaryChat, invalidateSummaryGraph } from '../src/memory/summary-provenance.js';
import { getHash, stripConfiguredTags } from '../src/shared/text.js';

// A picture plugin that adds an image to an old floor does not change the story: once the user excludes that tag,
// summaries made before the image was added stay valid.
function fixture(excludeTags) {
    const body = '旅人推开酒馆的门，雨水顺着斗篷滴落。';
    const chat = [{ mes: '你好', is_user: true }, { mes: body, swipe_id: 0 }];
    const input = { kind: 'body', sourceId: 's1', floor: 1, variant: '0', excludeTags: ['thinking'], revision: getHash(body), length: body.length, hash: 'b1' };
    const stage = { id: 'st1', hash: 'st1', title: '第一章', content: '<bakemono>第一章</bakemono>', provenance: { version: 2, inputs: [input] } };
    const state = { scanRules: { excludeTags }, stageSummaries: [stage], storySummaries: [], epicSummaries: [], blocks: [],
        chronicle: { sources: [{ id: 's1', floor: 1, variant: '0' }], links: {} } };
    registerSummaryChat(state, chat);
    return { state, chat, stage };
}

test('an image added to an old floor inside an excluded tag keeps the summary valid', () => {
    const { state, chat, stage } = fixture('thinking, image, img');
    assert.equal(getSummaryStatus(state, stage).valid, true);
    chat[1].mes += '\n<image>一只在雨里的黑猫</image>\n<img src="https://example.com/cat.png">';
    invalidateSummaryGraph(state);
    assert.equal(getSummaryStatus(state, stage).valid, true);
});

test('the same image without an exclude, or a real text change, still asks for a rebuild', () => {
    const plain = fixture('thinking');
    plain.chat[1].mes += '<image>一只在雨里的黑猫</image>';
    invalidateSummaryGraph(plain.state);
    assert.equal(getSummaryStatus(plain.state, plain.stage).valid, false);

    const edited = fixture('thinking, image');
    edited.chat[1].mes = edited.chat[1].mes.replace('酒馆', '铁匠铺');
    invalidateSummaryGraph(edited.state);
    assert.equal(getSummaryStatus(edited.state, edited.stage).valid, false);
});

test('unpaired stripping removes an <img> without an end tag only when asked', () => {
    const text = '前文<img src="a.png">后文';
    assert.equal(stripConfiguredTags(text, ['img']), text);
    assert.equal(stripConfiguredTags(text, ['img'], { unpaired: true }), '前文后文');
});
