import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../', import.meta.url);

function toDataModule(source) {
    return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function loadModule(path, replacements = []) {
    let source = await readFile(new URL(path, repoUrl), 'utf8');
    for (const [from, to] of replacements) {
        source = source.replace(from, to);
    }
    return await import(toDataModule(source));
}

async function loadSchemaModule() {
    const textSource = await readFile(new URL('src/shared/text.js', repoUrl), 'utf8');
    const textUrl = toDataModule(textSource);
    return await loadModule('src/tables/schema-utils.js', [
        ["'../shared/text.js'", `'${textUrl}'`],
    ]);
}

test('injection templates remove duplicate wrappers and render one clean copy', async () => {
    const injection = await loadModule('src/shared/injection-template.js');
    const fallback = '<memory>\n{{memory}}\n</memory>';
    const custom = 'BEGIN\n{{memory}}\nEND';
    const wrapped = 'BEGIN\r\nBEGIN\r\nRemember Nana\r\nEND\r\nEND';

    assert.equal(
        injection.normalizeInjectionMemoryBody(wrapped, custom, fallback),
        'Remember Nana',
    );
    assert.equal(
        injection.renderInjectionTemplate(wrapped, custom, fallback),
        'BEGIN\nRemember Nana\nEND',
    );
    assert.equal(
        injection.normalizeInjectionMemoryBody('<memory>\nRemember Nana\n</memory>', custom, fallback),
        'Remember Nana',
    );
    assert.equal(injection.renderInjectionTemplate('', custom, fallback), '');
    assert.equal(
        injection.renderInjectionTemplate('Remember Nana', 'Memory follows:', fallback),
        'Memory follows:\n\nRemember Nana',
    );
});

test('recognized legacy injection defaults gain a closing marker and front-of-history depth', async () => {
    const injection = await loadModule('src/shared/injection-template.js');
    const legacyTemplate = 'BEGIN\n{{memory}}';
    const nextTemplate = 'BEGIN\n{{memory}}\nEND';
    const settings = { enabled: true, depth: 4, template: legacyTemplate };

    assert.equal(injection.migrateBuiltInInjectionDefaults(settings, legacyTemplate, nextTemplate), true);
    assert.deepEqual(settings, { enabled: true, depth: 999, template: nextTemplate });

    const custom = { enabled: false, depth: 4, template: 'CUSTOM\n{{memory}}' };
    assert.equal(injection.migrateBuiltInInjectionDefaults(custom, legacyTemplate, nextTemplate), false);
    assert.deepEqual(custom, { enabled: false, depth: 4, template: 'CUSTOM\n{{memory}}' });
});
