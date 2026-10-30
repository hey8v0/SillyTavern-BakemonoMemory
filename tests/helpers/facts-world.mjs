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


// Cards as long as the ones a user's real chat grew (the first goal is verbatim from their screenshot): every event
// written into the state fields, ten open threads, 经过 holding whole old values. What v1.40 and before sent in full.
const yanzeGoal = '赶在天黑前弄到真时辰（灰饼里外婆那张红纸已被言卿亲手烧尽，只剩半截的金粉笔画没能读完；纸人心口挑出的第二张金边回纹红纸笔迹工整全非外婆手笔、时辰格同样剪空，已埋进灰盆底；葛老太只答写字的手，不在我这儿，并井中自称外婆的声音称真包在井底要言卿过去报时辰来换，真时辰仍未到手）；把装袋的纸人送回葛记铺里画脸（老孙捎葛老太话：纸人扎好了得回铺子里画脸）；护住言卿（横身挡在后备箱与她之间、踩住湿印；她抢先发问、递灌油时仍没替她做主）；弄清油纸包和观中那半块寄名玉的来历；确认沈岚手里那块红纸的情况（字已全淌、纸自己卷起来、樟木箱盖在响；言卿已回信让她去东岳庙住进去）；小周送周慧兰、发定位、往后只发字；明天送红纸笔压照片去技术科复原；去所里调阅前三起溺亡孩童家属笔录；受沈岚之托看住言卿；备些连自己也不知道的验证题';
const shortGoal = '赶在天黑前找到自己的真时辰，弄清纸人替我去还是送我去与红纸、路引、换的真相，弄清玉符与寄名玉的来历，与严则同进同退，往后只发字、照叮嘱自保。'.repeat(2);
const longState = name => `${name}${'在葛记铺子门口蹲着，手里攥着那张剪空的红纸，指腹烫伤翻皮，鞋尖还沾着井边的湿泥'.repeat(4)}`;
const longNote = '托老孙转述警告：纸人扎好了得回铺子里画脸；见晌午起雾惊道晌午头哪来的雾；问时辰只得了写字的手不在我这儿。'.repeat(4);
const longPerson = (name, goal = shortGoal) => ({ kind: 'person', name, fields: { 处境: longState(name), 目标: goal, 持有: '灌油的铁盒、半截金粉红纸、借来的手机、瓦盆', 性格: '嘴硬心软，遇事先护人，不替别人做主，慌的时候反而话少', 外貌: '灰外套，袖口沾着纸灰，左手指腹烫伤翻皮', 备注: longNote } });
export const longThreadNames = ['问时辰', '同进同退', '问答为凭', '画脸', '寄名玉', '红纸复原', '溺亡笔录', '东岳庙', '验证题', '玉符'];
export function longCardsWorld() {
    const facts = createDefaultFacts();
    const people = [longPerson('严则', yanzeGoal), ...['言卿', '葛大娘', '老冯', '老孙', '沈岚', '小周', '周慧兰', '葛老太'].map(name => longPerson(name))];
    const threads = longThreadNames.map(name => ({ kind: 'thread', name, fields: { 内容: shortGoal.slice(0, 220), 状态: '未了', 参与者: '严则、言卿' } }));
    const items = ['红纸', '灰饼', '纸人', '油纸包'].map(name => ({ kind: 'item', name, fields: { 持有者: '严则', 描述: shortGoal.slice(0, 100), 意义: shortGoal.slice(0, 80) } }));
    applyFactsUpdate(facts, { cards: [...people, ...threads, ...items, { kind: 'relationship', name: '严则与言卿', fields: { 双方: '严则 与 言卿', 当前关系: shortGoal.slice(0, 120), 态度: shortGoal.slice(0, 160), 基础关系: '同事' } }],
        reflection: { mainline: shortGoal.slice(0, 120), arcs: shortGoal.slice(0, 120) } }, { floorFrom: 2, floorTo: 40 });
    for (const [floorFrom, floorTo, suffix] of [[42, 60, '（第二轮）'], [62, 80, '（第三轮）']]) {
        applyFactsUpdate(facts, { cards: [...people.map(card => ({ ...card, fields: { 处境: card.fields.处境 + suffix, 目标: card.fields.目标 + suffix } })), ...threads.map(card => ({ ...card, fields: { 状态: '未了' + suffix } }))] }, { floorFrom, floorTo });
    }
    return facts;
}
// Six summaries in the default reply-carried format, the size one batch reads.
export const longMaterial = () => [80, 82, 84, 86, 88, 90].map(floor => `【☆『第${floor}楼：灰盆里的红纸』★时间：午后★地点：葛记铺子|严则、言卿、葛老太☆】\n➤ 🎬 【场记打板】\n- ${'严则把装袋的纸人放回铺子，言卿抢先发问，葛老太只答写字的手不在这儿。'.repeat(8)}\n➤ 🎙️ 【高光收音】\n> ${'“写字的手，不在我这儿。”——葛老太。'.repeat(4)}\n➤ 🌍 【副镜监视器】\n[东岳庙 | 沈岚]：${'樟木箱盖在响。'.repeat(6)}\n➤ 🪢 【剧本暗线】\n[未回收伏笔]：${'井中的声音要她报时辰。'.repeat(4)}\n➤ 👾 【第四面墙】\n${'编辑大人注意这里的红纸。'.repeat(3)}`).join('\n\n');
