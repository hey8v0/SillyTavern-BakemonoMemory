const rebuildableStateKeys = new Set(['blocks', 'scanPreview', 'memoryRecords']);

function compactHistoryEntry(entry, index, keepPromptsFor = 8) {
    if (!entry || typeof entry !== 'object') return entry;
    const compact = { ...entry };
    if (entry.draft && typeof entry.draft === 'object') {
        compact.draft = { ...entry.draft };
        if (index >= keepPromptsFor) compact.draft.prompt = '';
    }
    if (entry.summary && typeof entry.summary === 'object') {
        compact.summary = { ...entry.summary };
        if (compact.draft?.content && compact.summary.content === compact.draft.content) {
            delete compact.summary.content;
        }
    }
    return compact;
}

function compactTaskQueue(tasks, limit = 80) {
    const source = Array.isArray(tasks) ? tasks : [];
    const active = source.filter(task => ['queued', 'running', 'failed'].includes(task?.status));
    const completedLimit = Math.max(0, limit - active.length);
    const completed = completedLimit
        ? source.filter(task => !['queued', 'running', 'failed'].includes(task?.status)).slice(-completedLimit)
        : [];
    return [...active, ...completed]
        .map(task => task?.status === 'done'
            ? { ...task, prompt: '', blocks: [], rawResult: '' }
            : task);
}

export function buildPersistedChatState(state, options = {}) {
    const historyLimit = Math.max(1, Number(options.historyLimit || 40));
    const keepPromptsFor = Math.max(0, Number(options.keepPromptsFor || 8));
    const taskLimit = Math.max(10, Number(options.taskLimit || 80));
    const snapshot = {};

    for (const [key, value] of Object.entries(state || {})) {
        if (rebuildableStateKeys.has(key)) continue;
        if (key === 'injection' && value && typeof value === 'object') {
            snapshot.injection = { ...value };
            delete snapshot.injection.content;
            continue;
        }
        if (key === 'history') {
            snapshot.history = (Array.isArray(value) ? value : [])
                .slice(0, historyLimit)
                .map((entry, index) => compactHistoryEntry(entry, index, keepPromptsFor));
            continue;
        }
        if (key === 'taskQueue') {
            snapshot.taskQueue = compactTaskQueue(value, taskLimit);
            continue;
        }
        snapshot[key] = value;
    }
    return snapshot;
}

export function installCompactStateSerializer(state, options = {}) {
    if (!state || typeof state !== 'object') return state;
    Object.defineProperty(state, 'toJSON', {
        configurable: true,
        enumerable: false,
        value() {
            return buildPersistedChatState(this, options);
        },
    });
    return state;
}
