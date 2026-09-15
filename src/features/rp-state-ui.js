import { buildStatePage, createStateNavigation, describeRecord, describeStateValues, relationshipName, stateLabels, trackLabels, isCurrentRpRecord } from '../rp-core/state-view.js';
import { buildBaselinePreview, suggestBaselineMappings, migrationFields, migrationLabels } from '../rp-core/migration.js';
import { createRpStateEditors } from './rp-state-editors.js';
import { createRpStatePresentation } from './rp-state-presentation.js';

export function createRpStateUi({ documentRef: document, getState, service, flow, navigate, refresh, escapeHtml: esc, locateSource, promptLibrary }) {
    const navigation = createStateNavigation(), renderedStates = new WeakMap();
    const presentation = createRpStatePresentation({ escapeHtml: esc });
    let busy = false;
    const tabs = { overview: '概览', people: '人物关系', world: '世界状态', history: '历史' };
    const button = (action, label, extra = '') => `<button type="button" class="menu_button${['save-settings', 'edit-save', 'prompt-apply', 'enable-preview', 'enable-confirm', 'migration-confirm'].includes(action) ? ' rp-primary' : ''}" data-rp-action="${action}" ${extra}><span>${esc(label)}</span></button>`;
    const help = text => `<button type="button" class="bakemono-memory-help-trigger" aria-label="使用说明" aria-expanded="false"><i class="fa-solid fa-circle-info"></i><span class="bakemono-memory-help-content">${esc(text)}</span></button>`;
    const editors = createRpStateEditors({ escapeHtml: esc, button, help });
    const line = (label, value) => `<p><span>${esc(label)}</span>：${esc(value ?? '未知')}</p>`;
    const sectionHead = (title, action = '', extra = '') => `<div class="rp-section-head"><h3>${esc(title)}</h3>${action ? button(action, '查看全部', extra) : ''}</div>`;
    const scrollSurface = root => root?.closest('.bakemono-workbench-main') || root;
    const detailOrigin = element => ({ kind: element.dataset.rpKind, id: element.dataset.rpId });
    function renderSettings(root, state, nav) {
        const core = state.rpCore;
        const settings = nav.settingsDraft || core.settings;
        const selected = settings.mode === 'reuse' ? flow.channel({ ...state, rpCore: { ...core, settings: { ...settings, enabled: true } } }) || 'inline' : settings.mode;
        const modes = { inline: ['随正文维护', '保留预设摘要，同一轮额外输出事件块；不另发请求。'], reply: ['复用回复后处理', '复用已启用的摘要或填表请求；不会替你开启回复后处理。'], independent: ['独立提取', '回复后额外调用一次默认生成模型，产生额外 API 用量。'] };
        const referenceSettings = `<details class="rp-reference-settings" ${selected === 'independent' ? '' : 'hidden'}><summary>独立提取的参考范围</summary>${[['includeCharacterContext', '角色卡与用户人设', settings.includeCharacterContext !== false], ['includeWorldInfo', '命中的世界书条目', settings.includeWorldInfo === true]].map(([key, label, checked]) => `<label class="rp-choice"><input type="checkbox" data-rp-setting="${key}" ${checked ? 'checked' : ''}><span>${label}</span></label>`).join('')}${help('默认提供本轮正文、摘要、近期对话和当前状态。角色卡最多 6000 字，世界书命中参考最多 6000 字；不会发送整本世界书。参考内容不作为本轮新事件的证据。')}</details>`;
        root.insertAdjacentHTML('beforeend', `${button('settings', '‹ 返回')}<section class="rp-settings"><div class="rp-detail-head"><span class="rp-eyebrow">维护方式</span><h3>按你的聊天习惯来</h3></div><div class="rp-sheet">${Object.entries(modes).map(([value, [title, description]]) => `<label class="rp-choice"><input type="radio" name="rp-maintenance-mode" data-rp-mode value="${value}" ${selected === value ? 'checked' : ''}><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span></label>`).join('')}</div>${referenceSettings}${['enabled', 'inject'].map((key, i) => `<label class="rp-choice"><input type="checkbox" data-rp-setting="${key}" ${settings[key] ? 'checked' : ''}><span>${['自动维护剧情状态', '注入当前状态'][i]}</span></label>`).join('')}<div class="rp-controls">${button('save-settings', '保存设置')}${help('随正文模式不需要开启回复后处理。模型需在原 bakemono 块外输出 rpEvents；摘要中的明确时间、当前地点和在场角色可直接读取；自由文本由模型整理。旧正文可主动选择独立提取。关闭自动维护或注入不删除账本。模型自动收录，用户可在详情中修改。')}</div>${editors.renderPrompt(promptLibrary, nav)}</section>`);
    }

    function renderReview(state = getState()) {
        const root = document.querySelector('#bakemono-rp-review');
        if (root) { renderedStates.set(root, state); root.hidden = true; root.innerHTML = ''; }
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
            root.innerHTML = `<section class="rp-blank"><span class="rp-blank-mark"><i class="fa-solid fa-book-open" aria-hidden="true"></i></span><span class="rp-eyebrow">剧情状态 · 尚未启用</span><h3>让故事，有迹可循。</h3><p>随着每一轮对话，整理人物关系、当下的处境，以及还没赴的约。</p><ul class="rp-onboarding-list"><li>谁和谁，有怎样的关系</li><li>接下来，有哪些约定</li><li>每次变化，都能回看来源</li></ul><div class="rp-controls">${button('enable-preview', '从这一轮开始')}${help('默认随正文维护，不额外发送请求。需要模型输出 rpEvents；摘要中的明确状态可直接读取；模型补充其他变化。可以空白开始，也可预览导入旧表的已知状态。')}</div></section>`;
            if (nav.error) root.insertAdjacentHTML('beforeend', `<p role="alert">${esc(nav.error)}</p>`);
            if (nav.setup) {
                root.insertAdjacentHTML('beforeend', `<section class="rp-preview"><h4>空白开始</h4><p>从当前楼层建立基线；已有摘要、自定义表格和聊天正文保持不变。</p>${button('enable-confirm', '确认空白启用')}${button('migration', '预览导入已有状态')}${button('setup-cancel', '返回')}</section>`);
                if (nav.mappings) renderMigration(root, state, nav);
            }
            return;
        }
        const hasData = core.facts.length + core.claims.length + core.observations.length
            + (view?.projection ? ['people', 'relationships', 'plans', 'items', 'locations'].reduce((sum, key) => sum + view.projection[key].length, 0) + Number(!!(view.projection.clock.date || view.projection.clock.description)) : 0);
        const pageTitle = nav.tab === 'world' ? ({ plans: '约定', items: '物品', locations: '地点' })[nav.filter || 'plans'] : tabs[nav.tab] || '剧情时间';
        const navMarkup = nav.tab === 'overview' || nav.selected || nav.settings ? '' : `<nav class="rp-breadcrumb" aria-label="剧情状态页面">${button('tab', '‹ 总概览', 'data-rp-tab="overview"')}<h3 tabindex="-1">${esc(pageTitle)}</h3></nav>`;
        root.innerHTML = navMarkup;
        if (nav.notice) root.insertAdjacentHTML('beforeend', `<p role="status">${esc(nav.notice)}</p>`);
        if (nav.error) root.insertAdjacentHTML('beforeend', `<p role="alert">${esc(nav.error)}</p>`);
        if (nav.floor != null) root.insertAdjacentHTML('beforeend', `<div class="rp-read-only"><span>第 ${nav.floor} 楼时已知状态 · 只读</span>${button('current', '返回当前')}</div>`);
        if (nav.settings) { renderSettings(root, state, nav); return; }
        if (nav.edit) { root.insertAdjacentHTML('beforeend', editors.renderEdit(nav.edit, view.projection)); return; }
        if (!view?.projection) { root.insertAdjacentHTML('beforeend', `<p>所选楼层早于基线，没有可用状态。</p>${button('current', '返回当前状态')}`); return; }
        const projection = view.projection;
        if (nav.selected) { renderDetail(root, state, view, nav); return; }
        const channel = flow.channel(state), lastBatch = core.batches.at(-1);
        const maintenance = !core.settings.enabled ? '自动维护已暂停' : !channel ? '尚未运行：回复后处理未开启' : channel === 'inline' ? '随正文维护' : channel === 'reply' ? '复用回复后处理' : '独立提取';
        const footer = `<footer class="rp-footer"><small>${nav.floor == null ? esc(maintenance) + (lastBatch ? ` · ${lastBatch.protocolStatus === 'missing' ? '摘要状态已读取' : '已处理到'} ${lastBatch.floor} 楼` : ' · 尚未处理正文') : '历史快照 · 只读'}</small><div class="rp-controls">${nav.floor == null ? button('settings', '维护设置') : ''}${help('模型整理后自动保存；格式无效的项目跳过，不需要逐条确认。摘要中的明确时间、当前地点和在场人物可直接读取；其他变化由模型输出事件。不必开启回复后处理。说法、观察与事实分别保存；关闭维护不删除记录。')}</div></footer>`;
        if (lastBatch?.protocolStatus === 'incomplete' && nav.floor == null) root.insertAdjacentHTML('beforeend', '<p class="rp-status-warning" role="status">本轮事件块未完整输出；可读取的摘要状态已保留。</p>');
        if (lastBatch?.protocolIssues?.length && nav.floor == null) root.insertAdjacentHTML('beforeend', `<details class="rp-status-warning rp-protocol-issues"><summary>第 ${esc(lastBatch.floor)} 楼有 ${lastBatch.protocolIssues.length} 项格式问题</summary><p>下列项及其关联操作暂未处理；其他候选已继续校验。修正事件块后可重新处理。</p><ul>${lastBatch.protocolIssues.map(issue => `<li>第 ${esc(issue.index)} 项：${esc(issue.reason)}</li>`).join('')}</ul></details>`);
        const invalidFacts = view.pending.filter(item => isCurrentRpRecord(view, { id: item.factId }));
        if (invalidFacts.length) root.insertAdjacentHTML('beforeend', `<div class="rp-notice rp-error"><div><strong>${invalidFacts.length} 项旧记录暂未采用</strong><small>这些记录暂不参与当前状态</small></div>${button('facts', '查看')}</div>`);
        if (nav.tab === 'overview') {
            if (!hasData) {
                root.insertAdjacentHTML('beforeend', `<section class="rp-blank"><span class="rp-blank-mark"><i class="fa-solid fa-film" aria-hidden="true"></i></span><h3>${nav.floor != null ? '当时尚无状态记录' : core.settings.enabled ? '等故事写下下一页' : '自动维护已暂停'}</h3><p>${!channel && core.settings.enabled ? '尚未运行：请在维护设置中选择可用的方式。' : '人物、关系与约定，会随着剧情进展自动记录。'}</p><div class="rp-controls">${nav.floor != null ? '' : channel === 'inline' ? button('capture', '检查最新正文') : channel === 'independent' ? button('extract', '处理最新正文') + button('stop', '停止提取') : ''}</div></section>${footer}`);
                return;
            }
            const applied = new Set(view.applied);
            const facts = core.facts.filter(item => applied.has(item.id) && (nav.floor == null || item.floor <= nav.floor));
            const recentRows = [...facts].sort((a, b) => b.sequence - a.sequence).slice(0, 2)
                .map(item => ({ kind: 'facts', id: item.id, title: describeRecord(item, projection), record: item }));
            root.insertAdjacentHTML('beforeend', presentation.overview(projection, lastBatch, nav.floor, recentRows, facts));
            if (channel === 'independent' && nav.floor == null) root.insertAdjacentHTML('beforeend', `<div class="rp-controls rp-run-controls">${button('extract', '处理最新正文')}${button('stop', '停止提取')}</div>${core.extractionJobs?.some(job => ['running', 'paused', 'failed'].includes(job.status)) ? '<p role="status">有未完成提取；可手动重试，不会自动重复计费。</p>' : ''}`);
            if (channel === 'inline' && !lastBatch && nav.floor == null) root.insertAdjacentHTML('beforeend', `<div class="rp-controls rp-run-controls">${button('capture', '检查最新正文')}</div>`);
            root.insertAdjacentHTML('beforeend', footer); return;
        }
        if (nav.tab === 'clock') {
            root.insertAdjacentHTML('beforeend', `<section class="rp-clock-detail">${presentation.scene(projection, lastBatch, nav.floor)}${nav.floor == null ? button('edit-clock', '修改时间') + button('edit-scene', '修改当前场景') : ''}${help('时间来自当前正文或摘要中的明确字段。时间跨度与回忆不会自动推进当前日期；约定到期不代表已经完成。')}${sectionHead('与时间有关的约定')}${presentation.rows(buildStatePage(core, view, { tab: 'world', filter: 'plans' }).rows, projection)}</section>${footer}`);
            return;
        }
        if (nav.tab === 'people') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ '': '全部', people: '人物', relationships: '关系' }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${nav.filter === key}"`)).join('')}</div>`);
        if (nav.tab === 'world') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ plans: '约定', items: '物品', locations: '地点' }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${(nav.filter || 'plans') === key}"`)).join('')}</div>`);
        if (nav.tab === 'history') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ '': '全部', ...trackLabels, ...(nav.floor == null ? { 'source-history': '旧回复' } : {}) }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${nav.filter === key}"`)).join('')}</div><details class="rp-snapshot"><summary>查看过去某一楼的状态</summary><label>楼层<input class="text_pole" type="number" min="0" data-rp-floor value="${nav.floor ?? ''}"></label>${button('snapshot', '查看快照')}</details>`);
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
        const core = state.rpCore, projection = view.projection, { kind, id } = nav.selected;
        const record = ['facts', 'claims', 'observations', 'candidate'].includes(kind);
        const item = (kind === 'candidate' ? core.candidates : core[kind] || projection[kind] || []).find(item => item.id === id);
        root.insertAdjacentHTML('beforeend', button('back', '‹ 返回'));
        if (!item) { root.insertAdjacentHTML('beforeend', '<p>记录已变化，请返回查看。</p>'); return; }
        let content;
        if (record) {
            const current = isCurrentRpRecord(view, item);
            content = `<h3 class="rp-detail-title" tabindex="-1">${esc(describeRecord(item, projection))}</h3>`;
            content += line('类型', trackLabels[item.track || kind]) + line('状态', !current ? '旧回复记录' : kind === 'candidate' ? '未采用' : '已记录');
            if (item.action === 'state_updated') content += describeStateValues(item.data, projection).map(value => `<p>${esc(value)}</p>`).join('');
            if (item.reason && kind === 'candidate') content += `<p role="status">${esc(item.reason)}</p>`;
            if (item.evidence?.excerpt) content += `<blockquote>${esc(item.evidence.excerpt)}</blockquote>`;
            if (item.origin?.kind === 'model') content += line('来源', '模型根据所属回复整理');
            if (item.origin?.kind === 'user') content += line('来源', '用户修改');
            if (item.evidence || item.origin?.kind === 'model') content += button('source', '定位正文');
            if (current && nav.floor == null && ['claims', 'observations'].includes(kind)) content += button('edit-open', '修改记录');
            if (current && nav.floor == null && kind === 'facts' && item.action === 'state_updated') {
                const target = item.data.collection;
                if (['clock', 'scene'].includes(target)) content += button('edit-' + target, '修改当前状态');
                else content += button('detail', '查看当前状态', `data-rp-kind="${esc(target)}" data-rp-id="${esc(item.data.id)}"`);
            }
        } else {
            content = presentation.entityDetail(kind, item, core, projection, nav.floor);
            if (nav.floor == null) content += button('edit-open', '修改记录');
        }
        root.insertAdjacentHTML('beforeend', `<section class="rp-detail">${content}</section>`);
    }
    async function action(element) {
        const state = getState(), nav = navigation.get(state), root = document.querySelector('#bakemono-rp-root');
        if (renderedStates.get(element.closest('#bakemono-rp-root, #bakemono-rp-review')) !== state) throw new Error('聊天已切换，请重新打开剧情状态');
        const name = element.dataset.rpAction;
        nav.notice = '';
        if (name.startsWith('prompt-') && promptLibrary) {
            editors.readPrompt(root, nav);
            if (name === 'prompt-load') nav.promptDraft = promptLibrary.load(nav.promptDraft.selectedId);
            else {
                const result = await promptLibrary.commit(name.slice(7), nav.promptDraft);
                if (getState() !== state) return;
                nav.promptDraft = promptLibrary.draft();
                nav.notice = result.status === 'confirmed' ? '提示词设置已保存。' : result.status === 'superseded' ? '已被更新的提示词设置替代。' : '提示词设置已应用，但未核验到酒馆保存；请稍后再保存一次。';
            }
            nav.promptOpen = true;
        }
        if (['edit-open', 'edit-clock', 'edit-scene'].includes(name)) {
            if (nav.floor != null) throw new Error('历史快照只读，请返回当前状态');
            const kind = name === 'edit-open' ? nav.selected?.kind : name.slice(5), id = nav.selected?.id;
            const projection = service.view(state).projection;
            const entity = ['clock', 'scene'].includes(kind) ? projection[kind] || {} : ['claims', 'observations'].includes(kind)
                ? state.rpCore[kind].find(item => item.id === id)?.data : projection[kind]?.find(item => item.id === id);
            if (!entity) throw new Error('记录已变化，请重新打开');
            nav.edit = editors.draft(kind, id, entity, state.rpCore.revision);
        }
        if (name === 'edit-cancel') nav.edit = null;
        if (name === 'edit-save') {
            if (!nav.edit || nav.floor != null) throw new Error('请重新打开编辑');
            editors.readEdit(root, nav.edit);
            const edit = nav.edit, values = editors.values(edit);
            if (Object.keys(values).length) {
                if (['claims', 'observations'].includes(edit.kind)) await service.editInformation(edit.kind, edit.id, values, { expectedRevision: edit.revision });
                else await service.editEntity(edit.kind, edit.id, values, { expectedRevision: edit.revision });
            }
            if (getState() !== state) return;
            if (['claims', 'observations'].includes(edit.kind)) nav.selected = { kind: edit.kind, id: state.rpCore[edit.kind].at(-1).id };
            nav.edit = null; nav.notice = '修改已保存。';
        }
        if (name === 'legacy') { navigate('tables'); return; }
        if (name === 'tab') Object.assign(nav, { tab: element.dataset.rpTab, page: 0, filter: '', selected: null, search: '', scroll: 0, settings: false, evidenceDraft: null, trail: [] });
        if (['people', 'relationships', 'plans', 'items', 'locations', 'clock', 'history', 'facts'].includes(name)) {
            if (nav.tab === 'overview' && !nav.selected) nav.overviewOrigin = { action: name, scroll: scrollSurface(root)?.scrollTop || 0 };
            Object.assign(nav, { tab: ['plans', 'items', 'locations'].includes(name) ? 'world' : name === 'facts' ? 'history' : name === 'relationships' ? 'people' : name, filter: ['relationships', 'plans', 'items', 'locations', 'facts'].includes(name) ? name : '', page: 0, selected: null, search: '', scroll: 0, trail: [] });
        }
        if (name === 'filter') Object.assign(nav, { filter: element.dataset.rpFilter, page: 0, search: '', scroll: 0 });
        if (name === 'search') Object.assign(nav, { search: root.querySelector('[data-rp-search]')?.value || '', page: 0, scroll: 0 });
        if (name === 'prev') nav.page = Math.max(0, nav.page - 1);
        if (name === 'next') nav.page++;
        if (name === 'detail' || name === 'review-open') {
            if (name === 'review-open') { nav.trail = []; nav.selected = null; nav.floor = null; nav.settings = false; }
            nav.trail ||= [];
            nav.trail.push({ selected: nav.selected, tab: nav.tab, filter: nav.filter, page: nav.page, search: nav.search, floor: nav.floor,
                scroll: scrollSurface(root)?.scrollTop || 0, origin: detailOrigin(element) });
            nav.edit = null;
            nav.selected = { kind: element.dataset.rpKind || 'candidate', id: element.dataset.rpId }; navigate('rp-state');
        }
        if (name === 'pending') { Object.assign(nav, { tab: 'history', filter: 'pending', selected: null, page: 0, floor: null, settings: false, trail: [] }); navigate('rp-state'); }
        if (name === 'back') {
            const previous = nav.trail?.pop();
            Object.assign(nav, previous || { selected: null, scroll: 0 });
            nav.edit = null;
        }
        if (name === 'settings') { nav.settings = !nav.settings; nav.settingsDraft = null; nav.promptDraft = null; nav.edit = null; }
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
            nav.notice = ({ processed: '本轮状态已处理。', unchanged: '本轮事件已处理过，没有新增内容。',
                delayed: '延迟一轮已开启，发送下一条消息后处理上一轮。', busy: '当前任务正在运行，请稍后再试。',
                inactive: '请先在维护设置中开启随正文维护。', missing: '本轮没有可读取的状态变化或明确摘要字段。', incomplete: '本轮状态输出被截断，原状态保留；可继续对话后补充。' })[result.status];
            if (result.protocolStatus === 'incomplete') nav.notice = '明确的摘要字段已处理；额外状态输出不完整，未应用残缺内容。';
        }
        if (name === 'source') {
            const item = (nav.selected.kind === 'candidate' ? state.rpCore.candidates : state.rpCore[nav.selected.kind]).find(value => value.id === nav.selected.id);
            locateSource?.(item.evidence || item.origin);
        }
        if (getState() !== state) return;
        nav.error = ''; render(state); renderReview(state); refresh?.();
        if (name.startsWith('edit-')) root.querySelector('.rp-edit-form h3, .rp-detail-title')?.focus({ preventScroll: true });
        if (['detail', 'review-open'].includes(name)) { scrollSurface(root).scrollTop = 0; root.querySelector('.rp-detail-title')?.focus({ preventScroll: true }); }
        if (name === 'back') {
            [...root.querySelectorAll('[data-rp-action="detail"]')].find(node => node.dataset.rpKind === nav.origin?.kind && node.dataset.rpId === nav.origin?.id)?.focus({ preventScroll: true });
            scrollSurface(root).scrollTop = nav.scroll || 0;
        }
        if (['tab', 'filter', 'prev', 'next', 'search', 'snapshot', 'current', 'people', 'relationships', 'plans', 'items', 'locations', 'clock', 'history', 'facts', 'pending'].includes(name)) {
            const selector = name === 'tab' ? `[data-rp-tab="${nav.tab}"]` : name === 'filter' ? `[data-rp-filter="${nav.filter}"]` : '[data-rp-search]';
            (root.querySelector(selector) || root.querySelector('.rp-breadcrumb h3, .rp-story-heading'))?.focus({ preventScroll: true });
            scrollSurface(root).scrollTop = 0;
            if (name === 'tab' && nav.tab === 'overview' && nav.overviewOrigin) {
                const origin = [...root.querySelectorAll('[data-rp-action]')].find(node => node.dataset.rpAction === nav.overviewOrigin.action);
                (origin || root.querySelector('.rp-story-heading'))?.focus({ preventScroll: true });
                scrollSurface(root).scrollTop = nav.overviewOrigin.scroll;
                nav.overviewOrigin = null;
            }
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
        if (captureEditorDraft(event)) return;
        if (event.target.matches?.('[data-rp-setting], [data-rp-mode]')) {
            const state = getState(), root = event.target.closest('#bakemono-rp-root');
            if (renderedStates.get(root) !== state) return;
            navigation.get(state).settingsDraft = { ...state.rpCore.settings,
                ...Object.fromEntries([...root.querySelectorAll('[data-rp-setting]')].map(input => [input.dataset.rpSetting, input.checked])),
                mode: root.querySelector('[data-rp-mode]:checked')?.value };
            const references = root.querySelector('.rp-reference-settings');
            if (references) references.hidden = navigation.get(state).settingsDraft.mode !== 'independent';
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
        if (event.key === 'Escape' && event.target.closest?.('#bakemono-rp-root') && navigation.get(getState()).edit) {
            const cancel = document.querySelector('[data-rp-action="edit-cancel"]');
            if (cancel) { event.preventDefault(); event.stopPropagation(); void click({ target: cancel, preventDefault() {} }); }
            return;
        }
        if (event.key !== 'Escape' || !event.target.closest?.('#bakemono-rp-root') || !navigation.get(getState()).selected) return;
        const back = document.querySelector('#bakemono-rp-root [data-rp-action="back"]');
        if (back) { event.preventDefault(); event.stopPropagation(); void click({ target: back, preventDefault() {} }); }
    };
    function captureEditorDraft(event) {
        const root = event.target.closest?.('#bakemono-rp-root'), state = getState();
        if (!root || renderedStates.get(root) !== state) return false;
        const nav = navigation.get(state);
        if (event.target.matches('[data-rp-edit-field]') && nav.edit) { editors.readEdit(root, nav.edit); return true; }
        if (event.target.matches('[data-rp-prompt-select], [data-rp-prompt-name], [data-rp-prompt-text]')) {
            editors.readPrompt(root, nav);
            for (const action of ['prompt-overwrite', 'prompt-delete']) {
                const button = root.querySelector('[data-rp-action="' + action + '"]');
                if (button) button.disabled = !nav.promptDraft.selectedId || nav.promptDraft.selectedId === 'default';
            }
            return true;
        }
        return false;
    }
    const input = event => { captureEditorDraft(event); };
    const submit = event => {
        if (!event.target.matches?.('#bakemono-rp-root .rp-search')) return;
        event.preventDefault();
        const element = event.target.querySelector('[data-rp-action="search"]');
        if (element) void click({ target: element, preventDefault() {} });
    };
    function getPendingCount() { return 0; }
    return { render, renderReview, getPendingCount, bind, navigation };
}
