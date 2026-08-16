export function readActiveConfig(settings) {
    const config = settings?.activeConfig;
    return config && typeof config === 'object' ? config : null;
}

export const sharedConfigVersion = 1;

export function shouldBootstrapSharedConfig(settings, hasActiveChat) {
    if (!hasActiveChat) {
        return false;
    }
    return Number(settings?.sharedConfigVersion || 0) < sharedConfigVersion;
}

export const vectorRuntimeFieldNames = Object.freeze([
    'records',
    'embeddingCache',
    'lastHits',
    'lastQuery',
    'lastQueries',
    'lastRewriteIntent',
    'lastEmbeddingCandidates',
    'lastRerankCandidates',
    'lastRecallSkippedReason',
    'lastIndexAt',
    'lastIndexedSignature',
    'estimatedChars',
    'trimmedHitCount',
    'dirty',
    'dirtyReason',
]);

export const inlineGenerationRuntimeFieldNames = Object.freeze([
    'lastProcessedMessageId',
    'lastProcessedSignature',
    'hideTableEditMigratedToRegex',
]);

export const automationApiFieldNames = Object.freeze([
    'apiProvider',
    'customApi',
]);

function cloneObject(value) {
    return value && typeof value === 'object' ? structuredClone(value) : {};
}

function omitFields(value, fieldNames) {
    const result = cloneObject(value);
    for (const field of fieldNames) {
        delete result[field];
    }
    return result;
}

function mergeWithRuntime(current, shared, defaults, fieldNames) {
    const currentValue = cloneObject(current);
    const result = {
        ...cloneObject(defaults),
        ...cloneObject(shared),
    };
    for (const field of fieldNames) {
        if (Object.hasOwn(currentValue, field)) {
            result[field] = structuredClone(currentValue[field]);
        }
    }
    return result;
}

export function createSharedVectorConfig(vectorMemory) {
    return omitFields(vectorMemory, vectorRuntimeFieldNames);
}

export function mergeSharedVectorConfig(currentVectorMemory, sharedVectorConfig, defaults = {}) {
    return mergeWithRuntime(currentVectorMemory, sharedVectorConfig, defaults, vectorRuntimeFieldNames);
}

export function createSharedInlineGenerationConfig(inlineGeneration) {
    return omitFields(inlineGeneration, inlineGenerationRuntimeFieldNames);
}

export function mergeSharedInlineGenerationConfig(currentInlineGeneration, sharedInlineGeneration, defaults = {}) {
    return mergeWithRuntime(currentInlineGeneration, sharedInlineGeneration, defaults, inlineGenerationRuntimeFieldNames);
}

export function createAutomationBehaviorConfig(automation) {
    return omitFields(automation, automationApiFieldNames);
}

export function mergeAutomationBehaviorConfig(currentAutomation, behaviorConfig, defaults = {}) {
    const current = cloneObject(currentAutomation);
    const result = {
        ...cloneObject(defaults),
        ...cloneObject(behaviorConfig),
    };
    for (const field of automationApiFieldNames) {
        if (Object.hasOwn(current, field)) {
            result[field] = structuredClone(current[field]);
        }
    }
    return result;
}

export function getActiveConfigSignature(config) {
    if (!config || typeof config !== 'object') {
        return '';
    }
    return `${String(config.id || '')}|${String(config.updatedAt || '')}`;
}

function readSignatureParts(signature) {
    const [id = '', ...timestampParts] = String(signature || '').split('|');
    return { id, updatedAt: timestampParts.join('|') };
}

export function isStateConfigNewerThanActive(state, config) {
    if (!state || !config || typeof config !== 'object') {
        return false;
    }
    const stateSignature = readSignatureParts(state.activeConfigSignature);
    const configId = String(config.id || '');
    const stateConfigId = String(state.activeConfigId || '');
    const isSharedRecovery = stateSignature.id === 'bakemono-shared-settings'
        && stateConfigId === stateSignature.id;
    if (!stateSignature.id || stateConfigId !== stateSignature.id || (stateSignature.id !== configId && !isSharedRecovery)) {
        return false;
    }
    const stateTime = Date.parse(stateSignature.updatedAt);
    const configTime = Date.parse(String(config.updatedAt || ''));
    return Number.isFinite(stateTime) && (!Number.isFinite(configTime) || stateTime > configTime);
}

export function shouldSyncActiveConfig(state, config, options = {}) {
    if (!config || typeof config !== 'object') {
        return false;
    }
    return options.force === true || state?.activeConfigSignature !== getActiveConfigSignature(config);
}

export function markActiveConfigApplied(state, config) {
    if (!state || typeof state !== 'object') {
        return state;
    }
    state.configInitialized = true;
    state.activeConfigId = config?.id || '';
    state.activeConfigSignature = getActiveConfigSignature(config);
    return state;
}
