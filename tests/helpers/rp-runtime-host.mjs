import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRpCoreService } from '../../src/rp-core/service.js';
import { createRpExtractionFlow } from '../../src/rp-core/extraction-flow.js';
import { createInjectionService } from '../../src/features/injection-service.js';
import { createMemoryOrchestrator } from '../../src/features/memory-orchestrator.js';
import { renderInjectionTemplate } from '../../src/shared/injection-template.js';
import { createRpPromptHost } from './rp-prompt-host.mjs';

const entry = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
const binding = (name, factory) => {
    const match = entry.match(new RegExp(`const ${name} = ${factory}\\([\\s\\S]*?^\\}\\);`, 'm'));
    assert.ok(match, name); return match[0];
};
// Production constructors and index callbacks, with only host I/O replaced.
export function runtimeHost() {
    let state = { injection: { enabled: true, template: '{{memory}}' }, inlineGeneration: {}, turnSummary: { enabled: false, auto: false },
        automation: { enabled: false }, storySummaries: [], memoryStrategy: 'bakemono' };
    const chat = [{ mes: '甲带着钥匙进入书店。' }], prompts = new Map(), warnings = [], host = createRpPromptHost();
    const noop = () => {}, empty = () => '', list = () => [];
    const context = vm.createContext({
        createRpCoreService, createRpExtractionFlow, createInjectionService, createMemoryOrchestrator,
        ensureState: () => state, chat, getSummaryRecoveryChatIdentity: () => 'chat-A', saveState: () => ({}), saveChatConditional: async () => {},
        rpPromptLibrary: host.library, callGenerationModel: async () => { throw Error('No real model calls in this test'); },
        getCharacterReferenceContext: () => '', runVisibleOperation: async (_label, run) => run(), isBusy: false,
        scheduleRenderAll: noop, console: { warn: message => warnings.push(message) },
        getActiveEpicMemoryBlocks: list, getMultiSummaryLabel: empty, getActiveCoveredStageHashes: () => new Set(), getStageMemoryBlocks: list,
        memoryStrategies: { GENERIC: 'generic' }, renderInjectedTablesSection: state => state.tableDatabase?.injectMemory === false ? '' : '旧表独立内容',
        renderVectorMemorySection: empty, setExtensionPrompt: (key, text) => prompts.set(key, text), INJECTION_KEY: 'memory',
        extension_prompt_types: { IN_CHAT: 1 }, extension_prompt_roles: { SYSTEM: 0 }, defaultState: { injection: { depth: 999 } },
        formatTableDataForPrompt: empty, formatTableGuideForPrompt: empty, formatSpecificTablesForPrompt: empty,
        getReadonlyTables: list, getWritableTables: list, defaultInlineSummaryPrompt: '摘要指令', defaultInlineTablePrompt: '表格指令',
        inlinePromptKeys: { SUMMARY: 'summary', TABLE: 'table', RP_STATE: 'rp' }, defaultInjectionTemplate: '{{memory}}', renderInjectionTemplate,
        scanBakemonoBlocks: noop, getUnsummarizedStoryBlocks: list, getHash: String, defaultAutomation: {},
        toastr: { warning: message => warnings.push(message), info: noop }, renderWorkbenchScope: noop, workbenchRenderScopes: {}, generateStageDraft: noop,
        turnProcessingModes: { TABLE: 'table', BOTH: 'both' }, processLatestTableEdit: noop, processLatestTurnSummary: noop,
        getCurrentFloorMemoryIndex: () => ({}), getMemoryOrchestrationPlan: () => ({ actions: {} }),
        captureInlineGenerationFromLatestMessage: noop, scheduleInlineGenerationCapture: noop, scheduleAutoHideRecent: noop, markVectorIndexDirty: noop,
        scheduleVectorAutoIndex: noop, shouldRunTurnProcessing: () => false,
    });
    const code = [binding('rpCoreService', 'createRpCoreService'), binding('rpExtractionFlow', 'createRpExtractionFlow'),
        binding('injectionService', 'createInjectionService'), 'const { syncInjection } = injectionService;', binding('memoryOrchestrator', 'createMemoryOrchestrator'),
        '({ service: rpCoreService, flow: rpExtractionFlow, injection: injectionService, orchestrator: memoryOrchestrator })'].join('\n');
    const runtime = vm.runInContext(code, context);
    return { ...runtime, chat, prompts, warnings, library: host.library, get state() { return state; },
        switchChat: () => { state = structuredClone(state); },
        async sendUser() {
            const listeners = new Map(); context.eventSource = { on: (key, callback) => listeners.set(key, callback) };
            context.event_types = { MESSAGE_SENT: 'sent' }; context.runMemoryOrchestrator = runtime.orchestrator.runMemoryOrchestrator;
            const start = entry.indexOf('    if (event_types.MESSAGE_SENT) {');
            const end = entry.indexOf('    if (event_types.ITEMIZED_PROMPTS_LOADED)', start);
            assert.ok(start > 0 && end > start); vm.runInContext(entry.slice(start, end), context);
            await listeners.get('sent')();
        } };
}
