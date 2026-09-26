// Drop selector parts that can no longer match: they reference a removed class, or target a page
// intro inside a panel whose intro was removed. Rules left with no selector parts are deleted.
// Usage: node css-prune-dead.mjs <css> <config.json>   config: { deadClasses: [], introPanelsKept: [] }
import { readFileSync, writeFileSync } from 'node:fs';
const [,, path, configPath] = process.argv;
const src = readFileSync(path, 'utf8');
const { deadClasses, introPanelsKept } = JSON.parse(readFileSync(configPath, 'utf8'));
const BACKSLASH = String.fromCharCode(92);
const skipComment = i => src.indexOf('*/', i + 2) + 2;
function skipString(i) { const q = src[i]; let j = i + 1; while (src[j] !== q) { if (src[j] === BACKSLASH) j++; j++; } return j + 1; }
function scanTo(i, stops) {
    let d = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        if (c === '"' || c === "'") { i = skipString(i); continue; }
        if (c === '(') d++; else if (c === ')') d--; else if (!d && stops.includes(c)) return i;
        i++;
    }
    return i;
}
// Split a selector list on top-level commas (not inside :is()/:not()/attribute values).
function splitList(text) {
    const parts = []; let depth = 0, quote = '', start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) { if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === ',' && !depth) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts.map(p => p.trim());
}
const deadClass = new RegExp('\\.(' + deadClasses.map(c => c.replace(/[-]/g, '\\-')).join('|') + ')(?![\\w-])');
function isDead(part) {
    if (deadClass.test(part)) return true;
    if (!/\.bakemono-memory-page-intro(?![\w-])/.test(part)) return false;
    const panel = part.match(/\[data-bakemono-panel="([^"]+)"\]/);
    return !!panel && !introPanelsKept.includes(panel[1]);
}
const edits = []; let droppedRules = 0, trimmedRules = 0;
function block(i, end, kf) {
    while (i < end) {
        while (i < end && /\s/.test(src[i])) i++;
        if (i >= end) break;
        if (src[i] === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        if (src[i] === '}') return i;
        const b = scanTo(i, '{;}');
        if (src[b] !== '{') { i = b + 1; continue; }
        const rawPrelude = src.slice(i, b);
        const prelude = rawPrelude.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (prelude.startsWith('@')) { i = block(b + 1, end, /keyframes/.test(prelude)) + 1; continue; }
        const close = scanTo(b + 1, '}');
        if (!kf) {
            const parts = splitList(prelude);
            const alive = parts.filter(p => !isDead(p));
            if (!alive.length) {
                const s = src.lastIndexOf('\n', i - 1) + 1;
                let e = close + 1; const nl = src.indexOf('\n', e);
                if (nl >= 0 && /^\s*$/.test(src.slice(e, nl))) e = nl + 1;
                const nl2 = src.indexOf('\n', e);
                if (nl2 >= 0 && /^\s*$/.test(src.slice(e, nl2))) e = nl2 + 1;
                edits.push([s, e, '']); droppedRules++;
            } else if (alive.length < parts.length) {
                const indent = src.slice(src.lastIndexOf('\n', i - 1) + 1, i);
                const eol = src.includes('\r\n') ? '\r\n' : '\n';
                edits.push([i, b, alive.join(',' + eol + indent) + ' ']); trimmedRules++;
            }
        }
        i = close + 1;
    }
    return i;
}
block(0, src.length, false);
let out = src;
for (const [s, e, text] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + text + out.slice(e);
writeFileSync(path, out);
console.log(JSON.stringify({ droppedRules, trimmedRules, linesBefore: src.split('\n').length, linesAfter: out.split('\n').length }));
