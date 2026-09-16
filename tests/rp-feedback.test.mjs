import test from 'node:test';
import assert from 'node:assert/strict';
import { readChatSource } from '../src/rp-core/chat-sources.js';
import { createRpCoreService } from '../src/rp-core/service.js';
import { buildStatePage } from '../src/rp-core/state-view.js';
import { rpMemorySources } from '../src/rp-core/memory.js';
import * as evidence from '../src/rp-core/source.js';
import { validateRpBackup } from '../src/rp-core/backup.js';
import { rpDisplayPayloads } from '../src/features/rp-protocol-display.js';
import { createProjection } from '../src/rp-core/domain.js';
import { createRpStateUi } from '../src/features/rp-state-ui.js';
import { createReviewQueueUi } from '../src/features/review-queue-ui.js';
import { seedLegacyExtraction } from './helpers/legacy-rp-extraction.mjs';

const payload = events => JSON.stringify({ version: 1, events });
function fixture({ legacy = false } = {}) {
    const state = {}, chat = [{ mes: '甲说：我会回来。', swipe_id: 0, swipes: ['甲说：我会回来。', '甲说：我会回来。'], swipe_info: [{ extra: {} }, { extra: {} }] }];
    let n = 0;
    const service = createRpCoreService({ getState: () => state, getChat: () => chat,
        saveState: () => ({}), saveChat: async () => {}, makeSourceId: () => 'id-' + ++n });
    const swipe = index => { chat[0].swipe_id = index; chat[0].mes = chat[0].swipes[index]; chat[0].extra = structuredClone(chat[0].swipe_info[index].extra); };
    if (legacy) service.ingest = async (raw, floor) => seedLegacyExtraction(state, chat, raw, floor);
    return { state, chat, service, swipe };
}
const claim = { track: 'claims', action: 'claim_made', data: { speaker: '甲', description: '会回来' }, excerpt: '甲说：我会回来。' };
test('host swipe metadata replacement and reload preserve branch identity without duplicate ingestion', async () => {
    const { state, chat, service, swipe } = fixture();
    await service.enable(); await service.ingest(payload([claim]), 0);
    const a = readChatSource(chat[0], state);
    swipe(1); await service.ingest(payload([claim]), 0);
    const b = readChatSource(chat[0], state);
    assert.equal(b.messageId, a.messageId);
    assert.notEqual(b.variantId, a.variantId);
    chat[0] = JSON.parse(JSON.stringify(chat[0]));
    swipe(0); await service.ingest(payload([claim]), 0);
    assert.equal(state.rpCore.claims.length, 2);
    assert.equal(readChatSource(chat[0], state).variantId, a.variantId);
});
test('swipe deletion shifts host indexes without changing the retained branch anchor', async () => {
    const { state, chat, service, swipe } = fixture();
    await service.enable(); await service.ingest(payload([claim]), 0);
    swipe(1); await service.ingest(payload([claim]), 0);
    const b = readChatSource(chat[0], state);
    chat[0].swipes.splice(0, 1); chat[0].swipe_info.splice(0, 1);
    swipe(0);
    const current = readChatSource(chat[0], state, { allocate: true });
    assert.equal(current.variantId, b.variantId);
    await service.ingest(payload([claim]), 0);
    assert.equal(state.rpCore.claims.length, 2);
});
test('copied metadata on a new swipe does not reuse the old branch anchor', async () => {
    const { state, chat, service, swipe } = fixture();
    await service.enable(); await service.ingest(payload([claim]), 0);
    const a = readChatSource(chat[0], state);
    chat[0].swipe_info[1] = structuredClone(chat[0].swipe_info[0]);
    swipe(1); await service.ingest(payload([claim]), 0);
    assert.notEqual(readChatSource(chat[0], state).variantId, a.variantId);
    assert.equal(state.rpCore.claims.length, 2);
});
test('hosts without swipe_info can return to a previously processed branch', () => {
    const message = { mes: '同一正文', swipe_id: 0 };
    const a = readChatSource(message, {}, { allocate: true });
    message.swipe_id = 1; message.extra = {};
    const b = readChatSource(message, {}, { allocate: true });
    message.swipe_id = 0; message.extra = {};
    assert.equal(readChatSource(message, {}).variantId, a.variantId);
    assert.notEqual(a.variantId, b.variantId);
});
test('display filtering requires an rpEvents wrapper and supports the streaming tail', () => {
    const json = '{"version":1,"events":[]}';
    assert.deepEqual(rpDisplayPayloads(json), []);
    assert.ok(rpDisplayPayloads('<rpEvents>' + json + '</rpEvents>').includes(json));
    assert.ok(rpDisplayPayloads('<rpEvents>' + json).includes(json));
    assert.deepEqual(rpDisplayPayloads('正常正文<bakemono>摘要</bakemono>'), []);
});
test('current history, pending count and RAG isolate inactive swipes while retaining the audit', async () => {
    const { state, service, swipe } = fixture();
    await service.enable(); await service.ingest(payload([claim, { ...claim, excerpt: '不存在的摘录' }]), 0);
    swipe(1); await service.ingest(payload([claim]), 0);
    const view = service.view();
    assert.equal(buildStatePage(state.rpCore, view, { tab: 'history' }).total, 1);
    assert.equal(buildStatePage(state.rpCore, view, { tab: 'history', filter: 'pending' }).total, 0);
    assert.equal(buildStatePage(state.rpCore, view, { tab: 'history', filter: 'source-history' }).total, 1);
    assert.equal(rpMemorySources(state, view).length, 1);
    assert.equal(state.rpCore.claims.length, 2);
    const ui = createRpStateUi({ documentRef: {}, getState: () => state, service, escapeHtml: String });
    const counts = {};
    const queue = createReviewQueueUi({ documentRef: { querySelectorAll: () => [] }, query: selector => ({ text: value => { counts[selector] = value; } }),
        getState: () => state, getRpPendingCount: current => ui.getPendingCount(current) });
    state.drafts = []; state.taskQueue = []; state.history = [];
    queue.renderTabs(state);
    assert.equal(counts['#bakemono-memory-review-draft-count'], 0);
    swipe(0);
    assert.equal(buildStatePage(state.rpCore, service.view(), { tab: 'history', filter: 'pending' }).total, 0);
    queue.renderTabs(state);
    assert.equal(counts['#bakemono-memory-review-draft-count'], 0);
});
test('excerpt omission offers a full-source correction, never auto-validates an invented quote', () => {
    const source = evidence.sourceSnapshot('他说：“明天把笔记还给他。”他停了一下，补充说：“明天哪都不许去。”', { messageId: 'm', variantId: 'v' });
    const excerpt = '“明天把笔记还给他。”……“明天哪都不许去。”';
    assert.equal(evidence.locateEvidence(source, excerpt).status, 'missing');
    const suggestion = evidence.suggestEvidenceRepair(source, excerpt);
    assert.match(suggestion.excerpt, /他停了一下，补充说/);
    assert.equal(evidence.locateEvidence(source, suggestion.excerpt).status, 'located');
    assert.equal(evidence.suggestEvidenceRepair(source, '“明天把笔记烧掉。”……“明天哪都不许去。”'), null);
    const repeated = evidence.sourceSnapshot(source.text + source.text, { messageId: 'm', variantId: 'v' });
    assert.equal(evidence.suggestEvidenceRepair(repeated, excerpt), null);
});

test('missing references can be registered and confirmed atomically with evidence, not guessed ownership', async () => {
    const { state, chat, service } = fixture({ legacy: true });
    chat[0].mes = '甲来了。甲拿着一枚戒指。他把戒指放到了书房。';
    await service.enable();
    await service.ingest(payload([{ track: 'facts', action: 'item_placed', data: { id: 'ring', from: '甲', location: 'room' }, excerpt: '他把戒指放到了书房。' }]), 0);
    const id = state.rpCore.candidates[0].id, before = JSON.stringify(state.rpCore);
    const updates = [
        { field: 'from', name: '甲', excerpt: '甲来了。' },
        { field: 'id', name: '戒指', excerpt: '甲拿着一枚戒指。', holder: '@from' },
        { field: 'location', name: '书房', excerpt: '他把戒指放到了书房。' },
    ];
    const preview = service.previewReferenceRepair(id, updates);
    assert.equal(JSON.stringify(state.rpCore), before);
    assert.equal(preview.after.projection.items[0].owner, null);
    assert.equal(preview.after.projection.items[0].quantity, null);
    await preview.commit();
    assert.equal(service.view().projection.items[0].holder, null);
    assert.equal(service.view().projection.items[0].location, service.view().projection.locations[0].id);
    assert.equal(state.rpCore.facts.length, 4);
    assert.equal(state.rpCore.candidates.filter(item => item.status === 'pending').length, 0);
    validateRpBackup(state.rpCore);
});
test('reference repair never bypasses missing evidence, source revisions or action prerequisites', async () => {
    const { state, chat, service } = fixture({ legacy: true });
    chat[0].mes = '甲来了。戒指在桌上。';
    await service.enable();
    await service.ingest(payload([{ track: 'facts', action: 'item_placed', data: { id: 'ring', from: '甲', location: 'table' }, excerpt: '戒指在桌上。' }]), 0);
    const id = state.rpCore.candidates[0].id;
    const updates = [{ field: 'from', name: '甲', excerpt: '甲来了。' }, { field: 'id', name: '戒指', excerpt: '戒指在桌上。' }, { field: 'location', name: '桌上', excerpt: '戒指在桌上。' }];
    assert.throws(() => service.previewReferenceRepair(id, updates), /持有/);
    assert.equal(state.rpCore.facts.length, 0);
    updates[0].excerpt = '虚构证据';
    assert.throws(() => service.previewReferenceRepair(id, updates), /摘录/);
    chat[0].mes = '已改成其他剧情';
    assert.throws(() => service.previewReferenceRepair(id, updates), /来源/);
});
test('unique existing names resolve without registering duplicates', async () => {
    const { state, chat, service } = fixture();
    chat[0].mes = '甲来了。书房在楼上。甲走进书房。';
    await service.enable();
    await service.ingest(payload([
        { track: 'facts', action: 'person_created', data: { id: 'p', name: '甲' }, excerpt: '甲来了。' },
        { track: 'facts', action: 'location_created', data: { id: 'l', name: '书房' }, excerpt: '书房在楼上。' },
    ]), 0);
    chat.push({ mes: '甲走进书房。' });
    await service.ingest(payload([{ track: 'facts', action: 'person_moved', data: { id: '甲', location: '书房' }, excerpt: '甲走进书房。' }]), 1);
    assert.equal(state.rpCore.facts.length, 3);
    assert.equal(service.view().projection.people[0].location, service.view().projection.locations[0].id);
});
test('ambiguous names remain pending and reference previews expire after another state revision', async () => {
    const { state, chat, service } = fixture({ legacy: true });
    const projection = createProjection();
    projection.people = [{ id: 'p1', name: '甲', location: null }, { id: 'p2', name: '甲', location: null }];
    projection.locations = [{ id: 'room', name: '书房', parent: null }];
    chat[0].mes = '甲走进书房。';
    await service.enable(); state.rpCore.baseline.projection = structuredClone(projection);
    await service.ingest(payload([{ track: 'facts', action: 'person_moved', data: { id: '甲', location: '书房' }, excerpt: '甲走进书房。' }]), 0);
    assert.equal(state.rpCore.facts.length, 0);
    const id = state.rpCore.candidates[0].id;
    const preview = service.previewReferenceRepair(id, [{ field: 'id', id: 'p1' }]);
    await service.configure({ autoApply: false });
    await assert.rejects(preview.commit(), /变化/);
    assert.equal(state.rpCore.facts.length, 0);
});
