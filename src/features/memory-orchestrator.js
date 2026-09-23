export function createMemoryOrchestrator({
    ensureState,
    isBusy,
    scanBakemonoBlocks,
    getUnsummarizedStoryBlocks,
    getStageSourceMode,
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
    shouldRunTurnProcessing,
    rpExtractionFlow,
} = {}) {
    const pendingAutoSummaries = new WeakSet();
    async function runRp(method) {
        try { return await rpExtractionFlow?.[method]?.(); }
        catch (error) {
            if (/变化|停止/.test(error.message)) throw error;
            toastr?.warning?.('剧情状态未更新：' + error.message, '剧情剪辑台'); return null;
        }
    }
    async function maybeRunAutoSummary() {
        const state = ensureState();
        if (!state.automation.enabled || isBusy() || pendingAutoSummaries.has(state)) {
            return;
        }
    
        scanBakemonoBlocks({ persist: false });
        const targets = getUnsummarizedStoryBlocks();
        if (!targets.length) {
            return;
        }
    
        const signature = getHash(JSON.stringify({
            sources: targets.map(block => block.hash),
            sourceMode: getStageSourceMode(state),
            mode: state.automation.mode || defaultAutomation.mode,
            trigger: state.automation.triggerType || defaultAutomation.triggerType,
            threshold: state.automation.triggerType === 'chars'
                ? state.automation.charInterval || defaultAutomation.charInterval
                : state.automation.floorInterval || defaultAutomation.floorInterval,
        }));
        if (signature === state.automation.lastSignature) {
            return;
        }
    
        const shouldTrigger = isAutoThresholdReached(targets);
        if (!shouldTrigger) {
            return;
        }
    
        pendingAutoSummaries.add(state);
        try {
            if (state.automation.mode === 'draft' || state.automation.mode === 'commit_hide') {
                const task = await generateStageDraft({ automatic: true });
                // Validation/refusal before enqueue must not consume this trigger.
                if (!task || ensureState() !== state) return;
            } else {
                renderWorkbenchScope(workbenchRenderScopes.AUTOMATION, `自动总结提醒：已有 ${targets.length} 个未总结片段。`);
                toastr.info('已达到自动总结条件，可以生成阶段总结草稿。', '剧情剪辑台');
            }
            state.automation.lastSignature = signature;
            saveState();
        } finally {
            pendingAutoSummaries.delete(state);
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
        await runRp('reconcilePending');
        if (ensureState() !== state) return;
        let floorIndex = getCurrentFloorMemoryIndex(state);
        let plan = getMemoryOrchestrationPlan(state, floorIndex);
        const turnTrigger = options.turnTrigger || 'assistant';
        const triggerMatches = shouldRunTurnProcessing?.(state.turnSummary, turnTrigger) !== false;

        if (options.turnOnly) {
            await runRp('runIndependent');
            await runRp('captureInline');
            if (ensureState() !== state) return { index: floorIndex, plan };
            if (triggerMatches) await maybeRunTurnSummary();
            syncInjection();
            if (options.render) scheduleRenderAll();
            return { index: floorIndex, plan };
        }
    
        if (options.captureInline !== false && plan.actions.captureInline) {
            await captureInlineGenerationFromLatestMessage();
        }
        if (options.captureInline !== false) await runRp('captureInline');
        if (ensureState() !== state) return { index: floorIndex, plan };
        if (options.scheduleInlineCapture) {
            scheduleInlineGenerationCapture(reason);
            rpExtractionFlow?.scheduleCapture?.({ independent: true });
        }
        await runRp('runIndependent');
        if (ensureState() !== state) return { index: floorIndex, plan };
    
        state = ensureState();
        floorIndex = getCurrentFloorMemoryIndex(state);
        plan = getMemoryOrchestrationPlan(state, floorIndex);
        if (plan.actions.processLatestTurn && triggerMatches) {
            await maybeRunTurnSummary();
        } else if (plan.actions.processLatestTableOnly && triggerMatches) {
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
