import { createVectorMemoryService } from '../../src/features/vector-memory-service.js';
import { computeHybridRerankScore, selectHybridCandidates } from '../../src/vector/hybrid-retrieval.js';
import { compactEmbedding, getClippedVectorText } from '../../src/vector/storage.js';
import * as text from '../../src/shared/text.js';
import * as math from '../../src/vector/math.js';
import * as provider from '../../src/vector/provider-config.js';

const noop = () => {};

// The real vector service over a small chat, with the plugin's local embedding unless a test brings its own.
export function recallFixture(chat, settings = {}, overrides = {}) {
    const defaults = { enabled: true, indexMode: 'message', embeddingProvider: 'local', embeddingDimensions: 192,
        includeHidden: true, includeUser: false, maxIndexedMessages: 0, chunkSize: 900, overlap: 120, longMessageThreshold: 1800,
        summaryTags: 'bakemono,summaryDraft', excludeTags: 'thinking,think,reasoning', summaryMaxChars: 520,
        maxStoredTextChars: 1200, perMessageMaxChars: 1600, maxInjectChars: 2600, rerankCandidateCount: 20,
        finalRecallCount: 5, fullRecallCount: 2, maxSummaryRecall: 4, embeddingThreshold: 0.05, rerankThreshold: 0.45, keywordBoost: 0.18,
        queryMode: 'off', skipIfAllInContext: true, contextWindowMessages: 2, autoIndex: true, recallSafetyChars: 12000, ...settings };
    const state = { vectorMemory: { ...defaults, records: [] }, scanRules: {}, storySummaries: [], stageSummaries: [], epicSummaries: [], memoryStrategy: 'bakemono' };
    const embedded = [];
    const dependencies = { ...text, ...math, ...provider, defaultVectorMemory: defaults, getState: () => state, getContext: () => ({ chat }),
        normalizeLineEndings: String, stripHtml: s => String(s).replace(/<[^>]*>/g, ''), unique: xs => [...new Set(xs)],
        toPlainPreview: (s, n) => String(s).slice(0, n), getClippedVectorText, getMessageVariantKey: () => 0,
        getActiveCoveredStageHashes: () => new Set(), getActiveEpicMemoryBlocks: () => [],
        memoryStrategies: { GENERIC: 'generic' }, blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' },
        saveState: noop, syncInjection: noop, renderWorkbenchScope: noop, workbenchRenderScopes: {}, toastr: { success: noop, warning: noop },
        createLocalEmbedding: (source, size) => { embedded.push(source); return math.createLocalEmbedding(source, size); },
        compactEmbedding, selectHybridCandidates, computeHybridRerankScore, countKeywordHits: (source, words) => words.filter(word => source.includes(word)).length,
        yieldToUi: async () => {}, ...overrides };
    const service = createVectorMemoryService(dependencies);
    return { state, chat, service, embedded, dependencies, recall: () => service.retrieveVectorMemoryHits('') };
}

// A chat of long replies, so a query made of many messages runs past the term limit.
export const longReply = (seed, chars = 900) => Array.from({ length: Math.ceil(chars / 22) }, (_, i) => `${seed}${String.fromCharCode(0x4e00 + (i * 37 + seed.length * 11) % 2000)}${String.fromCharCode(0x5e00 + (i * 53) % 2000)}走过街角又回到门口。`).join('');
