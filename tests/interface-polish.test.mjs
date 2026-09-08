import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchHelpArticles } from '../src/features/help-guide.js';
import { createOperationFeedback } from '../src/ui/operation-feedback.js';

test('manual search includes detailed body text, supports multiple terms and ignores case', () => {
    assert.ok(searchHelpArticles('401').includes('manual-api'));
    assert.deepEqual(searchHelpArticles('embedding'), searchHelpArticles('EMBEDDING'));
    assert.ok(searchHelpArticles('自动 标签').includes('manual-auto'));
    assert.deepEqual(searchHelpArticles('绝对不存在的关键词123456'), []);
    assert.deepEqual(searchHelpArticles('   '), []);
    assert.deepEqual(searchHelpArticles('<img onerror=alert(1)>'), []);
});

function feedbackFixture() {
    const nodes = new Map();
    const timers = new Map();
    let nextTimer = 0;
    function element() {
        return { attrs: {}, children: [], classList: { remove() {}, toggle() {} },
            setAttribute(k, v) { this.attrs[k] = v; },
            appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); },
            remove() { nodes.delete(this.id); },
        };
    }
    const root = element();
    nodes.set('bakemono-workbench-root', root);
    const feedback = createOperationFeedback({
        documentRef: { getElementById: id => nodes.get(id), createElement: element },
        windowRef: { setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); } },
    });
    return { feedback, nodes, timers, toast: () => nodes.get('bakemono-memory-operation-toast') };
}

test('error notice stays readable until dismissed and uses text nodes for remote error messages', () => {
    const { feedback, toast, timers } = feedbackFixture();
    feedback.set('error', '<img src=x onerror=alert(1)>', 2600);
    assert.equal(timers.size, 0);
    assert.equal(toast().children[1].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(toast().children[2].attrs['aria-label'], '关闭提示');
    toast().children[2].onclick();
    assert.equal(toast(), undefined);
});

test('success feedback still expires and replaces an older timer', () => {
    const { feedback, toast, timers } = feedbackFixture();
    feedback.set('success', '完成', 1200);
    assert.equal(timers.size, 1);
    feedback.set('running', '正在保存');
    assert.equal(timers.size, 0);
    assert.equal(toast().className, 'bakemono-memory-operation-toast is-running');
    feedback.clear();
    assert.equal(toast(), undefined);
});

test('interface enhancements are scoped, reduced-motion safe, and do not load remote runtime dependencies', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const polish = css.slice(css.indexOf('/* Workbench interaction surfaces */'));
    assert.ok(polish.length > 1000);
    assert.match(polish, /prefers-reduced-motion: reduce/);
    assert.match(polish, /hover: hover/);
    assert.match(polish, /pointer: coarse/);
    assert.doesNotMatch(polish, /transition:\s*all|backdrop-filter|will-change|@import|url\(/);
    const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    assert.equal(html.match(/id="bakemono-memory-help-search"/g)?.length, 1);
    assert.ok(html.indexOf('id="bakemono-memory-help-search"') > html.indexOf('data-bakemono-panel="help"'));
});
