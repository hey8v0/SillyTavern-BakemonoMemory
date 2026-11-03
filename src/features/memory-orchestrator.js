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
    // 剧情事实: a message resets its idle timer (`noteFactsActivity`); a run that is not a message (a return to the
    // foreground, a reload) only checks whether the idle time has passed (`resumeFacts`). After the per-turn work
    // either may consolidate a batch of summaries.
    noteFactsActivity = () => {},
    resumeFacts = () => {},
    consolidateFacts = () => {},
    getUnsummarizedStageBlocks = () => [],
    generateEpicDraft = async () => null,
    // Chapters in story order (summary/target-selection.js).
    getSortedTargetBlocks = blocks => [...blocks],
} = {}) {
    const pendingAutoSummaries = new WeakSet();
    const pendingAutoEpics = new WeakSet();
    // Chapters no 多次总结 covers pile up with the chat. At `epicAfterStages` the older ones are offered as one, the way
    // a 阶段总结 is offered: a reminder, or a draft that waits for the user. The latest two stay for their detail.
    const epicKeepRecent = 2;
    async function maybeRunAutoEpic() {
        if (!isChatReady()) return;
        const state = ensureState();
        if (!state.automation?.enabled || state.automation.epicEnabled === false || isBusy() || pendingAutoEpics.has(state)) return;
        const after = Math.max(3, Math.min(50, Math.round(Number(state.automation.epicAfterStages)) || 6));
        const stages = getSortedTargetBlocks(getUnsummarizedStageBlocks() || []);
        if (stages.length < after) return;
        const older = stages.slice(0, stages.length - epicKeepRecent);
        const mode = state.automation.mode || defaultAutomation.mode;
        const signature = getHash(JSON.stringify({ epic: older.map(block => block.hash), mode }));
        if (signature === state.automation.lastEpicSignature) return;
        pendingAutoEpics.add(state);
        try {
            if (mode === 'draft' || mode === 'commit_hide') {
                const task = await generateEpicDraft({ automatic: true, targetConfig: { mode: 'oldest', count: older.length } });
                if (!task || ensureState() !== state) return;
            } else {
                renderWorkbenchScope(workbenchRenderScopes.AUTOMATION, `自动总结提醒：已有 ${stages.length} 段阶段总结没有合并成多次总结。`);
                toastr.info(`阶段总结攒了 ${stages.length} 段，可以把最早的 ${older.length} 段合并成多次总结。`, '剧情剪辑台');
            }
            state.automation.lastEpicSignature = signature;
            saveState();
        } finally {
            pendingAutoEpics.delete(state);
        }
    }
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
        // Messages are activity; a resume (`activity: false`) is not, or the idle 整理 would never come.
        if (options.activity === false) resumeFacts();
        else noteFactsActivity();
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
        if (ensureState() === state) await maybeRunAutoEpic();
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
        maybeRunAutoEpic,
        maybeRunAutoSummary,
        maybeRunTurnSummary,
        runMemoryOrchestrator,
    };
}
