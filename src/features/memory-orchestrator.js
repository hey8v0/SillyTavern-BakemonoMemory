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
    isChatReady = () => true,
    // 剧情事实: a message resets its idle timer; after the per-turn work it may consolidate a batch of summaries.
    noteFactsActivity = () => {},
    consolidateFacts = () => {},
} = {}) {
    const pendingAutoSummaries = new WeakSet();
    async function maybeRunAutoSummary() {
        if (!isChatReady()) return;
        const state = ensureState();
        if (!state.automation.enabled || isBusy() || pendingAutoSummaries.has(state)) {
            return;
        }

        scanBakemonoBlocks({ persist: false });
        const targets = getUnsummarizedStoryBlocks({ newOnly: true });
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

    // Per-turn work is the summary only; facts are consolidated per stage (see facts-controller).
    async function maybeRunTurnSummary() {
        const state = ensureState();
        if (!state.turnSummary.auto || !state.turnSummary.enabled || isBusy()) {
            return;
        }
        await processLatestTurnSummary({ manual: false });
    }

    async function runMemoryOrchestrator(reason = '更新', options = {}) {
        // A chat SillyTavern is still reading has nothing to process, and nothing may be saved into it.
        if (!isChatReady()) return {};
        if (options.scan !== false) {
            scanBakemonoBlocks({ persist: false, render: false });
        }
        noteFactsActivity();
        let state = ensureState();
        let floorIndex = getCurrentFloorMemoryIndex(state);
        let plan = getMemoryOrchestrationPlan(state, floorIndex);
        const turnTrigger = options.turnTrigger || 'assistant';
        const triggerMatches = shouldRunTurnProcessing?.(state.turnSummary, turnTrigger) !== false;

        if (options.turnOnly) {
            if (triggerMatches) await maybeRunTurnSummary();
            if (ensureState() === state) await consolidateFacts();
            syncInjection();
            if (options.render) scheduleRenderAll();
            return { index: floorIndex, plan };
        }

        if (options.captureInline !== false && plan.actions.captureInline) {
            await captureInlineGenerationFromLatestMessage();
        }
        if (ensureState() !== state) return { index: floorIndex, plan };
        if (options.scheduleInlineCapture) {
            scheduleInlineGenerationCapture(reason);
        }

        state = ensureState();
        floorIndex = getCurrentFloorMemoryIndex(state);
        plan = getMemoryOrchestrationPlan(state, floorIndex);
        if (plan.actions.processLatestTurn && triggerMatches) {
            await maybeRunTurnSummary();
        }

        state = ensureState();
        floorIndex = getCurrentFloorMemoryIndex(state);
        plan = getMemoryOrchestrationPlan(state, floorIndex);
        if (plan.actions.runStageAutomation) {
            await maybeRunAutoSummary();
        }
        if (ensureState() === state) await consolidateFacts();
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
