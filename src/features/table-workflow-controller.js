export function createTableWorkflowController({
    getState: ensureState,
    findLatestAssistantTurn,
    toastr,
    buildLatestTurnBlocks,
    runGeneration,
    callGenerationModel,
    buildTableEditPrompt,
    buildTurnReferenceSystemPrompt,
    createTableEditDraft,
    saveState,
    saveChatConditional = async () => {},
    renderWorkbenchScope,
    workbenchRenderScopes,
    applyTableOperations,
    formatSourceRange,
    switchWorkbenchTab,
} = {}) {
    async function processLatestTableEdit(options = {}) {
        const state = ensureState();
        const turn = findLatestAssistantTurn();
        if (!turn) {
            toastr.info('没有找到可处理的最新正文。');
            return;
        }
        if (!options.manual && state.turnSummary.lastProcessedMessageId === turn.assistantMessage.messageId) {
            return;
        }
        if (!options.manual && (state.tableDatabase.editDrafts || []).some(draft => (
            (draft.sourceMessageIds || []).some(id => Number(id) === Number(turn.assistantMessage.messageId))
        ))) {
            state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
            saveState();
            await saveChatConditional();
            return;
        }
        const blocks = buildLatestTurnBlocks(state);
        if (!blocks.length) {
            toastr.info('没有找到可处理的最新正文。');
            return;
        }
        if (!state.tableDatabase.tables.length) {
            toastr.warning('还没有表格。请先创建或导入表格。');
            return;
        }
    
        await runGeneration(options.manual ? '正在单独生成表格修改草稿...' : '正在自动生成表格修改草稿...', async () => {
            const tableResult = await callGenerationModel({
                prompt: buildTableEditPrompt(blocks, state),
                systemPrompt: await buildTurnReferenceSystemPrompt(blocks, 'table', state),
            });
            const draft = createTableEditDraft(tableResult, blocks, state);
            if (!draft) {
                state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
                saveState();
                await saveChatConditional();
                renderWorkbenchScope(workbenchRenderScopes.TABLES, '本轮正文没有生成表格修改。');
                toastr.info('本轮正文没有需要修改的表格。');
                return;
            }
            if (state.tableDatabase.autoApply && !options.manual) {
                const undoSnapshot = applyTableOperations(draft.operations, state, {
                    sourceMessageIds: draft.sourceMessageIds,
                    undoLabel: `回复后表格修改：${formatSourceRange(draft.sourceMessageIds || [])}`,
                });
                state.tableDatabase.history.unshift({ ...draft, appliedAt: new Date().toISOString(), undoSnapshotId: undoSnapshot?.id || '' });
                state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draft.id);
                state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
                saveState();
                await saveChatConditional();
                renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格修改已自动应用。');
                return;
            }
            state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
            saveState();
            await saveChatConditional();
            renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格修改草稿已生成，请确认后应用。');
            switchWorkbenchTab('tables');
        }, '表格修改草稿已生成', workbenchRenderScopes.TABLES);
    }

    return { processLatestTableEdit };
}
