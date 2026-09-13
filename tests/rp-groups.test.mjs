import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../src/rp-core/ledger.js';
import { createProjection } from '../src/rp-core/domain.js';
import { sourceSnapshot } from '../src/rp-core/source.js';
import { prepareExtraction, decideCandidate } from '../src/rp-core/extraction.js';
const source = sourceSnapshot('甲和乙到来。他们成为伴侣。钟声响起。', { messageId: 'm', variantId: 'v' });
const people = [
    { track: 'facts', action: 'person_created', data: { id: 'a', name: '甲' }, excerpt: '甲和乙到来', span: { start: 0, end: 5 } },
    { track: 'facts', action: 'person_created', data: { id: 'b', name: '乙' }, excerpt: '乙到来' },
];
const relationship = { track: 'facts', action: 'relationship_established', data: { id: 'r', from: 'a', to: 'b', kind: 'partner', mutual: true }, excerpt: '他们成为伴侣' };
const prepare = events => prepareExtraction(createLedger(createProjection()), JSON.stringify({ version: 1, events }), source, { floor: 1, autoApply: true });
test('ignoring a blocked group dismisses pending members without reviving rejected members', () => {
    const result = prepare([...people, { ...relationship, data: { ...relationship.data, mutual: 'yes' } }]);
    assert.equal(result.core.candidates.filter(item => item.status === 'rejected').length, 1);
    assert.throws(() => decideCandidate(result.core, result.core.candidates[0].id, 'accept', source, { floor: 2 }));
    const next = decideCandidate(result.core, result.core.candidates[0].id, 'ignore', source, { floor: 2 });
    assert.equal(next.facts.length, 0);
    assert.equal(next.candidates.filter(item => item.status === 'pending').length, 0);
    assert.equal(next.candidates.filter(item => item.status === 'rejected').length, 1);
});
test('same-batch creation dependencies apply together regardless of model output order', () => {
    const result = prepare([relationship, ...people]);
    assert.equal(result.core.facts.length, 3);
    assert.equal(result.projection.projection.relationships.length, 1);
});
test('a failed dependent relation keeps its related creations pending, while unrelated facts apply', () => {
    const result = prepare([...people, { ...relationship, data: { ...relationship.data, mutual: false } },
        { track: 'facts', action: 'clock_set', data: { date: '2026-01-01' }, excerpt: '钟声响起' }]);
    assert.equal(result.core.facts.length, 1);
    assert.equal(result.projection.projection.people.length, 0);
    assert.equal(result.core.candidates.filter(item => item.status === 'pending').length, 3);
    assert.throws(() => decideCandidate(result.core, result.core.candidates[0].id, 'accept', source, { floor: 2 }), /双方确认/);
});
