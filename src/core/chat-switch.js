export const chatSwitchReasons = Object.freeze({
    autoHide: 'chat changed',
    vectorDirty: '切换聊天',
});

export function runChatSwitchFlow(actions = {}) {
    const flow = actions && typeof actions === 'object' ? actions : {};
    const state = typeof flow.getState === 'function' ? flow.getState() : undefined;

    if (typeof flow.recover === 'function') {
        flow.recover(state);
    }
    if (typeof flow.syncConfig === 'function') {
        flow.syncConfig(state);
    }
    if (typeof flow.scan === 'function') {
        flow.scan(state);
    }
    if (typeof flow.scheduleAutoHide === 'function') {
        flow.scheduleAutoHide(chatSwitchReasons.autoHide);
    }
    if (typeof flow.markVectorDirty === 'function') {
        flow.markVectorDirty(chatSwitchReasons.vectorDirty);
    }
    if (typeof flow.syncInjection === 'function') {
        flow.syncInjection();
    }
    // 剧情事实: the idle check against the last message of the chat just opened (it may queue a task).
    if (typeof flow.resumeFacts === 'function') {
        flow.resumeFacts(state);
    }
    if (typeof flow.scheduleRender === 'function') {
        flow.scheduleRender();
    }

    return state;
}
