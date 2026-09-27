import { themeChoiceLabel } from '../theme/theme-schema.js';
import { stageAutomationStatus } from '../summary/automation-status.js';
import { getSummarySourceShortLabel } from './summary-source-wizard.js';
import { summarySourceChoice, tableModeChoice } from './turn-trigger-policy.js';

export function createHubAutomationUi({
    documentRef,
    query,
    getState,
    getCurrentFloorMemoryIndex,
    getInjectionHeaderStatus,
    getAppearanceSettings,
    getActiveGlobalConfig,
    getPromptPresets,
    getSelectedPromptPresetId,
    getStageMaterialOverview,
    getAutoStageTargets = targets => targets,
    getIsBusy = () => false,
    getStageSourceModeLabel,
    defaultAutomation,
    defaultScanRules,
    describeSummary,
    escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
}) {
    // How far the next chapter is, shared by 自动总结 and its frame on 自动与数据.
    function stageProgress(state, materials = getStageMaterialOverview()) {
        const targets = materials.targets;
        const triggerType = state.automation.triggerType || defaultAutomation.triggerType;
        const currentValue = triggerType === 'chars'
            ? targets.reduce((sum, block) => sum + String(block.content || '').length, 0)
            : targets.length;
        const threshold = triggerType === 'chars'
            ? Math.max(100, Number(state.automation.charInterval || defaultAutomation.charInterval))
            : Math.max(1, Number(state.automation.floorInterval || defaultAutomation.floorInterval));
        const runtime = stageAutomationStatus(state, materials, { batch: getAutoStageTargets(targets),
            records: getCurrentFloorMemoryIndex?.(state)?.records || [], busy: getIsBusy() });
        const unit = triggerType === 'chars' ? '字' : '条摘要';
        const left = Math.max(0, threshold - currentValue);
        const title = runtime.code === 'waiting' ? `再攒 ${left.toLocaleString()} ${unit}就整理成下一章`
            : runtime.code === 'off' ? '自动总结已关闭' : runtime.title;
        return { materials, currentValue, threshold, unit, runtime, title,
            progress: Math.max(0, Math.min(100, Math.round((currentValue / threshold) * 100))) };
    }

    // One frame per background tool: a line of state, a quiet second line, a small bar and a coloured state dot.
    function setFrame(key, { line, copy, bar = 0, state, tone }) {
        query(`#bakemono-memory-data-hub-${key}-line`).text(line);
        query(`#bakemono-memory-data-hub-${key}-copy`).text(copy);
        query(`#bakemono-memory-data-hub-${key}-bar`).css('width', `${Math.max(0, Math.min(100, bar))}%`);
        query(`#bakemono-memory-data-hub-${key}-state`).text(state);
        query(`[data-hub-frame="${key}"]`).attr?.('data-tone', tone);
    }

    function renderHubPanels(state = getState()) {
        const index = getCurrentFloorMemoryIndex(state);
        const floorStats = index.aggregates;
        const latest = index.latest;
        const source = summarySourceChoice(state), tableMode = tableModeChoice(state);
        // Summaries read from replies still count as recording; only “manual” for both is off.
        const turnOn = !(source === 'manual' && tableMode === 'manual');
        const automationEnabled = !!state.automation?.enabled;
        const tables = Array.isArray(state.tableDatabase?.tables) ? state.tableDatabase.tables : [];
        const tableRows = tables.reduce((sum, table) => sum + (Array.isArray(table.rows) ? table.rows.length : 0), 0);
        const tableDrafts = state.tableDatabase?.editDrafts || [];
        const tableOn = tables.length > 0 && tableMode !== 'manual';
        const vectorEnabled = !!state.vectorMemory?.enabled;
        const vectorRecords = Array.isArray(state.vectorMemory?.records) ? state.vectorMemory.records : [];
        const enabledCount = [turnOn, automationEnabled, tableOn, vectorEnabled].filter(Boolean).length;
        const draftCount = (state.drafts || []).length;

        const orchestrationTitle = floorStats.pendingDraftCount
            ? `${floorStats.pendingDraftCount.toLocaleString()} 条内容待确认`
            : floorStats.activeTaskCount
                ? '正在整理记忆'
                : floorStats.missing
                    ? `${floorStats.missing.toLocaleString()} 楼尚无摘要`
                    : enabledCount ? '后台都正常' : '后台工具都还没开';
        query('#bakemono-memory-data-hub-title').text(orchestrationTitle);
        query('#bakemono-memory-data-hub-enabled').text(`4 项开着 ${enabledCount} 项`);

        const summaryName = { existing: '回复自带', inline: '随正文写', independent: '单独写', manual: '只手动' }[source] || '旧版组合';
        const tableName = { inline: '随正文写', after: '单独写', manual: '只手动' }[tableMode];
        const latestSaved = ['saved', 'covered'].includes(latest?.summaryState);
        setFrame('turn', {
            line: !latest ? '等待第一条回复' : latestSaved ? `第 ${latest.id} 楼已记好` : latest.summaryState === 'draft' ? `第 ${latest.id} 楼等你确认` : `第 ${latest.id} 楼还没有摘要`,
            copy: `摘要${summaryName} · 表格${tableName}`,
            bar: latest ? (latestSaved ? 100 : 40) : 0,
            state: !turnOn ? '没开' : !latest || latestSaved ? '正常' : '要补',
            tone: !turnOn ? 'off' : !latest || latestSaved ? 'ok' : 'alert',
        });

        const stage = stageProgress(state);
        const modeName = { commit_hide: '直接保存并隐藏', draft: '生成草稿等我确认' }[state.automation?.mode] || '只提醒';
        const stageAlert = ['failed', 'invalid', 'gap', 'paused'].includes(stage.runtime.code);
        setFrame('auto', {
            line: stage.title,
            copy: automationEnabled ? modeName : `没整理 ${stage.currentValue.toLocaleString()} ${stage.unit}`,
            bar: stage.progress,
            state: !automationEnabled ? '没开' : stageAlert ? '要处理' : stage.runtime.code === 'draft' ? '有草稿' : stage.runtime.code === 'waiting' ? '在攒' : '正常',
            tone: !automationEnabled ? 'off' : stageAlert ? 'alert' : stage.runtime.code === 'waiting' || stage.runtime.code === 'draft' ? 'wait' : 'ok',
        });

        const lastFloor = ids => Math.max(-1, ...(ids || []).map(Number).filter(Number.isFinite));
        const appliedFloor = lastFloor((state.tableDatabase?.history || [])[0]?.sourceMessageIds);
        const pendingOps = tableDrafts.reduce((sum, draft) => sum + (Array.isArray(draft.operations) ? draft.operations.length : 0), 0);
        setFrame('table', {
            line: tables.length ? `${tables.length} 张表 · ${tableRows.toLocaleString()} 行` : '还没有表格',
            copy: tableDrafts.length ? `${pendingOps || tableDrafts.length} 处修改等你应用` : appliedFloor >= 0 ? `跟到第 ${appliedFloor} 楼` : `填表${tableName}`,
            bar: latest && appliedFloor >= 0 ? appliedFloor / Math.max(1, latest.id) * 100 : 0,
            state: !tables.length ? '没有表格' : tableDrafts.length ? '有待应用' : tableOn ? '正常' : '只手动',
            tone: !tables.length ? 'off' : tableDrafts.length ? 'wait' : tableOn ? 'ok' : 'off',
        });

        const indexedFloors = new Set(vectorRecords.filter(record => !record.isSavedSummary).map(record => String(record.messageId))).size;
        const hits = (state.vectorMemory?.lastHits || []).length;
        setFrame('vector', {
            line: !vectorRecords.length ? '还没有建索引' : state.vectorMemory?.dirty ? `${indexedFloors} 楼已索引，有改动要更新` : `${indexedFloors} 楼都已建索引`,
            copy: vectorEnabled ? `召回开启${hits ? ` · 上次带上 ${hits} 条` : ''}` : '召回关闭',
            bar: floorStats.total ? indexedFloors / floorStats.total * 100 : 0,
            state: !vectorEnabled ? '没开' : state.vectorMemory?.dirty || !vectorRecords.length ? '等更新' : '正常',
            tone: !vectorEnabled ? 'off' : state.vectorMemory?.dirty || !vectorRecords.length ? 'wait' : 'ok',
        });

        query('#bakemono-memory-data-hub-table-count').text(tableRows.toLocaleString());
        query('#bakemono-memory-data-hub-vector-count').text(vectorRecords.length.toLocaleString());
        query('#bakemono-memory-data-hub-draft-count').text(draftCount.toLocaleString());

        const injectionStatus = getInjectionHeaderStatus(state);
        const scanMode = state.scanRules?.mode || defaultScanRules.mode;
        const apiProvider = state.automation?.apiProvider || defaultAutomation.apiProvider;
        const selectedConfig = getActiveGlobalConfig() || getPromptPresets().find(item => item.id === getSelectedPromptPresetId());
        query('#bakemono-memory-settings-hub-workflow').text(getSummarySourceShortLabel(state));
        query('#bakemono-memory-settings-hub-scan').text(scanMode === 'full' ? '全文管线' : '标签块');
        query('#bakemono-memory-settings-hub-archive').text(state.autoHideRecent?.enabled
            ? `自动 · 保留 ${Number(state.autoHideRecent.preserveRecent ?? 5)} 楼` : '手动');
        query('#bakemono-memory-settings-hub-injection').text(injectionStatus.short);
        query('#bakemono-memory-settings-hub-generation').text(apiProvider === 'custom'
            ? (String(state.automation?.customApi?.model || '').trim() || '自定义接口')
            : '酒馆主模型');
        query('#bakemono-memory-settings-hub-theme').text(themeChoiceLabel(getAppearanceSettings()));
        query('#bakemono-memory-settings-hub-config').text(selectedConfig?.name || '导入导出');
    }

    // What happens once enough summaries have piled up. The values are the hidden select's options.
    const modeChoices = [
        ['remind', '只提醒', '攒够了在剪辑台提示你，不自动请求', ''],
        ['draft', '生成草稿等我确认', '自动写一章，放进待确认', '+1 次请求'],
        ['commit_hide', '直接保存并隐藏旧楼层', '写好直接保存，再把被这一章覆盖的旧楼层隐藏起来', '+1 次请求'],
    ];
    const modeName = value => modeChoices.find(([key]) => key === value)?.[1] || '只提醒';
    let modeOpen = false;
    const relative = value => {
        const time = Date.parse(value || '');
        if (!Number.isFinite(time)) return '';
        const days = Math.floor((Date.now() - time) / 86400000);
        return days <= 0 ? '今天' : days === 1 ? '昨天' : new Date(time).toLocaleDateString();
    };

    // The rows under 什么时候整理 follow the form as typed, so they read the inputs, not saved state.
    function renderAutomationForm() {
        const mode = String(query('#bakemono-memory-auto-mode').val?.() || defaultAutomation.mode);
        const byChars = String(query('#bakemono-memory-auto-trigger').val?.() || defaultAutomation.triggerType) === 'chars';
        documentRef.querySelectorAll?.('[data-bakemono-auto-rule]').forEach(input => { input.hidden = input.dataset.bakemonoAutoRule !== (byChars ? 'chars' : 'floors'); });
        query('#bakemono-memory-automation-goal-unit').text(byChars ? '字' : '条');
        query('[data-bk-stage-when="commit_hide"]').prop?.('hidden', mode !== 'commit_hide');
        const container = documentRef.getElementById?.('bakemono-memory-automation-ways');
        if (!container) return;
        container.innerHTML = `<div class="bk-auto-way${modeOpen ? ' is-open' : ''}">
            <button type="button" class="bk-auto-way-h" data-bk-stage-way aria-expanded="${modeOpen}"><span class="bk-auto-way-name">整理完怎么办</span><span class="bk-auto-way-val">${modeName(mode)}</span><span class="bk-tbl-set-chev" aria-hidden="true">›</span></button>
            ${modeOpen ? `<div class="bk-auto-choices" role="radiogroup" aria-label="整理完怎么办">${modeChoices.map(([key, name, note, price]) => `<button type="button" class="bk-auto-choice" role="radio" aria-checked="${mode === key}" data-bk-stage-pick="${key}">
              <span class="bk-auto-radio" aria-hidden="true"></span><span><span class="bk-auto-choice-name">${name}</span>${price ? `<span class="bk-tbl-cost">${price}</span>` : ''}<small>${note}</small></span></button>`).join('')}</div>` : ''}
          </div>`;
    }

    // The latest chapters, saved or still waiting as drafts; a tap opens the chapter on the summary page.
    function renderRecentStages(state) {
        const container = documentRef.getElementById?.('bakemono-memory-automation-recent');
        if (!container) return;
        const saved = (state.stageSummaries || []).map(summary => ({ block: { ...summary, type: 'stage' }, draft: false }));
        const drafts = (state.drafts || []).filter(draft => draft.kind === 'stage').map(draft => ({ block: { ...draft, type: 'stage' }, draft: true }));
        const floorsOf = block => {
            const ids = (block.sourceMessageIds || []).map(Number).filter(Number.isFinite);
            return ids.length ? (Math.min(...ids) === Math.max(...ids) ? `第 ${ids[0]} 楼` : `第 ${Math.min(...ids)}–${Math.max(...ids)} 楼`) : '';
        };
        const rows = [...drafts, ...saved]
            .sort((a, b) => String(b.block.createdAt || '').localeCompare(String(a.block.createdAt || '')) || Number(b.block.sourceSortKey || 0) - Number(a.block.sourceSortKey || 0))
            .slice(0, 4);
        if (!rows.length) {
            container.innerHTML = '<p class="bk-auto-empty">还没有阶段总结。</p>';
            return;
        }
        container.innerHTML = rows.map(({ block, draft }) => {
            const title = describeSummary?.(block)?.title || block.title || '阶段总结';
            const meta = [floorsOf(block), relative(block.createdAt)].filter(Boolean).join(' · ');
            const target = draft ? 'data-bakemono-tab="drafts"' : `data-bakemono-summary-focus="${escapeHtml(block.id || block.hash || '')}" data-summary-type="stage"`;
            return `<button type="button" class="bk-stage-row" ${target}><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></span><span class="bk-stage-state${draft ? ' is-draft' : ''}">${draft ? '草稿等确认' : '已保存'}</span></button>`;
        }).join('');
    }

    function renderAutomationOverview(state = getState()) {
        const { materials, currentValue, threshold, unit, runtime, title, progress } = stageProgress(state);
        const enabled = !!state.automation.enabled;
        const mode = state.automation.mode || defaultAutomation.mode;
        const notes = [runtime.detail, materials.excludedCount ? `另有 ${materials.excludedCount} 条摘要因来源设置没有算进来` : ''].filter(Boolean);
        query('#bakemono-memory-automation-mode-badge').text(enabled ? modeName(mode) : '已关闭');
        query('#bakemono-memory-automation-runtime-title').text(title);
        query('#bakemono-memory-automation-runtime-description').text(notes.join(' · ')).prop?.('hidden', !notes.length);
        query('#bakemono-memory-automation-rule-status').text(`没整理 ${currentValue.toLocaleString()} / ${threshold.toLocaleString()} ${unit}`);
        query('#bakemono-memory-automation-facts').text(`已有 ${(state.stageSummaries || []).length} 个阶段总结`);
        query('#bakemono-memory-automation-progress-bar').css('width', `${progress}%`);
        query('.bk-stage-meter').toggleClass('is-running', runtime.code === 'running');
        query('.bk-stage-status').toggleClass('is-running', runtime.code === 'running');
        query('#bakemono-memory-automation-model-label').text(state.automation.apiProvider === 'custom'
            ? (String(state.automation.customApi?.model || '').trim() || '自定义接口') : '酒馆主模型');
        const action = documentRef.getElementById?.('bakemono-memory-automation-next-action');
        if (action) {
            action.hidden = !runtime.action;
            for (const key of ['bakemonoTab', 'bakemonoTaskAction', 'taskId', 'bakemonoSummaryFocus', 'summaryType']) delete action.dataset[key];
            if (runtime.action?.tab) action.dataset.bakemonoTab = runtime.action.tab;
            if (runtime.action?.taskId) { action.dataset.bakemonoTaskAction = 'retry'; action.dataset.taskId = runtime.action.taskId; }
            if (runtime.action?.summaryKey) {
                action.dataset.bakemonoSummaryFocus = runtime.action.summaryKey;
                action.dataset.summaryType = runtime.action.summaryType;
            }
            action.textContent = runtime.action ? `${runtime.action.label} ›` : '';
        }
        let issuesPanel = documentRef.getElementById?.('bakemono-memory-automation-issues');
        const description = documentRef.getElementById?.('bakemono-memory-automation-runtime-description');
        if (!materials.issues?.length) issuesPanel?.remove();
        else if (description) {
            if (!issuesPanel) {
                issuesPanel = documentRef.createElement('details');
                issuesPanel.id = 'bakemono-memory-automation-issues';
                issuesPanel.className = 'bk-stage-issues';
                description.after(issuesPanel);
            }
            issuesPanel.replaceChildren();
            const heading = documentRef.createElement('summary');
            heading.textContent = `${materials.issues.length} 条摘要有问题，没用上 ›`;
            issuesPanel.append(heading);
            for (const issue of materials.issues) {
                const row = documentRef.createElement('p');
                const button = documentRef.createElement('button');
                button.type = 'button'; button.className = 'bk-sum-link';
                button.dataset.bakemonoSummaryFocus = issue.key; button.dataset.summaryType = issue.type;
                button.textContent = '看这条 ›';
                row.textContent = `${issue.title}：${issue.reason} `;
                row.append(button); issuesPanel.append(row);
            }
        }
        renderAutomationForm();
        renderRecentStages(state);
        // The save bar puts unsaved choices back into the form right after this render.
        queueMicrotask(renderAutomationForm);
    }

    // The mode row opens its choices; a pick sets the hidden select, which the save bar tracks like any field.
    function bindAutomation(root = documentRef.getElementById?.('bakemono-workbench-root')) {
        if (!root || root.bakemonoStageWays) return;
        root.bakemonoStageWays = true;
        root.addEventListener('click', event => {
            const way = event.target.closest?.('[data-bk-stage-way]');
            const pick = event.target.closest?.('[data-bk-stage-pick]');
            if (!way && !pick) return;
            event.preventDefault();
            if (way) modeOpen = !modeOpen;
            else {
                const select = documentRef.getElementById('bakemono-memory-auto-mode');
                if (select && select.value !== pick.dataset.bkStagePick) {
                    select.value = pick.dataset.bkStagePick;
                    select.dispatchEvent(new Event('input', { bubbles: true }));
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                modeOpen = false;
            }
            renderAutomationForm();
        });
        root.addEventListener('change', event => {
            if (['bakemono-memory-auto-mode', 'bakemono-memory-auto-trigger'].includes(event.target?.id)) renderAutomationForm();
        });
        root.addEventListener('input', event => {
            if (event.target?.id !== 'bakemono-memory-settings-find') return;
            const words = String(event.target.value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
            let shown = 0;
            root.querySelectorAll('[data-hub-keys]').forEach(row => {
                const text = `${row.dataset.hubKeys} ${row.textContent}`.toLowerCase();
                row.hidden = !words.every(word => text.includes(word));
                if (!row.hidden) shown++;
            });
            root.querySelectorAll('[data-hub-group]').forEach(group => { group.hidden = !group.querySelector('[data-hub-keys]:not([hidden])'); });
            const count = root.querySelector('#bakemono-memory-settings-find-count');
            if (count) count.textContent = words.length ? `${shown} 项` : '';
        });
    }

    return { renderAutomationOverview, renderAutomationForm, renderHubPanels, bindAutomation, stageProgress };
}
