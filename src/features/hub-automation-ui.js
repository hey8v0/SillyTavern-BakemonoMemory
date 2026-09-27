import { themeChoiceLabel } from '../theme/theme-schema.js';
import { stageAutomationStatus } from '../summary/automation-status.js';
import { getSummarySourceShortLabel } from './summary-source-wizard.js';

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
    function renderHubPanels(state = getState()) {
        const floorStats = getCurrentFloorMemoryIndex(state).aggregates;
        const turnEnabled = !!state.turnSummary?.enabled;
        const automationEnabled = !!state.automation?.enabled;
        const tableEnabled = !!state.tableDatabase?.enabled;
        const vectorEnabled = !!state.vectorMemory?.enabled;
        const enabledCount = [turnEnabled, automationEnabled, tableEnabled, vectorEnabled].filter(Boolean).length;
        const tableCount = Array.isArray(state.tableDatabase?.tables) ? state.tableDatabase.tables.length : 0;
        const vectorCount = Array.isArray(state.vectorMemory?.records) ? state.vectorMemory.records.length : 0;
        const triggerType = state.automation?.triggerType || defaultAutomation.triggerType;
        const triggerValue = triggerType === 'chars'
            ? Number(state.automation?.charInterval || defaultAutomation.charInterval)
            : Number(state.automation?.floorInterval || defaultAutomation.floorInterval);
        const automationMode = state.automation?.mode || defaultAutomation.mode;
        const automationModeLabel = automationMode === 'commit_hide' ? '自动保存' : automationMode === 'draft' ? '生成草稿' : '仅提醒';
        const injectionStatus = getInjectionHeaderStatus(state);
        const scanMode = state.scanRules?.mode || defaultScanRules.mode;
        const apiProvider = state.automation?.apiProvider || defaultAutomation.apiProvider;
        const selectedConfig = getActiveGlobalConfig() || getPromptPresets().find(item => item.id === getSelectedPromptPresetId());

        const orchestrationTitle = floorStats.pendingDraftCount
            ? `${floorStats.pendingDraftCount.toLocaleString()} 条内容待确认`
            : floorStats.activeTaskCount
                ? '正在整理记忆'
                : floorStats.missing
                    ? `${floorStats.missing.toLocaleString()} 楼尚无摘要`
                    : enabledCount ? '记忆编排正常' : '等待启用后台工具';
        query('#bakemono-memory-data-hub-title').text(orchestrationTitle);
        query('#bakemono-memory-data-hub-enabled').text(`${enabledCount} 项开启`);
        query('#bakemono-memory-data-hub-turn-state').text(turnEnabled ? '已开启' : '未开启').toggleClass('is-on', turnEnabled);
        query('#bakemono-memory-data-hub-auto-state').text(automationEnabled ? automationModeLabel : '未开启').toggleClass('is-on', automationEnabled);
        query('#bakemono-memory-data-hub-auto-copy').text(automationEnabled
            ? `每 ${triggerValue.toLocaleString()} ${triggerType === 'chars' ? '字' : '条摘要'}`
            : '后台整理规则');
        query('#bakemono-memory-data-hub-table-count').text(tableCount.toLocaleString());
        query('#bakemono-memory-data-hub-vector-count').text(vectorCount.toLocaleString());
        query('#bakemono-memory-data-hub-vector-copy').text(vectorEnabled
            ? (vectorCount ? '索引健康' : '等待建立索引')
            : '尚未开启');
        query('#bakemono-memory-settings-hub-workflow').text(getSummarySourceShortLabel(state));
        query('#bakemono-memory-settings-hub-scan').text(scanMode === 'full' ? '全文管线' : '标签块');
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
        query('#bakemono-memory-automation-goal-note').text(byChars ? '没整理的摘要一共多少字' : '没整理的剧情摘要条数');
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
        const materials = getStageMaterialOverview();
        const targets = materials.targets;
        const triggerType = state.automation.triggerType || defaultAutomation.triggerType;
        const currentValue = triggerType === 'chars'
            ? targets.reduce((sum, block) => sum + String(block.content || '').length, 0)
            : targets.length;
        const threshold = triggerType === 'chars'
            ? Math.max(100, Number(state.automation.charInterval || defaultAutomation.charInterval))
            : Math.max(1, Number(state.automation.floorInterval || defaultAutomation.floorInterval));
        const progress = Math.max(0, Math.min(100, Math.round((currentValue / threshold) * 100)));
        const enabled = !!state.automation.enabled;
        const runtime = stageAutomationStatus(state, materials, { batch: getAutoStageTargets(targets),
            records: getCurrentFloorMemoryIndex?.(state)?.records || [], busy: getIsBusy() });
        const mode = state.automation.mode || defaultAutomation.mode;
        const unit = triggerType === 'chars' ? '字' : '条摘要';
        const left = Math.max(0, threshold - currentValue);
        // Say how far the next chapter is; the other states keep their own words.
        const title = runtime.code === 'waiting' ? `再攒 ${left.toLocaleString()} ${unit}就整理成下一章`
            : runtime.code === 'off' ? '自动总结已关闭' : runtime.title;
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
    }

    return { renderAutomationOverview, renderAutomationForm, renderHubPanels, bindAutomation };
}
