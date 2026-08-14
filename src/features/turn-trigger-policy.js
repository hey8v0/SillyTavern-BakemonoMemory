export const turnSummaryTriggerTimings = Object.freeze({
    IMMEDIATE: 'immediate',
    NEXT_USER: 'next_user',
});

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

