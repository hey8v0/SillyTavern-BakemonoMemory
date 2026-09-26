import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjection } from '../src/rp-core/domain.js';
import { buildStatePage } from '../src/rp-core/state-view.js';
import { createRpStatePresentation } from '../src/features/rp-state-presentation.js';

function fixture() {
    const projection = createProjection();
    projection.people = [{ id: 'a', name: '甲', states: [{ id: 'pain', active: true, description: '胃痛持续' }, { id: 'cold', active: false, ended: true, description: '旧伤' }] }, { id: 'b', name: '乙', states: [] }];
    projection.scene = { location: 'shop', present: ['a', 'b'] };
    projection.locations = [{ id: 'shop', name: '书店' }];
    projection.relationships = [{ id: 'r', from: 'a', to: 'b', kind: 'partner', status: 'active', mutual: true }];
    projection.items = [{ id: 'key', name: '钥匙', holder: 'b' }];
    const core = { claims: [{ id: 'c', sequence: 1, floor: 0, data: { speaker: 'a', subject: 'b', description: '否认交往' } }], observations: [], decisions: [] };
    return { core, view: { projection } };
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

test('directory searches current person status and groups information before objects', () => {
    const { core, view } = fixture();
    const page = buildStatePage(core, view, { tab: 'directory' });
    assert.deepEqual(page.rows.map(row => row.kind), ['people', 'people', 'relationships', 'claims', 'items', 'locations']);
    assert.match(page.rows[0].detail, /胃痛持续/);
    assert.equal(page.rows[1].detail, '在场');
    assert.equal(buildStatePage(core, view, { tab: 'directory', search: '胃痛' }).total, 1);
    assert.equal(buildStatePage(core, view, { tab: 'directory', search: '旧伤' }).total, 0);
});

test('directory rows expose avatars, compact relationship and statement labels and safe text', () => {
    const { core, view } = fixture();
    view.projection.people[0].name = '<img src=x onerror=bad>';
    const html = createRpStatePresentation({ escapeHtml: esc }).rows(buildStatePage(core, view, { tab: 'directory' }).rows, view.projection, { directory: true });
    assert.match(html, /data-rp-group="people"/);
    assert.match(html, /data-rp-group="relationships"/);
    assert.match(html, /data-rp-group="claims"/);
    assert.match(html, /class="rp-glyph"/);
    assert.match(html, /胃痛持续/);
    assert.match(html, /已成立/);
    assert.match(html, /否认交往/);
    assert.doesNotMatch(html, /<img|onerror="|>旧伤</);
    assert.match(html, /&lt;img/);
});

test('directory filters and page counts stay bounded without changing saved state', () => {
    const { core, view } = fixture();
    for (let i = 0; i < 45; i++) view.projection.people.push({ id: 'p' + i, name: '人物' + i, states: [] });
    const before = JSON.stringify({ core, view });
    const page = buildStatePage(core, view, { tab: 'directory', filter: 'people', page: 1 });
    assert.equal(page.total, 47); assert.equal(page.rows.length, 20); assert.equal(page.pages, 3);
    assert.ok(page.rows.every(row => row.kind === 'people'));
    assert.equal(JSON.stringify({ core, view }), before);
});
