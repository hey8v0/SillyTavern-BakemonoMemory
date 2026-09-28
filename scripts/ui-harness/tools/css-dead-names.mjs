// Names in style.css selectors that no code mentions. A name counts as possibly built at runtime when some
// Usage (repo root): node scripts/ui-harness/tools/css-dead-names.mjs > dead.json — review maybeBuilt by hand before dropping anything.
// prefix of it (cut at a '-') is followed in the code by `${`, `' +`, `" +` or `-' +` (e.g. `is-${tone}`).
import fs from 'node:fs'; import path from 'node:path';
const css = fs.readFileSync('style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const code = ['settings.html', 'index.js', ...walk('src').filter(f => f.endsWith('.js'))].map(f => fs.readFileSync(f, 'utf8')).join('\n');
const selectors = css.replace(/\{[^{}]*\}/g, '{}');
const names = re => [...new Set((selectors.match(re) || []).map(s => s.slice(1)))];
function built(name) {
    const parts = name.split('-');
    for (let i = 1; i < parts.length; i++) {
        const prefix = parts.slice(0, i).join('-') + '-';
        if (code.includes(prefix + '${') || code.includes(prefix + "' +") || code.includes(prefix + '" +') || code.includes(prefix + "'+")) return prefix;
    }
    return '';
}
const report = list => list.filter(n => !code.includes(n)).map(n => ({ name: n, built: built(n) }));
const classes = report(names(/\.[a-zA-Z_][\w-]*/g)), ids = report(names(/#[a-zA-Z_][\w-]*/g));
console.log(JSON.stringify({ dead: classes.filter(x => !x.built).map(x => x.name), maybeBuilt: classes.filter(x => x.built),
    deadIds: ids.filter(x => !x.built).map(x => x.name), maybeBuiltIds: ids.filter(x => x.built) }, null, 1));
