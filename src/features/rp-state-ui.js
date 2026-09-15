import { buildStatePage, createStateNavigation, describeRecord, relationshipName, stateLabels, trackLabels } from '../rp-core/state-view.js';
import { buildBaselinePreview, suggestBaselineMappings, migrationFields, migrationLabels } from '../rp-core/migration.js';
import { createRpStatePresentation } from './rp-state-presentation.js';

export function createRpStateUi({ documentRef: document, getState, service, flow, navigate, refresh, escapeHtml: esc, locateSource }) {
    const navigation = createStateNavigation(), previews = new WeakMap(), repairs = new WeakMap(), renderedStates = new WeakMap();
    const presentation = createRpStatePresentation({ escapeHtml: esc });
    let busy = false;
    const tabs = { overview: '概览', people: '人物关系', world: '世界状态', history: '历史' };
    const button = (action, label, extra = '') => `<button type="button" class="menu_button${['save-settings', 'review-confirm', 'repair-confirm', 'enable-preview', 'enable-confirm', 'migration-confirm'].includes(action) ? ' rp-primary' : ''}" data-rp-action="${action}" ${extra}><span>${esc(label)}</span></button>`;
    const help = text => `<button type="button" class="bakemono-memory-help-trigger" aria-label="使用说明" aria-expanded="false"><i class="fa-solid fa-circle-info"></i><span class="bakemono-memory-help-content">${esc(text)}</span></button>`;
    const line = (label, value) => `<p><span>${esc(label)}</span>：${esc(value ?? '未知')}</p>`;
    const sectionHead = (title, action = '', extra = '') => `<div class="rp-section-head"><h3>${esc(title)}</h3>${action ? button(action, '查看全部', extra) : ''}</div>`;
    const scrollSurface = root => root?.closest('.bakemono-workbench-main') || root;
    const detailOrigin = element => ({ kind: element.dataset.rpKind, id: element.dataset.rpId });
    function renderSettings(root, state, nav) {
        const core = state.rpCore;
        const settings = nav.settingsDraft || core.settings;
        const selected = settings.mode === 'reuse' ? flow.channel({ ...state, rpCore: { ...core, settings: { ...settings, enabled: true } } }) || 'inline' : settings.mode;
        const modes = { inline: ['随正文维护', '保留预设摘要，同一轮额外输出事件块；不另发请求。'], reply: ['复用回复后处理', '复用已启用的摘要或填表请求；不会替你开启回复后处理。'], independent: ['独立提取', '回复后额外调用一次默认生成模型，产生额外 API 用量。'] };
        root.insertAdjacentHTML('beforeend', `${button('settings', '‹ 返回')}<section class="rp-settings"><div class="rp-detail-head"><span class="rp-eyebrow">维护方式</span><h3>按你的聊天习惯来</h3></div><div class="rp-sheet">${Object.entries(modes).map(([value, [title, description]]) => `<label class="rp-choice"><input type="radio" name="rp-maintenance-mode" data-rp-mode value="${value}" ${selected === value ? 'checked' : ''}><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span></label>`).join('')}</div>${['enabled', 'autoApply', 'inject'].map((key, i) => `<label class="rp-choice"><input type="checkbox" data-rp-setting="${key}" ${settings[key] ? 'checked' : ''}><span>${['自动维护剧情状态', '明确无冲突的新内容自动保存', '注入当前状态'][i]}</span></label>`).join('')}<div class="rp-controls">${button('save-settings', '保存设置')}${help('随正文模式不需要开启回复后处理。模型需在原 bakemono 块外输出 rpEvents；已有普通摘要不会被直接转换成事实。旧正文可主动选择独立提取。关闭自动维护或注入不删除账本。再次提取旧楼层不会静默改写已确认事实。')}</div></section>`);
    }

    function renderReview(state = getState()) {
        const root = document.querySelector('#bakemono-rp-review');
        if (!root) return;
        renderedStates.set(root, state);
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
        renderedStates.set(root, state);
        const nav = navigation.get(state), core = state.rpCore;
        let view;
        try { view = core ? service.view(state, nav.floor == null ? {} : { asOfFloor: nav.floor }) : null; }
        catch (error) {
            root.innerHTML = `<p role="alert">${esc(error.message)}</p>${button('legacy', '打开原表格')}`;
            return;
        }
        if (!core) {
            root.innerHTML = `<section class="rp-blank"><span class="rp-blank-mark"><i class="fa-solid fa-book-open" aria-hidden="true"></i></span><span class="rp-eyebrow">剧情状态 · 尚未启用</span><h3>让故事，有迹可循。</h3><p>随着每一轮对话，整理人物关系、当下的处境，以及还没赴的约。</p><ul class="rp-onboarding-list"><li>谁和谁，有怎样的关系</li><li>接下来，有哪些约定</li><li>每次变化，都能回看来源</li></ul><div class="rp-controls">${button('enable-preview', '从这一轮开始')}${help('默认随正文维护，不额外发送请求。需要模型输出 rpEvents；普通 bakemono 摘要继续按原流程读取，不会直接变成事实。可以空白开始，也可预览导入旧表的已知状态。')}</div></section>`;
            if (nav.error) root.insertAdjacentHTML('beforeend', `<p role="alert">${esc(nav.error)}</p>`);
            if (nav.setup) {
                root.insertAdjacentHTML('beforeend', `<section class="rp-preview"><h4>空白开始</h4><p>从当前楼层建立基线；已有摘要、自定义表格和聊天正文保持不变。</p>${button('enable-confirm', '确认空白启用')}${button('migration', '预览导入已有状态')}${button('setup-cancel', '返回')}</section>`);
                if (nav.mappings) renderMigration(root, state, nav);
            }
            return;
        }
        const hasData = core.facts.length + core.claims.length + core.observations.length
            + (view?.projection ? ['people', 'relationships', 'plans', 'items', 'locations'].reduce((sum, key) => sum + view.projection[key].length, 0) + Number(!!(view.projection.clock.date || view.projection.clock.description)) : 0);
        const navMarkup = `<nav class="rp-tabs" aria-label="剧情状态页面" ${!hasData && !nav.selected && nav.tab === 'overview' ? 'hidden' : ''}>${Object.entries(tabs).map(([key, label]) => button('tab', label, `data-rp-tab="${key}" aria-current="${nav.tab === key ? 'page' : 'false'}"`)).join('')}</nav>`;
        root.innerHTML = navMarkup;
        if (nav.notice) root.insertAdjacentHTML('beforeend', `<p role="status">${esc(nav.notice)}</p>`);
        if (nav.error) root.insertAdjacentHTML('beforeend', `<p role="alert">${esc(nav.error)}</p>`);
        if (nav.floor != null) root.insertAdjacentHTML('beforeend', `<div class="rp-read-only"><span>第 ${nav.floor} 楼时已知状态 · 只读</span>${button('current', '返回当前')}</div>`);
        if (nav.settings) { renderSettings(root, state, nav); return; }
        if (!view?.projection) { root.insertAdjacentHTML('beforeend', `<p>所选楼层早于基线，没有可用状态。</p>${button('current', '返回当前状态')}`); return; }
        const projection = view.projection;
        if (nav.selected) { renderDetail(root, state, view, nav); return; }
        const pending = core.candidates.filter(item => item.status === 'pending').length;
        const channel = flow.channel(state), lastBatch = core.batches.at(-1);
        const maintenance = !core.settings.enabled ? '自动维护已暂停' : !channel ? '尚未运行：回复后处理未开启' : channel === 'inline' ? '随正文维护' : channel === 'reply' ? '复用回复后处理' : '独立提取';
        const footer = `<footer class="rp-footer"><small>${nav.floor == null ? esc(maintenance) + (lastBatch ? ` · 已处理到 ${lastBatch.floor} 楼` : ' · 尚未处理正文') : '历史快照 · 只读'}</small><div class="rp-controls">${nav.floor == null ? button('settings', '维护设置') : ''}${help('明确的新内容经过校验后自动保存，例外进入待确认。随正文需要额外的 rpEvents，不必开启回复后处理。说法、观察与事实分别保存；关闭维护不删除记录。')}</div></footer>`;
        if (pending && nav.floor == null) root.insertAdjacentHTML('beforeend', `<div class="rp-notice"><span aria-hidden="true">?</span><div><strong>${pending} 项需要确认</strong><small>其余已确认内容照常保存</small></div>${button('pending', '查看')}</div>`);
        if (view.pending.length) root.insertAdjacentHTML('beforeend', `<div class="rp-notice rp-error"><div><strong>${view.pending.length} 项事实需要复核</strong><small>这些记录暂不参与当前状态</small></div>${button('facts', '查看')}</div>`);
        if (nav.tab === 'overview') {
            if (!hasData) {
                root.insertAdjacentHTML('beforeend', `<section class="rp-blank"><span class="rp-blank-mark"><i class="fa-solid fa-film" aria-hidden="true"></i></span><h3>${nav.floor != null ? '当时尚无状态记录' : core.settings.enabled ? '等故事写下下一页' : '自动维护已暂停'}</h3><p>${!channel && core.settings.enabled ? '尚未运行：请在维护设置中选择可用的方式。' : '人物、关系与约定，会随着确认的剧情进展出现在这里。'}</p><div class="rp-controls">${nav.floor != null ? '' : channel === 'inline' ? button('capture', '检查最新正文') : channel === 'independent' ? button('extract', '处理最新正文') + button('stop', '停止提取') : ''}</div></section>${footer}`);
                return;
            }
            root.insertAdjacentHTML('beforeend', presentation.scene(projection, lastBatch, nav.floor));
            const overview = buildStatePage(core, view, { tab: 'overview' }).rows;
            root.insertAdjacentHTML('beforeend', `<div class="rp-overview-grid"><section>${sectionHead('人物关系', 'people')}${presentation.rows(overview.filter(row => row.kind === 'relationships'), projection)}</section><section>${sectionHead('接下来的约定', 'plans')}${presentation.rows(overview.filter(row => row.kind === 'plans'), projection)}</section><section class="rp-wide">${sectionHead('最近变化', 'history')}${presentation.rows(buildStatePage(core, view, { tab: 'history', filter: 'facts', floor: nav.floor }).rows.slice(0, 3), projection, { recent: true })}</section></div>`);
            if (channel === 'independent' && nav.floor == null) root.insertAdjacentHTML('beforeend', `<div class="rp-controls rp-run-controls">${button('extract', '处理最新正文')}${button('stop', '停止提取')}</div>${core.extractionJobs?.some(job => ['running', 'paused', 'failed'].includes(job.status)) ? '<p role="status">有未完成提取；可手动重试，不会自动重复计费。</p>' : ''}`);
            if (channel === 'inline' && !lastBatch && nav.floor == null) root.insertAdjacentHTML('beforeend', `<div class="rp-controls rp-run-controls">${button('capture', '检查最新正文')}</div>`);
            root.insertAdjacentHTML('beforeend', footer); return;
        }
        if (nav.tab === 'people') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ '': '全部', people: '人物', relationships: '关系' }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${nav.filter === key}"`)).join('')}</div>`);
        if (nav.tab === 'world') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ plans: '约定', items: '物品', locations: '地点' }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${(nav.filter || 'plans') === key}"`)).join('')}</div>`);
        if (nav.tab === 'history') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ '': '全部', ...trackLabels }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${nav.filter === key}"`)).join('')}</div><details class="rp-snapshot"><summary>查看过去某一楼的状态</summary><label>楼层<input class="text_pole" type="number" min="0" data-rp-floor value="${nav.floor ?? ''}"></label>${button('snapshot', '查看快照')}</details>`);
        if (nav.tab !== 'overview') root.insertAdjacentHTML('beforeend', `<form class="rp-search"><label><span class="rp-sr-only">搜索当前列表</span><input class="text_pole" data-rp-search type="search" placeholder="${nav.tab === 'people' ? '查找人物、关系…' : '查找当前列表…'}" value="${esc(nav.search)}"></label>${button('search', '查找')}</form>`);
        const page = buildStatePage(core, view, nav);
        nav.page = page.page;
        if (nav.tab === 'people' && page.rows.length) {
            for (const [kind, title] of Object.entries({ people: '故事里的人', relationships: '人物关系' })) {
                const rows = page.rows.filter(row => row.kind === kind);
                if (rows.length) root.insertAdjacentHTML('beforeend', sectionHead(title) + presentation.rows(rows, projection));
            }
        } else root.insertAdjacentHTML('beforeend', presentation.rows(page.rows, projection));
        if (page.pages > 1) root.insertAdjacentHTML('beforeend', `<div class="rp-pager">${button('prev', '上一页', page.page ? '' : 'disabled')}<span>${page.page + 1} / ${page.pages}</span>${button('next', '下一页', page.page === page.pages - 1 ? 'disabled' : '')}</div>`);
        root.insertAdjacentHTML('beforeend', footer);
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
                if (!item.evidence || item.evidenceStatus !== 'located') content += `<div class="rp-notice rp-error"><div><strong>暂未写入：来源需要校正</strong><small>输入能够在原正文找到的摘录；重复句请带上前后文。</small></div></div>`;
                content += `<details class="rp-evidence-editor" ${item.evidence ? '' : 'open'}><summary>校正原文摘录</summary><label>原文摘录<textarea class="text_pole" data-rp-excerpt rows="4" maxlength="6000">${esc(nav.evidenceDraft ?? item.excerpt ?? '')}</textarea></label>${button('repair-preview', '检查定位')}`;
                const repair = repairs.get(state);
                if (repair?.candidateId === id) content += `<section class="rp-preview"><h4>已定位到第 ${repair.floor} 楼</h4><blockquote>${esc(repair.excerpt)}</blockquote><p>只校正来源，不直接确认事件。</p>${button('repair-confirm', '确认校正来源')}</section>`;
                content += `</details><div class="rp-controls">${button('review-preview', '预览确认', item.evidence ? '' : 'disabled')}${button('ignore', '暂不记录')}</div>`;
                const preview = previews.get(state);
                if (preview?.candidateId === id) content += `<section class="rp-preview"><h4>确认后的影响</h4>${esc(preview.description)}${button('review-confirm', '确认入账')}${button('preview-cancel', '取消')}</section>`;
            }
        } else content = presentation.entityDetail(kind, item, core, projection, nav.floor);
        root.insertAdjacentHTML('beforeend', `<section class="rp-detail${record ? ' rp-review-detail' : ''}">${content}</section>`);
    }
    async function action(element) {
        const state = getState(), nav = navigation.get(state), root = document.querySelector('#bakemono-rp-root');
        if (renderedStates.get(element.closest('#bakemono-rp-root, #bakemono-rp-review')) !== state) throw new Error('聊天已切换，请重新打开剧情状态');
        const name = element.dataset.rpAction;
        nav.notice = '';
        if (name === 'legacy') { navigate('tables'); return; }
        if (name === 'tab') Object.assign(nav, { tab: element.dataset.rpTab, page: 0, filter: '', selected: null, search: '', scroll: 0, settings: false, evidenceDraft: null, trail: [] });
        if (['people', 'plans', 'history', 'facts'].includes(name)) Object.assign(nav, { tab: name === 'plans' ? 'world' : name === 'facts' ? 'history' : name, filter: name === 'plans' ? 'plans' : name === 'facts' ? 'facts' : '', page: 0, selected: null, search: '', trail: [] });
        if (name === 'filter') Object.assign(nav, { filter: element.dataset.rpFilter, page: 0, search: '', scroll: 0 });
        if (name === 'search') Object.assign(nav, { search: root.querySelector('[data-rp-search]')?.value || '', page: 0, scroll: 0 });
        if (name === 'prev') nav.page = Math.max(0, nav.page - 1);
        if (name === 'next') nav.page++;
        if (name === 'detail' || name === 'review-open') {
            if (name === 'review-open') { nav.trail = []; nav.selected = null; nav.floor = null; nav.settings = false; }
            nav.trail ||= [];
            nav.trail.push({ selected: nav.selected, tab: nav.tab, filter: nav.filter, page: nav.page, search: nav.search, floor: nav.floor,
                scroll: scrollSurface(root)?.scrollTop || 0, origin: detailOrigin(element) });
            nav.evidenceDraft = null; repairs.delete(state); previews.delete(state);
            nav.selected = { kind: element.dataset.rpKind || 'candidate', id: element.dataset.rpId }; navigate('rp-state');
        }
        if (name === 'pending') { Object.assign(nav, { tab: 'history', filter: 'pending', selected: null, page: 0, floor: null, settings: false, trail: [] }); navigate('rp-state'); }
        if (name === 'back') {
            const previous = nav.trail?.pop();
            Object.assign(nav, previous || { selected: null, scroll: 0 });
            nav.evidenceDraft = null; previews.delete(state); repairs.delete(state);
        }
        if (name === 'settings') { nav.settings = !nav.settings; nav.settingsDraft = null; }
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
            patch.mode = root.querySelector('[data-rp-mode]:checked')?.value;
            await service.configure(patch); nav.settings = false; nav.settingsDraft = null;
        }
        if (name === 'snapshot') {
            const value = root.querySelector('[data-rp-floor]')?.value;
            if (value === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error('请输入有效楼层');
            Object.assign(nav, { floor: Number(value), page: 0, tab: 'overview', filter: '', selected: null, trail: [] });
        }
        if (name === 'current') { nav.floor = null; nav.selected = null; nav.trail = []; }
        if (name === 'extract') await flow.runIndependent({ manual: true });
        if (name === 'capture') {
            const result = await flow.captureInline({ detailed: true });
            nav.notice = ({ processed: '本轮事件已处理，请查看当前状态和待确认项。', unchanged: '本轮事件已处理过，没有新增内容。',
                delayed: '延迟一轮已开启，发送下一条消息后处理上一轮。', busy: '当前任务正在运行，请稍后再试。',
                inactive: '请先在维护设置中开启随正文维护。', missing: '最新回复没有完整的 rpEvents 事件块。' })[result.status];
        }
        if (name === 'repair-preview') {
            nav.evidenceDraft = root.querySelector('[data-rp-excerpt]')?.value || '';
            previews.delete(state); repairs.delete(state);
            repairs.set(state, { ...service.previewEvidenceRepair(nav.selected.id, nav.evidenceDraft), candidateId: nav.selected.id });
        }
        if (name === 'repair-confirm') {
            const repair = repairs.get(state);
            if (!repair || repair.candidateId !== nav.selected.id || root.querySelector('[data-rp-excerpt]')?.value !== repair.excerpt) throw new Error('摘录已变化，请重新检查定位');
            await repair.commit(); repairs.delete(state); previews.delete(state); nav.evidenceDraft = null;
        }
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
            await preview.commit(); previews.delete(state); nav.selected = null; nav.trail = []; nav.notice = '记录已保存。';
        }
        if (name === 'ignore') { await service.review(nav.selected.id, 'ignore'); nav.selected = null; nav.trail = []; }
        if (name === 'preview-cancel') previews.delete(state);
        if (name === 'source') {
            const item = (nav.selected.kind === 'candidate' ? state.rpCore.candidates : state.rpCore[nav.selected.kind]).find(value => value.id === nav.selected.id);
            locateSource?.(item.evidence);
        }
        if (getState() !== state) return;
        nav.error = ''; render(state); renderReview(state); refresh?.();
        if (['detail', 'review-open'].includes(name)) { scrollSurface(root).scrollTop = 0; root.querySelector('.rp-detail-title')?.focus({ preventScroll: true }); }
        if (name === 'back') {
            [...root.querySelectorAll('[data-rp-action="detail"]')].find(node => node.dataset.rpKind === nav.origin?.kind && node.dataset.rpId === nav.origin?.id)?.focus({ preventScroll: true });
            scrollSurface(root).scrollTop = nav.scroll || 0;
        }
        if (['tab', 'filter', 'prev', 'next', 'search', 'snapshot', 'current'].includes(name)) {
            const selector = name === 'tab' ? `[data-rp-tab="${nav.tab}"]` : name === 'filter' ? `[data-rp-filter="${nav.filter}"]` : '[data-rp-search]';
            root.querySelector(selector)?.focus({ preventScroll: true });
            scrollSurface(root).scrollTop = 0;
        }
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
        if (event.target.matches?.('[data-rp-setting], [data-rp-mode]')) {
            const state = getState(), root = event.target.closest('#bakemono-rp-root');
            if (renderedStates.get(root) !== state) return;
            navigation.get(state).settingsDraft = { ...state.rpCore.settings,
                ...Object.fromEntries([...root.querySelectorAll('[data-rp-setting]')].map(input => [input.dataset.rpSetting, input.checked])),
                mode: root.querySelector('[data-rp-mode]:checked')?.value };
            return;
        }
        const input = event.target.closest?.('[data-rp-map-kind]');
        if (!input || busy || renderedStates.get(input.closest('#bakemono-rp-root')) !== getState()) return;
        const state = getState(), nav = navigation.get(state);
        readMappings(document.querySelector('#bakemono-rp-root'), nav);
        const mapping = nav.mappings?.find(item => item.tableIndex === Number(input.dataset.rpTable));
        if (mapping) { mapping.kind = input.value; mapping.fields = {}; nav.migrationPreview = null; render(state); }
    };
    function bind() {
        document.removeEventListener('click', click); document.addEventListener('click', click);
        document.removeEventListener('change', change); document.addEventListener('change', change);
        document.removeEventListener('submit', submit); document.addEventListener('submit', submit);
        document.removeEventListener('input', input); document.addEventListener('input', input);
        document.removeEventListener('keydown', keydown); document.addEventListener('keydown', keydown);
    }
    const keydown = event => {
        if (event.key !== 'Escape' || !event.target.closest?.('#bakemono-rp-root') || !navigation.get(getState()).selected) return;
        const back = document.querySelector('#bakemono-rp-root [data-rp-action="back"]');
        if (back) { event.preventDefault(); event.stopPropagation(); void click({ target: back, preventDefault() {} }); }
    };
    const input = event => {
        if (!event.target.matches?.('[data-rp-excerpt]') || renderedStates.get(event.target.closest('#bakemono-rp-root')) !== getState()) return;
        const state = getState();
        navigation.get(state).evidenceDraft = event.target.value;
        repairs.delete(state);
        event.target.closest('.rp-evidence-editor')?.querySelector('.rp-preview')?.remove();
    };
    const submit = event => {
        if (!event.target.matches?.('#bakemono-rp-root .rp-search')) return;
        event.preventDefault();
        const element = event.target.querySelector('[data-rp-action="search"]');
        if (element) void click({ target: element, preventDefault() {} });
    };
    return { render, renderReview, bind, navigation };
}
