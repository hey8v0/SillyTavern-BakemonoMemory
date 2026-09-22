/**
 * Parse AI-authored table operations without applying them. This module must
 * not mutate table rows, create undo snapshots, save state or render UI.
 */

export function stripHtmlCommentShell(value) {
    return String(value || '').trim().replace(/^<!--\s*/, '').replace(/\s*-->$/, '').trim();
}

export function parseTableObjectLiteral(value) {
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
            const key = /^[A-Za-z_$\d][\w$]*(?=\s*:)/.exec(text.slice(i));
            if (key && /[{,]\s*$/.test(cleaned)) {
                cleaned += JSON.stringify(key[0]);
                i += key[0].length;
            } else { cleaned += char; i++; }
        }
    }
    return JSON.parse(cleaned);
}

function stringEnd(text, start) {
    const quote = text[start];
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === quote) return i + 1;
    }
    throw new Error('字符串缺少结束引号。');
}

function readArguments(text, start) {
    const args = [], stack = [];
    let from = start;
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (char === '"' || char === "'") { i = stringEnd(text, i) - 1; continue; }
        if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
        else if (char === '}' || char === ']') {
            if (stack.pop() !== char) throw new Error('括号不匹配。');
        } else if (char === '(') throw new Error('参数不能包含函数调用。');
        else if (!stack.length && (char === ',' || char === ')')) {
            args.push(text.slice(from, i).trim()); from = i + 1;
            if (char === ')') return { args, end: i + 1 };
        }
    }
    throw new Error('指令不完整，缺少结束括号；请补全指令或重新生成。');
}

const commandOrder = ['insert', 'update', 'delete', 'semantic', 'clock'];

export function parseTableEditOperations(raw) {
    const source = String(raw || '').replace(/<tableThink\b[^>]*>[\s\S]*?<\/tableThink>/gi, '');
    const openCount = (source.match(/<tableEdit[\s>]/gi) || []).length;
    const tagged = openCount > 0;
    const blocks = [...source.matchAll(/<tableEdit\b[^>]*>([\s\S]*?)<\/tableEdit\s*>/gi)];
    if (tagged && blocks.length !== openCount) throw new Error('tableEdit 输出不完整，缺少结束标签；请补全指令或重新生成。');
    const text = (tagged ? blocks.map(block => block[1]) : [source])
        .map(content => stripHtmlCommentShell(content).replace(/^\s*```\w*\s*\n/, '').replace(/\n\s*```\s*$/, '')).join('\n');
    if (!tagged && !/\b(?:insertRow|updateRow|deleteRow|setColumnKind|setStoryClock)\b/.test(text) && !/^\s*[A-Za-z_$][\w$]*\s*\(/.test(text)) return [];
    const operations = [];
    for (let i = 0; i < text.length;) {
        if (/[\s;]/.test(text[i])) { i++; continue; }
        if (text.startsWith('//', i)) { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end + 1; continue; }
        if (text.startsWith('/*', i)) {
            const end = text.indexOf('*/', i + 2);
            if (end < 0) throw new Error('填表指令的注释未结束。');
            i = end + 2; continue;
        }
        const line = text.slice(0, i).split('\n').length;
        const name = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))?.[0] || '';
        try {
            if (!['insertRow', 'updateRow', 'deleteRow', 'setColumnKind', 'setStoryClock'].includes(name)) throw new Error('不支持的指令；请使用 insertRow、updateRow、deleteRow、setColumnKind 或 setStoryClock。');
            const open = /^\s*\(/.exec(text.slice(i + name.length));
            if (!open) throw new Error('指令名称后缺少左括号。');
            const { args, end } = readArguments(text, i + name.length + open[0].length);
            const arity = { insertRow: 2, updateRow: 3, deleteRow: 2, setColumnKind: 3, setStoryClock: 1 }[name];
            if (args.length !== arity || args.some(arg => !arg)) throw new Error(`需要 ${arity} 个参数，不能缺项。`);
            const index = pos => {
                if (!/^\d+$/.test(args[pos]) || !Number.isSafeInteger(Number(args[pos]))) throw new Error(`第 ${pos + 1} 个参数应为从 0 开始的整数编号。`);
                return Number(args[pos]);
            };
            const object = pos => {
                try { return parseTableObjectLiteral(args[pos]); }
                catch { throw new Error(`第 ${pos + 1} 个参数格式无效，请检查引号、逗号和括号。`); }
            };
            if (name === 'insertRow') operations.push({ op: 'insert', tableIndex: index(0), data: object(1) });
            if (name === 'updateRow') operations.push({ op: 'update', tableIndex: index(0), rowIndex: index(1), data: object(2) });
            if (name === 'deleteRow') operations.push({ op: 'delete', tableIndex: index(0), rowIndex: index(1) });
            if (name === 'setStoryClock') operations.push({ op: 'clock', data: object(0) });
            if (name === 'setColumnKind') {
                const kind = object(2);
                if (!['text', 'person', 'item', 'plan', 'location'].includes(kind)) throw new Error('字段类型应为 text、person、item、plan 或 location。');
                operations.push({ op: 'semantic', tableIndex: index(0), columnIndex: index(1), kind });
            }
            i = end;
        } catch (error) {
            throw new Error(`第 ${line} 行${name ? ` ${name}` : ''}：${error.message}`);
        }
    }
    // Preserve the existing transaction order; row deletes are staged separately by the model.
    return operations.sort((a, b) => commandOrder.indexOf(a.op) - commandOrder.indexOf(b.op));
}
