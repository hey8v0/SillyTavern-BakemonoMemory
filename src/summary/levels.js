export function getSummaryLevel(item) {
    const explicit = Number(item?.level ?? item?.metadata?.level);
    if (Number.isFinite(explicit)) return Math.max(0, explicit);
    if (item?.type === 'epic' || item?.kind === 'epic') return 2;
    if (item?.type === 'stage' || item?.kind === 'stage') return 1;
    return 0;
}

export function getNextMultiSummaryLevel(targets = []) {
    const maxLevel = targets.reduce((max, block) => Math.max(max, getSummaryLevel(block)), 1);
    return Math.max(2, maxLevel + 1);
}

export function getMultiSummaryLabel(levelOrItem = 2) {
    const level = typeof levelOrItem === 'number' ? levelOrItem : getSummaryLevel(levelOrItem);
    if (level <= 2) return '多次总结';
    if (level === 3) return '长期总览';
    return `长期总览 L${level}`;
}

export function getSummaryKindLabel(kind, blockTypes) {
    if (kind === blockTypes.STORY) return '剧情摘要';
    if (kind === blockTypes.EPIC) return '多次总结';
    return '阶段总结';
}
