import { buildStatePage, createStateNavigation, describeRecord, entityName, relationshipName, stateLabels, trackLabels } from '../rp-core/state-view.js';
import { buildBaselinePreview, suggestBaselineMappings, migrationFields, migrationLabels } from '../rp-core/migration.js';

export function createRpStateUi({ documentRef: document, getState, service, flow, navigate, refresh, escapeHtml: esc, locateSource }) {
    const navigation = createStateNavigation(), previews = new WeakMap();
    let busy = false;
    const tabs = { overview: '概览', people: '人物关系', world: '世界状态', history: '历史' };
    const button = (action, label, extra = '') => `<button type="button" class="menu_button" data-rp-action="${action}" ${extra}><span>${esc(label)}</span></button>`;
    const help = text => `<button type="button" class="bakemono-memory-help-trigger" aria-label="使用说明" aria-expanded="false"><i class="fa-solid fa-circle-info"></i><span class="bakemono-memory-help-content">${esc(text)}</span></button>`;
    const names = (view, values) => (values || []).map(id => entityName(view, id)).join('、');
    const line = (label, value) => `<p><span>${esc(label)}</span>：${esc(value ?? '未知')}</p>`;

    function renderReview(state = getState()) {
        const root = document.querySelector('#bakemono-rp-review');
        if (!root) return;
        const candidates = state.rpCore?.candidates?.filter(item => item.status === 'pending') || [];
        root.hidden = !candidates.length;
        if (!candidates.length) { root.innerHTML = ''; return; }
        let projection;
        try { projection = service.view(state)?.projection; }
        catch {
            root.hidden = false;
            root.innerHTML = '<p role="alert">剧情账本暂不可审核，请在剧情状态中查看错误。已有摘要不受此审核入口影响。</p>';
            return;
        }
        root.innerHTML = `<h4>剧情状态 · ${candidates.length} 项待确认</h4>` + candidates.slice(0, 20).map(item =>
            button('review-open', projection ? describeRecord(item, projection) : '查看候选', `data-rp-id="${esc(item.id)}"`)).join('')
            + (candidates.length > 20 ? button('pending', '查看全部') : '');
    }
    function render(state = getState()) {
        const root = document.querySelector('#bakemono-rp-root');
        if (!root) return;
        const nav = navigation.get(state), core = state.rpCore;
        let view;
        try { view = core ? service.view(state, nav.floor == null ? {} : { asOfFloor: nav.floor }) : null; }
        catch (error) {
            root.innerHTML = `<p role="alert">${esc(error.message)}</p>${button('legacy', '打开原表格')}`;
            return;
        }
        const more = `<details class="rp-more"><summary>更多</summary>${button('legacy', '原表格编辑器')}${button('settings', '提取与注入设置')}</details>`;
        const header = `<div class="rp-toolbar">${help('AI 提出事件，插件校验后记录。说法和观察不改变世界事实。历史按当时已知状态显示；展开事件查看证据。旧表格仍在更多中。')}${more}</div>`;
        if (!core) {
            root.innerHTML = `${header}<h3>开启剧情状态</h3><p>人物、关系、约定、物品和地点</p>${button('enable-preview', '启用 RP Core')}`;
            if (nav.error) root.insertAdjacentHTML('beforeend', `<p role="alert">${esc(nav.error)}</p>`);
            if (nav.setup) {
                root.insertAdjacentHTML('beforeend', `<section class="rp-preview"><h4>空白开始</h4><p>从当前楼层建立基线；已有摘要、自定义表格和聊天正文保持不变。</p>${button('enable-confirm', '确认空白启用')}${button('migration', '预览导入已有状态')}${button('setup-cancel', '返回')}</section>`);
                if (nav.mappings) renderMigration(root, state, nav);
            }
            return;
        }
        const navMarkup = `<nav class="rp-tabs" aria-label="剧情状态页面">${Object.entries(tabs).map(([key, label]) => button('tab', label, `data-rp-tab="${key}" aria-current="${nav.tab === key ? 'page' : 'false'}"`)).join('')}</nav>`;
        root.innerHTML = header + navMarkup;
        if (nav.error) root.insertAdjacentHTML('beforeend', `<p role="alert">${esc(nav.error)}</p>`);
        if (nav.settings) {
            root.insertAdjacentHTML('beforeend', `<section class="rp-settings"><h4>提取与注入</h4>${['enabled', 'autoApply', 'inject'].map((key, i) => `<label><input type="checkbox" data-rp-setting="${key}" ${core.settings[key] ? 'checked' : ''}>${['运行剧情状态', '明确无冲突时自动应用', '注入当前状态'][i]}</label>`).join('')}${help('复用随正文或回复后请求，不额外调用模型。没有兼容流程时不会自动维护。关闭运行或注入不会删除账本。')}${button('save-settings', '保存设置')}${button('settings', '收起')}</section>`);
        }
        if (!view?.projection) { root.insertAdjacentHTML('beforeend', `<p>所选楼层早于基线，没有可用状态。</p>${button('current', '返回当前状态')}`); return; }
        if (nav.settings) root.querySelector('.rp-settings').insertAdjacentHTML('afterbegin', `<label>提取方式<select class="text_pole" data-rp-mode><option value="reuse" ${core.settings.mode === 'reuse' ? 'selected' : ''}>复用已有请求</option><option value="independent" ${core.settings.mode === 'independent' ? 'selected' : ''}>独立请求（额外调用默认生成模型）</option></select></label>`);
        const projection = view.projection;
        if (nav.selected) { renderDetail(root, state, view, nav); return; }
        const pending = core.candidates.filter(item => item.status === 'pending').length;
        if (nav.tab === 'overview') {
            const channel = flow.channel(state);
            if (channel === 'independent') root.insertAdjacentHTML('beforeend', `${button('extract', '提取／重新提取最新正文')}${button('stop', '停止提取')}${core.extractionJobs?.some(job => ['running', 'paused', 'failed'].includes(job.status)) ? '<p role="status">有未完成提取；可手动重试，不会自动重复计费。</p>' : ''}`);
            root.insertAdjacentHTML('beforeend', `<section class="rp-overview"><h3>${esc(projection.clock.date || projection.clock.description || '剧情时间未知')}</h3>
                <p>${esc(!core.settings.enabled ? '自动提取已暂停' : !channel ? '尚未运行：请先启用随正文或回复后处理' : channel === 'inline' ? '复用随正文输出' : channel === 'reply' ? '复用回复后处理' : '独立提取')}
                · ${core.batches.length ? `最近处理第 ${core.batches.at(-1).floor} 楼` : '尚未处理正文'}</p>
                ${pending ? button('pending', `${pending} 项待确认`) : ''}${view.pending.length ? `<p role="status">${view.pending.length} 项事实需要复核</p>` : ''}</section>`);
        }
        if (nav.tab === 'world') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ plans: '约定', items: '物品', locations: '地点' }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${(nav.filter || 'plans') === key}"`)).join('')}</div>`);
        if (nav.tab === 'history') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ '': '全部', ...trackLabels }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${nav.filter === key}"`)).join('')}</div><label>查看楼层快照<input class="text_pole" type="number" min="0" data-rp-floor value="${nav.floor ?? ''}"></label>${button('snapshot', '查看快照')}${nav.floor == null ? '' : button('current', '返回当前状态')}`);
        if (nav.floor != null) root.insertAdjacentHTML('beforeend', `<p role="status">第 ${nav.floor} 楼时已知状态 · 只读</p>`);
        if (nav.tab !== 'overview') root.insertAdjacentHTML('beforeend', `<form class="rp-search"><label>搜索<input class="text_pole" data-rp-search type="search" value="${esc(nav.search)}"></label>${button('search', '查找')}</form>`);
        const page = buildStatePage(core, view, nav);
        nav.page = page.page;
        root.insertAdjacentHTML('beforeend', `<div class="rp-list">${page.rows.length ? page.rows.map(row => `<button type="button" class="rp-row" data-rp-action="detail" data-rp-kind="${row.kind}" data-rp-id="${esc(row.id)}"><strong>${esc(row.title)}</strong><span>${esc([row.status, row.detail].filter(Boolean).join(' · '))}</span></button>`).join('') : '<p>暂无记录</p>'}</div>`);
        if (page.pages > 1) root.insertAdjacentHTML('beforeend', `<div class="rp-pager">${button('prev', '上一页', page.page ? '' : 'disabled')}<span>${page.page + 1} / ${page.pages}</span>${button('next', '下一页', page.page === page.pages - 1 ? 'disabled' : '')}</div>`);
        root.scrollTop = nav.scroll || 0;
    }
    function readMappings(root, nav) {
        for (const mapping of nav.mappings || []) {
            const area = root.querySelector(`[data-rp-map="${mapping.tableIndex}"]`);
            if (!area) continue;
            mapping.fields = Object.fromEntries([...area.querySelectorAll('[data-rp-map-field]')].filter(input => input.value != null && input.value !== '').map(input => [input.dataset.rpMapField, Number(input.value)]));
        }
    }
    function renderMigration(root, state, nav) {
        root.insertAdjacentHTML('beforeend', `<section class="rp-migration"><h4>字段映射</h4>${nav.mappings.map(mapping => {
            const table = state.tableDatabase.tables[mapping.tableIndex];
            return `<details data-rp-map="${mapping.tableIndex}"><summary>${esc(table.name)} · ${table.rows.length} 行</summary><label>导入为<select data-rp-map-kind data-rp-table="${mapping.tableIndex}" class="text_pole"><option value="">保留在原表格</option>${Object.entries(migrationLabels).map(([kind, label]) => `<option value="${kind}" ${kind === mapping.kind ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${Object.entries(migrationFields[mapping.kind] || {}).map(([field, label]) => `<label>${label}<select class="text_pole" data-rp-map-field="${field}"><option value="">不导入此字段</option>${table.columns.map((name, index) => `<option value="${index}" ${mapping.fields[field] === index ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`).join('')}</details>`;
        }).join('')}${button('migration-preview', '预览基线')}</section>`);
        const preview = nav.migrationPreview;
        if (preview) root.insertAdjacentHTML('beforeend', `<section class="rp-preview"><h4>基线预览</h4><p>${Object.entries(migrationLabels).map(([key, label]) => `${label} ${preview.projection[key].length}`).join(' · ')}</p><p>只导入当前已知状态，不生成过去的事件。</p>${preview.issues.length
            ? `<ul>${preview.issues.slice(0, 20).map(issue => `<li>${esc(issue.table)} 第 ${issue.row} 行：${esc(issue.reason)}</li>`).join('')}</ul>${button('migration-skip', `跳过 ${preview.issues.length} 项并重新预览`)}`
            : button('migration-confirm', '确认导入并启用')}</section>`);
    }
    function renderDetail(root, state, view, nav) {
        const core = state.rpCore, { kind, id } = nav.selected, projection = view.projection;
        const collection = kind === 'candidate' ? core.candidates : core[kind] || projection[kind] || [];
        const item = collection.find(value => value.id === id && (nav.floor == null || !['facts', 'claims', 'observations', 'candidate'].includes(kind) || value.floor <= nav.floor));
        root.insertAdjacentHTML('beforeend', button('back', '返回列表'));
        if (!item) { root.insertAdjacentHTML('beforeend', '<p>记录不在当前视图中。</p>'); return; }
        const record = ['facts', 'claims', 'observations', 'candidate'].includes(kind);
        const title = record ? describeRecord(item, projection) : kind === 'relationships' ? relationshipName(projection, item) : item.name || item.title;
        let content = `<h3 tabindex="-1" class="rp-detail-title">${esc(title)}</h3>`;
        if (record) {
            content += line('类型', trackLabels[item.track || kind]) + line('状态', stateLabels[item.status] || (view.applied.includes(id) ? '有效' : kind === 'facts' ? '待复核' : '已记录'));
            if (item.reason) content += `<p role="status">${esc(item.reason)}</p>`;
            content += `<blockquote>${esc(item.evidence?.excerpt || item.excerpt || '没有证据摘录')}</blockquote>`;
            if (item.evidence) content += button('source', '定位正文');
            if (kind === 'candidate' && item.status === 'pending' && nav.floor == null) {
                const members = item.atomicGroup ? core.candidates.filter(candidate => candidate.atomicGroup === item.atomicGroup) : [item];
                if (members.length > 1) content += `<section><h4>一起处理的 ${members.length} 项</h4><ul>${members.map(member => `<li>${esc(describeRecord(member, projection))} · ${esc(stateLabels[member.status] || member.status)}<blockquote>${esc(member.evidence?.excerpt || member.excerpt || '没有证据摘录')}</blockquote>${member.reason ? `<p>${esc(member.reason)}</p>` : ''}</li>`).join('')}</ul></section>`;
                content += button('review-preview', '预览确认') + button('ignore', '忽略');
                const preview = previews.get(state);
                if (preview?.candidateId === id) content += `<section class="rp-preview"><h4>确认后的影响</h4>${esc(preview.description)}${button('review-confirm', '确认入账')}${button('preview-cancel', '取消')}</section>`;
            }
        } else if (kind === 'people') {
            content += line('当前位置', entityName(projection, item.location)) + line('年龄', item.age?.value)
                + line('别名', (item.aliases || []).join('、') || '无') + line('特征', (item.traits || []).join('；') || '未知');
        } else if (kind === 'relationships') {
            content += line('状态', stateLabels[item.status]) + line('开始', item.since) + line('持续天数', item.elapsedDays)
                + line('下一纪念日', item.anniversary?.nextDate);
            for (const event of [...(item.milestones || []), ...(item.conflicts || [])].slice(-20)) content += line(event.date || '时间未定', event.description);
        } else if (kind === 'plans') {
            content += line('参与者', names(projection, item.participants)) + line('履约状态', stateLabels[item.status]) + line('期限', item.due) + line('结果', item.outcome || '尚无结果');
        } else if (kind === 'items') {
            content += line('所有者', entityName(projection, item.owner)) + line('持有者', entityName(projection, item.holder)) + line('存放地点', entityName(projection, item.location)) + line('数量', item.quantity) + line('状态', stateLabels[item.status]);
        } else content += line('上级地点', entityName(projection, item.parent));
        root.insertAdjacentHTML('beforeend', `<section class="rp-detail">${content}</section>`);
    }
    async function action(element) {
        const state = getState(), nav = navigation.get(state), root = document.querySelector('#bakemono-rp-root');
        const name = element.dataset.rpAction;
        if (name === 'legacy') { navigate('tables'); return; }
        if (name === 'tab') Object.assign(nav, { tab: element.dataset.rpTab, page: 0, filter: '', selected: null, search: '', scroll: 0 });
        if (name === 'filter') Object.assign(nav, { filter: element.dataset.rpFilter, page: 0, search: '', scroll: 0 });
        if (name === 'search') Object.assign(nav, { search: root.querySelector('[data-rp-search]')?.value || '', page: 0, scroll: 0 });
        if (name === 'prev') nav.page = Math.max(0, nav.page - 1);
        if (name === 'next') nav.page++;
        if (name === 'detail' || name === 'review-open') { nav.scroll = root?.scrollTop || 0; nav.selected = { kind: element.dataset.rpKind || 'candidate', id: element.dataset.rpId }; navigate('rp-state'); }
        if (name === 'pending') { Object.assign(nav, { tab: 'history', filter: 'pending', selected: null, page: 0 }); navigate('rp-state'); }
        if (name === 'back') { nav.selected = null; previews.delete(state); }
        if (name === 'settings') nav.settings = !nav.settings;
        if (name === 'enable-preview') nav.setup = true;
        if (name === 'setup-cancel') nav.setup = false;
        if (name === 'enable-confirm') { await service.enable(); nav.setup = false; }
        if (name === 'migration') { nav.mappings = suggestBaselineMappings(state); nav.migrationPreview = null; }
        if (name === 'migration-preview') { readMappings(root, nav); nav.migrationPreview = buildBaselinePreview(state, nav.mappings); }
        if (name === 'migration-skip') {
            const previous = nav.migrationPreview;
            if (!previous || previous.sourceSignature !== JSON.stringify(state.tableDatabase.tables)) throw new Error('表格已变化，请重新预览');
            nav.migrationPreview = buildBaselinePreview(state, previous.mappings, { skipRows: [...previous.skipRows, ...previous.issues.map(item => item.rowKey)] });
        }
        if (name === 'migration-confirm') {
            const preview = nav.migrationPreview;
            if (!preview || preview.issues.length || preview.sourceSignature !== JSON.stringify(state.tableDatabase.tables)) throw new Error('表格已变化或存在未处理项，请重新预览');
            await service.enable({ projection: preview.projection }); nav.setup = false; nav.mappings = null; nav.migrationPreview = null;
        }
        if (name === 'save-settings') {
            const patch = Object.fromEntries([...root.querySelectorAll('[data-rp-setting]')].map(input => [input.dataset.rpSetting, input.checked]));
            patch.mode = root.querySelector('[data-rp-mode]').value;
            await service.configure(patch); nav.settings = false;
        }
        if (name === 'snapshot') {
            const value = root.querySelector('[data-rp-floor]')?.value;
            if (value === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error('请输入有效楼层');
            Object.assign(nav, { floor: Number(value), page: 0 });
        }
        if (name === 'current') nav.floor = null;
        if (name === 'extract') await flow.runIndependent({ manual: true });
        if (name === 'review-preview') {
            const item = state.rpCore.candidates.find(candidate => candidate.id === nav.selected.id);
            const previous = item.previousIds.map(id => state.rpCore.candidates.find(candidate => candidate.id === id)?.factId).filter(Boolean);
            if (previous.length > 1) throw new Error('存在多个可能的替代目标，请先核对历史');
            const preview = service.previewReview(item.id, 'accept', { replaceFactId: previous[0] || null });
            const description = item.track === 'facts'
                ? `有效事实 ${preview.before.applied.length} → ${preview.after.applied.length}；需复核 ${preview.before.pending.length} → ${preview.after.pending.length}${previous.length ? '；将替代原事实' : ''}`
                : '记录这条信息，不改变当前世界事实。';
            previews.set(state, { ...preview, candidateId: item.id, description });
        }
        if (name === 'review-confirm') {
            const preview = previews.get(state);
            if (!preview || preview.candidateId !== nav.selected.id) throw new Error('请重新预览');
            await preview.commit(); previews.delete(state); nav.selected = null;
        }
        if (name === 'ignore') { await service.review(nav.selected.id, 'ignore'); nav.selected = null; }
        if (name === 'preview-cancel') previews.delete(state);
        if (name === 'source') {
            const item = (nav.selected.kind === 'candidate' ? state.rpCore.candidates : state.rpCore[nav.selected.kind]).find(value => value.id === nav.selected.id);
            locateSource?.(item.evidence);
        }
        if (getState() !== state) return;
        nav.error = ''; render(state); renderReview(state); refresh?.();
        if (['detail', 'review-open'].includes(name)) root.querySelector('.rp-detail-title')?.focus();
    }
    const click = async event => {
        const element = event.target.closest?.('[data-rp-action]');
        if (element?.dataset.rpAction === 'stop') { event.preventDefault(); flow.stopIndependent(); return; }
        if (!element || busy) return;
        event.preventDefault(); busy = true; element.disabled = true;
        const state = getState();
        try { await action(element); }
        catch (error) { if (getState() === state) { navigation.get(state).error = error.message; render(state); } }
        finally { busy = false; element.disabled = false; }
    };
    const change = event => {
        const input = event.target.closest?.('[data-rp-map-kind]');
        if (!input || busy) return;
        const state = getState(), nav = navigation.get(state);
        readMappings(document.querySelector('#bakemono-rp-root'), nav);
        const mapping = nav.mappings?.find(item => item.tableIndex === Number(input.dataset.rpTable));
        if (mapping) { mapping.kind = input.value; mapping.fields = {}; nav.migrationPreview = null; render(state); }
    };
    function bind() {
        document.removeEventListener('click', click); document.addEventListener('click', click);
        document.removeEventListener('change', change); document.addEventListener('change', change);
        document.removeEventListener('submit', submit); document.addEventListener('submit', submit);
    }
    const submit = event => {
        if (!event.target.matches?.('#bakemono-rp-root .rp-search')) return;
        event.preventDefault();
        const element = event.target.querySelector('[data-rp-action="search"]');
        if (element) void click({ target: element, preventDefault() {} });
    };
    return { render, renderReview, bind, navigation };
}
