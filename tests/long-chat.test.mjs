import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeHost } from './helpers/rp-runtime-host.mjs';
import { createVectorSidecar, vectorSidecarName } from '../src/vector/sidecar.js';
import { serializeVectorMemory } from '../src/vector/storage.js';
import { replayLedger, createReplayCache, foldLedger } from '../src/rp-core/ledger.js';
import { applyDomainFact } from '../src/rp-core/domain.js';
import { compactChange } from '../src/rp-core/extraction.js';
import { validateRpBackup } from '../src/rp-core/backup.js';
import { getHash } from '../src/shared/text.js';

const block = events => '<rpEvents>' + JSON.stringify({ version: 2, events }) + '</rpEvents>';
const e = (action, data) => ({ action, data });

test('the vector index goes to its own file and leaves the chat file', async () => {
    const files = new Map();
    const fetchImpl = async (url, init = {}) => {
        if (url === '/api/files/upload') {
            const { name, data } = JSON.parse(init.body);
            assert.match(name, /^[a-zA-Z0-9_\-.]+\.json$/, 'SillyTavern only accepts plain file names');
            files.set('/user/files/' + name, Buffer.from(data, 'base64').toString('utf8'));
            return { ok: true, json: async () => ({ path: 'user/files/' + name }) };
        }
        const text = files.get(url.split('?')[0]);
        return text ? { ok: true, json: async () => JSON.parse(text) } : { ok: false, status: 404 };
    };
    const sidecar = createVectorSidecar({ fetchImpl, getChatKey: () => 'character:1|chat:夏尔 - 2026', getHash });
    const memory = { records: [{ id: 'r1', hash: 'h1', text: '摘要', embedding: [0.25, -0.5, 1] }] };
    assert.ok(serializeVectorMemory(memory).records.length, 'before the file exists the records stay in the chat');
    await sidecar.save(memory);
    assert.equal(memory.sidecar.count, 1);
    const saved = JSON.parse(JSON.stringify(serializeVectorMemory(memory)));
    assert.deepEqual(saved.records, [], 'once in the file, the chat keeps only the pointer');
    assert.equal(saved.sidecar.path, memory.sidecar.path);

    const reopened = { ...saved, records: [] };
    assert.equal(await sidecar.load(reopened), true);
    assert.deepEqual(reopened.records[0].embedding, [0.25, -0.5, 1]);

    memory.records.push({ id: 'r2', hash: 'h2', text: '新', embedding: [1, 0, 0] });
    assert.equal(serializeVectorMemory(memory).records.length, 2, 'a changed index is kept in the chat until its file is rewritten');

    // Split by floor range: a new reply rewrites only its own part.
    const uploads = [];
    const counting = async (url, init) => { if (url === '/api/files/upload') uploads.push(JSON.parse(init.body).name); return fetchImpl(url, init); };
    const parted = createVectorSidecar({ fetchImpl: counting, getChatKey: () => 'long', getHash });
    const long = { records: Array.from({ length: 900 }, (_, i) => ({ id: 'v' + i, hash: 'h' + i, messageId: i * 2 + 1, embedding: [i, 1, 0] })) };
    await parted.save(long);
    assert.equal(uploads.length, 9, '1,800 floors are 9 files of 200 floors');
    uploads.length = 0;
    long.records.push({ id: 'v900', hash: 'h900', messageId: 1801, embedding: [1, 1, 1] });
    await parted.save(long);
    assert.deepEqual(uploads.length, 1, 'the next reply rewrites one file');
    const back = { ...JSON.parse(JSON.stringify(serializeVectorMemory(long))), records: [] };
    assert.equal(await parted.load(back), true);
    assert.equal(back.records.length, 901);

    const lost = { sidecar: { path: 'user/files/missing.json', signature: 'x' }, records: [] };
    assert.equal(await createVectorSidecar({ fetchImpl, getHash }).load(lost), false);
    assert.equal(lost.dirty, true, 'an unreadable file means the index is rebuilt');
    assert.match(vectorSidecarName('a|b', getHash), /^bakemono-vectors-[0-9a-f]{16}\.json$/);
});

test('a change record keeps only what changed, not the whole person', () => {
    const states = Array.from({ length: 50 }, (_, i) => ({ id: 's' + i, description: '旧状态' + i }));
    const before = { id: 'a', name: '甲', traits: [], states };
    const after = { ...before, states: [...states, { id: 'new', description: '受伤' }] };
    const change = compactChange(before, after);
    assert.deepEqual(change.after.states, [{ id: 'new', description: '受伤' }]);
    assert.deepEqual(change.before.states, []);
    assert.equal(change.after.name, '甲');
    assert.ok(JSON.stringify(change).length < 200);
});

async function story(replies) {
    const h = runtimeHost(); await h.service.enable();
    h.chat[0].mes += block([e('person_registered', { id: '甲', name: '甲' }), e('location_created', { id: '书店', name: '书店' })]);
    await h.flow.captureInline();
    for (let i = 1; i <= replies; i++) {
        h.chat.push({ mes: '说话', is_user: true });
        h.chat.push({ mes: '正文第' + i + '段。' + block([
            e('person_state_started', { id: '甲', stateId: 's' + i, description: '第' + i + '段的心情' }),
            e('item_registered', { id: 'item' + i, name: '物品' + i, owner: '甲', holder: '甲' }),
            ...(i > 1 ? [e('person_state_ended', { id: '甲', stateId: 's' + (i - 1) })] : []),
        ]) });
        await h.flow.captureInline();
    }
    return h;
}

test('carrying the replay across replies gives the same state as replaying from scratch', async () => {
    const h = await story(12);
    const full = replayLedger(h.state.rpCore, applyDomainFact).projection;
    const cache = createReplayCache(applyDomainFact);
    const partial = { ...h.state.rpCore, facts: h.state.rpCore.facts.slice(0, 10) };
    cache(partial);
    assert.deepEqual(cache(h.state.rpCore).projection, full);
    assert.equal(h.service.view().projection.items.length, 12);
});

test('old floors fold into the starting state without changing the current state', async () => {
    const h = await story(6);
    const core = h.state.rpCore, cutoff = 7;
    const before = replayLedger(core, applyDomainFact).projection;
    const folded = foldLedger(core, cutoff, applyDomainFact);
    const after = replayLedger(folded, applyDomainFact).projection;
    assert.deepEqual(after.items, before.items);
    assert.deepEqual(after.people[0].states.filter(item => !item.ended), before.people[0].states.filter(item => !item.ended));
    assert.ok(folded.facts.length < core.facts.length);
    assert.equal(folded.baseline.floor, cutoff);
    assert.equal(folded.baseline.startFloor, core.baseline.floor);
    assert.ok(folded.facts.every(fact => fact.order >= cutoff));
    validateRpBackup(folded);
});
