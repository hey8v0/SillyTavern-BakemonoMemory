import { chat, chat_metadata, extension_prompt_roles, extension_prompt_types, eventSource, event_types, generateRaw, itemizedParams, itemizedPrompts, saveChatConditional, saveSettingsDebounced, setExtensionPrompt } from '../../../../script.js';
import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { hideChatMessageRange } from '../../../chats.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { getImageSizeFromDataURL } from '../../../utils.js';
import { runChatSwitchFlow } from './src/core/chat-switch.js';
import { createAutomationBehaviorConfig, createSharedInlineGenerationConfig, createSharedVectorConfig, isStateConfigNewerThanActive, markActiveConfigApplied, mergeAutomationBehaviorConfig, mergeSharedInlineGenerationConfig, mergeSharedVectorConfig, readActiveConfig, sharedConfigVersion, shouldBootstrapSharedConfig, shouldSyncActiveConfig } from './src/core/config-sync.js';
import { persistChatState, persistGlobalSettings } from './src/core/persistence.js';
import { installCompactStateSerializer } from './src/core/persisted-chat-state.js';
import { createSummaryRecoveryJournal } from './src/core/summary-recovery-journal.js';
import { migrateGenerationPrompts, migrateInlineSummaryPrompt, migratePromptPresetTimelines, migrateTurnSummaryPrompt, migrateVectorQueryRewritePrompt } from './src/core/prompt-migrations.js';
import { ensureObjectField, fillMissingDefaults, normalizeArrayFields } from './src/core/state-shape.js';
import { memoryStrategies, normalizeWorkflowState, stageSourceModes, workflowModes } from './src/core/workflow-mode.js';
import { migrateBuiltInInjectionDefaults, normalizeInjectionMemoryBody, normalizeLineEndings, renderInjectionTemplate } from './src/shared/injection-template.js';
import { dedupeByHash, unique } from './src/shared/collections.js';
import { formatBlocksForPrompt, getPromptStructureExcerpt, migrateBuiltInStructuredPrompt, migrateEpicPromptTimeSpan, migrateStagePromptTimeSpan, renderGenerationPrompt, stripPostProcessNoise } from './src/shared/prompt-utils.js';
import { countKeywordHits, extractAllTaggedBlocks, extractConfiguredTagBlocks, extractTaggedContent, filterTextByConfiguredTags, getHash, matchesAnyKeyword, normalizeSearchText, parseList, removeExactTextBlock, stripConfiguredTags, stripTableEditTags } from './src/shared/text.js';
import { parseMissingSummaryBatchResult } from './src/summary/draft-parser.js';
import { getMultiSummaryLabel, getNextMultiSummaryLevel, getSummaryKindLabel, getSummaryLevel } from './src/summary/levels.js';
import { buildFloorMemoryIndex, createMemoryOrchestrationPlan } from './src/memory/floor-memory-index.js';
import { formatSourceRange, getBlockSortKey, getFiniteMessageIds, getSourceEnd, getSourceMessageIdsFromBlocks, getSourceStart, getSummarySortKey, sortSummariesBySource } from './src/summary/source-metadata.js';
import { parseTableEditOperations } from './src/tables/operation-parser.js';
import { buildTableRollbackPlan } from './src/tables/rollback-plan.js';
import { baseStoryLedgerPreset, createBaseStoryLedgerTables } from './src/tables/builtin-presets.js';
import { findMatchingTable, mergeTableSchemaWithRows, normalizeImportedTablesFromJson, normalizeTableSchemas, normalizeTableText, toTableSchema } from './src/tables/schema-utils.js';
import { defaultGenerationTargets, findTargetContinuityGaps, getSortedTargetBlocks, parseLooseNumberRange, partitionGenerationTargets, selectGenerationTargets, targetSelectionModes } from './src/summary/target-selection.js';
import { cosineSimilarity, createLocalEmbedding } from './src/vector/math.js';
import { computeHybridRerankScore, selectHybridCandidates } from './src/vector/hybrid-retrieval.js';
import { extractCustomModelIds, getCustomChatCompletionsUrl, getCustomEmbeddingsUrl, getCustomModelsUrl, normalizeCustomApiBaseUrl } from './src/vector/provider-config.js';
import { extractChatCompletionText, parseVectorQueryRewritePayload } from './src/vector/query-parser.js';
import { compactEmbedding, getClippedVectorText, slimVectorMemoryForSave } from './src/vector/storage.js';
import { createPromptInspector } from './src/features/prompt-inspector.js';
import { createHelpGuide } from './src/features/help-guide.js';
import { createSummaryMemoryModel } from './src/features/summary-memory-model.js';
import { createSummarySelectors } from './src/features/summary-selectors.js';
import { createSummaryTargetController } from './src/features/summary-target-controller.js';
import { createSummaryTaskQueue } from './src/features/summary-task-queue.js';
import { createTableStateService } from './src/features/table-state-service.js';
import { createTableMemoryModel } from './src/features/table-memory-model.js';
import { createTableWorkflowController } from './src/features/table-workflow-controller.js';
import { createTableWorkbenchUi } from './src/features/table-workbench-ui.js';
import { createTableEditorEvents } from './src/features/table-editor-events.js';
import { createTableManagementEvents } from './src/features/table-management-events.js';
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
import { createTurnProcessingController } from './src/features/turn-processing-controller.js';
import { shouldRunTurnProcessing } from './src/features/turn-trigger-policy.js';
import { createGenerationClient } from './src/features/generation-client.js';
import { createSummaryDraftService } from './src/features/summary-draft-service.js';
import { createContentBlockService } from './src/features/content-block-service.js';
import { createScanController } from './src/features/scan-controller.js';
import { createSummaryPreviewRenderer } from './src/features/summary-preview-renderer.js';
import { createSummaryGenerationController } from './src/features/summary-generation-controller.js';
import { createSummaryBackfillController } from './src/features/summary-backfill-controller.js';
import { createConfigurationService } from './src/features/configuration-service.js';
import { createConfigurationController } from './src/features/configuration-controller.js';
import { createMemoryRecordsUi } from './src/features/memory-records-ui.js';
import { createOverviewTokenManifest } from './src/features/overview-token-manifest.js';
import { createWorkflowOverviewModel } from './src/features/workflow-overview-model.js';
import { createOverviewWorkbenchUi } from './src/features/overview-workbench-ui.js';
import { createSummaryGenerationUi } from './src/features/summary-generation-ui.js';
import { createTurnSummaryUi } from './src/features/turn-summary-ui.js';
import { createHubAutomationUi } from './src/features/hub-automation-ui.js';
import { createSummaryBrowserUi } from './src/features/summary-browser-ui.js';
import { createSummaryBrowserEvents } from './src/features/summary-browser-events.js';
import { createWorkbenchPageOverviews } from './src/features/workbench-page-overviews.js';
import { createReviewQueueUi } from './src/features/review-queue-ui.js';
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
    };
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

function confirmDanger(title, lines = [], confirmText = '确认继续吗？') {
    return window.confirm([
        title,
        ...lines.filter(Boolean),
        '',
        confirmText,
    ].join('\n'));
}


function saveState(options = {}) {
    const state = chat_metadata?.[STORAGE_KEY] || null;
    if (!state) {
        const error = new Error('当前聊天状态尚未连接到 SillyTavern 正式元数据，已阻止空保存');
        console.error('[BakemonoMemory] refused to save a missing live chat state', error);
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
let tableManagementEvents = null;
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
    createTableProfile: (...args) => tableStateService.createTableProfile(...args),
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
    ensureTableProfileForScope: (...args) => tableStateService.ensureTableProfileForScope(...args),
    mergeScopedTableSchemasIntoState: (...args) => tableStateService.mergeScopedTableSchemasIntoState(...args),
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
    readRuleFieldsFromUi: (...args) => configurationService.readRuleFieldsFromUi(...args),
    persistSharedConfigurationFromState: (...args) => configurationService.persistSharedConfigurationFromState(...args),
    toastr,
    confirmDanger,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
});
const { bindEvents: bindScanEvents, scanBakemonoBlocks } = scanController;

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
    canRemoveScannedSummaryBlock: (...args) => canRemoveScannedSummaryBlock(...args),
});
const {
    createBakemonoNotebook,
    getPreviewSummaryText,
    parsePreviewMeta,
} = summaryPreviewRenderer;

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
    getStoryBlocks,
    getStoryMaterialBlocks,
    getUnsummarizedMultiSummaryBlocks,
    getUnsummarizedStageBlocks,
    getUnsummarizedStoryBlocks,
    isBackfillSummary,
    isRawSourceBlock,
} = summarySelectors;
const summaryGenerationController = createSummaryGenerationController({
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
    confirm: message => window.confirm(message),
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
    confirm: message => window.confirm(message),
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
    closeHelp: () => helpPopover.close(),
    clearFeedback: () => operationFeedback.clear(),
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

const tableStateService = createTableStateService({
    tableSchemaScopes,
    getContext,
    ensureGlobalSettings,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    getChatState: () => chat_metadata[STORAGE_KEY],
    getHash,
    normalizeTableSchemas,
    getState: ensureState,
    saveGlobalSettings,
    findMatchingTable,
    mergeTableSchemaWithRows,
    updateInjectionFromSummaries: (...args) => updateInjectionFromSummaries(...args),
    saveState,
    saveChatConditional,
    getFiniteMessageIds,
    toastr,
    confirmDanger,
    renderWorkbenchScope,
    workbenchRenderScopes,
    buildTableRollbackPlan,
    scheduleRenderAll,
    baseStoryLedgerPreset,
    createBaseStoryLedgerTables,
});
const {
    collectMessageIdsFromEventArgs,
    createBaseStoryLedgerProfile,
    createTableProfile,
    createTableProfileForCurrentScope,
    deleteActiveTableProfile,
    ensureChatTableProfiles,
    ensureTableProfileForScope,
    getActiveTableProfile,
    getActiveTableProfileKey,
    getAppliedTableHistoriesForMessage,
    getCurrentCharacterSchemaKey,
    getCurrentCharacterSchemaLabel,
    getScopedTableSchemas,
    getTableProfileLibrary,
    getTableProfileScopeLabel,
    getTableProfilesForScope,
    getTableSchemaLibrary,
    getTableSchemaScopeLabel,
    hasAppliedTableEditForMessage,
    loadActiveTableProfileRows,
    mergeScopedTableSchemasIntoState,
    persistCurrentTableDatabase,
    pushTableUndoSnapshot,
    redoLastTableOperation,
    rollbackLatestTableOperationForChangedMessages,
    rollbackLatestTableOperationForDeletedMessages,
    rollbackTableOperationsForMessages,
    saveCurrentTableProfileRows,
    saveScopedTableSchemas,
    setTableSchemaScope,
    switchTableProfile,
    syncCurrentTableSchemas,
    undoLastTableOperation,
} = tableStateService;

const tableMemoryModel = createTableMemoryModel({
    getState: ensureState,
    formatBlocksForPrompt,
    formatSourceRange,
    getSourceMessageIdsFromBlocks,
    defaultTableEditPrompt,
    getHash,
    parseTableEditOperations,
    getFiniteMessageIds,
    pushTableUndoSnapshot,
    normalizeTableText,
    saveCurrentTableProfileRows,
    updateInjectionFromSummaries: (...args) => updateInjectionFromSummaries(...args),
});
const {
    applyTableOperations,
    buildTableEditPrompt,
    createTableEditDraft,
    formatSpecificTablesForPrompt,
    formatTableDataForPrompt,
    formatTableGuideForPrompt,
    getNextTableIndex,
    getReadonlyTables,
    getTableSchemasForPreset,
    getWritableTables,
    renderInjectedTablesSection,
} = tableMemoryModel;

const tableWorkflowController = createTableWorkflowController({
    getState: ensureState,
    findLatestAssistantTurn: (...args) => findLatestAssistantTurn(...args),
    toastr,
    buildLatestTurnBlocks: (...args) => buildLatestTurnBlocks(...args),
    runGeneration,
    callGenerationModel: (...args) => callGenerationModel(...args),
    buildTableEditPrompt,
    buildTurnReferenceSystemPrompt: (...args) => buildTurnReferenceSystemPrompt(...args),
    createTableEditDraft,
    saveState,
    saveChatConditional,
    renderWorkbenchScope,
    workbenchRenderScopes,
    applyTableOperations,
    formatSourceRange,
    switchWorkbenchTab,
});
const { processLatestTableEdit } = tableWorkflowController;

const tableWorkbenchUi = createTableWorkbenchUi({
    query: $,
    document,
    requestFrame: callback => (
        typeof globalThis.requestAnimationFrame === 'function'
            ? globalThis.requestAnimationFrame(callback)
            : globalThis.setTimeout(callback, 16)
    ),
    getState: ensureState,
    getTableProfilesForScope,
    tableSchemaScopes,
    getActiveTableProfile,
    getTablePromptPresets,
    getSelectedTablePromptPresetId,
    escapeHtml,
    formatSourceRange,
    toastr,
    persistCurrentTableDatabase,
    renderWorkbenchScope,
    workbenchRenderScopes,
    normalizeImportedTablesFromJson,
    confirmDanger,
    parseList,
    getHash,
    getNextTableIndex,
});
const {
    createCustomTableFromUi,
    importTablesFromText,
    renderTableEditDrafts,
    renderTableList,
    renderTablePreviewMarkup,
    renderTableProfileControls,
    renderTablePromptPresetControls,
    saveEditedTableFromElement,
    uiState: tableUiState,
} = tableWorkbenchUi;

const tableEditorEvents = createTableEditorEvents({
    query: $,
    getState: ensureState,
    toastr,
    confirmDanger,
    parseTableEditOperations,
    renderWorkbenchScope,
    workbenchRenderScopes,
    applyTableOperations,
    formatSourceRange,
    saveEditedTableFromElement,
    tableUiState,
    pushTableUndoSnapshot,
    persistCurrentTableDatabase,
    undoLastTableOperation,
    redoLastTableOperation,
    createCustomTableFromUi,
    createBaseStoryLedgerProfile,
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
    setTableSchemaScope,
    readVectorMemoryFieldsFromUi,
    createSharedInlineGenerationConfig,
    createSharedVectorConfig,
    getTableSchemasForPreset,
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
} = configurationService;

const configurationController = createConfigurationController({
    getState: ensureState,
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
    normalizeImportedTablesFromJson,
    findMatchingTable,
    mergeTableSchemaWithRows,
    setTableSchemaScope,
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

const memoryRecordsUi = createMemoryRecordsUi({
    query: $,
    documentRef: document,
    getState: ensureState,
    memoryRecordStatuses,
    blockTypes,
    normalizeSearchText,
    getKindLabel,
    pageSize: 18,
});
const {
    pageState: memoryRecordState,
    renderMemoryDatabaseSummary,
    renderMemoryRecordList,
} = memoryRecordsUi;

const vectorMemoryService = createVectorMemoryService({
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
    scheduleVectorAutoIndex,
} = vectorMemoryService;

const vectorWorkbenchUi = createVectorWorkbenchUi({
    query: $,
    document,
    getState: ensureState,
    defaultVectorMemory,
    unique,
    getVectorQueryText,
    escapeHtml,
    formatSourceRange,
});
const {
    renderVectorHitList,
    renderVectorMemoryPanel,
    renderVectorModelOptions,
    renderVectorQueryModelOptions,
    renderVectorRecallDetails,
    renderVectorRecordList,
    renderVectorResultList,
} = vectorWorkbenchUi;

const vectorActionsController = createVectorActionsController({
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
});
const {
    applyVectorMemorySettings,
    clearVectorMemoryIndex,
    fetchVectorEmbeddingModels,
    fetchVectorQueryModels,
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
    confirm: message => window.confirm(message),
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
    ensureState,
    getActiveEpicMemoryBlocks,
    getMultiSummaryLabel,
    getActiveCoveredStageHashes,
    getStageMemoryBlocks,
    memoryStrategies,
    renderInjectedTablesSection,
    renderVectorMemorySection,
    setExtensionPrompt,
    injectionKey: INJECTION_KEY,
    extensionPromptTypes: extension_prompt_types,
    extensionPromptRoles: extension_prompt_roles,
    defaultState,
    formatTableDataForPrompt,
    formatTableGuideForPrompt,
    formatSpecificTablesForPrompt,
    getReadonlyTables,
    getWritableTables,
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

tableManagementEvents = createTableManagementEvents({
    query: $,
    getState: ensureState,
    tableSchemaScopes,
    getTableProfileScopeLabel,
    confirmDanger,
    renderWorkbenchScope,
    workbenchRenderScopes,
    setTableSchemaScope,
    saveState,
    getTableSchemaScopeLabel,
    toastr,
    switchTableProfile,
    getActiveTableProfile,
    createTableProfileForCurrentScope,
    syncCurrentTableSchemas,
    saveGlobalSettings,
    deleteActiveTableProfile,
    saveCurrentTableProfileRows,
    loadActiveTableProfileRows,
    readTurnSummaryFieldsFromUi,
    syncInlineGenerationPrompts,
    persistSharedConfigurationFromState,
    updateInjectionFromSummaries,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    getSelectedTablePromptPresetId,
    setSelectedTablePromptPresetId,
    getTablePromptPresets,
    renderPromptPresetControls,
    makeTablePromptPreset,
    importTablesFromText,
    getScopedTableSchemas,
});

contentConfigurationEvents = createContentConfigurationEvents({
    query: $,
    navigatorRef: navigator,
    getState: ensureState,
    defaultInjectionTemplate,
    normalizeInjectionMemoryBody,
    syncInjection,
    persistSharedConfigurationFromState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    saveState,
    readPromptFieldsFromUi,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    memoryStrategies,
    updateInjectionFromSummaries,
    workflowModes,
    stageSourceModes,
    scanBlocks: options => scanBakemonoBlocks(options),
    defaultState,
    extensionPromptRoles: extension_prompt_roles,
    renderInjectionContent,
});

automationConfigurationEvents = createAutomationConfigurationEvents({
    query: $,
    documentRef: document,
    getState: ensureState,
    readAutomationFieldsFromUi,
    readCustomApiFieldsFromUi,
    readGenerationTargetSettings: (...args) => summaryTargetController.readGenerationTargetSettings(...args),
    persistSharedConfigurationFromState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    defaultAutomation,
    fetchCustomApiModels: (...args) => generationClient.fetchCustomApiModels(...args),
});

const promptInspector = createPromptInspector({
    getChat: () => chat,
    getItemizedPrompts: () => itemizedPrompts,
    getItemizedParams: (...args) => itemizedParams(...args),
    countTokens: value => overviewTokenManifest.getOverviewTokenCount(value),
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
    getIsBusy: () => isBusy,
    isTaskQueueRunning: () => summaryTaskQueue.isRunning(),
    scanBlocks: options => scanBakemonoBlocks(options),
    updateInjection: () => updateInjectionFromSummaries(),
    saveState,
    renderSettings: status => renderWorkbenchScope(workbenchRenderScopes.SETTINGS, status),
    logWarning: (...args) => console.warn(...args),
    query: $,
});
const {
    bindEvents: bindWorkflowOverviewEvents,
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
    getWorkflowModeLabel,
    getCurrentFloorMemoryIndex,
    getOverviewHealth,
    getActiveTab: () => getActiveWorkbenchTab(),
    renderTokenManifest: state => renderOverviewTokenManifest(state),
});
const { renderOverviewConfigManifest, renderWorkflowGuide } = overviewWorkbenchUi;

const summaryGenerationUi = createSummaryGenerationUi({
    documentRef: document,
    query: $,
    getState: ensureState,
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
    getTableSchemaScopeLabel,
    getCurrentCharacterSchemaLabel,
    renderTableProfileControls,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    renderInlinePromptPresetControls,
    renderTableList,
    renderTableEditDrafts,
});
const { render: renderTurnSummaryPanel } = turnSummaryUi;

const hubAutomationUi = createHubAutomationUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    getCurrentFloorMemoryIndex,
    getInjectionHeaderStatus: state => getWorkbenchInjectionHeaderStatus(state),
    getAppearanceSettings,
    getActiveGlobalConfig,
    getPromptPresets,
    getSelectedPromptPresetId,
    getWorkflowModeLabel,
    getUnsummarizedStoryBlocks,
    defaultAutomation,
    defaultScanRules,
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
    getInjectionMemoryParts,
    renderInjectionContent,
    toastr,
});
const {
    bindPromptEvents,
    renderInjectionOverview,
    renderPromptOverview,
    renderScanOverview,
    renderScanPreview,
} = workbenchPageOverviews;

const generationClient = createGenerationClient({
    query: $,
    ensureState,
    generateRaw,
    normalizeCustomApiBaseUrl,
    getCustomChatCompletionsUrl,
    defaultAutomation,
    fetchImpl: (...args) => fetch(...args),
    readCustomApiFieldsFromUi,
    persistSharedConfigurationFromState,
    toastr,
    getCustomModelsUrl,
    extractCustomModelIds,
    renderCustomModelOptions,
});
const { callGenerationModel, fetchCustomApiModels, readOpenAIStream } = generationClient;

const summaryDraftService = createSummaryDraftService({
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
    confirm: message => window.confirm(message),
});
const {
    clearStuckMissingSummaryTasks,
    clearStuckQueueTasks,
    commitAllMissingSummaryDrafts,
    commitDraft,
    commitMissingSummaryDraft,
    canRemoveScannedSummaryBlock,
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
    removeScannedSummaryBlock,
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
});
const {
    changePage: changeTimelinePage,
    render: renderTimeline,
} = summaryTimelineUi;

const summaryBrowserEvents = createSummaryBrowserEvents({
    query: $,
    getSummaryBrowserActiveType,
    setSummaryBrowserActiveType,
    changeSummaryBrowserPage,
    renderPreviewSections,
    resetSummaryBrowserPages,
    stabilizeMobilePreviewScroll,
    changeTimelinePage,
    renderTimeline,
    memoryRecordState,
    memoryRecordStatuses,
    renderMemoryRecordList,
    saveEditedSummary,
    deleteSavedSummary,
    removeScannedSummaryBlock,
});

const turnProcessingController = createTurnProcessingController({
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
    getAppliedTableHistoriesForMessage,
    saveState,
    rollbackLatestTableOperationForChangedMessages,
    createTableEditDraft,
    applyTableOperations,
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
    processLatestTableEdit,
    hasAppliedTableEditForMessage,
    runGeneration: (...args) => operationFeedback.runGeneration(...args),
    callGenerationModel,
    extractTaggedContent,
    buildTableEditPrompt,
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
    ensureState,
    isBusy: () => isBusy,
    scanBakemonoBlocks,
    getUnsummarizedStoryBlocks,
    getHash,
    saveState,
    defaultAutomation,
    toastr,
    renderWorkbenchScope,
    workbenchRenderScopes,
    generateStageDraft,
    turnProcessingModes,
    processLatestTableEdit,
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
    query: $,
    getState: ensureState,
    defaultGenerationTargets,
    targetSelectionModes,
    persistSharedConfigurationFromState,
    parseLooseNumberRange,
    toastr,
    saveState,
    getIsBusy: () => isBusy,
    generateStageDraft,
    generateStageBatchTasks,
    generateEpicDraft,
    generateEpicBatchTasks,
    confirmDanger,
    getSourceMessageIdsFromBlocks,
    formatSourceRange,
    renderWorkbenchScope,
    workbenchRenderScopes,
});
const {
    chooseEpicGenerationMode,
    chooseStageGenerationMode,
    confirmGenerationTargets,
    getTargetSelectionLabel,
    parseGenerationTargetInput,
    promptGenerationModeSelection,
    promptGenerationTargetSelection,
    readGenerationTargetSettings,
} = summaryTargetController;

const summaryTaskQueue = createSummaryTaskQueue({
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
});
const {
    clearFinishedQueueTasks,
    clearHistoryRecords,
    enqueueSummaryTask,
    processTaskQueue,
    removeQueueTask,
    retryQueueTask,
} = summaryTaskQueue;

const reviewQueueEvents = createReviewQueueEvents({
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
});

workbenchRenderer = createWorkbenchRenderer({
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
    renderMemoryDatabaseSummary,
    renderPromptInspector: () => promptInspector.render(),
    renderHubPanels: renderWorkbenchHubPanels,
    renderSummaryGenerationPanel,
    renderPreviewSections,
    renderMemoryRecordList,
    renderTimeline,
    renderDrafts,
    renderHistory,
    renderTaskQueue,
    renderTurnSummaryPanel,
    renderInjectionOverview,
    renderPromptOverview,
    renderAutomationOverview,
    renderVectorMemoryPanel,
    renderScanOverview,
    renderScanPreview,
    renderCustomModelOptions,
    renderAppearanceSettings,
    renderAutoHideRecentPanel,
    renderMaintenanceOverview,
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
    workbenchRenderScopes,
    scanBakemonoBlocks,
    chooseStageGenerationMode,
    generateStageBatchTasks,
    chooseEpicGenerationMode,
    generateEpicBatchTasks,
    generateBackfillQueue,
    generateBatchSummaryQueue,
    commitAllMissingSummaryDrafts,
    removeMissingSummaryDraftsAndTasks,
    clearStuckQueueTasks,
    clearStuckMissingSummaryTasks,
    readTurnSummaryFieldsFromUi,
    processLatestTurnSummary,
    processLatestTableEdit,
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
    applyVectorMemorySettings,
    buildVectorMemoryIndex,
    testVectorMemoryRetrieval,
    persistVectorMemoryFieldsFromUi,
    fetchVectorEmbeddingModels,
    fetchVectorQueryModels,
    clearVectorMemoryIndex,
    runVisibleOperation,
});
const { getRenderScope: getWorkbenchActionRenderScope, run: runWorkbenchAction } = workbenchActionController;

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
    runWorkbenchAction,
    getWorkbenchActionRenderScope,
    renderWorkbenchScope,
});

function getKindLabel(kind) {
    return getSummaryKindLabel(kind, blockTypes);
}

function bindSettingsEvents() {
    workbenchShellEvents.bind();
    bindArchiveEvents();
    bindWorkflowOverviewEvents();
    reviewQueueEvents.bind();
    summaryBrowserEvents.bind();
    bindSummaryGenerationEvents();
    bindPromptEvents();
    bindMaintenanceEvents();
    tableEditorEvents.bind();
    tableManagementEvents.bind();
    contentConfigurationEvents.bind();
    automationConfigurationEvents.bind();
    vectorActionsController.bind();
    bindPresetEvents();
    bindScanEvents();
}


async function initWorkbench() {
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
    const recovery = summaryRecoveryJournal.reconcile(state, chat);
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
            });
        } catch (error) {
            console.warn('[BakemonoMemory] foreground runtime resume failed', error);
        }
    }, 500);
}

async function init() {
    ensureGlobalSettings();
    const initialState = ensureState();
    reconcileSummaryRecovery(initialState);
    recoverNewerSharedConfigurationFromState(initialState);
    bootstrapSharedConfigurationFromCurrentChat(initialState);
    syncGlobalActiveConfigToState(initialState, { force: true });
    await initWorkbench();
    syncInjection();
    if (ensureState().vectorMemory.enabled) {
        const state = ensureState();
        if (state.vectorMemory.lastIndexedSignature !== getVectorSourceSignature(state)) {
            markVectorIndexDirty('初始化检测到聊天变更', state);
        } else {
            scheduleVectorAutoIndex('初始化');
        }
    }

    scheduleAutoHideRecent('init');

    eventSource.on(event_types.CHAT_CHANGED, () => runChatSwitchFlow({
        getState: ensureState,
        syncConfig: state => {
            recoverNewerSharedConfigurationFromState(state);
            bootstrapSharedConfigurationFromCurrentChat(state);
            return syncGlobalActiveConfigToState(state, { force: true });
        },
        recover: state => reconcileSummaryRecovery(state),
        scheduleAutoHide: scheduleAutoHideRecent,
        markVectorDirty: markVectorIndexDirty,
        syncInjection,
        scheduleRender: scheduleRenderAll,
    }));
    if (event_types.CHAT_LOADED) {
        eventSource.on(event_types.CHAT_LOADED, () => scheduleForegroundRuntimeResume('聊天已载入'));
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
                rollbackLatestTableOperationForChangedMessages(messageIds, ensureState());
                const state = ensureState();
                state.inlineGeneration.lastProcessedMessageId = null;
                state.inlineGeneration.lastProcessedSignature = '';
                scheduleInlineGenerationCapture('消息更新');
            } else {
                rollbackLatestTableOperationForDeletedMessages(messageIds, ensureState());
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
