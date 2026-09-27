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

// Where summaries live decides how they are gathered and injected. Summaries
// written into replies are already in the chat, so only plugin-stored ones
// (independent/manual) are injected until a stage summary covers them.
export function workflowForSummarySource(choice) {
    return ['independent', 'manual'].includes(choice)
        ? { workflowMode: 'generic', memoryStrategy: 'generic', stageSourceMode: 'backfill', outputMode: 'plain' }
        : { workflowMode: 'bakemono', memoryStrategy: 'bakemono', stageSourceMode: 'summaries', outputMode: 'bakemono' };
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


// How tables are filled each turn, read from the existing flags: written into the reply, a separate request after
// the reply (turn processing with tables), or only when asked on the 表格 page.
export function tableModeChoice(state) {
    if (state.inlineGeneration?.tableEnabled) return 'inline';
    const turn = state.turnSummary || {};
    if (state.tableDatabase?.enabled && turn.auto && turn.processingMode !== 'summary') return 'after';
    return 'manual';
}

// A separate table request rides on automatic turn processing, which a manual summary source turns off.
export function tableModeAvailable(state, choice) {
    return choice !== 'after' || !(state.turnSummary?.enabled && !state.turnSummary?.auto);
}

// Call after the summary source is applied. Never produces the legacy "tables only" processing mode.
export function applyTableModeChoice(state, choice) {
    if (!['inline', 'after', 'manual'].includes(choice)) return;
    if (!tableModeAvailable(state, choice)) choice = 'manual';
    const turn = state.turnSummary;
    state.inlineGeneration.tableEnabled = choice === 'inline';
    if (choice === 'after') {
        state.tableDatabase.enabled = true;
        if (!turn.enabled) turn.auto = true;
        turn.processingMode = 'both';
    } else if (turn.enabled) {
        turn.processingMode = 'summary';
    } else {
        turn.auto = false;
        if (turn.processingMode === 'table') turn.processingMode = 'both';
    }
}
