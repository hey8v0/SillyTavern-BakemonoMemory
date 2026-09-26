// Removes CSS declarations that can never win: a later rule with the *same selector*
// in the *same at-rule context* redeclares the same property (with >= importance).
// Skips cases where the later value/selector may be unsupported by older browsers,
// because then the earlier declaration is a live fallback.
// Usage: node css-dedupe.mjs <in.css> <out.css> [report.json]
import { readFileSync, writeFileSync } from 'node:fs';

const [,, input, output, reportPath] = process.argv;
const src = readFileSync(input, 'utf8');

// ---- tokenizer-level scanner --------------------------------------------------
function skipComment(i) { const end = src.indexOf('*/', i + 2); if (end < 0) throw Error('unterminated comment at ' + i); return end + 2; }
function skipString(i) { const q = src[i]; let j = i + 1; while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++; } return j + 1; }

// Find the index of the next char in `stops` at top level (not in comment/string/parens).
function scanTo(i, stops) {
    let depth = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        if (c === '"' || c === "'") { i = skipString(i); continue; }
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (depth === 0 && stops.includes(c)) return i;
        i++;
    }
    return i;
}

const rules = []; // { selector, context, start, end, bodyStart, bodyEnd, decls: [...] }
function parseBlock(i, end, context, inKeyframes) {
    while (i < end) {
        // skip whitespace and comments
        while (i < end && /\s/.test(src[i])) i++;
        if (i >= end) break;
        if (src[i] === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        if (src[i] === '}') return i;
        const preludeStart = i;
        const brace = scanTo(i, '{;}');
        if (src[brace] === ';') { i = brace + 1; continue; } // @import-like statement
        if (src[brace] === '}') return brace;
        const prelude = src.slice(preludeStart, brace).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
        const bodyStart = brace + 1;
        if (prelude.startsWith('@')) {
            const keyframes = /^@(-webkit-)?keyframes/.test(prelude);
            const close = parseBlock(bodyStart, end, [...context, prelude], keyframes);
            i = close + 1;
            continue;
        }
        const close = scanTo(bodyStart, '}');
        if (!inKeyframes) rules.push({ selector: prelude.replace(/\s*,\s*/g, ', '), context: context.join(' | '),
            start: preludeStart, end: close + 1, bodyStart, bodyEnd: close, decls: parseDecls(bodyStart, close) });
        i = close + 1;
    }
    return i;
}

function parseDecls(start, end) {
    const decls = [];
    let i = start;
    while (i < end) {
        while (i < end && /\s/.test(src[i])) i++;
        if (i >= end) break;
        if (src[i] === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        const semi = Math.min(scanTo(i, ';}'), end);
        const text = src.slice(i, semi);
        const colon = text.indexOf(':');
        if (colon > 0) {
            const prop = text.slice(0, colon).trim().toLowerCase();
            let value = text.slice(colon + 1).trim();
            const important = /!\s*important\s*$/i.test(value);
            value = value.replace(/!\s*important\s*$/i, '').trim();
            decls.push({ prop, value, important, start: i, end: semi < end ? semi + 1 : semi });
        }
        i = semi + 1;
    }
    return decls;
}

parseBlock(0, src.length, [], false);

// ---- analysis -----------------------------------------------------------------
const newerValue = /\b(\d*\.?\d+)(dvh|svh|lvh|dvw|svw|lvw|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax)\b|color-mix\(|oklch\(|oklab\(|\blab\(|\blch\(|\bcolor\(|round\(|light-dark\(|anchor\(/i;
const newerSelector = /:has\(|:user-invalid|:popover-open|::backdrop|:modal/i;

const byKey = new Map();
rules.forEach((rule, index) => {
    const key = rule.context + ' || ' + rule.selector;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(index);
});

const removals = new Set(); // "ruleIndex:declIndex"
const report = [];
for (const [key, indexes] of byKey) {
    // Walk every declaration in source order; for each, look for a later winner.
    const all = indexes.flatMap(ri => rules[ri].decls.map((decl, di) => ({ ri, di, decl })));
    for (let a = 0; a < all.length; a++) {
        const early = all[a];
        const later = all.slice(a + 1).filter(item => item.decl.prop === early.decl.prop);
        const winner = later.find(item => (item.decl.important || !early.decl.important) && (
            item.decl.value === early.decl.value && item.decl.important === early.decl.important
            || (!newerValue.test(item.decl.value) && !newerSelector.test(rules[item.ri].selector))));
        if (!winner) continue;
        removals.add(`${early.ri}:${early.di}`);
        report.push({ key, prop: early.decl.prop, removed: early.decl.value + (early.decl.important ? ' !important' : ''),
            keptAt: src.slice(0, rules[winner.ri].start).split('\n').length, line: src.slice(0, early.decl.start).split('\n').length });
    }
}

// ---- rewrite ----------------------------------------------------------------------
// Collect text edits (start, end) to delete, expanding whole-line deletions to the line.
const edits = [];
function lineSpan(start, end) {
    const lineStart = src.lastIndexOf('\n', start - 1) + 1;
    const before = src.slice(lineStart, start);
    let lineEnd = src.indexOf('\n', end); if (lineEnd < 0) lineEnd = src.length;
    const after = src.slice(end, lineEnd);
    if (/^\s*$/.test(before) && /^\s*$/.test(after)) return [lineStart, Math.min(lineEnd + 1, src.length)];
    let e = end; while (src[e] === ' ') e++;
    return [start, e];
}
let emptied = 0;
rules.forEach((rule, ri) => {
    const gone = rule.decls.map((_, di) => removals.has(`${ri}:${di}`));
    const body = src.slice(rule.bodyStart, rule.bodyEnd);
    // Rules that were already empty have no effect either.
    if (!rule.decls.length && !body.trim()) gone.push(true);
    if (!gone.some(Boolean)) return;
    const hasComment = /\/\*/.test(body);
    if (gone.every(Boolean) && !hasComment) {
        // Remove the whole rule plus one following blank line.
        let s = src.lastIndexOf('\n', rule.start - 1) + 1;
        if (!/^\s*$/.test(src.slice(s, rule.start))) s = rule.start;
        let e = rule.end; const nl = src.indexOf('\n', e);
        if (nl >= 0 && /^\s*$/.test(src.slice(e, nl))) { e = nl + 1; const nl2 = src.indexOf('\n', e); if (nl2 >= 0 && /^\s*$/.test(src.slice(e, nl2))) e = nl2 + 1; }
        edits.push([s, e]); emptied++;
        return;
    }
    rule.decls.forEach((decl, di) => { if (gone[di]) edits.push(lineSpan(decl.start, decl.end)); });
});
edits.sort((a, b) => b[0] - a[0]);
let out = src;
for (const [s, e] of edits) out = out.slice(0, s) + out.slice(e);

writeFileSync(output, out);
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ rules: rules.length, declarations: rules.reduce((n, r) => n + r.decls.length, 0),
    removedDeclarations: removals.size, removedRules: emptied, linesBefore: src.split('\n').length, linesAfter: out.split('\n').length }));
