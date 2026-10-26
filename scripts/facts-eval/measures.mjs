// Measures for scripts/facts-eval/run.mjs, on top of the scenario checks in corpus.mjs:
// - keyFacts: what the memory must hold at the end of the story (recall of key facts; a miss is 遗漏).
// - wrongFacts: what it must not hold (outdated state, hearsay as fact, a dead man alive; a hit is 错误).
// - recallQueries: lines a character might say later, and the floors whose summaries hold the answer. Scored with
//   the plugin's own hybrid retrieval over the summaries, with and without the cards' hints.
// Each fact is { name, kind?, field?, status?, pattern? }: a card by name (and kind), then a field matching the
// pattern, or a status. `missing: true` in wrongFacts means the card must not exist at all.

export const keyFacts = [
    { name: '林晚', field: '目标', pattern: /领主|钥匙/ },
    { name: '林晚', field: '处境', pattern: /青石镇|领主府/ },
    { name: '铜钥匙', kind: 'item', field: '持有者', pattern: /领主/ },
    { name: '铜钥匙', kind: 'item', field: '描述', pattern: /青/ },
    { name: '林霜', field: '处境', pattern: /北方/ },
    { name: '阿砚', field: '处境', pattern: /北方|林霜/ },
    { name: '青石', kind: 'person', field: '处境', pattern: /手指|打不了铁|放回/ },
    { name: '沈砚', field: '处境', pattern: /铺子|青石镇/ },
    { name: '林晚与沈砚', field: '当前关系', pattern: /恋人/ },
    { name: '老看守', status: 'retired' },
    { name: '码头之约', field: '状态', pattern: /已了|兑现|了结|完成/ },
    { name: '地图', kind: 'item', field: '持有者', pattern: /林晚/ },
    { name: '档案', kind: 'item' },
    { name: '墨', kind: 'person' },
];

export const wrongFacts = [
    { name: '林晚', field: '目标', pattern: /姐姐/ },
    { name: '林晚', field: '处境', pattern: /春天/ },
    { name: '沈砚', field: '处境', pattern: /没进过矿坑/ },
    { name: '沈砚', field: '目标', pattern: /没进过矿坑/ },
    { name: '老看守', status: 'active' },
    { name: '铜钥匙', kind: 'item', field: '持有者', pattern: /林晚|阿砚|沈砚/ },
    { name: '林晚与沈砚', field: '当前关系', pattern: /秘密恋人|冷战/ },
    { name: '青石', kind: 'person', field: '处境', pattern: /藏金/ },
    { name: '藏金室', field: '说明', pattern: /^(?!.*(?:【|假|空|推翻|传言|传闻)).*藏金/ },
];

// [line, floors that answer it]. Floors are the corpus floors (shifted with --long like everything else).
export const recallQueries = [
    ['那天晚上你答应过我的事情，还记得吗？', [20, 26]],
    ['你还留着那枚刻着字的钥匙吗？', [4, 16]],
    ['老看守临死前交给你什么了？', [50]],
    ['藏金室的事你还信吗？', [54, 64]],
    ['你父亲做过的事，我不怪你。', [76, 78]],
    ['还记得我们在客栈那晚吗？', [36, 38]],
    ['你姐姐当初是在哪里找到的？', [40]],
    ['那张地图后来怎么样了？', [66, 68, 112]],
];

export function judge(facts, findCard, list) {
    return list.map(fact => {
        const card = findCard(facts.cards, fact.name, fact.kind || null);
        let hit;
        if (fact.missing) hit = !card;
        else if (!card) hit = false;
        else if (fact.status) hit = card.status === fact.status;
        else if (fact.field) hit = fact.pattern.test(card.fields[fact.field] || '');
        else hit = true;
        return { ...fact, pattern: fact.pattern ? String(fact.pattern) : undefined, hit, value: card ? (fact.status ? card.status : fact.field ? card.fields[fact.field] || '' : card.name) : null };
    });
}
