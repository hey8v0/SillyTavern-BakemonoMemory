import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvidenceText, locateEvidence, sourceSnapshot } from '../src/rp-core/source.js';

test('evidence normalizes presentation and retains original spans and negations', () => {
    const raw = '<p>她说：<b>“我不会离开”</b> &amp; 等待。</p>';
    const source = sourceSnapshot(raw, { messageId: 'm1', variantId: 'v1' });
    const result = locateEvidence(source, '她说："我不会离开" & 等待。');
    assert.equal(result.status, 'located');
    assert.match(raw.slice(result.anchor.rawStart, result.anchor.rawEnd), /我不会离开/);
    assert.equal(result.anchor.messageId, 'm1');
    assert.equal(locateEvidence(source, '我会离开').status, 'missing');
    assert.equal(normalizeEvidenceText('**她**\n 没有给他 2 枚戒指').text, '她 没有给他 2 枚戒指');
});

test('repeated evidence requires a verified span instead of guessing an occurrence', () => {
    const source = sourceSnapshot('她点头。她点头。', { messageId: 'm', variantId: 'v' });
    assert.equal(locateEvidence(source, '她点头').status, 'ambiguous');
    const second = locateEvidence(source, '她点头', { start: 4, end: 7 });
    assert.equal(second.status, 'located');
    assert.equal(second.anchor.start, 4);
    assert.equal(locateEvidence(source, '她点头', { start: 5, end: 8 }).status, 'ambiguous');
});

test('excluded components preserve evidence revisions while real source edits invalidate them', () => {
    const identity = { messageId: 'm', variantId: 'v' };
    const options = { excludeTags: ['widget'] };
    const a = sourceSnapshot('她答应了。<widget>一</widget>', identity, options);
    const b = sourceSnapshot('她答应了。<widget><widget>二</widget>三</widget>', identity, options);
    assert.equal(a.revision, b.revision);
    assert.notEqual(a.revision, sourceSnapshot('她拒绝了。', identity).revision);
    assert.throws(() => sourceSnapshot('内容', {}), /身份/);
});
