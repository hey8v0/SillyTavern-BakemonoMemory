/**
 * The 整理事实 request: the stage's material, the cards it names, the user's notes and the current reflection.
 */
import { getHash } from '../shared/text.js';
import { cardTextLength, clip, currentStateFields, describeTransition, factFieldHints, factFieldLimits, factFields, factKindLabels, isOpenThread, latestFloor, overlongFields, selectRelevantCards, storyOrder } from './model.js';

export const defaultFactsPrompt = `你是剧情剪辑台的事实整理器。下面是一段剧情的摘要材料，以及目前记录的相关事实卡片。请根据材料更新卡片。

规则：
- 只根据材料里明确发生的事更新；不续写、不猜测、不编造。
- 只输出有变化或新出现的卡片，每张只写变了的字段；没变的字段和没变的卡片都不要写，不要抄旧内容。
- fields 里的值会替换旧值。只想给某个字段补一句时写 "add":{"备注":"新的一句"}，会接到旧内容后面，不用重抄。
- 卡片只写现在是什么样：现状字段一两句，性格、外貌只写稳定的特征，备注只留以后还用得上的。每个字段不超过下面说明的字数。事件经过交给剧情摘要，不要写进卡片。
- 卡片标了"请精简"的：把它列出的字段重写到字数以内（合并重复、删掉过时的，不改事实，【】标记的说法要留下）。标了"用户填写"的字段不动。
- 字段值写 null 表示这个信息已经明确失效或清空（目标完成或放弃、物品丢失、离开某地）；不要用空字符串表示清空。目标变了就直接写新的目标，旧值会自动记进“经过”，不用自己写“曾经”。
- 处境、目标、持有、持有者、当前关系、状态这些现状字段，只写剧情里明确发生的事。角色说的、相信的、猜的，写进备注并加前缀：【声称】【猜测】【某某认为】；旧说法被后来的剧情推翻时改成【已推翻】。只有部分人物知道的事（秘密、隐瞒、旁白交代而角色不知道的），也写进备注并标【只有某某知道】或【秘密】，不要写成人人都知道的现状。
- 材料和卡片现状矛盾、又分不清哪个对（材料是传闻，或早于现状）时，不要改字段，写进 conflicts：{"name":"卡片名","field":"字段","says":"材料怎么说"}。
- 卡片按名字对应。已有卡片请用原名；同一人换了称呼，写进 aliases。同名不同类（一个人和一个地方都叫青石）是两张卡；拿不准两个称呼是不是同一个人时不要合并，写进 conflicts，field 填“身份”。
- 标注为"用户填写"的字段原样保留，除非材料明确推翻。
- 明确结束的对象（死亡、已了结、永久离场）写进 retired。标了"已结束"的卡片，材料提到它不代表它回来了，照常更新字段即可；只有剧情明确写了复活、归来、约定或任务重新开始，才把名字写进 revived。
- 便签（note）由用户填写，不要修改。
- 伏笔、约定、任务都记成 thread（线索）卡，状态写 未了 / 已了 / 失效；了结了就改状态，不要删。下面“未了的线索”列出了现在还开着的，材料里了结了的请改状态。
- 卡片里的“经过”是以前的变化记录，只供参考，不要改回去。
- reflection 两段各写一两句：mainline 当前主线，arcs 人物弧线的变化；没变就留空。推测要标【推测】。
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
{"cards":[{"kind":"person","name":"姓名","fields":{"处境":"变了的字段才写"},"add":{"备注":"要补的一句"}}],"retired":[],"revived":[],"conflicts":[],"reflection":{"mainline":"","arcs":""}}
</factCards>`;

export const factsSystemPrompt = '你是剧情剪辑台的事实整理器。只根据提供的材料更新事实卡片，不续写剧情，不扮演角色，不编造材料里没有的事。每张卡只写变了的字段，不要抄没变的内容。输出一个 <factCards> 块，不要解释或 Markdown 代码围栏。';

// Every default this prompt has had (hash:length of the text), the current one included. A chat or a saved configuration
// keeps the text of its day; that is not a choice anyone made, so it reads as the current default and rule changes
// reach it. A changed default goes on this list (tests/facts-request.test.mjs checks); the saved text is not rewritten.
const stockFactsPrompts = new Set(['61dd7e4f:1517', '3a6ad119:1481', '305999cd:1319', '3797ebcb:1255', 'a73972b8:1170', '90fbac11:1066', '413617db:677']);
const promptKey = value => { const source = String(value || '').replace(/\r\n/g, '\n').trim(); return `${getHash(source)}:${source.length}`; };
export const isStockFactsPrompt = value => stockFactsPrompts.has(promptKey(value));
export const effectiveFactsPrompt = saved => !String(saved || '').trim() || isStockFactsPrompt(saved) ? defaultFactsPrompt : String(saved);

export function describeFactFields() {
    return Object.entries(factFields).filter(([kind]) => kind !== 'note').map(([kind, fields]) =>
        `- ${kind}（${factKindLabels[kind]}）：${fields.map(key => `${key}（${factFieldLimits[kind][key]} 字内）=${factFieldHints[kind][key]}`).join('；')}`).join('\n');
}

export function cardForPrompt(card) {
    const result = { kind: card.kind, name: card.name };
    if (card.aliases.length) result.aliases = card.aliases;
    result.fields = Object.fromEntries(factFields[card.kind].filter(key => card.fields[key]).map(key => [key, card.fields[key]]));
    if (card.userFields.length) result['用户填写'] = card.userFields;
    if (card.status === 'retired') result['已结束'] = true;
    const past = storyOrder(card.timeline).slice(-2);
    if (past.length) result['经过'] = past.map(item => `${item.floor != null ? `第 ${item.floor} 楼 ` : ''}${describeTransition(item, { max: 20 })}`);
    const overlong = overlongFields(card);
    if (overlong.length) result['请精简'] = overlong;
    return result;
}

// A named card the request has no more room for: what is the case now, enough to tell what changed.
function briefCard(card) {
    const result = { kind: card.kind, name: card.name };
    if (card.aliases.length) result.aliases = card.aliases;
    const state = (card.kind === 'thread' ? ['内容', '状态'] : currentStateFields[card.kind] || []).filter(key => card.fields[key]);
    const keys = state.length ? state : factFields[card.kind].filter(key => card.fields[key]).slice(0, 1);
    result.fields = Object.fromEntries(keys.map(key => [key, clip(card.fields[key], factFieldLimits[card.kind]?.[key] || 60)]));
    if (card.userFields.length) result['用户填写'] = card.userFields;
    if (card.status === 'retired') result['已结束'] = true;
    return result;
}
// A long card the material does not name, along only to be rewritten: the fields past their limit.
const rewriteOnly = card => ({ kind: card.kind, name: card.name, fields: Object.fromEntries(overlongFields(card).map(key => [key, card.fields[key]])), '请精简': overlongFields(card) });

// How much of a request the cards may take. The first card always goes whole.
const cardsBudget = 8000;
const threadRows = 40;

export function buildFactsPrompt(facts, material, { template = defaultFactsPrompt, maxCards = facts.settings?.maxCards || 40, timeContext = '' } = {}) {
    // Only what the material names goes whole, most named first: a card it does not name has nothing to update.
    const named = selectRelevantCards(facts.cards.filter(card => card.kind !== 'note'), material, { max: maxCards, includeNotes: false, namedOnly: true });
    let used = 0;
    const fits = shown => { const length = JSON.stringify(shown).length; if (used && used + length > cardsBudget) return false; used += length; return true; };
    const relevant = [], shown = [];
    for (const card of named) { const whole = cardForPrompt(card); relevant.push(card); shown.push(fits(whole) ? whole : briefCard(card)); }
    // Up to two long cards the material does not name come along to be rewritten shorter, so cards do not keep
    // growing (a 整理 rewrites and merges; it does not only append). When the request is full they wait.
    const namedIds = new Set(named.map(card => card.id));
    const long = facts.cards.filter(card => card.status === 'active' && card.kind !== 'note' && !namedIds.has(card.id) && overlongFields(card).length)
        .sort((a, b) => cardTextLength(b) - cardTextLength(a)).slice(0, 2);
    for (const card of long) { const fields = rewriteOnly(card); if (fits(fields)) { relevant.push(card); shown.push(fields); } }
    const notes = facts.cards.filter(card => card.status === 'active' && card.kind === 'note' && card.fields.内容);
    const reflection = ['mainline', 'arcs'].filter(key => facts.reflection[key]).map(key => `${{ mainline: '主线', arcs: '弧线' }[key]}：${facts.reflection[key]}`).join('\n') || '（还没有）';
    const relevantIds = new Set(relevant.map(card => card.id));
    // Other open threads, the most recent first: enough to close one by name.
    const openThreads = facts.cards.filter(card => isOpenThread(card) && !relevantIds.has(card.id))
        .map((card, index) => ({ card, index })).sort((a, b) => latestFloor(b.card) - latestFloor(a.card) || a.index - b.index).map(({ card }) => card);
    const threadRow = card => `- ${card.name}${card.fields.内容 ? `：${clip(card.fields.内容, 40)}` : ''}${card.fields.参与者 ? `（${clip(card.fields.参与者, 30)}）` : ''}`;
    const replacements = {
        fields: describeFactFields(),
        reflection,
        cards: shown.length ? `[\n${shown.map(item => JSON.stringify(item)).join(',\n')}\n]` : '（还没有相关卡片，请按材料新建）',
        threads: openThreads.length ? [...openThreads.slice(0, threadRows).map(threadRow), ...(openThreads.length > threadRows ? [`另有 ${openThreads.length - threadRows} 条`] : [])].join('\n') : '（没有别的）',
        notes: notes.length ? notes.map(card => `- ${card.name}：${card.fields.内容}`).join('\n') : '（无）',
        material: String(material || '').trim(),
    };
    let prompt = String(template || defaultFactsPrompt);
    for (const [key, value] of Object.entries(replacements)) prompt = prompt.replaceAll(`{{${key}}}`, value);
    if (!String(template || '').includes('{{material}}')) prompt += `\n\n材料：\n${replacements.material}`;
    return { prompt: [timeContext, prompt].filter(Boolean).join('\n\n'), systemPrompt: factsSystemPrompt, cardIds: relevant.map(card => card.id) };
}
