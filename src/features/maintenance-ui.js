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
    function renderAutoSummaryTransactions(container, state = getState(), options = {}) {
        const transactions = (state.autoSummaryTransactions || [])
            .filter(transaction => transaction.status !== 'rolled_back')
            .slice(0, 8);
        if (!transactions.length) return;

        const panel = documentRef.createElement('div');
        panel.className = 'bakemono-memory-auto-tx-list';
        if (options.showTitle !== false) {
            const title = documentRef.createElement('div');
            title.className = 'bakemono-memory-auto-tx-title';
            title.innerHTML = '<i class="fa-solid fa-shield-halved"></i><strong>自动总结回滚</strong><span>只处理自动保存并自动隐藏的总结</span>';
            panel.append(title);
        }

        for (const transaction of transactions) {
            const item = documentRef.createElement('div');
            item.className = `bakemono-memory-auto-tx-item is-${transaction.status || 'active'}`;
            item.dataset.transactionId = transaction.id;
            const sourceRange = formatSourceRange(transaction.sourceMessageIds || []);
            const hiddenCount = getFiniteMessageIds(transaction.hiddenMessageIds || []).length;
            const invalidIds = getFiniteMessageIds(transaction.invalidatedMessageIds || []);
            item.innerHTML = `
                <div class="bakemono-memory-auto-tx-main">
                    <strong>${escapeHtml(transaction.summaryTitle || getKindLabel(transaction.kind) || '自动总结')}</strong>
                    <span>${transaction.status === 'needs_review' ? '来源楼层已变更' : '已记录'} · ${sourceRange || '未知范围'} · 可恢复 ${hiddenCount} 楼</span>
                    ${invalidIds.length ? `<em>变更楼层：${invalidIds.map(id => `#${id}`).join('、')}</em>` : ''}
                </div>
                <div class="bakemono-memory-task-actions">
                    <button class="menu_button danger" data-bakemono-auto-tx-action="rollback"><i class="fa-solid fa-rotate-left"></i><span>回滚</span></button>
                </div>`;
            panel.append(item);
        }
        container.append(panel);
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
        const coveredCount = (latest?.coveredBlockHashes || []).length + (latest?.coveredStageHashes || []).length;
        const hiddenCount = latestAuto ? getFiniteMessageIds(latestAuto.hiddenMessageIds || []).length : 0;
        const latestTitle = latest?.summary?.title || latest?.draft?.title || (latest ? getKindLabel(latest.kind) : '暂无可撤回记录');
        const impact = [];
        if (latest) {
            impact.push(`${getKindLabel(latest.kind) || '总结'} 1 条`);
            if (sourceIds.length) impact.push(`来源 ${sourceIds.length} 楼`);
            if (coveredCount) impact.push(`覆盖标记 ${coveredCount} 个`);
            if (hiddenCount) impact.push(`可恢复 ${hiddenCount} 楼`);
        }
        query('#bakemono-memory-maintenance-latest-title').text(latestTitle);
        query('#bakemono-memory-maintenance-latest-impact').text(latest
            ? `影响：${impact.join('、')}。撤回前仍会再次确认。`
            : '保存阶段总结或多次总结后，这里会先列出影响范围。');
        query('#bakemono-memory-maintenance-undo')
            .prop('disabled', !latest)
            .attr('title', latest ? `撤回“${latestTitle}”` : '暂无可撤回记录');
        query('#bakemono-memory-maintenance-hidden-count').text(getActualHiddenMessageIds().length.toLocaleString());
        query('#bakemono-memory-maintenance-task-count').text((state.taskQueue || []).length.toLocaleString());
        query('#bakemono-memory-maintenance-snapshot-count').text((state.tableDatabase?.undoStack || []).length.toLocaleString());
        query('#bakemono-memory-maintenance-auto-count').text(`${autoTransactions.length.toLocaleString()} 条`);

        const autoContainer = documentRef.querySelector('#bakemono-memory-maintenance-auto-transactions');
        if (autoContainer) {
            autoContainer.innerHTML = '';
            renderAutoSummaryTransactions(autoContainer, state, { showTitle: false });
            if (!autoContainer.childElementCount) {
                const empty = documentRef.createElement('div');
                empty.className = 'bakemono-memory-maintenance-empty';
                empty.innerHTML = '<i class="fa-solid fa-shield-heart"></i><span><strong>暂无待处理事务</strong><small>自动保存并隐藏楼层后，可回滚记录会出现在这里。</small></span>';
                autoContainer.append(empty);
            }
        }

        const recordContainer = documentRef.querySelector('#bakemono-memory-maintenance-records');
        if (!recordContainer) return;
        recordContainer.innerHTML = '';
        const summaryRecords = (state.history || []).map(item => ({
            type: 'summary',
            title: item.summary?.title || item.draft?.title || getKindLabel(item.kind) || '总结保存',
            meta: `${getKindLabel(item.kind) || '总结'} · 已保存到长期记忆`,
            createdAt: item.createdAt,
            icon: 'fa-solid fa-floppy-disk',
        }));
        const tableRecords = (state.tableDatabase?.history || []).map(item => ({
            type: 'table',
            title: item.title || item.label || '表格记忆已更新',
            meta: '表格事务 · 已保留撤回快照',
            createdAt: item.appliedAt || item.createdAt,
            icon: 'fa-solid fa-table',
        }));
        const rollbackRecords = (state.tableDatabase?.rollbackHistory || []).map(item => ({
            type: 'rollback',
            title: item.reason || '表格事务已回滚',
            meta: `${(item.rollbackSnapshotIds || []).length} 个快照 · ${(item.sourceMessageIds || []).length} 个来源楼层`,
            createdAt: item.createdAt || item.rolledBackAt,
            icon: 'fa-solid fa-rotate-left',
        }));
        const records = [...summaryRecords, ...tableRecords, ...rollbackRecords]
            .sort((a, b) => getRecordTimestamp(b) - getRecordTimestamp(a))
            .slice(0, 10);
        if (!records.length) {
            const empty = documentRef.createElement('div');
            empty.className = 'bakemono-memory-maintenance-empty is-quiet';
            empty.innerHTML = '<i class="fa-solid fa-receipt"></i><span><strong>还没有操作记录</strong><small>保存总结、应用表格或回滚事务后会留下足迹。</small></span>';
            recordContainer.append(empty);
            return;
        }
        const fragment = documentRef.createDocumentFragment();
        records.forEach(record => {
            const row = documentRef.createElement('article');
            row.className = `bakemono-memory-maintenance-record is-${record.type}`;
            const time = record.createdAt ? new Date(record.createdAt).toLocaleString() : '时间未记录';
            row.innerHTML = `<span class="bakemono-memory-maintenance-record-icon"><i class="${record.icon}"></i></span><span class="bakemono-memory-maintenance-record-copy"><strong>${escapeHtml(record.title)}</strong><small>${escapeHtml(record.meta)}</small></span><time>${escapeHtml(time)}</time>`;
            fragment.append(row);
        });
        recordContainer.append(fragment);
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
