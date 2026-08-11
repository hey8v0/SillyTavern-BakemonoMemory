export function createMemoryOrchestrator({
    ensureState,
    isBusy,
    scanBakemonoBlocks,
    getUnsummarizedStoryBlocks,
    getHash,
    saveState,
    defaultAutomation,
    toastr,
    renderWorkbenchScope,
    workbenchRenderScopes,
    generateStageDraft,
    turnProcessingModes,
    processLatestTableEdit,
    processLatestTurnSummary,
    getCurrentFloorMemoryIndex,
    getMemoryOrchestrationPlan,
    captureInlineGenerationFromLatestMessage,
    scheduleInlineGenerationCapture,
    scheduleAutoHideRecent,
    markVectorIndexDirty,
    scheduleVectorAutoIndex,
    syncInjection,
    scheduleRenderAll,
} = {}) {
    async function maybeRunAutoSummary() {
        const state = ensureState();
        if (!state.automation.enabled || isBusy()) {
            return;
        }
    
        scanBakemonoBlocks({ persist: false });
        const targets = getUnsummarizedStoryBlocks();
        if (!targets.length) {
            return;
        }
    
        const signature = getHash(targets.map(block => block.hash).join('|'));
        if (signature === state.automation.lastSignature) {
            return;
        }
    
        const shouldTrigger = isAutoThresholdReached(targets);
        if (!shouldTrigger) {
            return;
        }
    
        state.automation.lastSignature = signature;
        saveState();
        if (state.automation.mode === 'draft' || state.automation.mode === 'commit_hide') {
            const modeLabel = state.automation.mode === 'commit_hide'
                ? `自动总结：正在生成草稿，完成后会自动保存长期记忆并隐藏已覆盖楼层，保留最近 ${state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent} 楼。`
                : '自动总结：正在生成阶段总结草稿。';
            toastr.info(modeLabel, '剧情剪辑台');
            renderWorkbenchScope(workbenchRenderScopes.AUTOMATION, modeLabel);
            await generateStageDraft({ automatic: true });
        } else {
            renderWorkbenchScope(workbenchRenderScopes.AUTOMATION, `自动总结提醒：已有 ${targets.length} 个未总结片段。`);
            toastr.info('已达到自动总结条件，可以生成阶段总结草稿。', '剧情剪辑台');
        }
    }
    
    async function maybeRunTurnSummary() {
        const state = ensureState();
        if (!state.turnSummary.auto || isBusy()) {
            return;
        }
        const mode = state.turnSummary.processingMode || turnProcessingModes.BOTH;
        if (mode === turnProcessingModes.TABLE) {
            if (state.tableDatabase.enabled && state.tableDatabase.tables.length) {
                await processLatestTableEdit({ manual: false });
            }
        } else if (state.turnSummary.enabled) {
            await processLatestTurnSummary({ manual: false });
        } else if (state.tableDatabase.enabled && state.tableDatabase.tables.length) {
            await processLatestTableEdit({ manual: false });
        }
    }
    
    async function runMemoryOrchestrator(reason = '更新', options = {}) {
        if (options.scan !== false) {
            scanBakemonoBlocks({ persist: false, render: false });
        }
        let state = ensureState();
        let floorIndex = getCurrentFloorMemoryIndex(state);
        let plan = getMemoryOrchestrationPlan(state, floorIndex);
    
        if (options.captureInline !== false && plan.actions.captureInline) {
            await captureInlineGenerationFromLatestMessage();
        }
        if (options.scheduleInlineCapture) {
            scheduleInlineGenerationCapture(reason);
        }
    
        state = ensureState();
        floorIndex = getCurrentFloorMemoryIndex(state);
        plan = getMemoryOrchestrationPlan(state, floorIndex);
        if (plan.actions.processLatestTurn) {
            await maybeRunTurnSummary();
        } else if (plan.actions.processLatestTableOnly) {
            await processLatestTableEdit({ manual: false });
        }
    
        state = ensureState();
        floorIndex = getCurrentFloorMemoryIndex(state);
        plan = getMemoryOrchestrationPlan(state, floorIndex);
        if (plan.actions.runStageAutomation) {
            await maybeRunAutoSummary();
        }
        if (plan.actions.balanceHiddenFloors) {
            scheduleAutoHideRecent(reason);
        }
        if (options.vectorDirtyReason) {
            markVectorIndexDirty(options.vectorDirtyReason, state);
        } else if (plan.actions.refreshVectorIndex) {
            scheduleVectorAutoIndex(reason);
        }
    
        syncInjection();
        if (options.render) scheduleRenderAll();
        return { index: floorIndex, plan };
    }
    
    function isAutoThresholdReached(targets) {
        const state = ensureState();
        if (state.automation.triggerType === 'chars') {
            const totalLength = targets.reduce((sum, block) => sum + String(block.content || '').length, 0);
            return totalLength >= Number(state.automation.charInterval || defaultAutomation.charInterval);
        }
        return targets.length >= Number(state.automation.floorInterval || defaultAutomation.floorInterval);
    }

    return {
        isAutoThresholdReached,
        maybeRunAutoSummary,
        maybeRunTurnSummary,
        runMemoryOrchestrator,
    };
}
