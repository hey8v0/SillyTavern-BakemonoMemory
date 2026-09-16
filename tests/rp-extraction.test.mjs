import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../src/rp-core/ledger.js';
import { createProjection } from '../src/rp-core/domain.js';
import { sourceSnapshot } from '../src/rp-core/source.js';
import { prepareExtraction, decideCandidate } from '../src/rp-core/extraction.js';
function fixture() {
    const projection = createProjection();
    projection.people = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }];
    projection.relationships = [{ id: 'r', from: 'a', to: 'b', status: 'active', conflicts: [], milestones: [] }];
    return createLedger(projection, 0);
}
const source = sourceSnapshot('两人争执。他承诺明天见面。', { messageId: 'm', variantId: 'v' });
const conflict = { track: 'facts', action: 'relationship_conflict', data: { id: 'r', description: '争执' }, excerpt: '两人争执' };
const promise = { track: 'facts', action: 'promise_created', data: { id: 'promise', title: '见面', participants: ['a', 'b'] }, excerpt: '他承诺明天见面' };
const payload = events => JSON.stringify({ version: 1, events });
test('reextraction preserves existing facts and previews new candidates', () => {
    const first = prepareExtraction(fixture(), payload([conflict]), source, { floor: 1, autoApply: true });
    assert.equal(first.core.facts.length, 1);
    const again = prepareExtraction(first.core, payload([promise, conflict]), source, { floor: 2, autoApply: true });
    assert.equal(again.core.facts.length, 1);
    assert.equal(again.items.find(item => item.candidate.action === 'promise_created').change, 'added');
    assert.equal(again.items.find(item => item.candidate.action === 'relationship_conflict').change, 'unchanged');
    assert.equal(again.core.candidates.filter(item => item.status === 'pending').length, 1);
});
test('omitted and modified events never silently replace confirmed decisions', () => {
    const first = prepareExtraction(fixture(), payload([conflict]), source, { floor: 1, autoApply: true });
    const omitted = prepareExtraction(first.core, payload([]), source, { floor: 2 });
    assert.equal(omitted.items[0].change, 'not_detected');
    assert.equal(omitted.core.facts.length, 1);
    const changed = prepareExtraction(first.core, payload([{ ...conflict, data: { id: 'r', description: '激烈争执' } }]), source, { floor: 2 });
    assert.equal(changed.items[0].change, 'modified');
    assert.equal(changed.core.facts[0].data.description, '争执');
});
test('ignored candidates stay ignored across repeated extraction', () => {
    const first = prepareExtraction(fixture(), payload([conflict]), source, { floor: 1 });
    const ignored = decideCandidate(first.core, first.core.candidates[0].id, 'ignore', source, { floor: 1 });
    const again = prepareExtraction(ignored, payload([conflict]), source, { floor: 2, autoApply: true });
    assert.equal(again.core.facts.length, 0);
    assert.equal(again.core.candidates[0].status, 'ignored');
});
test('claims remain separate and stale evidence cannot be confirmed', () => {
    const first = prepareExtraction(fixture(), payload([{ ...conflict, track: 'claims' }]), source, { floor: 1 });
    const accepted = decideCandidate(first.core, first.core.candidates[0].id, 'accept', source, { floor: 1 });
    assert.equal(accepted.facts.length, 0);
    assert.equal(accepted.claims.length, 1);
    const changed = sourceSnapshot('实际没有争执。', { messageId: 'm', variantId: 'v' });
    assert.throws(() => decideCandidate(first.core, first.core.candidates[0].id, 'accept', changed, { floor: 1 }), /来源/);
});
test('protocol rejects dangerous keys and unsupported versions', () => {
    assert.throws(() => prepareExtraction(fixture(), '{"version":1,"events":[],"__proto__":{}}', source, { floor: 1 }), /字段/);
    assert.throws(() => prepareExtraction(fixture(), '{"version":99,"events":[]}', source, { floor: 1 }), /版本/);
});

test('invalid actions are rejected while unresolved prerequisites remain pending', () => {
    const result = prepareExtraction(fixture(), payload([
        { ...conflict, action: 'database_overwrite' },
        { ...conflict, data: { id: 'missing', description: '争执' } },
        conflict,
    ]), source, { floor: 1, autoApply: true });
    assert.equal(result.core.candidates[0].status, 'rejected');
    assert.equal(result.core.candidates[1].status, 'pending');
    assert.match(result.core.candidates[1].reason, /对象/);
    assert.equal(result.core.facts.length, 1);
    assert.throws(() => decideCandidate(result.core, result.core.candidates[0].id, 'accept', source, { floor: 2 }), /已处理/);
});

test('non-current narrative contexts cannot create current-world facts, including through manual acceptance', () => {
    for (const context of ['dream', 'hypothetical', 'flashback']) {
        const result = prepareExtraction(fixture(), payload([{ ...conflict, context }]), source, { floor: 1, autoApply: true });
        assert.equal(result.core.facts.length, 0);
        assert.equal(result.core.candidates[0].status, 'rejected');
        assert.match(result.core.candidates[0].reason, /当前事实/);
        const observed = prepareExtraction(fixture(), payload([{ ...conflict, track: 'observations', context }]), source, { floor: 1, autoApply: true });
        assert.equal(observed.core.observations.length, 1);
        assert.equal(observed.core.observations[0].context, context);
    }
});

test('rejected malformed action parameters do not reject unrelated valid candidates', () => {
    const result = prepareExtraction(fixture(), payload([
        { ...conflict, action: 'item_acquired', data: { id: 'x', name: '戒指', quantity: -2 } },
        { ...conflict, data: { id: 42, description: '争执' } },
        conflict,
    ]), source, { floor: 1, autoApply: true });
    assert.deepEqual(result.core.candidates.map(item => item.status), ['rejected', 'rejected', 'accepted']);
    assert.equal(result.core.facts.length, 1);
});
