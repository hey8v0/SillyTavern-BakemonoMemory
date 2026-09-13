import { readStoryDate, ageAt, anniversaryAt, planTimeState } from './clock.js';

function elapsedDays(startValue, endValue) {
    const start = readStoryDate(startValue), end = readStoryDate(endValue);
    if (!start || !end || end.milliseconds < start.milliseconds) return null;
    return Math.floor((end.milliseconds - start.milliseconds) / 86400000);
}

export function deriveTimeViews(projection) {
    const view = structuredClone(projection), clock = view.clock?.date;
    for (const person of view.people) {
        const years = ageAt(person.birthDate, clock);
        person.age = years !== null ? { value: years, asOf: clock, basis: 'birth-date' }
            : person.ageEvidence ? { value: person.ageEvidence.years, asOf: person.ageEvidence.asOf, basis: 'reported' }
                : { value: null, asOf: clock || null, basis: 'unknown' };
        for (const state of person.states || []) {
            const timing = planTimeState({ due: state.expiresAt }, clock);
            const expired = timing.status === 'overdue'
                || (timing.status === 'due' && readStoryDate(state.expiresAt)?.precision === 'minute');
            state.active = !state.ended && state.endedAt == null && !expired;
            state.timing = { ...timing, expired, elapsedDays: elapsedDays(state.startedAt, state.ended ? state.endedAt : clock) };
        }
    }
    for (const relationship of view.relationships) {
        relationship.elapsedDays = elapsedDays(relationship.since, relationship.status === 'ended' ? relationship.endedAt : clock);
        relationship.anniversary = relationship.status === 'active' ? anniversaryAt(relationship.since, clock) : null;
    }
    for (const plan of view.plans) plan.timing = planTimeState(plan, clock);
    return view;
}
