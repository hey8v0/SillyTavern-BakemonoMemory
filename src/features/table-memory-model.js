import { ensureTableIdentity, resolveEntity, storyTimeContext, setStoryTime, upsertEntity, markStoryChange } from '../memory/story-state.js';

export const storyStateEditGuide = `剧情状态随本次填表维护，在同一个 <tableEdit> 内可追加：
setColumnKind(表号, 列号, "person")：实体名称列可标为 person/item/plan/location；普通描述列保持 text，不把一段描述或多人列表当成一个实体。
setStoryClock({"date":"1889-10-15","label":"夜晚","flashback":false})：仅根据本轮明确发生的时间变化填写；架空时间只填 label；明确经过 N 天且当前已有日期时可用 relativeDays:N。回忆用 flashback:true，不推进现在。
这些操作可与 insertRow/updateRow/deleteRow 共存。已有字段语义无变化时不要重复输出。没有时间依据时省略时钟操作，不能用现实日期或猜测填空。`;

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
        return [storyStateEditGuide, storyTimeContext(state)].filter(Boolean).join('\n\n') + '\n\n' + tables.map(table => [
            `${table.tableIndex}: ${table.name} (${table.columns.map((col, index) => `${index}:${col}`).join(', ')})`,
            `权限：${table.readOnly ? '只读' : '可写'} / ${table.allowAiEdit === false || table.readOnly ? '禁止 AI 修改' : '允许 AI 修改'}`,
            `字段语义：${table.columns.map((col, i) => `${col}=${table.columnKinds?.[i] || 'text'}`).join(' / ')}；实体名称应保持一致，不确定时不要猜测归属。`,
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
                    lines.push(`row ${rowIndex}: ${table.columns.map((col, colIndex) => {
                        const value = String(row?.[colIndex] ?? '');
                        const ref = table.cellRefs?.[`${table.rowIds?.[rowIndex]}:${table.columnIds?.[colIndex]}`];
                        const entity = resolveEntity(state, table.columnKinds?.[colIndex], value, ref?.value === value ? ref.entityId : '');
                        return `${col}:${entity?.name || value}`;
                    }).join(' | ')}`);
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
        return [storyTimeContext(state), template.includes('{{tableGuide}}') ? '' : storyStateEditGuide, template
            .replaceAll('{{blocks}}', blockText)
            .replaceAll('{{tableData}}', formatTableDataForPrompt(state))
            .replaceAll('{{tableGuide}}', formatTableGuideForPrompt(state))
            .replaceAll('{{readonlyTables}}', formatSpecificTablesForPrompt(getReadonlyTables(state)))
            .replaceAll('{{writableTables}}', formatSpecificTablesForPrompt(getWritableTables(state)))].filter(Boolean).join('\n\n');
    }

    function getTableSchemasForPreset(state = ensureState()) {
        return (state.tableDatabase.tables || []).map(table => ({
            id: table.id || `table-${getHash(`${table.name || table.tableIndex}`)}`,
            tableIndex: Number.isFinite(Number(table.tableIndex)) ? Number(table.tableIndex) : 0,
            name: String(table.name || '未命名表格'),
            columns: Array.isArray(table.columns) ? table.columns.map(col => String(col || '')) : [],
            columnIds: [...(table.columnIds || [])],
            columnKinds: [...(table.columnKinds || [])],
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
        const nextTables = structuredClone(state.tableDatabase.tables || []);
        const nextState = { chronicle: state.chronicle ? { clock: structuredClone(state.chronicle.clock), entities: structuredClone(state.chronicle.entities) } : null };
        let clockOperation = null;
        const tablesByIndex = new Map(nextTables.map(table => [Number(table.tableIndex), table]));
        const deletes = [];
        for (const operation of operations) {
            if (operation.op === 'clock') {
                if (!nextState.chronicle) throw new Error('剧情状态尚未初始化');
                const data = operation.data;
                if (clockOperation) throw new Error('一次填表只接受一项剧情时间更新');
                if (!data || typeof data !== 'object' || Array.isArray(data)
                    || Object.keys(data).some(key => !['label', 'date', 'relativeDays', 'flashback'].includes(key))
                    || (data.label !== undefined && typeof data.label !== 'string')
                    || (data.date !== undefined && typeof data.date !== 'string')
                    || (data.flashback !== undefined && typeof data.flashback !== 'boolean')
                    || (data.relativeDays !== undefined && !Number.isInteger(data.relativeDays))
                    || (!data.label?.trim() && !data.date?.trim() && data.relativeDays === undefined)) throw new Error('剧情时间操作无效');
                setStoryTime(nextState, { ...data, sourceMessageIds });
                clockOperation = data;
                continue;
            }
            const table = tablesByIndex.get(Number(operation.tableIndex));
            if (!table) {
                throw new Error(`表格 ${operation.tableIndex} 不存在。`);
            }
            if (table.readOnly || table.allowAiEdit === false) {
                throw new Error(`表格 ${operation.tableIndex}「${table.name || ''}」是只读或禁止 AI 修改，已拒绝本次操作。`);
            }
            table.rows = Array.isArray(table.rows) ? table.rows : [];
            ensureTableIdentity(table);
            if (operation.op === 'semantic') {
                if (!Number.isInteger(operation.columnIndex) || operation.columnIndex < 0 || operation.columnIndex >= table.columns.length
                    || !['text', 'person', 'item', 'plan', 'location'].includes(operation.kind)) throw new Error('字段语义无效');
                table.columnKinds[operation.columnIndex] = operation.kind;
                table.semanticOverrides ||= {};
                table.semanticOverrides[table.columnIds[operation.columnIndex]] = { name: table.columns[operation.columnIndex], kind: operation.kind };
                continue;
            }
            if (!['insert', 'update', 'delete'].includes(operation.op)) throw new Error('未知表格操作');
            if (operation.op !== 'insert' && (!Number.isInteger(operation.rowIndex) || !table.rows[operation.rowIndex])) throw new Error('表格数据行不存在');
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
                    if (!Number.isInteger(colIndex) || colIndex < 0 || colIndex >= table.columns.length) throw new Error('表格字段不存在');
                    if (Number.isFinite(colIndex) && colIndex >= 0 && colIndex < table.columns.length) {
                        row[colIndex] = normalizeTableText(value);
                    }
                }
            } else if (operation.op === 'delete') {
                deletes.push({ table, rowIndex: operation.rowIndex });
            }
        }
        const deleted = new Set();
        deletes.sort((a, b) => b.rowIndex - a.rowIndex).forEach(({ table, rowIndex }) => {
            const key = `${table.id}:${rowIndex}`;
            if (deleted.has(key)) return;
            deleted.add(key);
            if (table.rows[rowIndex]) {
                table.rows.splice(rowIndex, 1);
                table.rowIds?.splice(rowIndex, 1);
            }
        });
        nextTables.forEach(ensureTableIdentity);
        if (nextState.chronicle) for (const table of nextTables) {
            if (table.readOnly || table.allowAiEdit === false) continue;
            table.rows.forEach(row => row.forEach((value, index) => {
                const kind = table.columnKinds[index], name = String(value || '').trim();
                if (kind === 'text' || !name || name.length > 200 || /[\n,，、；;]/.test(name) || /^(未知|无|不明|待定|暂无|none|unknown)$/i.test(name)) return;
                if (!nextState.chronicle.entities.some(e => e.kind === kind && [e.name, ...(e.aliases || [])].includes(name))) upsertEntity(nextState, { kind, name });
            }));
        }
        if (options.recordUndo !== false && operations.length) {
            snapshot = pushTableUndoSnapshot(options.undoLabel || `AI 表格修改 ${operations.length} 项`, state, { sourceMessageIds });
        }
        state.tableDatabase.tables = nextTables;
        if (nextState.chronicle) {
            Object.assign(state.chronicle, nextState.chronicle);
            markStoryChange(state, { label: options.undoLabel || 'AI 更新表格与剧情状态', sourceMessageIds, mode: clockOperation?.flashback ? 'flashback' : 'source',
                ...(clockOperation?.flashback ? { storyTime: state.chronicle.clock.lastFlashback } : {}) });
        }
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
