const recoveryStateKeys = [
    'storySummaries',
    'stageSummaries',
    'epicSummaries',
    'drafts',
    'history',
    'coveredBlockHashes',
    'coveredStageHashes',
    'hiddenMessageIds',
    'customHiddenMessageIds',
    'autoHideRecent',
    'autoSummaryTransactions',
    'taskQueue',
    'turnSummary',
];

function cloneSerializable(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function stableHash(value) {
    const source = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableValueHash(value) {
    let hash = 2166136261;
    const update = text => {
        const source = String(text);
        for (let index = 0; index < source.length; index++) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
    };
    const visit = item => {
        if (item === null) return update('null');
        if (item === undefined) return update('undefined');
        if (Array.isArray(item)) {
            update('[');
            for (const value of item) {
                visit(value);
                update(',');
            }
            return update(']');
        }
        if (typeof item === 'object') {
            update('{');
            for (const key of Object.keys(item).sort()) {
                update(key);
                update(':');
                visit(item[key]);
                update(',');
            }
            return update('}');
        }
        update(`${typeof item}:${String(item)}`);
    };
    visit(value);
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function compactRecoveryHistory(value) {
    return (Array.isArray(value) ? value : []).slice(0, 40).map((entry, index) => {
        if (!entry || typeof entry !== 'object') return entry;
        const compact = { ...entry };
        if (entry.draft && typeof entry.draft === 'object') {
            compact.draft = { ...entry.draft, prompt: index < 8 ? entry.draft.prompt : '' };
        }
        if (entry.summary && typeof entry.summary === 'object') {
            compact.summary = { ...entry.summary };
            if (compact.draft?.content && compact.summary.content === compact.draft.content) {
                delete compact.summary.content;
            }
        }
        return compact;
    });
}

function compactRecoveryTasks(value) {
    const source = Array.isArray(value) ? value : [];
    const active = source.filter(task => ['queued', 'running', 'failed'].includes(task?.status));
    const completedLimit = Math.max(0, 80 - active.length);
    const completed = completedLimit
        ? source.filter(task => !['queued', 'running', 'failed'].includes(task?.status)).slice(-completedLimit)
        : [];
    return [...active, ...completed].map(task => task?.status === 'done'
        ? { ...task, prompt: '', blocks: [], rawResult: '' }
        : task);
}

function makeRecoveryState(state, { clone = true } = {}) {
    const snapshot = {};
    for (const key of recoveryStateKeys) {
        const value = state?.[key];
        const selected = key === 'history'
            ? compactRecoveryHistory(value)
            : key === 'taskQueue'
                ? compactRecoveryTasks(value)
                : value ?? (key === 'turnSummary' ? {} : []);
        snapshot[key] = clone ? cloneSerializable(selected) : selected;
    }
    snapshot.persistenceRevision = Math.max(0, Number(state?.persistenceRevision || 0));
    return snapshot;
}

function makeMessagePatches(chat, messageIds = []) {
    return [...new Set((messageIds || []).map(Number).filter(Number.isFinite))]
        .filter(messageId => chat?.[messageId])
        .map(messageId => ({
            messageId,
            mes: String(chat[messageId]?.mes || ''),
            swipes: cloneSerializable(chat[messageId]?.swipes),
        }));
}

export function createSummaryRecoveryJournal({
    storage = null,
    getStorage = null,
    getChatId = () => '',
    keyPrefix = 'bakemono-memory-summary-recovery-v1',
} = {}) {
    function resolveStorage() {
        try {
            return typeof getStorage === 'function' ? getStorage() : storage;
        } catch {
            return null;
        }
    }

    function getKey() {
        const chatId = String(getChatId?.() || '').trim();
        return chatId ? `${keyPrefix}:${stableHash(chatId)}` : '';
    }

    function read() {
        const target = resolveStorage();
        const key = getKey();
        if (!target || !key) return null;
        try {
            const parsed = JSON.parse(target.getItem(key) || 'null');
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }

    function remove() {
        const target = resolveStorage();
        const key = getKey();
        if (!target || !key) return false;
        try {
            target.removeItem(key);
            return true;
        } catch {
            return false;
        }
    }

    function stage(state, chat = [], options = {}) {
        const target = resolveStorage();
        const key = getKey();
        if (!target || !key) return { status: 'unavailable', revision: Number(state?.persistenceRevision || 0) };

        const currentRevision = Math.max(0, Number(state?.persistenceRevision || 0));
        const existing = read();
        if (Number(existing?.revision || 0) > currentRevision) {
            return { status: 'pending-recovery', revision: Number(existing.revision) };
        }

        const patchById = new Map((existing?.messagePatches || []).map(patch => [Number(patch.messageId), patch]));
        for (const patch of makeMessagePatches(chat, options.messageIds || [])) patchById.set(Number(patch.messageId), patch);
        const messagePatches = [...patchById.values()].sort((a, b) => a.messageId - b.messageId);
        const recoveryState = makeRecoveryState(state, { clone: false });
        recoveryState.persistenceRevision = 0;
        const signature = stableValueHash({ state: recoveryState, messagePatches });
        if (existing?.signature === signature && Number(existing?.revision || 0) === currentRevision) {
            return { status: 'unchanged', revision: currentRevision };
        }

        const revision = Math.max(currentRevision, Number(existing?.revision || 0)) + 1;
        const previousRevision = currentRevision;
        state.persistenceRevision = revision;
        const payload = {
            schemaVersion: 1,
            chatIdHash: stableHash(String(getChatId?.() || '')),
            revision,
            signature,
            updatedAt: new Date().toISOString(),
            state: { ...makeRecoveryState(state, { clone: false }), persistenceRevision: revision },
            messagePatches,
        };
        try {
            target.setItem(key, JSON.stringify(payload));
            return { status: 'staged', revision };
        } catch (error) {
            state.persistenceRevision = previousRevision;
            return { status: 'error', revision: previousRevision, error };
        }
    }

    function reconcile(state, chat = []) {
        const payload = read();
        if (!payload) return { status: 'none', revision: Number(state?.persistenceRevision || 0) };
        const savedRevision = Math.max(0, Number(state?.persistenceRevision || 0));
        const pendingRevision = Math.max(0, Number(payload.revision || 0));
        if (pendingRevision <= savedRevision) {
            remove();
            return { status: pendingRevision === savedRevision ? 'verified' : 'stale', revision: savedRevision };
        }

        for (const key of [...recoveryStateKeys, 'persistenceRevision']) {
            if (Object.hasOwn(payload.state || {}, key)) state[key] = cloneSerializable(payload.state[key]);
        }
        let patchedMessages = 0;
        for (const patch of payload.messagePatches || []) {
            const message = chat?.[Number(patch.messageId)];
            if (!message) continue;
            message.mes = String(patch.mes || '');
            if (patch.swipes === undefined) delete message.swipes;
            else message.swipes = cloneSerializable(patch.swipes);
            patchedMessages += 1;
        }
        return { status: 'recovered', revision: pendingRevision, patchedMessages };
    }

    return {
        getKey,
        peek: read,
        reconcile,
        remove,
        stage,
    };
}
