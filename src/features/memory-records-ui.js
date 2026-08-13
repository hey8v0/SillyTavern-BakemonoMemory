export function createMemoryRecordsUi({
    query,
    documentRef,
    getState,
    memoryRecordStatuses,
    blockTypes,
    normalizeSearchText,
    getKindLabel,
    pageSize = 18,
}) {
    const pageState = { page: 0 };

    function getMemoryRecordStatusLabel(status) {
        return {
            [memoryRecordStatuses.SOURCE]: '可总结',
            [memoryRecordStatuses.COVERED]: '已覆盖',
            [memoryRecordStatuses.SAVED]: '已保存',
            [memoryRecordStatuses.INJECTED]: '注入中',
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
        query('#bakemono-memory-record-stat-total').text(stats.total);
        query('#bakemono-memory-record-stat-injected').text(stats.byStatus[memoryRecordStatuses.INJECTED] || 0);
        query('#bakemono-memory-record-stat-archived').text(stats.byStatus[memoryRecordStatuses.ARCHIVED] || 0);

        const description = [
            `剧情摘要 ${stats.byKind[blockTypes.STORY] || 0}`,
            `阶段总结 ${stats.byKind[blockTypes.STAGE] || 0}`,
            `多次总结 ${stats.byKind[blockTypes.EPIC] || 0}`,
            `已覆盖 ${stats.byStatus[memoryRecordStatuses.COVERED] || 0}`,
            `已归档 ${stats.byStatus[memoryRecordStatuses.ARCHIVED] || 0}`,
        ].join(' · ');
        query('#bakemono-memory-database-description').text(description);
    }

    function getFilteredMemoryRecords(state = getState()) {
        const searchQuery = normalizeSearchText(query('#bakemono-memory-record-filter').val() || '');
        const kind = String(query('#bakemono-memory-record-kind').val() || 'all');
        const status = String(query('#bakemono-memory-record-status').val() || 'all');
        const records = state.memoryRecords || [];
        return records.filter(record => {
            if (kind !== 'all' && record.kind !== kind) {
                return false;
            }
            if (status !== 'all' && record.status !== status) {
                return false;
            }
            if (!searchQuery) {
                return true;
            }
            const text = normalizeSearchText([
                record.title,
                record.sourceRange,
                record.source,
                getKindLabel(record.kind),
                getMemoryRecordStatusLabel(record.status),
                record.hash,
            ].join('\n'));
            return text.includes(searchQuery);
        });
    }

    function createMemoryRecordPager(start, total, pageCount) {
        const controls = documentRef.createElement('div');
        controls.className = 'bakemono-memory-preview-pager bakemono-memory-record-pager';
        const prev = documentRef.createElement('button');
        prev.type = 'button';
        prev.className = 'menu_button bakemono-preview-page-button';
        prev.dataset.bakemonoRecordPage = 'prev';
        prev.disabled = pageState.page <= 0;
        prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i><span>上一页</span>';
        const info = documentRef.createElement('span');
        info.className = 'bakemono-memory-preview-page-info';
        info.textContent = `${total ? start + 1 : 0}-${Math.min(start + pageSize, total)} / ${total}`;
        const next = documentRef.createElement('button');
        next.type = 'button';
        next.className = 'menu_button bakemono-preview-page-button';
        next.dataset.bakemonoRecordPage = 'next';
        next.disabled = pageState.page >= pageCount - 1;
        next.innerHTML = '<span>下一页</span><i class="fa-solid fa-chevron-right"></i>';
        controls.append(prev, info, next);
        return controls;
    }

    function renderMemoryRecordList() {
        const container = documentRef.querySelector('#bakemono-memory-record-list');
        if (!container) {
            return;
        }

        const state = getState();
        const records = getFilteredMemoryRecords(state).sort((a, b) => {
            const kindPriority = { [blockTypes.EPIC]: 0, [blockTypes.STAGE]: 1, [blockTypes.STORY]: 2 };
            return (kindPriority[a.kind] ?? 9) - (kindPriority[b.kind] ?? 9)
                || Number(a.sortKey ?? Number.MAX_SAFE_INTEGER) - Number(b.sortKey ?? Number.MAX_SAFE_INTEGER)
                || String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
        });
        container.innerHTML = '';
        const activeStatus = String(query('#bakemono-memory-record-status').val() || 'all');
        documentRef.querySelectorAll('[data-bakemono-record-status]').forEach(button => {
            button.classList.toggle('is-active', button.dataset.bakemonoRecordStatus === activeStatus);
        });
        query('#bakemono-memory-record-result-count').text(`${records.length} 条`);

        if (!records.length) {
            const empty = documentRef.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无匹配的记忆记录。';
            container.append(empty);
            return;
        }

        const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
        pageState.page = Math.min(Math.max(0, pageState.page || 0), pageCount - 1);
        const start = pageState.page * pageSize;
        const visibleRecords = records.slice(start, start + pageSize);
        const pager = createMemoryRecordPager(start, records.length, pageCount);

        const fragment = documentRef.createDocumentFragment();
        visibleRecords.forEach((record, visibleIndex) => {
            const row = documentRef.createElement('article');
            row.className = `bakemono-memory-record-item is-${record.status || 'source'}`;

            const marker = documentRef.createElement('span');
            marker.className = `bakemono-memory-record-index is-${record.kind || 'story'}`;
            marker.textContent = record.kind === blockTypes.EPIC ? 'E' : record.kind === blockTypes.STAGE ? 'S' : '#';
            marker.title = `${getKindLabel(record.kind)} · 第 ${start + visibleIndex + 1} 条`;

            const main = documentRef.createElement('div');
            main.className = 'bakemono-memory-record-main';
            const title = documentRef.createElement('strong');
            title.textContent = record.title || '未命名记忆';
            const meta = documentRef.createElement('span');
            meta.textContent = [
                getKindLabel(record.kind),
                record.sourceRange || '来源未知',
                record.source || '',
                record.contentLength ? `${record.contentLength} 字` : '',
            ].filter(Boolean).join(' · ');
            main.append(title, meta);

            const chips = documentRef.createElement('div');
            chips.className = 'bakemono-memory-record-chips';
            const statusChip = documentRef.createElement('span');
            statusChip.className = `bakemono-memory-record-chip is-${record.status || 'source'}`;
            statusChip.textContent = getMemoryRecordStatusLabel(record.status);
            chips.append(statusChip);
            const coverCount = (record.sourceHashes || []).length + (record.sourceStageHashes || []).length;
            if (coverCount) {
                const sourceChip = documentRef.createElement('span');
                sourceChip.className = 'bakemono-memory-record-chip';
                sourceChip.textContent = `覆盖 ${coverCount}`;
                chips.append(sourceChip);
            }

            row.append(marker, main, chips);
            fragment.append(row);
        });
        container.append(fragment, pager);
    }

    return {
        getFilteredMemoryRecords,
        getMemoryDatabaseStats,
        getMemoryRecordStatusLabel,
        pageState,
        renderMemoryDatabaseSummary,
        renderMemoryRecordList,
    };
}
