import { createDefaultFacts } from '../../src/facts/model.js';
import { createFactsController } from '../../src/features/facts-controller.js';
import { createSummaryTaskQueue } from '../../src/features/summary-task-queue.js';
import { getHash } from '../../src/shared/text.js';

export const blockTypes = { STORY: 'story', STAGE: 'stage', EPIC: 'epic', FACTS: 'facts' };
export const reply = (cards, extra = {}) => `好的。\n<factCards>\n${JSON.stringify({ cards, retired: [], reflection: {}, ...extra })}\n</factCards>`;
export const lin = (处境 = '在书店') => ({ kind: 'person', name: '林晚', fields: { 处境, 目标: '找到旧信的主人' } });

// A chat with one 剧情摘要 per reply (even floors; saved and read-from-reply in turn), the facts controller and
// the real task queue around a fake model. The last floor is the open reply.
export function factsRuntime({ enabled = true, auto = true, review = false, every = 3, idleMinutes = 10, floors = 12, summaries = 3 } = {}) {
    const chat = Array.from({ length: floors }, (_, i) => ({ mes: `正文 ${i}`, is_user: i % 2 === 1 }));
    const state = { facts: { ...createDefaultFacts(), settings: { ...createDefaultFacts().settings, enabled, auto, review, everySummaries: every, idleMinutes } },
        generationPrompts: {}, taskQueue: [], drafts: [], storySummaries: [], blocks: [], stageSummaries: [], epicSummaries: [], automation: {} };
    const isSaved = floor => (floor / 2) % 2 === 1;
    const addSummary = (floor, text = '林晚去码头。') => {
        if (isSaved(floor)) state.storySummaries.push({ hash: `s${floor}`, contentHash: getHash(`<bakemono>${text}</bakemono>`), content: `<bakemono>${text}</bakemono>`, sourceMessageIds: [floor] });
        else state.blocks.push({ hash: `b${floor}`, type: 'story', messageId: floor, content: text, sourceKind: 'tag' });
    };
    // The saved summary keeps its id and gets a new content hash (an edit); a reply block is rescanned under a new hash (a reroll).
    const editSummary = (floor, text) => {
        if (isSaved(floor)) {
            const index = state.storySummaries.findIndex(item => item.hash === `s${floor}`);
            state.storySummaries[index] = { ...state.storySummaries[index], content: `<bakemono>${text}</bakemono>`, contentHash: getHash(`<bakemono>${text}</bakemono>`) };
        } else {
            const index = state.blocks.findIndex(item => item.hash === `b${floor}` || item.hash === `b${floor}-v2`);
            state.blocks[index] = { ...state.blocks[index], hash: `b${floor}-v2`, content: text };
        }
    };
    const removeSummary = floor => {
        state.storySummaries = state.storySummaries.filter(item => item.hash !== `s${floor}`);
        state.blocks = state.blocks.filter(item => !item.hash.startsWith(`b${floor}`));
    };
    for (let floor = 2; floor < 2 + summaries * 2; floor += 2) addSummary(floor);
    const toasts = [], scopes = [], timers = [], invalid = new Set();
    const clock = { now: Date.parse('2026-10-26T10:00:00.000Z') };
    const toastr = { info: (m, t) => toasts.push(['info', m, t]), warning: m => toasts.push(['warning', m]), error: m => toasts.push(['error', m]), success: () => {}, clear: () => {} };
    let result = '', current = state, ready = true;
    const queue = createSummaryTaskQueue({ getState: () => current, getHash, getKindLabel: k => k, saveState: () => {}, renderWorkbenchScope: (s, t) => scopes.push(t), renderTaskQueueProgress: () => {},
        workbenchRenderScopes: { DRAFTS: 'drafts' }, getIsBusy: () => false, setBusy: () => {}, toastr, callGenerationModel: async () => typeof result === 'function' ? result() : result, normalizeGeneratedBakemono: v => v,
        createDraft: () => { throw Error('facts never become drafts'); }, commitDraft: async () => null, blockTypes, defaultAutomation: {}, switchWorkbenchTab: () => {},
        getTaskSourceSignature: task => controller.sourceSignature(task, current),
        resultHandlers: { facts: (...args) => controller.handleTaskResult(...args) } });
    const controller = createFactsController({ getState: () => current, getChat: () => chat, saveState: () => {}, enqueueSummaryTask: task => queue.enqueueSummaryTask({ ...task, autoStart: false }),
        blockTypes, getBlockPlainText: text => String(text).replace(/<[^>]+>/g, ''), toastr, renderWorkbenchScope: (s, t) => scopes.push(t), workbenchRenderScopes: { DRAFTS: 'drafts' },
        confirm: async () => true, storyTimeContext: () => '', isChatReady: () => ready, now: () => new Date(clock.now).toISOString(),
        summaryStatus: (s, item) => ({ valid: !invalid.has(item.hash) }),
        setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
        createDraft: data => { const draft = { id: 'draft-' + current.drafts.length, title: data.metadata?.suggestedTitle || '', ...data }; current.drafts.unshift(draft); return draft; } });
    const factsTasks = () => current.taskQueue.filter(task => task.kind === 'facts');
    return { state, chat, queue, controller, toasts, scopes, timers, invalid, clock, addSummary, editSummary, removeSummary, factsTasks,
        setResult: value => { result = value; }, setReady: value => { ready = value; }, switchChat: () => { current = structuredClone(state); },
        pendingFloors: () => controller.pendingSummaries(current).map(entry => entry.floorEnd) };
}
