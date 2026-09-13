import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjection, applyDomainFact } from '../src/rp-core/domain.js';
import { deriveTimeViews } from '../src/rp-core/time-views.js';

test('clock-derived views do not turn overdue promises into completed or failed events', () => {
    const state = createProjection();
    state.clock.date = '2025-03-01';
    state.people = [{ id: 'a', birthDate: '2000-02-29', states: [] }];
    state.relationships = [{ id: 'r', since: '2024-02-29', status: 'active' }];
    state.plans = [{ id: 'p', due: '2025-02-28', status: 'accepted' }];
    const before = structuredClone(state), view = deriveTimeViews(state);
    assert.equal(view.people[0].age.value, 25);
    assert.equal(view.relationships[0].anniversary.nextDate, '2025-03-01');
    assert.equal(view.plans[0].timing.status, 'overdue');
    assert.equal(view.plans[0].status, 'accepted');
    assert.deepEqual(state, before);
    state.clock.date = '2025-02-28';
    assert.equal(deriveTimeViews(state).people[0].age.value, 24);
    assert.equal(deriveTimeViews(state).plans[0].timing.status, 'due');
});

test('reported age retains its original time basis and does not invent a birthday', () => {
    let state = createProjection();
    state.clock.date = '2000-01-01';
    state = applyDomainFact(state, { action: 'person_created', data: { id: 'a', name: '甲', age: 19 } });
    state.clock.date = '2025-01-01';
    const person = deriveTimeViews(state).people[0];
    assert.equal(person.birthDate, null);
    assert.deepEqual(person.age, { value: 19, asOf: '2000-01-01', basis: 'reported' });
});

test('ending a temporary state while story time is unknown still ends the state', () => {
    let state = createProjection();
    for (const event of [
        { action: 'person_created', data: { id: 'a', name: '甲' } },
        { action: 'person_state_started', data: { id: 'a', stateId: 't', description: '受伤' } },
        { action: 'person_state_ended', data: { id: 'a', stateId: 't' } },
    ]) state = applyDomainFact(state, event);
    const view = deriveTimeViews(state);
    assert.equal(view.people[0].states[0].active, false);
    assert.equal(view.people[0].age.value, null);
});
