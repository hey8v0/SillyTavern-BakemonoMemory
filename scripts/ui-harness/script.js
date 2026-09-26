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
export const chat = lines.map(([name,is_user,mes],i)=>({ name, is_user, is_system:false, mes, send_date: new Date(now - (lines.length-i)*600000).toISOString(), swipe_id:0, swipes:[mes], extra:{} }));
export const itemizedPrompts = [];
export const itemizedParams = {};
export async function generateRaw(){ throw new Error('模拟环境：未连接模型'); }
export async function saveChatConditional(){ return true; }
export function saveSettingsDebounced(){}
export async function saveSettings(){ return true; }
export function setExtensionPrompt(key, value){ (window.__injected ||= {})[key] = value; }
export function getRequestHeaders(){ return {}; }
export function messageFormatting(t){ return String(t); }
