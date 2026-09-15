import { buildStatePage, createStateNavigation, describeRecord, relationshipName, stateLabels, trackLabels, isCurrentRpRecord } from '../rp-core/state-view.js';
import { buildBaselinePreview, suggestBaselineMappings, migrationFields, migrationLabels } from '../rp-core/migration.js';
import { createRpStatePresentation } from './rp-state-presentation.js';

export function createRpStateUi({ documentRef: document, getState, service, flow, navigate, refresh, escapeHtml: esc, locateSource }) {
    const navigation = createStateNavigation(), previews = new WeakMap(), repairs = new WeakMap(), referencePreviews = new WeakMap(), renderedStates = new WeakMap();
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
        const referenceSettings = `<details class="rp-reference-settings" ${selected === 'independent' ? '' : 'hidden'}><summary>独立提取的参考范围</summary>${[['includeCharacterContext', '角色卡与用户人设', settings.includeCharacterContext !== false], ['includeWorldInfo', '命中的世界书条目', settings.includeWorldInfo === true]].map(([key, label, checked]) => `<label class="rp-choice"><input type="checkbox" data-rp-setting="${key}" ${checked ? 'checked' : ''}><span>${label}</span></label>`).join('')}${help('默认提供本轮正文、摘要、近期对话和当前状态。角色卡最多 6000 字，世界书命中参考最多 6000 字；不会发送整本世界书。参考内容不作为本轮新事件的证据。')}</details>`;
        root.insertAdjacentHTML('beforeend', `${button('settings', '‹ 返回')}<section class="rp-settings"><div class="rp-detail-head"><span class="rp-eyebrow">维护方式</span><h3>按你的聊天习惯来</h3></div><div class="rp-sheet">${Object.entries(modes).map(([value, [title, description]]) => `<label class="rp-choice"><input type="radio" name="rp-maintenance-mode" data-rp-mode value="${value}" ${selected === value ? 'checked' : ''}><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span></label>`).join('')}</div>${referenceSettings}${['enabled', 'autoApply', 'inject'].map((key, i) => `<label class="rp-choice"><input type="checkbox" data-rp-setting="${key}" ${settings[key] ? 'checked' : ''}><span>${['自动维护剧情状态', '自动保存明确的状态变化', '注入当前状态'][i]}</span></label>`).join('')}<div class="rp-controls">${button('save-settings', '保存设置')}${help('随正文模式不需要开启回复后处理。模型需在原 bakemono 块外输出 rpEvents；摘要中的明确时间、当前地点和在场角色可直接读取；自由文本由模型整理。旧正文可主动选择独立提取。关闭自动维护或注入不删除账本。再次提取旧楼层不会静默改写已确认事实。')}</div></section>`);
    }

    function renderReview(state = getState()) {
        const root = document.querySelector('#bakemono-rp-review');
        if (!root) return;
        renderedStates.set(root, state);
        let candidates = state.rpCore?.candidates?.filter(item => item.status === 'pending') || [];
        root.hidden = !candidates.length;
        if (!candidates.length) { root.innerHTML = ''; return; }
        let projection;
        try { const view = service.view(state); projection = view?.projection; candidates = candidates.filter(item => isCurrentRpRecord(view, item)); }
        catch {
            root.hidden = false;
            root.innerHTML = '<p role="alert">剧情账本暂不可审核，请在剧情状态中查看错误。已有摘要不受此审核入口影响。</p>';
            return;
        }
        root.hidden = !candidates.length;
        if (!candidates.length) { root.innerHTML = ''; return; }
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
        if (!view?.projection) { root.insertAdjacentHTML('beforeend', `<p>所选楼层早于基线，没有可用状态。</p>${button('current', '返回当前状态')}`); return; }
        const projection = view.projection;
        if (nav.selected) { renderDetail(root, state, view, nav); return; }
        const pending = core.candidates.filter(item => item.status === 'pending' && isCurrentRpRecord(view, item)).length;
        const channel = flow.channel(state), lastBatch = core.batches.at(-1);
        const maintenance = !core.settings.enabled ? '自动维护已暂停' : !channel ? '尚未运行：回复后处理未开启' : channel === 'inline' ? '随正文维护' : channel === 'reply' ? '复用回复后处理' : '独立提取';
        const footer = `<footer class="rp-footer"><small>${nav.floor == null ? esc(maintenance) + (lastBatch ? ` · ${lastBatch.protocolStatus === 'missing' ? '摘要状态已读取' : '已处理到'} ${lastBatch.floor} 楼` : ' · 尚未处理正文') : '历史快照 · 只读'}</small><div class="rp-controls">${nav.floor == null ? button('settings', '维护设置') : ''}${help('明确的新内容经过校验后自动保存，例外进入待确认。摘要中的明确时间、当前地点和在场人物可直接读取；其他变化由模型输出事件。不必开启回复后处理。说法、观察与事实分别保存；关闭维护不删除记录。')}</div></footer>`;
        if (pending && nav.floor == null) root.insertAdjacentHTML('beforeend', `<div class="rp-attention"><small>${pending} 项暂未采用 · 其他更新照常保存</small>${button('pending', '查看疑问')}</div>`);
        if (lastBatch?.protocolStatus === 'incomplete' && nav.floor == null) root.insertAdjacentHTML('beforeend', '<p class="rp-status-warning" role="status">本轮事件块未完整输出；可读取的摘要状态已保留。</p>');
        const invalidFacts = view.pending.filter(item => isCurrentRpRecord(view, { id: item.factId }));
        if (invalidFacts.length) root.insertAdjacentHTML('beforeend', `<div class="rp-notice rp-error"><div><strong>${invalidFacts.length} 项事实需要复核</strong><small>这些记录暂不参与当前状态</small></div>${button('facts', '查看')}</div>`);
        if (nav.tab === 'overview') {
            if (!hasData) {
                root.insertAdjacentHTML('beforeend', `<section class="rp-blank"><span class="rp-blank-mark"><i class="fa-solid fa-film" aria-hidden="true"></i></span><h3>${nav.floor != null ? '当时尚无状态记录' : core.settings.enabled ? '等故事写下下一页' : '自动维护已暂停'}</h3><p>${!channel && core.settings.enabled ? '尚未运行：请在维护设置中选择可用的方式。' : '人物、关系与约定，会随着确认的剧情进展出现在这里。'}</p><div class="rp-controls">${nav.floor != null ? '' : channel === 'inline' ? button('capture', '检查最新正文') : channel === 'independent' ? button('extract', '处理最新正文') + button('stop', '停止提取') : ''}</div></section>${footer}`);
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
            root.insertAdjacentHTML('beforeend', `<section class="rp-clock-detail">${presentation.scene(projection, lastBatch, nav.floor)}${help('时间来自当前正文或摘要中的明确字段。时间跨度与回忆不会自动推进当前日期；约定到期不代表已经完成。')}${sectionHead('与时间有关的约定')}${presentation.rows(buildStatePage(core, view, { tab: 'world', filter: 'plans' }).rows, projection)}</section>${footer}`);
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
        const core = state.rpCore, { kind, id } = nav.selected, projection = view.projection;
        const collection = kind === 'candidate' ? core.candidates : core[kind] || projection[kind] || [];
        const item = collection.find(value => value.id === id && (nav.floor == null || !['facts', 'claims', 'observations', 'candidate'].includes(kind) || value.floor <= nav.floor));
        root.insertAdjacentHTML('beforeend', button('back', '返回列表'));
        if (!item) { root.insertAdjacentHTML('beforeend', '<p>记录不在当前视图中。</p>'); return; }
        const record = ['facts', 'claims', 'observations', 'candidate'].includes(kind);
        const title = record ? describeRecord(item, projection) : kind === 'relationships' ? relationshipName(projection, item) : item.name || item.title;
        let content = `<h3 tabindex="-1" class="rp-detail-title">${esc(title)}</h3>`;
        if (record) {
            if (!isCurrentRpRecord(view, item)) {
                content += `<p role="status">这条记录来自旧回复或修改前的正文，不参与当前状态与待确认。</p><blockquote>${esc(item.evidence?.excerpt || item.excerpt || '')}</blockquote>`;
                root.insertAdjacentHTML('beforeend', `<section class="rp-detail">${content}</section>`);
                return;
            }
            content += line('类型', trackLabels[item.track || kind]) + line('状态', stateLabels[item.status] || (view.applied.includes(id) ? '有效' : kind === 'facts' ? '待复核' : '已记录'));
            if (item.reason) content += `<p role="status">${esc(item.reason)}</p>`;
            content += `<blockquote>${esc(item.evidence?.excerpt || item.excerpt || '没有证据摘录')}</blockquote>`;
            if (item.evidence) content += line('来源', item.evidence.sourceKind === 'summary' ? '本楼已识别摘要' : '本楼正文') + button('source', '定位正文');
            if (kind === 'candidate' && item.status === 'pending' && nav.floor == null) {
                const members = item.atomicGroup ? core.candidates.filter(candidate => candidate.atomicGroup === item.atomicGroup) : [item];
                if (members.length > 1) content += `<section><h4>一起处理的 ${members.length} 项</h4><ul>${members.map(member => `<li>${esc(describeRecord(member, projection))} · ${esc(stateLabels[member.status] || member.status)}<blockquote>${esc(member.evidence?.excerpt || member.excerpt || '没有证据摘录')}</blockquote>${member.reason ? `<p>${esc(member.reason)}</p>` : ''}</li>`).join('')}</ul></section>`;
                if (!item.evidence || item.evidenceStatus !== 'located') content += `<div class="rp-notice rp-error"><div><strong>暂未写入：来源需要校正</strong><small>可从下方选择原句；其余状态更新不受影响。</small></div></div>`;
                if (!item.evidence && service.evidenceSuggestion?.(id)) content += `<div class="rp-controls">${button('repair-suggest', '预览完整原句')}</div>`;
                const choices = !item.evidence ? service.evidenceChoices?.(id) || [] : [];
                if (choices.length) content += `<label class="rp-source-choice">选择本楼原句<select class="text_pole" data-rp-source-choice><option value="">请选择与这条记录对应的原句</option>${choices.map(text => `<option value="${esc(text)}">${esc(text)}</option>`).join('')}</select></label>${button('adopt-source', '采用所选原句并保存')}`;
                if (item.evidence && !item.previousIds.length && !service.referenceIssues?.(id, state)?.length && !item.blockedReason) content += `<div class="rp-controls">${button('adopt', '采用这条')}</div>`;
                content += `<details class="rp-evidence-editor"><summary>校正原文摘录</summary><label>原文摘录<textarea class="text_pole" data-rp-excerpt rows="4" maxlength="6000">${esc(nav.evidenceDraft ?? item.excerpt ?? '')}</textarea></label>${button('repair-preview', '检查定位')}`;
                const repair = repairs.get(state);
                if (repair?.candidateId === id) content += `<section class="rp-preview"><h4>已定位到第 ${repair.floor} 楼</h4><blockquote>${esc(repair.excerpt)}</blockquote><p>只校正来源，不直接确认事件。</p>${button('repair-confirm', '确认校正来源')}</section>`;
                content += `</details><div class="rp-controls">${button('review-preview', '预览确认', item.evidence ? '' : 'disabled')}${button('ignore', '暂不记录')}</div>`;
                content += renderReferences(state, item, projection, nav);
                const preview = previews.get(state);
                if (preview?.candidateId === id) content += `<section class="rp-preview"><h4>确认后的影响</h4>${esc(preview.description)}${button('review-confirm', '确认入账')}${button('preview-cancel', '取消')}</section>`;
            }
        } else content = presentation.entityDetail(kind, item, core, projection, nav.floor);
        root.insertAdjacentHTML('beforeend', `<section class="rp-detail${record ? ' rp-review-detail' : ''}">${content}</section>`);
    }
    function readReferenceUpdates(root) {
        return [...root.querySelectorAll('[data-rp-reference]')].map(row => {
            const choice = row.querySelector('[data-rp-ref-choice]')?.value || '';
            return { field: row.dataset.rpReference, id: choice === '__new' ? '' : choice,
                ...(choice === '__new' ? { name: row.querySelector('[data-rp-ref-name]')?.value || '', excerpt: row.querySelector('[data-rp-ref-excerpt]')?.value || '', holder: row.querySelector('[data-rp-ref-holder]')?.value || '' } : {}) };
        });
    }
    function renderReferences(state, item, projection, nav) {
        const refs = service.referenceIssues?.(item.id, state) || [];
        if (!refs.length) return '';
        const drafts = nav.referenceDraft?.candidateId === item.id ? nav.referenceDraft.updates : [];
        const options = (values, chosen) => values.map(value => `<option value="${esc(value.id)}" ${value.id === chosen ? 'selected' : ''}>${esc(value.name || value.title || relationshipName(projection, value))}</option>`).join('');
        let html = `<details class="rp-reference-editor" open><summary>校正对象 · ${refs.length} 项</summary>${help('选择已登记对象，或用原文证据补充登记人物、地点、已有物品。这里只处理本条及其关联组，不会批量合并同名角色。物品所有权、数量不明确就保持未知；初始持有者也必须由所填摘录支持。')}`;
        for (const ref of refs) {
            const draft = drafts.find(value => value.field === ref.field), create = draft && !draft.id && draft.name !== undefined;
            const canCreate = ['people', 'locations', 'items'].includes(ref.collection);
            html += `<section data-rp-reference="${esc(ref.field)}"><label>${esc(ref.label)}<small>模型引用：${esc(ref.value)}</small><select class="text_pole" data-rp-ref-choice><option value="">选择已登记对象</option>${options(projection[ref.collection], draft?.id)}${canCreate ? `<option value="__new" ${create ? 'selected' : ''}>补充登记新对象</option>` : ''}</select></label>`;
            if (canCreate) html += `<div data-rp-ref-new ${create ? '' : 'hidden'}><label>名称<input class="text_pole" data-rp-ref-name maxlength="200" value="${esc(draft?.name || '')}"></label><label>登记依据 · 连续原文<textarea class="text_pole" data-rp-ref-excerpt rows="3" maxlength="6000">${esc(draft?.excerpt || '')}</textarea></label>${ref.collection === 'items' ? `<label>此前持有者<select class="text_pole" data-rp-ref-holder><option value="">尚不明确</option>${options(projection.people, draft?.holder)}${refs.filter(value => value.collection === 'people').map(value => `<option value="@${esc(value.field)}" ${draft?.holder === '@' + value.field ? 'selected' : ''}>本次校正的${esc(value.label)}</option>`).join('')}</select></label>` : ''}</div>`;
            html += '</section>';
        }
        html += button('references-preview', '预览对象校正');
        const preview = referencePreviews.get(state);
        if (preview?.candidateId === item.id) html += `<section class="rp-preview"><h4>校正并入账</h4>${preview.descriptions.map(value => `<p>${esc(value.label)}：${esc(value.name)}</p>${value.excerpt ? `<blockquote>${esc(value.excerpt)}</blockquote>` : ''}`).join('')}<p>有效事实 ${preview.before.applied.length} → ${preview.after.applied.length}</p>${button('references-confirm', '确认校正并入账')}</section>`;
        return html + '</details>';
    }
    async function action(element) {
        const state = getState(), nav = navigation.get(state), root = document.querySelector('#bakemono-rp-root');
        if (renderedStates.get(element.closest('#bakemono-rp-root, #bakemono-rp-review')) !== state) throw new Error('聊天已切换，请重新打开剧情状态');
        const name = element.dataset.rpAction;
        nav.notice = '';
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
            nav.notice = ({ processed: '本轮状态已处理。', unchanged: '本轮事件已处理过，没有新增内容。',
                delayed: '延迟一轮已开启，发送下一条消息后处理上一轮。', busy: '当前任务正在运行，请稍后再试。',
                inactive: '请先在维护设置中开启随正文维护。', missing: '本轮没有可读取的状态变化或明确摘要字段。', incomplete: '本轮状态输出被截断，原状态保留；可继续对话后补充。' })[result.status];
            if (result.protocolStatus === 'incomplete') nav.notice = '明确的摘要字段已处理；额外状态输出不完整，未应用残缺内容。';
        }
        if (name === 'repair-preview') {
            nav.evidenceDraft = root.querySelector('[data-rp-excerpt]')?.value || '';
            previews.delete(state); repairs.delete(state);
            repairs.set(state, { ...service.previewEvidenceRepair(nav.selected.id, nav.evidenceDraft), candidateId: nav.selected.id });
        }
        if (name === 'repair-suggest') {
            const suggestion = service.evidenceSuggestion(nav.selected.id);
            if (!suggestion) throw new Error('没有可唯一定位的完整原句，请手动校正');
            nav.evidenceDraft = suggestion.excerpt;
            previews.delete(state);
            repairs.set(state, { ...service.previewEvidenceRepair(nav.selected.id, suggestion.excerpt), candidateId: nav.selected.id });
        }
        if (name === 'references-preview') {
            const updates = readReferenceUpdates(root);
            nav.referenceDraft = { candidateId: nav.selected.id, updates };
            referencePreviews.delete(state); previews.delete(state);
            referencePreviews.set(state, { ...service.previewReferenceRepair(nav.selected.id, updates), candidateId: nav.selected.id, input: JSON.stringify(updates) });
        }
        if (name === 'references-confirm') {
            const preview = referencePreviews.get(state);
            if (!preview || preview.candidateId !== nav.selected.id || preview.input !== JSON.stringify(readReferenceUpdates(root))) throw new Error('对象选择已变化，请重新预览');
            await preview.commit(); referencePreviews.delete(state); previews.delete(state);
            nav.referenceDraft = null; nav.selected = null; nav.trail = []; nav.notice = '校正与记录已保存。';
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
        if (name === 'adopt' || name === 'adopt-source') {
            if (name === 'adopt') await service.review(nav.selected.id, 'accept');
            else await service.previewEvidenceRepair(nav.selected.id, root.querySelector('[data-rp-source-choice]')?.value || '', { accept: true }).commit();
            nav.selected = null; nav.trail = []; nav.notice = '记录已保存。';
        }
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
        if (event.target.closest?.('[data-rp-reference]')) { updateReferenceDraft(event); return; }
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
        if (event.key !== 'Escape' || !event.target.closest?.('#bakemono-rp-root') || !navigation.get(getState()).selected) return;
        const back = document.querySelector('#bakemono-rp-root [data-rp-action="back"]');
        if (back) { event.preventDefault(); event.stopPropagation(); void click({ target: back, preventDefault() {} }); }
    };
    const input = event => {
        if (event.target.closest?.('[data-rp-reference]')) { updateReferenceDraft(event); return; }
        if (!event.target.matches?.('[data-rp-excerpt]') || renderedStates.get(event.target.closest('#bakemono-rp-root')) !== getState()) return;
        const state = getState();
        navigation.get(state).evidenceDraft = event.target.value;
        repairs.delete(state);
        event.target.closest('.rp-evidence-editor')?.querySelector('.rp-preview')?.remove();
    };
    function updateReferenceDraft(event) {
        const root = event.target.closest('#bakemono-rp-root'), state = getState();
        if (!root || renderedStates.get(root) !== state) return;
        const nav = navigation.get(state);
        nav.referenceDraft = { candidateId: nav.selected?.id, updates: readReferenceUpdates(root) };
        referencePreviews.delete(state);
        root.querySelector('.rp-reference-editor .rp-preview')?.remove();
        if (event.target.matches('[data-rp-ref-choice]')) {
            const area = event.target.closest('[data-rp-reference]').querySelector('[data-rp-ref-new]');
            if (area) area.hidden = event.target.value !== '__new';
        }
    }
    const submit = event => {
        if (!event.target.matches?.('#bakemono-rp-root .rp-search')) return;
        event.preventDefault();
        const element = event.target.querySelector('[data-rp-action="search"]');
        if (element) void click({ target: element, preventDefault() {} });
    };
    function getPendingCount(state = getState()) {
        try {
            const view = service.view(state);
            return state.rpCore?.candidates?.filter(item => item.status === 'pending' && isCurrentRpRecord(view, item)).length || 0;
        } catch { return 0; }
    }
    return { render, renderReview, getPendingCount, bind, navigation };
}
