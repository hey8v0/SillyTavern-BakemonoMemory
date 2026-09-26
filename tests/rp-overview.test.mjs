import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjection } from '../src/rp-core/domain.js';
import { selectStoryOverview, createRpStatePresentation } from '../src/features/rp-state-presentation.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const ui = createRpStatePresentation({ escapeHtml: esc });
function crowded() {
    const view = createProjection();
    view.clock.date = '2025-10-16';
    view.scene = { location: 'shop', present: Array.from({ length: 8 }, (_, i) => 'p' + i) };
    view.locations = [{ id: 'shop', name: '旧书店' }, { id: 'sea', name: '海边' }];
    view.people = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `人物${i}`, location: i < 8 ? 'shop' : 'sea' }));
    view.relationships = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, from: `p${i}`, to: `p${i + 1}`, kind: 'partner', mutual: i !== 0, status: 'active' }));
    view.plans = Array.from({ length: 25 }, (_, i) => ({ id: `plan${i}`, title: `约定${i}`, due: `2025-11-${String(i + 1).padStart(2, '0')}`, participants: ['p0'], status: 'accepted' }));
    view.items = Array.from({ length: 25 }, (_, i) => ({ id: `item${i}`, name: `物品${i}`, holder: `p${i}`, status: 'available' }));
    return view;
}

test('story overview is bounded and leaves the full projection unchanged', () => {
    const view = crowded(), before = JSON.stringify(view);
    const overview = selectStoryOverview(view);
    assert.equal(overview.people.length, 4);
    assert.equal(overview.relationships.length, 3);
    assert.equal(overview.plans.length, 2);
    assert.equal(overview.items.length, 2);
    assert.equal(overview.peopleRemaining, 26);
    assert.equal(overview.relationshipsRemaining, 22);
    assert.equal(overview.plansRemaining, 23);
    assert.equal(overview.itemsRemaining, 23);
    assert.equal(JSON.stringify(view), before);
    assert.deepEqual(selectStoryOverview(view), overview);
});

test('current cast and active relationships take priority, then actual recent changes', () => {
    const view = crowded();
    view.relationships[0].status = 'ended';
    const overview = selectStoryOverview(view, [{ sequence: 50, data: { id: 'r5' } }, { sequence: 51, data: { id: 'r24' } }]);
    assert.equal(overview.relationships[0].id, 'r5');
    assert.ok(!overview.relationships.some(item => item.id === 'r0' || item.id === 'r24'));
    assert.ok(overview.people.every(item => item.location === 'shop'));
});

test('nearest open plans sort by story deadline, unknown and completed do not displace them', () => {
    const view = crowded();
    view.plans[0].status = 'completed';
    view.plans[1].due = null;
    view.plans[24].due = '2025-10-16';
    const overview = selectStoryOverview(view);
    assert.deepEqual(overview.plans.map(item => item.id), ['plan24', 'plan2']);
});

test('current held items take priority without claiming ownership or reviving consumed items', () => {
    const view = crowded();
    view.items[0].status = 'destroyed';
    view.items[1].quantity = 0;
    view.items[2].quantity = null;
    view.items[2].owner = 'p29';
    view.items[2].loan = { from: 'p29', to: 'p2' };
    const overview = selectStoryOverview(view, [{ sequence: 50, data: { id: 'item24' } }]);
    assert.deepEqual(overview.items.map(item => item.id), ['item2', 'item3']);
    assert.equal(overview.items[0].quantity, null);
    assert.equal(overview.items[0].owner, 'p29');
});

test('separate locations are not silently presented as one current scene', () => {
    const view = crowded();
    view.scene = null;
    assert.equal(selectStoryOverview(view).location, null);
    assert.equal(selectStoryOverview(view).peopleLabel, '人物');
    view.people.forEach(person => { person.location = 'shop'; });
    assert.equal(selectStoryOverview(view).location, null, 'last known positions do not create a current scene');
    view.scene = { location: 'sea' };
    const overview = selectStoryOverview(view);
    assert.equal(overview.location.id, 'sea');
    assert.equal(overview.peopleLabel, '人物', 'known people are not falsely labelled present at an empty scene');
});

test('overview uses direct date place person relationship plan and item targets in a single sheet', () => {
    const view = crowded();
    const html = ui.overview(view, { floor: 42 }, null, [], []);
    assert.match(html, /class="rp-slate/);
    assert.match(html, /data-rp-action="clock"/);
    for (const kind of ['locations', 'people', 'relationships', 'plans', 'items']) assert.match(html, new RegExp('data-rp-kind="' + kind + '"'));
    assert.doesNotMatch(html, /rp-overview-link|rp-scene-actions|场景详情/);
    assert.doesNotMatch(html, /<svg/, 'thirty people do not fit a relationship graph; the list is used instead');
    assert.match(html, /其余 22 段关系/);
    assert.match(html, /data-rp-action="relationships"/);
    assert.match(html, /data-rp-action="people"/);
    assert.match(html, /data-rp-action="locations"/);
    assert.match(html, /data-rp-action="history"/);
});

test('empty domains do not generate category blocks, but closed records remain reachable', () => {
    const view = createProjection();
    const html = ui.overview(view, null, null, [], []);
    assert.doesNotMatch(html, /rp-story-relations|rp-story-plans|rp-story-items|暂无记录/);
    view.relationships = [{ id: 'r', from: 'a', to: 'b', status: 'ended' }];
    view.plans = [{ id: 'p', title: '过去约定', status: 'completed' }];
    view.items = [{ id: 'i', name: '过去物品', status: 'destroyed' }];
    const closed = ui.overview(view, null, null, [], []);
    assert.match(closed, /其余 1 段关系/);
    assert.match(closed, /其余 1 项约定/);
    assert.match(closed, /其余 1 件物品/);
});

test('overview escapes names and IDs, preserves direction, floor and unknown time', () => {
    const view = crowded();
    view.people[0].name = '<img src=x onerror=alert(1)>';
    view.items[0].id = 'x" onclick="bad';
    view.clock = { description: '雨季' };
    const html = ui.overview(view, { floor: 42 }, 2, [], []);
    assert.match(html, /&lt;img/);
    assert.match(html, /x&quot; onclick=&quot;bad/);
    assert.doesNotMatch(html, /<img| onclick="bad|第 42 楼/);
    assert.match(html, /第 2 楼/);
    assert.match(html, /雨季/);
    assert.match(html, /→/);
});

test('relationship graph draws the scene and its direct relations, up to six people', () => {
    const view = createProjection();
    view.scene = { location: 'forge', present: ['a', 'b'] };
    view.locations = [{ id: 'forge', name: '铁匠铺' }];
    view.people = [{ id: 'a', name: '旅人' }, { id: 'b', name: '格伦' }, { id: 'c', name: '莉娜' }, { id: 'd', name: '<b>领主</b>' }];
    view.relationships = [{ id: 'r1', from: 'a', to: 'c', kind: '受托人', status: 'active' }, { id: 'r2', from: 'c', to: 'b', kind: '老朋友', mutual: true, status: 'active' }];
    const info = [{ id: 'o', track: 'observations', data: { speaker: 'a', subject: 'b', description: '格伦似乎知道内情' } }];
    const svg = ui.relationGraph(view, info);
    assert.match(svg, /<svg/);
    for (const id of ['a', 'b', 'c']) assert.match(svg, new RegExp('data-rp-id="' + id + '"'));
    assert.doesNotMatch(svg, /data-rp-id="d"/, 'unrelated people stay off the graph');
    assert.match(svg, /铁匠铺 · 在场/);
    assert.match(svg, /marker-start/, 'mutual relations point both ways');
    assert.match(svg, /is-guess/);
    view.people.push(...Array.from({ length: 5 }, (_, i) => ({ id: 'x' + i, name: '路人' + i })));
    view.relationships.push(...Array.from({ length: 5 }, (_, i) => ({ id: 'rx' + i, from: 'a', to: 'x' + i, kind: '同行', status: 'active' })));
    assert.equal(ui.relationGraph(view, info), '', 'eight related people fall back to the list');
});

test('plan remaining time uses hours when story time and deadline are minute-precise', async () => {
    const { planRemaining } = await import('../src/features/rp-state-presentation.js');
    const view = { clock: { date: '1023-10-14T23:40' } };
    assert.equal(planRemaining({ status: 'accepted', due: '1023-10-15T06:00' }, view), '还剩 6 小时 20 分');
    assert.equal(planRemaining({ status: 'accepted', due: '1023-10-14T22:00' }, view), '已逾期');
    assert.equal(planRemaining({ status: 'completed', due: '1023-10-15T06:00' }, view), '');
    assert.equal(planRemaining({ status: 'proposed', dueDescription: '通行证到手后' }, view), '通行证到手后');
});
