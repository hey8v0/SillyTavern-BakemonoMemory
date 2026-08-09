import { getHash } from '../shared/text.js';

export function toTableSchema(table, fallbackIndex = 0) {
    const columns = Array.isArray(table?.columns) ? table.columns.map(col => String(col || '')) : [];
    const tableIndex = Number.isFinite(Number(table?.tableIndex)) ? Number(table.tableIndex) : fallbackIndex;
    const readOnly = !!table?.readOnly;
    return {
        id: table?.id || `table-${getHash(`${table?.name || tableIndex}|${tableIndex}`)}`,
        tableIndex,
        name: String(table?.name || `表格 ${tableIndex}`),
        columns,
        columnPrompts: Array.isArray(table?.columnPrompts)
            ? table.columnPrompts.map(text => String(text || '')).slice(0, columns.length)
            : columns.map(() => ''),
        note: String(table?.note || ''),
        initNode: String(table?.initNode || ''),
        insertNode: String(table?.insertNode || ''),
        updateNode: String(table?.updateNode || ''),
        deleteNode: String(table?.deleteNode || ''),
        rows: [],
        required: !!table?.required,
        readOnly,
        inject: true,
        injectLimit: Math.max(0, Number(table?.injectLimit ?? 1200)),
        allowAiEdit: !readOnly && (table?.allowAiEdit !== undefined ? !!table.allowAiEdit : true),
    };
}

export function normalizeTableSchemas(tables = []) {
    return (Array.isArray(tables) ? tables : [])
        .map((table, index) => toTableSchema(table, index))
        .filter(table => table.columns.length || table.name.trim());
}

export function findMatchingTable(schema, tables = []) {
    return tables.find(table => schema.id && table.id === schema.id)
        || tables.find(table => Number(table.tableIndex) === Number(schema.tableIndex))
        || tables.find(table => String(table.name || '') === String(schema.name || ''));
}

export function mergeTableSchemaWithRows(schema, existing) {
    const rows = Array.isArray(existing?.rows)
        ? existing.rows.map(row => schema.columns.map((_, index) => String(row?.[index] ?? '')))
        : [];
    return {
        ...schema,
        rows,
    };
}

export function normalizeTableText(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').replace(/"/g, '').replace(/,/g, ' / ').trim();
}

export function normalizeImportedTablesFromJson(raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed?.tables)) {
        return parsed.tables.map((table, index) => ({
            ...toTableSchema(table, index),
            rows: Array.isArray(table.rows) ? table.rows.map(row => Array.isArray(row) ? row.map(cell => String(cell ?? '')) : []) : [],
        }));
    }
    if (Array.isArray(parsed?.tableStructure)) {
        return parsed.tableStructure.map((table, index) => toTableSchema({
            id: `table-${getHash(`${table.tableIndex ?? index}|${table.tableName || table.name || index}`)}`,
            tableIndex: Number.isFinite(Number(table.tableIndex)) ? Number(table.tableIndex) : index,
            name: String(table.tableName || table.name || `表格 ${index}`),
            columns: Array.isArray(table.columns) ? table.columns.map(col => String(col || '')) : [],
            columnPrompts: Array.isArray(table.columnPrompts) ? table.columnPrompts.map(text => String(text || '')) : [],
            note: String(table.note || ''),
            initNode: String(table.initNode || ''),
            insertNode: String(table.insertNode || ''),
            updateNode: String(table.updateNode || ''),
            deleteNode: String(table.deleteNode || ''),
            rows: [],
            required: !!table.Required || !!table.required,
        }, index));
    }

    const sheets = Object.values(parsed || {})
        .filter(item => item && typeof item === 'object' && item.name && Array.isArray(item.content))
        .sort((a, b) => (Number(a.orderNo ?? 999) - Number(b.orderNo ?? 999)) || String(a.name).localeCompare(String(b.name)));
    return sheets.map((sheet, index) => {
        const header = Array.isArray(sheet.content?.[0]) ? sheet.content[0] : [];
        return {
            ...toTableSchema({
                id: sheet.uid || `sheet-${getHash(`${sheet.name}|${index}`)}`,
                tableIndex: index,
                name: String(sheet.name || `表格 ${index}`),
                columns: header.slice(1).map(col => String(col || '')),
                columnPrompts: header.slice(1).map(() => ''),
                note: String(sheet.sourceData?.note || ''),
                initNode: String(sheet.sourceData?.initNode || ''),
                insertNode: String(sheet.sourceData?.insertNode || ''),
                updateNode: String(sheet.sourceData?.updateNode || ''),
                deleteNode: String(sheet.sourceData?.deleteNode || ''),
            }, index),
            rows: (sheet.content || []).slice(1).filter(Array.isArray).map(row => row.slice(1).map(cell => String(cell ?? ''))),
        };
    });
}
