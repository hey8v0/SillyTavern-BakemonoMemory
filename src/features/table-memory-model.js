export function createTableMemoryModel({
    getState: ensureState,
    formatBlocksForPrompt,
    formatSourceRange,
    getSourceMessageIdsFromBlocks,
    defaultTableEditPrompt,
    getHash,
    parseTableEditOperations,
    getFiniteMessageIds,
    pushTableUndoSnapshot,
    normalizeTableText,
    saveCurrentTableProfileRows,
    updateInjectionFromSummaries,
} = {}) {
    function formatTableGuideForPrompt(state = ensureState()) {
        const tables = state.tableDatabase.tables || [];
        if (!tables.length) {
            return '暂无表格结构。';
        }
        return tables.map(table => [
            `${table.tableIndex}: ${table.name} (${table.columns.map((col, index) => `${index}:${col}`).join(', ')})`,
            `权限：${table.readOnly ? '只读' : '可写'} / ${table.allowAiEdit === false || table.readOnly ? '禁止 AI 修改' : '允许 AI 修改'}`,
            table.columnPrompts?.some(Boolean)
                ? `columns:\n${table.columns.map((col, index) => `${index}:${col}${table.columnPrompts?.[index] ? ` -> ${table.columnPrompts[index]}` : ''}`).join('\n')}`
                : '',
            table.note ? `note: ${table.note}` : '',
            table.insertNode ? `insert: ${table.insertNode}` : '',
            table.updateNode ? `update: ${table.updateNode}` : '',
            table.deleteNode ? `delete: ${table.deleteNode}` : '',
        ].filter(Boolean).join('\n')).join('\n\n');
    }

    function getWritableTables(state = ensureState()) {
        return (state.tableDatabase.tables || []).filter(table => !table.readOnly && table.allowAiEdit !== false);
    }

    function getReadonlyTables(state = ensureState()) {
        return (state.tableDatabase.tables || []).filter(table => table.readOnly || table.allowAiEdit === false);
    }

    function formatTableDataForPrompt(state = ensureState()) {
        const tables = state.tableDatabase.tables || [];
        if (!tables.length) {
            return '暂无表格数据。';
        }
        return tables.map(table => {
            const header = `## ${table.tableIndex}: ${table.name}\nColumns: ${table.columns.map((col, index) => `${index}:${col}`).join(' | ')}`;
            const rows = table.rows?.length
                ? table.rows.map((row, rowIndex) => `row ${rowIndex}: ${row.map((cell, colIndex) => `${colIndex}:${cell}`).join(' | ')}`).join('\n')
                : '(无数据行)';
            return `${header}\n${rows}`;
        }).join('\n\n');
    }

    function formatSpecificTablesForPrompt(tables = [], options = {}) {
        if (!tables.length) {
            return '无。';
        }
        const includeRows = options.includeRows !== false;
        return tables.map(table => {
            const header = `## ${table.tableIndex}: ${table.name}\nColumns: ${table.columns.map((col, index) => `${index}:${col}`).join(' | ')}`;
            const rows = includeRows
                ? (table.rows?.length
                    ? table.rows.map((row, rowIndex) => `row ${rowIndex}: ${row.map((cell, colIndex) => `${colIndex}:${cell}`).join(' | ')}`).join('\n')
                    : '(无数据行)')
                : 'Rows: 已省略；表格内容请读取长期上下文里的“表格记忆”。';
            return `${header}\n${rows}`;
        }).join('\n\n');
    }

    function renderInjectedTablesSection(state = ensureState()) {
        const tables = state.tableDatabase.tables || [];
        if (state.tableDatabase.injectMemory === false || !tables.length) {
            return '';
        }
        const sections = [];
        for (const table of tables) {
            const limit = Math.max(120, Number(table.injectLimit || 1200));
            const rows = Array.isArray(table.rows) ? table.rows : [];
            const lines = [
                `### ${table.tableIndex}: ${table.name}${table.readOnly ? '（只读）' : ''}`,
                table.note ? `规则：${table.note}` : '',
                `字段：${table.columns.map((col, index) => `${index}:${col}`).join(' | ')}`,
            ].filter(Boolean);
            if (rows.length) {
                for (const [rowIndex, row] of rows.entries()) {
                    lines.push(`row ${rowIndex}: ${table.columns.map((col, colIndex) => `${col}:${row?.[colIndex] ?? ''}`).join(' | ')}`);
                }
            } else {
                lines.push('(暂无数据行)');
            }
            let text = lines.join('\n');
            if (text.length > limit) {
                text = `${text.slice(0, limit)}\n...（已按表格记忆安全上限裁剪）`;
            }
            sections.push(text);
        }
        return sections.length ? `## 表格记忆\n${sections.join('\n\n')}` : '';
    }

    function buildTableEditPrompt(blocks, state = ensureState()) {
        const blockText = formatBlocksForPrompt(blocks, {
            sourceRange: formatSourceRange(getSourceMessageIdsFromBlocks(blocks)),
        });
        const template = String(state.turnSummary.tablePrompt || defaultTableEditPrompt);
        return template
            .replaceAll('{{blocks}}', blockText)
            .replaceAll('{{tableData}}', formatTableDataForPrompt(state))
            .replaceAll('{{tableGuide}}', formatTableGuideForPrompt(state))
            .replaceAll('{{readonlyTables}}', formatSpecificTablesForPrompt(getReadonlyTables(state)))
            .replaceAll('{{writableTables}}', formatSpecificTablesForPrompt(getWritableTables(state)));
    }

    function getTableSchemasForPreset(state = ensureState()) {
        return (state.tableDatabase.tables || []).map(table => ({
            id: table.id || `table-${getHash(`${table.name || table.tableIndex}`)}`,
            tableIndex: Number.isFinite(Number(table.tableIndex)) ? Number(table.tableIndex) : 0,
            name: String(table.name || '未命名表格'),
            columns: Array.isArray(table.columns) ? table.columns.map(col => String(col || '')) : [],
            columnPrompts: Array.isArray(table.columnPrompts) ? table.columnPrompts.map(text => String(text || '')) : [],
            note: String(table.note || ''),
            initNode: String(table.initNode || ''),
            insertNode: String(table.insertNode || ''),
            updateNode: String(table.updateNode || ''),
            deleteNode: String(table.deleteNode || ''),
            required: !!table.required,
            rows: [],
        }));
    }

    function getNextTableIndex(state = ensureState()) {
        const indexes = (state.tableDatabase.tables || []).map(table => Number(table.tableIndex)).filter(Number.isFinite);
        return indexes.length ? Math.max(...indexes) + 1 : 0;
    }

    function createTableEditDraft(raw, blocks, state = ensureState()) {
        const operations = parseTableEditOperations(raw);
        if (!operations.length) {
            return null;
        }
        const now = new Date().toISOString();
        const draft = {
            id: `table-draft-${getHash(`${now}|${raw}`)}`,
            raw,
            operations,
            sourceMessageIds: getSourceMessageIdsFromBlocks(blocks),
            createdAt: now,
        };
        state.tableDatabase.editDrafts.unshift(draft);
        return draft;
    }

    function applyTableOperations(operations = [], state = ensureState(), options = {}) {
        const sourceMessageIds = getFiniteMessageIds(options.sourceMessageIds || []);
        let snapshot = null;
        if (options.recordUndo !== false && operations.length) {
            snapshot = pushTableUndoSnapshot(options.undoLabel || `AI 表格修改 ${operations.length} 项`, state, { sourceMessageIds });
        }
        const tablesByIndex = new Map((state.tableDatabase.tables || []).map(table => [Number(table.tableIndex), table]));
        const deletes = [];
        for (const operation of operations) {
            const table = tablesByIndex.get(Number(operation.tableIndex));
            if (!table) {
                throw new Error(`表格 ${operation.tableIndex} 不存在。`);
            }
            if (table.readOnly || table.allowAiEdit === false) {
                throw new Error(`表格 ${operation.tableIndex}「${table.name || ''}」是只读或禁止 AI 修改，已拒绝本次操作。`);
            }
            table.rows = Array.isArray(table.rows) ? table.rows : [];
            if (operation.op === 'insert') {
                const row = table.columns.map((_, index) => normalizeTableText(operation.data?.[String(index)] ?? operation.data?.[index] ?? ''));
                table.rows.push(row);
            } else if (operation.op === 'update') {
                const row = table.rows[operation.rowIndex];
                if (!row) {
                    throw new Error(`表格 ${operation.tableIndex} 的 row ${operation.rowIndex} 不存在。`);
                }
                for (const [key, value] of Object.entries(operation.data || {})) {
                    const colIndex = Number(key);
                    if (Number.isFinite(colIndex) && colIndex >= 0 && colIndex < table.columns.length) {
                        row[colIndex] = normalizeTableText(value);
                    }
                }
            } else if (operation.op === 'delete') {
                deletes.push({ table, rowIndex: operation.rowIndex });
            }
        }
        deletes.sort((a, b) => b.rowIndex - a.rowIndex).forEach(({ table, rowIndex }) => {
            if (table.rows[rowIndex]) {
                table.rows.splice(rowIndex, 1);
            }
        });
        saveCurrentTableProfileRows(state);
        updateInjectionFromSummaries();
        if (sourceMessageIds.length) {
            state.tableDatabase.lastAppliedSourceMessageIds = sourceMessageIds;
        }
        return snapshot;
    }

    return {
        formatTableGuideForPrompt,
        getWritableTables,
        getReadonlyTables,
        formatTableDataForPrompt,
        formatSpecificTablesForPrompt,
        renderInjectedTablesSection,
        buildTableEditPrompt,
        getTableSchemasForPreset,
        getNextTableIndex,
        createTableEditDraft,
        applyTableOperations,
    };
}
