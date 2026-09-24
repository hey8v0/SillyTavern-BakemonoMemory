import { summarySourceChoice } from './turn-trigger-policy.js';

export function syncSummarySourceControls(query, choice) {
    query('#bakemono-memory-turn-trigger-timing').prop('disabled', !['independent', 'legacy'].includes(choice));
    query('#bakemono-memory-turn-auto-save').prop('disabled', !['independent', 'manual', 'legacy'].includes(choice));
}

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
}) {
    function setFlowStep(selector, status) {
        const element = documentRef.querySelector(selector);
        if (!element) return;
        element.classList.toggle('is-done', status === 'done');
        element.classList.toggle('is-current', status === 'current');
        element.classList.toggle('is-waiting', status === 'waiting');
    }

    function render(state = getState()) {
        query('#bakemono-memory-turn-source').val(summarySourceChoice(state));
        syncSummarySourceControls(query, summarySourceChoice(state));
        query('#bakemono-memory-turn-trigger-timing').val(state.turnSummary.triggerTiming === 'next_user' ? 'next_user' : 'immediate');
        query('#bakemono-memory-turn-processing-mode').val(state.turnSummary.processingMode || turnProcessingModes.BOTH);
        query('#bakemono-memory-turn-auto-save').prop('checked', state.turnSummary.saveMode === 'commit');
        query('#bakemono-memory-turn-include-user').prop('checked', state.turnSummary.includeUserMessage !== false);
        query('#bakemono-memory-turn-include-character').prop('checked', state.turnSummary.includeCharacterContext !== false);
        query('#bakemono-memory-turn-include-world-info').prop('checked', !!state.turnSummary.includeWorldInfo);
        query('#bakemono-memory-turn-world-max-context').val(state.turnSummary.worldInfoMaxContext ?? defaultState.turnSummary.worldInfoMaxContext);
        query('#bakemono-memory-turn-include-tags').val(state.turnSummary.includeTags || '');
        query('#bakemono-memory-turn-exclude-tags').val(state.turnSummary.excludeTags || '');
        query('#bakemono-memory-turn-reference').val(state.turnSummary.referenceContext || '');
        query('#bakemono-memory-table-enabled').prop('checked', !!state.tableDatabase.enabled);
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
        renderTableProfileControls(state);

        query('#bakemono-memory-turn-prompt').val(state.turnSummary.prompt || defaultTurnSummaryPrompt);
        query('#bakemono-memory-table-prompt').val(state.turnSummary.tablePrompt || defaultTableEditPrompt);
        query('#bakemono-memory-inline-table-enabled').prop('checked', !!state.inlineGeneration.tableEnabled);
        query('#bakemono-memory-inline-hide-table').prop('checked', state.inlineGeneration.hideTableEdit !== false);
        query('#bakemono-memory-inline-summary-prompt').val(state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt);
        query('#bakemono-memory-inline-table-prompt').val(state.inlineGeneration.tablePrompt || defaultInlineTablePrompt);
        renderInlinePromptPresetControls('summary', '#bakemono-memory-inline-summary-preset-select', '#bakemono-memory-inline-summary-preset-name');
        renderInlinePromptPresetControls('table', '#bakemono-memory-inline-table-preset-select', '#bakemono-memory-inline-table-preset-name');

        const lastId = state.turnSummary.lastProcessedMessageId;
        const hasProcessedTurn = lastId !== null && lastId !== undefined;
        const turnEnabled = !!state.turnSummary.enabled;
        const turnAuto = !!state.turnSummary.auto;
        const tableEnabled = !!state.tableDatabase.enabled;
        const delayed = state.turnSummary.triggerTiming === 'next_user';
        const lastRun = state.turnSummary.lastRun;
        const runtimeLabel = !turnEnabled ? state.inlineGeneration.summaryEnabled ? '随正文生成摘要' : '读取已有摘要'
            : turnAuto ? delayed ? '自动处理 · 下一轮开始时' : '自动处理 · 回复结束后' : '仅手动处理';
        const runtimeTitle = lastRun?.status === 'running' ? '正在生成第 ' + lastRun.messageId + ' 楼摘要'
            : lastRun?.status === 'failed' ? '第 ' + lastRun.messageId + ' 楼摘要失败'
            : hasProcessedTurn ? `第 ${lastId} 楼已处理` : '等待正文';
        const summaryDestination = state.turnSummary.saveMode === 'commit' ? '已直接写入长期记忆' : '摘要会先进入待确认';
        const tableDestination = tableEnabled
            ? tableDraftOperationCount ? `表格还有 ${tableDraftOperationCount} 处差异等待确认` : '表格没有待处理差异'
            : '本轮未启用表格更新';
        query('#bakemono-memory-turn-runtime-label').text(runtimeLabel);
        query('#bakemono-memory-turn-runtime-title').text(runtimeTitle);
        query('#bakemono-memory-turn-status').text(lastRun?.status === 'failed' ? lastRun.error : turnEnabled && !turnAuto ? '点击“处理最新正文”时执行。' : hasProcessedTurn
            ? `${summaryDestination}；${tableDestination}。`
            : turnEnabled
                ? delayed ? '下一轮 user 消息发出后，会处理上一条已完成回复。' : '下一次正文结束后会立即按当前设置生成摘要。'
                : '从回复中的摘要标签读取。');
        query('.bakemono-memory-turn-status-hero').toggleClass('is-running', lastRun?.status === 'running');

        setFlowStep('#bakemono-memory-turn-flow-read', hasProcessedTurn ? 'done' : turnEnabled ? 'current' : 'waiting');
        setFlowStep('#bakemono-memory-turn-flow-summary', hasProcessedTurn && state.turnSummary.processingMode !== turnProcessingModes.TABLE ? 'done' : 'waiting');
        setFlowStep('#bakemono-memory-turn-flow-table', tableDraftOperationCount ? 'current' : hasProcessedTurn && tableEnabled ? 'done' : 'waiting');
        query('#bakemono-memory-turn-flow-status').text(tableDraftOperationCount
            ? `待确认 ${tableDraftOperationCount} 处`
            : lastRun?.status === 'failed' ? '处理失败' : hasProcessedTurn ? '本轮已完成' : turnEnabled ? turnAuto ? '等待下一轮' : '仅手动处理' : '读取正文摘要');
        renderTableList(state);
        renderTableEditDrafts(state);
    }

    return { render };
}
