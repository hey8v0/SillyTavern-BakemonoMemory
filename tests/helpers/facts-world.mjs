import { applyFactsUpdate, createDefaultFacts } from '../../src/facts/model.js';

// A world with verbose cards (the way real models write them), many open threads and three relationships.
export const say = (text, times) => Array.from({ length: times }, () => text).join('，');
export function verboseWorld({ threads = 20 } = {}) {
    const facts = createDefaultFacts();
    const person = name => ({ kind: 'person', name, fields: { 处境: `${name}${say('在青石镇的客栈里养伤', 3)}`, 目标: `${say('查清矿坑里藏着的秘密', 3)}`,
        持有: '一把旧伞、半块干粮', 性格: say('嘴硬心软，记仇但讲义气', 4), 外貌: say('瘦高，左手有一道旧疤', 4), 备注: say('曾在北方矿山做过三年工', 6) } });
    applyFactsUpdate(facts, { cards: [
        ...['林晚', '沈砚', '阿砚', '青石', '林霜', '莉娜', '格伦', '船长'].map(person),
        { kind: 'person', name: '老看守', fields: { 处境: '死于矿坑口的塌方' } },
        { kind: 'relationship', name: '恋人', aliases: [], fields: { 双方: '林晚 与 沈砚', 当前关系: '公开的恋人', 态度: say('林晚信任沈砚', 3), 基础关系: '同乡' } },
        { kind: 'relationship', name: '兄弟', fields: { 双方: '沈砚 与 阿砚', 当前关系: '和好', 基础关系: '兄弟' } },
        { kind: 'relationship', name: '旧识', fields: { 双方: '莉娜 与 格伦', 当前关系: '生意伙伴' } },
        { kind: 'thread', name: '还钥匙', fields: { 内容: '阿砚答应三天内把钥匙还给林晚', 状态: '未了', 参与者: '阿砚、林晚' } },
        ...Array.from({ length: threads }, (_, i) => ({ kind: 'thread', name: `无关约定${i}`, fields: { 内容: say(`莉娜和格伦约好的第 ${i} 件事`, 2), 状态: '未了', 参与者: '莉娜、格伦' } })),
        { kind: 'item', name: '铜钥匙', fields: { 持有者: '阿砚', 描述: '刻着青字' } },
    ], retired: ['老看守'], reflection: { mainline: '林晚和沈砚查清矿坑的真相。', arcs: '林晚学会信任别人。' } }, { floorTo: 100 });
    applyFactsUpdate(facts, { cards: [] }, { floorTo: 101 });
    facts.cards.push({ id: 'note-1', kind: 'note', name: '写作要求', aliases: [], fields: { 内容: '少写环境描写' }, status: 'active', pinned: false, userFields: ['内容'], timeline: [], floors: [], asOf: {} });
    return facts;
}
export const recentParts = { scene: '林晚看着沈砚，没有说话。', recent: '前几天阿砚来过，说起青石的事。', recalled: '老看守死在矿坑口那天下着雨。' };

