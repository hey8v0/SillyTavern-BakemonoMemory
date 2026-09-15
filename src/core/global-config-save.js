const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

// The host can resolve a save promise without having written settings. Read
// back only to compare the requested revision; never log the settings payload.
export function createGlobalConfigSaveVerifier({ getCurrentConfig, requestSave, readSavedConfig,
    retryDelays = [0, 600, 1600], timeoutMs = 8000 }) {
    let queue = Promise.resolve();
    return function confirm(expected) {
        const key = stable(expected);
        const job = async () => {
            const current = () => !!expected && stable(getCurrentConfig()) === key;
            if (!current()) return { status: 'superseded' };
            const controller = new AbortController();
            let timer;
            try {
                return await Promise.race([
                    (async () => {
                        await requestSave();
                        for (const delay of retryDelays) {
                            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
                            controller.signal.throwIfAborted();
                            if (!current()) return { status: 'superseded' };
                            const saved = await readSavedConfig(controller.signal);
                            controller.signal.throwIfAborted();
                            if (!current()) return { status: 'superseded' };
                            if (stable(saved) === key) return { status: 'confirmed' };
                        }
                        return { status: 'unconfirmed', reason: 'revision-not-found' };
                    })(),
                    new Promise(resolve => { timer = setTimeout(() => {
                        controller.abort(); resolve({ status: 'unconfirmed', reason: 'timeout' });
                    }, timeoutMs); }),
                ]);
            } catch {
                return { status: current() ? 'unconfirmed' : 'superseded', reason: 'save-or-read-failed' };
            } finally { clearTimeout(timer); }
        };
        const result = queue.then(job, job);
        queue = result.catch(() => {});
        return result;
    };
}
