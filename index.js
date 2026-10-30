import { chat, chat_metadata, extension_prompt_roles, extension_prompt_types, eventSource, event_types, generateRaw, isChatSaving, itemizedParams, itemizedPrompts, saveChat as hostSaveChat, saveChatConditional as hostSaveChatConditional, saveSettingsDebounced, setExtensionPrompt } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { getImageSizeFromDataURL } from '../../../utils.js';
import { runChatSwitchFlow } from './src/core/chat-switch.js';
import { createChatGate } from './src/core/chat-ready.js';
import { captureChronicle } from './src/memory/story-state.js';
import { getSummaryStatus } from './src/memory/summary-provenance.js';
// Read as a namespace: helpers that older SillyTavern versions do not export must not stop the plugin from loading.
import * as hostScript from '../../../../script.js';
import { factsRecallHints } from './src/facts/recall.js';
import {createSummarySourceService} from './src/features/summary-source-service.js';
import { createStoryToolsUi } from './src/features/story-tools-ui.js';
import { createAutomationBehaviorConfig, createSharedInlineGenerationConfig, createSharedVectorConfig, isStateConfigNewerThanActive, markActiveConfigApplied, mergeAutomationBehaviorConfig, mergeSharedInlineGenerationConfig, mergeSharedVectorConfig, readActiveConfig, sharedConfigVersion, shouldBootstrapSharedConfig, shouldSyncActiveConfig } from './src/core/config-sync.js';
import { persistChatState, persistGlobalSettings } from './src/core/persistence.js';
import { installCompactStateSerializer } from './src/core/persisted-chat-state.js';
import { createVectorSidecar } from './src/vector/sidecar.js';
import { createSummaryRecoveryJournal } from './src/core/summary-recovery-journal.js';
import { migrateGenerationPrompts, migrateInlineSummaryPrompt, migratePromptPresetTimelines, migrateTurnSummaryPrompt, migrateVectorQueryRewritePrompt } from './src/core/prompt-migrations.js';
import { ensureObjectField, fillMissingDefaults, normalizeArrayFields } from './src/core/state-shape.js';
import { memoryStrategies, normalizeWorkflowState, stageSourceModes, workflowModes } from './src/core/workflow-mode.js';
import { migrateBuiltInInjectionDefaults, normalizeInjectionMemoryBody, normalizeLineEndings, renderInjectionTemplate } from './src/shared/injection-template.js';
import { dedupeByHash, unique } from './src/shared/collections.js';
import { formatBlocksForPrompt, getPromptStructureExcerpt, migrateBuiltInStructuredPrompt, migrateEpicPromptTimeSpan, migrateStagePromptTimeSpan, renderGenerationPrompt, stripPostProcessNoise } from './src/shared/prompt-utils.js';
import { countKeywordHits, extractAllTaggedBlocks, extractConfiguredTagBlocks, extractTaggedContent, filterTextByConfiguredTags, getHash, matchesAnyKeyword, normalizeSearchText, parseList, parseTagRule, removeExactTextBlock, stripConfiguredTags, stripTableEditTags } from './src/shared/text.js';
import { parseMissingSummaryBatchResult } from './src/summary/draft-parser.js';
import { getMultiSummaryLabel, getNextMultiSummaryLevel, getSummaryKindLabel, getSummaryLevel } from './src/summary/levels.js';
import { buildFloorMemoryIndex, createMemoryOrchestrationPlan } from './src/memory/floor-memory-index.js';
import { formatSourceRange, getBlockSortKey, getFiniteMessageIds, getSourceEnd, getSourceMessageIdsFromBlocks, getSourceStart, getSummarySortKey, sortSummariesBySource } from './src/summary/source-metadata.js';
import { defaultGenerationTargets, findTargetContinuityGaps, getSortedTargetBlocks, parseLooseNumberRange, partitionGenerationTargets, selectGenerationTargets, targetSelectionModes } from './src/summary/target-selection.js';
import { cosineSimilarity, createLocalEmbedding } from './src/vector/math.js';
import { computeHybridRerankScore, selectHybridCandidates } from './src/vector/hybrid-retrieval.js';
import { extractCustomModelIds, extractEmbeddingModelCandidates, formatApiFailure, getCustomChatCompletionsUrl, getCustomEmbeddingsUrl, getCustomModelsUrl, normalizeCustomApiBaseUrl } from './src/vector/provider-config.js';
import { extractChatCompletionText, parseVectorQueryRewritePayload } from './src/vector/query-parser.js';
import { compactEmbedding, getClippedVectorText, slimVectorMemoryForSave } from './src/vector/storage.js';
import { createPromptInspector } from './src/features/prompt-inspector.js';
import { createHelpGuide } from './src/features/help-guide.js';
import { createSummaryMemoryModel } from './src/features/summary-memory-model.js';
import { createSummarySelectors } from './src/features/summary-selectors.js';
import { createSummaryTargetController } from './src/features/summary-target-controller.js';
import { createSummaryTaskQueue } from './src/features/summary-task-queue.js';
import { createContentConfigurationEvents } from './src/features/content-configuration-events.js';
import { createAutomationConfigurationEvents } from './src/features/automation-configuration-events.js';
import { createVectorMemoryService } from './src/features/vector-memory-service.js';
import { createVectorSettingsModel } from './src/features/vector-settings-model.js';
import { createVectorWorkbenchUi } from './src/features/vector-workbench-ui.js';
import { createVectorActionsController } from './src/features/vector-actions-controller.js';
import { createThemeSchema } from './src/theme/theme-schema.js';
import { createThemeController } from './src/features/theme-controller.js';
import { createPresetRegistry } from './src/features/preset-registry.js';
import { createInjectionService } from './src/features/injection-service.js';
import { createArchiveController } from './src/features/archive-controller.js';
import { createMemoryOrchestrator } from './src/features/memory-orchestrator.js';
import { createVectorAutoRecall } from './src/features/vector-auto-recall.js';
import * as tavernHost from '../../../../script.js';
import { createGlobalConfigSaveVerifier } from './src/core/global-config-save.js';
import { createTurnProcessingController } from './src/features/turn-processing-controller.js';
import { createRpProtocolDisplay, ensureRpDisplayFilter } from './src/features/rp-protocol-display.js';
import { shouldRunTurnProcessing, summarySourceChoice } from './src/features/turn-trigger-policy.js';
import { createSummarySourceWizard } from './src/features/summary-source-wizard.js';
import { createGenerationClient } from './src/features/generation-client.js';
import { createSummaryDraftService } from './src/features/summary-draft-service.js';
import { createContentBlockService } from './src/features/content-block-service.js';
import { createScanController } from './src/features/scan-controller.js';
import { createSummaryPreviewRenderer } from './src/features/summary-preview-renderer.js';
import { createSummaryGenerationController, getSummaryMaterialPreview } from './src/features/summary-generation-controller.js';
import { createSummaryBackfillController } from './src/features/summary-backfill-controller.js';
import { createConfigurationService } from './src/features/configuration-service.js';
import { createConfigurationController } from './src/features/configuration-controller.js';
import { createOverviewTokenManifest } from './src/features/overview-token-manifest.js';
import { createInjectionPreview } from './src/features/injection-preview.js';
import { createWorkflowOverviewModel } from './src/features/workflow-overview-model.js';
import { createOverviewWorkbenchUi } from './src/features/overview-workbench-ui.js';
import { createSummaryGenerationUi } from './src/features/summary-generation-ui.js';
import { createTurnSummaryUi, syncSummarySourceControls } from './src/features/turn-summary-ui.js';
import { createHubAutomationUi } from './src/features/hub-automation-ui.js';
import { createSummaryBrowserUi } from './src/features/summary-browser-ui.js';
import { createSummaryBrowserEvents } from './src/features/summary-browser-events.js';
import { createSummaryActionSheet } from './src/features/summary-action-sheet.js';
import { createActionSheet } from './src/ui/action-sheet.js';
import { createWorkbenchPageOverviews } from './src/features/workbench-page-overviews.js';
import { createReviewQueueUi } from './src/features/review-queue-ui.js';
import { createFactsController } from './src/features/facts-controller.js';
import { createFactsUi } from './src/features/facts-ui.js';
import { renderFactsSection } from './src/facts/injection.js';
import { normalizeFactSettings } from './src/facts/model.js';
import { replayLedger } from './src/rp-core/ledger.js';
import { applyDomainFact } from './src/rp-core/domain.js';
import { currentInformation } from './src/rp-core/current-information.js';
import { defaultFactsPrompt } from './src/facts/prompt.js';
import { createReviewQueueEvents } from './src/features/review-queue-events.js';
import { createMaintenanceUi } from './src/features/maintenance-ui.js';
import { createSummaryTimelineUi } from './src/features/summary-timeline-ui.js';
import { createPresetControlsUi } from './src/features/preset-controls-ui.js';
import { createWorkbenchHeaderUi } from './src/features/workbench-header-ui.js';
import { createWorkbenchRenderer, workbenchRenderScopes } from './src/features/workbench-renderer.js';
import { createWorkbenchActionController } from './src/features/workbench-action-controller.js';
import { createPresetEventsController } from './src/features/preset-events-controller.js';
import { createGlobalSettingsService } from './src/core/global-settings-service.js';
import { createChatStateService } from './src/core/chat-state-service.js';
import { createHelpPopover } from './src/ui/help-popover.js';
import { createOperationFeedback } from './src/ui/operation-feedback.js';
import { installWorkbenchParentNavigation, organizeWorkbenchOwnedSections } from './src/ui/workbench-layout.js';
import { createWorkbenchNavigation } from './src/ui/workbench-navigation.js';
import { createPageSettings } from './src/ui/page-settings.js';
import { createDialogs } from './src/ui/dialogs.js';
import { createWorkbenchShellEvents } from './src/ui/workbench-shell-events.js';
import { createSillyTavernEntry } from './src/ui/sillytavern-entry.js';
import { createDefaultConfiguration } from './src/config/defaults.js';

const EXT_ID = 'BakemonoMemory';
const STORAGE_KEY = 'bakemonoMemory';
const INJECTION_KEY = 'bakemono_memory';

const themeSchema = createThemeSchema({ getHash });
const {
    CUSTOM_THEME_LIBRARY_SCHEMA,
    CUSTOM_THEME_SCHEMA,
    builtInCustomThemeDefinitions,
    builtInCustomThemePresetIds,
    defaultCustomTheme,
    makeCustomThemePresetId,
    normalizeCustomThemePreset,
    sanitizeCustomTheme,
} = themeSchema;

const {
    blockTypes,
    memoryRecordStatuses,
    areaPresetScopes,
    tableSchemaScopes,
    turnProcessingModes,
    inlinePromptKeys,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    legacyInjectionTemplate,
    defaultInjectionTemplate,
    defaultTurnSummaryPrompt,
    defaultMissingSummaryPrompt,
    defaultTableEditPrompt,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultStoryGenerationPrompt,
    defaultGenericStoryGenerationPrompt,
    defaultGenericStageGenerationPrompt,
    defaultGenericEpicGenerationPrompt,
    defaultPromptPreset,
    defaultGenericPromptPreset,
    defaultAutomation,
    defaultVectorQueryRewritePrompt,
    defaultVectorMemory,
    defaultState,
} = createDefaultConfiguration({
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    extensionPromptRoles: extension_prompt_roles,
    defaultGenerationTargets,
    injectionKey: INJECTION_KEY,
});

function getSummaryRecoveryChatIdentity() {
    const context = getContext();
    let resolvedChatId = context?.chatId;
    if (!resolvedChatId && typeof context?.getCurrentChatId === 'function') {
        try {
            resolvedChatId = context?.getCurrentChatId?.();
        } catch {
            resolvedChatId = '';
        }
    }
    resolvedChatId = resolvedChatId || context?.chatMetadata?.integrity || chat_metadata?.integrity;
    const chatId = String(resolvedChatId || '').trim();
    if (!chatId) return '';
    const scope = context?.groupId !== undefined && context?.groupId !== null
        ? `group:${context.groupId}`
        : `character:${context?.characterId ?? context?.character?.avatar ?? context?.name2 ?? 'unknown'}`;
    return `${scope}|chat:${chatId}`;
}

function getSummaryRecoveryStorage() {
    let local = null;
    try {
        local = globalThis.localStorage;
    } catch {
        local = null;
    }
    let account = null;
    try {
        account = getContext()?.accountStorage || null;
    } catch {
        account = null;
    }
    const isStorage = value => value
        && typeof value.getItem === 'function'
        && typeof value.setItem === 'function'
        && typeof value.removeItem === 'function';
    if (!isStorage(local)) return isStorage(account) ? account : null;
    if (!isStorage(account)) return local;
    return {
        getItem(key) {
            try {
                const value = local.getItem(key);
                if (value !== null && value !== undefined) return value;
            } catch {
                // Fall through to SillyTavern account storage.
            }
            return account.getItem(key);
        },
        setItem(key, value) {
            try {
                local.setItem(key, value);
                account.removeItem(key);
            } catch (error) {
                const isQuotaError = error?.name === 'QuotaExceededError'
                    || Number(error?.code) === 22
                    || Number(error?.code) === 1014
                    || /quota|exceed|storage.{0,12}full/i.test(String(error?.message || error || ''));
                if (isQuotaError) throw error;
                try {
                    local.removeItem(key);
                } catch {
                    // The account-backed copy below remains authoritative.
                }
                account.setItem(key, value);
            }
        },
        removeItem(key) {
            try {
                local.removeItem(key);
            } finally {
                account.removeItem(key);
            }
        },
        keys() {
            return Array.from({ length: local.length }, (_, index) => local.key(index));
        },
    };
}

// Every write to the chat file goes through these. While SillyTavern is still reading a chat (after a switch or a
// reload the chat is empty and the metadata blank), a save would overwrite the file with nothing; see chat-ready.js.
const chatGate = createChatGate({ getContext, getMetadata: () => chat_metadata, getChat: () => chat });
const isChatReady = () => chatGate.isReady();
function skippedWrite(what) {
    console.warn(`[BakemonoMemory] ${what} skipped: the chat is not loaded yet`);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// SillyTavern's saveChatConditional first waits at least 100 ms, then saves whichever chat is open by then: a
// character picked inside that window had its file overwritten with nothing. saveChat reads the chat, metadata and
// file name the moment it is called, so a running save is waited out here and the chat checked again right before.
// Group chats have no such entry point (saveGroupChat is not exported) and keep SillyTavern's own path.
async function saveChatConditional() {
    const owner = chatGate.token();
    if (!owner) {
        skippedWrite('chat save');
        return false;
    }
    if (getContext()?.groupId) {
        await hostSaveChatConditional();
        return true;
    }
    for (let tries = 0; isChatSaving && tries < 200; tries++) await pause(50);
    if (!chatGate.sameAs(owner)) {
        skippedWrite('chat save');
        return false;
    }
    try {
        await hostSaveChat();
        return true;
    } catch (error) {
        console.error('[BakemonoMemory] chat save failed', error);
        return false;
    }
}
let metadataSaveTimer = null;
// Like SillyTavern's saveMetadataDebounced (it saves the whole chat file), but the chat is checked again when the
// timer fires: the same character can be reopened within the second, which its own check (character id) lets through.
function saveMetadataDebounced() {
    clearTimeout(metadataSaveTimer);
    const owner = chatGate.token();
    if (!owner) {
        metadataSaveTimer = null;
        skippedWrite('metadata save');
        return;
    }
    metadataSaveTimer = setTimeout(() => {
        metadataSaveTimer = null;
        if (!chatGate.sameAs(owner)) return skippedWrite('delayed metadata save');
        void saveChatConditional();
    }, 1000);
}
// SillyTavern's hideChatMessageRange ends in saveChatConditional (see above); this does the same marking and saves
// through the guarded path.
async function hideChatMessageRange(start, end, unhide) {
    if (!chatGate.isReady()) {
        skippedWrite('hiding floors');
        return;
    }
    if (Number.isNaN(Number(start))) return;
    const last = end || start;
    for (let messageId = Number(start); messageId <= Number(last); messageId++) {
        const message = chat[messageId];
        if (!message) continue;
        message.is_system = !unhide;
        document.querySelector(`#chat .mes[mesid="${messageId}"]`)?.setAttribute('is_system', String(!unhide));
    }
    await saveChatConditional();
}

const summaryRecoveryJournal = createSummaryRecoveryJournal({
    getStorage: getSummaryRecoveryStorage,
    getChatId: getSummaryRecoveryChatIdentity,
});

const extensionFolderPath = (() => {
    const fallback = `scripts/extensions/third-party/${EXT_ID}`;

    try {
        if (typeof import.meta !== 'undefined' && import.meta.url) {
            const url = new URL('.', import.meta.url);
            const pathname = decodeURIComponent(url.pathname);
            const match = pathname.match(/(scripts\/extensions\/third-party\/[^/]+)/);
            if (match) return match[1];
        }
    } catch (error) {
        // ignore
    }

    if (typeof document !== 'undefined') {
        const script = document.currentScript;
        if (script?.src) {
            try {
                const url = new URL(script.src, window.location.href);
                const pathname = decodeURIComponent(url.pathname);
                const match = pathname.match(/(scripts\/extensions\/third-party\/[^/]+)/);
                if (match) return match[1];
            } catch (error) {
                // ignore
            }
        }
    }

    return fallback;
})();

let isBusy = false;
let foregroundResumeTimer = null;
let foregroundResumeWhenIdle = false;
function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

const dialogs = createDialogs({ documentRef: document });
// Resolves true or false. Every caller awaits it: the panel does not block the page the way confirm() did.
function confirmDanger(title, lines = [], confirmText = '') {
    return dialogs.confirm(title, lines, { confirmText });
}
// Modules written for confirm(message): the first line is the question, the rest are the consequences.
function confirmMessage(message) {
    const [title, ...lines] = String(message || '').split('\n');
    return dialogs.confirm(title, lines);
}


function saveState(options = {}) {
    if (!chatGate.isReady()) {
        skippedWrite('state save');
        return { status: 'not-ready', revision: 0 };
    }
    const state = chat_metadata?.[STORAGE_KEY] || null;
    if (!state) {
        const error = new Error('当前聊天状态尚未连接到 SillyTavern 正式元数据，已阻止空保存');
        console.error('[BakemonoMemory] refused to save a missing live chat state', error);
        return { status: 'error', revision: 0, error };
    }
    try { captureChronicle(state, chat); }
    catch (error) {
        console.error('[BakemonoMemory] story state could not be recorded', error);
        return { status: 'error', revision: 0, error };
    }
    const recovery = summaryRecoveryJournal.stage(state, chat, { messageIds: options.recoveryMessageIds || [] });
    if (recovery.status === 'error') {
        console.warn('[BakemonoMemory] failed to write summary recovery journal', recovery.error);
    }
    persistChatState(state, {
        prepare: state => slimVectorMemoryForSave(state?.vectorMemory, defaultVectorMemory),
        save: saveMetadataDebounced,
    });
    return recovery;
}

function saveGlobalSettings() {
    persistGlobalSettings(saveSettingsDebounced);
}

function setBusy(value) {
    isBusy = value;
    $('#bakemono-memory-generate-stage, #bakemono-memory-generate-epic, #bakemono-memory-backfill, [data-bakemono-action="generate-stage"], [data-bakemono-action="generate-stage-batch"], [data-bakemono-action="generate-epic"], [data-bakemono-action="generate-epic-batch"], [data-bakemono-action="backfill"], [data-bakemono-action="batch-summary"], [data-bakemono-action="commit-missing-all"], [data-bakemono-action="remove-missing-all"], [data-bakemono-action="process-latest-turn"], [data-bakemono-action="process-latest-table"], [data-bakemono-action="vector-index"], [data-bakemono-action="vector-test"], [data-bakemono-action="vector-fetch-models"], [data-bakemono-action="vector-fetch-query-models"], [data-bakemono-draft-action], [data-bakemono-task-action], [data-bakemono-auto-tx-action], [data-bakemono-table-draft-action]').prop('disabled', value);
    if (!value && foregroundResumeWhenIdle) {
        foregroundResumeWhenIdle = false;
        scheduleForegroundRuntimeResume('生成流程结束');
    }
}

let workbenchRenderer = null;
let pageSettings = null;
function renderAll(...args) {
    return workbenchRenderer?.renderAll(...args);
}
function scheduleRenderAll(...args) {
    return workbenchRenderer?.scheduleRenderAll(...args);
}
function renderWorkbenchScope(...args) {
    return workbenchRenderer?.renderScope(...args) ?? false;
}
function renderTaskQueueProgress(...args) {
    return workbenchRenderer?.renderTaskQueueProgress(...args);
}
function renderActivePresetControls(...args) {
    return workbenchRenderer?.renderActivePresetControls(...args);
}

let presetEventsController = null;
let contentConfigurationEvents = null;
let automationConfigurationEvents = null;
function renderInlinePromptPresetControls(...args) {
    return presetEventsController?.renderInlinePromptPresetControls(...args);
}









const operationFeedback = createOperationFeedback({
    escapeHtml,
    setBusy,
    renderScope: (...args) => renderWorkbenchScope(...args),
    getDefaultRenderScope: () => workbenchRenderScopes.SUMMARY,
    logError: (...args) => console.error(...args),
});
const { runGeneration, runVisible: runVisibleOperation } = operationFeedback;
const helpPopover = createHelpPopover();
const helpGuide = createHelpGuide({ escapeHtml });

const globalSettingsService = createGlobalSettingsService({
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    sanitizeCustomTheme,
    normalizeCustomThemePreset,
    builtInCustomThemeDefinitions,
    defaultPromptPreset,
    defaultGenericPromptPreset,
    migrateBuiltInInjectionDefaults,
    legacyInjectionTemplate,
    defaultInjectionTemplate,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    migratePromptPresetTimelines,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    migrateStagePromptTimeSpan,
    migrateEpicPromptTimeSpan,
    defaultGenericStoryGenerationPrompt,
    defaultGenericStageGenerationPrompt,
    defaultGenericEpicGenerationPrompt,
    createSharedVectorConfig,
    createSharedInlineGenerationConfig,
    areaPresetScopes,
    tableSchemaScopes,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
});
const { ensureGlobalSettings } = globalSettingsService;

const presetRegistry = createPresetRegistry({
    ensureGlobalSettings,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    saveGlobalSettings,
    defaultPromptPreset,
    defaultGenericPromptPreset,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    getHash,
    readActiveConfig,
    createSharedVectorConfig,
    createSharedInlineGenerationConfig,
    sharedConfigVersion,
    markActiveConfigApplied,
    shouldSyncActiveConfig,
    applyPromptPresetToState: (...args) => configurationController.applyPromptPresetToState(...args),
    saveState,
});
const {
    applyGlobalActiveConfigToState,
    getActiveGlobalConfig,
    getAreaPresets,
    getInlinePromptPresets,
    getPromptPresets,
    getSelectedAreaPresetId,
    getSelectedInlinePromptPresetId,
    getSelectedPromptPresetId,
    getSelectedTablePromptPresetId,
    getTablePromptPresets,
    isBuiltInPresetId,
    makeAreaPresetId,
    makeInlinePromptPreset,
    makePresetId,
    makeTablePromptPreset,
    setActiveGlobalConfig,
    setSelectedAreaPresetId,
    setSelectedInlinePromptPresetId,
    setSelectedPromptPresetId,
    setSelectedTablePromptPresetId,
    syncGlobalActiveConfigToState,
} = presetRegistry;

const presetControlsUi = createPresetControlsUi({
    documentRef: document,
    query: $,
    areaPresetScopes,
    getSelectedPromptPresetId,
    getPromptPresets,
    getActiveGlobalConfig,
    getSelectedAreaPresetId,
    getAreaPresets,
    unique,
});
const {
    renderAll: renderPromptPresetControls,
    renderAreaPresetControl,
    renderCustomModelOptions,
    renderPresetControlPair,
} = presetControlsUi;

const chatStateService = createChatStateService({
    defaultState,
    isChatReady,
    getChatMetadata: () => chat_metadata,
    storageKey: STORAGE_KEY,
    extensionSettings: extension_settings,
    getContext,
    getFallbackChat: () => chat,
    applyGlobalActiveConfigToState,
    fillMissingDefaults,
    migrateBuiltInInjectionDefaults,
    legacyInjectionTemplate,
    defaultInjectionTemplate,
    migrateGenerationPrompts,
    defaultStoryGenerationPrompt,
    defaultGenericStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultGenericStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultGenericEpicGenerationPrompt,
    migrateBuiltInStructuredPrompt,
    migrateStagePromptTimeSpan,
    migrateEpicPromptTimeSpan,
    normalizeArrayFields,
    getSummaryLevel,
    blockTypes,
    sortSummariesBySource,
    normalizeInjectionMemoryBody,
    renderInjectionContent: (...args) => renderInjectionContent(...args),
    saveState,
    getFiniteMessageIds,
    ensureObjectField,
    normalizeWorkflowState,
    defaultAutomation,
    defaultGenerationTargets,
    migrateTurnSummaryPrompt,
    defaultTurnSummaryPrompt,
    tableSchemaScopes,
    ensureGlobalSettings,
    migrateInlineSummaryPrompt,
    defaultInlineSummaryPrompt,
    defaultVectorMemory,
    migrateVectorQueryRewritePrompt,
    unique,
    getActiveCoveredStageHashes: (...args) => getActiveCoveredStageHashes(...args),
    getInjectionMemoryParts: (...args) => getInjectionMemoryParts(...args),
    installCompactStateSerializer,
});
const { ensureState, maxStoredScanPreviewItems, sanitizeCurrentChatState } = chatStateService;

const contentBlockService = createContentBlockService({
    documentRef: document,
    getState: ensureState,
    parseList,
    stripConfiguredTags,
    extractConfiguredTagBlocks,
    parseTagRule,
    matchesAnyKeyword,
    blockTypes,
    workflowModes,
    stageSourceModes,
    getBlockSortKey,
});
const {
    classifyBlock,
    extractConfiguredSegments,
    getBlockPlainText,
    getBlocksByType,
    getBlockTitle,
    getMessageVariantKey,
    getSegmentSourceKind,
    mergeBlocks,
    shouldPersistScannedBlock,
    stripHtml,
    toPlainPreview,
} = contentBlockService;

const scanController = createScanController({
    getState: ensureState,
    getContext,
    getFallbackChat: () => chat,
    extractConfiguredSegments,
    getSegmentSourceKind,
    getMessageVariantKey,
    getHash,
    classifyBlock,
    getBlockTitle,
    shouldPersistScannedBlock,
    toPlainPreview,
    mergeBlocks,
    unique,
    maxStoredScanPreviewItems,
    saveState,
    syncInjection: (...args) => syncInjection(...args),
    renderWorkbenchScope,
    workbenchRenderScopes,
    query: $,
    persistSharedConfigurationFromState: (...args) => configurationService.persistSharedConfigurationFromState(...args),
    confirmDanger,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
});
const { bindEvents: bindScanEvents, scanBakemonoBlocks } = scanController;

const actionSheet = createActionSheet({ documentRef: document });
// Close the workbench and bring a chat floor into view (定位原文 on 总结 and 待确认).
function locateChatFloor(floor) {
    const message = document.querySelector(`#chat .mes[mesid="${floor}"]`);
    if (!message) {
        toastr.info(`第 ${floor} 楼还没在聊天里载入，请先在聊天里往上翻到那一楼。`);
        return;
    }
    closeWorkbench();
    message.scrollIntoView({ block: 'center', behavior: 'auto' });
}
const summaryPreviewRenderer = createSummaryPreviewRenderer({
    documentRef: document,
    getState: ensureState,
    blockTypes,
    defaultPreviewLayouts,
    getMultiSummaryLabel,
    getBlockTitle,
    getBlockPlainText,
    stripHtml,
    findSavedSummaryByHash: (...args) => findSavedSummaryByHash(...args),
});
const {
    createBakemonoNotebook,
    createSummaryDocument,
    describeSummary,
    getPreviewSummaryText,
    getSummaryGroup,
    parsePreviewMeta,
    setSummaryOpen,
} = summaryPreviewRenderer;

const summarySources = createSummarySourceService({getState:ensureState,getChat:()=>chat,getChatIdentity:()=>getSummaryRecoveryChatIdentity()});
const summaryMemoryModel = createSummaryMemoryModel({
    blockTypes,
    memoryStrategies,
    memoryRecordStatuses,
    dedupeByHash,
    getSummarySortKey,
    getSummaryLevel,
    getFiniteMessageIds,
    unique,
    getBlockTitle,
    formatSourceRange,
    getBlockSortKey,
    getKindLabel,
    getDefaultDraftTitle: (...args) => summaryDraftService.getDefaultDraftTitle(...args),
    getSourceStart,
});
const {
    buildMemoryRecords,
    getActiveCoveredStageHashes,
    getActiveEpicMemoryBlocks,
    getCoveredStageHashesFromEpic,
    getEpicMemoryBlocks,
    getStageMemoryBlocks,
    summaryToBlock,
} = summaryMemoryModel;
const summarySelectors = createSummarySelectors({
    getState: ensureState,
    getChat: () => chat,
    getBlocksByType,
    blockTypes,
    stageSourceModes,
    workflowModes,
    defaultAutomation,
    dedupeByHash,
    summaryToBlock,
    getSortedTargetBlocks,
});
const {
    getAutoStageTargets,
    getStageSourceMode,
    getStageMaterialOverview,
    getStoryBlocks,
    getStoryMaterialBlocks,
    getUnsummarizedMultiSummaryBlocks,
    getUnsummarizedStageBlocks,
    getUnsummarizedStoryBlocks,
    isBackfillSummary,
    isRawSourceBlock,
} = summarySelectors;
const summaryGenerationController = createSummaryGenerationController({
    getStageMaterialOverview,
    summarySources,
    getIsBusy: () => isBusy,
    scanBlocks: options => scanBakemonoBlocks(options),
    getState: ensureState,
    getUnsummarizedStoryBlocks,
    getAutoStageTargets,
    getUnsummarizedStageBlocks,
    getUnsummarizedMultiSummaryBlocks,
    getStoryMaterialBlocks,
    readGenerationTargetSettings: (...args) => summaryTargetController.readGenerationTargetSettings(...args),
    promptGenerationTargetSelection: (...args) => summaryTargetController.promptGenerationTargetSelection(...args),
    selectGenerationTargets,
    partitionGenerationTargets,
    findTargetContinuityGaps,
    getFloorMemoryIndex: state => workflowOverviewModel.getCurrentFloorMemoryIndex(state),
    confirmGenerationTargets: (...args) => summaryTargetController.confirmGenerationTargets(...args),
    getTargetSelectionLabel: (...args) => summaryTargetController.getTargetSelectionLabel(...args),
    getStageSourceMode,
    renderGenerationPrompt,
    defaultStoryGenerationPrompt,
    getSourceMessageIdsFromBlocks,
    enqueueSummaryTask: (...args) => summaryTaskQueue.enqueueSummaryTask(...args),
    processTaskQueue: (...args) => summaryTaskQueue.processTaskQueue(...args),
    blockTypes,
    defaultGenerationTargets,
    getSourceStart,
    getSourceEnd,
    formatSourceRange,
    getNextMultiSummaryLevel,
    getMultiSummaryLabel,
    unique,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    confirm: confirmMessage,
});
const {
    buildEpicSystemPrompt,
    buildStageSystemPrompt,
    buildStoryUserPrompt,
    generateEpicBatchTasks,
    generateEpicDraft,
    generateStageBatchTasks,
    generateStageDraft,
} = summaryGenerationController;
const summaryBackfillController = createSummaryBackfillController({
    summarySources,
    query: $,
    getIsBusy: () => isBusy,
    getState: ensureState,
    getContext,
    getFallbackChat: () => chat,
    parseList,
    stripConfiguredTags,
    extractConfiguredTagBlocks,
    stripPostProcessNoise,
    unique,
    getHash,
    getMessageVariantKey,
    getFiniteMessageIds,
    formatSourceRange,
    getSourceStart,
    getSourceEnd,
    blockTypes,
    defaultAutomation,
    defaultMissingSummaryPrompt,
    buildStoryUserPrompt,
    buildStageSystemPrompt,
    buildTurnReferenceSystemPrompt: (...args) => turnProcessingController.buildTurnReferenceSystemPrompt(...args),
    createDraft: (...args) => summaryDraftService.createDraft(...args),
    enqueueSummaryTask: (...args) => summaryTaskQueue.enqueueSummaryTask(...args),
    parseMessageRangeInput: (...args) => archiveController.parseMessageRangeInput(...args),
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    confirm: confirmMessage,
});
const {
    createMissingSummaryDraftFromBatchItem,
    generateBackfillQueue,
    generateBatchSummaryQueue,
    generateMissingSummaryQueue,
    messageHasConfiguredSummary,
} = summaryBackfillController;
const workbenchNavigation = createWorkbenchNavigation({
    getPanelTitle: tabName => getWorkbenchPanelTitle(tabName),
    renderHeaderContext: tabName => renderWorkbenchHeaderContext(tabName),
    renderAll: (...args) => renderAll(...args),
    scanBlocks: options => scanBakemonoBlocks(options),
    closeHelp: () => {
        helpPopover.close();
        injectionPreview.close({ restoreFocus: false });
    },
    clearFeedback: () => operationFeedback.clear(),
    confirmLeave: tabName => pageSettings?.confirmLeave(tabName) ?? true,
});
const {
    close: closeWorkbench,
    getActiveTab: getActiveWorkbenchTab,
    isOpen: isWorkbenchOpen,
    open: openWorkbench,
    setMenuOpen: setWorkbenchMenuOpen,
    stabilizeMobilePreviewScroll,
    stabilizeMobileScroll: stabilizeMobileWorkbenchScroll,
    switchTab: switchWorkbenchTab,
    syncMobileCollapsibles,
} = workbenchNavigation;

const sillyTavernEntry = createSillyTavernEntry({
    documentRef: document,
    query: $,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    openWorkbench,
});
const {
    addSettingsBlock: addExtensionSettingsBlock,
    addWandButton,
    renderSettings: renderExtensionEntrySettings,
    syncTopNavButton,
} = sillyTavernEntry;

const themeController = createThemeController({
    query: $,
    documentRef: document,
    navigatorRef: navigator,
    BlobCtor: Blob,
    urlApi: URL,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    ensureGlobalSettings,
    saveGlobalSettings,
    sanitizeCustomTheme,
    defaultCustomTheme,
    builtInCustomThemePresetIds,
    normalizeCustomThemePreset,
    makeCustomThemePresetId,
    customThemeSchema: CUSTOM_THEME_SCHEMA,
    customThemeLibrarySchema: CUSTOM_THEME_LIBRARY_SCHEMA,
    confirmDanger,
    toastr,
});
const {
    applyAppearanceTheme,
    bindEvents: bindThemeEvents,
    getAppearanceSettings,
    getSelectedCustomThemePreset,
    parseCustomThemeJson,
    renderAppearanceSettings,
} = themeController;



const rpProtocolDisplay = createRpProtocolDisplay({
    documentRef: document, getChat: () => chat,
    installDisplayFilter: () => ensureRpDisplayFilter(extension_settings, saveSettingsDebounced),
    // A synthetic ID keeps the host's greeting macro substitution away from stored chat[0].
    renderProtocol: (text, message) => tavernHost.messageFormatting(text, message.name, false, false, -1),
});




const vectorSettingsModel = createVectorSettingsModel({
    query: $,
    defaultVectorMemory,
    getState: ensureState,
    persistSharedConfigurationFromState: (...args) => configurationService.persistSharedConfigurationFromState(...args),
});
const {
    persistVectorMemoryFieldsFromUi,
    readVectorMemoryFieldsFromUi,
    markVectorFormRendered,
    assertVectorFormCurrent,
    canKeepVectorForm,
    readVectorFormDraft,
} = vectorSettingsModel;

const configurationService = createConfigurationService({
    query: $,
    getState: ensureState,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
    defaultAutomation,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    defaultInjectionTemplate,
    defaultGenerationTargets,
    defaultVectorMemory,
    defaultState,
    turnProcessingModes,
    tableSchemaScopes,
    extensionPromptRoles: extension_prompt_roles,
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    makePresetId,
    getStageSourceMode,
    createSharedInlineGenerationConfig,
    createSharedVectorConfig,
    getActiveGlobalConfig,
    setActiveGlobalConfig,
    markActiveConfigApplied,
    saveState,
    ensureGlobalSettings,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    getContext,
    shouldBootstrapSharedConfig,
    isStateConfigNewerThanActive,
});
const {
    bootstrapSharedConfigurationFromCurrentChat,
    getConfigPayloadFromState,
    getCurrentPromptPresetPayload,
    normalizeImportedPreset,
    persistSharedConfigurationFromState,
    recoverNewerSharedConfigurationFromState,
    readAutomationFieldsFromUi,
    readConfigFieldsFromUi,
    readCustomApiFieldsFromUi,
    readInjectionFieldsFromUi,
    readPromptFieldsFromUi,
    readRuleFieldsFromUi,
    readTurnSummaryFieldsFromUi,
    readWorkflowFieldsFromUi,
} = configurationService;
// 总结 → 剧情摘要 with the 补写旧聊天 form open on the given mode (missing or backfill).
async function openBackfillForm(batchMode) {
    if (!await switchWorkbenchTab('preview')) return;
    summaryGenerationUi.setMode('batch');
    summaryGenerationUi.setBatchOpen(true);
    setSummaryBrowserActiveType('story');
    renderSummaryGenerationPanel();
    renderPreviewSections();
    $('#bakemono-memory-batch-summary-mode').val(batchMode);
}
const summarySourceWizard = createSummarySourceWizard({
    documentRef: document, getState: ensureState, defaultScanRules,
    openBackfill: openBackfillForm,
});

const configurationController = createConfigurationController({
    getState: ensureState,
    defaultFactsPrompt,
    normalizeFactSettings,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
    defaultPromptPreset,
    defaultGenericPromptPreset,
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    defaultGenerationTargets,
    defaultInjectionTemplate,
    defaultAutomation,
    defaultState,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    turnProcessingModes,
    mergeSharedInlineGenerationConfig,
    mergeSharedVectorConfig,
    createAutomationBehaviorConfig,
    mergeAutomationBehaviorConfig,
    defaultVectorMemory,
    tableSchemaScopes,
    syncInlineGenerationPrompts: (...args) => injectionService.syncInlineGenerationPrompts(...args),
    scheduleVectorAutoIndex: (...args) => vectorMemoryService.scheduleVectorAutoIndex(...args),
    scanBlocks: options => scanBakemonoBlocks(options),
    updateInjectionFromSummaries: (...args) => injectionService.updateInjectionFromSummaries(...args),
    syncInjection: (...args) => injectionService.syncInjection(...args),
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    getPromptPresets,
    getCurrentPromptPresetPayload,
    setSelectedPromptPresetId,
    saveGlobalSettings,
    setActiveGlobalConfig,
    markActiveConfigApplied,
    areaPresetScopes,
    makeAreaPresetId,
    readRuleFieldsFromUi,
    readAutomationFieldsFromUi,
    readCustomApiFieldsFromUi,
    readPromptFieldsFromUi,
    readTurnSummaryFieldsFromUi,
    readInjectionFieldsFromUi,
    readVectorMemoryFieldsFromUi,
    createSharedInlineGenerationConfig,
    createSharedVectorConfig,
    persistSharedConfigurationFromState,
    getAreaPresets,
    setSelectedAreaPresetId,
});
const {
    applyAreaPresetToState,
    applyPromptPresetToState,
    getAreaPresetPayload,
    renderAreaPresetChange,
    saveAreaPreset,
    saveCurrentConfigPreset,
    usePromptPresetAsGlobalDefault,
} = configurationController;

const vectorMemoryService = createVectorMemoryService({
    // 剧情事实: the cards the recent conversation names lend every name they go by to the recall keywords.
    getFactsHints: (state, text) => factsRecallHints(factsController.facts(state), text),
    vectorSidecar: createVectorSidecar({ getHeaders: () => tavernHost.getRequestHeaders(), getChatKey: () => getSummaryRecoveryChatIdentity(), getHash,
        warn: (...args) => console.warn(...args) }),
    formatApiFailure,
    defaultVectorMemory,
    getState: ensureState,
    normalizeLineEndings,
    stripHtml,
    parseList,
    extractConfiguredTagBlocks,
    stripConfiguredTags,
    unique,
    getContext,
    getFallbackChat: () => chat,
    toPlainPreview,
    normalizeCustomApiBaseUrl,
    getCustomChatCompletionsUrl,
    extractChatCompletionText,
    rewriteWithTavern: generateRaw,
    parseVectorQueryRewritePayload,
    getClippedVectorText,
    computeHybridRerankScore,
    getMessageVariantKey,
    getHash,
    getActiveCoveredStageHashes,
    memoryStrategies,
    getActiveEpicMemoryBlocks,
    getFiniteMessageIds,
    getSourceStart,
    getSourceEnd,
    getBlockTitle,
    getKindLabel,
    getBlockPlainText,
    blockTypes,
    saveState,
    compactEmbedding,
    createLocalEmbedding,
    getCustomEmbeddingsUrl,
    readVectorMemoryFieldsFromUi,
    syncInjection: (...args) => syncInjection(...args),
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    cosineSimilarity,
    countKeywordHits,
    selectHybridCandidates,
    fetchImpl: globalThis.fetch.bind(globalThis),
});
const {
    buildVectorMemoryIndex,
    getVectorQueryText,
    getVectorSourceSignature,
    markVectorIndexDirty,
    renderVectorMemorySection,
    retrieveVectorMemoryHits,
    cancelVectorRecall,
    clearVectorRecall,
    scheduleVectorAutoIndex,
} = vectorMemoryService;

const confirmGlobalConfiguration = createGlobalConfigSaveVerifier({
    getCurrentConfig: getActiveGlobalConfig,
    requestSave: () => typeof tavernHost.saveSettings === 'function' ? tavernHost.saveSettings() : saveSettingsDebounced(),
    readSavedConfig: async signal => {
        const response = await fetch('/api/settings/get', { method: 'POST',
            headers: tavernHost.getRequestHeaders(), body: '{}', cache: 'no-store', signal });
        if (!response.ok) throw new Error('settings-read-failed');
        const data = await response.json();
        const settings = typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings;
        return settings?.extension_settings?.[STORAGE_KEY]?.activeConfig || null;
    },
});

const confirmRpPromptConfiguration = createGlobalConfigSaveVerifier({
    getCurrentConfig: () => {
        ensureGlobalSettings();
        return extension_settings[STORAGE_KEY].rpPromptLibrary;
    },
    requestSave: () => typeof tavernHost.saveSettings === 'function' ? tavernHost.saveSettings() : saveSettingsDebounced(),
    readSavedConfig: async signal => {
        const response = await fetch('/api/settings/get', { method: 'POST', headers: tavernHost.getRequestHeaders(), body: '{}', cache: 'no-store', signal });
        if (!response.ok) throw new Error('settings-read-failed');
        const data = await response.json();
        const settings = typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings;
        return settings?.extension_settings?.[STORAGE_KEY]?.rpPromptLibrary || null;
    },
});

const vectorWorkbenchUi = createVectorWorkbenchUi({
    canKeepVectorForm,
    markVectorFormRendered,
    query: $,
    document,
    getState: ensureState,
    defaultVectorMemory,
    unique,
    getVectorQueryText,
    escapeHtml,
    formatSourceRange,
    getVectorSourceMessages: (...args) => vectorMemoryService.getVectorSourceMessages(...args),
    isVectorIndexing: () => vectorMemoryService.isVectorIndexing(),
    getVectorIndexProgress: () => vectorMemoryService.getVectorIndexProgress(),
});
const {
    renderVectorMemoryPanel,
    renderVectorModelOptions,
    renderVectorQueryModelOptions,
} = vectorWorkbenchUi;

const vectorActionsController = createVectorActionsController({
    confirmGlobalConfiguration,
    cancelVectorRecall,
    clearVectorRecall,
    readVectorFormDraft,
    markVectorFormRendered,
    assertVectorFormCurrent,
    fetchCustomEmbedding: (...args) => vectorMemoryService.fetchCustomEmbedding(...args),
    extractEmbeddingModelCandidates,
    formatApiFailure,
    query: $,
    getState: ensureState,
    readVectorMemoryFieldsFromUi,
    persistSharedConfigurationFromState,
    normalizeCustomApiBaseUrl,
    getCustomModelsUrl,
    extractCustomModelIds,
    renderVectorModelOptions,
    renderVectorQueryModelOptions,
    toastr,
    getVectorSourceSignature,
    markVectorIndexDirty,
    retrieveVectorMemoryHits,
    syncInjection: (...args) => syncInjection(...args),
    renderWorkbenchScope,
    workbenchRenderScopes,
    saveState,
    saveChatConditional,
    confirmDanger,
    fetchImpl: globalThis.fetch.bind(globalThis),
    toggleVectorView: (...args) => vectorWorkbenchUi.toggleVectorView(...args),
    renderVectorSettingsSummary: () => vectorWorkbenchUi.renderVectorSettingsSummary(),
});
const {
    applyVectorMemorySettings,
    clearVectorMemoryIndex,
    fetchVectorEmbeddingModels,
    fetchVectorQueryModels,
    testEmbeddingConnection,
    testVectorMemoryRetrieval,
} = vectorActionsController;

const archiveController = createArchiveController({
    query: $,
    getChat: () => chat,
    getContext,
    scanBakemonoBlocks,
    ensureState,
    blockTypes,
    getFiniteMessageIds,
    unique,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    hideChatMessageRange,
    saveChatConditional,
    saveState,
    defaultState,
    memoryStrategies,
    confirm: confirmMessage,
    logError: (...args) => console.error(...args),
});
const {
    applyAutoHideRecentBalance,
    applyAutoHideRecentSettings,
    bindEvents: bindArchiveEvents,
    getActualHiddenMessageIds,
    getAutoHideRecentPlan,
    getAutoHideRecentPreviewText,
    getSummaryCoveredMessageIds,
    hideBeforeRecentMessages,
    hideCoveredMessages,
    parseMessageRangeInput,
    previewMessageRange,
    previewPreserveRecentMessages,
    renderAutoHideRecentPanel,
    restoreAutoHiddenMessages,
    restoreHiddenMessages,
    scheduleAutoHideRecent,
    setMessageRangeHidden,
} = archiveController;

const injectionService = createInjectionService({
    getChat: () => chat,
    ensureState,
    getActiveEpicMemoryBlocks,
    getMultiSummaryLabel,
    getActiveCoveredStageHashes,
    getStageMemoryBlocks,
    memoryStrategies,
    // v1.32.0: tables and 剧情状态 no longer inject; 剧情事实 does.
    renderVectorMemorySection,
    renderFactsSection: (state, recentParts) => {
        const result = renderFactsSection(factsController.facts(state), recentParts, { budgetChars: factsController.injectionBudget(state).chars });
        factsController.noteInjection(state, result);
        return result;
    },
    setExtensionPrompt,
    injectionKey: INJECTION_KEY,
    extensionPromptTypes: extension_prompt_types,
    extensionPromptRoles: extension_prompt_roles,
    defaultState,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    inlinePromptKeys,
    defaultInjectionTemplate,
    renderInjectionTemplate,
});
const {
    getInjectionMemoryParts,
    renderInjectionContent,
    renderInlinePrompt,
    syncInjection,
    syncInlineGenerationPrompts,
    updateInjectionFromSummaries,
} = injectionService;

presetEventsController = createPresetEventsController({
    query: $,
    documentRef: document,
    toastr,
    confirmDanger,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    getAreaPresets,
    getSelectedAreaPresetId,
    setSelectedAreaPresetId,
    renderPromptPresetControls,
    applyAreaPresetToState,
    saveAreaPreset,
    saveGlobalSettings,
    renderAreaPresetChange,
    getInlinePromptPresets,
    getSelectedInlinePromptPresetId,
    setSelectedInlinePromptPresetId,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    getState: ensureState,
    syncInlineGenerationPrompts,
    persistSharedConfigurationFromState,
    makeInlinePromptPreset,
    renderWorkbenchScope,
    workbenchRenderScopes,
    navigatorRef: navigator,
    defaultPromptPreset,
    getSelectedPromptPresetId,
    setSelectedPromptPresetId,
    getPromptPresets,
    usePromptPresetAsGlobalDefault,
    isBuiltInPresetId,
    saveCurrentConfigPreset,
    setActiveGlobalConfig,
    markActiveConfigApplied,
    saveState,
    getActiveGlobalConfig,
    applyGlobalActiveConfigToState,
    getCurrentPromptPresetPayload,
    normalizeImportedPreset,
    areaPresetScopes,
});
const {
    bind: bindPresetEvents,
} = presetEventsController;


contentConfigurationEvents = createContentConfigurationEvents({
    query: $,
    navigatorRef: navigator,
    defaultFactsPrompt,
    getState: ensureState,
    defaultInjectionTemplate,
    syncInjection,
    persistSharedConfigurationFromState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    renderInjectionContent,
});

automationConfigurationEvents = createAutomationConfigurationEvents({
    query: $,
    documentRef: document,
    readGenerationTargetSettings: (...args) => summaryTargetController.readGenerationTargetSettings(...args),
    defaultAutomation,
    fetchCustomApiModels: (...args) => generationClient.fetchCustomApiModels(...args),
});

const promptInspector = createPromptInspector({
    getChat: () => chat,
    getItemizedPrompts: () => itemizedPrompts,
    getItemizedParams: (...args) => itemizedParams(...args),
    countTokens: value => overviewTokenManifest.getOverviewTokenCount(value),
    getPluginInjection: () => {
        const state = ensureState();
        const text = Object.values(overviewTokenManifest.getOverviewInjectionSources(state)).filter(value => String(value || '').trim()).join('\n\n');
        const parts = getInjectionMemoryParts(state);
        // Each piece the plugin adds (memory, inline summary/table rules, state upkeep) is recognised by its first real line.
        const pieces = [state.injection?.enabled ? renderInjectionContent(state, parts) : '', parts.inlineValues?.summaryValue, parts.inlineValues?.tableValue, parts.rpMaintenance];
        const markers = pieces.map(piece => String(String(piece || '').split('\n').find(line => line.trim().length >= 6) || '').trim()).filter(Boolean);
        return { text, markers, found: promptText => overviewTokenManifest.doesLastPromptMatchCurrentInjection(promptText, state) };
    },
    countImageTokens: async (url, detail) => {
        const baseCost = 85;
        if (!url || detail === 'low') return baseCost;
        try {
            const size = await getImageSizeFromDataURL(url);
            if (detail === 'auto' && size.width <= 512 && size.height <= 512) return baseCost;
            const fitScale = 2048 / Math.min(size.width, size.height);
            const fittedWidth = Math.max(1, Math.round(size.width * fitScale));
            const fittedHeight = Math.max(1, Math.round(size.height * fitScale));
            const detailScale = 768 / Math.min(fittedWidth, fittedHeight);
            const finalWidth = Math.max(1, Math.round(fittedWidth * detailScale));
            const finalHeight = Math.max(1, Math.round(fittedHeight * detailScale));
            return (Math.ceil(finalWidth / 512) * Math.ceil(finalHeight / 512) * 170) + baseCost;
        } catch (error) {
            console.warn('[BakemonoMemory] failed to count image prompt tokens', error);
            return baseCost;
        }
    },
    countVideoTokens: async () => 1000,
    getActiveTab: () => getActiveWorkbenchTab(),
    notifySuccess: message => toastr.success(message),
    notifyError: message => toastr.error(message),
    logWarning: (...args) => console.warn(...args),
});

const overviewTokenManifest = createOverviewTokenManifest({
    query: $,
    getState: ensureState,
    getHash,
    countTokens: value => getTokenCountAsync(value, 0),
    getInjectionMemoryParts,
    renderInjectionContent,
    renderInlinePrompt,
    defaultInjectionTemplate,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    getLastPromptUsage: () => promptInspector.getLastCompletePromptUsage(),
    getActiveTab: () => getActiveWorkbenchTab(),
    logWarning: (...args) => console.warn(...args),
});
const { renderOverviewTokenManifest } = overviewTokenManifest;
const injectionPreview = createInjectionPreview({
    getSources: () => overviewTokenManifest.getOverviewInjectionSources(),
    beforeOpen: () => helpPopover.close(),
    openDialog: options => dialogs.open(options),
});

const workflowOverviewModel = createWorkflowOverviewModel({
    getState: ensureState,
    getChat: () => chat,
    getContext,
    buildFloorMemoryIndex,
    createMemoryOrchestrationPlan,
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    getStageSourceMode,
    getUnsummarizedStoryBlocks,
    getIsBusy: () => isBusy,
    isTaskQueueRunning: () => summaryTaskQueue.isRunning(),
    logWarning: (...args) => console.warn(...args),
});
const {
    getCurrentFloorMemoryIndex,
    getMemoryOrchestrationPlan,
    getMemoryStrategyLabel,
    getOverviewHealth,
    getOverviewRecommendation,
    getStageSourceModeLabel,
    getWorkflowModeLabel,
    getWorkflowStatusText,
} = workflowOverviewModel;

const workbenchHeaderUi = createWorkbenchHeaderUi({
    documentRef: document,
    getState: ensureState,
    getChat: () => chat,
    getMemoryStrategyLabel,
    renderInjectionContent,
    defaultAutomation,
    getAppearanceSettings,
});
const {
    getInjectionStatus: getWorkbenchInjectionHeaderStatus,
    getPanelKicker: getWorkbenchPanelKicker,
    getPanelShortKicker: getWorkbenchPanelShortKicker,
    getPanelTitle: getWorkbenchPanelTitle,
    render: renderWorkbenchHeaderContext,
} = workbenchHeaderUi;

const overviewWorkbenchUi = createOverviewWorkbenchUi({
    query: $,
    getState: ensureState,
    getActiveGlobalConfig,
    defaultAutomation,
    defaultScanRules,
    defaultState,
    getCurrentFloorMemoryIndex,
    getOverviewHealth,
    getOverviewRecommendation,
    getChat: () => chat,
    escapeHtml,
    getActiveTab: () => getActiveWorkbenchTab(),
    renderTokenManifest: state => renderOverviewTokenManifest(state),
});
const { renderOverviewConfigManifest, renderWorkflowGuide } = overviewWorkbenchUi;

const summaryGenerationUi = createSummaryGenerationUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    getStageMaterialOverview,
    getStageSourceModeLabel,
    getCurrentFloorMemoryIndex,
});
const {
    bindEvents: bindSummaryGenerationEvents,
    getMode: getSummaryGenerationMode,
    render: renderSummaryGenerationPanel,
} = summaryGenerationUi;

const turnSummaryUi = createTurnSummaryUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    defaultState,
    turnProcessingModes,
    tableSchemaScopes,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    renderInlinePromptPresetControls,
    getFloorMemoryIndex: state => workflowOverviewModel.getCurrentFloorMemoryIndex(state),
    escapeHtml,
});
const { render: renderTurnSummaryPanel } = turnSummaryUi;

const hubAutomationUi = createHubAutomationUi({
    getFactsPending: state => ({ pending: factsController.pendingSummaries(state).length, every: factsController.facts(state).settings.everySummaries }),
    getAutoStageTargets,
    getIsBusy: () => isBusy,
    documentRef: document,
    query: $,
    getState: ensureState,
    getCurrentFloorMemoryIndex,
    getInjectionHeaderStatus: state => getWorkbenchInjectionHeaderStatus(state),
    getAppearanceSettings,
    getActiveGlobalConfig,
    getPromptPresets,
    getSelectedPromptPresetId,
    getStageMaterialOverview,
    getStageSourceModeLabel,
    defaultAutomation,
    defaultScanRules,
    describeSummary,
    escapeHtml,
});
const {
    renderAutomationOverview,
    renderHubPanels: renderWorkbenchHubPanels,
} = hubAutomationUi;

const summaryBrowserUi = createSummaryBrowserUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    getStoryBlocks,
    getBlocksByType,
    blockTypes,
    dedupeByHash,
    summaryToBlock,
    normalizeSearchText,
    getPreviewSummaryText,
    parsePreviewMeta,
    stripHtml,
    getBlockSortKey,
    createNotebook: createBakemonoNotebook,
    getSummaryGroup,
    setSummaryOpen,
});
const {
    changePage: changeSummaryBrowserPage,
    getActiveType: getSummaryBrowserActiveType,
    renderSections: renderPreviewSections,
    resetPages: resetSummaryBrowserPages,
    setActiveType: setSummaryBrowserActiveType,
} = summaryBrowserUi;

const workbenchPageOverviews = createWorkbenchPageOverviews({
    documentRef: document,
    windowRef: window,
    defaultFactsPrompt,
    navigatorRef: navigator,
    query: $,
    getState: ensureState,
    blockTypes,
    defaultScanRules,
    parseList,
    getPromptStructureExcerpt,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultGenericStoryGenerationPrompt,
    defaultGenericStageGenerationPrompt,
    defaultGenericEpicGenerationPrompt,
    defaultInjectionTemplate,
    getInjectionMemoryParts,
    renderInjectionContent,
    getActiveGlobalConfig,
    summarySourceChoice,
    toastr,
});
const {
    bindPromptEvents,
    renderConfigOverview,
    renderGenerationOverview,
    renderInjectionOverview,
    renderPromptOverview,
    renderScanOverview,
    renderScanPreview,
} = workbenchPageOverviews;

const generationClient = createGenerationClient({
    formatApiFailure,
    query: $,
    ensureState,
    generateRaw,
    normalizeCustomApiBaseUrl,
    getCustomChatCompletionsUrl,
    defaultAutomation,
    fetchImpl: (...args) => fetch(...args),
    getTavernHeaders: () => tavernHost.getRequestHeaders(),
    readCustomApiFieldsFromUi,
    persistSharedConfigurationFromState,
    toastr,
    getCustomModelsUrl,
    extractCustomModelIds,
    renderCustomModelOptions,
});
const { callGenerationModel, fetchCustomApiModels, readOpenAIStream } = generationClient;

const summaryDraftService = createSummaryDraftService({
    summarySources,
    getChat: () => chat,
    ensureState,
    getHash,
    getBlockTitle,
    blockTypes,
    messageHasConfiguredSummary,
    toastr,
    saveChatConditional,
    scanBakemonoBlocks,
    updateInjectionFromSummaries,
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    confirmDanger,
    getSummaryTaskQueue: () => summaryTaskQueue,
    setBusy,
    processTaskQueue: (...args) => summaryTaskQueue.processTaskQueue(...args),
    getSourceStart,
    getSourceEnd,
    getSummaryLevel,
    sortSummariesBySource,
    unique,
    mergeBlocks,
    getKindLabel,
    runGeneration: (...args) => operationFeedback.runGeneration(...args),
    callGenerationModel,
    buildEpicSystemPrompt: (...args) => buildEpicSystemPrompt(...args),
    buildStageSystemPrompt: (...args) => buildStageSystemPrompt(...args),
    persistSharedConfigurationFromState,
    getFiniteMessageIds,
    formatSourceRange,
    hideChatMessageRange,
    markVectorIndexDirty,
    parseList,
    extractConfiguredSegments,
    removeExactTextBlock,
    confirm: confirmMessage,
    onSummaryCommitted: summary => factsController.onSummaryCommitted(summary),
    applyFactsDraft: (draftId, options) => factsController.applyDraft(draftId, options),
});
const {
    clearStuckMissingSummaryTasks,
    clearStuckQueueTasks,
    commitAllMissingSummaryDrafts,
    commitDraft,
    commitMissingSummaryDraft,
    createDraft,
    deleteSavedSummary,
    discardDraft,
    findSavedSummaryByHash,
    getDefaultDraftTitle,
    getMissingSummaryDraftConflict,
    getSummaryDependents,
    getSummaryIndexForKind,
    isMissingSummaryTask,
    markAffectedAutoSummaryTransactions,
    normalizeGeneratedBakemono,
    recomputeCoveredHashes,
    recordAutoSummaryTransaction,
    regenerateDraft,
    removeMissingSummaryDraftsAndTasks,
    removeSummaryByHash,
    rollbackAutoSummaryTransaction,
    saveEditedSummary,
    transactionTouchesMessage,
    undoLastCommit,
    updateChatMessageText,
} = summaryDraftService;

const reviewQueueUi = createReviewQueueUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    isMissingSummaryTask,
    getKindLabel,
    blockTypes,
    escapeHtml,
    describeSummary,
    createSummaryDocument,
});
const {
    changeHistoryPage,
    historyState,
    renderDrafts,
    renderHistory,
    renderTabs: renderReviewPanelTabs,
    renderTaskQueue,
    setActiveView: setReviewPanelView,
} = reviewQueueUi;

const maintenanceUi = createMaintenanceUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    getActualHiddenMessageIds,
    getFiniteMessageIds,
    formatSourceRange,
    getKindLabel,
    unique,
    escapeHtml,
    BlobCtor: Blob,
    urlApi: URL,
    notifySuccess: message => toastr.success(message),
});
const {
    bindEvents: bindMaintenanceEvents,
    renderAutoSummaryTransactions,
    renderOverview: renderMaintenanceOverview,
} = maintenanceUi;


const storyToolsUi = createStoryToolsUi({
    documentRef: document, getState: ensureState, getChat: () => chat,
    getChatKey: getSummaryRecoveryChatIdentity,
    getScannedBlocks: () => { scanBakemonoBlocks({ persist: false, render: false }); return ensureState().blocks || []; },
    saveState, saveChat: saveChatConditional, refresh: () => {
        updateInjectionFromSummaries();
        renderWorkbenchScope(workbenchRenderScopes.TABLES);
        renderWorkbenchScope(workbenchRenderScopes.ARCHIVE);
    },
    isBusy: () => isBusy, escapeHtml, notify: (message, error) => error ? toastr.error(message) : toastr.success(message),
    confirm: confirmMessage,
});

const summaryTimelineUi = createSummaryTimelineUi({
    documentRef: document,
    getState: ensureState,
    getStoryBlocks,
    getBlocksByType,
    blockTypes,
    dedupeByHash,
    summaryToBlock,
    unique,
    getMultiSummaryLabel,
    getKindLabel,
    getBlockTitle,
    getFloorIndex: state => getCurrentFloorMemoryIndex(state),
    describeSummary,
    escapeHtml,
});
const {
    changePage: changeTimelinePage,
    render: renderTimeline,
} = summaryTimelineUi;

const summaryBrowserEvents = createSummaryBrowserEvents({
    query: $,
    focusSummaryRecord: async (key, type) => {
        if (!await switchWorkbenchTab('preview')) return;
        summaryGenerationUi.setMode(type || 'story');
        renderSummaryGenerationPanel();
        if (!summaryBrowserUi.focusRecord(key, type)) toastr.info('这条摘要已不在当前聊天中，请刷新后查看。');
    },
    getSummaryBrowserActiveType,
    setSummaryBrowserActiveType,
    changeSummaryBrowserPage,
    renderPreviewSections,
    resetSummaryBrowserPages,
    stabilizeMobilePreviewScroll,
    changeTimelinePage,
    renderTimeline,
    memoryRecordStatuses,
    saveEditedSummary,
    toggleSummaryOpen: item => summaryBrowserUi.toggleOpen(item),
    toggleTimeline: (kind, key) => summaryTimelineUi.toggle(kind, key),
    setTimelineFilter: filter => summaryTimelineUi.setFilter(filter),
    toggleTimelineOrder: () => summaryTimelineUi.toggleOrder(),
    openSummaryActions: (item, trigger) => summaryActionSheet.open(item, trigger),
});

const summaryActionSheet = createSummaryActionSheet({
    sheet: actionSheet,
    escapeHtml,
    findSavedSummaryByHash,
    getSummaryDependents,
    startEdit: item => summaryBrowserUi.startEdit(item),
    locateFloor: locateChatFloor,
    deleteSummary: hash => deleteSavedSummary(hash, { confirmed: true }),
});

const turnProcessingController = createTurnProcessingController({
    summarySources,
    getContext,
    getChat: () => chat,
    getChatMetadata: () => chat_metadata,
    ensureState,
    getHash,
    blockTypes,
    stripPostProcessNoise,
    extractAllTaggedBlocks,
    normalizeGeneratedBakemono,
    createDraft,
    defaultInlineSummaryPrompt,
    commitDraft,
    saveState,
    formatSourceRange,
    toastr,
    stripTableEditTags,
    updateInjectionFromSummaries,
    saveChatConditional,
    scheduleRenderAll,
    syncInjection,
    renderWorkbenchScope,
    workbenchRenderScopes,
    getSourceMessageIdsFromBlocks,
    renderGenerationPrompt,
    defaultTurnSummaryPrompt,
    getSourceStart,
    stripHtml,
    stripConfiguredTags,
    filterTextByConfiguredTags,
    parseList,
    turnProcessingModes,
    runGeneration: (...args) => operationFeedback.runGeneration(...args),
    callGenerationModel,
    extractTaggedContent,
});
const {
    buildLatestTurnBlocks,
    buildTurnReferenceSystemPrompt,
    buildTurnSummaryPrompt,
    buildWorldInfoScanMessages,
    captureInlineGenerationFromLatestMessage,
    findLatestAssistantTurn,
    getCharacterReferenceContext,
    getCurrentCharacterForReference,
    getWorldInfoGlobalScanData,
    getWorldInfoReferenceContext,
    processLatestTurnSummary,
    scheduleInlineGenerationCapture,
} = turnProcessingController;

const memoryOrchestrator = createMemoryOrchestrator({
    noteFactsActivity: () => factsController.noteActivity(),
    resumeFacts: () => factsController.resume(),
    consolidateFacts: () => factsController.maybeRun({ trigger: 'auto' }),
    isChatReady,
    ensureState,
    isBusy: () => isBusy,
    scanBakemonoBlocks,
    getUnsummarizedStoryBlocks,
    getStageSourceMode,
    getHash,
    saveState,
    defaultAutomation,
    toastr,
    renderWorkbenchScope,
    workbenchRenderScopes,
    generateStageDraft,
    turnProcessingModes,
    processLatestTurnSummary,
    getCurrentFloorMemoryIndex,
    getMemoryOrchestrationPlan,
    captureInlineGenerationFromLatestMessage,
    scheduleInlineGenerationCapture,
    scheduleAutoHideRecent,
    markVectorIndexDirty,
    scheduleVectorAutoIndex,
    syncInjection,
    scheduleRenderAll,
    shouldRunTurnProcessing,
});
const {
    isAutoThresholdReached,
    maybeRunAutoSummary,
    maybeRunTurnSummary,
    runMemoryOrchestrator,
} = memoryOrchestrator;

const summaryTargetController = createSummaryTargetController({
    getSummaryMaterialPreview,
    query: $,
    getState: ensureState,
    defaultGenerationTargets,
    targetSelectionModes,
    persistSharedConfigurationFromState,
    parseLooseNumberRange,
    toastr,
    saveState,
    confirmDanger,
    getSourceMessageIdsFromBlocks,
    formatSourceRange,
    renderWorkbenchScope,
    workbenchRenderScopes,
    openDialog: options => dialogs.open(options),
    openMissingBackfill: () => openBackfillForm('missing'),
});
const {
    confirmGenerationTargets,
    getTargetSelectionLabel,
    parseGenerationTargetInput,
    promptGenerationTargetSelection,
    readGenerationTargetSettings,
} = summaryTargetController;

const summaryTaskQueue = createSummaryTaskQueue({
    summarySources,
    rebuildMissingTask: task => summaryBackfillController.rebuildMissingTask(task),
    // A summary task reads floors; 整理事实 reads summaries, so its fingerprint is theirs (id and text version).
    getTaskSourceSignature: task => task.kind === blockTypes.FACTS
        ? factsController.sourceSignature(task)
        : JSON.stringify((task.sourceMessageIds || []).map(id => [id, chat[id] ? getMessageVariantKey(chat[id]) : null, getHash(chat[id]?.mes || '')])),
    getState: ensureState,
    getHash,
    getKindLabel,
    saveState,
    renderWorkbenchScope,
    renderTaskQueueProgress,
    workbenchRenderScopes,
    getIsBusy: () => isBusy,
    setBusy,
    toastr,
    callGenerationModel,
    parseMissingSummaryBatchResult,
    normalizeGeneratedBakemono,
    createMissingSummaryDraftFromBatchItem,
    createDraft,
    commitDraft,
    blockTypes,
    defaultAutomation,
    hideCoveredMessages,
    recordAutoSummaryTransaction,
    switchWorkbenchTab,
    confirmDanger,
    historyState,
    resultHandlers: { [blockTypes.FACTS]: (...args) => factsController.handleTaskResult(...args) },
});
const {
    clearFinishedQueueTasks,
    clearHistoryRecords,
    enqueueSummaryTask,
    processTaskQueue,
    removeQueueTask,
    retryQueueTask,
} = summaryTaskQueue;

// The current model's context window in tokens: SillyTavern 1.19 has getMaxContextTokens; older versions have
// getMaxContextSize (the window minus the reply length, close enough). 0 when neither is there.
function hostContextTokens() {
    for (const name of ['getMaxContextTokens', 'getMaxContextSize']) {
        try {
            const value = typeof hostScript[name] === 'function' ? Number(hostScript[name]()) : 0;
            if (value > 0) return value;
        } catch { /* try the next one */ }
    }
    return 0;
}

const factsController = createFactsController({
    getState: ensureState,
    getContextTokens: hostContextTokens,
    getChat: () => chat,
    isChatReady,
    summaryStatus: (state, item) => getSummaryStatus(state, item),
    saveState,
    enqueueSummaryTask,
    blockTypes,
    getBlockPlainText,
    toastr,
    renderWorkbenchScope,
    workbenchRenderScopes,
    syncInjection: () => syncInjection(),
    confirm: confirmDanger,
    persistSharedConfigurationFromState,
    createDraft: (...args) => summaryDraftService.createDraft(...args),
    getLegacy: state => {
        // The older ledger is replayed read-only for the import; nothing writes to it any more.
        let projection = null;
        try { projection = Array.isArray(state.rpCore?.facts) ? replayLedger(state.rpCore, applyDomainFact).projection : null; } catch { projection = null; }
        return { projection, information: projection ? currentInformation(state.rpCore, {}) : [],
            tables: state.tableDatabase?.tables || [] };
    },
});
const factsUi = createFactsUi({
    documentRef: document,
    getState: ensureState,
    controller: factsController,
    escapeHtml,
    sheet: actionSheet,
    refresh: () => renderWorkbenchScope(workbenchRenderScopes.DRAFTS),
    navigate: tab => switchWorkbenchTab(tab),
});

const reviewQueueEvents = createReviewQueueEvents({
    pauseQueue: () => summaryTaskQueue.pauseQueue(),
    resumeQueue: () => summaryTaskQueue.resumeQueue(),
    stopCurrentTask: () => summaryTaskQueue.stopCurrentTask(),
    query: $,
    globalRef: globalThis,
    getIsBusy: () => isBusy,
    toastr,
    getState: ensureState,
    saveState,
    setReviewPanelView,
    renderReviewPanelTabs,
    stabilizeMobileWorkbenchScroll,
    renderWorkbenchScope,
    workbenchRenderScopes,
    commitDraft,
    regenerateDraft,
    discardDraft,
    retryQueueTask,
    removeQueueTask,
    rollbackAutoSummaryTransaction,
    changeHistoryPage,
    renderHistory,
    sheet: actionSheet,
    escapeHtml,
    toggleDraft: item => reviewQueueUi.toggleDraft(item),
    startDraftEdit: item => reviewQueueUi.startDraftEdit(item),
    stopDraftEdit: item => reviewQueueUi.stopDraftEdit(item),
    locateFloor: locateChatFloor,
});

workbenchRenderer = createWorkbenchRenderer({
    afterRender: (tab, state) => {
        if (tab === 'settings') summarySourceWizard.render(state);
        pageSettings?.render(tab, state);
        if (tab === 'settings') summarySourceWizard.refresh();
        if (tab === 'turn-summary' || tab === 'tables') syncSummarySourceControls($, summarySourceChoice(state));
    },
    renderFacts: state => factsUi.render(state),
    documentRef: document,
    globalRef: globalThis,
    query: $,
    getState: ensureState,
    isWorkbenchOpen,
    getActiveTab: getActiveWorkbenchTab,
    areaPresetScopes,
    renderPresetControlPair,
    renderAreaPresetControl,
    renderWorkflowGuide,
    renderPromptInspector: () => promptInspector.render(),
    renderHubPanels: renderWorkbenchHubPanels,
    renderSummaryGenerationPanel,
    renderPreviewSections,
    renderTimeline,
    renderDrafts,
    renderHistory,
    renderTaskQueue,
    renderTurnSummaryPanel: state => { renderTurnSummaryPanel(state); storyToolsUi.render(state); },
    renderInjectionOverview,
    renderPromptOverview,
    renderGenerationOverview,
    renderConfigOverview,
    renderAutomationOverview,
    renderVectorMemoryPanel,
    renderScanOverview,
    renderScanPreview,
    renderCustomModelOptions,
    renderAppearanceSettings,
    renderAutoHideRecentPanel,
    renderMaintenanceOverview: state => { renderMaintenanceOverview(state); storyToolsUi.render(state); },
    renderHelp: () => helpGuide.render(),
    getStoryBlocks,
    getBlocksByType,
    blockTypes,
    dedupeByHash,
    summaryToBlock,
    memoryStrategies,
    workflowModes,
    getStageSourceMode,
    getMemoryStrategyLabel,
    getWorkflowModeLabel,
    getStageSourceModeLabel,
    getInjectionMemoryParts,
    getWorkflowStatusText,
    defaultInjectionTemplate,
    renderInjectionContent,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
    defaultAutomation,
    defaultGenerationTargets,
    buildMemoryRecords,
    renderHeaderContext: renderWorkbenchHeaderContext,
    captureFeedback: status => operationFeedback.captureFromStatus(status),
});

const workbenchActionController = createWorkbenchActionController({
    pauseVectorIndex: () => vectorMemoryService.pauseVectorIndex(),
    testEmbeddingConnection,
    workbenchRenderScopes,
    scanBakemonoBlocks,
    generateStageDraft,
    generateStageBatchTasks,
    generateEpicDraft,
    generateEpicBatchTasks,
    generateBackfillQueue,
    generateBatchSummaryQueue,
    commitAllMissingSummaryDrafts,
    removeMissingSummaryDraftsAndTasks,
    clearStuckQueueTasks,
    clearStuckMissingSummaryTasks,
    readTurnSummaryFieldsFromUi,
    processLatestTurnSummary,
    undoLastCommit,
    clearFinishedQueueTasks,
    clearHistoryRecords,
    hideCoveredMessages,
    restoreHiddenMessages,
    previewMessageRange,
    setMessageRangeHidden,
    previewPreserveRecentMessages,
    hideBeforeRecentMessages,
    applyAutoHideRecentSettings,
    restoreAutoHiddenMessages,
    buildVectorMemoryIndex,
    testVectorMemoryRetrieval,
    persistVectorMemoryFieldsFromUi,
    fetchVectorEmbeddingModels,
    fetchVectorQueryModels,
    clearVectorMemoryIndex,
    runVisibleOperation,
});
const { getRenderScope: getWorkbenchActionRenderScope, run: runWorkbenchAction } = workbenchActionController;

pageSettings = createPageSettings({
    documentRef: document, getState: ensureState, getActiveTab: getActiveWorkbenchTab,
    refresh: () => {
        // Draft restoration runs after rendering. Explicit save/discard must
        // start from committed fields, not the vector form's retained values.
        if (getActiveWorkbenchTab() === 'vector') vectorWorkbenchUi.renderVectorConfigurationFields(ensureState());
        return renderWorkbenchScope({
        vector: workbenchRenderScopes.VECTOR, scan: workbenchRenderScopes.SCAN,
        automation: workbenchRenderScopes.AUTOMATION, generation: workbenchRenderScopes.GENERATION,
        prompts: workbenchRenderScopes.PROMPTS, injection: workbenchRenderScopes.INJECTION,
        'turn-summary': workbenchRenderScopes.TABLES, tables: workbenchRenderScopes.TABLES,
        }[getActiveWorkbenchTab()] || workbenchRenderScopes.SUMMARY);
    },
    notify: message => toastr.warning(message),
    askLeave: ({ label, count, closing }) => dialogs.choose({
        title: `${label}还有 ${count} 项没保存`,
        choices: [
            { value: 'save', label: closing ? '保存再关闭' : '保存再离开' },
            { value: 'discard', label: closing ? '不保存，直接关闭' : '不保存，直接离开', note: '修改会丢掉' },
            { value: 'stay', label: '留在这一页' },
        ],
        dismiss: 'stay',
        closeLabel: '留在这一页',
    }),
    async savePage(tab, state) {
        if (ensureState() !== state) throw new Error('聊天已切换，请在当前聊天重新保存。');
        if (tab === 'vector') return applyVectorMemorySettings();
        const readers = { scan: readRuleFieldsFromUi, automation: readAutomationFieldsFromUi,
            generation: readCustomApiFieldsFromUi, prompts: readPromptFieldsFromUi,
            injection: readInjectionFieldsFromUi, 'turn-summary': readTurnSummaryFieldsFromUi,
            settings: readWorkflowFieldsFromUi };
        if (!readers[tab]) throw new Error('当前页面没有可保存的设置。');
        const sourceBefore = summarySourceChoice(state);
        readers[tab](state);
        // 自动记忆 can change where summaries come from, which changes how the chat is read.
        if (tab === 'scan' || tab === 'settings' || summarySourceChoice(state) !== sourceBefore) scanBakemonoBlocks({ persist: false, render: false });
        syncInjection();
        const config = persistSharedConfigurationFromState(state);
        const revision = state.activeConfigSignature;
        const [global, chatSave] = await Promise.allSettled([confirmGlobalConfiguration(config), saveChatConditional()]);
        if (ensureState() !== state || state.activeConfigSignature !== revision) throw new Error('保存期间聊天或配置已变化，请重新核对。');
        const globalConfirmed = global.status === 'fulfilled' && global.value?.status === 'confirmed';
        if (globalConfirmed && chatSave.status === 'fulfilled') return true;
        // Say which half failed; the settings already apply in this session either way.
        throw new Error(!globalConfirmed
            ? global.value?.status === 'superseded' ? '保存时设置又变了，请再点一次保存。'
                : '设置已经生效，但酒馆没能确认写进设置文件（可能写得比较慢）。刷新网页前请再点一次保存。'
            : '设置已写进酒馆，但这个聊天没能保存，请检查连接后再点一次保存。');
    },
});

const workbenchShellEvents = createWorkbenchShellEvents({
    query: $,
    documentRef: document,
    windowRef: window,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    saveSettingsDebounced,
    renderExtensionEntrySettings,
    syncTopNavButton,
    syncMobileCollapsibles,
    openWorkbench,
    closeWorkbench,
    setWorkbenchMenuOpen,
    switchWorkbenchTab,
    stabilizeMobileWorkbenchScroll,
    operationFeedback,
    bindThemeEvents,
    promptInspector,
    helpGuide,
    helpPopover,
    injectionPreview,
    runWorkbenchAction,
    getWorkbenchActionRenderScope,
    renderWorkbenchScope,
});

function getKindLabel(kind) {
    return getSummaryKindLabel(kind, blockTypes);
}

function bindSettingsEvents() {
    pageSettings.bind(document.getElementById('bakemono-workbench-root'));
    summarySourceWizard.bind(document.getElementById('bakemono-workbench-root'));
    turnSummaryUi.bind(document.getElementById('bakemono-workbench-root'));
    hubAutomationUi.bindAutomation(document.getElementById('bakemono-workbench-root'));
    workbenchShellEvents.bind();
    bindArchiveEvents();
    reviewQueueEvents.bind();
    summaryBrowserEvents.bind();
    bindSummaryGenerationEvents();
    bindPromptEvents();
    bindMaintenanceEvents();
    storyToolsUi.bind();
    factsUi.bind();
    overviewWorkbenchUi.bind(document);
    contentConfigurationEvents.bind();
    automationConfigurationEvents.bind();
    vectorActionsController.bind();
    bindPresetEvents();
    bindScanEvents();
}


async function initWorkbench() {
    rpProtocolDisplay.bind();
    const response = await fetch(`${extensionFolderPath}/settings.html`);
    if (!response.ok) {
        throw new Error(`Failed to load settings.html: ${response.status} ${response.statusText}`);
    }

    document.getElementById('bakemono-workbench-root')?.remove();
    $('body').append(await response.text());
    organizeWorkbenchOwnedSections(getSummaryGenerationMode());
    installWorkbenchParentNavigation();
    applyAppearanceTheme();
    await addExtensionSettingsBlock();
    await addWandButton();
    syncTopNavButton();
    bindSettingsEvents();
    switchWorkbenchTab('overview');
    renderAll();
}

function reconcileSummaryRecovery(state = ensureState()) {
    // The crash copy belongs to one chat file and is applied only once that file has been read.
    if (!chatGate.isReady()) return { status: 'not-ready' };
    const recovery = summaryRecoveryJournal.reconcile(state, chat);
    summaryTaskQueue.recoverInterruptedTasks(state);
    if (['recovered', 'revision-only'].includes(recovery.status)) {
        scanBakemonoBlocks({ persist: false, render: false });
        updateInjectionFromSummaries();
        saveState();
        void saveChatConditional();
    }
    if (recovery.status === 'recovered') {
        const restoredParts = [];
        const changedKeys = new Set(recovery.changedStateKeys || []);
        if (['storySummaries', 'stageSummaries', 'epicSummaries', 'drafts'].some(key => changedKeys.has(key))) {
            restoredParts.push(`${recovery.summaryItems || 0} 项摘要/草稿`);
        }
        if (changedKeys.has('tableDatabase')) {
            restoredParts.push(`${recovery.tableRows || 0} 行表格数据`);
        }
        if (recovery.patchedMessages) {
            restoredParts.push(`${recovery.patchedMessages} 个正文补丁`);
        }
        if (!restoredParts.length) restoredParts.push('未完整写入的记忆状态');
        toastr.warning(
            `检测到酒馆上次未完整写入，已恢复：${restoredParts.join('、')}。`,
            '剧情剪辑台已恢复',
            { timeOut: 12000, extendedTimeOut: 18000 },
        );
    }
    return recovery;
}

function scheduleForegroundRuntimeResume(reason = '恢复前台') {
    clearTimeout(foregroundResumeTimer);
    foregroundResumeTimer = setTimeout(async () => {
        foregroundResumeTimer = null;
        if (document.visibilityState === 'hidden') return;
        // Still reading the chat (the tavern was reopened, or a character picked): CHAT_CHANGED runs all this once it
        // is loaded.
        if (!chatGate.isReady()) return;
        if (isBusy) {
            foregroundResumeWhenIdle = true;
            return;
        }
        try {
            const state = ensureState();
            reconcileSummaryRecovery(state);
            recoverNewerSharedConfigurationFromState(state);
            syncGlobalActiveConfigToState(state);
            await runMemoryOrchestrator('恢复前台', {
                turnTrigger: 'assistant',
                scheduleInlineCapture: true,
                vectorDirtyReason: reason,
                render: true,
                // Not a message: 剧情事实 checks whether the idle time passed instead of starting its timer over.
                activity: false,
            });
        } catch (error) {
            console.warn('[BakemonoMemory] foreground runtime resume failed', error);
        }
    }, 500);
}

const vectorAutoRecall = createVectorAutoRecall({
    getState: ensureState, retrieve: retrieveVectorMemoryHits, clear: clearVectorRecall,
    cancelRecall: cancelVectorRecall, syncInjection, saveState, refresh: scheduleRenderAll,
});

async function init() {
    // Registered first, so every other handler of these events already sees the chat as loaded.
    eventSource.on(event_types.CHAT_CHANGED, () => { chatGate.markLoaded(); });
    if (event_types.CHAT_LOADED) eventSource.on(event_types.CHAT_LOADED, () => { if (!chatGate.isReady()) chatGate.markLoaded(); });
    const chatOpen = chatGate.markLoadedIfSettled();
    ensureGlobalSettings();
    const initialState = ensureState();
    if (chatOpen) {
        reconcileSummaryRecovery(initialState);
        recoverNewerSharedConfigurationFromState(initialState);
        bootstrapSharedConfigurationFromCurrentChat(initialState);
        syncGlobalActiveConfigToState(initialState, { force: true });
    }
    await initWorkbench();
    globalThis.bakemonoMemoryRecallInterceptor = vectorAutoRecall.intercept;
    vectorAutoRecall.bind(eventSource, event_types);
    syncInjection();
    // A chat still loading gets all of this from CHAT_CHANGED.
    if (chatGate.isReady()) {
        if (ensureState().vectorMemory.enabled) {
            const state = ensureState();
            if (state.vectorMemory.lastIndexedSignature !== getVectorSourceSignature(state)) {
                markVectorIndexDirty('初始化检测到聊天变更', state);
            } else {
                scheduleVectorAutoIndex('初始化');
            }
        }

        scheduleAutoHideRecent('init');
        // Chats saved before 1.25.1 carry their vectors inside the chat file; move them out once the chat is open.
        vectorMemoryService.scheduleSidecarSave(ensureState());
    }

    eventSource.on(event_types.CHAT_CHANGED, () => {
        injectionPreview.close({ restoreFocus: false });
        // No chat open (the character list, a closed chat): only clear what the previous chat injected.
        if (!chatGate.isReady()) {
            syncInjection();
            scheduleRenderAll();
            return;
        }
        return runChatSwitchFlow({
            getState: ensureState,
            syncConfig: state => {
                recoverNewerSharedConfigurationFromState(state);
                bootstrapSharedConfigurationFromCurrentChat(state);
                return syncGlobalActiveConfigToState(state, { force: true });
            },
            recover: state => reconcileSummaryRecovery(state),
            scheduleAutoHide: scheduleAutoHideRecent,
            markVectorDirty: markVectorIndexDirty,
            // The chat just opened may have been idle since its last message: 剧情事实 checks once the injection is
            // in place (runChatSwitchFlow orders the steps), with the chat loaded.
            resumeFacts: () => factsController.resume(),
            syncInjection,
            scheduleRender: scheduleRenderAll,
        });
    });
    if (event_types.CHAT_LOADED) {
        eventSource.on(event_types.CHAT_LOADED, () => {
            injectionPreview.close({ restoreFocus: false });
            scheduleForegroundRuntimeResume('聊天已载入');
        });
    }
    for (const event of [event_types.CHAT_CHANGED, event_types.CHAT_LOADED, event_types.CHARACTER_MESSAGE_RENDERED].filter(Boolean)) {
        eventSource.on(event, () => rpProtocolDisplay.bind());
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') scheduleForegroundRuntimeResume('返回前台');
    });
    window.addEventListener('pageshow', () => scheduleForegroundRuntimeResume('页面恢复'));
    window.addEventListener('focus', () => scheduleForegroundRuntimeResume('窗口恢复'));
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        await runMemoryOrchestrator('收到新回复', {
            turnTrigger: 'assistant',
            scheduleInlineCapture: true,
            vectorDirtyReason: '收到新消息',
            render: true,
        });
    });
    if (event_types.MESSAGE_SENT) {
        eventSource.on(event_types.MESSAGE_SENT, async () => {
            const state = ensureState();
            if (!shouldRunTurnProcessing(state.turnSummary, 'user')) return;
            await runMemoryOrchestrator('开始新一轮', {
                scan: false,
                turnOnly: true,
                turnTrigger: 'user',
                render: true,
            });
        });
    }
    if (event_types.ITEMIZED_PROMPTS_LOADED) {
        eventSource.on(event_types.ITEMIZED_PROMPTS_LOADED, () => {
            if (!isWorkbenchOpen()) return;
            if (getActiveWorkbenchTab() === 'overview') {
                renderWorkflowGuide(ensureState());
            } else if (getActiveWorkbenchTab() === 'prompt-inspector') {
                void promptInspector.render();
            }
        });
    }
    for (const event of [event_types.MESSAGE_UPDATED, event_types.MESSAGE_DELETED, event_types.MESSAGE_SWIPED]) {
        eventSource.on(event, (...args) => {
            const eventMessageIds = collectMessageIdsFromEventArgs(args);
            const fallbackTurn = findLatestAssistantTurn();
            const messageIds = eventMessageIds.length ? eventMessageIds : getFiniteMessageIds([fallbackTurn?.assistantMessage?.messageId]);
            markAffectedAutoSummaryTransactions(messageIds, event === event_types.MESSAGE_DELETED ? '楼层已删除' : event === event_types.MESSAGE_SWIPED ? '楼层已重 roll' : '楼层已编辑');
            scheduleAutoHideRecent('message changed');
            if (event !== event_types.MESSAGE_DELETED) {
                const state = ensureState();
                state.inlineGeneration.lastProcessedMessageId = null;
                state.inlineGeneration.lastProcessedSignature = '';
                scheduleInlineGenerationCapture('消息更新');
            } else {
            }
            markVectorIndexDirty('消息变更');
            syncInjection();
            scheduleRenderAll();
        });
    }
}

jQuery(async () => {
    try {
        await init();
    } catch (error) {
        console.error('[BakemonoMemory] initialization failed', error);
        globalThis.toastr?.error?.(`剧情剪辑台初始化失败：${error?.message || error}`);
    }
});
