import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProjection } from '../src/rp-core/domain.js';
import { createLedger } from '../src/rp-core/ledger.js';
import { sourceSnapshot } from '../src/rp-core/source.js';
import { prepareExtraction, parsePayload } from '../src/rp-core/extraction.js';
import { createRpCoreService } from '../src/rp-core/service.js';
import { createRpExtractionFlow, RP_EVENT_GUIDE } from '../src/rp-core/extraction-flow.js';
import { exportRpBackup, importRpBackup } from '../src/rp-core/backup.js';

const text = '2024-04-12T23:45。Nana进门。Kuroha说：“全港口都在传。”Nana说：“我和翔太根本没有在交往。”甲来到书店。';
const source = sourceSnapshot(text, { messageId: 'm', variantId: 'v' });
const clock = { track: 'facts', action: 'clock_set', data: { date: '2024-04-12T23:45' }, excerpt: '2024-04-12T23:45' };
const claim = { track: 'claims', data: { speaker: 'Kuroha', description: '声称港口都在传' }, excerpt: '全港口都在传。' };
const raw = events => JSON.stringify({ version: 1, events });
const run = (events, core = createLedger(createProjection())) => prepareExtraction(core, raw(events), source, { floor: 0, autoApply: true, automaticRegistration: true, allowNewOnRepeat: true });

test('missing claim actions normalize without blocking the other facts or asserting claims as facts', () => {
    const result = run([clock, claim, { ...claim, data: { speaker: 'Nana', description: '澄清并未交往' }, excerpt: '我和翔太根本没有在交往。' }]);
    assert.equal(result.core.facts.length, 1);
    assert.equal(result.core.claims.length, 2);
    assert.ok(result.core.claims.every(record => record.action === 'claim_made'));
    assert.equal(result.projection.projection.relationships.length, 0);
    assert.equal(result.core.batches[0].protocolRepairs.length, 2);
});

test('observations get a fixed action; track and action whitespace normalize without inventing facts', () => {
    const result = run([{ ...claim, track: ' Observations ', action: ' ' }, { ...clock, track: ' Facts ', action: ' clock_set ' }]);
    assert.equal(result.core.observations[0].action, 'observation_recorded');
    assert.equal(result.core.facts[0].action, 'clock_set');
    assert.equal(result.core.claims.length, 0);
});

test('repaired and explicitly written action forms are idempotent after reload and manual rejection', () => {
    const first = run([claim]);
    const again = run([{ ...claim, action: 'claim_made' }], JSON.parse(JSON.stringify(first.core)));
    assert.equal(again.core.claims.length, 1);
    assert.equal(again.core.candidates.length, 1);
    const ignored = run([{ ...claim, excerpt: '不存在的摘录' }]).core;
    ignored.candidates[0].status = 'ignored';
    assert.equal(run([{ ...claim, action: 'claim_made', excerpt: '不存在的摘录' }], ignored).core.candidates[0].status, 'ignored');
});

test('missing fact action, malformed entries and empty information are reported individually', () => {
    const events = [null, 'bad', { ...clock, action: undefined }, { ...claim, data: null }, { ...claim, data: {} }, clock];
    const result = run(events);
    assert.equal(result.core.facts.length, 1);
    assert.deepEqual(result.core.batches[0].protocolIssues.map(issue => issue.index), [1, 2, 3, 4, 5]);
    assert.match(result.core.batches[0].protocolIssues[2].reason, /action/);
    assert.equal(result.core.candidates.length, 1);
});

test('invalid event suspends its explicit atomic group, not unrelated candidates', () => {
    const result = run([{ ...clock, action: undefined, group: 'together' }, { ...claim, group: 'together' }, clock]);
    assert.equal(result.core.claims.length, 0);
    assert.equal(result.core.facts.length, 1);
    assert.deepEqual(result.core.batches[0].protocolIssues.map(issue => issue.index), [1, 2]);
    assert.match(result.core.batches[0].protocolIssues[1].reason, /关联/);
});

test('missing or duplicate creation identities do not abort independent records or create partial groups', () => {
    const person = { track: 'facts', action: 'person_created', data: { id: 'p', name: '甲' }, excerpt: '甲来到书店' };
    const moved = { track: 'facts', action: 'person_moved', data: { id: 'p', location: '书店' }, excerpt: '甲来到书店' };
    const duplicate = run([person, { ...person, data: { id: 'p', name: '乙' } }, moved, clock]);
    assert.equal(duplicate.core.facts.length, 1);
    assert.equal(duplicate.projection.projection.people.length, 0);
    assert.equal(duplicate.core.batches[0].protocolIssues.length, 3);
    const missing = run([{ ...person, data: { name: '甲' } }, clock]);
    assert.equal(missing.core.facts.length, 1);
    assert.equal(missing.core.batches[0].protocolIssues[0].index, 1);
});

test('literal repeated event does not duplicate a creation', () => {
    const person = { track: 'facts', action: 'person_created', data: { id: 'p', name: '甲' }, excerpt: '甲来到书店' };
    const result = run([person, structuredClone(person), clock]);
    assert.equal(result.projection.projection.people.length, 1);
    assert.equal(result.core.facts.length, 2);
    assert.equal(result.core.batches[0].protocolIssues.length, 0);
});

test('same statement at two verified positions remains two records', () => {
    const repeatedSource = sourceSnapshot('她点头。她点头。', { messageId: 'repeat', variantId: 'v' });
    const event = { track: 'observations', data: { description: '看见她点头' }, excerpt: '她点头' };
    const result = prepareExtraction(createLedger(createProjection()), raw([
        { ...event, span: { start: 0, end: 3 } }, { ...event, span: { start: 4, end: 7 } },
    ]), repeatedSource, { floor: 0, autoApply: true });
    assert.equal(result.core.observations.length, 2);
});

test('missing evidence remains pending and unknown actions are not coerced into accepted facts', () => {
    const result = run([{ ...claim, excerpt: undefined }, { ...clock, action: 'make_everything_true' }, clock]);
    assert.equal(result.core.claims.length, 0);
    assert.equal(result.core.candidates[0].status, 'pending');
    assert.equal(result.core.candidates[1].status, 'rejected');
    assert.equal(result.core.facts.length, 1);
});

test('truncated JSON, dangerous keys and unsupported versions still fail closed', () => {
    for (const payload of ['{"version":1,"events":[', '{"version":2,"events":[]}', '{"version":1,"events":[{"__proto__":{}}]}']) {
        assert.throws(() => prepareExtraction(createLedger(createProjection()), payload, source, { floor: 0 }));
    }
    assert.throws(() => parsePayload('<rpEvents>{"version":1,"events":[}</rpEvents>'), /JSON 格式/);
    assert.throws(() => parsePayload('null'), /事件协议/);
});

test('protocol issues survive backup without carrying entire invalid payloads', () => {
    const result = run([{ ...claim, action: 23, data: { description: 'private-secret-do-not-log' } }, clock]);
    const restored = importRpBackup(exportRpBackup(result.core));
    assert.equal(restored.batches[0].protocolIssues[0].index, 1);
    assert.doesNotMatch(JSON.stringify(restored.batches[0]), /private-secret-do-not-log/);
    assert.equal(restored.facts.length, 1);
});

test('backup validates bounded format diagnostics and remains compatible with earlier batches', () => {
    const result = run([null, claim]).core;
    for (const issues of [null, {}, [{ index: 0, code: 'bad', field: '', reason: 'bad' }], Array(101).fill({ index: 1, code: 'bad', field: '', reason: 'bad' })]) {
        const invalid = structuredClone(result);
        invalid.batches[0].protocolIssues = issues;
        assert.throws(() => exportRpBackup(invalid), /恢复数据无效/);
    }
    const legacy = structuredClone(result);
    delete legacy.batches[0].protocolIssues;
    delete legacy.batches[0].protocolRepairs;
    assert.equal(importRpBackup(legacy).claims.length, 1);
});

test('real inline flow tolerates malformed neighbours, persists issues, and repeated capture remains unchanged', async () => {
    const state = { turnSummary: {} }, chat = [{ mes: text + '<rpEvents>' + raw([null, clock, claim]) + '</rpEvents>' }];
    let saves = 0;
    const service = createRpCoreService({ getState: () => state, getChat: () => chat, saveState() {}, saveChat: async () => { saves++; } });
    await service.enable();
    const flow = createRpExtractionFlow({ getState: () => state, getChat: () => chat, service });
    assert.equal((await flow.captureInline({ detailed: true })).status, 'processed');
    assert.equal(state.rpCore.claims.length, 1);
    assert.equal(state.rpCore.facts.length, 1);
    assert.equal(state.rpCore.batches[0].protocolIssues[0].index, 1);
    assert.equal((await flow.captureInline({ detailed: true })).status, 'unchanged');
    assert.equal(saves, 2);
});

test('actual prompt includes valid minimal examples, automatic actions and bounded current-state reference', async () => {
    const state = {}, chat = [{ mes: text }];
    const service = createRpCoreService({ getState: () => state, getChat: () => chat, saveState() {}, saveChat: async () => {} });
    await service.enable();
    const flow = createRpExtractionFlow({ getState: () => state, getChat: () => chat, service });
    const prompt = flow.prompt('inline');
    assert.match(prompt, /claims.*action.*可省略/);
    assert.match(prompt, /observations.*observation_recorded/);
    assert.match(prompt, /不要.*编造|不能.*猜/);
    assert.match(prompt, /已有对象参考/);
    const examples = [...prompt.matchAll(/<rpEvents>([\s\S]*?)<\/rpEvents>/g)];
    assert.ok(examples.length >= 2);
    for (const example of examples) assert.doesNotThrow(() => parsePayload(example[0]));
    const doc = await readFile(new URL('../RP_EVENTS_PROMPT.md', import.meta.url), 'utf8');
    assert.equal(doc.match(/```text\r?\n([\s\S]*?)\r?\n```/)[1].replace(/\r\n/g, '\n'), RP_EVENT_GUIDE.replace(/\r\n/g, '\n'));
});
