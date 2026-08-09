export function getFiniteMessageIds(ids = []) {
    return (ids || [])
        .map(id => Number(id))
        .filter(id => Number.isFinite(id) && id < Number.MAX_SAFE_INTEGER);
}

export function getSourceMessageIdsFromBlocks(blocks = []) {
    return [...new Set(blocks.flatMap(block => (
        getFiniteMessageIds([block?.messageId, ...(block?.sourceMessageIds || [])])
    )))];
}

export function getSourceStart(ids = []) {
    const finite = getFiniteMessageIds(ids);
    return finite.length ? Math.min(...finite) : Number.MAX_SAFE_INTEGER;
}

export function getSourceEnd(ids = []) {
    const finite = getFiniteMessageIds(ids);
    return finite.length ? Math.max(...finite) : Number.MAX_SAFE_INTEGER;
}

export function formatSourceRange(ids = []) {
    const start = getSourceStart(ids);
    const end = getSourceEnd(ids);
    if (!Number.isFinite(start) || start >= Number.MAX_SAFE_INTEGER) {
        return '来源楼层未知';
    }
    return start === end ? `楼层 ${start}` : `楼层 ${start}-${end}`;
}

export function getBlockSortKey(block) {
    const direct = Number(block?.messageId);
    if (Number.isFinite(direct) && direct < Number.MAX_SAFE_INTEGER) {
        return direct;
    }
    const sourceStart = getSourceStart(block?.sourceMessageIds || []);
    return Number.isFinite(sourceStart) ? sourceStart : Number.MAX_SAFE_INTEGER;
}

export function getSummarySortKey(summary) {
    const explicit = Number(summary?.sourceSortKey);
    if (Number.isFinite(explicit)) {
        return explicit;
    }
    return getBlockSortKey(summary);
}

export function sortSummariesBySource(summaries = []) {
    return summaries.sort((a, b) => (
        getSummarySortKey(a) - getSummarySortKey(b)
        || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
        || String(a.hash || '').localeCompare(String(b.hash || ''))
    ));
}
