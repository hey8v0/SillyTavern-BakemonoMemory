export function unique(values = []) {
    return [...new Set(values)];
}

export function dedupeByHash(values = []) {
    return [...new Map(values.map(value => [value.hash, value])).values()];
}
