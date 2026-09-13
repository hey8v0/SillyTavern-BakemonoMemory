import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBaselinePreview, suggestBaselineMappings } from '../src/rp-core/migration.js';
test('baseline import preserves owner/custody distinction and never manufactures event history', () => {
    const state = { tableDatabase: { tables: [
        { name: '角色特征表格', columns: ['角色名'], rows: [['甲'], ['乙']] },
        { name: '重要物品表格', columns: ['拥有人', '物品名'], rows: [['甲', '戒指']] },
    ] } };
    const original = JSON.stringify(state), mappings = suggestBaselineMappings(state);
    const preview = buildBaselinePreview(state, mappings);
    assert.equal(preview.issues.length, 0);
    assert.equal(preview.projection.items[0].owner, preview.projection.people[0].id);
    assert.equal(preview.projection.items[0].holder, null);
    assert.equal(preview.projection.items[0].quantity, null);
    assert.equal(JSON.stringify(state), original);
    assert.equal(preview.facts, undefined);
});
test('ambiguous built-in relationships and duplicate names require explicit handling', () => {
    const state = { tableDatabase: { tables: [
        { name: '人物关系表格', columns: ['双方角色名', '当前关系'], rows: [['甲与乙', '伴侣']] },
        { name: '角色特征表格', columns: ['角色名'], rows: [['甲'], ['甲']] },
    ] } };
    const preview = buildBaselinePreview(state, suggestBaselineMappings(state));
    assert.equal(preview.issues.length, 3);
    assert.equal(preview.projection.people.length, 0);
    assert.equal(preview.projection.relationships.length, 0);
    assert.equal(buildBaselinePreview(state, preview.mappings, { skipRows: preview.issues.map(issue => issue.rowKey) }).issues.length, 0);
});
