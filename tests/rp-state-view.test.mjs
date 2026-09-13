import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatePage, describeRecord, createStateNavigation } from '../src/rp-core/state-view.js';
import { createProjection } from '../src/rp-core/domain.js';
import { createLedger } from '../src/rp-core/ledger.js';

test('historical list hides later knowledge and uses only then-visible retractions', () => {
    const projection = createProjection(), core = createLedger(projection);
    core.facts = [{ id: 'f', sequence: 1, floor: 2, action: 'clock_set', data: {} }];
    core.claims = [{ id: 'later', sequence: 3, floor: 8, action: 'statement', data: {} }];
    core.decisions = [{ sequence: 4, floor: 9, action: 'retract', factId: 'f' }];
    core.candidates = [{ id: 'q', floor: 8, status: 'pending', data: {} }];
    const view = { projection, applied: ['f'], pending: [] };
    const past = buildStatePage(core, view, { tab: 'history', floor: 3 });
    assert.equal(past.total, 1);
    assert.equal(past.rows[0].status, '事实');
    assert.equal(buildStatePage(core, view, { tab: 'history', floor: 3, filter: 'pending' }).total, 0);
    assert.equal(buildStatePage(core, { ...view, applied: [] }, { tab: 'history', filter: 'facts' }).rows[0].status, '已撤回');
});

test('state pages paginate, resolve relationships and keep user-facing names separate from IDs', () => {
    const projection = createProjection();
    projection.people = Array.from({ length: 45 }, (_, i) => ({ id: 'p' + i, name: '人物' + i }));
    projection.relationships = [{ id: 'r', from: 'p0', to: 'p1', kind: 'partner', status: 'active' }];
    const core = createLedger(projection);
    const view = { projection, pending: [], applied: [] };
    const page = buildStatePage(core, view, { tab: 'people', page: 1, search: '' });
    assert.equal(page.rows.length, 20);
    assert.equal(page.total, 46);
    const searched = buildStatePage(core, view, { tab: 'people', search: '人物0', page: 99 });
    assert.equal(searched.page, 0);
    assert.equal(searched.total, 2);
    assert.match(searched.rows[1].title, /人物0.*人物1/);
    assert.match(describeRecord({ action: 'relationship_conflict', data: { id: 'r', description: '争执' } }, projection), /人物0/);
});

test('history exposes track and invalidity; pending candidates never masquerade as confirmed history', () => {
    const projection = createProjection(), core = createLedger(projection);
    core.facts.push({ id: 'f', sequence: 1, floor: 2, action: 'clock_set', data: { date: '2026-01-01' } });
    core.claims.push({ id: 'c', sequence: 2, floor: 2, action: 'claim', data: { description: '他这么说' } });
    core.candidates.push({ id: 'q', status: 'pending', action: 'person_created', data: { name: '未确认' } });
    const result = buildStatePage(core, { projection, applied: [], pending: [{ factId: 'f' }] }, { tab: 'history' });
    assert.equal(result.total, 2);
    assert.equal(result.rows[0].track, 'claims');
    assert.equal(result.rows[1].status, '待复核');
    assert.equal(buildStatePage(core, { projection, applied: [], pending: [] }, { tab: 'history', filter: 'pending' }).total, 1);
});

test('state navigation is isolated by chat, preserves page, and detail back restores list', () => {
    const navigation = createStateNavigation(), a = {}, b = {};
    navigation.update(a, { tab: 'world', filter: 'items', page: 2, search: '戒指' });
    navigation.update(a, { selected: { kind: 'items', id: 'ring' } });
    assert.equal(navigation.get(b).page, 0);
    navigation.update(a, { selected: null });
    assert.equal(navigation.get(a).page, 2);
    assert.equal(navigation.get(a).search, '戒指');
});
