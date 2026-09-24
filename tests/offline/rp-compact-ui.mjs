import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRpStateUi } from '../../src/features/rp-state-ui.js';
import { runtimeHost } from '../helpers/rp-runtime-host.mjs';
const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const { document, window } = parseHTML(await readFile(new URL('../../settings.html', import.meta.url), 'utf8'));
const h = runtimeHost(); await h.service.enable();
const block = events => '<rpEvents>' + JSON.stringify({ version: 2, events }) + '</rpEvents>';
h.chat[0].mes = '甲和乙在书店，甲仍胃痛却说没事。' + block([
    { action: 'clock_set', data: { date: '2024-04-12T23:45' } },
    { action: 'person_registered', data: { id: '甲', name: '甲' } }, { action: 'person_registered', data: { id: '乙', name: '乙' } },
    { action: 'scene_recorded', data: { location: '书店', present: ['甲', '乙'] } },
    { action: 'person_state_started', data: { id: '甲', stateId: 'pain', description: '胃痛仍在', visibility: 'private' } },
    { action: 'item_registered', data: { id: '钥匙', name: '钥匙', owner: '甲', holder: '乙' } },
    { track: 'claims', data: { speaker: '甲', subject: '甲', description: '我没事', heardBy: ['乙'] } },
]);
await h.flow.captureInline();
const root = document.querySelector('#bakemono-rp-root'), esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ui = createRpStateUi({ documentRef: document, getState: () => h.state, service: h.service, flow: h.flow, navigate() {}, escapeHtml: esc, promptLibrary: h.library,
    getContextPreview: () => h.injection.getInjectionMemoryParts().rpContext });
const click = async selector => { const node = root.querySelector(selector); assert.ok(node, selector); node.dispatchEvent(new window.Event('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(root.querySelector('[role=alert]'), null, root.textContent); };
ui.bind(); ui.render();
assert.equal(root.querySelectorAll('.rp-story-sheet').length, 1);
assert.equal(root.querySelector('.rp-story-time').textContent, '23:45');
assert.match(root.querySelector('.rp-story-person').textContent, /胃痛仍在/);
assert.match(root.querySelector('.rp-story-information').textContent, /我没事.*说法/);
assert.doesNotMatch(root.textContent, /entity:|temporary:|暂无记录|让故事/);
await click('[data-rp-action=context-preview]');
assert.match(root.querySelector('.rp-context-page').textContent, /字符/);
assert.doesNotMatch(root.textContent, /entity:|temporary:/);
assert.equal(document.querySelector('dialog, .rp-preview-overlay'), null);
await click('[data-rp-action=tab]');
const scroll = root.closest('.bakemono-workbench-main');
scroll.scrollTop = 320;
await click('[data-rp-action=directory]');
assert.equal(scroll.scrollTop, 0);
assert.equal(root.querySelector('.rp-breadcrumb h3').textContent, '全部记录');
assert.ok(root.querySelector('.rp-directory-search'));
assert.ok(root.querySelector('.rp-directory-filters'));
assert.ok(root.innerHTML.indexOf('rp-directory-search') < root.innerHTML.indexOf('rp-directory-filters'));
assert.equal(root.querySelector('[data-rp-group=people] .rp-directory-avatar').textContent, '甲');
assert.match(root.querySelector('[data-rp-group=people] .rp-directory-row').textContent, /胃痛仍在/);
assert.match(root.querySelector('.rp-directory-count').textContent, /5 条/);
root.querySelector('[data-rp-search]').value = '胃痛';
await click('[data-rp-action=search]');
assert.equal(root.querySelectorAll('.rp-directory-row').length, 1);
assert.match(root.querySelector('.rp-directory-count').textContent, /1 条/);
root.querySelector('.rp-directory-filters').scrollLeft = 150;
await click('[data-rp-filter=claims]');
assert.equal(root.querySelector('.rp-directory-filters').scrollLeft, 150);
assert.equal(root.querySelectorAll('.rp-directory-row').length, 1);
await click('[data-rp-filter=""]');
assert.ok(root.querySelector('.rp-directory-list [data-rp-kind=items]'));
assert.ok(root.querySelector('.rp-directory-list [data-rp-kind=claims]'));
await click('.rp-directory-list [data-rp-kind=claims]');
assert.match(root.textContent, /明确知情者.*乙/);
await click('[data-rp-action=edit-open]');
assert.equal(root.querySelector('[data-rp-edit-field=heardBy]').value, '乙');
root.querySelector('[data-rp-edit-field=heardBy]').value = '甲\n乙';
await click('[data-rp-action=edit-save]');
assert.equal(h.state.rpCore.claims.at(-1).data.heardBy.length, 2);
await click('[data-rp-action=back]');
await click('[data-rp-action=tab]');
for (let i = 0; i < 25; i++) await h.service.editEntity('people', '', { name: '路人' + i }, { create: true });
ui.render(); assert.equal(root.querySelectorAll('.rp-story-person').length, 2);
await click('[data-rp-action=directory]');
assert.equal(root.querySelectorAll('.rp-directory-list [data-rp-action=detail]').length, 20);
await click('[data-rp-action=next]'); assert.ok(root.querySelector('.rp-directory-list [data-rp-kind=items]'));
h.state.rpCore.extractionJobs = [{ status: 'failed' }];
ui.render();
const maintenance = root.querySelector('.rp-directory-maintenance');
assert.ok(maintenance); assert.equal(maintenance.hasAttribute('open'), false);
assert.match(maintenance.textContent, /来源楼层未记录：提取未完成/);
assert.ok(root.innerHTML.indexOf('rp-directory-list') < root.innerHTML.indexOf('rp-directory-maintenance'));
h.state.rpCore.extractionJobs = [{ status: 'failed', sourceFloor: 0, errorClass: 'invalid_json' }];
ui.render();
assert.match(root.querySelector('.rp-directory-maintenance').textContent, /第 0 楼：事件 JSON 格式无效/);
console.log('PASS: compact overview, state/claim separation, safe in-panel preview, mixed directory routes, audience editing, pagination; offline DOM only.');
