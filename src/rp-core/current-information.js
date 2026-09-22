const isCurrentRpRecord = (view, item) => !view?.sourceStates?.[item.id] || view.sourceStates[item.id] === 'current';

export function informationName(projection, value) {
    if (!value) return '未知';
    const entity = ['people', 'items', 'locations', 'plans'].flatMap(kind => projection[kind] || []).find(item => item.id === value);
    return entity?.name || entity?.title || (/^(entity:|temporary:|state:|user-|@rp)/.test(String(value)) ? '未知对象' : String(value));
}
export function informationInvolves(item, people) {
    const tokens = new Set(people.flatMap(person => [person.id, person.name, ...(person.aliases || [])]));
    return [item.data.speaker, item.data.subject, ...(Array.isArray(item.data.heardBy) ? item.data.heardBy : [])].some(value => value && tokens.has(value));
}

// Shared by the story sheet and compiler: old branches and retractions are
// history, not current character knowledge.
export function currentInformation(core, view, { floor = null } = {}) {
    const visible = item => floor == null || item.floor <= floor;
    const removed = new Set((core.decisions || []).filter(visible).filter(item => ['retract', 'supersede'].includes(item.action)).map(item => item.factId));
    const seen = new Set();
    return ['claims', 'observations'].flatMap(track => (core[track] || []).map(item => ({ ...item, track })))
        .filter(item => visible(item) && !item.superseded && !removed.has(item.id) && isCurrentRpRecord(view, item))
        .map(item => ({ ...item, data: { ...item.data, heardBy: Array.isArray(item.data?.heardBy) ? item.data.heardBy.filter(value => typeof value === 'string') : [] } }))
        .sort((a, b) => b.sequence - a.sequence).filter(item => {
            const data = item.data || {}, key = JSON.stringify([item.track, data.speaker, data.subject, data.description]);
            if (seen.has(key) || !data.description) return false;
            seen.add(key); return true;
        });
}
