// Export style rules (source order, keyframes excluded) for the in-browser cascade analyzer.
// Usage: node css-export.mjs <style.css> <repo-root> <out.json>
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const [,, cssPath, repo, outPath] = process.argv;
const src = readFileSync(cssPath, 'utf8');
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
    return parts.map(p => p.trim()).filter(Boolean);
}
const rules = [];
function parseDecls(start, end) {
    const decls = []; let i = start;
    while (i < end) {
        while (i < end && /\s/.test(src[i])) i++;
        if (i >= end) break;
        if (src[i] === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        const semi = Math.min(scanTo(i, ';}'), end);
        const text = src.slice(i, semi); const colon = text.indexOf(':');
        if (colon > 0) {
            let value = text.slice(colon + 1).trim();
            const important = /!\s*important\s*$/i.test(value);
            value = value.replace(/!\s*important\s*$/i, '').trim();
            decls.push({ prop: text.slice(0, colon).trim().toLowerCase(), value, important });
        }
        i = semi + 1;
    }
    return decls;
}
function block(i, end, context, kf) {
    while (i < end) {
        while (i < end && /\s/.test(src[i])) i++;
        if (i >= end) break;
        if (src[i] === '/' && src[i + 1] === '*') { i = skipComment(i); continue; }
        if (src[i] === '}') return i;
        const b = scanTo(i, '{;}');
        if (src[b] !== '{') { i = b + 1; continue; }
        const prelude = src.slice(i, b).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
        if (prelude.startsWith('@')) { i = block(b + 1, end, [...context, prelude], /keyframes/.test(prelude)) + 1; continue; }
        const close = scanTo(b + 1, '}');
        if (!kf) rules.push({ i: rules.length, parts: splitList(prelude), context, decls: parseDecls(b + 1, close) });
        i = close + 1;
    }
    return i;
}
block(0, src.length, [], false);

// Classes that appear anywhere in JavaScript may be rendered dynamically in states the analyzer cannot see.
const jsFiles = [];
(function walk(dir) { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) jsFiles.push(p); } })(join(repo, 'src'));
const js = [readFileSync(join(repo, 'index.js'), 'utf8'), ...jsFiles.map(f => readFileSync(f, 'utf8'))].join('\n');
// Only classes JavaScript renders onto elements count: class="…" in markup strings, className
// assignments and classList.add/toggle. Templated names contribute their literal prefix.
const rendered = new Set(), prefixes = new Set();
const addClassText = text => {
    for (const token of text.split(/\s+/)) {
        if (!token) continue;
        const cut = token.indexOf('${');
        if (cut >= 0) { const prefix = token.slice(0, cut).replace(/[^\w-]/g, ''); if (prefix.length >= 4) prefixes.add(prefix); }
        for (const word of token.replace(/\$\{[^}]*\}/g, ' ').match(/-?[_a-zA-Z][\w-]*/g) || []) rendered.add(word);
    }
};
for (const m of js.matchAll(/class=(\\?["'])((?:(?!\1)[\s\S]){0,400}?)\1/g)) addClassText(m[2]);
for (const m of js.matchAll(/className\s*[=:]\s*(['"`])([\s\S]{0,300}?)\1/g)) addClassText(m[2]);
for (const m of js.matchAll(/classList\.(?:add|toggle|replace)\(\s*(['"`])([^'"`]+)\1/g)) addClassText(m[2]);
for (const m of js.matchAll(/addClass\(\s*(['"`])([^'"`]+)\1/g)) addClassText(m[2]);
const isRendered = c => rendered.has(c) || [...prefixes].some(p => c.startsWith(p));
for (const rule of rules) {
    const classes = rule.parts.flatMap(p => [...p.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]));
    rule.dynamicClasses = [...new Set(classes.filter(isRendered))];
}
console.error('rendered classes:', rendered.size, 'prefixes:', [...prefixes].slice(0, 30).join(' '));
writeFileSync(outPath, JSON.stringify(rules));
const dynamic = rules.filter(r => r.dynamicClasses.length).length;
console.log(JSON.stringify({ rules: rules.length, dynamic, staticOnly: rules.length - dynamic }));
