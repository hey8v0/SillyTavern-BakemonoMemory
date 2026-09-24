export const turnSummaryTriggerTimings = Object.freeze({
    IMMEDIATE: 'immediate',
    NEXT_USER: 'next_user',
});

export function summarySourceChoice(state) {
    if (state.turnSummary?.enabled && state.turnSummary.processingMode === 'table') return 'legacy';
    if (state.inlineGeneration?.summaryEnabled) return state.turnSummary?.enabled ? 'legacy' : 'inline';
    if (!state.turnSummary?.enabled) return 'existing';
    return state.turnSummary.auto ? 'independent' : 'manual';
}

export function applySummarySourceChoice(state, choice) {
    if (!['existing', 'inline', 'independent', 'manual'].includes(choice)) return;
    const changed = choice !== summarySourceChoice(state);
    state.turnSummary.enabled = ['independent', 'manual'].includes(choice);
    state.inlineGeneration.summaryEnabled = choice === 'inline';
    if (state.turnSummary.enabled) {
        state.turnSummary.auto = choice === 'independent';
        if (changed && state.turnSummary.processingMode === 'table') state.turnSummary.processingMode = 'both';
    }
    if (changed) {
        state.stageSourceMode = state.turnSummary.enabled ? 'backfill' : 'summaries';
        delete state.turnSummary.lastRun;
    }
}

export function normalizeTurnSummaryTriggerTiming(value) {
    return value === turnSummaryTriggerTimings.NEXT_USER
        ? turnSummaryTriggerTimings.NEXT_USER
        : turnSummaryTriggerTimings.IMMEDIATE;
}

export function shouldRunTurnProcessing(turnSummary = {}, trigger = 'assistant') {
    const timing = normalizeTurnSummaryTriggerTiming(turnSummary?.triggerTiming);
    return timing === turnSummaryTriggerTimings.NEXT_USER
        ? trigger === 'user'
        : trigger === 'assistant';
}

