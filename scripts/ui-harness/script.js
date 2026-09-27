// Minimal SillyTavern host mock for UI review. No network, no model calls.
const listeners = {};
export const event_types = { CHAT_CHANGED:'chat_changed', CHAT_LOADED:'chat_loaded', CHARACTER_MESSAGE_RENDERED:'cmr', ITEMIZED_PROMPTS_LOADED:'ipl', MESSAGE_DELETED:'md', MESSAGE_RECEIVED:'mr', MESSAGE_SENT:'ms', MESSAGE_SWIPED:'msw', MESSAGE_UPDATED:'mu' };
export const eventSource = { on(e, f){ (listeners[e] ||= []).push(f); }, async emit(e, ...a){ for (const f of listeners[e]||[]) await f(...a); } };
export const extension_prompt_roles = { SYSTEM:0, USER:1, ASSISTANT:2 };
export const extension_prompt_types = { NONE:-1, IN_PROMPT:0, IN_CHAT:1, BEFORE_PROMPT:2 };
export const chat_metadata = { integrity: 'mock-chat-1' };
const now = Date.now();
const summary = (event) => ['', '<bakemono>📋 剧情摘要', '时间：雨夜', '地点：酒馆', `事件：${event}`, '</bakemono>'].join('\n');
const lines = [
 ['旅人', true, '我推开酒馆的门，雨水顺着斗篷滴落。'],
 ['莉娜', false, '莉娜抬起头，放下手中的杯子。“这么晚了还有客人？坐吧，炉火还热着。”她指了指角落的位置。'],
 ['旅人', true, '我把一枚铜币放在吧台上：“有没有关于北方矿坑的消息？”'],
 ['莉娜', false, '她压低声音：“矿坑三天前塌了，领主派人封了路。你要去的话，得先找铁匠格伦拿通行证。”' + summary('旅人向莉娜打听北方矿坑，得知矿坑坍塌、道路被封，需要铁匠格伦的通行证。')],
 ['旅人', true, '我点点头，把地图摊开，请她指出铁匠铺的位置。'],
 ['莉娜', false, '莉娜用手指点了点地图东侧：“就在钟楼旁边。告诉他是我让你去的。”她把一把旧钥匙推给你，“这是后门钥匙，天亮前还我。”' + summary('莉娜指出铁匠铺在钟楼旁，并借给旅人后门钥匙，约定天亮前归还。')],
 ['旅人', true, '我收下钥匙，道谢后离开酒馆，冒雨前往钟楼。'],
 ['莉娜', false, '钟楼下，铁匠铺的炉火还亮着。格伦是个满脸胡须的壮汉，他打量着你：“莉娜让你来的？通行证可不便宜。”'],
];
// Open the harness with ?rp to append a sample rpEvents block to the last reply (剧情状态 review).
const rpEvents = [
 { action: 'clock_set', data: { date: '1023-10-14T23:40' } },
 { action: 'location_created', data: { id: '雾港镇', name: '雾港镇' } },
 { action: 'location_created', data: { id: '渡鸦酒馆', name: '渡鸦酒馆', parent: '雾港镇' } },
 { action: 'location_created', data: { id: '铁匠铺', name: '铁匠铺', parent: '雾港镇' } },
 { action: 'location_created', data: { id: '北方矿坑', name: '北方矿坑' } },
 { action: 'person_registered', data: { id: '旅人', name: '旅人' } },
 { action: 'person_registered', data: { id: '莉娜', name: '莉娜' } },
 { action: 'person_registered', data: { id: '格伦', name: '格伦' } },
 { action: 'person_registered', data: { id: '领主', name: '维克多领主' } },
 { action: 'person_moved', data: { id: '旅人', location: '铁匠铺' } },
 { action: 'person_moved', data: { id: '格伦', location: '铁匠铺' } },
 { action: 'person_moved', data: { id: '莉娜', location: '渡鸦酒馆' } },
 { action: 'scene_recorded', data: { location: '铁匠铺', present: ['旅人', '格伦'] } },
 { action: 'person_state_started', data: { id: '旅人', stateId: 'wet', description: '全身被雨淋透' } },
 { action: 'person_state_started', data: { id: '格伦', stateId: 'wary', description: '对旅人有戒心', visibility: 'private', target: '旅人' } },
 { action: 'person_trait_recorded', data: { id: '格伦', trait: '满脸胡须的壮汉' } },
 { action: 'relationship_recorded', data: { id: 'r1', from: '莉娜', to: '格伦', kind: '老朋友', mutual: true } },
 { action: 'relationship_established', data: { id: 'r2', from: '旅人', to: '莉娜', kind: '受托人' } },
 { action: 'item_registered', data: { id: 'key', name: '酒馆后门钥匙', owner: '莉娜', holder: '莉娜' } },
 { action: 'item_lent', data: { id: 'key', from: '莉娜', to: '旅人', loanId: 'loan1' } },
 { action: 'item_registered', data: { id: 'map', name: '北境地图', owner: '旅人', holder: '旅人' } },
 { action: 'item_registered', data: { id: 'coin', name: '铜币', owner: '旅人', holder: '旅人', quantity: 11 } },
 { action: 'promise_created', data: { id: 'p1', title: '天亮前归还后门钥匙', participants: ['旅人', '莉娜'], due: '1023-10-15T06:00' } },
 { action: 'plan_accepted', data: { id: 'p1' } }, // redundant on purpose: promise_created is already accepted
 { action: 'plan_proposed', data: { id: 'p2', title: '拿到通行证前往北方矿坑', participants: ['旅人'], dueDescription: '通行证到手后' } },
 { track: 'claims', data: { speaker: '莉娜', subject: '北方矿坑', description: '矿坑三天前塌了，领主派人封了路', heardBy: ['旅人'] } },
 { track: 'observations', data: { speaker: '旅人', subject: '格伦', description: '格伦似乎知道矿坑坍塌的内情' } },
];
// ?rp&dup: a 开场白 before the first user message, a clock written only as text, and 格伦 recorded twice (merge review).
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dup')) {
 lines.unshift(['莉娜', false, '雨夜，渡鸦酒馆里只剩炉火和擦杯子的莉娜。']);
 rpEvents[0] = { action: 'clock_set', data: { description: '1023年10月14日 深夜 23:40' } };
 rpEvents.push({ action: 'person_registered', data: { id: '格伦全名', name: '格伦·铁锤' } });
}
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('rp')) lines.at(-1)[2] +='\n<rpEvents>' + JSON.stringify({ version: 2, events: rpEvents }) + '</rpEvents>';
// Open the harness with ?sum for a longer chat whose replies carry full-format story summaries (总结 review).
const beats = [
 ['北境地图', '深夜', '铁匠铺', '旅人、格伦', ['格伦把北境地图摊在铁砧上，用炭笔沿着通往矿坑的旧路描了一遍。', '他问旅人这张图从哪里来，旅人只说是路上捡的。'], '> “这条路三年前就没人走了。” —— [格伦]', '[渡鸦酒馆]：莉娜在清点后门钥匙，发现少了一把。', '地图上矿坑的位置被人用炭笔圈过。', '*格伦认得那道炭笔印。*'],
 ['一封信的价钱', '1023年10月14日 星期三 深夜 23:40', '铁匠铺', '旅人、格伦', ['旅人问通行证的价钱，格伦说不要钱，要旅人替他把一封信送到北方矿坑的看守所。', '格伦从柜子深处取出信封，封口盖着火漆。'], '> “钱我不缺，缺的是一个不会拆信的人。” —— [格伦]', '无', '信的内容；收信人是谁。', '*看守所三天前已经随矿坑一起被封了。*'],
 ['半张通行证', '深夜', '钟楼下', '旅人、格伦', ['格伦把通行证撕成两半，只给了旅人一半。', '旅人不满，但没有争，把半张通行证和信一起收进内袋。'], '> “半张够你过镇口的哨卡，剩下的路看你自己。” —— [格伦]', '[镇口哨卡]：领主的卫兵换了班。', '另一半通行证在格伦手里。', '*撕开的那一半上印着领主的纹章。*'],
];
const fullSummary = ([title, time, place, cast, events, quote, side, hook, wall]) => ['', '<bakemono>', '<details>', '<summary>📋 剧情摘要</summary>',
 `【☆『${title}』★时间：${time}★${place}|${cast}☆】`, '', '➤ 🎬 【场记打板】', ...events.map(e => '- ' + e), '', '➤ 🎙️ 【高光收音】', quote, '',
 '➤ 🌍 【副镜监视器】', side, '', '➤ 🪢 【剧本暗线】', `[未回收伏笔]：${hook}`, '[✅ 本回合回收]：无', '', '➤ 💡 【第四面墙】', wall, '</details>', '</bakemono>'].join('\n');
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('sum')) {
 for (let i = 0; i < 24; i++) lines.push(['旅人', true, `（第 ${i + 1} 段）我继续追问。`], ['格伦', false, `格伦沉默片刻，回答了一部分。${fullSummary(beats[i % beats.length])}`]);
}
export const chat = lines.map(([name,is_user,mes],i)=>({ name, is_user, is_system:false, mes, send_date: new Date(now - (lines.length-i)*600000).toISOString(), swipe_id:0, swipes:[mes], extra:{} }));
export const itemizedPrompts = [];
export async function itemizedParams() { return { modelUsed: 'gpt-4.1（模拟）', presetName: '长篇叙事' }; }
// ?prompt: a last request for 提示词检查器, built when read so it carries the plugin's live injection.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('prompt')) {
 const card = '【角色描述】\n莉娜，渡鸦酒馆的老板娘，左手有一道旧烫伤。说话慢，习惯先擦完杯子再回答。';
 const world = '【雾港镇】港口小镇，领主维克多三年前封了北路。\n【北方矿坑】铁矿，三天前坍塌，入口有卫兵把守。';
 itemizedPrompts.push({
  mesId: chat.findLastIndex(message => !message.is_user),
  charDescription: card, worldInfoString: world, userPersona: '旅人：从南边来的信使，随身带着一张旧地图。',
  get mesSendString() { return chat.map(message => `${message.name}：${message.mes}`).join('\n'); },
  get allAnchors() { return Object.values(window.__injected || {}).filter(Boolean).join('\n\n'); },
  get rawPrompt() {
   return [{ role: 'system', content: card }, { role: 'system', content: world },
    ...Object.values(window.__injected || {}).filter(Boolean).map(content => ({ role: 'system', content })),
    ...chat.map(message => ({ role: message.is_user ? 'user' : 'assistant', content: message.mes }))];
  },
 });
}
export async function generateRaw(){ throw new Error('模拟环境：未连接模型'); }
export async function saveChatConditional(){ return true; }
export function saveSettingsDebounced(){}
export async function saveSettings(){ return true; }
export function setExtensionPrompt(key, value){ (window.__injected ||= {})[key] = value; }
export function getRequestHeaders(){ return {}; }
export function messageFormatting(t){ return String(t); }
