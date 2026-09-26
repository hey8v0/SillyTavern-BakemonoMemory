// Compare two snapshot files; print differing elements/properties grouped by page.
import { readFileSync } from 'node:fs';
const [,, aPath, bPath, limitArg] = process.argv;
const a = JSON.parse(readFileSync(aPath, 'utf8')).result, b = JSON.parse(readFileSync(bPath, 'utf8')).result;
const limit = Number(limitArg || 40);
let total = 0; const lines = [];
for (const page of new Set([...Object.keys(a), ...Object.keys(b)])) {
    for (const part of new Set([...Object.keys(a[page] || {}), ...Object.keys(b[page] || {})])) {
        const x = a[page]?.[part] || {}, y = b[page]?.[part] || {};
        for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
            if (!x[key] || !y[key]) { total++; lines.push(`${page}/${part} ${x[key] ? 'REMOVED' : 'ADDED'} ${key.slice(-90)}`); continue; }
            for (const prop of Object.keys({ ...x[key], ...y[key] })) {
                if (x[key][prop] !== y[key][prop]) { total++; lines.push(`${page}/${part} ${key.slice(-70)} ${prop}: ${x[key][prop]} -> ${y[key][prop]}`); }
            }
        }
    }
}
console.log(`differences: ${total}`);
console.log(lines.slice(0, limit).join('\n'));
