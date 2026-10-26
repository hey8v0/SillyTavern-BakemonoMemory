import { countCardsByKind, factFields, factKindLabels, factKinds } from '../facts/model.js';

// 剧情事实 page: switches, the 整理 buttons, the reflection, and the cards by kind. Same film-slate classes as
// 剧情状态, so it needs no styles of its own yet.
export function createFactsUi({ documentRef: document, getState, controller, escapeHtml: esc, refresh = () => {}, getChat = () => [] }) {
    const navigation = new WeakMap();
    const nav = state => navigation.get(state) || navigation.set(state, { filter: '', open: new Set() }).get(state);
    const button = (action, label, extra = '', primary = false) => `<button type="button" class="menu_button${primary ? ' rp-primary' : ''}" data-facts-action="${action}" ${extra}><span>${esc(label)}</span></button>`;
    const switchRow = (key, title, detail, checked) => `<label class="rp-set-row"><span class="rp-set-text"><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span><input type="checkbox" role="switch" class="rp-switch" data-facts-setting="${key}" ${checked ? 'checked' : ''}></label>`;
    const when = value => value ? new Date(value).toLocaleString() : '';

    function renderStatus(state, facts) {
        const pending = controller.stagesToIntegrate(state).length;
        const queued = (state.taskQueue || []).filter(task => task.kind === 'facts' && ['queued', 'running'].includes(task.status)).length;
        const counts = countCardsByKind(facts.cards);
        const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
        const lines = [];
        if (!facts.settings.enabled) lines.push('还没开始记录。打开后，每保存一个阶段总结，插件会把这段剧情里的人物、关系、物品和线索整理成卡片。');
        else {
            lines.push(`${total} 张卡片${facts.lastRunAt ? ` · 上次整理 ${when(facts.lastRunAt)}` : ' · 还没整理过'}`);
            lines.push(queued ? `${queued} 个整理任务在队列里` : pending ? `${pending} 个阶段总结还没整理` : facts.settings.auto ? '保存新的阶段总结后会自动整理' : '自动整理已关，需要时点"整理事实"');
        }
        const latest = [...facts.history].reverse().find(item => !item.undone && item.trigger !== 'user');
        return `<section class="rp-overview"><p class="rp-note">${lines.map(esc).join('<br>')}</p>
            <div class="rp-set-list">${switchRow('enabled', '记录剧情事实', '关掉后不再整理，也不注入；已有卡片保留', facts.settings.enabled)}
            ${switchRow('auto', '自动整理', '每保存一个阶段总结整理一次，每次 1 次请求', facts.settings.auto)}
            ${switchRow('injectReflection', '把主线与伏笔一起注入', '卡片之外，再给模型一段当前主线和未回收的伏笔', facts.settings.injectReflection)}</div>
            <div class="rp-controls">${button('run', pending ? `整理事实（${pending} 个阶段）` : '整理事实', facts.settings.enabled && pending && !queued ? '' : 'disabled', true)}<span class="rp-cost is-paid">每个阶段 +1 次请求</span>${latest ? button('undo', '撤回上一次整理') : ''}</div>
            ${latest ? `<p class="rp-note">上一次整理：${esc(when(latest.at))}，${latest.changes.length} 张卡片${latest.reflectionAfter ? '，反思已更新' : ''}${latest.warnings?.length ? `；${esc(latest.warnings.slice(0, 2).join('；'))}` : ''}</p>` : ''}
            </section>`;
    }

    function renderReflection(facts) {
        const parts = [['mainline', '主线'], ['threads', '伏笔与约定'], ['arcs', '人物弧线']].filter(([key]) => facts.reflection[key]);
        if (!parts.length) return '';
        return `<section class="rp-set-group"><span class="rp-label">反思 · REFLECTION</span>${parts.map(([key, label]) => `<h4>${esc(label)}</h4><p>${esc(facts.reflection[key])}</p>`).join('')}</section>`;
    }

    function renderCards(state, facts) {
        const current = nav(state);
        const counts = countCardsByKind(facts.cards);
        const active = facts.cards.filter(card => card.status === 'active');
        const retired = facts.cards.filter(card => card.status === 'retired');
        const filters = [['', '全部', active.length], ...factKinds.map(kind => [kind, factKindLabels[kind], counts[kind]]), ['retired', '已结束', retired.length]];
        const shown = current.filter === 'retired' ? retired : active.filter(card => !current.filter || card.kind === current.filter);
        const index = `<nav class="rp-index" aria-label="卡片类型">${filters.map(([key, label, count], i) => `${i ? '<span class="rp-index-sep" aria-hidden="true">/</span>' : ''}<button type="button" data-facts-action="filter" data-facts-filter="${key}" aria-pressed="${current.filter === key}">${esc(label)}<span class="rp-count">${count}</span></button>`).join('')}</nav>`;
        const rows = shown.map(card => {
            const fields = factFields[card.kind].filter(key => card.fields[key]);
            const first = fields.length ? `${fields[0]} ${card.fields[fields[0]]}` : '还没有内容';
            return `<details class="rp-set-details" data-facts-card="${esc(card.id)}" ${current.open.has(card.id) ? 'open' : ''}><summary><span class="rp-set-text"><strong>${esc(card.name)}${card.pinned ? ' · 固定' : ''}</strong><small>${esc(factKindLabels[card.kind])} · ${esc(first.slice(0, 80))}</small></span></summary>
                ${fields.map(key => `<h4>${esc(key)}${card.userFields.includes(key) ? ' <small>你改过</small>' : ''}</h4><p>${esc(card.fields[key])}</p>`).join('') || '<p class="rp-note">还没有内容</p>'}
                ${card.aliases.length ? `<p class="rp-note">别名：${esc(card.aliases.join('、'))}</p>` : ''}
                <p class="rp-note">${card.updatedBy === 'user' ? '你' : card.updatedBy === 'import' ? '导入' : '整理'}于 ${esc(when(card.updatedAt) || '未知')}</p></details>`;
        }).join('');
        return `<section class="rp-directory-page">${index}${rows || '<p class="rp-empty">还没有这一类卡片</p>'}</section>`;
    }

    function render(state = getState()) {
        const root = document.getElementById('bakemono-facts-root');
        if (!root) return;
        const facts = controller.facts(state);
        root.innerHTML = renderStatus(state, facts) + renderReflection(facts) + renderCards(state, facts);
    }

    function bind(root = document.getElementById('bakemono-facts-root')) {
        if (!root || root.dataset.factsBound) return;
        root.dataset.factsBound = '1';
        root.addEventListener('click', async event => {
            const target = event.target.closest('[data-facts-action]');
            if (!target) return;
            const state = getState();
            const action = target.dataset.factsAction;
            if (action === 'filter') { nav(state).filter = target.dataset.factsFilter || ''; render(state); }
            else if (action === 'run') { target.disabled = true; await controller.runManual(); refresh(); }
            else if (action === 'undo') { await controller.undoLast(); refresh(); }
        });
        root.addEventListener('toggle', event => {
            const card = event.target.closest?.('[data-facts-card]');
            if (!card) return;
            const open = nav(getState()).open;
            if (card.open) open.add(card.dataset.factsCard); else open.delete(card.dataset.factsCard);
        }, true);
        root.addEventListener('change', event => {
            const input = event.target.closest('[data-facts-setting]');
            if (!input) return;
            controller.updateSettings({ [input.dataset.factsSetting]: input.checked });
            render(getState());
        });
    }

    return { render, bind };
}
