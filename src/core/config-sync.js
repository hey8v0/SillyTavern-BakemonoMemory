export function readActiveConfig(settings) {
    const config = settings?.activeConfig;
    return config && typeof config === 'object' ? config : null;
}

export function getActiveConfigSignature(config) {
    if (!config || typeof config !== 'object') {
        return '';
    }
    return `${String(config.id || '')}|${String(config.updatedAt || '')}`;
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
