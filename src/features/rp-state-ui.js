import { buildStatePage, createStateNavigation, describeRecord, describeStateValues, trackLabels, isCurrentRpRecord } from '../rp-core/state-view.js';
import { currentInformation, informationName } from '../rp-core/current-information.js';
import { createRpStateEditors } from './rp-state-editors.js';
import { createRpStatePresentation } from './rp-state-presentation.js';

export function createRpStateUi({ documentRef: document, getState, service, flow, navigate, refresh, escapeHtml: esc, locateSource, promptLibrary, confirm = message => globalThis.confirm(message), download = null, chooseFile = null, getContextPreview = null }) {
    const navigation = createStateNavigation(), renderedStates = new WeakMap();
    const presentation = createRpStatePresentation({ escapeHtml: esc });
    let busy = false;
    const tabs = { overview: '概览', directory: '档案', history: '变化', settings: '设置' };
    // Earlier page names still arrive from links and saved navigation; fold them into the four tabs.
    const tabAliases = { people: 'directory', world: 'directory', preview: 'settings' };
    const button = (action, label, extra = '') => `<button type="button" class="menu_button${['save-settings', 'edit-save', 'prompt-apply', 'enable-preview', 'enable-confirm'].includes(action) ? ' rp-primary' : ''}" data-rp-action="${action}" ${extra}><span>${esc(label)}</span></button>`;
    const textLink = (action, label, extra = '') => `<button type="button" class="rp-more" data-rp-action="${action}" ${extra}>${esc(label)} <span class="rp-chevron" aria-hidden="true">›</span></button>`;
    const help = text => `<button type="button" class="bakemono-memory-help-trigger" aria-label="使用说明" aria-expanded="false"><i class="fa-solid fa-circle-info"></i><span class="bakemono-memory-help-content">${esc(text)}</span></button>`;
    const editors = createRpStateEditors({ escapeHtml: esc, button, help });
    const back = (action = 'back') => `<button type="button" class="rp-back" data-rp-action="${action}">‹ 返回</button>`;
    const scrollSurface = root => root?.closest('.bakemono-workbench-main') || root;
    const detailOrigin = element => ({ kind: element.dataset.rpKind, id: element.dataset.rpId });
    const settingKeys = ['enabled', 'automatic', 'inject', 'includeCharacterContext', 'includeWorldInfo', 'triggerTiming', 'includeTags', 'excludeTags', 'contextBudget', 'mode'];
    const readSettingsForm = root => ({ ...Object.fromEntries([...root.querySelectorAll('[data-rp-setting]')].map(input => [input.dataset.rpSetting, input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value])),
        mode: root.querySelector('[data-rp-mode]:checked')?.value });
    // Compared with the form as first shown, so defaults the stored settings leave unset never count as edits.
    const settingsChanges = (draft, baseline) => draft && baseline ? settingKeys.filter(key => key in baseline && String(draft[key] ?? '') !== String(baseline[key] ?? '')).length : 0;

    function tabBar(nav) {
        const current = tabAliases[nav.tab] || (nav.tab === 'clock' ? 'overview' : nav.tab);
        return `<nav class="rp-tabs" role="tablist" aria-label="剧情状态">${Object.entries(tabs).map(([key, label]) => `<button type="button" role="tab" data-rp-action="tab" data-rp-tab="${key}" aria-selected="${current === key}">${label}</button>`).join('')}</nav>`;
    }
    function switchRow(key, title, detail, checked) {
        return `<label class="rp-set-row"><span class="rp-set-text"><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span><input type="checkbox" role="switch" class="rp-switch" data-rp-setting="${key}" ${checked ? 'checked' : ''}></label>`;
    }
    function renderSettings(root, state, nav) {
        const core = state.rpCore;
        const settings = nav.settingsDraft || core.settings;
        const selected = settings.mode === 'independent' ? 'independent' : 'inline';
        const modes = { inline: ['随正文维护', '模型在回复末尾顺带写下变化，阅读时自动隐藏。', '<span class="rp-cost is-free">不花钱</span>'], independent: ['独立提取', '每次回复后另外调用一次默认生成模型来整理。', '<span class="rp-cost is-paid">每轮 +1 次</span>'] };
        const channel = flow.channel(state), running = core.extractionJobs?.some(job => job.status === 'running');
        const referenceSettings = `<details class="rp-reference-settings rp-set-details" ${selected === 'independent' ? '' : 'hidden'}><summary>独立提取的参考范围</summary>${switchRow('includeCharacterContext', '角色卡与用户人设', '最多 6000 字', settings.includeCharacterContext !== false)}${switchRow('includeWorldInfo', '命中的世界书条目', '最多 6000 字；不会发送整本世界书', settings.includeWorldInfo === true)}<p class="rp-note">默认只提供本轮正文、近期对话和当前状态。参考内容不作为本轮新事件的证据。</p></details>`;
        const changes = settingsChanges(nav.settingsDraft, nav.settingsBaseline);
        root.insertAdjacentHTML('beforeend', `<section class="rp-settings">
<div class="rp-set-group">${presentation.label('维护方式')}<div class="rp-set-list" role="radiogroup" aria-label="维护方式">${Object.entries(modes).map(([value, [title, description, cost]]) => `<label class="rp-set-row"><input type="radio" class="rp-radio" name="rp-maintenance-mode" data-rp-mode value="${value}" ${selected === value ? 'checked' : ''}><span class="rp-set-text"><strong>${esc(title)}</strong><small>${esc(description)}</small></span>${cost}</label>`).join('')}</div>${referenceSettings}${settings.modeNeedsChoice ? '<p class="rp-note" role="status">旧维护方式已暂停，请选择随正文或独立提取后保存。</p>' : ''}</div>
<div class="rp-set-group">${presentation.label('开关')}<div class="rp-set-list">${switchRow('enabled', '记录剧情状态', '关掉后已有记录保留，只是不再更新。', settings.enabled)}${switchRow('automatic', '每轮自动记录', '关掉后需要手动“读取最新回复”。', settings.automatic)}${switchRow('inject', '把当前状态告诉模型', '随每次生成注入一段状态简报。', settings.inject)}</div></div>
<div class="rp-set-group">${presentation.label('进阶')}<div class="rp-set-list">${renderPolicySettings(settings)}${renderContextPreview(state, nav)}${editors.renderPrompt(promptLibrary, nav)}<details class="rp-set-details"><summary>备份与恢复<small>只操作当前聊天的剧情状态</small></summary><div class="rp-controls">${button('backup', '导出状态备份')}${button('restore', '导入状态备份')}${button('clear-preview', '清空剧情状态')}</div><p class="rp-note">恢复前会先下载原状态备份，恢复后自动维护暂停。摘要、表格和正文保持不变。</p></details></div></div>
<div class="rp-set-group">${presentation.label('手动操作')}<div class="rp-set-list">${channel === 'inline' || selected === 'inline' ? `<button type="button" class="rp-set-row" data-rp-action="capture"><span class="rp-set-text"><strong>读取最新回复</strong><small>重新读取最新一楼末尾的状态变化</small></span><span class="rp-cost is-free">不花钱</span></button>` : ''}<button type="button" class="rp-set-row" data-rp-action="extract"><span class="rp-set-text"><strong>用模型重新整理最新回复</strong><small>替换这一楼的自动记录，保留你的手动修改</small></span><span class="rp-cost is-paid">+1 次请求</span></button>${running ? `<button type="button" class="rp-set-row" data-rp-action="stop"><span class="rp-set-text"><strong>停止提取</strong><small>正在运行的提取会中止，不会重复计费</small></span></button>` : ''}</div></div>
<div class="rp-savebar" role="status" ${changes ? '' : 'hidden'}><span>未保存 · <b data-rp-change-count>${changes}</b> 项修改</span>${button('settings-discard', '放弃')}${button('save-settings', '保存')}</div>
</section>`);
        if (!nav.settingsDraft) nav.settingsBaseline = readSettingsForm(root);
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
        return '<details class="rp-set-details"><summary>读取范围与时机<small>' + (settings.triggerTiming === 'next_user' ? '下一轮用户消息后处理' : '本轮结束后处理') + '</small></summary><label class="rp-edit-field">处理时机<select class="text_pole" data-rp-setting="triggerTiming"><option value="immediate"' + (settings.triggerTiming !== 'next_user' ? ' selected' : '') + '>本轮结束</option><option value="next_user"' + (settings.triggerTiming === 'next_user' ? ' selected' : '') + '>下一轮用户消息后</option></select></label>'
            + ['includeTags', 'excludeTags'].map((key, i) => '<label class="rp-edit-field">' + ['只读取标签（留空读取正文）', '排除标签'][i] + '<input class="text_pole" data-rp-setting="' + key + '" value="' + esc(settings[key] || '') + '"></label>').join('')
            + '<label class="rp-edit-field">状态上下文预算（字符）<input class="text_pole" type="number" min="1000" max="60000" data-rp-setting="contextBudget" value="' + (settings.contextBudget || 16000) + '"></label>'
            + '<p class="rp-note">摘要、表格指令、推理和脚本始终排除。范围只影响之后的新提取，不改变旧记录。预算包含现状和维护提示词；优先保留相关状态。</p></details>';
    }
    function renderContextPreview(state, nav) {
        const result = getContextPreview?.(state) || flow.context?.(state);
        if (!result) return '';
        return '<details class="rp-set-details" ' + (nav.previewOpen ? 'open' : '') + '><summary>查看注入内容<small>' + (result.used || 0) + ' / ' + result.budget + ' 字符 · 修订 ' + result.revision + '</small></summary>'
            + (result.warning ? '<p role="alert">' + esc(result.warning) + '</p>' : '')
            + '<h4>续写现状</h4><pre class="rp-context-preview">' + esc(result.brief || '本轮未注入状态简报') + '</pre>'
            + '<details><summary>维护指令与短引用</summary><pre class="rp-context-preview">' + esc(result.maintenance || '未注入维护指令') + '</pre></details>'
            + (result.omitted ? '<p class="rp-note">预算不足，未选入 ' + result.omitted + ' 项。</p>' : '') + '</details>';
    }
    function renderReview(state = getState()) {
        const root = document.querySelector('#bakemono-rp-review');
        if (root) { renderedStates.set(root, state); root.hidden = true; root.innerHTML = ''; }
    }
    function notices(state, view, nav, lastBatch, progress) {
        const core = state.rpCore, out = [];
        const notice = (strong, small, action = '', alert = true) => `<div class="rp-notice${alert ? ' is-alert' : ''}" role="status"><span class="rp-notice-dot" aria-hidden="true"></span><div><strong>${esc(strong)}</strong>${small ? `<small>${esc(small)}</small>` : ''}</div>${action}</div>`;
        if (nav.floor != null) return '';
        const skipped = lastBatch && (nav.tab === 'overview' || nav.tab === 'history' && nav.filter !== 'pending') ? core.candidates.filter(item => lastBatch.candidateIds.includes(item.id) && item.status === 'rejected' && !item.superseded && isCurrentRpRecord(view, item)) : [];
        if (skipped.length) out.push(notice(`第 ${lastBatch.sourceFloor ?? lastBatch.floor} 楼有 ${skipped.length} 条变化没记上`, (skipped[0].reason || '格式无效') + (skipped.length > 1 ? ' 等' : ''), textLink('pending', '查看')));
        if (nav.tab !== 'overview') return out.join('');
        const invalidFacts = view.pending.filter(item => isCurrentRpRecord(view, { id: item.factId }));
        if (invalidFacts.length) out.push(notice(`${invalidFacts.length} 项旧记录暂未采用`, '这些记录暂不参与当前状态', textLink('facts', '查看')));
        const failed = core.extractionJobs?.filter(job => job.status !== 'done') || [];
        if (failed.length) {
            const labels = { missing: '未输出事件块', incomplete: '事件块未输出完整', invalid_json: '事件 JSON 格式无效', invalid_or_unsaved: '事件参数无效或保存未完成' };
            const running = failed.some(job => job.status === 'running');
            out.push(notice(running ? '正在提取剧情状态' : '有未完成的提取', failed.slice(-3).map(job => (Number.isInteger(job.sourceFloor) ? '第 ' + job.sourceFloor + ' 楼' : '来源楼层未记录') + '：'
                + (labels[job.errorClass] || (job.status === 'running' ? '正在提取' : '提取未完成'))).join('；') + (running ? '' : '。可在设置里手动重试，不会自动重复计费。'), running ? textLink('stop', '停止') : '', !running));
        }
        if (lastBatch?.protocolStatus === 'incomplete') out.push(notice('上一轮的状态变化没有输出完整', '可以在设置里用模型重新整理这一楼。'));
        if (lastBatch?.protocolIssues?.length) out.push(`<details class="rp-notice-details"><summary>第 ${esc(lastBatch.floor)} 楼有 ${lastBatch.protocolIssues.length} 项格式问题</summary><p class="rp-note">下列项及其关联操作暂未处理；其他变化已照常记录。</p><ul class="rp-plain-list">${lastBatch.protocolIssues.map(issue => `<li>第 ${esc(issue.index)} 项：${esc(issue.reason)}</li>`).join('')}</ul></details>`);
        if (progress?.missingCount && progress.latest != null) out.push(`<p class="rp-note">从第 ${esc(progress.start)} 楼开始记录 · 第 ${esc(progress.missingFrom)}–${esc(progress.missingTo)} 楼还没处理</p>`);
        const compiled = getContextPreview?.(state) || flow.context?.(state);
        if (compiled?.warning) out.push(notice('注入内容有提醒', compiled.warning));
        return out.join('');
    }
    function render(state = getState()) {
        const root = document.querySelector('#bakemono-rp-root');
        if (!root) return;
        renderedStates.set(root, state);
        const nav = navigation.get(state), core = state.rpCore;
        if (tabAliases[nav.tab]) { nav.filter = nav.tab === 'world' ? nav.filter || 'plans' : nav.filter; nav.tab = tabAliases[nav.tab]; }
        let view;
        try { view = core ? service.view(state, nav.floor == null ? {} : { asOfFloor: nav.floor }) : null; }
        catch (error) {
            root.innerHTML = `<p role="alert">${esc(error.message)}</p>`;
            return;
        }
        if (!core) {
            root.innerHTML = `<section class="rp-blank"><div class="rp-clap" aria-hidden="true"><i class="rp-clap-top"></i><i class="rp-clap-bottom"></i></div>${presentation.label('剧情状态 · 尚未启用')}<h3>让故事，有迹可循。</h3><p>随着每一轮对话，记下人物关系、当下的处境，以及还没赴的约。</p><ul class="rp-plain-list"><li>谁和谁，有怎样的关系</li><li>接下来，有哪些约定</li><li>每次变化，都能回看来源</li></ul>${nav.setup ? `<section class="rp-preview" aria-labelledby="rp-setup-title"><h4 id="rp-setup-title">从这一轮开始记录</h4><p>从当前楼层建立起点；已有摘要、自定义表格和聊天正文保持不变。默认随正文维护，不额外花钱。</p><div class="rp-controls">${button('enable-confirm', '确认启用')}${button('setup-cancel', '返回')}</div></section>` : `<div class="rp-controls">${button('enable-preview', '从这一轮开始')}${help('默认随正文维护，不额外发送请求。需要模型输出 rpEvents；独立于摘要和表格，从当前楼层开始记录。')}</div>`}</section>`;
            if (nav.error) root.insertAdjacentHTML('beforeend', `<p role="alert">${esc(nav.error)}</p>`);
            return;
        }
        const channel = flow.channel(state), lastBatch = [...core.batches].filter(item => !item.superseded).sort((a, b) => (a.sourceFloor ?? a.floor) - (b.sourceFloor ?? b.floor)).at(-1);
        const maintenance = !core.settings.enabled ? '剧情状态已关闭' : !channel ? '自动维护已暂停' : channel === 'inline' ? '随正文维护' : channel === 'reply' ? '复用回复后处理' : '独立提取';
        const progress = nav.floor == null ? service.progress?.(state) : null;
        const processedFloor = progress ? progress.latest : lastBatch ? lastBatch.sourceFloor ?? lastBatch.floor : null;
        const animate = nav.animate; nav.animate = false;
        root.innerHTML = tabBar(nav);
        if (nav.notice) root.insertAdjacentHTML('beforeend', `<p class="rp-flash" role="status">${esc(nav.notice)}</p>`);
        if (nav.error) root.insertAdjacentHTML('beforeend', `<p class="rp-flash is-alert" role="alert" tabindex="-1">${esc(nav.error)}</p>`);
        if (nav.floor != null) root.insertAdjacentHTML('beforeend', `<div class="rp-readonly"><span>第 ${esc(nav.floor)} 楼时的状态 · 只读</span>${textLink('current', '回到现在')}</div>`);
        if (nav.edit) { root.insertAdjacentHTML('beforeend', back('edit-cancel') + editors.renderEdit(nav.edit, view.projection)); return; }
        if (nav.tab === 'settings' && !nav.selected) { renderSettings(root, state, nav); return; }
        if (!view?.projection) { root.insertAdjacentHTML('beforeend', `<p class="rp-empty">所选楼层早于记录起点，没有可用状态。</p>${textLink('current', '回到现在')}`); return; }
        const projection = view.projection;
        if (nav.selected) { renderDetail(root, state, view, nav); return; }
        root.insertAdjacentHTML('beforeend', notices(state, view, nav, lastBatch, progress));
        const hasData = core.facts.length + core.claims.length + core.observations.length
            + ['people', 'relationships', 'plans', 'items', 'locations'].reduce((sum, key) => sum + projection[key].length, 0) + Number(!!(projection.clock.date || projection.clock.description));
        const footer = `<footer class="rp-footer"><span>${nav.floor == null ? esc(maintenance) + (channel === 'inline' ? ' · 不额外花钱' : '') + (processedFloor != null ? ` · ${lastBatch?.protocolStatus === 'missing' ? '摘要状态已读取' : '已处理到'} ${esc(processedFloor)} 楼` : ' · 尚未处理正文') : '当时已记录的状态 · 只读'}</span>${nav.floor == null ? textLink('settings', '维护设置') : ''}</footer>`;
        if (nav.tab === 'overview') {
            if (!hasData) {
                root.insertAdjacentHTML('beforeend', `<section class="rp-blank"><div class="rp-clap" aria-hidden="true"><i class="rp-clap-top"></i><i class="rp-clap-bottom"></i></div><h3>${nav.floor != null ? '当时还没有状态记录' : core.settings.enabled ? '等故事写下下一页' : '自动维护已暂停'}</h3><p>${!channel && core.settings.enabled ? '还没有运行：请在设置里选择维护方式。' : '人物、关系与约定，会随着剧情进展自动记录。'}</p><div class="rp-controls">${nav.floor != null ? '' : channel === 'inline' ? button('capture', '读取最新回复') : channel === 'independent' ? button('extract', '立即提取最新回复') + button('stop', '停止提取') : ''}</div></section>${footer}`);
                return;
            }
            const applied = new Set(view.applied);
            const facts = core.facts.filter(item => applied.has(item.id) && (nav.floor == null || item.floor <= nav.floor));
            root.insertAdjacentHTML('beforeend', presentation.overview(projection, lastBatch, nav.floor, [], facts, currentInformation(core, view, { floor: nav.floor }), { maintenance, processedFloor, animate }));
            if (channel === 'inline' && !lastBatch && nav.floor == null) root.insertAdjacentHTML('beforeend', `<div class="rp-controls rp-run-controls">${button('capture', '读取最新回复')}</div>`);
            root.insertAdjacentHTML('beforeend', footer); return;
        }
        if (nav.tab === 'clock') {
            root.insertAdjacentHTML('beforeend', `<button type="button" class="rp-back" data-rp-action="tab" data-rp-tab="overview">‹ 返回</button>${presentation.scene(projection, lastBatch, nav.floor)}${nav.floor == null ? `<div class="rp-entry-actions">${button('edit-clock', '修改时间')}${textLink('edit-scene', '修改当前场景')}</div>` : ''}<p class="rp-note">时间来自正文里的明确说法。回忆和时间跨度不会自动推进当前日期；约定到期不代表已经完成。</p><section class="rp-entry-sec"><h4>与时间有关的约定</h4>${presentation.rows(buildStatePage(core, view, { tab: 'world', filter: 'plans' }).rows, projection)}</section>`);
            return;
        }
        if (nav.tab === 'directory') {
            const page = buildStatePage(core, view, nav); nav.page = page.page;
            const counts = { people: projection.people.length, relationships: projection.relationships.length, claims: 0, observations: 0, items: projection.items.length, plans: projection.plans.length, locations: projection.locations.length };
            for (const item of currentInformation(core, view, { floor: nav.floor })) counts[item.track]++;
            const filters = Object.entries({ '': '全部', people: '人物', relationships: '关系', plans: '约定', items: '物品', locations: '地点', claims: '说法', observations: '推测' }).filter(([key]) => !key || counts[key]);
            root.insertAdjacentHTML('beforeend', `<section class="rp-directory-page"><form class="rp-search"><label><span class="rp-label">搜索</span><input class="text_pole" data-rp-search type="search" placeholder="人物、道具、约定……" value="${esc(nav.search)}" autocomplete="off"></label><button type="submit" class="rp-more" data-rp-action="search">查找</button></form><nav class="rp-index" aria-label="记录类型">${filters.map(([key, label], index) => `${index ? '<span class="rp-index-sep" aria-hidden="true">/</span>' : ''}<button type="button" data-rp-action="filter" data-rp-filter="${key}" aria-pressed="${nav.filter === key}">${label}${key ? `<span class="rp-count">${counts[key]}</span>` : ''}</button>`).join('')}</nav>${page.total ? presentation.rows(page.rows, projection, { directory: true }) : '<p class="rp-empty">没有匹配的记录</p>'}${page.pages > 1 ? `<div class="rp-pager">${button('prev', '上一页', page.page ? '' : 'disabled')}<span>${page.page + 1} / ${page.pages}</span>${button('next', '下一页', page.page === page.pages - 1 ? 'disabled' : '')}</div>` : ''}${nav.floor == null ? `<p class="rp-add">添加：${Object.entries({ people: '人物', relationships: '关系', locations: '地点', items: '物品', plans: '约定' }).map(([kind, label]) => `<button type="button" class="rp-more" data-rp-action="new" data-rp-kind="${kind}">${label}</button>`).join('<span class="rp-index-sep" aria-hidden="true">/</span>')}</p>` : ''}${footer}</section>`);
            return;
        }
        // history
        const historyFilters = { '': '全部', facts: '事实', claims: '说法', observations: '推测', ...(nav.floor == null ? { pending: '没记上', 'source-history': '旧回复' } : {}) };
        const page = buildStatePage(core, view, nav); nav.page = page.page;
        root.insertAdjacentHTML('beforeend', `<section class="rp-history-page"><nav class="rp-index" aria-label="变化类型">${Object.entries(historyFilters).map(([key, label], index) => `${index ? '<span class="rp-index-sep" aria-hidden="true">/</span>' : ''}<button type="button" data-rp-action="filter" data-rp-filter="${key}" aria-pressed="${nav.filter === key}">${label}</button>`).join('')}</nav><details class="rp-snapshot"><summary>查看某一楼当时的状态</summary><label>楼层<input class="text_pole" type="number" min="0" data-rp-floor value="${nav.floor ?? ''}"></label>${button('snapshot', '查看')}</details><form class="rp-search"><label><span class="rp-label">搜索</span><input class="text_pole" data-rp-search type="search" placeholder="查找变化……" value="${esc(nav.search)}" autocomplete="off"></label><button type="submit" class="rp-more" data-rp-action="search">查找</button></form>${presentation.rows(page.rows, projection, { timeline: true })}${page.pages > 1 ? `<div class="rp-pager">${button('prev', '较新', page.page ? '' : 'disabled')}<span>${page.page + 1} / ${page.pages}</span>${button('next', '较早', page.page === page.pages - 1 ? 'disabled' : '')}</div>` : ''}${footer}</section>`);
    }
    function renderDetail(root, state, view, nav) {
        const core = state.rpCore, projection = view.projection, { kind, id } = nav.selected;
        const record = ['facts', 'claims', 'observations', 'candidate'].includes(kind);
        const item = (kind === 'candidate' ? core.candidates : core[kind] || projection[kind] || []).find(item => item.id === id);
        root.insertAdjacentHTML('beforeend', back());
        if (!item) { root.insertAdjacentHTML('beforeend', '<p class="rp-empty">记录已变化，请返回查看。</p>'); return; }
        let content, actions = '';
        if (record) {
            const current = isCurrentRpRecord(view, item);
            const pairs = [['类型', trackLabels[item.track || kind]], ['状态', !current ? '旧回复记录' : kind === 'candidate' ? '没记上' : '已记录']];
            if (['claims', 'observations'].includes(kind)) pairs.push(['说话者', informationName(projection, item.data.speaker)], ['涉及对象', informationName(projection, item.data.subject)],
                ['明确知情者', Array.isArray(item.data.heardBy) && item.data.heardBy.length ? item.data.heardBy.map(value => informationName(projection, value)).join('、') : '']);
            if (item.origin?.kind === 'model') pairs.push(['来源', '模型根据所属回复整理']);
            if (item.origin?.kind === 'user') pairs.push(['来源', item.origin.intent === 'correction' ? '你更正了当时记错的值；旧快照保留' : '你记录的剧情变化']);
            if (item.origin?.corrects?.length) pairs.push(['纠错范围', '关联 ' + item.origin.corrects.length + ' 条旧记录；摘要未改写']);
            content = `<header class="rp-entry-head">${presentation.label(`第 ${item.order ?? item.floor ?? '未知'} 楼 · ${trackLabels[item.track || kind] || '记录'}`)}<h3 class="rp-detail-title" tabindex="-1">${esc(describeRecord(item, projection))}</h3>${item.reason && kind === 'candidate' ? `<p class="rp-lede is-alert">${esc(item.reason)}</p>` : ''}</header>`;
            content += presentation.fields(pairs);
            if (item.action === 'state_updated') content += `<ul class="rp-plain-list">${describeStateValues(item.data, projection).map(value => `<li>${esc(value)}</li>`).join('')}</ul>`;
            if (item.evidence?.excerpt) content += `<blockquote class="rp-quote">${esc(item.evidence.excerpt)}</blockquote>`;
            if (item.change) content += '<details class="rp-set-details"><summary>修改前后</summary><p>' + esc(describeStateValues({ ...item.data, values: item.change.before }, projection).join('；')) + '</p><p>→ ' + esc(describeStateValues({ ...item.data, values: item.change.after }, projection).join('；')) + '</p></details>';
            if (current && nav.floor == null && ['claims', 'observations'].includes(kind)) actions += button('edit-open', '修改');
            if (current && nav.floor == null && kind === 'facts' && item.action === 'state_updated') {
                const target = item.data.collection;
                if (['clock', 'scene'].includes(target)) actions += button('edit-' + target, '修改当前状态');
                else actions += textLink('detail', '查看当前状态', `data-rp-kind="${esc(target)}" data-rp-id="${esc(item.data.id)}"`);
            }
            if (item.evidence || item.origin?.kind === 'model') actions += textLink('source', '定位正文');
        } else {
            content = presentation.entityDetail(kind, item, core, projection, nav.floor, view);
            if (kind === 'people' && nav.floor == null) {
                const states = (item.states || []).filter(value => !value.ended && !value.endedAt);
                content += `<details class="rp-set-details"><summary>临时状态<small>${states.length ? states.length + ' 项进行中' : '伤势、情绪等会结束的状态'}</small></summary>${states.map(value => `<div class="rp-set-row"><span class="rp-set-text"><strong>${esc(value.description)}</strong></span>${textLink('state-edit', '修改', `data-rp-state-id="${esc(value.id)}"`)}${textLink('state-end', '结束', `data-rp-state-id="${esc(value.id)}"`)}</div>`).join('')}${textLink('state-new', '添加临时状态')}</details>`;
            }
            if (nav.floor == null) {
                actions += button('edit-open', '修改');
                if (kind === 'items' && item.status === 'destroyed') actions += textLink('restore-item', '明确恢复物品');
                if (kind === 'plans' && ['completed', 'failed', 'cancelled'].includes(item.status)) actions += textLink('reopen-plan', '重新开启约定');
            }
        }
        root.insertAdjacentHTML('beforeend', `<section class="rp-detail">${content}${actions ? `<div class="rp-entry-actions">${actions}</div>` : ''}<p class="rp-note">修改会保留历史，不改动聊天正文。</p></section>`);
    }

    async function action(element) {
        const state = getState(), nav = navigation.get(state), root = document.querySelector('#bakemono-rp-root');
        if (renderedStates.get(element.closest('#bakemono-rp-root, #bakemono-rp-review')) !== state) throw new Error('聊天已切换，请重新打开剧情状态');
        const name = element.dataset.rpAction, openedRevision = state.rpCore?.revision ?? null;
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
            nav.selected = null;
        }
        if (name === 'backup') await downloadBackup(service.backup());
        if (name === 'clear-preview' && await confirm('先下载备份，再清空当前聊天的剧情状态？摘要、表格和聊天正文不会删除。')) {
            assertOpen();
            await downloadBackup(service.backup()); assertOpen(); flow.stopIndependent();
            await service.clear(openedRevision, state); nav.tab = 'overview';
        }
        if (name === 'restore') {
            const file = await chooseBackup();
            if (!file) return;
            const payload = JSON.parse(await file.text()); assertOpen(); service.validateRestore(payload);
            if (!await confirm('恢复包仅替换本聊天剧情状态。先备份当前状态，恢复后暂停自动维护。继续？')) return;
            assertOpen(); await downloadBackup(service.backup()); assertOpen(); flow.stopIndependent(); await service.restore(payload, { expectedState: state, expectedRevision: openedRevision }); nav.tab = 'overview';
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
        if (name === 'tab') Object.assign(nav, { animate: nav.tab !== element.dataset.rpTab, tab: element.dataset.rpTab, page: 0, filter: '', selected: null, edit: null, search: '', scroll: 0, evidenceDraft: null, trail: [] });
        if (['people', 'relationships', 'plans', 'items', 'locations', 'clock', 'history', 'facts', 'directory', 'context-preview'].includes(name)) {
            if (nav.tab === 'overview' && !nav.selected) nav.overviewOrigin = { action: name, scroll: scrollSurface(root)?.scrollTop || 0 };
            const tab = ['people', 'relationships', 'plans', 'items', 'locations', 'directory'].includes(name) ? 'directory' : ['history', 'facts'].includes(name) ? 'history' : name === 'context-preview' ? 'settings' : name;
            Object.assign(nav, { tab, filter: ['people', 'relationships', 'plans', 'items', 'locations', 'facts'].includes(name) ? name : '', page: 0, selected: null, edit: null, search: '', scroll: 0, trail: [], previewOpen: name === 'context-preview' });
        }
        if (name === 'filter') Object.assign(nav, { filter: element.dataset.rpFilter, page: 0, search: '', scroll: 0 });
        if (name === 'search') Object.assign(nav, { search: root.querySelector('[data-rp-search]')?.value || '', page: 0, scroll: 0 });
        if (name === 'prev') nav.page = Math.max(0, nav.page - 1);
        if (name === 'next') nav.page++;
        if (name === 'detail' || name === 'review-open') {
            if (name === 'review-open') { nav.trail = []; nav.selected = null; nav.floor = null; }
            nav.trail ||= [];
            nav.trail.push({ selected: nav.selected, tab: nav.tab, filter: nav.filter, page: nav.page, search: nav.search, floor: nav.floor,
                scroll: scrollSurface(root)?.scrollTop || 0, origin: detailOrigin(element) });
            nav.edit = null;
            nav.selected = { kind: element.dataset.rpKind || 'candidate', id: element.dataset.rpId }; navigate('rp-state');
        }
        if (name === 'pending') { Object.assign(nav, { tab: 'history', filter: 'pending', selected: null, edit: null, page: 0, floor: null, trail: [] }); navigate('rp-state'); }
        if (name === 'back') {
            const previous = nav.trail?.pop();
            Object.assign(nav, previous || { selected: null, scroll: 0 });
            nav.edit = null;
        }
        if (name === 'settings') Object.assign(nav, { tab: 'settings', selected: null, edit: null, trail: [], animate: nav.tab !== 'settings' });
        if (name === 'settings-discard') { nav.settingsDraft = null; nav.promptDraft = null; }
        if (name === 'enable-preview') nav.setup = true;
        if (name === 'setup-cancel') nav.setup = false;
        if (name === 'enable-confirm') { await service.enable(); nav.setup = false; }
        if (name === 'save-settings') {
            const patch = Object.fromEntries([...root.querySelectorAll('[data-rp-setting]')].map(input => [input.dataset.rpSetting, input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value]));
            patch.mode = root.querySelector('[data-rp-mode]:checked')?.value;
            flow.stopIndependent(); await service.configure(patch); nav.settingsDraft = null; nav.notice = '设置已保存。';
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
        if (['enable-preview', 'setup-cancel'].includes(name)) root.querySelector(`[data-rp-action="${name === 'enable-preview' ? 'enable-confirm' : 'enable-preview'}"]`)?.focus();
        if (name.startsWith('edit-')) root.querySelector('.rp-edit-form h3, .rp-detail-title')?.focus({ preventScroll: true });
        if (['detail', 'review-open'].includes(name)) { scrollSurface(root).scrollTop = 0; root.querySelector('.rp-detail-title')?.focus({ preventScroll: true }); }
        if (name === 'back') {
            [...root.querySelectorAll('[data-rp-action="detail"]')].find(node => node.dataset.rpKind === nav.origin?.kind && node.dataset.rpId === nav.origin?.id)?.focus({ preventScroll: true });
            scrollSurface(root).scrollTop = nav.scroll || 0;
        }
        if (['tab', 'filter', 'prev', 'next', 'search', 'snapshot', 'current', 'people', 'relationships', 'plans', 'items', 'locations', 'clock', 'history', 'facts', 'pending', 'directory', 'context-preview'].includes(name)) {
            const selector = name === 'filter' ? `[data-rp-filter="${nav.filter}"]` : ['search', 'prev', 'next'].includes(name) ? '[data-rp-search]' : '.rp-tabs [aria-selected="true"]';
            (root.querySelector(selector) || root.querySelector('.rp-tabs [aria-selected="true"]'))?.focus({ preventScroll: true });
            scrollSurface(root).scrollTop = 0;
            if (name === 'tab' && nav.tab === 'overview' && nav.overviewOrigin) {
                const origin = [...root.querySelectorAll('[data-rp-action]')].find(node => node.dataset.rpAction === nav.overviewOrigin.action);
                (origin || root.querySelector('.rp-tabs [aria-selected="true"]'))?.focus({ preventScroll: true });
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
        captureSettingsDraft(event);
    };
    // Settings stay a draft until the save bar is used, like every other settings page in the workbench.
    function captureSettingsDraft(event) {
        if (!event.target.matches?.('[data-rp-setting], [data-rp-mode]')) return false;
        const state = getState(), root = event.target.closest('#bakemono-rp-root');
        if (!root || renderedStates.get(root) !== state) return false;
        const nav = navigation.get(state);
        nav.settingsDraft = { ...state.rpCore.settings, ...readSettingsForm(root) };
        const references = root.querySelector('.rp-reference-settings');
        if (references) references.hidden = nav.settingsDraft.mode !== 'independent';
        const changes = settingsChanges(nav.settingsDraft, nav.settingsBaseline), bar = root.querySelector('.rp-savebar');
        if (bar) { bar.hidden = !changes; bar.querySelector('[data-rp-change-count]').textContent = String(changes); }
        return true;
    }
    function bind() {
        document.removeEventListener('click', click); document.addEventListener('click', click);
        document.removeEventListener('change', change); document.addEventListener('change', change);
        document.removeEventListener('submit', submit); document.addEventListener('submit', submit);
        document.removeEventListener('input', input); document.addEventListener('input', input);
        document.removeEventListener('keydown', keydown); document.addEventListener('keydown', keydown);
    }
    const keydown = event => {
        const control = event.target.closest?.('#bakemono-rp-root [role="button"][data-rp-action]');
        if (control && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void click({ target: control, preventDefault() {} }); return; }
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
    const input = event => { if (!captureEditorDraft(event)) captureSettingsDraft(event); };
    const submit = event => {
        if (!event.target.matches?.('#bakemono-rp-root .rp-search')) return;
        event.preventDefault();
        const element = event.target.querySelector('[data-rp-action="search"]');
        if (element) void click({ target: element, preventDefault() {} });
    };
    function getPendingCount() { return 0; }
    return { render, renderReview, getPendingCount, bind, navigation };
}
