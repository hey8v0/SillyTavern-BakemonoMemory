import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoryDate, advanceStoryDate, ageAt, anniversaryAt, planTimeState } from '../src/rp-core/clock.js';

test('story dates validate Gregorian dates without using the machine timezone', () => {
    assert.equal(readStoryDate('1889-10-15').iso, '1889-10-15');
    assert.equal(readStoryDate('2025-02-29'), null);
    assert.equal(readStoryDate('异历红月'), null);
    assert.equal(readStoryDate('2024-02-29T23:45').precision, 'minute');
    assert.equal(readStoryDate('2024-02-29T25:00'), null);
    assert.equal(advanceStoryDate('0099-12-31', 1), '0100-01-01');
    assert.equal(advanceStoryDate('1889-10-15T23:45', 3), '1889-10-18T23:45');
    assert.equal(advanceStoryDate('', 3), null);
});

test('age and anniversaries use March 1 for February 29 in non-leap years', () => {
    assert.equal(ageAt('2000-02-29', '2025-02-28'), 24);
    assert.equal(ageAt('2000-02-29', '2025-03-01'), 25);
    assert.equal(ageAt(null, '2025-03-01'), null);
    assert.equal(ageAt('2026-01-01', '2025-03-01'), null);
    assert.equal(anniversaryAt('2024-02-29', '2025-02-28').nextDate, '2025-03-01');
});

test('clock derives due state without changing plan fulfillment', () => {
    const plan = { status: 'accepted', due: '2026-09-12' };
    assert.equal(planTimeState(plan, '2026-09-12T23:59').status, 'due');
    assert.equal(planTimeState(plan, '2026-09-13').status, 'overdue');
    assert.equal(planTimeState(plan, '2026-09-11').status, 'upcoming');
    assert.equal(planTimeState(plan, '异历').status, 'unknown');
    assert.equal(plan.status, 'accepted');
    assert.equal(planTimeState({ due: '2026-09-12T15:00' }, '2026-09-12').status, 'unknown');
});
