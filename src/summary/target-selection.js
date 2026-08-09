export const targetSelectionModes = {
    ALL: 'all',
    OLDEST: 'oldest',
    RANGE: 'range',
};

export const defaultGenerationTargets = {
    stage: {
        mode: targetSelectionModes.ALL,
        count: 20,
        range: '',
    },
    epic: {
        mode: targetSelectionModes.ALL,
        count: 5,
        range: '',
    },
};

export function getSortedTargetBlocks(blocks = []) {
    return [...blocks].sort((a, b) => (
        getBlockSortKey(a) - getBlockSortKey(b)
        || a.blockIndex - b.blockIndex
    ));
}

export function parseLooseNumberRange(value) {
    const ids = new Set();
    const invalid = [];
    for (const rawPart of String(value || '').split(/[,，\s]+/).map(item => item.trim()).filter(Boolean)) {
        const match = rawPart.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!match) {
            invalid.push(rawPart);
            continue;
        }
        let start = Number(match[1]);
        let end = Number(match[2] || match[1]);
        if (start > end) {
            [start, end] = [end, start];
        }
        for (let id = Math.max(0, start); id <= end; id++) {
            ids.add(id);
        }
    }
    return { ids, invalid };
}

export function blockTouchesRange(block, ids) {
    const sourceIds = getFiniteMessageIds([block?.messageId, ...(block?.sourceMessageIds || [])]);
    return sourceIds.some(id => ids.has(id));
}

export function selectGenerationTargets(blocks = [], config = {}) {
    const sorted = getSortedTargetBlocks(blocks);
    const mode = Object.values(targetSelectionModes).includes(config.mode) ? config.mode : targetSelectionModes.ALL;
    if (mode === targetSelectionModes.OLDEST) {
        const count = Math.max(1, Number(config.count || 1));
        return sorted.slice(0, count);
    }
    if (mode === targetSelectionModes.RANGE) {
        const { ids } = parseLooseNumberRange(config.range || '');
        if (!ids.size) {
            return sorted;
        }
        return sorted.filter(block => blockTouchesRange(block, ids));
    }
    return sorted;
}

export function partitionGenerationTargets(blocks = [], kind = 'stage', config = {}) {
    const sorted = getSortedTargetBlocks(blocks);
    const mode = Object.values(targetSelectionModes).includes(config.mode) ? config.mode : targetSelectionModes.ALL;
    if (mode === targetSelectionModes.OLDEST) {
        return [selectGenerationTargets(sorted, config)].filter(batch => batch.length);
    }

    const pool = mode === targetSelectionModes.RANGE ? selectGenerationTargets(sorted, config) : sorted;
    const defaultCount = defaultGenerationTargets[kind]?.count || (kind === 'epic' ? 5 : 20);
    const batchSize = Math.max(1, Number(config.count || defaultCount));
    const batches = [];
    for (let index = 0; index < pool.length; index += batchSize) {
        batches.push(pool.slice(index, index + batchSize));
    }
    return batches.filter(batch => batch.length);
}
import { getBlockSortKey, getFiniteMessageIds } from './source-metadata.js';
