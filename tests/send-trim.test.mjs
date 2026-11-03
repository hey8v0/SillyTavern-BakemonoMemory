import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planSkippedFloors } from '../src/memory/send-trim.js';
import { createSendTrim } from '../src/features/send-trim.js';
import { resolveSummaryGraph, summarySourceFloors } from '../src/memory/summary-provenance.js';
import * as text from '../src/shared/text.js';

// The chat the host hands the generation interceptor is a copy made for this one request. Floors a 阶段总结 already
// tells are left out of that copy, and so are the blocks of the covered floors that stay; a floor no summary covers yet
// goes with its block. The chat itself is not touched.
const block = floor => `<bakemono>第${floor}楼的摘要：林晚和沈砚在码头说了很久的话。</bakemono>`;
const opening = { is_user: false, name: '旁白', mes: '雾港镇的清晨。', send_date: 'd0' };
function chatOf(count = 12) {
    return [opening, ...Array.from({ length: count - 1 }, (_, i) => {
        const id = i + 1, user = id % 2 === 1;
        return { is_user: user, name: user ? '我' : '林晚', send_date: `d${id}`, mes: user ? `第${id}楼我说的话。` : `第${id}楼的正文，写得很长很长。${block(id)}` };
    })];
}
function stateOf({ skip = true, strip = true, keepRecent = 4, stages = [['stage1', [2, 4]]] } = {}) {
    return {
        injection: { enabled: true, template: '【记忆】\n{{memory}}' },
        scanRules: { mode: 'tag', includeTags: 'bakemono' },
        sendTrim: { skipCovered: skip, stripBlocks: strip, keepRecent },
        storySummaries: [2, 4, 6, 8].map(floor => ({ hash: `s${floor}`, type: 'story', content: `第${floor}楼摘要`, sourceMessageIds: [floor], createdAt: '2026-11-01' })),
        stageSummaries: stages.map(([hash, floors]) => ({ hash, type: 'stage', content: `${hash}的总结`, sourceHashes: floors.map(floor => `s${floor}`), sourceMessageIds: floors, createdAt: '2026-11-02' })),
        epicSummaries: [], blocks: [],
    };
}
function fixture(options = {}, chat = chatOf()) {
    const state = stateOf(options);
    const trim = createSendTrim({ ensureState: () => state, getChat: () => chat, resolveSummaryGraph, summarySourceFloors, ...text, blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' } });
    // What the host builds: the visible messages, each a copy with its position in that list.
    const coreChat = (type = 'normal') => {
        const copy = chat.filter(message => !message.is_system).map((message, index) => ({ ...message, mes: message.mes, index }));
        if (type === 'swipe') copy.pop();
        return copy;
    };
    return { state, chat, trim, coreChat, ids: copy => copy.map(item => Number(item.send_date.slice(1))) };
}

test('the floors a stage covers go, with the message that led to each; the latest few and the uncovered always stay', () => {
    const chat = chatOf();
    assert.deepEqual([...planSkippedFloors(chat, [2, 4], { keepRecent: 4 })], [1, 2, 3, 4]);
    assert.deepEqual([...planSkippedFloors(chat, [2, 4, 10], { keepRecent: 4 })], [1, 2, 3, 4], 'floor 10 is among the latest four');
    assert.deepEqual([...planSkippedFloors(chat, [], { keepRecent: 4 })], []);
    const hidden = chatOf();
    hidden[3].is_system = true;
    assert.deepEqual([...planSkippedFloors(hidden, [4], { keepRecent: 4 })], [4], 'the hidden message is out already, and the reply before it is not from the user');
    assert.deepEqual([...planSkippedFloors(chatOf(), [2], { keepRecent: 20 })], [], 'all within the latest twenty');
});

test('in the interceptor: covered floors leave the copy, the floors no summary covers go whole with their blocks, the chat itself stays as it was', () => {
    const f = fixture();
    const before = JSON.stringify(f.chat);
    const copy = f.coreChat();
    const stats = f.trim.trim(copy, 'normal');
    assert.deepEqual(f.ids(copy), [0, 5, 6, 7, 8, 9, 10, 11]);
    for (const floor of [6, 8, 10]) assert.match(copy.find(item => item.send_date === `d${floor}`).mes, new RegExp(`^第${floor}楼的正文.*<bakemono>第${floor}楼的摘要`), `第 ${floor} 楼还没被阶段总结覆盖，正文和摘要块都发`);
    assert.equal(JSON.stringify(f.chat), before, 'the real chat is untouched');
    assert.equal(stats.skipped, 4);
    assert.equal(stats.strippedChars, 0, 'no covered floor is left in the copy, so no block goes');
});

test('a block goes only from a floor a summary already tells, and only while that summary reaches the model', () => {
    // Every floor stays while 跳过 is off: the covered ones go without their blocks, the text stays.
    const kept = fixture({ skip: false });
    const copy = kept.coreChat();
    const stats = kept.trim.trim(copy, 'normal');
    assert.equal(copy.length, 12);
    for (const floor of [2, 4]) {
        const item = copy.find(entry => entry.send_date === `d${floor}`);
        assert.doesNotMatch(item.mes, /<bakemono>/, `第 ${floor} 楼已经在阶段总结里`);
        assert.match(item.mes, new RegExp(`第${floor}楼的正文`), 'the text of the reply stays');
    }
    for (const floor of [6, 8, 10]) assert.match(copy.find(entry => entry.send_date === `d${floor}`).mes, /<bakemono>/, `第 ${floor} 楼还没被覆盖`);
    assert.ok(stats.strippedChars > 0);

    // A prompt regex of the user's own left only a status bar and the summary of an old floor. While no summary
    // covers that floor, the block is all the model gets of it: it stays.
    const regexed = fixture({ skip: false });
    const short = regexed.coreChat().map(item => item.send_date === 'd6' ? { ...item, mes: `<status>第6楼 黄昏 码头</status>${block(6)}` } : item);
    regexed.trim.trim(short, 'normal');
    assert.match(short.find(item => item.send_date === 'd6').mes, /<bakemono>第6楼的摘要/);

    // Everything covered: the latest two blocks stay to show the format.
    const all = fixture({ skip: false, stages: [['stage1', [2, 4, 6, 8]]] }, chatOf(10));
    const allCopy = all.coreChat();
    all.trim.trim(allCopy, 'normal');
    assert.deepEqual(allCopy.filter(item => item.mes.includes('<bakemono>')).map(item => item.send_date), ['d6', 'd8']);

    // The summary does not reach the model: the blocks are the only copy of it the model would see.
    for (const change of [state => { state.injection.enabled = false; }, state => { state.injection.template = '只有规则，没有记忆'; }]) {
        const off = fixture({ skip: false });
        change(off.state);
        const offCopy = off.coreChat();
        assert.equal(off.trim.trim(offCopy, 'normal').strippedChars, 0);
        assert.match(offCopy.find(item => item.send_date === 'd2').mes, /<bakemono>/);
    }
});

test('a swipe, a continue and other extensions before us: what the host already did is respected; anything that does not line up stops it', () => {
    const swipe = fixture();
    const copy = swipe.coreChat('swipe');
    swipe.trim.trim(copy, 'swipe');
    assert.deepEqual(swipe.ids(copy), [0, 5, 6, 7, 8, 9, 10]);
    const changed = fixture();
    const odd = changed.coreChat();
    odd[3] = { ...odd[3], send_date: 'someone-else' };
    const untouched = JSON.stringify(odd);
    assert.equal(changed.trim.trim(odd, 'normal').skipped, 0);
    assert.equal(JSON.stringify(odd), untouched, 'nothing is cut when the copy does not match the chat');
    const quiet = fixture();
    const background = quiet.coreChat();
    quiet.trim.trim(background, 'quiet');
    assert.equal(background.length, 12, 'a quiet request of another extension gets the chat as it is');
});

test('nothing is skipped when the summaries do not reach the model, or the switch is off; blocks go by their own switch', () => {
    for (const change of [state => { state.injection.enabled = false; }, state => { state.injection.template = '只有规则，没有记忆'; }, state => { state.sendTrim.skipCovered = false; }]) {
        const f = fixture();
        change(f.state);
        const copy = f.coreChat();
        f.trim.trim(copy, 'normal');
        assert.equal(copy.length, 12);
    }
    const blocksOff = fixture({ strip: false, keepRecent: 8 });
    const copy = blocksOff.coreChat();
    blocksOff.trim.trim(copy, 'normal');
    assert.ok(copy.find(item => item.send_date === 'd4').mes.includes('<bakemono>'), 'a covered floor kept for being recent keeps its block while that switch is off');
    const raw = fixture({ skip: false });
    raw.state.scanRules.mode = 'full';
    const rawCopy = raw.coreChat();
    raw.trim.trim(rawCopy, 'normal');
    assert.ok(rawCopy.find(item => item.send_date === 'd2').mes.includes('<bakemono>'), 'when the whole reply is the summary there is no block to cut');
});

test('a floor under a 多次总结 counts as covered; a 阶段总结 that only lists a floor without its summary does not reach further', () => {
    const f = fixture({ stages: [['stage1', [2, 4]], ['stage2', [6, 8]]] });
    f.state.epicSummaries = [{ hash: 'epic1', type: 'epic', content: '一卷', sourceStageHashes: ['stage1', 'stage2'], sourceHashes: ['stage1', 'stage2'], createdAt: '2026-11-03' }];
    f.state.sendTrim.keepRecent = 2;
    const copy = f.coreChat();
    f.trim.trim(copy, 'normal');
    assert.deepEqual(f.ids(copy), [0, 9, 10, 11]);
});

test('the numbers for the home page: what goes, what is left out, what the summaries take; and what turning it on would save', () => {
    // The latest eight stay: floor 4 is covered but kept, so it goes without its block.
    const f = fixture({ keepRecent: 8 });
    const on = f.trim.estimate();
    assert.equal(on.active, true);
    assert.equal(on.skippedFloors, 2);
    assert.ok(on.skippedChars > 0 && on.strippedChars > 0 && on.sentChars > 0);
    assert.equal(on.sentFloors, 10);
    const line = f.trim.summary({ summary: 'x'.repeat(300), facts: 'y'.repeat(200) });
    assert.match(line.text, /这一轮发出聊天正文 10 楼/);
    assert.match(line.text, /跳过已总结的 2 楼/);
    assert.match(line.text, /已总结楼层的摘要块省下约 [\d,]+ 字/);
    assert.match(line.text, /总结和剧情事实约 500 字/);
    assert.equal(line.canEnable, false);
    assert.equal(fixture().trim.estimate().strippedChars, 0, 'the blocks of floors no summary covers are not counted as saved');
    assert.doesNotMatch(fixture({ skip: false }).trim.summary({}).text, /跳过/, 'nothing skipped, nothing said about it');
    const off = fixture({ skip: false, strip: false });
    const offer = off.trim.summary({ summary: '', facts: '' });
    assert.match(offer.text, /打开“发送时精简旧楼层”，这一轮可以少发约 [\d,]+ 字，省下的都是已经总结过的楼层/);
    assert.equal(offer.canEnable, true);
    const nothing = fixture({ skip: false, strip: false, stages: [] }, chatOf(4));
    assert.equal(nothing.trim.summary({}).text, '', 'nothing to save, nothing to say');
});

test('recall counts a skipped floor as out of view, so the old story there can still come back', () => {
    const f = fixture({ keepRecent: 4 });
    assert.deepEqual([...f.trim.skippedIds()].sort((a, b) => a - b), [1, 2, 3, 4]);
    f.state.sendTrim.skipCovered = false;
    assert.deepEqual([...f.trim.skippedIds()], []);
});

test('a new chat starts with both on, a chat from before with both off; the switches are on the archive page, the offer on the home page', () => {
    const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(read('src/core/chat-state-service.js'), /if \(isNewChatState\) \{[^}]*sendTrim = \{ \.\.\.state\.sendTrim, skipCovered: true, stripBlocks: true \}/);
    assert.match(read('src/config/defaults.js'), /sendTrim: \{ skipCovered: false, stripBlocks: false, keepRecent: 10 \}/);
    const html = read('settings.html');
    for (const id of ['send-trim-skip', 'send-trim-strip', 'send-trim-keep', 'send-trim-status', 'send-trim-note']) assert.match(html, new RegExp(`id="bakemono-memory-${id}"`), id);
    assert.match(html, /data-bakemono-action="enable-send-trim"/);
    assert.match(html, /已总结楼层的摘要块不发/);
    const index = read('index.js');
    assert.match(index, /globalThis\.bakemonoMemoryRecallInterceptor = async \(coreChat, contextSize, abort, type\) =>/);
    assert.match(index, /sendTrim\.trim\(coreChat, type\)/);
    assert.match(index, /getSkippedFloorIds: \(\) => sendTrim\.skippedIds\(\)/);
    assert.match(read('src/features/workbench-action-controller.js'), /action === 'enable-send-trim'/);
    assert.match(html, /id="bakemono-memory-archive-legend-skipped" hidden><i class="is-skipped"><\/i>发送时跳过/, 'the archive reel shows what is left out of what is sent');
    assert.match(read('src/features/archive-controller.js'), /message\.skipped \? 'is-skipped'/);
});
