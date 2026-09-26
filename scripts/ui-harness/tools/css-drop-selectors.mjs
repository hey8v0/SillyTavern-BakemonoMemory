// Remove every style rule whose selector list consists only of the given selectors (any at-rule context).
// Usage: node css-drop-selectors.mjs <css> <selectors.json>
import { readFileSync, writeFileSync } from 'node:fs';
const [,, path, listPath] = process.argv;
const src = readFileSync(path, 'utf8');
const targets = new Set(JSON.parse(readFileSync(listPath, 'utf8')).map(s => s.replace(/\s+/g, ' ').trim()));
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
const drops = []; const matched = new Set();
function block(i, end, kf) {
    while (i < end) {
        while (i < end && /\s/.test(src[i])) i++;
        if (i >= end) break;
        if (src[i] === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        if (src[i] === '}') return i;
        const b = scanTo(i, '{;}');
        if (src[b] !== '{') { i = b + 1; continue; }
        const prelude = src.slice(i, b).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
        if (prelude.startsWith('@')) { i = block(b + 1, end, /keyframes/.test(prelude)) + 1; continue; }
        const close = scanTo(b + 1, '}');
        const parts = prelude.split(/\s*,\s*/);
        if (!kf && parts.every(p => targets.has(p))) {
            parts.forEach(p => matched.add(p));
            const s = src.lastIndexOf('\n', i - 1) + 1;
            let e = close + 1; const nl = src.indexOf('\n', e);
            if (nl >= 0 && /^\s*$/.test(src.slice(e, nl))) e = nl + 1;
            if (nl >= 0 && /^\s*$/.test(src.slice(e, src.indexOf('\n', e)))) e = src.indexOf('\n', e) + 1;
            drops.push([s, e]);
        }
        i = close + 1;
    }
    return i;
}
block(0, src.length, false);
let out = src;
for (const [s, e] of drops.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + out.slice(e);
writeFileSync(path, out);
console.log(JSON.stringify({ droppedRules: drops.length, unmatched: [...targets].filter(t => !matched.has(t)) }));
