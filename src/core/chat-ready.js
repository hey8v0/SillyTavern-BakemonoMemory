// Whether the open chat is fully loaded and safe to write.
//
// SillyTavern switches chats in two steps: it points at the new chat, empties `chat` and sets `chat_metadata = {}`,
// then reads the file and replaces both. A save in between writes an empty chat over the file (a tester's chat was
// wiped by a focus event after reopening the tavern). Reloading the same chat empties `chat` but keeps the old
// metadata object, which is just as dangerous. CHAT_CHANGED is only emitted once the file has been read.
//
// So a chat counts as ready when CHAT_CHANGED (or a settled start-up) recorded it, and since then neither the chat id,
// the metadata object (1.13+ may swap it for a copy with the same integrity slug) nor a non-empty chat went away.
// The integrity slug is only extra evidence: SillyTavern 1.12 does not write one.
export function createChatGate({ getContext, getMetadata, getChat } = {}) {
    let loaded = null;

    const chatIdOf = context => String(context?.chatId ?? context?.getCurrentChatId?.() ?? '');
    const hasOwner = context => context?.characterId !== undefined && context?.characterId !== null || !!context?.groupId;

    function markLoaded() {
        const context = getContext?.();
        const metadata = getMetadata?.();
        const chatId = chatIdOf(context);
        if (!chatId || !hasOwner(context) || !metadata || typeof metadata !== 'object') {
            loaded = null;
            return false;
        }
        loaded = { chatId, metadata, integrity: String(metadata.integrity || ''), hadMessages: (getChat?.()?.length || 0) > 0 };
        return true;
    }

    // At start-up the chat may already be open, or still loading: only a chat that shows it was read counts.
    function markLoadedIfSettled() {
        const metadata = getMetadata?.();
        if (!metadata?.integrity && !(getChat?.()?.length > 0)) return false;
        return markLoaded();
    }

    function isReady() {
        if (!loaded) return false;
        const context = getContext?.();
        const metadata = getMetadata?.();
        if (!hasOwner(context) || chatIdOf(context) !== loaded.chatId || !metadata || typeof metadata !== 'object') return false;
        if (metadata !== loaded.metadata) {
            if (!loaded.integrity || metadata.integrity !== loaded.integrity) return false;
            loaded.metadata = metadata;
        }
        const length = getChat?.()?.length || 0;
        if (length > 0) loaded.hadMessages = true;
        else if (loaded.hadMessages) return false;
        return true;
    }

    // A delayed job remembers the chat it belongs to and checks it again before writing.
    function token() {
        return isReady() ? { chatId: loaded.chatId, metadata: loaded.metadata, integrity: loaded.integrity } : null;
    }
    function sameAs(previous) {
        if (!previous || !isReady() || loaded.chatId !== previous.chatId) return false;
        return loaded.metadata === previous.metadata || (!!previous.integrity && previous.integrity === loaded.integrity);
    }

    return { markLoaded, markLoadedIfSettled, isReady, token, sameAs, forget: () => { loaded = null; } };
}

// The plugin's state lives in chat_metadata. While the chat is not ready, callers get a detached copy instead, so
// nothing is written into the metadata object SillyTavern is about to replace (or save) and every
// `ensureState() !== state` check sees a different chat.
const detached = new WeakMap();
export function detachedChatState(metadata, createState) {
    const key = metadata && typeof metadata === 'object' ? metadata : detachedChatState;
    const created = !detached.has(key);
    if (created) detached.set(key, createState());
    return { state: detached.get(key), created };
}
