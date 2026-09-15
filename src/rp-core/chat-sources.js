import { sourceSnapshot } from './source.js';
import { readSummarySources } from './summary-source.js';

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
    const swipe = String(Number.isSafeInteger(message.swipe_id) && message.swipe_id >= 0 ? message.swipe_id : 0);
    const info = message.swipe_info?.[Number(swipe)];
    const current = message.extra?.bakemonoRpSource;
    // SillyTavern replaces extra on swipe. Keep message identity outside it and
    // mirror the active branch anchor into swipe_info before the next switch.
    let identity = info?.extra?.bakemonoRpSource || current;
    if (identity?.variantId && identity.swipe !== swipe && !info?.extra?.bakemonoRpSource) identity = null;
    if (identity?.variantId && identity.swipe !== swipe && message.swipe_info?.some((entry, index) => index !== Number(swipe)
        && entry?.extra?.bakemonoRpSource?.variantId === identity.variantId
        && entry.extra.bakemonoRpSource.messageId === identity.messageId)) identity = null;
    if (!info && !identity) identity = message.bakemonoRpVariants?.[swipe];
    if (!identity && !allocate) return null;
    if (!identity) {
        const sibling = message.swipe_info?.find(item => item?.extra?.bakemonoRpSource)?.extra.bakemonoRpSource;
        identity = { messageId: message.bakemonoRpMessageId || sibling?.messageId || current?.messageId || makeId(), variants: {} };
    }
    if (typeof identity.messageId !== 'string' || !identity.variants || typeof identity.variants !== 'object'
        || Array.isArray(identity.variants)) throw new Error('正文来源身份损坏');
    let variantId = identity.variantId || identity.variants[swipe];
    if (!variantId) {
        if (!allocate) return null;
        variantId = makeId();
    }
    if (allocate) {
        if (!message.extra || typeof message.extra !== 'object' || Array.isArray(message.extra)) message.extra = {};
        identity = { ...identity, variants: { ...identity.variants, [swipe]: variantId }, variantId, swipe };
        message.bakemonoRpMessageId ||= identity.messageId;
        message.extra.bakemonoRpSource = identity;
        if (info && typeof info === 'object') {
            if (!info.extra || typeof info.extra !== 'object' || Array.isArray(info.extra)) info.extra = {};
            info.extra.bakemonoRpSource = structuredClone(identity);
        } else {
            if (!message.bakemonoRpVariants || typeof message.bakemonoRpVariants !== 'object' || Array.isArray(message.bakemonoRpVariants)) message.bakemonoRpVariants = {};
            message.bakemonoRpVariants[swipe] = structuredClone(identity);
        }
    }
    const source = sourceSnapshot(message.mes || '', {
        messageId: identity.messageId, variantId,
    }, sourceOptions(state));
    source.supplements = readSummarySources(message.mes || '', { messageId: identity.messageId, variantId }, state);
    return source;
}

export function findChatSource(chat, state, key) {
    const matches = [];
    for (let floor = 0; floor < chat.length; floor++) {
        const source = readChatSource(chat[floor], state);
        for (const item of source ? [source, ...(source.supplements || [])] : []) {
            if (item.messageId + '|' + item.variantId === key) matches.push({ ...item, floor });
        }
    }
    return matches.length === 1 ? matches[0] : null;
}

export function currentChatSources(chat, state) {
    const sources = new Map();
    for (let floor = 0; floor < chat.length; floor++) {
        const source = readChatSource(chat[floor], state);
        if (!source) continue;
        for (const item of [source, ...(source.supplements || [])]) {
            const key = item.messageId + '|' + item.variantId;
            sources.set(key, sources.has(key) ? null : { ...item, floor });
        }
    }
    return sources;
}
