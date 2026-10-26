// JSON as models write it: single quotes, bare keys, trailing commas, an HTML comment shell.
export function stripHtmlCommentShell(value) {
    return String(value || '').trim().replace(/^<!--\s*/, '').replace(/\s*-->$/, '').trim();
}

export function parseLooseObject(value) {
    const text = stripHtmlCommentShell(value);
    let cleaned = '';
    for (let i = 0; i < text.length;) {
        const char = text[i];
        if (char === '"' || char === "'") {
            const end = stringEnd(text, i);
            let literal = text.slice(i, end);
            if (char === "'") {
                let inner = '';
                for (let j = 1; j < literal.length - 1; j++) {
                    if (literal[j] === '\\') {
                        const next = literal[++j];
                        inner += next === "'" ? "'" : '\\' + next;
                    } else inner += literal[j] === '"' ? '\\"' : literal[j];
                }
                literal = '"' + inner + '"';
            }
            if (/^\s*:/.test(text.slice(end)) && /"\s*$/.test(cleaned)) cleaned += ',';
            cleaned += literal;
            i = end;
        } else if (char === ',' && /^,\s*[}\]]/.test(text.slice(i))) {
            i++;
        } else {
            const key = /^[\p{L}_$\d][\p{L}\p{N}_$]*(?=\s*:)/u.exec(text.slice(i));
            if (key && /[{,]\s*$/.test(cleaned)) {
                cleaned += JSON.stringify(key[0]);
                i += key[0].length;
            } else { cleaned += char; i++; }
        }
    }
    return JSON.parse(cleaned);
}

export function stringEnd(text, start) {
    const quote = text[start];
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === quote) return i + 1;
    }
    throw new Error('字符串缺少结束引号。');
}
