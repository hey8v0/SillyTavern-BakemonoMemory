import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../src/rp-core/ledger.js';
import { createProjection } from '../src/rp-core/domain.js';
import { sourceSnapshot } from '../src/rp-core/source.js';
import { prepareExtraction } from '../src/rp-core/extraction.js';

test('model temporary IDs and output order do not create new entities on reextraction', () => {
    const source = sourceSnapshot('甲到了。乙到了。两人结为朋友。', { messageId: 'm', variantId: 'v' });
    const events = (a, b, r) => [
        { track: 'facts', action: 'person_created', data: { id: a, name: '甲' }, excerpt: '甲到了' },
        { track: 'facts', action: 'person_created', data: { id: b, name: '乙' }, excerpt: '乙到了' },
        { track: 'facts', action: 'relationship_established', data: { id: r, from: a, to: b, kind: 'friend' }, excerpt: '两人结为朋友' },
    ];
    const raw = events => JSON.stringify({ version: 1, events });
    const first = prepareExtraction(createLedger(createProjection()), raw(events('a', 'b', 'r')), source, { floor: 0, autoApply: true });
    assert.equal(first.core.facts.length, 3);
    assert.notEqual(first.projection.projection.people[0].id, 'a');
    const next = prepareExtraction(first.core, raw(events('new1', 'new2', 'new3').reverse()), source, { floor: 1, autoApply: true });
    assert.equal(next.core.facts.length, 3);
    assert.deepEqual(next.items.map(item => item.change), ['unchanged', 'unchanged', 'unchanged']);
});

test('two occurrences stay separate and duplicate temporary identity is rejected', () => {
    const source = sourceSnapshot('甲来了。甲来了。', { messageId: 'm', variantId: 'v' });
    const events = [0, 4].map((start, index) => ({ track: 'facts', action: 'person_created', data: { id: 'p' + index, name: '甲' }, excerpt: '甲来了', span: { start, end: start + 3 } }));
    const result = prepareExtraction(createLedger(createProjection()), JSON.stringify({ version: 1, events }), source, { floor: 0, autoApply: true });
    assert.equal(new Set(result.projection.projection.people.map(item => item.id)).size, 2);
    events[1].data.id = events[0].data.id;
    const invalid = prepareExtraction(createLedger(createProjection()), JSON.stringify({ version: 1, events }), source, { floor: 0, autoApply: true });
    assert.equal(invalid.core.facts.length, 0);
    assert.equal(invalid.projection.projection.people.length, 0);
    assert.deepEqual(invalid.core.batches[0].protocolIssues.map(issue => issue.code), ['duplicate_identity', 'duplicate_identity']);
});
