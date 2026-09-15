import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpStatePresentation, storyDateLabel, planStatusLabel, locationTrail, relatedFacts } from '../src/features/rp-state-presentation.js';
import { createProjection } from '../src/rp-core/domain.js';
import { createLedger } from '../src/rp-core/ledger.js';
import { buildStatePage } from '../src/rp-core/state-view.js';
import { createThemeSchema, refreshBuiltInThemePresets } from '../src/theme/theme-schema.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const ui = createRpStatePresentation({ escapeHtml: esc });

test('story date formatting uses story calendar and never invents a time of day', () => {
    assert.deepEqual(storyDateLabel('2025-10-16'), { date: '10 月 16 日', year: '2025 年', time: '周四' });
    assert.equal(storyDateLabel('2025-10-16T18:30').time, '周四 · 18:30');
    assert.equal(storyDateLabel('秋日').date, '');
    assert.equal(storyDateLabel('2025-02-29').date, '');
});

test('plan captions separate fulfillment and expiry, including unknown and zero-day remaining time', () => {
    assert.equal(planStatusLabel({ status: 'accepted', timing: { status: 'upcoming', remainingDays: 2 } }), '已接受 · 还有 2 天');
    assert.equal(planStatusLabel({ status: 'accepted', timing: { status: 'upcoming', remainingDays: 0 } }), '已接受 · 稍后到期');
    assert.equal(planStatusLabel({ status: 'accepted', timing: { status: 'overdue' } }), '已接受 · 已逾期');
    assert.equal(planStatusLabel({ status: 'completed', timing: { status: 'overdue' } }), '已完成');
    assert.equal(planStatusLabel({ status: 'proposed', timing: { status: 'unknown' } }), '提议中');
});

test('state presentation is read-only, escaped, and keeps directed relationships and item ownership distinct', () => {
    const projection = createProjection();
    projection.people = [{ id: 'a', name: '<img src=x>', states: [] }, { id: 'b', name: '乙', states: [] }];
    projection.relationships = [{ id: 'r', from: 'a', to: 'b', mutual: false, kind: 'partner', status: 'active', elapsedDays: 0 }];
    projection.items = [{ id: 'watch', name: '怀表', owner: 'a', holder: 'b', quantity: null, loan: { from: 'a', to: 'b' } }];
    const core = createLedger(projection), view = { projection, applied: [], pending: [] };
    const before = JSON.stringify({ projection, core });
    const html = ui.rows(buildStatePage(core, view, { tab: 'people', filter: 'relationships' }).rows, projection);
    assert.match(html, /&lt;img src=x&gt;/);
    assert.doesNotMatch(html, /<img|↔/);
    assert.match(html, /已持续 0 天/);
    const detail = ui.entityDetail('items', projection.items[0], core, projection, null);
    assert.match(detail, /持有者<\/dt><dd>乙/);
    assert.match(detail, /所有者<\/dt><dd>&lt;img src=x&gt;/);
    assert.match(detail, /数量<\/dt><dd>尚未记录/);
    assert.match(detail, /借用中/);
    assert.equal(JSON.stringify({ projection, core }), before);
});

test('people and relationships can be independently filtered without losing pagination', () => {
    const projection = createProjection();
    projection.people = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `人${i}` }));
    projection.relationships = [{ id: 'r', from: 'p0', to: 'p1', kind: 'partner' }];
    const core = createLedger(projection), view = { projection, applied: [], pending: [] };
    assert.equal(buildStatePage(core, view, { tab: 'people', filter: 'relationships' }).rows[0].id, 'r');
    assert.equal(buildStatePage(core, view, { tab: 'people', filter: 'people', page: 1 }).rows.length, 20);
    assert.equal(buildStatePage(core, view, { tab: 'people' }).total, 41);
});

test('entity source details and scene floor exclude later knowledge; location cycles terminate', () => {
    const view = createProjection(), core = createLedger(view);
    view.locations = [{ id: 'a', name: '镇', parent: 'b' }, { id: 'b', name: '店', parent: 'a' }];
    core.facts = [{ id: 'f1', floor: 1, sequence: 1, data: { id: 'p' } }, { id: 'f2', floor: 4, sequence: 2, data: { id: 'p' } }];
    assert.equal(locationTrail(view, 'a'), '店 / 镇');
    assert.equal(relatedFacts(core, view, 'people', 'p', 2).length, 1);
    const html = ui.scene(view, { floor: 10 }, 2);
    assert.match(html, /第 2 楼/);
    assert.doesNotMatch(html, /第 10 楼/);
});

const schema = createThemeSchema({ getHash: value => value.length });
const themeOptions = { sanitizeCustomTheme: schema.sanitizeCustomTheme, normalizeCustomThemePreset: schema.normalizeCustomThemePreset };
test('warm-paper themes carry the approved day and night palettes with readable text', () => {
    const [day, night] = schema.builtInCustomThemeDefinitions;
    assert.equal(day.tokens.paper, '#f6f3eb');
    assert.equal(day.tokens.accentStrong, '#434e70');
    assert.equal(night.tokens.paper, '#27292c');
    assert.equal(night.tokens.accentStrong, '#c0cbe4');
    function luminance(hex) {
        const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    }
    for (const theme of [day, night]) {
        assert.equal(theme.effects.grain, 0);
        for (const text of ['ink', 'muted', 'accentStrong']) {
            for (const surface of ['paper', 'paperRaised', 'paperSoft']) {
                const values = [luminance(theme.tokens[text]), luminance(theme.tokens[surface])].sort((a, b) => a - b);
                assert.ok((values[1] + .05) / (values[0] + .05) >= 4.5, `${theme.name}: ${text}/${surface}`);
            }
        }
    }
});

test('installed built-in palette upgrades its active snapshot, preserves custom themes, and is idempotent', () => {
    const old = structuredClone(schema.builtInCustomThemeDefinitions[0]);
    old.tokens.paper = '#eee4ce';
    const custom = { ...structuredClone(old), id: 'my-theme', name: '我的主题' };
    const settings = { themePresets: [old, custom], customTheme: schema.sanitizeCustomTheme(old), selectedThemePresetId: old.id, themeMode: 'custom' };
    refreshBuiltInThemePresets(settings, schema.builtInCustomThemeDefinitions, themeOptions);
    assert.equal(settings.customTheme.tokens.paper, '#f6f3eb');
    assert.deepEqual(settings.themePresets.find(theme => theme.id === custom.id), custom);
    assert.equal(settings.selectedThemePresetId, old.id);
    const once = JSON.stringify(settings);
    refreshBuiltInThemePresets(settings, schema.builtInCustomThemeDefinitions, themeOptions);
    assert.equal(JSON.stringify(settings), once);
});

test('built-in refresh preserves separately edited active values and following-host mode', () => {
    const old = structuredClone(schema.builtInCustomThemeDefinitions[1]);
    old.tokens.paper = '#211e1a';
    const settings = { themePresets: [old], customTheme: { ...schema.sanitizeCustomTheme(old), name: '单独编辑的主题' }, selectedThemePresetId: old.id, themeMode: 'tavern' };
    const custom = JSON.stringify(settings.customTheme);
    refreshBuiltInThemePresets(settings, schema.builtInCustomThemeDefinitions, themeOptions);
    assert.equal(JSON.stringify(settings.customTheme), custom);
    assert.equal(settings.themeMode, 'tavern');
});
