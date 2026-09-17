import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInjectionPreview } from '../../src/features/injection-preview.js';
const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const { parse, walk, generate } = await import(process.env.BAKEMONO_TEST_CSS_TREE || 'css-tree');
const html = await readFile(new URL('../../settings.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../../style.css', import.meta.url), 'utf8');
const ast = parse(css);
const { document, window } = parseHTML(html);
let nativeOpens = 0;
let failNativeOpen = false;
const viewport = new window.EventTarget();
Object.assign(viewport, { width: 390, height: 720, offsetTop: 0, offsetLeft: 0 });
Object.defineProperty(window, 'visualViewport', { value: viewport });
window.HTMLElement.prototype.showModal = function () {
    assert.equal(this.tagName, 'DIALOG');
    if (failNativeOpen) throw new Error('unsupported');
    nativeOpens++;
    this.setAttribute('open', '');
};
window.HTMLElement.prototype.close = function () { this.removeAttribute('open'); };
window.getComputedStyle = () => ({ getPropertyValue: name => ({
    '--bk-paper': '#faf6ee', '--SmartThemeBodyColor': '#30291f', 'font-family': 'serif',
}[name] || '') });
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
    windowRef: window,
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
    assert.equal(overlay().getAttribute('role'), 'dialog');
    assert.equal(overlay().parentElement, document.body, 'portal escapes scrolling/transformed workbench');
    assert.equal(root.querySelector('.bakemono-workbench').hasAttribute('inert'), false, 'never manually lock workbench');
    assert.equal(overlay().style.height, '720px');
    assert.equal(overlay().style.getPropertyValue('--bk-paper'), '#faf6ee', 'portal retains selected warm-paper palette');
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
assert.equal(nativeOpens, 6);
const table = root.querySelector('[data-bakemono-token-source="table"]');
sources.table = '<img src=x onerror=alert(1)><script>secret()</script>' + '长'.repeat(100000);
click(table);
assert.equal(contentText(), sources.table);
assert.equal(popup().querySelector('img,script'), null, 'private text is never treated as markup');
click(overlay());
assert.equal(popup(), null);
// The old overlay only handled clicks on itself, leaving uncovered blank space inert.
click(table);
let clickThrough = 0;
const backgroundClick = () => clickThrough++;
window.addEventListener('click', backgroundClick);
click(document.body);
assert.equal(popup(), null, 'outside click dismisses even outside overlay bounds');
assert.equal(clickThrough, 0, 'dismiss gesture does not trigger underlying actions');
window.removeEventListener('click', backgroundClick);
for (const [width, height] of [[360, 640], [390, 720], [430, 932], [844, 390]]) {
    Object.assign(viewport, { width, height, offsetTop: 24, offsetLeft: 8 });
    click(table);
    viewport.dispatchEvent(new window.Event('resize'));
    assert.equal(overlay().style.top, '24px');
    assert.equal(overlay().style.left, '8px');
    assert.equal(overlay().style.width, width + 'px');
    assert.equal(overlay().style.height, height + 'px');
    assert.equal(overlay().style.getPropertyValue('--bk-preview-max-height'), Math.min(680, height - 48) + 'px');
    const detached = overlay();
    key('Escape');
    viewport.height += 50;
    viewport.dispatchEvent(new window.Event('resize'));
    assert.equal(detached.style.height, height + 'px', 'resize listener removed on close');
}
failNativeOpen = true;
click(table);
assert.ok(overlay().hasAttribute('open'), 'fallback remains available if native dialog fails');
assert.equal(root.querySelector('.bakemono-workbench').hasAttribute('inert'), false);
click(document.body);
assert.equal(popup(), null);
failNativeOpen = false;
const showModal = window.HTMLElement.prototype.showModal;
delete window.HTMLElement.prototype.showModal;
click(table);
assert.ok(overlay().hasAttribute('open'), 'older hosts without showModal retain a dismissible preview');
click(popup().querySelector('button'));
assert.equal(popup(), null);
window.HTMLElement.prototype.showModal = showModal;
click(table);
const oldDialog = overlay();
ui.close();
click(table);
oldDialog.dispatchEvent(new window.Event('close'));
assert.ok(popup(), 'delayed close event from previous dialog cannot close the next preview');
ui.close();
click(table);
overlay().dispatchEvent(new window.Event('cancel', { cancelable: true }));
assert.equal(popup(), null, 'native cancel always releases modal');
click(table);
overlay().dispatchEvent(new window.Event('close'));
assert.equal(popup(), null, 'native close clears listeners and workbench scroll lock');
assert.equal(root.classList.contains('has-injection-preview'), false);
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
assert.match(rules.get('.bakemono-injection-preview'), /max-height:var\(--bk-preview-max-height/);
assert.match(rules.get('.bakemono-injection-preview'), /min-height:0/);
assert.match(rules.get('.bakemono-injection-preview'), /grid-template-rows:auto auto minmax\(0,1fr\)/);
assert.match(rules.get('.bakemono-injection-preview-body'), /overflow:auto/);
assert.match(rules.get('.bakemono-injection-preview-body'), /overscroll-behavior:contain/);
assert.match(rules.get('.bakemono-injection-preview-body pre'), /white-space:pre-wrap/);
assert.match(rules.get('.bakemono-injection-preview-body pre'), /overflow-wrap:anywhere/);
assert.match(rules.get('.bakemono-memory-token-breakdown>button:nth-child(even)'), /border-left:/);
console.log('PASS: six module previews, fresh/empty/error data, safe long text, outside/Esc/close, focus loop, lifecycle cleanup and responsive CSS contracts.');
