// The host awaits this interceptor after the current input enters the chat and
// before extension prompts are assembled. Quiet subrequests must not recurse.
export function createVectorAutoRecall({ getState, retrieve, clear, cancelRecall, syncInjection, saveState,
    refresh = () => {}, timeoutMs = 20000, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let active = null, bindings = [];
    function cancel() {
        const previous = active; active = null;
        previous?.controller.abort();
        cancelRecall();
    }
    async function intercept(_chat, _contextSize, _abort, type = 'normal') {
        if (!['normal', 'regenerate', 'swipe', 'continue', ''].includes(type)) return;
        cancel();
        const state = getState();
        if (!state.vectorMemory?.enabled || state.injection?.enabled === false) {
            clear('', state); syncInjection(); return;
        }
        const run = { state, controller: new AbortController(), ownsRecall: () => true };
        active = run;
        const current = () => active === run && getState() === state && run.ownsRecall();
        clear('', state); syncInjection();
        let timer, aborted;
        try {
            const stopped = new Promise((_, reject) => {
                aborted = () => reject(new Error('cancelled'));
                run.controller.signal.addEventListener('abort', aborted, { once: true });
                timer = setTimer(() => reject(new Error('timeout')), timeoutMs);
            });
            await Promise.race([retrieve('', state, { signal: run.controller.signal,
                onStart: owns => { run.ownsRecall = owns; } }), stopped]);
        } catch (error) {
            if (!current()) return;
            clear(error?.message === 'timeout' ? '自动召回超时，本轮继续回复，未使用旧召回。' : '自动召回未完成，本轮继续回复，未使用旧召回。', state);
            run.controller.abort();
        } finally {
            clearTimer(timer);
            run.controller.signal.removeEventListener('abort', aborted);
            if (current()) {
                syncInjection(); refresh(); saveState();
            }
            if (active === run) active = null;
        }
    }
    function dispose() {
        cancel();
        for (const [bus, event, handler] of bindings) (bus.removeListener || bus.off)?.call(bus, event, handler);
        bindings = [];
    }
    function bind(bus, types) {
        dispose();
        for (const event of [types.CHAT_CHANGED, types.GENERATION_STOPPED].filter(Boolean)) {
            bus.on(event, cancel); bindings.push([bus, event, cancel]);
        }
    }
    return { intercept, cancel, bind, dispose };
}
