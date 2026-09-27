export function createMaintenanceUi({
    documentRef,
    query,
    getState,
    getActualHiddenMessageIds,
    getFiniteMessageIds,
    formatSourceRange,
    getKindLabel,
    unique,
    escapeHtml,
    BlobCtor,
    urlApi,
    notifySuccess,
}) {
    // One row per automatic save that can still be rolled back; a changed source floor is marked.
    function renderAutoSummaryTransactions(container, state = getState()) {
        const transactions = (state.autoSummaryTransactions || [])
            .filter(transaction => transaction.status !== 'rolled_back')
            .slice(0, 8);
        container.innerHTML = transactions.map(transaction => {
            const sourceRange = formatSourceRange(transaction.sourceMessageIds || []);
            const hiddenCount = getFiniteMessageIds(transaction.hiddenMessageIds || []).length;
            const invalidIds = getFiniteMessageIds(transaction.invalidatedMessageIds || []);
            const changed = transaction.status === 'needs_review';
            return `<div class="bakemono-memory-auto-tx-item bk-mnt-tx${changed ? ' is-changed' : ''}" data-transaction-id="${escapeHtml(transaction.id)}">
                <strong>${escapeHtml(transaction.summaryTitle || getKindLabel(transaction.kind) || '自动总结')}</strong>
                <small>${escapeHtml([sourceRange ? `第 ${sourceRange} 楼` : '', hiddenCount ? `可恢复 ${hiddenCount} 楼` : ''].filter(Boolean).join(' · ') || '范围未记录')}</small>
                ${changed ? `<small class="bk-mnt-warn">来源楼层变了${invalidIds.length ? '：' + escapeHtml(invalidIds.map(id => `#${id}`).join('、')) : ''}</small>` : ''}
                <button type="button" class="bk-sum-link is-alert" data-bakemono-auto-tx-action="rollback">回滚…</button>
            </div>`;
        }).join('') || '<p class="bk-mnt-empty">没有可回滚的自动保存。</p>';
        return transactions.length;
    }

    function getRecordTimestamp(item = {}) {
        const value = item.createdAt || item.appliedAt || item.rolledBackAt || item.undoneAt || '';
        const timestamp = value ? new Date(value).getTime() : 0;
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function renderOverview(state = getState()) {
        const latest = state.history?.[0] || null;
        const autoTransactions = (state.autoSummaryTransactions || []).filter(item => item.status !== 'rolled_back');
        const latestAuto = latest ? autoTransactions.find(item => item.summaryHash === latest.summaryHash) : null;
        const sourceIds = unique(getFiniteMessageIds([
            ...(latest?.summary?.sourceMessageIds || []),
            ...(latest?.draft?.sourceMessageIds || []),
        ]));
        const hiddenCount = latestAuto ? getFiniteMessageIds(latestAuto.hiddenMessageIds || []).length : 0;
        const latestTitle = latest?.summary?.title || latest?.draft?.title || (latest ? getKindLabel(latest.kind) : '');
        query('#bakemono-memory-maintenance-latest-title').text(latest ? latestTitle || '上一次保存' : '没有可以撤回的保存');
        query('#bakemono-memory-maintenance-latest-impact').text(latest
            ? [getKindLabel(latest.kind) || '总结', sourceIds.length ? `来源 ${sourceIds.length} 楼` : '', hiddenCount ? `可恢复 ${hiddenCount} 楼` : ''].filter(Boolean).join(' · ')
            : '');
        query('#bakemono-memory-maintenance-undo').prop('hidden', !latest).prop('disabled', !latest)
            .attr('title', latest ? `撤回“${latestTitle}”，撤回前会列出影响范围` : '');
        query('#bakemono-memory-maintenance-hidden-count').text(getActualHiddenMessageIds().length.toLocaleString());
        query('#bakemono-memory-maintenance-task-count').text((state.taskQueue || []).length.toLocaleString());
        query('#bakemono-memory-maintenance-snapshot-count').text((state.tableDatabase?.undoStack || []).length.toLocaleString());
        query('#bakemono-memory-maintenance-auto-count').text(`${autoTransactions.length.toLocaleString()} 条`);

        const autoContainer = documentRef.querySelector('#bakemono-memory-maintenance-auto-transactions');
        if (autoContainer) renderAutoSummaryTransactions(autoContainer, state);

        const recordContainer = documentRef.querySelector('#bakemono-memory-maintenance-records');
        if (!recordContainer) return;
        // The dot's colour says what kind of record it is: saved summary, table change or a rollback.
        const records = [
            ...(state.history || []).map(item => ({ type: 'summary', createdAt: item.createdAt,
                title: item.summary?.title || item.draft?.title || getKindLabel(item.kind) || '总结保存', meta: `${getKindLabel(item.kind) || '总结'} · 已保存` })),
            ...(state.tableDatabase?.history || []).map(item => ({ type: 'table', createdAt: item.appliedAt || item.createdAt,
                title: item.title || item.label || '表格已更新', meta: '表格 · 可撤回' })),
            ...(state.tableDatabase?.rollbackHistory || []).map(item => ({ type: 'rollback', createdAt: item.createdAt || item.rolledBackAt,
                title: item.reason || '已回滚', meta: `${(item.rollbackSnapshotIds || []).length} 个快照 · ${(item.sourceMessageIds || []).length} 个来源楼层` })),
        ].sort((a, b) => getRecordTimestamp(b) - getRecordTimestamp(a)).slice(0, 10);
        recordContainer.innerHTML = records.map(record => `<li class="is-${record.type}"><time>${escapeHtml(record.createdAt ? new Date(record.createdAt).toLocaleString() : '时间未记录')}</time><strong>${escapeHtml(record.title)}</strong><small>${escapeHtml(record.meta)}</small></li>`).join('')
            || '<li class="is-empty"><small>还没有记录。保存总结、应用表格或回滚后会出现在这里。</small></li>';
    }

    function exportTransactions(state = getState()) {
        const payload = {
            exportedAt: new Date().toISOString(),
            summaryHistory: state.history || [],
            autoSummaryTransactions: state.autoSummaryTransactions || [],
            tableUndoStack: state.tableDatabase?.undoStack || [],
            tableRollbackHistory: state.tableDatabase?.rollbackHistory || [],
            hiddenMessageIds: getActualHiddenMessageIds(),
            taskQueue: state.taskQueue || [],
        };
        const blob = new BlobCtor([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = urlApi.createObjectURL(blob);
        const link = documentRef.createElement('a');
        link.href = url;
        link.download = `bakemono-transactions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        documentRef.body.append(link);
        link.click();
        link.remove();
        urlApi.revokeObjectURL(url);
        notifySuccess('事务记录已导出。');
    }

    function bindEvents() {
        query('#bakemono-memory-export-maintenance').off('click').on('click', () => exportTransactions());
    }

    return { bindEvents, exportTransactions, renderAutoSummaryTransactions, renderOverview };
}
