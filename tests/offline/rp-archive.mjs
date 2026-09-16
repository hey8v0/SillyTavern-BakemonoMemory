import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRpCoreService } from '../../src/rp-core/service.js';
import { createLedger, appendRecord, replayLedger } from '../../src/rp-core/ledger.js';
import { createProjection, applyDomainFact } from '../../src/rp-core/domain.js';
import { readChatSource } from '../../src/rp-core/chat-sources.js';
import { sourceStamp } from '../../src/rp-core/source.js';
import { RP_SETTINGS } from '../../src/rp-core/policy.js';
import { compileRpContext } from '../../src/rp-core/context.js';
import { buildStatePage } from '../../src/rp-core/state-view.js';
import { exportRpBackup, importRpBackup } from '../../src/rp-core/backup.js';
const projection = createProjection(), chat = [];
projection.people = Array.from({ length: 150 }, (_, i) => ({ id: 'p' + i, name: '人物' + i, aliases: [], traits: [], states: [], location: null }));
projection.scene = { location: null, present: ['p149'] };
projection.items = [{ id: 'water', name: '水', quantity: 5000, status: 'available', owner: null, holder: 'p149', location: null, loan: null }];
const core = createLedger(projection); core.ruleVersion = 3; core.settings = { ...RP_SETTINGS };
const state = { rpCore: core };
let serial = 0;
const add = i => {
    const message = { mes: '第' + i + '轮饮用了一份水。' }; chat.push(message);
    const source = readChatSource(message, state, { allocate: true, makeId: () => 's' + ++serial });
    appendRecord(core, { track: 'facts', action: 'item_consumed', data: { id: 'water', quantity: 1 }, ruleVersion: 3, protocolVersion: 2,
        origin: { kind: 'model', messageId: source.messageId, variantId: source.variantId, revision: source.revision, stamp: sourceStamp(source), policy: source.policy, baseRevision: core.revision } }, { floor: i, order: i });
};
for (let i = 0; i < 1000; i++) add(i);
const service = createRpCoreService({ getState: () => state, getChat: () => chat, saveState() {}, saveChat: async () => {} });
const measure = fn => { const start = performance.now(); const result = fn(); return { result, ms: Number((performance.now() - start).toFixed(1)) }; };
const full = measure(() => service.view()); assert.equal(full.result.applied.length, 1000);
assert.equal(full.result.projection.items[0].quantity, 4000);
const context = measure(() => compileRpContext(core, full.result, { query: '继续' }));
assert.match(context.result.brief, /人物149/);
const page = measure(() => buildStatePage(core, full.result, { tab: 'history', page: 30 })); assert.equal(page.result.rows.length, 20);
const restore = measure(() => importRpBackup(JSON.parse(JSON.stringify(exportRpBackup(core)))));
assert.deepEqual(replayLedger(restore.result, applyDomainFact).projection.items, full.result.projection.items);
add(1000);
const next = measure(() => service.view()); assert.equal(next.result.projection.items[0].quantity, 3999);
console.log(JSON.stringify({ environment: process.version + ' ' + process.platform, messages: 1000, people: 150,
    replayMs: full.ms, contextMs: context.ms, pageMs: page.ms, validateRestoreMs: restore.ms,
    afterOneNewFactFullReplayMs: next.ms, serializedBytes: Buffer.byteLength(JSON.stringify(core)), incrementalReplay: false }));
