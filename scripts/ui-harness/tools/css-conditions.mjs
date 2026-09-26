// List the attributes JavaScript sets and the classes it toggles at runtime. Selectors using
// them depend on state; everything else in static markup is fixed.
// Usage: node css-conditions.mjs <repo-root> <out.json>
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const [,, repo, outPath] = process.argv;
const files = [join(repo, 'index.js')];
(function walk(dir) { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(join(repo, 'src'));
const js = files.map(f => readFileSync(f, 'utf8')).join('\n');
const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const attributes = new Set(['open', 'hidden', 'disabled', 'checked', 'selected', 'readonly', 'aria-expanded', 'aria-hidden',
    'aria-selected', 'aria-current', 'aria-pressed', 'aria-invalid', 'aria-busy', 'value', 'style', 'class']);
for (const m of js.matchAll(/(?:setAttribute|removeAttribute|toggleAttribute|\.attr|\.prop|\.removeAttr)\(\s*['"`]([\w-]+)['"`]/g)) attributes.add(m[1].toLowerCase());
for (const m of js.matchAll(/\.dataset\.(\w+)\s*(?:=[^=]|\?\?=|\|\|=)/g)) attributes.add('data-' + kebab(m[1]));
for (const m of js.matchAll(/delete\s+[\w.]+\.dataset\.(\w+)/g)) attributes.add('data-' + kebab(m[1]));
for (const m of js.matchAll(/delete\s+[\w.]+\.dataset\[/g)) attributes.add('data-*');
for (const m of js.matchAll(/\.dataset\[/g)) attributes.add('data-*');
const classes = new Set();
const addTokens = text => (text.match(/-?[_a-zA-Z][\w-]*/g) || []).forEach(t => classes.add(t));
for (const m of js.matchAll(/classList\.(?:add|remove|toggle|replace)\(([^)]*)\)/g)) for (const s of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) addTokens(s[1]);
for (const m of js.matchAll(/\.(?:toggleClass|addClass|removeClass)\(\s*(['"`])([^'"`]+)\1/g)) addTokens(m[2]);
for (const m of js.matchAll(/\.className\s*=\s*(['"`])([\s\S]{0,300}?)\1/g)) addTokens(m[2].replace(/\$\{[^}]*\}/g, ' '));
writeFileSync(outPath, JSON.stringify({ attributes: [...attributes], classes: [...classes] }));
console.log(JSON.stringify({ attributes: [...attributes].sort(), toggledClasses: classes.size }));
