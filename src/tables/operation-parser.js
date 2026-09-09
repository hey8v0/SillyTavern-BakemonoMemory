import { extractTaggedContent } from '../shared/text.js';

/**
 * Parse AI-authored table operations without applying them. This module must
 * not mutate table rows, create undo snapshots, save state or render UI.
 */

export function stripHtmlCommentShell(value) {
    return String(value || '').replace(/<!--/g, '').replace(/-->/g, '').trim();
}

export function parseTableObjectLiteral(value) {
    const cleaned = stripHtmlCommentShell(value)
        .replace(/([{,]\s*)(\d+)\s*:/g, '$1"$2":')
        .replace(/"\s+(?="\d+"\s*:)/g, '", ');
    try {
        return JSON.parse(cleaned);
    } catch (error) {
        const fallback = cleaned
            .replace(/([{,]\s*)'([^'"]+)'\s*:/g, '$1"$2":')
            .replace(/:\s*'([^']*)'/g, (_, inner) => `:${JSON.stringify(inner)}`);
        return JSON.parse(fallback);
    }
}

export function parseTableEditOperations(raw) {
    const text = stripHtmlCommentShell(extractTaggedContent(raw, 'tableEdit') || raw);
    const operations = [];
    const insertRe = /insertRow\s*\(\s*(\d+)\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    const updateRe = /updateRow\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    const deleteRe = /deleteRow\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
    let match;
    while ((match = insertRe.exec(text))) {
        operations.push({ op: 'insert', tableIndex: Number(match[1]), data: parseTableObjectLiteral(match[2]) });
    }
    while ((match = updateRe.exec(text))) {
        operations.push({ op: 'update', tableIndex: Number(match[1]), rowIndex: Number(match[2]), data: parseTableObjectLiteral(match[3]) });
    }
    while ((match = deleteRe.exec(text))) {
        operations.push({ op: 'delete', tableIndex: Number(match[1]), rowIndex: Number(match[2]) });
    }
    const kindRe = /setColumnKind\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*"(text|person|item|plan|location)"\s*\)/g;
    while ((match = kindRe.exec(text))) operations.push({ op: 'semantic', tableIndex: Number(match[1]), columnIndex: Number(match[2]), kind: match[3] });
    const clockRe = /setStoryClock\s*\(\s*(\{(?:[^{}"]|"(?:[^"\\]|\\.)*")*\})\s*\)/g;
    while ((match = clockRe.exec(text))) operations.push({ op: 'clock', data: JSON.parse(match[1]) });
    if ((text.match(/setStoryClock\s*\(/g) || []).length !== operations.filter(op => op.op === 'clock').length
        || (text.match(/setColumnKind\s*\(/g) || []).length !== operations.filter(op => op.op === 'semantic').length) {
        throw new Error('剧情状态操作格式无效，请重新生成或修正草稿。');
    }
    return operations;
}
