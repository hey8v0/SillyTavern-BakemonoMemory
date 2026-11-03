/**
 * Which messages are left out of what one request sends. Pure.
 * A floor a valid 阶段 or 多次总结 covers is told by that summary, which goes with every message (or comes back when
 * recalled); its text need not go too, nor the user message that led to it. The latest few visible messages always
 * go, and so does every floor no such summary covers yet.
 */
export const defaultKeepRecent = 10;

// `coveredFloors`: the floors the covered summaries came from. Returns the message ids to leave out, ascending.
export function planSkippedFloors(chat = [], coveredFloors = [], { keepRecent = defaultKeepRecent } = {}) {
    const visible = chat.map((message, id) => ({ message, id })).filter(({ message }) => message && !message.is_system).map(({ id }) => id);
    const kept = new Set(keepRecent > 0 ? visible.slice(-keepRecent) : []);
    const skipped = new Set();
    for (const floor of new Set(coveredFloors)) {
        const message = chat[floor];
        if (!message || message.is_system || kept.has(floor)) continue;
        skipped.add(floor);
        // The user message that led to this reply: the nearest visible message before it, when that is the user's.
        for (let id = floor - 1; id >= 0; id--) {
            const previous = chat[id];
            if (!previous || previous.is_system) continue;
            if (previous.is_user && !kept.has(id)) skipped.add(id);
            break;
        }
    }
    return new Set([...skipped].sort((a, b) => a - b));
}
