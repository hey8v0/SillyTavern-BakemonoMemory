import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjection, applyDomainFact } from '../src/rp-core/domain.js';
function fixture() {
    let state = createProjection();
    const act = (action, data) => state = applyDomainFact(state, { action, data });
    act('person_created', { id: 'a', name: '甲' });
    act('person_created', { id: 'b', name: '乙' });
    return { act, get state() { return state; } };
}
test('relationship conflict and apology do not establish or end romance', () => {
    const f = fixture();
    assert.throws(() => f.act('relationship_established', { id: 'r', from: 'a', to: 'b', kind: 'romantic' }), /确认/);
    f.act('relationship_established', { id: 'r', from: 'a', to: 'b', kind: 'romantic', mutual: true });
    f.act('relationship_conflict', { id: 'r', description: '争执' });
    f.act('relationship_milestone', { id: 'r', description: '道歉' });
    assert.equal(f.state.relationships[0].status, 'active');
    assert.equal(Object.hasOwn(f.state.relationships[0], 'affection'), false);
});
test('borrowing preserves ownership and returning validates the actual loan', () => {
    const f = fixture();
    f.act('item_acquired', { id: 'ring', name: '戒指', owner: 'a', holder: 'a', quantity: 1 });
    f.act('item_lent', { id: 'ring', from: 'a', to: 'b', loanId: 'loan' });
    assert.equal(f.state.items[0].owner, 'a');
    assert.equal(f.state.items[0].holder, 'b');
    assert.throws(() => f.act('item_returned', { id: 'ring', loanId: 'wrong' }), /借用/);
    f.act('item_returned', { id: 'ring', loanId: 'loan' });
    assert.equal(f.state.items[0].holder, 'a');
    assert.throws(() => f.act('item_consumed', { id: 'ring', quantity: 2 }), /数量/);
    assert.equal(f.state.items[0].quantity, 1);
});
test('unknown quantities are not treated as zero; plans require valid transitions', () => {
    const f = fixture();
    f.act('item_acquired', { id: 'coins', name: '金币', holder: 'a' });
    assert.equal(f.state.items[0].quantity, null);
    assert.throws(() => f.act('item_quantity_changed', { id: 'coins', delta: -1 }), /数量/);
    f.act('plan_proposed', { id: 'p', title: '见面', participants: ['a', 'b'] });
    assert.throws(() => f.act('plan_completed', { id: 'p' }), /接受/);
    f.act('plan_accepted', { id: 'p' });
    f.act('plan_completed', { id: 'p' });
    assert.equal(f.state.plans[0].status, 'completed');
});
test('locations reject cycles and explicit movement updates only current location', () => {
    const f = fixture();
    f.act('location_created', { id: 'house', name: '宅邸' });
    f.act('location_created', { id: 'room', name: '房间', parent: 'house' });
    assert.throws(() => f.act('location_reparented', { id: 'house', parent: 'room' }), /循环/);
    f.act('person_moved', { id: 'a', location: 'room' });
    assert.equal(f.state.people[0].location, 'room');
});
test('relative advances keep their recorded anchor and cannot drift after correction', () => {
    const f = fixture();
    f.act('clock_set', { date: '2026-09-10' });
    f.act('clock_advanced', { from: '2026-09-10', days: 3, to: '2026-09-13' });
    assert.equal(f.state.clock.date, '2026-09-13');
    assert.throws(() => f.act('clock_advanced', { from: '2026-09-10', days: 3, to: '2026-09-13' }), /时间依据/);
});
