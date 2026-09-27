import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Source-text contracts cannot see a syntax slip; load every module so one breaks here instead of in the host.
const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(dir, entry.name)) : entry.name.endsWith('.js') ? [join(dir, entry.name)] : []);

test('every source module parses and loads', async () => {
    const failures = [];
    for (const file of files(root)) {
        try { await import(pathToFileURL(file).href); } catch (error) { failures.push(`${relative(root, file)}: ${error.message}`); }
    }
    assert.deepEqual(failures, []);
});
