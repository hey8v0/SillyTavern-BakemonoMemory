import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createChatGate } from '../src/core/chat-ready.js';
import { resolveChatStateSlot } from '../src/core/chat-state-service.js';
import { createMemoryOrchestrator } from '../src/features/memory-orchestrator.js';

// A tester's chat file was overwritten with nothing after reopening the tavern: SillyTavern points at the chat,
// empties it and blanks chat_metadata, then reads the file; a focus event in between made the plugin save.
function tavern({ integrity = true } = {}) {
    const host = { characterId: 1, groupId: null, chatId: 'Kuroha - A', chat: [], metadata: {} };
    host.open = (chatId, messages, metadata = {}) => {
        // The gap: new chat id, empty chat, blank metadata.
        host.chatId = chatId; host.chat.length = 0; host.metadata = {};
        return () => {
            host.metadata = { ...metadata, ...(integrity && !metadata.integrity ? { integrity: 'slug-' + chatId } : {}) };
            host.chat.push(...messages);
            gate.markLoaded(); // CHAT_CHANGED
        };
    };
    const gate = createChatGate({ getContext: () => ({ characterId: host.characterId, groupId: host.groupId, chatId: host.chatId }),
        getMetadata: () => host.metadata, getChat: () => host.chat });
    return { host, gate };
}

test('the gap after picking a character, reopening the tavern or reloading the chat is not writable', () => {
    for (const integrity of [true, false]) {
        const { host, gate } = tavern({ integrity });
        host.open('Kuroha - A', [{ mes: '一' }, { mes: '二' }])();
        assert.equal(gate.isReady(), true, 'loaded');
        const finish = host.open('Kuroha - A', [{ mes: '一' }, { mes: '二' }]);
        assert.equal(gate.isReady(), false, 'same chat reopened, file not read yet');
        assert.equal(gate.token(), null);
        finish();
        assert.equal(gate.isReady(), true);
        // /reload: the chat is emptied while the old metadata object (with its integrity) stays.
        host.chat.length = 0;
        assert.equal(gate.isReady(), false, 'emptied chat with the old metadata');
    }
});

test('SillyTavern 1.12 has no integrity slug and still saves once the chat is loaded', () => {
    const { host, gate } = tavern({ integrity: false });
    assert.equal(gate.markLoadedIfSettled(), false, 'nothing open at start-up');
    host.open('A', [{ mes: '一' }])();
    assert.equal(host.metadata.integrity, undefined);
    assert.equal(gate.isReady(), true);
    host.open('A', [])(); // a card without a greeting
    assert.equal(gate.isReady(), true, 'an empty chat that was read is writable');
});

test('a copy of the metadata with the same integrity (updateChatMetadata) stays writable; another chat does not', () => {
    const { host, gate } = tavern();
    host.open('A', [{ mes: '一' }])();
    const token = gate.token();
    host.metadata = { ...host.metadata };
    assert.equal(gate.isReady(), true);
    assert.equal(gate.sameAs(token), true);
    host.open('B', [{ mes: 'b' }])();
    assert.equal(gate.sameAs(token), false, 'a job from chat A must not write into chat B');
    host.characterId = undefined;
    assert.equal(gate.isReady(), false, 'no character open');
});

test('while the chat is loading, the plugin state is not created inside chat_metadata', () => {
    const metadata = {};
    const slot = resolveChatStateSlot({ isChatReady: () => false, getChatMetadata: () => metadata, storageKey: 'bakemonoMemory', createState: () => ({ fresh: true }) });
    assert.equal(slot.detached, true);
    assert.deepEqual(Object.keys(metadata), []);
    assert.equal(resolveChatStateSlot({ isChatReady: () => false, getChatMetadata: () => metadata, storageKey: 'bakemonoMemory', createState: () => ({}) }).state, slot.state, 'one detached state per loading chat');
    const ready = resolveChatStateSlot({ isChatReady: () => true, getChatMetadata: () => metadata, storageKey: 'bakemonoMemory', createState: () => ({ live: true }) });
    assert.equal(metadata.bakemonoMemory, ready.state);
    assert.notEqual(ready.state, slot.state, 'jobs that started during the gap see a different chat');
});

// The real save wrappers and saveState from index.js, run against a fake tavern.
const entry = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const slice = (from, to) => { const start = entry.indexOf(from), end = entry.indexOf(to, start); assert.ok(start > 0 && end > start, from); return entry.slice(start, end); };
function plugin() {
    const { host, gate } = tavern();
    const calls = { chat: 0, conditional: 0, journal: 0 }, written = [], timers = [];
    const context = vm.createContext({
        createChatGate: () => gate, getContext: () => ({ ...host }), isChatSaving: false,
        get chat() { return host.chat; }, get chat_metadata() { return host.metadata; },
        // saveChat takes the chat as it is at the call; saveChatConditional (groups only) is counted.
        hostSaveChat: async () => { calls.chat++; written.push({ chatId: host.chatId, messages: host.chat.length, integrity: host.metadata.integrity }); },
        hostSaveChatConditional: async () => { calls.conditional++; },
        document: { querySelector: () => null },
        setTimeout: (fn, ms) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, Promise, Number, console: { warn() {}, error() {} },
        STORAGE_KEY: 'bakemonoMemory', captureChronicle() {}, summaryRecoveryJournal: { stage: () => { calls.journal++; return { status: 'staged' }; } },
        persistChatState: (state, { prepare, save }) => { prepare(state); save(); }, slimVectorMemoryForSave() {}, defaultVectorMemory: {},
    });
    vm.runInContext(slice('const chatGate = createChatGate(', 'const summaryRecoveryJournal = createSummaryRecoveryJournal({')
        + slice('function saveState(options = {}) {', 'function saveGlobalSettings() {')
        + 'globalThis.api = { saveChatConditional, saveMetadataDebounced, hideChatMessageRange, saveState };', context);
    return { host, gate, calls, written, context, api: context.api, flush: () => { while (timers.length) timers.shift()(); } };
}

test('in the gap nothing is written to the chat file, and nothing is left in chat_metadata', async () => {
    const p = plugin();
    p.host.open('Kuroha - A', [{ mes: '一' }])();
    const finish = p.host.open('Kuroha - A', [{ mes: '一' }]); // reopening: characterId set, chat empty, metadata blank
    assert.equal(p.api.saveState().status, 'not-ready');
    assert.equal(await p.api.saveChatConditional(), false);
    await p.api.hideChatMessageRange(0, 0, true);
    p.api.saveMetadataDebounced(); p.flush();
    assert.deepEqual(p.calls, { chat: 0, conditional: 0, journal: 0 });
    assert.deepEqual(Object.keys(p.host.metadata), []);
    finish();
    p.host.metadata.bakemonoMemory = { vectorMemory: {} };
    assert.equal(p.api.saveState().status, 'staged', 'once loaded, saving works again');
    p.flush(); await new Promise(r => setImmediate(r));
    assert.equal(await p.api.saveChatConditional(), true);
    await p.api.hideChatMessageRange(0, 0, false);
    assert.equal(p.host.chat[0].is_system, true);
    assert.deepEqual(p.written.map(w => w.messages), [1, 1, 1], 'metadata save, chat save and hiding each wrote the loaded chat');
    assert.equal(p.calls.conditional, 0, "SillyTavern's delayed save is not used for a character chat");
});

test('a save that waits for a running save is dropped when another chat is opened meanwhile', async () => {
    const p = plugin();
    p.host.open('A', [{ mes: '一' }, { mes: '二' }])();
    p.context.isChatSaving = true;
    const saving = p.api.saveChatConditional();
    p.host.open('A', [{ mes: '一' }, { mes: '二' }]); // the user reopens the chat while the other save runs
    p.context.isChatSaving = false;
    p.flush();
    assert.equal(await saving, false);
    assert.equal(p.calls.chat, 0);
});

test('a metadata save queued in one chat is dropped when another chat (or a reload of it) is open when it fires', () => {
    const p = plugin();
    p.host.open('A', [{ mes: '一' }])();
    p.host.metadata.bakemonoMemory = { vectorMemory: {} };
    p.api.saveState();
    p.host.open('A', [{ mes: '一' }]); // the same character is reopened within the second
    p.flush();
    assert.equal(p.calls.chat, 0);
});

test('the orchestrator, foreground resume, recovery and start-up all wait for a loaded chat', async () => {
    let scans = 0;
    const orchestrator = createMemoryOrchestrator({ isChatReady: () => false, scanBakemonoBlocks: () => { scans++; }, ensureState: () => { throw Error('must not run'); } });
    assert.deepEqual(await orchestrator.runMemoryOrchestrator('恢复前台'), {});
    await orchestrator.maybeRunAutoSummary();
    assert.equal(scans, 0);
    assert.match(entry, /foregroundResumeTimer = null;\s*if \(document\.visibilityState === 'hidden'\) return;[\s\S]{0,200}?if \(!chatGate\.isReady\(\)\) return;/);
    assert.match(entry, /function reconcileSummaryRecovery\(state = ensureState\(\)\) \{[\s\S]{0,140}?if \(!chatGate\.isReady\(\)\) return \{ status: 'not-ready' \};/);
    assert.match(entry, /async function init\(\) \{\s*\/\/[^\n]*\n\s*eventSource\.on\(event_types\.CHAT_CHANGED, \(\) => \{ chatGate\.markLoaded\(\); \}\);/);
    assert.match(entry, /const chatOpen = chatGate\.markLoadedIfSettled\(\);[\s\S]{0,120}?if \(chatOpen\) \{\s*reconcileSummaryRecovery\(initialState\);/);
    // Every module gets the guarded functions: the host ones are only reachable through the wrappers.
    assert.equal((entry.match(/hostSaveChatConditional/g) || []).length, 2, 'imported, and used for group chats only');
    assert.equal((entry.match(/hostSaveChat\b/g) || []).length, 2);
    assert.doesNotMatch(entry, /from '\.\.\/\.\.\/\.\.\/chats\.js'/, "SillyTavern's hideChatMessageRange saves through the delayed path");
    assert.doesNotMatch(entry, /import \{[^}]*\bsaveMetadataDebounced\b[^}]*\} from '\.\.\/\.\.\/\.\.\/extensions\.js'/);
});
