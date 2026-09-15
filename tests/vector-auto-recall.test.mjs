import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVectorAutoRecall } from '../src/features/vector-auto-recall.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function setup(retrieve = async () => []) {
    let state = { injection: { enabled: true }, vectorMemory: { enabled: true, lastHits: ['old'] } };
    const calls = [];
    const auto = createVectorAutoRecall({ getState: () => state, retrieve: async (...args) => { calls.push('retrieve'); return retrieve(...args); },
        clear: (reason, s) => { s.vectorMemory.lastHits = []; s.vectorMemory.lastRecallSkippedReason = reason; calls.push('clear'); },
        cancelRecall: () => calls.push('cancel'), syncInjection: () => calls.push('sync'), saveState: () => calls.push('save'),
        timeoutMs: 40,
    });
    return { auto, calls, get state() { return state; }, switchChat() { state = structuredClone(state); } };
}

test('real interceptor is wired in manifest and waits for recall before prompt assembly', async () => {
    const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.equal(manifest.generate_interceptor, 'bakemonoMemoryRecallInterceptor');
    assert.match(index, /globalThis\.bakemonoMemoryRecallInterceptor\s*=\s*vectorAutoRecall\.intercept/);
    assert.match(index, /cancelVectorRecall,\s*clearVectorRecall,\s*scheduleVectorAutoIndex/);
    const d = deferred(), f = setup(() => d.promise);
    let promptBuilt = false;
    const run = f.auto.intercept([], 8000, () => {}, 'normal').then(() => { promptBuilt = true; });
    assert.equal(promptBuilt, false); assert.ok(f.calls.includes('retrieve'));
    d.resolve([]); await run;
    assert.equal(promptBuilt, true); assert.equal(f.calls.at(-1), 'save');
});

test('normal/swipe/continue run but quiet/impersonation and disabled injection never query', async () => {
    const f = setup();
    for (const type of ['quiet', 'impersonate', 'unknown']) await f.auto.intercept([], 8000, () => {}, type);
    assert.equal(f.calls.includes('retrieve'), false);
    for (const type of ['normal', 'swipe', 'continue', 'regenerate']) await f.auto.intercept([], 8000, () => {}, type);
    assert.equal(f.calls.filter(s => s === 'retrieve').length, 4);
    f.state.injection.enabled = false; await f.auto.intercept([], 8000, () => {}, 'normal');
    assert.equal(f.calls.filter(s => s === 'retrieve').length, 4);
});

test('a failed or timed-out recall continues without stale memory and never aborts main generation', async () => {
    for (const mode of ['fail', 'hang']) {
        const f = setup(() => mode === 'fail' ? Promise.reject(new Error('mock')) : new Promise(() => {}));
        await f.auto.intercept([], 8000, () => { throw new Error('main must continue'); }, 'normal');
        assert.deepEqual(f.state.vectorMemory.lastHits, []);
        assert.match(f.state.vectorMemory.lastRecallSkippedReason, /召回/);
        assert.equal(f.calls.at(-1), 'save');
    }
});

test('cancel/chat switch prevents stale completion and repeated binding never accumulates handlers', async () => {
    const d = deferred(), f = setup(() => d.promise), listeners = new Map();
    const bus = { on: (name, fn) => { const set = listeners.get(name) || new Set(); set.add(fn); listeners.set(name, set); },
        removeListener: (name, fn) => listeners.get(name)?.delete(fn) };
    const types = { CHAT_CHANGED: 'chat', GENERATION_STOPPED: 'stop' };
    f.auto.bind(bus, types); f.auto.bind(bus, types);
    assert.equal(listeners.get('chat').size, 1);
    const run = f.auto.intercept([], 8000, () => {}, 'normal');
    f.switchChat(); for (const fn of listeners.get('chat')) fn();
    f.calls.length = 0; d.resolve([]); await run;
    assert.deepEqual(f.calls, []);
    f.auto.dispose(); assert.equal(listeners.get('chat').size, 0);
});
