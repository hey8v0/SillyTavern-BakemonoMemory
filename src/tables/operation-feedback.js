export function describeTableOperation(operation) {
    const command = { clock: 'setStoryClock', semantic: 'setColumnKind', insert: 'insertRow', update: 'updateRow', delete: 'deleteRow' }[operation?.op] || '表格指令';
    return [command, operation?.tableIndex !== undefined ? `表格 #${operation.tableIndex}` : '',
        operation?.rowIndex !== undefined ? `第 ${operation.rowIndex} 行` : '',
        operation?.columnIndex !== undefined ? `第 ${operation.columnIndex} 列` : ''].filter(Boolean).join(' · ');
}

export function normalizeTableClock(input, warnings = []) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('参数应为时间对象，如 {"label":"深夜"}。');
    const data = { ...input };
    const unknown = Object.keys(data).find(key => !['label', 'date', 'relativeDays', 'flashback'].includes(key));
    if (unknown) throw new Error(`不支持时间字段「${unknown}」；可用字段为 date、label、relativeDays、flashback。`);
    for (const key of ['date', 'label']) if (data[key] !== undefined && typeof data[key] !== 'string') throw new Error(`${key} 应为文本。`);
    if (data.flashback !== undefined && typeof data.flashback !== 'boolean') throw new Error('flashback 应为 true 或 false。');
    if (data.relativeDays !== undefined && !Number.isInteger(data.relativeDays)) throw new Error('relativeDays 应为整数天数。');
    if (!data.label?.trim() && !data.date?.trim() && data.relativeDays === undefined) throw new Error('没有时间内容；请填写 date、label 或 relativeDays。');
    if (data.date?.trim() && data.relativeDays !== undefined) throw new Error('date 与 relativeDays 不能同时填写，请选择日期或经过天数。');
    const date = data.date?.trim() || '';
    const full = /^(\d{4})(?:年|[-/])(\d{1,2})(?:月|[-/])(\d{1,2})日?$/.exec(date);
    if (full) {
        data.date = `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
        const timestamp = Date.parse(`${data.date}T00:00:00Z`);
        if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== data.date) throw new Error(`日期「${date}」不存在，请核对月份和天数。`);
    }
    else if (date) {
        const partial = /^(\d{1,2})(?:月|[-/])(\d{1,2})日?$/.exec(date);
        if (partial) {
            const month = Number(partial[1]), day = Number(partial[2]);
            if (month < 1 || month > 12 || day < 1 || day > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) throw new Error('日期中的月份或天数无效，请核对正文。');
            data.date = '';
            const label = data.label?.trim() || '';
            data.label = label.includes(date) ? label : [date, label].filter(Boolean).join(' ');
            warnings.push('未提供年份，日期已保留为时间描述。');
        }
    }
    return data;
}
