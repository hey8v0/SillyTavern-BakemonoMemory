import { countCardsByKind, describeTransition, factFieldHints, factFields, factKindLabels, factKinds, storyOrder } from '../facts/model.js';
import { renderFactsChanges, summarizeFactsChanges } from '../facts/diff.js';
import { renderOpenThreads } from '../facts/injection.js';
import { sheetAction, sheetConfirm } from '../ui/action-sheet.js';

// 剧情事实 page, film-slate style: a slate of four numbers and the one button on top, then what needs the user
// (待裁决), the reflection, and the cards as a directory grouped by kind. Settings fold into one row; per-card
// actions live in the “⋯” sheet. The “变化” view is the history as a timeline.
export function createFactsUi({ documentRef: document, getState, controller, escapeHtml: esc, sheet = null, refresh = () => {}, navigate = () => {} }) {
    const navigation = new WeakMap();
    const nav = state => navigation.get(state) || navigation.set(state, { view: 'cards', filter: '', search: '', open: new Set(), editing: null, merging: null, adding: null, settings: false }).get(state);
    const button = (action, label, extra = '', primary = false) => `<button type="button" class="menu_button${primary ? ' rp-primary' : ''}" data-facts-action="${action}" ${extra}><span>${esc(label)}</span></button>`;
    const link = (action, label, extra = '') => `<button type="button" class="rp-more" data-facts-action="${action}" ${extra}>${esc(label)} <span class="rp-chevron" aria-hidden="true">›</span></button>`;
    const switchRow = (key, title, detail, checked) => `<label class="rp-set-row"><span class="rp-set-text"><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span><input type="checkbox" role="switch" class="rp-switch" data-facts-setting="${key}" ${checked ? 'checked' : ''}></label>`;
    const numberRow = (key, title, detail, value, min, max) => `<label class="rp-set-row"><span class="rp-set-text"><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span><input type="number" class="text_pole" style="width:5em;flex:none" data-facts-setting="${key}" min="${min}" max="${max}" step="1" value="${esc(value)}"></label>`;
    const field = (name, label, value, { rows = 2, hint = '' } = {}) => `<label class="rp-edit-field"><span>${esc(label)}${hint ? ` <small>${esc(hint)}</small>` : ''}</span><textarea rows="${rows}" data-facts-field="${esc(name)}" spellcheck="false">${esc(value || '')}</textarea></label>`;
    const when = value => value ? new Date(value).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const floorNo = value => `#${String(value).padStart(3, '0')}`;
    const triggerLabel = { facts: '自动整理', manual: '手动整理', review: '审阅后应用', user: '你的修改', import: '导入' };
    const label = (zh, en) => `<span class="rp-label">${esc(zh)} · ${esc(en)}</span>`;

    // The slate: four numbers that say where things stand, one line of cadence, and the one button.
    function renderSlate(state, facts) {
        const pending = controller.pendingSummaries(state).length;
        const queued = (state.taskQueue || []).filter(task => task.kind === 'facts' && ['queued', 'running'].includes(task.status)).length;
        const held = (state.drafts || []).filter(draft => draft.kind === 'facts').length;
        const open = controller.openConflicts?.(state).length || 0;
        const total = facts.cards.filter(card => card.status === 'active' && card.kind !== 'note').length;
        const cell = (zh, en, value, unit = '', extra = '') => `<div class="rp-cell">${label(zh, en)}<span class="rp-slate-value${extra}">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</span></div>`;
        const cells = [
            cell('卡片', 'CARDS', total || '<span class="is-empty">—</span>', total ? '张' : ''),
            cell('整理到', 'FLOOR', facts.lastIntegratedFloor >= 0 ? esc(floorNo(facts.lastIntegratedFloor)) : '<span class="is-empty">—</span>', '', ' is-timecode'),
            cell('待整理', 'PENDING', held ? held : queued ? '…' : pending || '0', held ? '批待确认' : queued ? '' : '条摘要'),
            cell(open ? '待裁决' : '上次整理', open ? 'OPEN' : 'LAST', open ? open : facts.lastRunAt ? esc(when(facts.lastRunAt)) : '<span class="is-empty">—</span>', open ? '处' : '', open ? '' : ' is-small'),
        ];
        const settings = facts.settings;
        const cadence = !settings.enabled ? '没在记录。打开后，每攒够几条剧情摘要就把人物、关系、物品和线索整理成卡片'
            : !settings.auto ? '自动整理已关，需要时点“整理事实”'
            : `每攒够 ${settings.everySummaries} 条摘要自动整理${settings.idleMinutes ? `，空闲 ${settings.idleMinutes} 分钟也整理` : ''}${settings.review ? '，结果先进待确认' : ''}`;
        const right = queued ? '正在整理…' : held ? '整理结果等你确认' : pending && settings.enabled && settings.auto && pending < settings.everySummaries ? `再攒 <b>${settings.everySummaries - pending}</b> 条就整理` : '';
        return `<section class="rp-slate"><div class="rp-slate-grid is-four">${cells.join('')}</div>
            <div class="rp-slate-foot"><span>${esc(cadence)}</span>${right ? `<span>${right}</span>` : ''}</div></section>`;
    }

    function renderControls(state, facts) {
        const pending = controller.pendingSummaries(state).length;
        const queued = (state.taskQueue || []).some(task => task.kind === 'facts' && ['queued', 'running'].includes(task.status));
        const latest = [...facts.history].reverse().find(item => !item.undone && item.trigger !== 'user');
        if (!facts.settings.enabled) return `<div class="rp-controls">${button('enable', '开始记录剧情事实', '', true)}<span class="rp-cost is-paid">之后每次整理 +1 次请求</span></div>`;
        return `<div class="rp-controls">${button('run', pending ? `整理事实（${pending} 条摘要）` : '整理事实', pending && !queued ? '' : 'disabled', true)}<span class="rp-cost is-paid">+1 次请求</span>
            ${latest ? link('undo', '撤回上一次') : ''}</div>`;
    }

    // Things that need a word: a batch given up on, a chat shorter than the progress, old data to import.
    function renderNotices(state, facts) {
        const notes = [];
        const blocked = controller.blockedBatch?.(state);
        if (blocked) notes.push(['alert', `第 ${blocked.floorFrom}–${blocked.floorTo} 楼这批整理失败了 ${blocked.failures} 次`, '没再自动重试；在队列里重试，或点“整理事实”']);
        const shorter = controller.chatShorterThanProgress?.(state);
        if (shorter) notes.push(['alert', `已整理到第 ${shorter.cursor} 楼，聊天只有 ${shorter.lastFloor + 1} 楼`, '分支或删过楼层：卡片里可能有之后才发生的事，可以在“变化”里逐次撤回']);
        const legacy = controller.legacySummary(state);
        if (legacy.available) {
            const what = [legacy.people ? `剧情状态 ${legacy.people} 个人物` : '', legacy.rows ? `表格 ${legacy.rows} 行` : ''].filter(Boolean).join('、');
            const imported = facts.history.some(entry => entry.trigger === 'import' && !entry.undone);
            notes.push(['', `这个聊天还有以前记下的${what}`, `${imported ? '已经导入过；' : ''}导入只补充卡片，不动原数据`, link('import', imported ? '再次导入' : '导入成卡片')]);
        }
        return notes.map(([tone, title, detail, action = '']) => `<div class="rp-notice${tone ? ` is-${tone}` : ''}"><i class="rp-notice-dot"></i><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>${action}</div>`).join('');
    }

    const number = value => Number(value || 0).toLocaleString();
    // How much may go in each round: a share of the model's context, or a fixed number.
    function budgetRows(state, settings) {
        const budget = controller.injectionBudget?.(state) || { chars: settings.budgetChars, auto: settings.budgetAuto, contextTokens: 0 };
        const detail = !settings.budgetAuto ? '关掉后按下面的固定字数'
            : budget.contextTokens ? `现在每轮最多约 ${number(budget.chars)} 字（模型上下文 ${number(budget.contextTokens)} 的 ${settings.budgetRatio}%）`
            : `读不到模型上下文，先按 ${number(budget.chars)} 字`;
        return `${switchRow('budgetAuto', '注入量跟着模型上下文', detail, settings.budgetAuto)}
            ${settings.budgetAuto ? numberRow('budgetRatio', '占上下文的百分比', '越大写得越全，也越占 token', settings.budgetRatio, 1, 30)
                : numberRow('budgetChars', '每轮最多注入多少字', '中文大约一字一 token', settings.budgetChars, 500, 60000)}`;
    }

    // What the last round injected: which cards went in full, in one line, by name only, or not at all.
    function renderInjection(state) {
        const plan = controller.lastInjection?.(state);
        if (!plan || !(plan.full.length + plan.short.length + plan.named.length + plan.dropped.length)) return '';
        const groups = [['完整', plan.full], ['一行', plan.short], ['只列名字', plan.named], ['没放进去', plan.dropped]].filter(([, list]) => list.length);
        const counts = groups.map(([label, list]) => `${label} ${list.length}`).join(' · ');
        return `<details class="rp-set-details" data-facts-injection><summary>这一轮注入<small>${esc(number(plan.used))} / ${esc(number(plan.budget))} 字 · ${esc(counts)}</small></summary>
            <dl class="rp-facts">${groups.map(([label, list]) => `<dt>${esc(label)}</dt><dd>${esc(list.join('、'))}</dd>`).join('')}</dl>
            ${plan.over ? '<p class="rp-note">便签和主线已经超过预算，卡片都没放进去；调大注入量，或精简便签。</p>' : ''}</details>`;
    }

    function renderSettings(state, facts) {
        const settings = facts.settings;
        const budget = controller.injectionBudget?.(state);
        const summary = [`每 ${settings.everySummaries} 条`, settings.idleMinutes ? `空闲 ${settings.idleMinutes} 分钟` : '不按空闲', settings.review ? '先审再用' : '',
            budget ? `注入至多 ${number(budget.chars)} 字` : '', settings.injectReflection ? '' : '不注入反思'].filter(Boolean).join(' · ');
        return `<details class="rp-set-details" data-facts-settings ${nav(state).settings ? 'open' : ''}><summary>设置<small>${esc(summary)}</small></summary>
            <div class="rp-set-list">${switchRow('enabled', '记录剧情事实', '关掉后不再整理，也不注入；已有卡片保留', settings.enabled)}
            ${switchRow('auto', '自动整理', '攒够一批摘要就整理一次，每次 1 次请求', settings.auto)}
            ${numberRow('everySummaries', '每攒几条摘要整理一次', '越小越新鲜、请求越多；最新一楼会等下一条消息后再算', settings.everySummaries, 1, 50)}
            ${numberRow('idleMinutes', '空闲几分钟后把剩下的整理掉', '0 表示不按空闲整理', settings.idleMinutes, 0, 240)}
            ${switchRow('review', '先审再用', '整理结果先进“待确认”，看过改了什么再应用', settings.review)}
            ${switchRow('injectReflection', '把主线与伏笔一起注入', '卡片之外，再给模型一段当前主线和未回收的伏笔', settings.injectReflection)}
            ${budgetRows(state, settings)}</div></details>`;
    }

    // What the model could not settle: the card's current value against what the material said; the user picks.
    function renderConflicts(state) {
        const open = controller.openConflicts?.(state) || [];
        if (!open.length) return '';
        return `<section class="rp-sec"><div class="rp-sec-head"><h3>待裁决${label('', 'OPEN').replace(' · ', '')}</h3></div>
            <div class="rp-list is-top">${open.map(item => `<div class="rp-event" data-facts-conflict="${esc(item.id)}"><span class="rp-verb">${esc(item.field)}</span>
                <div class="rp-row-main"><strong>${esc(item.name)}</strong><small>现在：${esc(item.current || '（空）')}</small><small>材料：${esc(item.says)}</small>
                <div class="rp-entry-actions">${item.field === '身份' ? '' : link('conflict-accept', '采用材料')}${link('conflict-dismiss', item.field === '身份' ? '知道了' : '保留现状')}</div></div></div>`).join('')}</div></section>`;
    }

    function renderReflection(facts) {
        const threads = facts.cards.some(card => card.kind === 'thread') ? renderOpenThreads(facts.cards) : facts.reflection.threads;
        const parts = [['主线', facts.reflection.mainline], ['伏笔', threads], ['弧线', facts.reflection.arcs]].filter(([, value]) => value);
        if (!parts.length) return '';
        return `<section class="rp-sec"><div class="rp-sec-head"><h3>主线与伏笔 ${label('', 'REFLECTION').replace(' · ', '')}</h3></div>
            <dl class="rp-facts">${parts.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl></section>`;
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
        if (!others.length) return `<p class="rp-note">没有同类型的其他卡片可以合并。</p><div class="rp-controls">${button('merge-cancel', '返回')}</div>`;
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

    // One card: a closed row shows the name and its first field; open, the fields as a sheet, then 经过, then the
    // two actions (编辑 and ⋯).
    function renderCard(card, state, facts) {
        const current = nav(state);
        const fields = factFields[card.kind].filter(key => card.fields[key]);
        const first = fields.length ? card.fields[fields[0]] : '还没有内容';
        const retired = card.status === 'retired';
        let body;
        if (current.editing === card.id) body = renderEditForm(card);
        else if (current.merging === card.id) body = renderMergeForm(card, facts);
        else {
            const past = storyOrder(card.timeline).reverse().slice(0, 6);
            body = `${fields.length ? `<dl class="rp-facts">${fields.map(key => `<dt>${esc(key)}</dt><dd>${esc(card.fields[key])}${card.userFields.includes(key) ? '<span class="rp-tag is-hint">你改过</span>' : ''}</dd>`).join('')}</dl>` : '<p class="rp-note">还没有内容</p>'}
                ${past.length ? `<ol class="rp-past">${past.map(item => `<li><span class="rp-mono">${item.floor != null ? esc(floorNo(item.floor)) : '—'}</span>${esc(describeTransition(item))}${item.floors?.length ? `<small class="rp-tag is-hint">依据第 ${esc(item.floors.join('、'))} 楼</small>` : ''}</li>`).join('')}</ol>` : ''}
                ${card.floors?.length ? `<p class="rp-note">摘要里提到它的楼层：${esc(card.floors.slice(-10).join('、'))}${card.floors.length > 10 ? ` 等 ${card.floors.length} 处` : ''}</p>` : ''}
                <p class="rp-note">${card.aliases.length ? `别名 ${esc(card.aliases.join('、'))} · ` : ''}${esc(triggerLabel[card.updatedBy] || '整理')}于 ${esc(when(card.updatedAt) || '未知')}${retired ? ' · 已结束，只在被点名时注入' : card.pinned ? ' · 固定注入' : ''}</p>
                <div class="rp-entry-actions">${link('edit', '编辑')}<button type="button" class="rp-more" data-facts-action="more" aria-label="更多操作">⋯</button></div>`;
        }
        const tags = [card.pinned ? '固定' : '', retired ? '已结束' : ''].filter(Boolean).join(' · ');
        return `<details class="rp-set-details" data-facts-card="${esc(card.id)}" ${current.open.has(card.id) ? 'open' : ''}><summary><span class="rp-card-sum"><strong>${esc(card.name)}</strong><span>${esc(first)}</span></span>${tags ? `<small>${esc(tags)}</small>` : ''}</summary>${body}</details>`;
    }

    function renderCards(state, facts) {
        const current = nav(state);
        const counts = countCardsByKind(facts.cards);
        const active = facts.cards.filter(card => card.status === 'active');
        const retired = facts.cards.filter(card => card.status === 'retired');
        const filters = [['', '全部', active.length], ...factKinds.filter(kind => counts[kind]).map(kind => [kind, factKindLabels[kind], counts[kind]]), ...(retired.length ? [['retired', '已结束', retired.length]] : [])];
        const shown = (current.filter === 'retired' ? retired : active.filter(card => !current.filter || card.kind === current.filter)).filter(card => matches(card, current.search));
        const search = `<form class="rp-search" data-facts-form="search"><label><span class="rp-label">搜索</span><input type="search" data-facts-search placeholder="名字、别名、字段里的词……" value="${esc(current.search)}" autocomplete="off"></label><button type="submit" class="rp-more">查找</button></form>`;
        const index = filters.length > 1 ? `<nav class="rp-index" aria-label="卡片类型">${filters.map(([key, name, count], i) => `${i ? '<span class="rp-index-sep" aria-hidden="true">/</span>' : ''}<button type="button" data-facts-action="filter" data-facts-filter="${key}" aria-pressed="${current.filter === key}">${esc(name)}<span class="rp-count">${count}</span></button>`).join('')}</nav>` : '';
        // Grouped by kind when nothing narrows the list; a sticky kind title per group.
        const grouped = !current.filter && !current.search.trim();
        const list = grouped
            ? factKinds.map(kind => shown.filter(card => card.kind === kind)).filter(group => group.length)
                .map(group => `<div class="rp-group-head"><h4>${esc(factKindLabels[group[0].kind])}</h4><span class="rp-count">${group.length}</span></div>${group.map(card => renderCard(card, state, facts)).join('')}`).join('')
            : shown.map(card => renderCard(card, state, facts)).join('');
        const add = current.adding ? renderAddForm(current.adding)
            : `<p class="rp-add">添加：${factKinds.map(kind => `<button type="button" class="rp-more" data-facts-action="add" data-facts-kind="${kind}">${esc(factKindLabels[kind])}</button>`).join('<span class="rp-index-sep" aria-hidden="true">/</span>')}</p>`;
        const empty = facts.cards.length ? '<p class="rp-empty">没有匹配的卡片</p>' : `<p class="rp-empty">${facts.settings.enabled ? '还没有卡片。攒够一批剧情摘要后会自动整理出来，也可以点“整理事实”或在下面手动添加。' : '还没有卡片。'}</p>`;
        return `<section class="rp-sec rp-directory-page"><div class="rp-sec-head"><h3>卡片 ${label('', 'CARDS').replace(' · ', '')}</h3>${facts.history.length ? link('view-history', `变化 ${facts.history.length}`) : ''}</div>
            ${facts.cards.length ? search + index : ''}${list || empty}${add}</section>`;
    }

    // The history as a timeline: one take per 整理, newest first; the latest one can be undone.
    function renderHistory(state, facts) {
        const entries = [...facts.history].reverse();
        const latest = entries.find(entry => !entry.undone && entry.trigger !== 'user');
        return `<section class="rp-sec rp-history-page"><div class="rp-sec-head"><h3>变化 ${label('', 'HISTORY').replace(' · ', '')}</h3>${link('view-cards', '卡片')}</div>
            ${entries.length ? `<div class="rp-timeline">${entries.map(entry => `<div class="rp-take"><div class="rp-take-head"><h4>${esc(when(entry.at))}${entry.undone ? ' · 已撤回' : ''}</h4>
                <p class="rp-take-sub">${esc(triggerLabel[entry.trigger] || entry.trigger)}${entry.floorTo != null ? ` · 到第 ${entry.floorTo} 楼` : ''} · ${esc(summarizeFactsChanges(entry))}</p></div>
                ${renderFactsChanges(entry, esc)}${entry === latest ? `<div class="rp-controls">${button('undo', '撤回这一次')}</div>` : ''}</div>`).join('')}</div>` : '<p class="rp-empty">还没有整理过</p>'}</section>`;
    }

    function render(state = getState()) {
        const root = document.getElementById('bakemono-facts-root');
        if (!root) return;
        const facts = controller.facts(state);
        const current = nav(state);
        root.innerHTML = renderSlate(state, facts) + renderControls(state, facts) + renderNotices(state, facts) + renderInjection(state) + renderSettings(state, facts)
            + renderConflicts(state) + renderReflection(facts) + (current.view === 'history' ? renderHistory(state, facts) : renderCards(state, facts));
    }

    function readForm(form) {
        const fields = Object.fromEntries([...form.querySelectorAll('[data-facts-field]')].map(input => [input.dataset.factsField, input.value]));
        const name = form.querySelector('[data-facts-name]')?.value || '';
        const aliases = String(form.querySelector('[data-facts-aliases]')?.value || '').split(/[,，、\n]/).map(alias => alias.trim()).filter(Boolean);
        return { name, aliases, fields };
    }

    // “⋯” on an open card: pin, end/restore, merge, delete (asked again inside the sheet).
    function openCardSheet(card, trigger, current) {
        const retired = card.status === 'retired';
        const menu = () => [
            sheetAction('pin', card.pinned ? '取消固定' : '固定注入', card.pinned ? '只在被点名时注入' : '每一轮都注入这张卡', { escapeHtml: esc }),
            sheetAction(retired ? 'restore' : 'retire', retired ? '恢复' : '标记结束', retired ? '重新算作在场' : '死亡、了结、永久离场；只在被点名时注入', { escapeHtml: esc }),
            sheetAction('merge', '合并到…', '和另一张同类型的卡是一回事', { escapeHtml: esc }),
            sheetAction('delete', '删除', '会再确认一次', { escapeHtml: esc, danger: true, view: true }),
        ].join('');
        const run = async name => {
            if (name === 'pin') controller.saveCard(card.id, { pinned: !card.pinned });
            else if (name === 'retire') controller.saveCard(card.id, { status: 'retired' });
            else if (name === 'restore') controller.saveCard(card.id, { status: 'active' });
            else if (name === 'merge') { current.merging = card.id; current.editing = null; current.open.add(card.id); }
            else if (name === 'delete') { if (await controller.deleteCard(card.id, { confirmed: true })) current.open.delete(card.id); }
            render(getState());
        };
        if (!sheet) return run('merge');
        sheet.open({ title: card.name, subtitle: factKindLabels[card.kind], trigger,
            render: view => view === 'delete' ? sheetConfirm('这张卡片会从剧情事实里去掉，之后的整理可能会按材料重新建一张。想暂时不注入的话，用“标记结束”就够了。', 'delete', '删除', { escapeHtml: esc }) : menu(),
            run });
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
            else if (action === 'view-history') { current.view = 'history'; show(); }
            else if (action === 'view-cards') { current.view = 'cards'; show(); }
            else if (action === 'enable') { controller.updateSettings({ enabled: true }); show(); }
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
            else if (action === 'more') {
                const card = controller.facts(state).cards.find(item => item.id === cardId);
                if (card) openCardSheet(card, target, current);
            }
            else if (action === 'merge-cancel') { current.merging = null; show(); }
            else if (action === 'merge-save') {
                const keepId = target.closest('form').querySelector('[data-facts-merge-target]')?.value;
                if (keepId) { controller.mergeInto(keepId, cardId); current.open.add(keepId); }
                current.merging = null;
                show();
            }
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
            if (card && event.target === card) {
                const open = nav(getState()).open;
                if (card.open) open.add(card.dataset.factsCard); else open.delete(card.dataset.factsCard);
                return;
            }
            if (event.target.matches?.('[data-facts-settings]')) nav(getState()).settings = event.target.open;
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
