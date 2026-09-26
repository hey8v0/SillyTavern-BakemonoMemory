// Remove selectors that mention retired class names; a rule whose selectors are all removed goes entirely.
// Selectors that mention a retired class only inside :is()/:where()/:not()/:has() are reported, never touched.
// Usage: node css-drop-classes.mjs <css> <class-regex-source>   e.g. "bakemono-memory-(health|token)-"
import { readFileSync, writeFileSync } from 'node:fs';
const [,, path, pattern] = process.argv;
const src = readFileSync(path, 'utf8');
const retired = new RegExp('\\.(?:' + pattern + ')[\\w-]*');
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
function splitSelectors(prelude) {
    const parts = []; let depth = 0, start = 0;
    for (let i = 0; i < prelude.length; i++) {
        const c = prelude[i];
        if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && !depth) { parts.push(prelude.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(prelude.slice(start).trim());
    return parts;
}
const outsideParens = selector => { let depth = 0, out = ''; for (const c of selector) { if (c === '(') depth++; if (!depth) out += c; if (c === ')') depth--; } return out; };
const edits = [], review = [];
let droppedRules = 0, droppedSelectors = 0;
function block(i, end, keyframes) {
    while (i < end) {
        while (i < end && /\s/.test(src[i])) i++;
        if (i >= end) break;
        if (src[i] === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        if (src[i] === '}') return i;
        const brace = scanTo(i, '{;}');
        if (src[brace] !== '{') { i = brace + 1; continue; }
        const raw = src.slice(i, brace);
        const prelude = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
        if (prelude.startsWith('@')) { i = block(brace + 1, end, /keyframes/.test(prelude)) + 1; continue; }
        const close = scanTo(brace + 1, '}');
        if (!keyframes && retired.test(prelude)) {
            const selectors = splitSelectors(prelude);
            const keep = selectors.filter(selector => {
                if (!retired.test(selector)) return true;
                if (!retired.test(outsideParens(selector))) { review.push(selector); return true; }
                return false;
            });
            if (!keep.length) {
                const s = src.lastIndexOf('\n', i - 1) + 1;
                let e = close + 1; const nl = src.indexOf('\n', e);
                if (nl >= 0 && /^\s*$/.test(src.slice(e, nl))) e = nl + 1;
                edits.push([s, e, '']); droppedRules++; droppedSelectors += selectors.length;
            } else if (keep.length < selectors.length) {
                const lead = raw.match(/^\s*/)[0];
                edits.push([i, brace, lead + keep.join(',\n') + ' ']); droppedSelectors += selectors.length - keep.length;
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
console.log(JSON.stringify({ droppedRules, droppedSelectors, review: [...new Set(review)] }, null, 1));
