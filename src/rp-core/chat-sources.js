import { sourceSnapshot } from './source.js';

function newIdentity() {
    if (!globalThis.crypto?.randomUUID) throw new Error('当前环境无法建立可靠的来源身份');
    return globalThis.crypto.randomUUID();
}
const list = value => String(value || '').split(/[\s,，;；]+/).filter(Boolean);

export function sourceOptions(state) {
    return {
        includeTags: list(state.turnSummary?.includeTags),
        excludeTags: [...new Set(['thinking', 'think', 'tableEdit', 'tableThink', 'rpEvents', 'bakemono', 'summaryDraft',
            ...list(state.scanRules?.excludeTags), ...list(state.turnSummary?.excludeTags), ...list(state.vectorMemory?.excludeTags)])],
    };
}

export function readChatSource(message, state, { allocate = false, makeId = newIdentity } = {}) {
    if (!message || message.is_user) return null;
    let identity = message.extra?.bakemonoRpSource;
    if (!identity && !allocate) return null;
    if (!identity) {
        if (!message.extra || typeof message.extra !== 'object' || Array.isArray(message.extra)) message.extra = {};
        identity = { messageId: makeId(), variants: {} };
        message.extra.bakemonoRpSource = identity;
    }
    if (typeof identity.messageId !== 'string' || !identity.variants || typeof identity.variants !== 'object'
        || Array.isArray(identity.variants)) throw new Error('正文来源身份损坏');
    const swipe = String(Number.isSafeInteger(message.swipe_id) && message.swipe_id >= 0 ? message.swipe_id : 0);
    if (!Object.hasOwn(identity.variants, swipe)) {
        if (!allocate) return null;
        identity.variants[swipe] = makeId();
    }
    return sourceSnapshot(message.mes || '', {
        messageId: identity.messageId, variantId: identity.variants[swipe],
    }, sourceOptions(state));
}

export function findChatSource(chat, state, key) {
    const matches = [];
    for (let floor = 0; floor < chat.length; floor++) {
        const source = readChatSource(chat[floor], state);
        if (source && source.messageId + '|' + source.variantId === key) matches.push({ ...source, floor });
    }
    return matches.length === 1 ? matches[0] : null;
}
