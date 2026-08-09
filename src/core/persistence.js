export function persistChatState(state, options = {}) {
    if (typeof options.prepare === 'function') {
        options.prepare(state);
    }
    if (typeof options.save === 'function') {
        return options.save();
    }
}

export function persistGlobalSettings(save) {
    if (typeof save === 'function') {
        return save();
    }
}
