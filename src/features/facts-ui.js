import { countCardsByKind, factFieldHints, factFields, factKindLabels, factKinds } from '../facts/model.js';
import { renderFactsChanges, summarizeFactsChanges } from '../facts/diff.js';
import { renderOpenThreads } from '../facts/injection.js';

// 剧情事实 page: switches and the 整理 buttons, the reflection, then the cards (searchable, by kind, editable
// in place) or the history of every 整理. Same film-slate classes as 剧情状态.
export function createFactsUi({ documentRef: document, getState, controller, escapeHtml: esc, refresh = () => {}, navigate = () => {} }) {
    const navigation = new WeakMap();
    const nav = state => navigation.get(state) || navigation.set(state, { view: 'cards', filter: '', search: '', open: new Set(), editing: null, merging: null, adding: null }).get(state);
    const button = (action, label, extra = '', primary = false) => `<button type="button" class="menu_button${primary ? ' rp-primary' : ''}" data-facts-action="${action}" ${extra}><span>${esc(label)}</span></button>`;
    const link = (action, label, extra = '') => `<button type="button" class="rp-more" data-facts-action="${action}" ${extra}>${esc(label)} <span class="rp-chevron" aria-hidden="true">›</span></button>`;
    const switchRow = (key, title, detail, checked) => `<label class="rp-set-row"><span class="rp-set-text"><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span><input type="checkbox" role="switch" class="rp-switch" data-facts-setting="${key}" ${checked ? 'checked' : ''}></label>`;
    const numberRow = (key, title, detail, value, min, max) => `<label class="rp-set-row"><span class="rp-set-text"><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span><input type="number" class="text_pole" style="width:5em;flex:none" data-facts-setting="${key}" min="${min}" max="${max}" step="1" value="${esc(value)}"></label>`;
    const field = (name, label, value, { rows = 2, hint = '' } = {}) => `<label class="rp-edit-field"><span>${esc(label)}${hint ? ` <small>${esc(hint)}</small>` : ''}</span><textarea rows="${rows}" data-facts-field="${esc(name)}" spellcheck="false">${esc(value || '')}</textarea></label>`;
    const when = value => value ? new Date(value).toLocaleString() : '';
    const triggerLabel = { facts: '自动整理', manual: '手动整理', review: '审阅后应用', user: '你的修改', import: '导入' };

    function renderStatus(state, facts) {
        const pending = controller.pendingSummaries(state).length;
        const every = facts.settings.everySummaries;
        const queued = (state.taskQueue || []).filter(task => task.kind === 'facts' && ['queued', 'running'].includes(task.status)).length;
        const held = (state.drafts || []).filter(draft => draft.kind === 'facts').length;
        const total = facts.cards.filter(card => card.status === 'active').length;
        const lines = [];
        if (!facts.settings.enabled) lines.push(`还没开始记录。打开后，每攒够 ${every} 条剧情摘要，插件会把这段剧情里的人物、关系、物品和线索整理成卡片；聊天空闲时也会把剩下的整理掉。`);
        else {
            lines.push(`${total} 张卡片${facts.lastRunAt ? ` · 上次整理 ${when(facts.lastRunAt)}` : ' · 还没整理过'}`);
            lines.push(held ? `${held} 个整理结果在"待确认"等你看` : queued ? `${queued} 个整理任务在队列里`
                : pending ? `${pending} 条摘要还没整理${facts.settings.auto ? `，攒够 ${every} 条自动整理${facts.settings.idleMinutes ? `，空闲 ${facts.settings.idleMinutes} 分钟也会整理` : ''}` : ''}`
                : facts.settings.auto ? `摘要都整理过了，攒够 ${every} 条新摘要再整理` : '自动整理已关，需要时点"整理事实"');
            const blocked = controller.blockedBatch?.(state);
            if (blocked) lines.push(`第 ${blocked.floorFrom}–${blocked.floorTo} 楼这批整理失败了 ${blocked.failures} 次，没再自动重试；在队列里重试，或点"整理事实"`);
            const shorter = controller.chatShorterThanProgress?.(state);
            if (shorter) lines.push(`已整理到第 ${shorter.cursor} 楼，但这个聊天只有 ${shorter.lastFloor + 1} 楼（分支或删过楼层）：卡片里可能有之后才发生的事，可以在"变化"里逐次撤回`);
        }
        const latest = [...facts.history].reverse().find(item => !item.undone && item.trigger !== 'user');
        return `<section class="rp-overview"><p class="rp-note">${lines.map(esc).join('<br>')}</p>
            <div class="rp-set-list">${switchRow('enabled', '记录剧情事实', '关掉后不再整理，也不注入；已有卡片保留', facts.settings.enabled)}
            ${switchRow('auto', '自动整理', '攒够一批摘要就整理一次，每次 1 次请求', facts.settings.auto)}
            ${numberRow('everySummaries', '每攒几条摘要整理一次', '越小越新鲜、请求越多；最新一楼会等下一条消息后再算', facts.settings.everySummaries, 1, 50)}
            ${numberRow('idleMinutes', '空闲几分钟后把剩下的整理掉', '0 表示不按空闲整理', facts.settings.idleMinutes, 0, 240)}
            ${switchRow('review', '先审再用', '整理结果先进"待确认"，看过改了什么再应用', facts.settings.review)}
            ${switchRow('injectReflection', '把主线与伏笔一起注入', '卡片之外，再给模型一段当前主线和未回收的伏笔', facts.settings.injectReflection)}</div>
            <div class="rp-controls">${button('run', pending ? `整理事实（${pending} 条摘要）` : '整理事实', facts.settings.enabled && pending && !queued ? '' : 'disabled', true)}<span class="rp-cost is-paid">+1 次请求</span>${latest ? button('undo', '撤回上一次整理') : ''}</div>
            ${renderImport(state, facts)}
            ${latest ? `<p class="rp-note">上一次整理：${esc(when(latest.at))}，${esc(summarizeFactsChanges(latest))}${latest.warnings?.length ? `；${esc(latest.warnings.slice(0, 2).join('；'))}` : ''}</p>` : ''}
            </section>`;
    }

    // Offered while the chat still has the older 剧情状态 or 表格 data and no import has been done.
    function renderImport(state, facts) {
        const legacy = controller.legacySummary(state);
        if (!legacy.available) return '';
        const imported = facts.history.some(entry => entry.trigger === 'import' && !entry.undone);
        const what = [legacy.people ? `剧情状态 ${legacy.people} 个人物` : '', legacy.rows ? `表格 ${legacy.rows} 行` : ''].filter(Boolean).join('、');
        return `<div class="rp-controls">${button('import', imported ? '再次导入以前的数据' : '从剧情状态和表格导入')}<span class="rp-cost is-free">不花钱</span></div>
            <p class="rp-note">这个聊天还有以前记下的${esc(what)}。导入只补充卡片，不动原数据；导入后点一次“整理事实”，卡片会更顺。</p>`;
    }

    // What the model could not settle: the card's current value against what the material said; the user picks.
    function renderConflicts(state) {
        const open = controller.openConflicts?.(state) || [];
        if (!open.length) return '';
        return `<section class="rp-set-group"><span class="rp-label">待裁决 · ${open.length}</span><p class="rp-note">整理时材料和卡片对不上，模型没有改动，等你决定。</p>${open.map(item => `<div class="rp-event" data-facts-conflict="${esc(item.id)}"><div class="rp-row-main"><strong>${esc(item.name)} · ${esc(item.field)}</strong><small>现在：${esc(item.current || '（空）')}</small><small>材料：${esc(item.says)}</small></div><div class="rp-controls">${item.field === '身份' ? '' : link('conflict-accept', '采用材料')}${link('conflict-dismiss', item.field === '身份' ? '知道了' : '保留现状')}</div></div>`).join('')}</section>`;
    }

    function renderReflection(facts) {
        const threads = facts.cards.some(card => card.kind === 'thread') ? renderOpenThreads(facts.cards) : facts.reflection.threads;
        const parts = [['主线', facts.reflection.mainline], ['伏笔与约定', threads], ['人物弧线', facts.reflection.arcs]].filter(([, value]) => value);
        if (!parts.length) return '';
        return `<section class="rp-set-group"><span class="rp-label">反思 · REFLECTION</span>${parts.map(([label, value]) => `<h4>${esc(label)}</h4><p>${esc(value)}</p>`).join('')}</section>`;
    }

    function matches(card, search) {
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return [card.name, ...card.aliases, ...Object.values(card.fields)].some(value => String(value || '').toLowerCase().includes(needle));
    }

    function renderEditForm(card) {
        return `<form class="rp-edit-form rp-facts-form" data-facts-form="edit" data-facts-card-id="${esc(card.id)}">
            <label class="rp-edit-field"><span>名字</span><input type="text" data-facts-name value="${esc(card.name)}"></label>
            <label class="rp-edit-field"><span>别名 <small>用逗号分开</small></span><input type="text" data-facts-aliases value="${esc(card.aliases.join('、'))}"></label>
            ${factFields[card.kind].map(key => field(key, key, card.fields[key], { hint: factFieldHints[card.kind][key] })).join('')}
            <div class="rp-controls">${button('edit-save', '保存', '', true)}${button('edit-cancel', '取消')}</div></form>`;
    }

    function renderMergeForm(card, facts) {
        const others = facts.cards.filter(item => item.kind === card.kind && item.id !== card.id);
        if (!others.length) return '<p class="rp-note">没有同类型的其他卡片可以合并。</p>';
        return `<form class="rp-edit-form rp-facts-form" data-facts-form="merge" data-facts-card-id="${esc(card.id)}">
            <label class="rp-edit-field"><span>把「${esc(card.name)}」并入</span><select data-facts-merge-target>${others.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label>
            <p class="rp-note">并入后这张卡删除，名字变成对方的别名；对方空着的字段用这张卡的内容补上。</p>
            <div class="rp-controls">${button('merge-save', '合并', '', true)}${button('merge-cancel', '取消')}</div></form>`;
    }

    function renderAddForm(kind) {
        return `<form class="rp-edit-form rp-facts-form" data-facts-form="add" data-facts-kind="${esc(kind)}"><h3>新建${esc(factKindLabels[kind])}</h3>
            <label class="rp-edit-field"><span>名字</span><input type="text" data-facts-name placeholder="${kind === 'note' ? '便签标题' : '名字或称呼'}"></label>
            ${factFields[kind].map(key => field(key, key, '', { hint: factFieldHints[kind][key] })).join('')}
            <div class="rp-controls">${button('add-save', '添加', '', true)}${button('add-cancel', '取消')}</div></form>`;
    }

    function renderCard(card, state, facts) {
        const current = nav(state);
        const fields = factFields[card.kind].filter(key => card.fields[key]);
        const first = fields.length ? `${fields[0]} ${card.fields[fields[0]]}` : '还没有内容';
        const retired = card.status === 'retired';
        let body;
        if (current.editing === card.id) body = renderEditForm(card);
        else if (current.merging === card.id) body = renderMergeForm(card, facts);
        else {
            const history = controller.cardHistory(card.id, state).slice(0, 5);
            body = `${fields.map(key => `<h4>${esc(key)}${card.userFields.includes(key) ? ' <small>你改过</small>' : ''}</h4><p>${esc(card.fields[key])}</p>`).join('') || '<p class="rp-note">还没有内容</p>'}
                ${card.timeline?.length ? `<h4>经过</h4>${[...card.timeline].reverse().map(item => `<p class="rp-note">${item.floor != null ? `第 ${item.floor} 楼 · ` : ''}${esc(item.field === '已结束' ? '已结束' : `${item.field}：${item.from || '（空）'} → ${item.to || '（清空）'}`)}</p>`).join('')}` : ''}
                ${card.aliases.length ? `<p class="rp-note">别名：${esc(card.aliases.join('、'))}</p>` : ''}
                <p class="rp-note">${esc(triggerLabel[card.updatedBy] || '整理')}于 ${esc(when(card.updatedAt) || '未知')}${retired ? ' · 已结束，不再注入' : card.pinned ? ' · 固定注入' : ''}</p>
                <div class="rp-controls">${link('edit', '编辑')}${link('pin', card.pinned ? '取消固定' : '固定注入')}${link(retired ? 'restore' : 'retire', retired ? '恢复' : '标记结束')}${link('merge', '合并到…')}${link('delete', '删除')}</div>
                ${history.length ? `<details class="rp-set-details"><summary>变化<small>${history.length} 次</small></summary>${history.map(entry => `<p class="rp-note">${esc(when(entry.at))} · ${esc(triggerLabel[entry.trigger] || entry.trigger)}${entry.undone ? ' · 已撤回' : ''}</p>${renderFactsChanges({ ...entry, reflectionAfter: null, warnings: [] }, esc)}`).join('')}</details>` : ''}`;
        }
        return `<details class="rp-set-details" data-facts-card="${esc(card.id)}" ${current.open.has(card.id) ? 'open' : ''}><summary><span class="rp-set-text"><strong>${esc(card.name)}${card.pinned ? ' · 固定' : ''}${retired ? ' · 已结束' : ''}</strong><small>${esc(factKindLabels[card.kind])} · ${esc(first.slice(0, 80))}</small></span></summary>${body}</details>`;
    }

    function renderCards(state, facts) {
        const current = nav(state);
        const counts = countCardsByKind(facts.cards);
        const active = facts.cards.filter(card => card.status === 'active');
        const retired = facts.cards.filter(card => card.status === 'retired');
        const filters = [['', '全部', active.length], ...factKinds.map(kind => [kind, factKindLabels[kind], counts[kind]]), ['retired', '已结束', retired.length]];
        const shown = (current.filter === 'retired' ? retired : active.filter(card => !current.filter || card.kind === current.filter)).filter(card => matches(card, current.search));
        const search = `<form class="rp-search" data-facts-form="search"><label><span class="rp-label">搜索</span><input type="search" data-facts-search placeholder="名字、别名、字段里的词……" value="${esc(current.search)}" autocomplete="off"></label><button type="submit" class="rp-more">查找</button></form>`;
        const index = `<nav class="rp-index" aria-label="卡片类型">${filters.map(([key, label, count], i) => `${i ? '<span class="rp-index-sep" aria-hidden="true">/</span>' : ''}<button type="button" data-facts-action="filter" data-facts-filter="${key}" aria-pressed="${current.filter === key}">${esc(label)}<span class="rp-count">${count}</span></button>`).join('')}</nav>`;
        const add = current.adding ? renderAddForm(current.adding)
            : `<p class="rp-add">添加：${factKinds.map(kind => `<button type="button" class="rp-more" data-facts-action="add" data-facts-kind="${kind}">${esc(factKindLabels[kind])}</button>`).join('<span class="rp-index-sep" aria-hidden="true">/</span>')}</p>`;
        return `<section class="rp-directory-page">${search}${index}${shown.map(card => renderCard(card, state, facts)).join('') || '<p class="rp-empty">没有匹配的卡片</p>'}${add}</section>`;
    }

    function renderHistory(state, facts) {
        const entries = [...facts.history].reverse();
        const latest = entries.find(entry => !entry.undone);
        if (!entries.length) return '<section class="rp-history-page"><p class="rp-empty">还没有整理过</p></section>';
        return `<section class="rp-history-page">${entries.map(entry => `<details class="rp-set-details"><summary><span class="rp-set-text"><strong>${esc(when(entry.at))}${entry.undone ? ' · 已撤回' : ''}</strong><small>${esc(triggerLabel[entry.trigger] || entry.trigger)} · ${esc(summarizeFactsChanges(entry))}</small></span></summary>
            ${renderFactsChanges(entry, esc)}${entry === latest && entry.trigger !== 'user' ? `<div class="rp-controls">${button('undo', '撤回这一次')}</div>` : ''}</details>`).join('')}</section>`;
    }

    function render(state = getState()) {
        const root = document.getElementById('bakemono-facts-root');
        if (!root) return;
        const facts = controller.facts(state);
        const current = nav(state);
        const views = `<nav class="rp-index" aria-label="视图"><button type="button" data-facts-action="view" data-facts-view="cards" aria-pressed="${current.view === 'cards'}">卡片</button><span class="rp-index-sep" aria-hidden="true">/</span><button type="button" data-facts-action="view" data-facts-view="history" aria-pressed="${current.view === 'history'}">变化<span class="rp-count">${facts.history.length}</span></button></nav>`;
        root.innerHTML = renderStatus(state, facts) + renderConflicts(state) + renderReflection(facts) + views + (current.view === 'history' ? renderHistory(state, facts) : renderCards(state, facts));
    }

    function readForm(form) {
        const fields = Object.fromEntries([...form.querySelectorAll('[data-facts-field]')].map(input => [input.dataset.factsField, input.value]));
        const name = form.querySelector('[data-facts-name]')?.value || '';
        const aliases = String(form.querySelector('[data-facts-aliases]')?.value || '').split(/[,，、\n]/).map(alias => alias.trim()).filter(Boolean);
        return { name, aliases, fields };
    }

    function bind(root = document.getElementById('bakemono-facts-root')) {
        if (!root || root.dataset.factsBound) return;
        root.dataset.factsBound = '1';
        root.addEventListener('click', async event => {
            const target = event.target.closest('[data-facts-action]');
            if (!target || !root.contains(target)) return;
            const state = getState();
            const current = nav(state);
            const cardId = target.closest('[data-facts-card]')?.dataset.factsCard || target.closest('[data-facts-card-id]')?.dataset.factsCardId;
            const action = target.dataset.factsAction;
            const show = () => render(state);
            if (action === 'filter') { current.filter = target.dataset.factsFilter || ''; show(); }
            else if (action === 'view') { current.view = target.dataset.factsView || 'cards'; show(); }
            else if (action === 'run') { target.disabled = true; await controller.runManual(); refresh(); }
            else if (action === 'undo') { await controller.undoLast(); refresh(); }
            else if (action === 'conflict-accept' || action === 'conflict-dismiss') {
                controller.resolveConflict(target.closest('[data-facts-conflict]')?.dataset.factsConflict, action === 'conflict-accept' ? 'accept' : 'dismiss');
                show();
            }
            else if (action === 'import') { target.disabled = true; await controller.importLegacy(); render(getState()); }
            else if (action === 'add') { current.adding = target.dataset.factsKind; show(); }
            else if (action === 'add-cancel') { current.adding = null; show(); }
            else if (action === 'add-save') {
                const form = target.closest('form');
                const data = readForm(form);
                if (!data.name.trim()) { form.querySelector('[data-facts-name]')?.focus(); return; }
                const card = controller.addCard({ kind: form.dataset.factsKind, ...data });
                current.adding = null;
                if (card) current.open.add(card.id);
                show();
            }
            else if (action === 'edit') { current.editing = cardId; current.merging = null; current.open.add(cardId); show(); }
            else if (action === 'edit-cancel') { current.editing = null; show(); }
            else if (action === 'edit-save') { controller.saveCard(cardId, readForm(target.closest('form'))); current.editing = null; show(); }
            else if (action === 'pin') { const card = controller.facts(state).cards.find(item => item.id === cardId); if (card) controller.saveCard(cardId, { pinned: !card.pinned }); show(); }
            else if (action === 'retire') { controller.saveCard(cardId, { status: 'retired' }); show(); }
            else if (action === 'restore') { controller.saveCard(cardId, { status: 'active' }); show(); }
            else if (action === 'merge') { current.merging = cardId; current.editing = null; current.open.add(cardId); show(); }
            else if (action === 'merge-cancel') { current.merging = null; show(); }
            else if (action === 'merge-save') {
                const keepId = target.closest('form').querySelector('[data-facts-merge-target]')?.value;
                if (keepId) { controller.mergeInto(keepId, cardId); current.open.add(keepId); }
                current.merging = null;
                show();
            }
            else if (action === 'delete') { if (await controller.deleteCard(cardId)) { current.open.delete(cardId); } render(getState()); }
        });
        root.addEventListener('submit', event => {
            const form = event.target.closest('form[data-facts-form]');
            if (!form) return;
            event.preventDefault();
            if (form.dataset.factsForm === 'search') { nav(getState()).search = form.querySelector('[data-facts-search]')?.value || ''; render(getState()); }
            else form.querySelector('[data-facts-action$="-save"]')?.click();
        });
        root.addEventListener('toggle', event => {
            const card = event.target.closest?.('[data-facts-card]');
            if (!card || event.target !== card) return;
            const open = nav(getState()).open;
            if (card.open) open.add(card.dataset.factsCard); else open.delete(card.dataset.factsCard);
        }, true);
        root.addEventListener('change', event => {
            const input = event.target.closest('[data-facts-setting]');
            if (!input) return;
            controller.updateSettings({ [input.dataset.factsSetting]: input.type === 'number' ? Number(input.value) : input.checked });
            render(getState());
        });
    }

    return { render, bind };
}
