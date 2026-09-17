import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInjectionPreview } from '../../src/features/injection-preview.js';
const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const { parse, walk, generate } = await import(process.env.BAKEMONO_TEST_CSS_TREE || 'css-tree');
const html = await readFile(new URL('../../settings.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../../style.css', import.meta.url), 'utf8');
const ast = parse(css);
const { document, window } = parseHTML(html);
// Linkedom has no layout/focus engine. This shim checks our focus routing, not browser layout.
let activeElement = null;
Object.defineProperty(document, 'activeElement', { get: () => activeElement });
window.HTMLElement.prototype.focus = function () { activeElement = this; };
const root = document.getElementById('bakemono-workbench-root');
root.setAttribute('aria-hidden', 'false');
root.classList.remove('bakemono-workbench-hidden');
let reads = 0;
let beforeOpens = 0;
let failRead = false;
let sources = Object.fromEntries(['rule', 'summary', 'memory', 'rpState', 'table', 'vector'].map(k => [k, k + '_private\n\n' + k + '_second']));
const ui = createInjectionPreview({ documentRef: document,
    getSources: () => { reads++; if (failRead) throw new Error('DO_NOT_SHOW_SECRET'); return sources; },
    beforeOpen: () => beforeOpens++ });
const click = element => element.dispatchEvent(new window.Event('click', { bubbles: true }));
const key = (value, shiftKey = false) => {
    const event = new window.Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperties(event, { key: { value }, shiftKey: { value: shiftKey } });
    document.dispatchEvent(event);
};
const popup = () => document.querySelector('#bakemono-injection-preview');
const overlay = () => document.querySelector('.bakemono-injection-preview-overlay');
const contentText = () => [...popup().querySelectorAll('pre')].map(el => el.textContent).join('');
ui.bind(root);
ui.bind(root);
for (const button of root.querySelectorAll('button[data-bakemono-token-source]')) {
    const sourceKey = button.dataset.bakemonoTokenSource;
    const before = reads;
    click(button.querySelector('span'));
    assert.equal(reads, before + 1, 'rebind does not duplicate handlers');
    assert.equal(contentText(), sources[sourceKey]);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(popup().getAttribute('role'), 'dialog');
    assert.equal(root.querySelector('.bakemono-workbench').hasAttribute('inert'), true);
    const closer = popup().querySelector('button');
    const body = popup().querySelector('.bakemono-injection-preview-body');
    assert.equal(activeElement, closer);
    key('Tab');
    assert.equal(activeElement, body);
    key('Tab', true);
    assert.equal(activeElement, closer);
    click(body);
    assert.ok(popup(), 'inside clicks keep popup open');
    key('Escape');
    assert.equal(popup(), null);
    assert.equal(activeElement, button);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(root.querySelector('.bakemono-workbench').hasAttribute('inert'), false);
}
assert.equal(beforeOpens, 6);
const table = root.querySelector('[data-bakemono-token-source="table"]');
sources.table = '<img src=x onerror=alert(1)><script>secret()</script>' + '长'.repeat(100000);
click(table);
assert.equal(contentText(), sources.table);
assert.equal(popup().querySelector('img,script'), null, 'private text is never treated as markup');
click(overlay());
assert.equal(popup(), null);
sources.table = '';
click(table);
assert.match(popup().textContent, /本轮没有此模块/);
assert.equal(popup().querySelectorAll('pre').length, 0);
click(popup().querySelector('button'));
failRead = true;
click(table);
assert.ok(popup().querySelector('[role="alert"]'));
assert.doesNotMatch(popup().textContent, /DO_NOT_SHOW_SECRET/);
ui.close({ restoreFocus: false });
failRead = false;
sources.table = 'fresh second chat';
click(table);
assert.equal(contentText(), sources.table);
ui.close({ restoreFocus: false });
assert.equal(popup(), null, 'lifecycle close removes private text');
const backdrop = root.querySelector('.bakemono-workbench-backdrop');
backdrop.setAttribute('inert', '');
click(table);
ui.bind(root);
assert.equal(popup(), null);
assert.equal(backdrop.hasAttribute('inert'), true, 'preexisting inert state preserved');
backdrop.removeAttribute('inert');
root.setAttribute('aria-hidden', 'true');
click(table);
assert.equal(popup(), null);
root.setAttribute('aria-hidden', 'false');
ui.destroy();
const beforeDestroyClick = reads;
click(table);
assert.equal(reads, beforeDestroyClick);
ui.bind(null);

// Check layout contracts in the real stylesheet, without claiming real-device visual QA.
const rules = new Map();
walk(ast, node => {
    if (node.type === 'Rule' && node.prelude?.type === 'SelectorList') {
        rules.set(generate(node.prelude), generate(node.block));
    }
});
assert.match(rules.get('.bakemono-injection-preview'), /width:min\(620px,100%\)/);
assert.match(rules.get('.bakemono-injection-preview'), /max-height:min\(680px,80dvh\)/);
assert.match(rules.get('.bakemono-injection-preview-body'), /overflow:auto/);
assert.match(rules.get('.bakemono-injection-preview-body'), /overscroll-behavior:contain/);
assert.match(rules.get('.bakemono-injection-preview-body pre'), /white-space:pre-wrap/);
assert.match(rules.get('.bakemono-injection-preview-body pre'), /overflow-wrap:anywhere/);
assert.match(rules.get('.bakemono-memory-token-breakdown>button:nth-child(even)'), /border-left:/);
console.log('PASS: six module previews, fresh/empty/error data, safe long text, outside/Esc/close, focus loop, lifecycle cleanup and responsive CSS contracts.');
