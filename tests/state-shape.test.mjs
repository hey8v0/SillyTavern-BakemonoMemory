import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../', import.meta.url);

function toDataModule(source) {
    return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function loadModule(path) {
    const source = await readFile(new URL(path, repoUrl), 'utf8');
    return await import(toDataModule(source));
}

test('missing defaults fill only undefined fields and deep-clone values', async () => {
    const shape = await loadModule('src/core/state-shape.js');
    const defaults = {
        enabled: true,
        count: 4,
        nullable: 'default',
        nested: { values: [1, 2] },
    };
    const target = {
        enabled: false,
        count: 0,
        nullable: null,
    };

    const result = shape.fillMissingDefaults(target, defaults);

    assert.equal(result, target);
    assert.deepEqual(target, {
        enabled: false,
        count: 0,
        nullable: null,
        nested: { values: [1, 2] },
    });
    assert.notEqual(target.nested, defaults.nested);
    assert.notEqual(target.nested.values, defaults.nested.values);
    target.nested.values.push(3);
    assert.deepEqual(defaults.nested.values, [1, 2]);
});

test('array normalization preserves valid arrays and replaces invalid fields independently', async () => {
    const shape = await loadModule('src/core/state-shape.js');
    const existing = [{ id: 'keep' }];
    const target = {
        blocks: existing,
        drafts: null,
        history: 'invalid',
    };

    const result = shape.normalizeArrayFields(target, ['blocks', 'drafts', 'history', 'tasks']);

    assert.equal(result, target);
    assert.equal(target.blocks, existing);
    assert.deepEqual(target.drafts, []);
    assert.deepEqual(target.history, []);
    assert.deepEqual(target.tasks, []);
    assert.notEqual(target.drafts, target.history);
    assert.notEqual(target.history, target.tasks);
});

test('object field normalization preserves object-like values and deep-clones invalid containers', async () => {
    const shape = await loadModule('src/core/state-shape.js');
    const existing = { keep: true };
    const legacyArray = [];
    const defaults = { nested: { values: [1] } };
    const target = {
        valid: existing,
        legacyArray,
        missing: null,
        invalid: 'bad',
    };

    assert.equal(shape.ensureObjectField(target, 'valid', defaults), existing);
    assert.equal(shape.ensureObjectField(target, 'legacyArray', defaults), legacyArray);

    const missing = shape.ensureObjectField(target, 'missing', defaults);
    const invalid = shape.ensureObjectField(target, 'invalid', defaults);

    assert.deepEqual(missing, defaults);
    assert.deepEqual(invalid, defaults);
    assert.notEqual(missing, defaults);
    assert.notEqual(missing.nested, defaults.nested);
    assert.notEqual(missing.nested.values, defaults.nested.values);
    assert.notEqual(missing, invalid);
});
