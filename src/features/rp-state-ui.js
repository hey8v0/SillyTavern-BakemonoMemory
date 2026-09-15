import { buildStatePage, createStateNavigation, describeRecord, entityName, relationshipName, stateLabels, trackLabels } from '../rp-core/state-view.js';
import { buildBaselinePreview, suggestBaselineMappings, migrationFields, migrationLabels } from '../rp-core/migration.js';

export function createRpStateUi({ documentRef: document, getState, service, flow, navigate, refresh, escapeHtml: esc, locateSource }) {
    const navigation = createStateNavigation(), previews = new WeakMap(), repairs = new WeakMap(), renderedStates = new WeakMap();
    let busy = false;
    const tabs = { overview: '概览', people: '人物关系', world: '世界状态', history: '历史' };
    const button = (action, label, extra = '') => `<button type="button" class="menu_button${['save-settings', 'review-confirm', 'repair-confirm', 'enable-confirm', 'migration-confirm'].includes(action) ? ' rp-primary' : ''}" data-rp-action="${action}" ${extra}><span>${esc(label)}</span></button>`;
    const help = text => `<button type="button" class="bakemono-memory-help-trigger" aria-label="使用说明" aria-expanded="false"><i class="fa-solid fa-circle-info"></i><span class="bakemono-memory-help-content">${esc(text)}</span></button>`;
    const names = (view, values) => (values || []).map(id => entityName(view, id)).join('、');
    const line = (label, value) => `<p><span>${esc(label)}</span>：${esc(value ?? '未知')}</p>`;
    const sectionHead = (title, action = '', extra = '') => `<div class="rp-section-head"><h3>${esc(title)}</h3>${action ? button(action, '查看全部', extra) : ''}</div>`;
    function rowsMarkup(rows) {
        const marks = { people: '人', relationships: '缘', plans: '约', items: '物', locations: '地', facts: '记', claims: '言', observations: '察', candidate: '?' };
        return `<div class="rp-list rp-sheet">${rows.length ? rows.map(row => `<button type="button" class="rp-row" data-rp-action="detail" data-rp-kind="${row.kind}" data-rp-id="${esc(row.id)}"><span class="rp-seal" aria-hidden="true">${marks[row.kind] || '记'}</span><span class="rp-row-copy"><strong>${esc(row.title)}</strong><small>${esc([row.status, row.detail].filter(Boolean).join(' · '))}</small></span><span class="rp-chevron" aria-hidden="true">›</span></button>`).join('') : '<p class="rp-empty">暂无记录</p>'}</div>`;
    }
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
        const more = `<details class="rp-more"><summary>更多</summary>${button('legacy', '原表格编辑器')}</details>`;
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
        root.innerHTML = navMarkup;
        if (nav.error) root.insertAdjacentHTML('beforeend', `<p role="alert">${esc(nav.error)}</p>`);
        if (nav.settings) { renderSettings(root, state, nav); return; }
        if (!view?.projection) { root.insertAdjacentHTML('beforeend', `<p>所选楼层早于基线，没有可用状态。</p>${button('current', '返回当前状态')}`); return; }
        const projection = view.projection;
        if (nav.selected) { renderDetail(root, state, view, nav); return; }
        const pending = core.candidates.filter(item => item.status === 'pending').length;
        const channel = flow.channel(state), lastBatch = core.batches.at(-1);
        const maintenance = !core.settings.enabled ? '自动维护已暂停' : !channel ? '尚未运行：回复后处理未开启' : channel === 'inline' ? '随正文维护' : channel === 'reply' ? '复用回复后处理' : '独立提取';
        root.insertAdjacentHTML('beforeend', `<div class="rp-toolbar"><small>${esc(maintenance)}${lastBatch ? ` · 已处理到 ${lastBatch.floor} 楼` : ' · 尚未处理正文'}</small><div class="rp-controls">${button('settings', '维护设置')}${help('新内容明确、来源可靠且无冲突时自动保存，只有例外需要审核。处理完成不等于全部确认；缺少证据的项不会改变当前状态。')}</div></div>`);
        if (pending) root.insertAdjacentHTML('beforeend', `<div class="rp-notice"><span aria-hidden="true">?</span><div><strong>${pending} 项需要处理</strong><small>已保存内容不受待确认项影响</small></div>${button('pending', '查看')}</div>`);
        if (view.pending.length) root.insertAdjacentHTML('beforeend', `<div class="rp-notice rp-error"><div><strong>${view.pending.length} 项事实需要复核</strong><small>这些记录暂不参与当前状态</small></div>${button('facts', '查看')}</div>`);
        if (nav.tab === 'overview') {
            const positions = projection.people.filter(person => person.location).slice(0, 4).map(person => `${person.name} · ${entityName(projection, person.location)}`);
            root.insertAdjacentHTML('beforeend', `<section class="rp-overview rp-sheet"><span class="rp-eyebrow">此刻 · 当前故事</span><h3>${esc(projection.clock.date || projection.clock.description || '剧情时间未知')}</h3><p>${esc(positions.join('；') || '人物位置尚未记录')}</p><div class="rp-scene-foot">${projection.people.length} 位人物 · ${projection.relationships.length} 段关系</div></section>`);
            const overview = buildStatePage(core, view, { tab: 'overview' }).rows;
            root.insertAdjacentHTML('beforeend', sectionHead('人物关系', 'people') + rowsMarkup(overview.filter(row => row.kind === 'relationships'))
                + sectionHead('接下来的约定', 'plans') + rowsMarkup(overview.filter(row => row.kind === 'plans'))
                + sectionHead('最近变化', 'history') + rowsMarkup(buildStatePage(core, view, { tab: 'history', filter: 'facts' }).rows.slice(0, 3)));
            if (channel === 'independent') root.insertAdjacentHTML('beforeend', `<div class="rp-controls rp-run-controls">${button('extract', '处理最新正文')}${button('stop', '停止提取')}</div>${core.extractionJobs?.some(job => ['running', 'paused', 'failed'].includes(job.status)) ? '<p role="status">有未完成提取；可手动重试，不会自动重复计费。</p>' : ''}`);
            if (channel === 'inline' && !lastBatch) root.insertAdjacentHTML('beforeend', `<p class="rp-empty">等待下一轮正文中的事件块。${button('capture', '检查最新正文')}</p>`);
            root.insertAdjacentHTML('beforeend', more); return;
        }
        if (nav.tab === 'world') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ plans: '约定', items: '物品', locations: '地点' }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${(nav.filter || 'plans') === key}"`)).join('')}</div>`);
        if (nav.tab === 'history') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ '': '全部', ...trackLabels }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${nav.filter === key}"`)).join('')}</div><details class="rp-snapshot"><summary>查看过去某一楼的状态</summary><label>楼层<input class="text_pole" type="number" min="0" data-rp-floor value="${nav.floor ?? ''}"></label>${button('snapshot', '查看快照')}</details>${nav.floor == null ? '' : button('current', '返回当前状态')}`);
        if (nav.floor != null) root.insertAdjacentHTML('beforeend', `<p role="status">第 ${nav.floor} 楼时已知状态 · 只读</p>`);
        if (nav.tab !== 'overview') root.insertAdjacentHTML('beforeend', `<form class="rp-search"><label>搜索<input class="text_pole" data-rp-search type="search" value="${esc(nav.search)}"></label>${button('search', '查找')}</form>`);
        const page = buildStatePage(core, view, nav);
        nav.page = page.page;
        root.insertAdjacentHTML('beforeend', rowsMarkup(page.rows));
        if (page.pages > 1) root.insertAdjacentHTML('beforeend', `<div class="rp-pager">${button('prev', '上一页', page.page ? '' : 'disabled')}<span>${page.page + 1} / ${page.pages}</span>${button('next', '下一页', page.page === page.pages - 1 ? 'disabled' : '')}</div>`);
        root.scrollTop = nav.scroll || 0;
        root.insertAdjacentHTML('beforeend', more);
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
        if (nav.floor != null) root.insertAdjacentHTML('beforeend', `<p role="status">第 ${nav.floor} 楼时已知状态 · 只读</p>`);
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
        root.insertAdjacentHTML('beforeend', `<section class="rp-detail rp-sheet">${content}</section>`);
    }
    async function action(element) {
        const state = getState(), nav = navigation.get(state), root = document.querySelector('#bakemono-rp-root');
        if (renderedStates.get(element.closest('#bakemono-rp-root, #bakemono-rp-review')) !== state) throw new Error('聊天已切换，请重新打开剧情状态');
        const name = element.dataset.rpAction;
        if (name === 'legacy') { navigate('tables'); return; }
        if (name === 'tab') Object.assign(nav, { tab: element.dataset.rpTab, page: 0, filter: '', selected: null, search: '', scroll: 0, settings: false, evidenceDraft: null, floor: null });
        if (['people', 'plans', 'history', 'facts'].includes(name)) Object.assign(nav, { tab: name === 'plans' ? 'world' : name === 'facts' ? 'history' : name, filter: name === 'plans' ? 'plans' : name === 'facts' ? 'facts' : '', page: 0, selected: null, search: '', floor: null });
        if (name === 'filter') Object.assign(nav, { filter: element.dataset.rpFilter, page: 0, search: '', scroll: 0 });
        if (name === 'search') Object.assign(nav, { search: root.querySelector('[data-rp-search]')?.value || '', page: 0, scroll: 0 });
        if (name === 'prev') nav.page = Math.max(0, nav.page - 1);
        if (name === 'next') nav.page++;
        if (name === 'detail' || name === 'review-open') { nav.scroll = root?.scrollTop || 0; nav.evidenceDraft = null; repairs.delete(state); previews.delete(state); nav.selected = { kind: element.dataset.rpKind || 'candidate', id: element.dataset.rpId }; if (name === 'review-open') { nav.floor = null; nav.settings = false; } navigate('rp-state'); }
        if (name === 'pending') { Object.assign(nav, { tab: 'history', filter: 'pending', selected: null, page: 0, floor: null, settings: false }); navigate('rp-state'); }
        if (name === 'back') { nav.selected = null; nav.evidenceDraft = null; previews.delete(state); repairs.delete(state); }
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
            Object.assign(nav, { floor: Number(value), page: 0 });
        }
        if (name === 'current') nav.floor = null;
        if (name === 'extract') await flow.runIndependent({ manual: true });
        if (name === 'capture' && !await flow.captureInline()) throw new Error('本轮尚无可处理事件块，或延迟模式正在等待下一轮。普通 bakemono 摘要不会直接变成事实。');
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
    }
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
