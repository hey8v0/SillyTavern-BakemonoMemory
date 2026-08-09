export function fillMissingDefaults(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        if (target[key] === undefined) {
            target[key] = structuredClone(value);
        }
    }
    return target;
}

export function ensureObjectField(target, key, defaultValue) {
    const current = target[key];
    if (!current || typeof current !== 'object') {
        target[key] = structuredClone(defaultValue);
    }
    return target[key];
}

export function normalizeArrayFields(target, keys = []) {
    for (const key of keys) {
        target[key] = Array.isArray(target[key]) ? target[key] : [];
    }
    return target;
}
