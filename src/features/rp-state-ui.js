import { buildStatePage, createStateNavigation, describeRecord, describeStateValues, relationshipName, stateLabels, trackLabels, isCurrentRpRecord } from '../rp-core/state-view.js';
import { currentInformation, informationName } from '../rp-core/current-information.js';
import { createRpStateEditors } from './rp-state-editors.js';
import { createRpStatePresentation } from './rp-state-presentation.js';

export function createRpStateUi({ documentRef: document, getState, service, flow, navigate, refresh, escapeHtml: esc, locateSource, promptLibrary, confirm = message => globalThis.confirm(message), download = null, chooseFile = null, getContextPreview = null }) {
    const navigation = createStateNavigation(), renderedStates = new WeakMap();
    const presentation = createRpStatePresentation({ escapeHtml: esc });
    let busy = false;
    const tabs = { directory: '全部记录', preview: '状态注入', overview: '概览', people: '人物关系', world: '世界状态', history: '历史' };
    const button = (action, label, extra = '') => `<button type="button" class="menu_button${['save-settings', 'edit-save', 'prompt-apply', 'enable-preview', 'enable-confirm'].includes(action) ? ' rp-primary' : ''}" data-rp-action="${action}" ${extra}><span>${esc(label)}</span></button>`;
    const help = text => `<button type="button" class="bakemono-memory-help-trigger" aria-label="使用说明" aria-expanded="false"><i class="fa-solid fa-circle-info"></i><span class="bakemono-memory-help-content">${esc(text)}</span></button>`;
    const editors = createRpStateEditors({ escapeHtml: esc, button, help });
    const line = (label, value) => `<p><span>${esc(label)}</span>：${esc(value ?? '未知')}</p>`;
    const sectionHead = (title, action = '', extra = '') => `<div class="rp-section-head"><h3>${esc(title)}</h3>${action ? button(action, '查看全部', extra) : ''}</div>`;
    const scrollSurface = root => root?.closest('.bakemono-workbench-main') || root;
    const detailOrigin = element => ({ kind: element.dataset.rpKind, id: element.dataset.rpId });
    function renderSettings(root, state, nav) {
        const core = state.rpCore;
        const settings = nav.settingsDraft || core.settings;
        const selected = settings.mode === 'independent' ? 'independent' : 'inline';
        const modes = { inline: ['随正文维护', '保留预设摘要，同一轮额外输出事件块；不另发请求。'], independent: ['独立提取', '回复后额外调用一次默认生成模型，产生额外 API 用量。'] };
        const referenceSettings = `<details class="rp-reference-settings" ${selected === 'independent' ? '' : 'hidden'}><summary>独立提取的参考范围</summary>${[['includeCharacterContext', '角色卡与用户人设', settings.includeCharacterContext !== false], ['includeWorldInfo', '命中的世界书条目', settings.includeWorldInfo === true]].map(([key, label, checked]) => `<label class="rp-choice"><input type="checkbox" data-rp-setting="${key}" ${checked ? 'checked' : ''}><span>${label}</span></label>`).join('')}${help('默认提供本轮正文、近期对话和当前状态。角色卡最多 6000 字，世界书命中参考最多 6000 字；不会发送整本世界书。参考内容不作为本轮新事件的证据。')}</details>`;
        root.insertAdjacentHTML('beforeend', `${button('settings', '‹ 返回')}<section class="rp-settings"><div class="rp-detail-head"><span class="rp-eyebrow">维护方式</span><h3>按你的聊天习惯来</h3></div><div class="rp-sheet">${Object.entries(modes).map(([value, [title, description]]) => `<label class="rp-choice"><input type="radio" name="rp-maintenance-mode" data-rp-mode value="${value}" ${selected === value ? 'checked' : ''}><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span></label>`).join('')}</div>${referenceSettings}${settings.modeNeedsChoice ? '<p role="status">旧维护方式已暂停，请选择随正文或独立提取后保存。</p>' : ''}${['enabled', 'automatic', 'inject'].map((key, i) => `<label class="rp-choice"><input type="checkbox" data-rp-setting="${key}" ${settings[key] ? 'checked' : ''}><span>${['启用剧情状态', '自动维护', '注入当前状态'][i]}</span></label>`).join('')}<div class="rp-controls">${button('save-settings', '保存设置')}${help('随正文模式不需要开启回复后处理。模型需在原 bakemono 块外输出 rpEvents；只读取正文，摘要不作为状态来源。旧正文可主动选择独立提取。关闭自动维护或注入不删除账本。模型自动收录，用户可在详情中修改。')}</div>${renderPolicySettings(settings)}${renderContextPreview(state)}${editors.renderPrompt(promptLibrary, nav)}<details class="rp-reference-settings"><summary>备份与恢复</summary><div class="rp-controls">${button("backup", "导出状态备份")}${button("restore", "导入状态备份")}${button("clear-preview", "清空剧情状态")}</div>${help("只操作当前聊天的剧情状态。恢复前下载原状态备份，恢复后自动维护暂停。摘要、表格和正文保持不变。")}</details></section>`);
    }

    async function downloadBackup(payload) {
        if (download) return download(payload);
        const api = document.defaultView?.URL || globalThis.URL;
        const url = api.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'rp-state-backup.json';
        document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => api.revokeObjectURL(url), 1000);
    }
    function chooseBackup() {
        if (chooseFile) return chooseFile();
        return new Promise(resolve => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
            input.addEventListener('change', () => { resolve(input.files?.[0]); input.remove(); }, { once: true });
            input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true }); input.click(); });
    }
    function renderPolicySettings(settings) {
        return '<details class="rp-reference-settings"><summary>时机与正文范围</summary><label class="rp-edit-field">处理时机<select class="text_pole" data-rp-setting="triggerTiming"><option value="immediate"' + (settings.triggerTiming !== 'next_user' ? ' selected' : '') + '>本轮结束</option><option value="next_user"' + (settings.triggerTiming === 'next_user' ? ' selected' : '') + '>下一轮用户消息后</option></select></label>'
            + ['includeTags', 'excludeTags'].map((key, i) => '<label class="rp-edit-field">' + ['只读取标签（留空读取正文）', '排除标签'][i] + '<input class="text_pole" data-rp-setting="' + key + '" value="' + esc(settings[key] || '') + '"></label>').join('')
            + '<label class="rp-edit-field">状态上下文预算（字符）<input class="text_pole" type="number" min="1000" max="60000" data-rp-setting="contextBudget" value="' + (settings.contextBudget || 16000) + '"></label>'
            + help('摘要、表格指令、推理和脚本始终排除。范围仅影响之后的新提取，不改变旧记录的来源规则。预算包含现状和维护提示词；优先保留相关状态，旧记录仍在档案中。') + '</details>';
    }
    function renderContextPreview(state) {
        const result = getContextPreview?.(state) || flow.context?.(state);
        if (!result) return '';
        return '<details class="rp-reference-settings"><summary>状态注入预览</summary><p>修订 ' + result.revision + ' · ' + (result.used || 0) + ' / ' + result.budget + ' 字符 · 未选入 ' + result.omitted + ' 项</p>'
            + (result.warning ? '<p role="alert">' + esc(result.warning) + '</p>' : '')
            + '<pre class="rp-context-preview">' + esc([result.brief, result.maintenance].filter(Boolean).join('\n\n')) + '</pre>'
            + '<ul>' + result.units.map(item => '<li>' + esc(item.reason + '：' + item.text) + '</li>').join('') + '</ul></details>';
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
            root.innerHTML = `<p role="alert">${esc(error.message)}</p>`;
            return;
        }
        if (!core) {
            root.innerHTML = `<section class="rp-blank"><span class="rp-blank-mark"><i class="fa-solid fa-book-open" aria-hidden="true"></i></span><span class="rp-eyebrow">剧情状态 · 尚未启用</span><h3>让故事，有迹可循。</h3><p>随着每一轮对话，整理人物关系、当下的处境，以及还没赴的约。</p><ul class="rp-onboarding-list"><li>谁和谁，有怎样的关系</li><li>接下来，有哪些约定</li><li>每次变化，都能回看来源</li></ul><div class="rp-controls">${button('enable-preview', '从这一轮开始')}${help('默认随正文维护，不额外发送请求。需要模型输出 rpEvents；独立于摘要和表格，从当前楼层开始记录。')}</div></section>`;
            if (nav.error) root.insertAdjacentHTML('beforeend', `<p role="alert">${esc(nav.error)}</p>`);
            if (nav.setup) {
                root.insertAdjacentHTML('beforeend', `<section class="rp-preview"><h4>空白开始</h4><p>从当前楼层建立基线；已有摘要、自定义表格和聊天正文保持不变。</p>${button('enable-confirm', '确认空白启用')}${button('setup-cancel', '返回')}</section>`);
            }
            return;
        }
        const hasData = core.facts.length + core.claims.length + core.observations.length
            + (view?.projection ? ['people', 'relationships', 'plans', 'items', 'locations'].reduce((sum, key) => sum + view.projection[key].length, 0) + Number(!!(view.projection.clock.date || view.projection.clock.description)) : 0);
        const pageTitle = nav.tab === 'world' ? ({ plans: '约定', items: '物品', locations: '地点' })[nav.filter || 'plans'] : tabs[nav.tab] || '剧情时间';
        const navMarkup = nav.tab === 'overview' || nav.selected || nav.settings ? '' : `<nav class="rp-breadcrumb${nav.tab === 'directory' ? ' rp-directory-header' : ''}" aria-label="剧情状态页面">${button('tab', nav.tab === 'directory' ? '‹' : '‹ 总概览', 'data-rp-tab="overview" aria-label="返回总概览"')}<h3 tabindex="-1">${esc(pageTitle)}</h3></nav>`;
        root.innerHTML = navMarkup;
        if (nav.notice) root.insertAdjacentHTML('beforeend', `<p role="status">${esc(nav.notice)}</p>`);
        if (nav.error) root.insertAdjacentHTML('beforeend', `<p role="alert">${esc(nav.error)}</p>`);
        if (nav.floor != null) root.insertAdjacentHTML('beforeend', `<div class="rp-read-only"><span>第 ${nav.floor} 楼时已知状态 · 只读</span>${button('current', '返回当前')}</div>`);
        if (nav.settings) { renderSettings(root, state, nav); return; }
        if (nav.edit) { root.insertAdjacentHTML('beforeend', editors.renderEdit(nav.edit, view.projection)); return; }
        if (!view?.projection) { root.insertAdjacentHTML('beforeend', `<p>所选楼层早于基线，没有可用状态。</p>${button('current', '返回当前状态')}`); return; }
        const projection = view.projection;
        if (nav.selected) { renderDetail(root, state, view, nav); return; }
        if (nav.tab === 'preview') {
            const result = getContextPreview?.(state) || flow.context?.(state);
            root.insertAdjacentHTML('beforeend', result ? '<section class="rp-context-page"><p>' + (result.used || 0) + ' 字符 · 修订 ' + result.revision + '</p>'
                + (result.warning ? '<p role="alert">' + esc(result.warning) + '</p>' : '')
                + '<h4>续写现状</h4><pre class="rp-context-preview">' + esc(result.brief || '本轮未注入状态简报') + '</pre>'
                + '<details><summary>维护指令与短引用</summary><pre class="rp-context-preview">' + esc(result.maintenance || '未注入维护指令') + '</pre></details></section>' : '<p>暂无注入预览</p>');
            return;
        }
        const channel = flow.channel(state), lastBatch = [...core.batches].filter(item => !item.superseded).sort((a, b) => (a.sourceFloor ?? a.floor) - (b.sourceFloor ?? b.floor)).at(-1);
        const maintenance = !core.settings.enabled ? '剧情状态已关闭' : !channel ? '自动维护已暂停' : channel === 'inline' ? '随正文维护' : channel === 'reply' ? '复用回复后处理' : '独立提取';
        const footer = `<footer class="rp-footer"><small>${nav.floor == null ? esc(maintenance) + (lastBatch ? ` · ${lastBatch.protocolStatus === 'missing' ? '摘要状态已读取' : '已处理到'} ${lastBatch.sourceFloor ?? lastBatch.floor} 楼` : ' · 尚未处理正文') : '当时已记录的状态 · 只读'}</small><div class="rp-controls">${nav.floor == null ? button("settings", "维护设置") + button("extract", "重新提取最新正文") + '<details class="rp-add-menu"><summary>添加记录</summary><div class="rp-controls">' + Object.entries({people:"人物",relationships:"关系",locations:"地点",items:"物品",plans:"约定"}).map(([kind,label]) => button("new",label,'data-rp-kind="' + kind + '"')).join("") + '</div></details>' : ""}${help('模型整理后自动保存；格式无效的项目跳过，不需要逐条确认。状态变化由模型输出事件，摘要不生成事实。不必开启回复后处理。说法、观察与事实分别保存；关闭维护不删除记录。')}</div></footer>`;
        const maintenanceNotices = document.createElement('div');
        if (nav.floor == null) {
            const progress = service.progress?.(state);
            if (progress?.missingCount) maintenanceNotices.insertAdjacentHTML('beforeend', '<small class="rp-progress">从第 ' + progress.start + ' 楼开始 · ' + (progress.latest == null ? '尚未完成维护' : '最近完成第 ' + progress.latest + ' 楼') + (progress.missingCount ? ' · 未处理 ' + progress.missingCount + ' 楼（' + progress.missingFrom + '–' + progress.missingTo + '）' : '') + '</small>');
            const failed = core.extractionJobs?.filter(job => job.status !== 'done') || [];
            if (failed.length) {
                const labels = { missing: '未输出事件块', incomplete: '事件块未输出完整', invalid_json: '事件 JSON 格式无效',
                    invalid_or_unsaved: '事件参数无效或保存未完成' };
                maintenanceNotices.insertAdjacentHTML('beforeend', '<p role="status">' + failed.slice(-3).map(job =>
                    (Number.isInteger(job.sourceFloor) ? '第 ' + esc(job.sourceFloor) + ' 楼' : '来源楼层未记录') + '：'
                    + esc(labels[job.errorClass] || (job.status === 'running' ? '正在提取' : '提取未完成'))).join('；') + '</p>');
            }
            const compiled = getContextPreview?.(state) || flow.context?.(state);
            if (compiled?.warning) maintenanceNotices.insertAdjacentHTML('beforeend', '<p role="alert">' + esc(compiled.warning) + '</p>');

        }
        if (lastBatch?.protocolStatus === 'incomplete' && nav.floor == null) maintenanceNotices.insertAdjacentHTML('beforeend', '<p class="rp-status-warning" role="status">该次事件块未完整输出；请重新提取正文。</p>');
        if (lastBatch?.protocolIssues?.length && nav.floor == null) maintenanceNotices.insertAdjacentHTML('beforeend', `<details class="rp-status-warning rp-protocol-issues"><summary>第 ${esc(lastBatch.floor)} 楼有 ${lastBatch.protocolIssues.length} 项格式问题</summary><p>下列项及其关联操作暂未处理；其他候选已继续校验。修正事件块后可重新处理。</p><ul>${lastBatch.protocolIssues.map(issue => `<li>第 ${esc(issue.index)} 项：${esc(issue.reason)}</li>`).join('')}</ul></details>`);
        const invalidFacts = view.pending.filter(item => isCurrentRpRecord(view, { id: item.factId }));
        if (invalidFacts.length) maintenanceNotices.insertAdjacentHTML('beforeend', `<div class="rp-notice rp-error"><div><strong>${invalidFacts.length} 项旧记录暂未采用</strong><small>这些记录暂不参与当前状态</small></div>${button('facts', '查看')}</div>`);
        if (nav.tab === 'directory') {
            const page = buildStatePage(core, view, nav); nav.page = page.page;
            const filters = Object.entries({ '': '全部', people: '人物', items: '物品', plans: '约定', relationships: '关系', locations: '地点', claims: '说法', observations: '观察' });
            root.insertAdjacentHTML('beforeend', `<section class="rp-directory-page"><form class="rp-search rp-directory-search"><button type="submit" data-rp-action="search" aria-label="搜索记录"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></button><label><span class="rp-sr-only">搜索记录</span><input class="text_pole" data-rp-search type="search" placeholder="搜索人物、关系、物品…" value="${esc(nav.search)}" autocomplete="off"></label></form><div class="rp-directory-filters" aria-label="记录类型">${filters.map(([key, label]) => button('filter', label, 'data-rp-filter="' + key + '" aria-pressed="' + (nav.filter === key) + '"')).join('')}</div><p class="rp-directory-count" role="status">${page.total} 条</p>${page.total ? presentation.rows(page.rows, projection, { directory: true }) : '<p class="rp-empty">没有匹配的记录</p>'}${page.pages > 1 ? `<div class="rp-pager">${button('prev', '上一页', page.page ? '' : 'disabled')}<span>${page.page + 1} / ${page.pages}</span>${button('next', '下一页', page.page === page.pages - 1 ? 'disabled' : '')}</div>` : ''}${maintenanceNotices.innerHTML ? '<details class="rp-directory-maintenance"><summary>维护状态 · 有待处理项</summary>' + maintenanceNotices.innerHTML + '</details>' : ''}${footer}</section>`);
            root.querySelector('.rp-directory-filters').scrollLeft = nav.directoryFilterScroll || 0;
            return;
        }
        root.insertAdjacentHTML('beforeend', maintenanceNotices.innerHTML);
        if (nav.tab === 'overview') {
            if (!hasData) {
                root.insertAdjacentHTML('beforeend', `<section class="rp-blank"><span class="rp-blank-mark"><i class="fa-solid fa-film" aria-hidden="true"></i></span><h3>${nav.floor != null ? '当时尚无状态记录' : core.settings.enabled ? '等故事写下下一页' : '自动维护已暂停'}</h3><p>${!channel && core.settings.enabled ? '尚未运行：请在维护设置中选择可用的方式。' : '人物、关系与约定，会随着剧情进展自动记录。'}</p><div class="rp-controls">${nav.floor != null ? '' : channel === 'inline' ? button('capture', '检查最新正文') : channel === 'independent' ? button('extract', '处理最新正文') + button('stop', '停止提取') : ''}</div></section>${footer}`);
                return;
            }
            const applied = new Set(view.applied);
            const facts = core.facts.filter(item => applied.has(item.id) && (nav.floor == null || item.floor <= nav.floor));
            const recentRows = [...facts].sort((a, b) => b.sequence - a.sequence).slice(0, 2)
                .map(item => ({ kind: 'facts', id: item.id, title: describeRecord(item, projection), record: item }));
            root.insertAdjacentHTML('beforeend', presentation.overview(projection, lastBatch, nav.floor, recentRows, facts, currentInformation(core, view, { floor: nav.floor })));
            if (channel === 'independent' && nav.floor == null) root.insertAdjacentHTML('beforeend', `<div class="rp-controls rp-run-controls">${button('extract', '处理最新正文')}${button('stop', '停止提取')}</div>${core.extractionJobs?.some(job => ['running', 'paused', 'failed'].includes(job.status)) ? '<p role="status">有未完成提取；可手动重试，不会自动重复计费。</p>' : ''}`);
            if (channel === 'inline' && !lastBatch && nav.floor == null) root.insertAdjacentHTML('beforeend', `<div class="rp-controls rp-run-controls">${button('capture', '检查最新正文')}</div>`);
            root.insertAdjacentHTML('beforeend', footer); return;
        }
        if (nav.tab === 'clock') {
            root.insertAdjacentHTML('beforeend', `<section class="rp-clock-detail">${presentation.scene(projection, lastBatch, nav.floor)}${nav.floor == null ? button('edit-clock', '修改时间') + button('edit-scene', '修改当前场景') : ''}${help('时间来自当前正文中的明确字段。时间跨度与回忆不会自动推进当前日期；约定到期不代表已经完成。')}${sectionHead('与时间有关的约定')}${presentation.rows(buildStatePage(core, view, { tab: 'world', filter: 'plans' }).rows, projection)}</section>${footer}`);
            return;
        }
        if (nav.tab === 'people') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ '': '全部', people: '人物', relationships: '关系' }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${nav.filter === key}"`)).join('')}</div>`);
        if (nav.tab === 'world') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ plans: '约定', items: '物品', locations: '地点' }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${(nav.filter || 'plans') === key}"`)).join('')}</div>`);
        if (nav.tab === 'history') root.insertAdjacentHTML('beforeend', `<div class="rp-filters">${Object.entries({ '': '全部', ...trackLabels, ...(nav.floor == null ? { pending: '问题记录', 'source-history': '旧回复' } : {}) }).map(([key, label]) => button('filter', label, `data-rp-filter="${key}" aria-pressed="${nav.filter === key}"`)).join('')}</div><details class="rp-snapshot"><summary>查看过去某一楼的状态</summary><label>楼层<input class="text_pole" type="number" min="0" data-rp-floor value="${nav.floor ?? ''}"></label>${button('snapshot', '查看快照')}</details>`);
        if (nav.floor == null && ['people', 'world'].includes(nav.tab)) root.insertAdjacentHTML('beforeend', button('new', '添加记录', 'data-rp-kind="' + (nav.tab === 'people' ? nav.filter || 'people' : nav.filter || 'plans') + '"'));
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
            if (['claims', 'observations'].includes(kind)) content += line('说话者', informationName(projection, item.data.speaker))
                + line('涉及对象', informationName(projection, item.data.subject))
                + line('明确知情者', Array.isArray(item.data.heardBy) && item.data.heardBy.length ? item.data.heardBy.map(value => informationName(projection, value)).join('、') : '未记录');
            if (item.action === 'state_updated') content += describeStateValues(item.data, projection).map(value => `<p>${esc(value)}</p>`).join('');
            if (item.reason && kind === 'candidate') content += `<p role="status">${esc(item.reason)}</p>`;
            if (item.evidence?.excerpt) content += `<blockquote>${esc(item.evidence.excerpt)}</blockquote>`;
            if (item.origin?.kind === 'model') content += line('来源', '模型根据所属回复整理');
            if (item.origin?.kind === 'user') content += line('来源', item.origin.intent === 'correction' ? '用户纠正当前值；旧历史快照保留' : '用户记录剧情变化');
            if (item.change) content += '<details><summary>修改前后</summary><p>' + esc(describeStateValues({ ...item.data, values: item.change.before }, projection).join('；')) + '</p><p>→ ' + esc(describeStateValues({ ...item.data, values: item.change.after }, projection).join('；')) + '</p></details>';
            if (item.origin?.corrects?.length) content += line('纠错范围', '关联 ' + item.origin.corrects.length + ' 条旧记录；相关叙事可自行复核，未改写摘要');
            if (item.evidence || item.origin?.kind === 'model') content += button('source', '定位正文');
            if (current && nav.floor == null && ['claims', 'observations'].includes(kind)) content += button('edit-open', '修改记录');
            if (current && nav.floor == null && kind === 'facts' && item.action === 'state_updated') {
                const target = item.data.collection;
                if (['clock', 'scene'].includes(target)) content += button('edit-' + target, '修改当前状态');
                else content += button('detail', '查看当前状态', `data-rp-kind="${esc(target)}" data-rp-id="${esc(item.data.id)}"`);
            }
        } else {
            content = presentation.entityDetail(kind, item, core, projection, nav.floor, view);
            if (kind === 'people' && nav.floor == null) content += '<details class="rp-state-list"><summary>修改状态</summary>' + (item.states || []).filter(value => !value.ended && !value.endedAt).map(value => '<p>' + esc(value.description) + '</p><div class="rp-controls">' + button('state-edit', '修改', 'data-rp-state-id="' + esc(value.id) + '"') + button('state-end', '结束状态', 'data-rp-state-id="' + esc(value.id) + '"') + '</div>').join('') + button('state-new', '添加临时状态') + '</details>';
            if (nav.floor == null) {
                if (kind === 'items' && item.status === 'destroyed') content += button('restore-item', '明确恢复物品');
                if (kind === 'plans' && ['completed','failed','cancelled'].includes(item.status)) content += button('reopen-plan', '重新开启约定');
                content += button('edit-open', '修改记录');
            }
        }
        root.insertAdjacentHTML('beforeend', `<section class="rp-detail">${content}</section>`);
    }
    async function action(element) {
        const state = getState(), nav = navigation.get(state), root = document.querySelector('#bakemono-rp-root');
        if (renderedStates.get(element.closest('#bakemono-rp-root, #bakemono-rp-review')) !== state) throw new Error('聊天已切换，请重新打开剧情状态');
        const name = element.dataset.rpAction, openedRevision = state.rpCore?.revision ?? null;
        if (root.querySelector('.rp-directory-filters')) nav.directoryFilterScroll = root.querySelector('.rp-directory-filters').scrollLeft;
        const assertOpen = () => { if (getState() !== state || (state.rpCore?.revision ?? null) !== openedRevision) throw new Error('聊天或状态已变化，请重新操作'); };
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
        if (['state-new', 'state-edit', 'state-end'].includes(name)) {
            if (nav.floor != null || nav.selected?.kind !== 'people') throw new Error('请选择当前人物');
            const person = service.view(state).projection.people.find(item => item.id === nav.selected.id), id = element.dataset.rpStateId || '';
            if (name === 'state-end') await service.editTemporary(person.id, id, {}, { expectedRevision: state.rpCore.revision, end: true });
            else {
                nav.edit = editors.draft('temporary', id, id ? person.states.find(item => item.id === id) : { description: '', target: null, visibility: 'observable' }, state.rpCore.revision);
                nav.edit.personId = person.id; nav.edit.create = !id;
            }
        }
        if (name === 'restore-item' || name === 'reopen-plan') {
            if (nav.floor != null) throw new Error('历史快照只读');
            await service.lifecycle(name === 'restore-item' ? 'item_restored' : 'plan_reopened', nav.selected.id, openedRevision);
        }
        if (name === 'new') {
            const kind = element.dataset.rpKind || 'people';
            const defaults = { name: '', title: '', participants: [], states: [], traits: [], aliases: [], status: kind === 'plans' ? 'proposed' : kind === 'relationships' ? 'active' : 'available' };
            nav.edit = editors.draft(kind, '', defaults, state.rpCore.revision); nav.edit.create = true;
            nav.settings = false; nav.selected = null;
        }
        if (name === 'backup') await downloadBackup(service.backup());
        if (name === 'clear-preview' && await confirm('先下载备份，再清空当前聊天的剧情状态？摘要、表格和聊天正文不会删除。')) {
            assertOpen();
            await downloadBackup(service.backup()); assertOpen(); flow.stopIndependent();
            await service.clear(openedRevision, state); nav.settings = false;
        }
        if (name === 'restore') {
            const file = await chooseBackup();
            if (!file) return;
            const payload = JSON.parse(await file.text()); assertOpen(); service.validateRestore(payload);
            if (!await confirm('恢复包仅替换本聊天剧情状态。先备份当前状态，恢复后暂停自动维护。继续？')) return;
            assertOpen(); await downloadBackup(service.backup()); assertOpen(); flow.stopIndependent(); await service.restore(payload, { expectedState: state, expectedRevision: openedRevision }); nav.settings = false;
        }
        if (['edit-open', 'edit-clock', 'edit-scene'].includes(name)) {
            if (nav.floor != null) throw new Error('历史快照只读，请返回当前状态');
            const kind = name === 'edit-open' ? nav.selected?.kind : name.slice(5), id = nav.selected?.id;
            const projection = service.view(state).projection;
            const entity = ['clock', 'scene'].includes(kind) ? projection[kind] || {} : ['claims', 'observations'].includes(kind)
                ? state.rpCore[kind].find(item => item.id === id)?.data : projection[kind]?.find(item => item.id === id);
            if (!entity) throw new Error('记录已变化，请重新打开');
            const editable = ['claims', 'observations'].includes(kind) ? { ...entity,
                speaker: entity.speaker ? informationName(projection, entity.speaker) : '', subject: entity.subject ? informationName(projection, entity.subject) : '',
                heardBy: Array.isArray(entity.heardBy) ? entity.heardBy.map(value => informationName(projection, value)) : [] } : entity;
            nav.edit = editors.draft(kind, id, editable, state.rpCore.revision);
        }
        if (name === 'edit-cancel') nav.edit = null;
        if (name === 'edit-save') {
            if (!nav.edit || nav.floor != null) throw new Error('请重新打开编辑');
            editors.readEdit(root, nav.edit);
            const edit = nav.edit, values = editors.values(edit);
            if (Object.keys(values).length) {
                if (['claims', 'observations'].includes(edit.kind)) await service.editInformation(edit.kind, edit.id, values, { expectedRevision: edit.revision });
                else if (edit.kind === 'temporary') await service.editTemporary(edit.personId, edit.id, values, { expectedRevision: edit.revision });
                else await service.editEntity(edit.kind, edit.id, values, { expectedRevision: edit.revision, create: !!edit.create, intent: edit.intent || 'change' });
            }
            if (getState() !== state) return;
            if (['claims', 'observations'].includes(edit.kind)) nav.selected = { kind: edit.kind, id: state.rpCore[edit.kind].at(-1).id };
            nav.edit = null; nav.notice = '修改已保存。';
        }
        if (name === 'tab') Object.assign(nav, { tab: element.dataset.rpTab, page: 0, filter: '', selected: null, search: '', scroll: 0, settings: false, evidenceDraft: null, trail: [] });
        if (['people', 'relationships', 'plans', 'items', 'locations', 'clock', 'history', 'facts', 'directory', 'context-preview'].includes(name)) {
            if (nav.tab === 'overview' && !nav.selected) nav.overviewOrigin = { action: name, scroll: scrollSurface(root)?.scrollTop || 0 };
            Object.assign(nav, { tab: ['plans', 'items', 'locations'].includes(name) ? 'world' : name === 'facts' ? 'history' : name === 'relationships' ? 'people' : name === 'context-preview' ? 'preview' : name, filter: ['relationships', 'plans', 'items', 'locations', 'facts'].includes(name) ? name : '', page: 0, selected: null, search: '', scroll: 0, trail: [] });
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
        if (name === 'save-settings') {
            const patch = Object.fromEntries([...root.querySelectorAll('[data-rp-setting]')].map(input => [input.dataset.rpSetting, input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value]));
            patch.mode = root.querySelector('[data-rp-mode]:checked')?.value;
            flow.stopIndependent(); await service.configure(patch); nav.settings = false; nav.settingsDraft = null;
        }
        if (name === 'snapshot') {
            const value = root.querySelector('[data-rp-floor]')?.value;
            if (value === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error('请输入有效楼层');
            Object.assign(nav, { floor: Number(value), page: 0, tab: 'overview', filter: '', selected: null, trail: [] });
        }
        if (name === 'current') { nav.floor = null; nav.selected = null; nav.trail = []; }
        if (name === 'extract' && await confirm('这会额外调用一次模型，重新提取最新正文并替换该轮旧的自动结果，保留手动更正。继续？')) { assertOpen(); await flow.runIndependent({ manual: true }); }
        if (name === 'capture') {
            const result = await flow.captureInline({ detailed: true });
            nav.notice = ({ processed: '本轮状态已处理。', unchanged: '本轮事件已处理过，没有新增内容。',
                delayed: '延迟一轮已开启，发送下一条消息后处理上一轮。', busy: '当前任务正在运行，请稍后再试。',
                inactive: '请先在维护设置中开启随正文维护。', missing: '本轮没有完整的 rpEvents 事件块，未记录成功。', incomplete: '本轮状态输出被截断，原状态保留；可继续对话后补充。' })[result.status];
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
        if (['tab', 'filter', 'prev', 'next', 'search', 'snapshot', 'current', 'people', 'relationships', 'plans', 'items', 'locations', 'clock', 'history', 'facts', 'pending', 'directory', 'context-preview'].includes(name)) {
            const selector = ['directory', 'context-preview'].includes(name) ? '.rp-breadcrumb h3' : name === 'tab' ? `[data-rp-tab="${nav.tab}"]` : name === 'filter' ? `[data-rp-filter="${nav.filter}"]` : '[data-rp-search]';
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
        catch (error) { if (getState() === state) {
            const root = element.closest('#bakemono-rp-root'), scroll = root ? scrollSurface(root).scrollTop : 0;
            navigation.get(state).error = error.message; render(state);
            const nextRoot = document.querySelector('#bakemono-rp-root');
            (nextRoot?.querySelector('.rp-edit-form [data-rp-edit-field]') || nextRoot?.querySelector('[role=alert]'))?.focus({ preventScroll: true });
            if (nextRoot) scrollSurface(nextRoot).scrollTop = scroll;
        } }
        finally { busy = false; element.disabled = false; }
    };
    const change = event => {
        if (captureEditorDraft(event)) return;
        if (event.target.matches?.('[data-rp-setting], [data-rp-mode]')) {
            const state = getState(), root = event.target.closest('#bakemono-rp-root');
            if (renderedStates.get(root) !== state) return;
            navigation.get(state).settingsDraft = { ...state.rpCore.settings,
                ...Object.fromEntries([...root.querySelectorAll('[data-rp-setting]')].map(input => [input.dataset.rpSetting, input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value])),
                mode: root.querySelector('[data-rp-mode]:checked')?.value };
            const references = root.querySelector('.rp-reference-settings');
            if (references) references.hidden = navigation.get(state).settingsDraft.mode !== 'independent';
            return;
        }
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
        if (event.target.matches('[data-rp-edit-field], [data-rp-edit-intent]') && nav.edit) { editors.readEdit(root, nav.edit); return true; }
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
