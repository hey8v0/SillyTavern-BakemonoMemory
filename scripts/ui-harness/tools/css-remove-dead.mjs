// Merge cascade analyses and delete declarations that never win at any analyzed width.
// Usage: node css-remove-dead.mjs <style.css> <rules.json> <out.css> <cascade-*.json...>
// Rule indexes come from css-export.mjs, which parses the same file in the same order.
import { readFileSync, writeFileSync } from 'node:fs';
const [,, cssPath, rulesPath, outPath, ...analyses] = process.argv;
const src = readFileSync(cssPath, 'utf8');
const exported = JSON.parse(readFileSync(rulesPath, 'utf8'));
const alive = new Set(), matched = new Set();
for (const file of analyses) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data.alive.forEach(k => alive.add(k)); data.matched.forEach(i => matched.add(i));
}

// Same scanner as css-export.mjs, recording source spans.
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
const rules = [];
function parseDecls(start, end) {
    const decls = []; let i = start;
    while (i < end) {
        while (i < end && /\s/.test(src[i])) i++;
        if (i >= end) break;
        if (src[i] === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        const semi = Math.min(scanTo(i, ';}'), end);
        const text = src.slice(i, semi);
        if (text.indexOf(':') > 0) decls.push({ prop: text.slice(0, text.indexOf(':')).trim().toLowerCase(), start: i, end: semi < end ? semi + 1 : semi });
        i = semi + 1;
    }
    return decls;
}
function block(i, end, kf) {
    while (i < end) {
        while (i < end && /\s/.test(src[i])) i++;
        if (i >= end) break;
        if (src[i] === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        if (src[i] === '}') return i;
        const b = scanTo(i, '{;}');
        if (src[b] !== '{') { i = b + 1; continue; }
        const prelude = src.slice(i, b).replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (prelude.startsWith('@')) { i = block(b + 1, end, /keyframes/.test(prelude)) + 1; continue; }
        const close = scanTo(b + 1, '}');
        if (!kf) rules.push({ start: i, end: close + 1, bodyStart: b + 1, bodyEnd: close, decls: parseDecls(b + 1, close) });
        i = close + 1;
    }
    return i;
}
block(0, src.length, false);
if (rules.length !== exported.length) throw Error(`rule count mismatch ${rules.length} vs ${exported.length}`);

const edits = []; let removedDecls = 0, removedRules = 0; const byProp = {};
rules.forEach((rule, ri) => {
    const meta = exported[ri];
    if (meta.decls.length !== rule.decls.length) throw Error('declaration mismatch at rule ' + ri);
    if (!matched.has(ri) || meta.dynamicClasses.length) return;
    const dead = rule.decls.map((decl, di) => !decl.prop.startsWith('--') && !alive.has(`${ri}:${di}`));
    if (!dead.some(Boolean)) return;
    const body = src.slice(rule.bodyStart, rule.bodyEnd);
    dead.forEach((d, di) => { if (d) { removedDecls++; byProp[rule.decls[di].prop] = (byProp[rule.decls[di].prop] || 0) + 1; } });
    if (dead.every(Boolean) && !/\/\*/.test(body)) {
        let s = src.lastIndexOf('\n', rule.start - 1) + 1;
        if (!/^\s*$/.test(src.slice(s, rule.start))) s = rule.start;
        let e = rule.end; const nl = src.indexOf('\n', e);
        if (nl >= 0 && /^\s*$/.test(src.slice(e, nl))) { e = nl + 1; const nl2 = src.indexOf('\n', e); if (nl2 >= 0 && /^\s*$/.test(src.slice(e, nl2))) e = nl2 + 1; }
        edits.push([s, e]); removedRules++; return;
    }
    rule.decls.forEach((decl, di) => {
        if (!dead[di]) return;
        const lineStart = src.lastIndexOf('\n', decl.start - 1) + 1;
        let lineEnd = src.indexOf('\n', decl.end); if (lineEnd < 0) lineEnd = src.length;
        if (/^\s*$/.test(src.slice(lineStart, decl.start)) && /^\s*$/.test(src.slice(decl.end, lineEnd))) edits.push([lineStart, lineEnd + 1]);
        else { let e = decl.end; while (src[e] === ' ') e++; edits.push([decl.start, e]); }
    });
});
edits.sort((a, b) => b[0] - a[0]);
let out = src;
for (const [s, e] of edits) out = out.slice(0, s) + out.slice(e);
writeFileSync(outPath, out);
const top = Object.entries(byProp).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(JSON.stringify({ removedDecls, removedRules, linesBefore: src.split('\n').length, linesAfter: out.split('\n').length, top }));
