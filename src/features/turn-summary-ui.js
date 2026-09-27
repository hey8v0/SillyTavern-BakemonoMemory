import { summarySourceChoice, tableModeAvailable, tableModeChoice } from './turn-trigger-policy.js';
import { summarySourceLabels } from './summary-source-wizard.js';

export function syncSummarySourceControls(query, choice) {
    query('#bakemono-memory-turn-trigger-timing').prop('disabled', !['independent', 'legacy'].includes(choice));
    query('#bakemono-memory-turn-auto-save').prop('disabled', !['independent', 'manual', 'legacy'].includes(choice));
}

// The choices shown under 摘要 and 表格 on 自动记忆. The values are the hidden selects' options.
const summaryChoices = [
    ['existing', '回复里本来就有', '角色卡或预设让模型自己写摘要块，插件只读取', ''],
    ['inline', '随正文写', '插件让模型在回复里顺手写，不多花请求', ''],
    ['independent', '回复后单独写', '回复结束后再请求一次，写得更稳', '+1 次请求'],
    ['manual', '只手动', '需要时自己点“记这一楼”', ''],
];
const tableChoices = [
    ['inline', '随正文写', '模型在回复里顺手写表格修改，不多花请求', ''],
    ['after', '回复后单独写', '回复结束后再请求一次', '+1 次请求'],
    ['manual', '只手动', '需要时在表格页点“只填表格”', ''],
];
const choiceName = (choices, value) => choices.find(([key]) => key === value)?.[1] || '旧版组合设置';

export function createTurnSummaryUi({
    documentRef,
    query,
    getState,
    defaultState,
    turnProcessingModes,
    tableSchemaScopes,
    getTableSchemaScopeLabel,
    getCurrentCharacterSchemaLabel,
    renderTableProfileControls,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    renderInlinePromptPresetControls,
    renderTableList,
    renderTableEditDrafts,
    getFloorMemoryIndex = () => null,
    escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
}) {
    let openWay = null;

    // Counts the table changes that came from one floor: + added rows, ~ updated, − removed.
    function tableChangeText(state, floorId, floor, tableMode) {
        if (floor?.tableState === 'draft') return `表格 ${floor.tableDraftCount || ''} 处等你应用`.replace('  ', ' ');
        if (floor?.tableState === 'applied') {
            const counts = { '+': 0, '~': 0, '−': 0 };
            for (const history of state.tableDatabase?.history || []) {
                if (!(history.sourceMessageIds || []).some(id => Number(id) === Number(floorId))) continue;
                for (const operation of history.operations || []) {
                    counts[operation.op === 'insert' ? '+' : operation.op === 'delete' ? '−' : '~']++;
                }
            }
            const text = Object.entries(counts).filter(([, n]) => n).map(([sign, n]) => `${sign}${n}`).join(' ');
            return text ? `表格 ${text}` : '表格已更新';
        }
        return tableMode === 'manual' ? '' : '表格没有变化';
    }

    function summaryStateText(floor) {
        return { saved: '摘要已保存', covered: '已收进阶段总结', draft: '摘要等你确认' }[floor?.summaryState] || '';
    }

    function renderWays(state) {
        const container = documentRef.querySelector('#bakemono-memory-turn-ways');
        if (!container) return;
        const source = String(query('#bakemono-memory-turn-summary-source').val() || summarySourceChoice(state));
        const table = String(query('#bakemono-memory-turn-table-mode').val() || tableModeChoice(state));
        // Whether a separate table request is possible depends on the source being chosen, not the saved one.
        const draftState = { turnSummary: { enabled: ['independent', 'manual'].includes(source), auto: source === 'independent' } };
        const row = (key, title, choices, value, available = () => true) => `<div class="bk-auto-way${openWay === key ? ' is-open' : ''}">
            <button type="button" class="bk-auto-way-h" data-bk-auto-way="${key}" aria-expanded="${openWay === key}"><span class="bk-auto-way-name">${title}</span><span class="bk-auto-way-val">${escapeHtml(choiceName(choices, value))}</span><span class="bk-tbl-set-chev" aria-hidden="true">›</span></button>
            ${openWay === key ? `<div class="bk-auto-choices" role="radiogroup" aria-label="${title}">${choices.map(([choice, name, note, price]) => {
                const allowed = available(choice);
                return `<button type="button" class="bk-auto-choice" role="radio" aria-checked="${value === choice}" data-bk-auto-pick="${key}:${choice}"${allowed ? '' : ' disabled'}>
                  <span class="bk-auto-radio" aria-hidden="true"></span><span><span class="bk-auto-choice-name">${name}</span>${price ? `<span class="bk-tbl-cost">${price}</span>` : ''}<small>${allowed ? note : '摘要是“只手动”时不能自动单独填表'}</small></span></button>`;
            }).join('')}</div>` : ''}
          </div>`;
        container.innerHTML = row('summary', '摘要', summaryChoices, source)
            + row('table', '表格', tableChoices, table, choice => tableModeAvailable(draftState, choice));
        const separateSummary = ['independent', 'manual'].includes(source);
        const when = {
            after: source === 'independent' || table === 'after',
            'summary-separate': separateSummary,
            'summary-inline': source === 'inline',
            'table-inline': table === 'inline',
            'table-after': table === 'after',
            'table-auto': table !== 'manual',
            'no-prompt': source === 'existing' && table !== 'inline',
        };
        for (const [key, visible] of Object.entries(when)) query(`[data-bk-auto-when="${key}"]`).prop('hidden', !visible);
        query('#bakemono-memory-turn-prompt-summary').text([
            separateSummary ? '单独写摘要' : source === 'inline' ? '随正文摘要' : '',
            table === 'inline' ? '随正文填表' : '',
        ].filter(Boolean).join('、') || '当前方式不需要');
    }

    function renderStatus(state) {
        const source = summarySourceChoice(state);
        const tableMode = tableModeChoice(state);
        const index = getFloorMemoryIndex(state);
        const latest = index?.latest || null;
        const lastRun = state.turnSummary.lastRun;
        const failed = lastRun?.status === 'failed' && Number(lastRun.messageId) === Number(latest?.id);
        const summaryText = summaryStateText(latest);
        const title = !latest ? '等待第一条回复'
            : lastRun?.status === 'running' ? `正在记第 ${lastRun.messageId} 楼`
            : failed ? `第 ${latest.id} 楼没记上`
            : latest.summaryState === 'draft' ? `第 ${latest.id} 楼的摘要等你确认`
            : summaryText ? `第 ${latest.id} 楼已记好`
            : source === 'existing' || source === 'inline' ? `第 ${latest.id} 楼没有写摘要` : `第 ${latest.id} 楼还没记`;
        query('#bakemono-memory-turn-source-label').text(`摘要：${choiceName(summaryChoices, source)} · 表格：${choiceName(tableChoices, tableMode)}`);
        query('#bakemono-memory-turn-runtime-title').text(title);
        const steps = latest ? [
            summaryText ? `摘要 <b>${summaryText.replace(/^摘要/, '')}</b>` : '摘要 <b class="is-alert">没有</b>',
            tableChangeText(state, latest.id, latest, tableMode),
        ].filter(Boolean) : [];
        query('#bakemono-memory-turn-steps').html(steps.map(step => `<span>${step.startsWith('表格') ? escapeHtml(step) : step}</span>`).join(''));
        const note = failed ? lastRun.error || '请求没有完成。'
            : !latest ? (source === 'independent' ? '下一条回复结束后会单独写一次摘要。' : source === 'manual' ? '需要时点“记这一楼”。' : '下一条回复里的摘要会自动保存。')
            : '';
        query('#bakemono-memory-turn-status').text(note).prop('hidden', !note).toggleClass('is-alert', failed);
        // Writing a summary for this floor costs a request; offer it where it makes sense.
        const canWrite = !!latest && lastRun?.status !== 'running' && (['independent', 'manual', 'legacy'].includes(source) || !summaryText || failed);
        query('[data-bakemono-action="process-latest-turn"]').prop('hidden', !canWrite);
        query('#bakemono-memory-turn-redo-label').text(summaryText && !failed ? '重新记这一楼' : ['independent', 'manual', 'legacy'].includes(source) ? '记这一楼' : '补写这一楼摘要');
        const drafts = (state.drafts || []).length;
        query('#bakemono-memory-turn-drafts-link').text(`待确认 ${drafts} 条 ›`).prop('hidden', !drafts);
        query('.bk-auto-status').toggleClass('is-running', lastRun?.status === 'running');
    }

    function renderRecent(state) {
        const container = documentRef.querySelector('#bakemono-memory-turn-recent');
        if (!container) return;
        const index = getFloorMemoryIndex(state);
        const floors = (index?.records || []).slice(-6).reverse();
        const tableMode = tableModeChoice(state);
        if (!floors.length) {
            container.innerHTML = '<p class="bk-auto-empty">还没有回复。</p>';
            return;
        }
        container.innerHTML = floors.map((floor, i) => {
            const summary = summaryStateText(floor);
            const table = tableChangeText(state, floor.id, floor, tableMode);
            const fix = !summary ? (i === 0
                ? ''
                : '<button type="button" class="bk-sum-link bk-auto-fix" data-bakemono-nav="preview" data-bakemono-preview-type="story" data-bakemono-open-batch>去补写 ›</button>') : '';
            return `<div class="bk-auto-turn"><span class="bk-auto-floor">${floor.id} 楼</span>
              <span class="bk-auto-what">${summary ? `<b class="is-done">${summary}</b>` : '<b class="is-alert">没写摘要</b>'}${table ? ` · <span class="bk-auto-table">${escapeHtml(table)}</span>` : ''}</span>${fix}</div>`;
        }).join('');
    }

    function render(state = getState()) {
        const source = summarySourceChoice(state);
        syncSummarySourceControls(query, source);
        query('#bakemono-memory-turn-summary-source').val(source);
        query('#bakemono-memory-turn-table-mode').val(tableModeChoice(state));
        query('#bakemono-memory-turn-trigger-timing').val(state.turnSummary.triggerTiming === 'next_user' ? 'next_user' : 'immediate');
        query('#bakemono-memory-turn-auto-save').prop('checked', state.turnSummary.saveMode === 'commit');
        query('#bakemono-memory-turn-include-user').prop('checked', state.turnSummary.includeUserMessage !== false);
        query('#bakemono-memory-turn-include-character').prop('checked', state.turnSummary.includeCharacterContext !== false);
        query('#bakemono-memory-turn-include-world-info').prop('checked', !!state.turnSummary.includeWorldInfo);
        query('#bakemono-memory-turn-world-max-context').val(state.turnSummary.worldInfoMaxContext ?? defaultState.turnSummary.worldInfoMaxContext);
        query('#bakemono-memory-turn-include-tags').val(state.turnSummary.includeTags || '');
        query('#bakemono-memory-turn-exclude-tags').val(state.turnSummary.excludeTags || '');
        query('#bakemono-memory-turn-reference').val(state.turnSummary.referenceContext || '');
        query('#bakemono-memory-table-inject-memory').prop('checked', state.tableDatabase.injectMemory !== false);
        query('#bakemono-memory-table-auto-apply').prop('checked', !!state.tableDatabase.autoApply);
        query('#bakemono-memory-table-schema-scope').val(state.tableDatabase.schemaScope || tableSchemaScopes.CHAT);

        const tables = state.tableDatabase.tables || [];
        const tableDrafts = state.tableDatabase.editDrafts || [];
        const tableRowCount = tables.reduce((total, table) => total + (Array.isArray(table.rows) ? table.rows.length : 0), 0);
        const tableDraftOperationCount = tableDrafts.reduce((total, draft) => total + (Array.isArray(draft.operations) ? draft.operations.length : 0), 0);
        query('#bakemono-memory-table-schema-status').text(`${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)} · ${tables.length} 张表 · ${getCurrentCharacterSchemaLabel()}`);
        query('#bakemono-memory-table-overview-count').text(tables.length);
        query('#bakemono-memory-table-overview-row-count').text(tableRowCount);
        query('#bakemono-memory-table-overview-draft-count').text(tableDraftOperationCount);
        query('#bakemono-memory-table-draft-label').text(`${tableDraftOperationCount} 处`);
        // One line on the 表格 page: what is waiting, or how far the tables have followed the story.
        const lastFloor = ids => Math.max(-1, ...(ids || []).map(Number).filter(Number.isFinite));
        const pendingFloor = Math.max(-1, ...tableDrafts.map(draft => lastFloor(draft.sourceMessageIds)));
        const appliedFloor = lastFloor((state.tableDatabase.history || [])[0]?.sourceMessageIds);
        query('#bakemono-memory-table-headline').text(tableDrafts.length
            ? `${pendingFloor >= 0 ? `第 ${pendingFloor} 楼` : '这一轮'}有${tableDraftOperationCount ? ` ${tableDraftOperationCount} 处` : ''}修改等你应用`
            : appliedFloor >= 0 ? `表格已跟到第 ${appliedFloor} 楼` : tables.length ? '表格还没有自动填过' : '还没有表格');
        renderTableProfileControls(state);

        query('#bakemono-memory-turn-prompt').val(state.turnSummary.prompt || defaultTurnSummaryPrompt);
        query('#bakemono-memory-table-prompt').val(state.turnSummary.tablePrompt || defaultTableEditPrompt);
        query('#bakemono-memory-inline-hide-table').prop('checked', state.inlineGeneration.hideTableEdit !== false);
        query('#bakemono-memory-inline-summary-prompt').val(state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt);
        query('#bakemono-memory-inline-table-prompt').val(state.inlineGeneration.tablePrompt || defaultInlineTablePrompt);
        renderInlinePromptPresetControls('summary', '#bakemono-memory-inline-summary-preset-select', '#bakemono-memory-inline-summary-preset-name');
        renderInlinePromptPresetControls('table', '#bakemono-memory-inline-table-preset-select', '#bakemono-memory-inline-table-preset-name');

        renderStatus(state);
        renderWays(state);
        // The save bar puts unsaved choices back into the selects right after this render.
        queueMicrotask(() => renderWays(getState()));
        renderRecent(state);
        renderTableList(state);
        renderTableEditDrafts(state);
    }

    // Row taps open the choices; a pick sets the hidden select, which the save bar tracks like any other field.
    function bind(root = documentRef.querySelector('#bakemono-workbench-root')) {
        if (!root || root.bakemonoAutoWays) return;
        root.bakemonoAutoWays = true;
        root.addEventListener('click', event => {
            const way = event.target.closest?.('[data-bk-auto-way]');
            const pick = event.target.closest?.('[data-bk-auto-pick]');
            if (!way && !pick) return;
            event.preventDefault();
            if (way) {
                openWay = openWay === way.dataset.bkAutoWay ? null : way.dataset.bkAutoWay;
            } else if (!pick.disabled) {
                const [key, value] = pick.dataset.bkAutoPick.split(':');
                const select = documentRef.querySelector(key === 'summary' ? '#bakemono-memory-turn-summary-source' : '#bakemono-memory-turn-table-mode');
                if (select && select.value !== value) {
                    select.value = value;
                    select.dispatchEvent(new Event('input', { bubbles: true }));
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                // A manual summary cannot carry an automatic separate table request.
                const table = documentRef.querySelector('#bakemono-memory-turn-table-mode');
                if (key === 'summary' && value === 'manual' && table?.value === 'after') {
                    table.value = 'manual';
                    table.dispatchEvent(new Event('input', { bubbles: true }));
                    table.dispatchEvent(new Event('change', { bubbles: true }));
                }
                openWay = null;
            }
            renderWays(getState());
        });
        // The save bar restores or discards drafts by setting values; keep the rows in step with the selects.
        root.addEventListener('change', event => {
            if (event.target?.id === 'bakemono-memory-turn-summary-source' || event.target?.id === 'bakemono-memory-turn-table-mode') renderWays(getState());
        });
        root.addEventListener('toggle', event => {
            const opened = event.target;
            if (opened?.tagName !== 'DETAILS' || !opened.open || opened.getAttribute('name') !== 'bk-auto-set') return;
            opened.parentElement?.querySelectorAll('details[name="bk-auto-set"][open]').forEach(other => { if (other !== opened) other.open = false; });
        }, true);
    }

    return { render, bind };
}

export { summarySourceLabels };
