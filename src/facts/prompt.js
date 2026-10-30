/**
 * The 整理事实 request: the stage's material, the cards it names, the user's notes and the current reflection.
 */
import { cardTextLength, compactLimit, describeTransition, factFields, factFieldHints, factKindLabels, isOpenThread, selectRelevantCards, storyOrder } from './model.js';

export const defaultFactsPrompt = `你是剧情剪辑台的事实整理器。下面是一段剧情的摘要材料，以及目前记录的相关事实卡片。请根据材料更新卡片。

规则：
- 只根据材料里明确发生的事更新；不续写、不猜测、不编造。
- 只输出有变化或新出现的卡片，每张写全；没变的卡片不要输出。省略的字段视为保持不变。
- 卡片只写现在是什么样：现状字段一两句，性格、外貌只写稳定的特征，备注只留以后还用得上的。事件经过交给剧情摘要，不要写进卡片。
- 标了"请精简"的卡片太长了：这次把它也输出，把性格、外貌、备注这类说明性字段重写得更短（合并重复、删掉过时的，不改事实）；现状字段只有超过两句话时才改写成一句。标了"用户填写"的字段不动。
- 字段值写 null 表示这个信息已经明确失效或清空（目标完成或放弃、物品丢失、离开某地）；不要用空字符串表示清空。目标变了就换成新的目标，并在备注里记一句“曾经：原来的目标（第几楼完成/放弃）”。
- 处境、目标、持有、持有者、当前关系、状态这些现状字段，只写剧情里明确发生的事。角色说的、相信的、猜的，写进备注并加前缀：【声称】【猜测】【某某认为】；旧说法被后来的剧情推翻时改成【已推翻】。只有部分人物知道的事（秘密、隐瞒、旁白交代而角色不知道的），也写进备注并标【只有某某知道】或【秘密】，不要写成人人都知道的现状。
- 材料和卡片现状矛盾、又分不清哪个对（材料是传闻，或早于现状）时，不要改字段，写进 conflicts：{"name":"卡片名","field":"字段","says":"材料怎么说"}。
- 卡片按名字对应。已有卡片请用原名；同一人换了称呼，写进 aliases。同名不同类（一个人和一个地方都叫青石）是两张卡；拿不准两个称呼是不是同一个人时不要合并，写进 conflicts，field 填“身份”。
- 标注为"用户填写"的字段原样保留，除非材料明确推翻。
- 明确结束的对象（死亡、已了结、永久离场）写进 retired。标了"已结束"的卡片，材料提到它不代表它回来了，照常更新字段即可；只有剧情明确写了复活、归来、约定或任务重新开始，才把名字写进 revived。
- 便签（note）由用户填写，不要修改。
- 伏笔、约定、任务都记成 thread（线索）卡，状态写 未了 / 已了 / 失效；了结了就改状态，不要删。下面“未了的线索”列出了现在还开着的，材料里了结了的请改状态。
- 卡片里的“经过”是以前的变化记录，只供参考，不要改回去。
- reflection 两段各写一两句：mainline 当前主线，arcs 人物弧线的变化。推测要标【推测】。
- 只输出一个 <factCards> 块，里面是 JSON，不要解释，不要代码围栏。

字段说明：
{{fields}}

当前反思：
{{reflection}}

相关卡片（JSON）：
{{cards}}

未了的线索：
{{threads}}

用户便签：
{{notes}}

材料：
{{material}}

输出格式：
<factCards>
{"cards":[{"kind":"person","name":"姓名","aliases":[],"fields":{"处境":"","目标":"","持有":"","性格":"","外貌":"","备注":""}}],"retired":[],"revived":[],"conflicts":[],"reflection":{"mainline":"","arcs":""}}
</factCards>`;

export const factsSystemPrompt = '你是剧情剪辑台的事实整理器。只根据提供的材料更新事实卡片，不续写剧情，不扮演角色，不编造材料里没有的事。输出一个 <factCards> 块，不要解释或 Markdown 代码围栏。';

export function describeFactFields() {
    return Object.entries(factFields).filter(([kind]) => kind !== 'note').map(([kind, fields]) =>
        `- ${kind}（${factKindLabels[kind]}）：${fields.map(key => `${key}=${factFieldHints[kind][key]}`).join('；')}`).join('\n');
}

export function cardForPrompt(card) {
    const result = { kind: card.kind, name: card.name };
    if (card.aliases.length) result.aliases = card.aliases;
    result.fields = Object.fromEntries(factFields[card.kind].filter(key => card.fields[key]).map(key => [key, card.fields[key]]));
    if (card.userFields.length) result['用户填写'] = card.userFields;
    if (card.status === 'retired') result['已结束'] = true;
    const past = storyOrder(card.timeline).slice(-3);
    if (past.length) result['经过'] = past.map(item => `${item.floor != null ? `第 ${item.floor} 楼 ` : ''}${describeTransition(item)}`);
    if (cardTextLength(card) > compactLimit) result['请精简'] = true;
    return result;
}

export function buildFactsPrompt(facts, material, { template = defaultFactsPrompt, maxCards = facts.settings?.maxCards || 40, timeContext = '' } = {}) {
    const named = selectRelevantCards(facts.cards, material, { max: maxCards, includeNotes: false });
    // Up to two long cards the material does not name come along to be rewritten shorter, so cards do not keep
    // growing (a 整理 rewrites and merges; it does not only append).
    const namedIds = new Set(named.map(card => card.id));
    const long = facts.cards.filter(card => card.status === 'active' && card.kind !== 'note' && !namedIds.has(card.id) && cardTextLength(card) > compactLimit)
        .sort((a, b) => cardTextLength(b) - cardTextLength(a)).slice(0, 2);
    const relevant = [...named, ...long];
    const notes = facts.cards.filter(card => card.status === 'active' && card.kind === 'note' && card.fields.内容);
    const reflection = ['mainline', 'arcs'].filter(key => facts.reflection[key]).map(key => `${{ mainline: '主线', arcs: '弧线' }[key]}：${facts.reflection[key]}`).join('\n') || '（还没有）';
    const relevantIds = new Set(relevant.map(card => card.id));
    const openThreads = facts.cards.filter(card => isOpenThread(card) && !relevantIds.has(card.id));
    const replacements = {
        fields: describeFactFields(),
        reflection,
        cards: relevant.length ? JSON.stringify(relevant.map(cardForPrompt), null, 1) : '（还没有相关卡片，请按材料新建）',
        threads: openThreads.length ? openThreads.map(card => `- ${card.name}：${card.fields.内容 || ''}${card.fields.参与者 ? `（${card.fields.参与者}）` : ''}`).join('\n') : '（没有别的）',
        notes: notes.length ? notes.map(card => `- ${card.name}：${card.fields.内容}`).join('\n') : '（无）',
        material: String(material || '').trim(),
    };
    let prompt = String(template || defaultFactsPrompt);
    for (const [key, value] of Object.entries(replacements)) prompt = prompt.replaceAll(`{{${key}}}`, value);
    if (!String(template || '').includes('{{material}}')) prompt += `\n\n材料：\n${replacements.material}`;
    return { prompt: [timeContext, prompt].filter(Boolean).join('\n\n'), systemPrompt: factsSystemPrompt, cardIds: relevant.map(card => card.id) };
}
