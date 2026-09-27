export function createMemoryRecordsUi({
    query,
    documentRef,
    getState,
    memoryRecordStatuses,
    blockTypes,
    normalizeSearchText,
    getKindLabel,
}) {

    function getMemoryRecordStatusLabel(status) {
        return {
            [memoryRecordStatuses.SOURCE]: '可总结',
            [memoryRecordStatuses.COVERED]: '已覆盖',
            [memoryRecordStatuses.SAVED]: '已保存',
            [memoryRecordStatuses.INJECTED]: '已选入',
            stale: '需重建',
            [memoryRecordStatuses.ARCHIVED]: '已归档',
            [memoryRecordStatuses.DRAFT]: '草稿',
        }[status] || '未知';
    }

    function getMemoryDatabaseStats(state = getState()) {
        const records = state.memoryRecords || [];
        const byStatus = Object.fromEntries(Object.values(memoryRecordStatuses).map(status => [status, 0]));
        const byKind = {
            [blockTypes.STORY]: 0,
            [blockTypes.STAGE]: 0,
            [blockTypes.EPIC]: 0,
        };
        for (const record of records) {
            if (byStatus[record.status] !== undefined) {
                byStatus[record.status] += 1;
            }
            if (byKind[record.kind] !== undefined) {
                byKind[record.kind] += 1;
            }
        }
        return {
            total: records.length,
            byStatus,
            byKind,
            active: byStatus[memoryRecordStatuses.SOURCE] + byStatus[memoryRecordStatuses.SAVED] + byStatus[memoryRecordStatuses.INJECTED],
            queued: state.taskQueue.filter(task => task.status === 'queued').length,
            running: state.taskQueue.filter(task => task.status === 'running').length,
            failed: state.taskQueue.filter(task => task.status === 'failed').length,
        };
    }

    function renderMemoryDatabaseSummary(state = getState()) {
        const stats = getMemoryDatabaseStats(state);
        query('#bakemono-memory-count-records').text(stats.total);
        query('#bakemono-memory-database-total').text(stats.total);
        query('#bakemono-memory-database-active').text(stats.active);
        query('#bakemono-memory-database-injected').text(stats.byStatus[memoryRecordStatuses.INJECTED] || 0);
        query('#bakemono-memory-database-drafts').text(stats.byStatus[memoryRecordStatuses.DRAFT] || 0);
        query('#bakemono-memory-database-queue').text(`${stats.running}/${stats.queued}/${stats.failed}`);

        // Kind counts already head this panel; the line adds only what the grid does not show.
        const description = [
            `已覆盖 ${stats.byStatus[memoryRecordStatuses.COVERED] || 0}`,
            `已归档 ${stats.byStatus[memoryRecordStatuses.ARCHIVED] || 0}`,
        ].join(' · ');
        query('#bakemono-memory-database-description').text(description);
    }

    return {
        getMemoryDatabaseStats,
        getMemoryRecordStatusLabel,
        renderMemoryDatabaseSummary,
    };
}
