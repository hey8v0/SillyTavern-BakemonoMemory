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
    // Anything that is not a real calendar day is kept word for word as the time description (fantasy calendars,
    // a month without a year, “1889年10月15日 夜晚”), never a reason to throw the table edit away.
    const keepAsLabel = (text, note) => {
        data.date = '';
        const label = data.label?.trim() || '';
        data.label = label.includes(text) ? label : [text, label].filter(Boolean).join(' ');
        warnings.push(note);
    };
    const full = /^(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*日?(?:[T\s,，]+(.*))?$/.exec(date);
    if (full) {
        const iso = `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
        const timestamp = Date.parse(`${iso}T00:00:00Z`);
        if (Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso) {
            data.date = iso;
            const rest = full[4]?.trim(), label = data.label?.trim() || '';
            if (rest && !label.includes(rest)) data.label = [rest, label].filter(Boolean).join(' ');
        } else keepAsLabel(date, `公历里没有「${date}」这一天，已作为时间描述保存。`);
    }
    else if (date) {
        keepAsLabel(date, /^(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})/.test(date) ? '未提供年份，日期已保留为时间描述。'
            : `「${date}」不是年-月-日，已作为时间描述保存。`);
    }
    return data;
}
