export function createTableEditorEvents({
    query,
    getState,
    toastr,
    confirmDanger,
    parseTableEditOperations,
    renderWorkbenchScope,
    workbenchRenderScopes,
    applyTableOperations,
    formatSourceRange,
    saveEditedTableFromElement,
    tableUiState,
    pushTableUndoSnapshot,
    persistCurrentTableDatabase,
    undoLastTableOperation,
    redoLastTableOperation,
    createCustomTableFromUi,
    createBaseStoryLedgerProfile,
} = {}) {
    function bind(rootSelector = '#bakemono-workbench-root') {
        const root = query(rootSelector);
        root.off('click.bakemonoTableDraftAction').on('click.bakemonoTableDraftAction', '[data-bakemono-table-draft-action]', function (event) {
            event.preventDefault();
            event.stopPropagation();
            const card = this.closest('.bakemono-memory-table-draft-card');
            const draftId = card?.dataset.tableDraftId;
            const state = getState();
            const draft = state.tableDatabase.editDrafts.find(item => item.id === draftId);
            if (!draft) {
                toastr.warning('没有找到这个表格草稿。');
                return;
            }
            const action = this.dataset.bakemonoTableDraftAction;
            if (action === 'discard') {
                if (!confirmDanger('丢弃表格修改草稿？', ['草稿丢弃后不会修改表格。'])) return;
                state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draftId);
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格草稿已丢弃。');
                return;
            }
            const raw = String(card.querySelector('.bakemono-memory-table-draft-editor')?.value || draft.raw || '');
            try {
                draft.raw = raw;
                draft.operations = parseTableEditOperations(raw);
            } catch (error) {
                toastr.error(`重新解析失败：${error?.message || error}`);
                return;
            }
            if (action === 'reparse') {
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, `已重新解析：${draft.operations.length} 项操作。`);
                return;
            }
            if (action !== 'apply' || !confirmDanger(
                `应用 ${draft.operations.length} 项表格修改？`,
                ['这会修改当前聊天的表格数据库。应用后可以从导出数据中查看结果。'],
            )) return;
            try {
                const undoSnapshot = applyTableOperations(draft.operations, state, {
                    sourceMessageIds: draft.sourceMessageIds,
                    undoLabel: `手动应用表格草稿：${formatSourceRange(draft.sourceMessageIds || [])}`,
                });
                state.tableDatabase.history.unshift({ ...draft, appliedAt: new Date().toISOString(), undoSnapshotId: undoSnapshot?.id || '' });
                state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draftId);
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格修改已应用。');
                toastr.success('表格修改已应用。');
            } catch (error) {
                toastr.error(`应用失败：${error?.message || error}`);
            }
        });

        root.off('click.bakemonoTableAction').on('click.bakemonoTableAction', '[data-bakemono-table-action]', function (event) {
            event.preventDefault();
            event.stopPropagation();
            const details = this.closest('.bakemono-memory-table-item');
            const action = this.dataset.bakemonoTableAction;
            if (!details) return;
            tableUiState.openTableIndex = String(details.dataset.tableIndex || '');
            if (action === 'add-row') {
                const state = getState();
                const table = saveEditedTableFromElement(details, { render: false, persist: false, state });
                if (!table) return;
                pushTableUndoSnapshot(`新增数据行：${table.name || table.tableIndex}`, state);
                table.rows = Array.isArray(table.rows) ? table.rows : [];
                const newRowIndex = table.rows.length;
                table.rows.push(table.columns.map(() => ''));
                tableUiState.openTableIndex = String(table.tableIndex);
                tableUiState.openSection = 'rows';
                tableUiState.focusCell = { tableIndex: String(table.tableIndex), rowIndex: String(newRowIndex), colIndex: '0' };
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, `已新增一行：${table.name}`);
            } else if (action === 'add-column') {
                const state = getState();
                const table = saveEditedTableFromElement(details, { render: false, persist: false, state });
                if (!table) return;
                tableUiState.openSection = 'fields';
                pushTableUndoSnapshot(`新增字段：${table.name || table.tableIndex}`, state);
                const index = table.columns.length;
                table.columns.push(`字段 ${index}`);
                table.columnPrompts = Array.isArray(table.columnPrompts) ? table.columnPrompts : [];
                table.columnPrompts.push('');
                table.rows = (table.rows || []).map(row => [...row, '']);
                tableUiState.focusField = { tableIndex: String(table.tableIndex), colIndex: String(index) };
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, `已新增字段：${table.name}`);
            } else if (action === 'delete-column') {
                const state = getState();
                const table = saveEditedTableFromElement(details, { render: false, persist: false, state });
                if (!table) return;
                tableUiState.openSection = 'fields';
                const colIndex = Number(this.dataset.tableCol);
                const colName = table.columns[colIndex] || `字段 ${colIndex}`;
                if (!confirmDanger(`删除字段「${colName}」？`, ['这会同时删除该字段下所有数据。'])) {
                    renderWorkbenchScope(workbenchRenderScopes.TABLES);
                    return;
                }
                pushTableUndoSnapshot(`删除字段：${table.name || table.tableIndex} / ${colName}`, state);
                table.columns.splice(colIndex, 1);
                table.columnPrompts = Array.isArray(table.columnPrompts) ? table.columnPrompts : [];
                table.columnPrompts.splice(colIndex, 1);
                table.rows = (table.rows || []).map(row => row.filter((_, index) => index !== colIndex));
                tableUiState.focusField = { tableIndex: String(table.tableIndex), colIndex: String(Math.max(0, colIndex - 1)) };
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, `已删除字段：${colName}`);
            } else if (action === 'delete-row') {
                const state = getState();
                const table = saveEditedTableFromElement(details, { render: false, persist: false, state });
                const row = this.closest('tr[data-table-row]');
                if (!row || !table) return;
                const rowIndex = Number(row.dataset.tableRow);
                const rowData = table.rows?.[rowIndex] || [];
                const preview = rowData.map(value => String(value || '').trim()).filter(Boolean).slice(0, 3).join(' / ') || `第 ${rowIndex + 1} 行`;
                if (!confirmDanger(`删除「${table.name || table.tableIndex}」的第 ${rowIndex + 1} 行？`, [
                    `内容预览：${preview}`,
                    '删除后可以用“撤销表格操作”恢复上一版表格。',
                ])) {
                    renderWorkbenchScope(workbenchRenderScopes.TABLES);
                    return;
                }
                pushTableUndoSnapshot(`删除数据行：${table.name || table.tableIndex} #${rowIndex + 1}`, state);
                table.rows.splice(rowIndex, 1);
                tableUiState.openSection = 'rows';
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, `已删除数据行：${table.name || table.tableIndex}`);
            } else if (action === 'save-table') {
                saveEditedTableFromElement(details);
                toastr.success('表格已保存。');
            } else if (action === 'delete-table') {
                const state = getState();
                const tableIndex = Number(details.dataset.tableIndex);
                const table = (state.tableDatabase.tables || []).find(item => Number(item.tableIndex) === tableIndex);
                if (!confirmDanger(`删除表格「${table?.name || tableIndex}」？`, ['这会删除整张表和其中所有数据行，无法从当前聊天里恢复。'])) return;
                pushTableUndoSnapshot(`删除表格：${table?.name || tableIndex}`, state);
                state.tableDatabase.tables = (state.tableDatabase.tables || []).filter(item => Number(item.tableIndex) !== tableIndex);
                if (String(tableUiState.openTableIndex) === String(tableIndex)) tableUiState.openTableIndex = '';
                details.remove();
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格已删除。');
            }
        });

        root.off('change.bakemonoTableFlags').on('change.bakemonoTableFlags', '[data-table-readonly], [data-table-allow-ai]', function () {
            const details = this.closest('.bakemono-memory-table-item');
            if (!details) return;
            const readOnly = details.querySelector('[data-table-readonly]');
            const allowAi = details.querySelector('[data-table-allow-ai]');
            if (this.matches('[data-table-readonly]') && this.checked) {
                allowAi.checked = false;
                allowAi.disabled = true;
            } else if (this.matches('[data-table-readonly]')) allowAi.disabled = false;
            else if (this.matches('[data-table-allow-ai]') && this.checked) {
                readOnly.checked = false;
                allowAi.disabled = false;
            }
            saveEditedTableFromElement(details, { render: false });
            toastr.info('表格权限已更新。');
        });
        query('#bakemono-memory-undo-table-operation').off('click').on('click', () => undoLastTableOperation(getState()));
        query('#bakemono-memory-redo-table-operation').off('click').on('click', () => redoLastTableOperation(getState()));
        query('#bakemono-memory-create-table').off('click').on('click', () => createCustomTableFromUi());
        query('#bakemono-memory-create-base-ledger').off('click').on('click', () => {
            const profile = createBaseStoryLedgerProfile(getState());
            if (!profile) return;
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已创建并启用：${profile.name}`);
            toastr.success('基础表格已创建。');
        });
    }

    return { bind };
}
