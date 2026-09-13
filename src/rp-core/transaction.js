export function createRpTransactions({ getState, saveState, saveChat }) {
    const queues = new WeakMap();
    function commit(expectedState, expectedRevision, nextCore, validateSource = () => true) {
        const previous = queues.get(expectedState) || Promise.resolve();
        const operation = previous.catch(() => {}).then(async () => {
            if (getState() !== expectedState || (expectedState.rpCore?.revision ?? null) !== expectedRevision) {
                throw new Error('聊天或剧情状态已变化，请重新预览');
            }
            if (!validateSource()) throw new Error('正文来源已变化，请重新预览');
            const before = expectedState.rpCore;
            const prepared = structuredClone(nextCore);
            const serialized = JSON.stringify(prepared);
            expectedState.rpCore = prepared;
            try {
                const staged = saveState();
                if (staged?.status === 'error') throw staged.error || new Error('剧情状态暂存失败');
                await saveChat();
            } catch (error) {
                if (expectedState.rpCore === prepared && JSON.stringify(prepared) === serialized) {
                    if (before === undefined) delete expectedState.rpCore;
                    else expectedState.rpCore = before;
                    if (getState() === expectedState) saveState();
                }
                throw error;
            }
            return { committed: true, currentChat: getState() === expectedState, revision: prepared.revision };
        });
        queues.set(expectedState, operation);
        return operation;
    }
    return { commit };
}
