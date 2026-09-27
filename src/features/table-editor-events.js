import { sheetAction, sheetConfirm } from '../ui/action-sheet.js';
import { scrollIntoMain } from '../ui/scroll-into-main.js';

export function createTableEditorEvents({
    query,
    getState,
    toastr,
    confirmDanger,
    inspectTableEditDraft,
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
    sheet = null,
    escapeHtml = String,
} = {}) {
    const rerender = message => renderWorkbenchScope(workbenchRenderScopes.TABLES, message);
    const findTable = (state, tableIndex) => (state.tableDatabase.tables || []).find(item => Number(item.tableIndex) === Number(tableIndex));

    function deleteTable(tableIndex) {
        const state = getState();
        const table = findTable(state, tableIndex);
        if (!table) return;
        pushTableUndoSnapshot(`删除表格：${table.name || tableIndex}`, state);
        state.tableDatabase.tables = (state.tableDatabase.tables || []).filter(item => Number(item.tableIndex) !== Number(tableIndex));
        if (String(tableUiState.openTableIndex) === String(tableIndex)) tableUiState.openTableIndex = '';
        persistCurrentTableDatabase(state);
        rerender('表格已删除。');
        toastr.success?.('表格已删除。点这里撤销。', '', { timeOut: 8000, onclick: () => undoLastTableOperation(getState()) });
    }

    // Everything about a whole table sits behind its “⋯”; deleting it asks once more inside the sheet.
    function openTableActions(section, trigger) {
        const tableIndex = section.dataset.tableIndex;
        const table = findTable(getState(), tableIndex);
        if (!table || !sheet) return;
        const opts = { escapeHtml };
        sheet.open({
            title: table.name || `表格 #${tableIndex}`,
            subtitle: `${table.columns.length} 栏 · ${(table.rows || []).length} 行`,
            trigger,
            keepFocus: ['fields'],
            render: view => view === 'delete'
                ? sheetConfirm(`删除整张“${table.name}”和里面的 ${(table.rows || []).length} 行。之后可以在“撤销、导出与清空”里撤销。`, 'delete', '删除表格', opts)
                : [
                    sheetAction('fields', '栏目与规则', '栏名、每栏写什么、整张表的规则', opts),
                    sheetAction('access', table.readOnly ? '允许 AI 修改' : '设为只读', table.readOnly ? '现在 AI 不能改这张表' : '只读后 AI 不再改这张表', opts),
                    sheetAction('delete', '删除表格', '会再确认一次', { ...opts, danger: true, view: true }),
                ].join(''),
            run: name => {
                const state = getState();
                const current = findTable(state, tableIndex);
                if (!current) return;
                if (name === 'fields') {
                    tableUiState.editFields = String(tableIndex);
                    tableUiState.editRow = null;
                    tableUiState.closed.delete(String(tableIndex));
                    tableUiState.focusField = { tableIndex: String(tableIndex), colIndex: '0' };
                    rerender();
                } else if (name === 'access') {
                    pushTableUndoSnapshot(`修改表格权限：${current.name || tableIndex}`, state);
                    current.readOnly = !current.readOnly;
                    current.allowAiEdit = !current.readOnly;
                    persistCurrentTableDatabase(state);
                    rerender(current.readOnly ? '已设为只读。' : '已允许 AI 修改。');
                } else if (name === 'delete') deleteTable(tableIndex);
            },
        });
    }

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
            const raw = String(card.querySelector('.bakemono-memory-table-draft-editor')?.value ?? draft.raw ?? '');
            draft.raw = raw;
            delete draft.applicationError;
            const feedback = inspectTableEditDraft(draft, state);
            draft.operations = feedback.operations;
            draft.error = feedback.error;
            if (feedback.error) {
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格修改未应用，草稿中已标出原因。');
                toastr.error(`填表未应用：${feedback.error}`);
                return;
            }
            if (action === 'reparse') {
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, `已重新解析：${draft.operations.length} 项操作。`);
                return;
            }
            if (action !== 'apply') return;
            try {
                const undoSnapshot = applyTableOperations(draft.operations, state, {
                    raw: draft.raw,
                    sourceMessageIds: draft.sourceMessageIds,
                    undoLabel: `手动应用表格草稿：${formatSourceRange(draft.sourceMessageIds || [])}`,
                });
                state.tableDatabase.history.unshift({ ...draft, appliedAt: new Date().toISOString(), undoSnapshotId: undoSnapshot?.id || '' });
                state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draftId);
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格修改已应用。');
                toastr.success('表格修改已应用。点这里撤销。', '', { timeOut: 8000, onclick: () => undoLastTableOperation(getState()) });
            } catch (error) {
                draft.applicationError = `应用失败：${error?.message || error}`;
                renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格修改应用失败。');
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
            if (action === 'edit-row') {
                tableUiState.editRow = { tableIndex: String(details.dataset.tableIndex), rowIndex: String(this.dataset.tableRow), colIndex: '0' };
                tableUiState.editFields = null;
                rerender();
            } else if (action === 'cancel-row') {
                tableUiState.editRow = null;
                rerender();
            } else if (action === 'save-row') {
                const state = getState();
                pushTableUndoSnapshot(`编辑数据行：${findTable(state, details.dataset.tableIndex)?.name || details.dataset.tableIndex}`, state);
                tableUiState.editRow = null;
                saveEditedTableFromElement(details, { state });
                toastr.success('这一行已保存。');
            } else if (action === 'close-fields') {
                tableUiState.editFields = null;
                rerender();
            } else if (action === 'add-row') {
                const state = getState();
                const table = saveEditedTableFromElement(details, { render: false, persist: false, state });
                if (!table) return;
                pushTableUndoSnapshot(`新增数据行：${table.name || table.tableIndex}`, state);
                table.rows = Array.isArray(table.rows) ? table.rows : [];
                const newRowIndex = table.rows.length;
                table.rows.push(table.columns.map(() => ''));
                tableUiState.openTableIndex = String(table.tableIndex);
                tableUiState.closed.delete(String(table.tableIndex));
                tableUiState.editRow = { tableIndex: String(table.tableIndex), rowIndex: String(newRowIndex), colIndex: '0' };
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
                table.columnIds?.splice(colIndex, 1);
                table.columnKinds?.splice(colIndex, 1);
                table.columnPrompts = Array.isArray(table.columnPrompts) ? table.columnPrompts : [];
                table.columnPrompts.splice(colIndex, 1);
                table.rows = (table.rows || []).map(row => row.filter((_, index) => index !== colIndex));
                tableUiState.focusField = { tableIndex: String(table.tableIndex), colIndex: String(Math.max(0, colIndex - 1)) };
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, `已删除字段：${colName}`);
            } else if (action === 'delete-row') {
                const state = getState();
                const table = saveEditedTableFromElement(details, { render: false, persist: false, state });
                const rowIndex = Number(this.dataset.tableRow ?? this.closest('tr[data-table-row]')?.dataset.tableRow);
                if (!Number.isInteger(rowIndex) || !table) return;
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
                table.rowIds?.splice(rowIndex, 1);
                tableUiState.editRow = null;
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, `已删除数据行：${table.name || table.tableIndex}`);
            } else if (action === 'save-table') {
                pushTableUndoSnapshot(`编辑栏目与规则：${findTable(getState(), details.dataset.tableIndex)?.name || details.dataset.tableIndex}`, getState());
                tableUiState.editFields = null;
                saveEditedTableFromElement(details);
                toastr.success('表格已保存。');
            } else if (action === 'delete-table') {
                const table = findTable(getState(), details.dataset.tableIndex);
                if (!confirmDanger(`删除表格「${table?.name || details.dataset.tableIndex}」？`, ['这会删除整张表和其中所有数据行。之后可以用“撤销表格操作”恢复。'])) return;
                deleteTable(details.dataset.tableIndex);
            }
        });

        // Reading aids that change only what is shown: fold a table, jump to one, switch records/grid, show all rows.
        root.off('click.bakemonoTableView').on('click.bakemonoTableView', '[data-bk-tbl-fold], [data-bk-tbl-jump], [data-bk-tbl-view], [data-bk-tbl-all], [data-bk-tbl-diff-all], [data-bk-tbl-menu], [data-bk-tbl-expand]', function (event) {
            event.preventDefault();
            const data = this.dataset;
            if (data.bkTblExpand !== undefined) {
                const cell = this.closest('.bk-tbl-cell');
                cell?.classList.toggle('is-expanded');
                this.textContent = cell?.classList.contains('is-expanded') ? '收起 ↑' : '展开 ›';
                return;
            }
            if (data.bkTblMenu !== undefined) return openTableActions(this.closest('.bakemono-memory-table-item'), this);
            if (data.bkTblFold) {
                if (tableUiState.closed.has(data.bkTblFold)) tableUiState.closed.delete(data.bkTblFold); else tableUiState.closed.add(data.bkTblFold);
            } else if (data.bkTblJump) tableUiState.closed.delete(data.bkTblJump);
            else if (data.bkTblView !== undefined) { tableUiState.view = tableUiState.view === 'grid' ? 'records' : 'grid'; tableUiState.editRow = null; }
            else if (data.bkTblAll) tableUiState.full.add(data.bkTblAll);
            else if (data.bkTblDiffAll) tableUiState.fullDiffs.add(data.bkTblDiffAll);
            rerender();
            if (data.bkTblJump) {
                const target = root[0]?.querySelector?.(`.bakemono-memory-table-item[data-table-index="${data.bkTblJump}"]`);
                if (target) scrollIntoMain(target, { block: 'start' });
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
