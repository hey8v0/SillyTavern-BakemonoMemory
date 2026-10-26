// Harness helper: fills 剧情事实 of the ?sum chat with a few cards, their 经过, one open conflict and some history,
// so the page can be looked at. In the console: (await import('/facts-fixture.js')).addFacts()
export async function addFacts() {
    const base = '/scripts/extensions/third-party/BakemonoMemory/src/';
    const { applyFactsUpdate, createDefaultFacts, editCard } = await import(base + 'facts/model.js');
    const m = await import('/script.js');
    const st = m.chat_metadata.bakemonoMemory;
    const facts = createDefaultFacts();
    const at = n => new Date(Date.now() - (6 - n) * 3600 * 1000).toISOString();
    const step = (cards, floorTo, n, extra = {}) => applyFactsUpdate(facts, { cards, ...extra }, { floorTo, sources: [{ hash: `fx${floorTo}`, revision: '1' }], now: at(n) });
    step([
        { kind: 'person', name: '莉娜', aliases: ['酒馆老板娘'], fields: { 处境: '在酒馆柜台后擦杯子', 目标: '打听北方矿坑的消息', 持有: '一把铜钥匙', 性格: '嘴硬心软', 外貌: '红发，围裙上有酒渍' } },
        { kind: 'person', name: '旅人', fields: { 处境: '刚进酒馆，浑身是雨', 目标: '找到去矿坑的路' } },
        { kind: 'person', name: '格伦', fields: { 处境: '在铁匠铺', 性格: '寡言' } },
        { kind: 'item', name: '铜钥匙', fields: { 持有者: '莉娜', 描述: '钥匙齿已经磨平', 意义: '据说能开矿坑的旧门' } },
        { kind: 'place', name: '雾港镇酒馆', fields: { 描述: '镇口的两层木楼，常年潮湿', 常在此处: '莉娜、旅人' } },
        { kind: 'relationship', name: '莉娜与旅人', fields: { 双方: '莉娜 与 旅人', 当前关系: '陌生人', 基础关系: '店家与客人' } },
        { kind: 'thread', name: '矿坑的通行证', fields: { 内容: '旅人要从格伦那里拿到通行证', 状态: '未了', 参与者: '旅人、格伦' } },
        { kind: 'thread', name: '雨夜的约定', fields: { 内容: '莉娜答应天亮前告诉旅人矿坑的路', 状态: '未了', 参与者: '莉娜、旅人', 期限: '天亮前' } },
        { kind: 'rule', name: '矿坑封锁', fields: { 说明: '领主三天前封了矿坑，没有通行证进不去', 影响范围: '全镇' } },
    ], 8, 1, { reflection: { mainline: '旅人为了去矿坑，在雾港镇酒馆里打听门路。', arcs: '莉娜从打发客人到愿意帮忙。' } });
    step([
        { kind: 'item', name: '铜钥匙', fields: { 持有者: '旅人' } },
        { kind: 'person', name: '莉娜', fields: { 持有: null, 备注: '【声称】自己从没去过矿坑' } },
        { kind: 'relationship', name: '莉娜与旅人', fields: { 当前关系: '互相试探' } },
    ], 20, 2);
    step([
        { kind: 'thread', name: '雨夜的约定', fields: { 状态: '已了，莉娜画了路线图' } },
        { kind: 'person', name: '旅人', fields: { 处境: '在去铁匠铺的路上', 持有: '铜钥匙、路线图' } },
        { kind: 'relationship', name: '莉娜与旅人', fields: { 当前关系: '有了默契' } },
    ], 34, 3, { reflection: { mainline: '旅人拿到路线图，下一步是从格伦那里要通行证。', arcs: '莉娜嘴上不认，手上帮了忙。' },
        conflicts: [{ name: '格伦', field: '处境', says: '第 30 楼旅人听说格伦昨夜离开了镇子' }] });
    editCard(facts, facts.cards.find(card => card.name === '莉娜').id, { fields: { 性格: '嘴硬心软，记仇' } }, at(4));
    facts.cards.push({ ...facts.cards.find(card => card.name === '格伦'), id: 'fact-dead', name: '老看守', aliases: [], fields: { 处境: '死在矿坑门口', 目标: '', 持有: '', 性格: '', 外貌: '', 备注: '' }, status: 'retired', userFields: [], timeline: [{ field: '已结束', from: '', to: '', floor: 12, at: at(2), entryId: null }] });
    facts.cards.push({ id: 'fact-note', kind: 'note', name: '写作要求', aliases: [], fields: { 内容: '少写环境描写，多写对话' }, status: 'active', pinned: false, userFields: ['内容'], updatedAt: at(1), updatedBy: 'user', sourceStage: null, timeline: [] });
    facts.lastIntegratedFloor = 34;
    st.facts = facts;
    return facts;
}
