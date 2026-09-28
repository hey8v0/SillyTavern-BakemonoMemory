import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjection, applyDomainFact, collapseRelationships } from '../src/rp-core/domain.js';
import { migrateLegacyRuleDefaults } from '../src/config/legacy-rule-defaults.js';

function story() {
    let state = createProjection();
    const act = (action, data) => state = applyDomainFact(state, { action, data, ruleVersion: 3 });
    act('person_registered', { id: '塞巴斯蒂安', name: '塞巴斯蒂安' });
    act('person_registered', { id: 'Nana', name: 'Nana' });
    act('person_registered', { id: '夏尔', name: '夏尔' });
    return { act, get state() { return state; } };
}

test('re-describing a relationship replaces it instead of adding another', () => {
    const f = story();
    f.act('relationship_recorded', { id: 'r1', from: '塞巴斯蒂安', to: 'Nana', kind: '饲主与新奇小猫' });
    f.act('relationship_established', { id: 'r2', from: '塞巴斯蒂安', to: 'Nana', kind: '乐子人执事与有趣幼猫' });
    f.act('relationship_established', { id: 'r3', from: '塞巴斯蒂安', to: 'Nana', kind: '看戏执事与被试探底细的神秘幼体' });
    const active = f.state.relationships.filter(item => item.status === 'active');
    assert.equal(active.length, 1);
    assert.equal(active[0].kind, '看戏执事与被试探底细的神秘幼体');
    assert.deepEqual(active[0].history.map(item => item.kind), ['饲主与新奇小猫', '乐子人执事与有趣幼猫']);
    // Later events may name any id the relationship was written under.
    f.act('relationship_milestone', { id: 'r2', description: '第一次喂猫' });
    assert.equal(active.length, 1);
    assert.equal(f.state.relationships[0].milestones.length, 1);
    assert.throws(() => f.act('relationship_established', { id: 'r4', from: '塞巴斯蒂安', to: 'Nana', kind: '看戏执事与被试探底细的神秘幼体' }), /已经建立/);
    // The other direction and other people stay separate.
    f.act('relationship_established', { id: 'r5', from: 'Nana', to: '塞巴斯蒂安', kind: '警惕的小猫' });
    f.act('relationship_established', { id: 'r6', from: '夏尔', to: 'Nana', kind: '收养者' });
    assert.equal(f.state.relationships.filter(item => item.status === 'active').length, 3);
    f.act('relationship_ended', { id: 'r1' });
    f.act('relationship_established', { id: 'r7', from: '塞巴斯蒂安', to: 'Nana', kind: '同伴' });
    assert.equal(f.state.relationships.filter(item => item.from === '塞巴斯蒂安' && item.status === 'active').length, 1, 'after an end a new one may start');
});

test('relationships piled up by older versions fold into one per pair', () => {
    const state = { relationships: ['饲主', '乐子人执事', '看戏执事'].map((kind, i) => ({ id: 'r' + i, from: 'a', to: 'b', kind, mutual: false,
        status: 'active', since: null, milestones: [{ description: 'm' + i }], conflicts: [] })) };
    collapseRelationships(state);
    assert.equal(state.relationships.length, 1);
    assert.equal(state.relationships[0].id, 'r0');
    assert.equal(state.relationships[0].kind, '看戏执事');
    assert.deepEqual(state.relationships[0].aliases, ['r1', 'r2']);
    assert.equal(state.relationships[0].milestones.length, 3);
});

test('only the untouched old 多次总结 defaults move to the current ones', () => {
    const current = { classification: { epic: '多次总结, 长期总览, 时间线总览, 关键锚点' }, layouts: { epic: '时间线|时间线总览|normal' } };
    const old = { classificationRules: { stage: 's', epic: '多次总结, 长期总览, 篇章总结, 纪元回溯, 史诗简史, 事件断代史, 命运锚点' },
        previewLayouts: { epic: `时间线|时间线总览,事件断代史|normal
    锚点|关键锚点,命运锚点|tag
    角色|角色状态,灵魂蝶变|normal
    未解|未解事项|tag
    长期笔记|第四面墙·长期笔记,第四面墙·高维观测|bubble` } };
    assert.equal(migrateLegacyRuleDefaults(old, current), true);
    assert.equal(old.classificationRules.epic, current.classification.epic);
    assert.equal(old.previewLayouts.epic, current.layouts.epic);
    assert.equal(old.classificationRules.stage, 's');
    const edited = { classificationRules: { epic: '我的大总结' }, previewLayouts: { epic: '年表|年表|normal' } };
    assert.equal(migrateLegacyRuleDefaults(edited, current), false);
    assert.equal(edited.classificationRules.epic, '我的大总结');
});
