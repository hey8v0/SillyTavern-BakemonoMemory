import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('decorative tape stripes are gone; only the custom theme texture keeps a repeating gradient', async () => {
    const css = await read('style.css');
    assert.equal((css.match(/repeating-linear-gradient/g) || []).length, 1);
    assert.match(css, /\.bakemono-workbench-root\.bakemono-custom-theme \.bakemono-workbench \{[^}]*repeating-linear-gradient/);
});

test('every primary action uses the accent colour', async () => {
    const css = await read('style.css');
    for (const selector of ['.bakemono-memory-turn-status-actions .bakemono-memory-turn-primary', '.bakemono-memory-vector-index-primary,']) {
        const rule = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
        assert.match(rule, /background: var\(--bk-accent\) !important;/, selector);
        assert.doesNotMatch(rule, /background: var\(--SmartThemeBodyColor\)/, selector);
    }
});

test('the header badge has one base rule plus one rule per breakpoint', async () => {
    const css = await read('style.css');
    assert.equal((css.match(/^\s*\.bakemono-memory-badge \{/gm) || []).length, 3);
});

test('the open-menu toggle is a collapse arrow, not a second close button', async () => {
    const source = await read('src/ui/workbench-navigation.js');
    assert.match(source, /toggle\('fa-angles-left', !!open\)/);
    assert.doesNotMatch(source, /fa-xmark/);
});

test('overview and data hub carry no decorative codes or English labels', async () => {
    const html = await read('settings.html');
    assert.doesNotMatch(html, /MEMORY STATUS|SC\. 00|bakemono-memory-hub-ticket-number/);
    assert.match(html, /<\/i> 记忆状态<\/span>/);
    assert.match(html, /<dt>条目<\/dt><dd id="bakemono-memory-prompt-inspector-count">/);
});
