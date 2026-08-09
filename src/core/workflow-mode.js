export const memoryStrategies = {
    BAKEMONO: 'bakemono',
    GENERIC: 'generic',
};

export const workflowModes = {
    BAKEMONO: 'bakemono',
    GENERIC: 'generic',
    MIXED: 'mixed',
};

export const stageSourceModes = {
    SUMMARIES: 'summaries',
    BACKFILL: 'backfill',
    RAW: 'raw',
    MIXED: 'mixed',
    AUTO: 'auto',
};

export const outputModes = {
    BAKEMONO: 'bakemono',
    PLAIN: 'plain',
    CUSTOM: 'custom',
};

export function normalizeWorkflowState(state) {
    if (!Object.values(memoryStrategies).includes(state.memoryStrategy)) {
        state.memoryStrategy = memoryStrategies.BAKEMONO;
    }
    if (!Object.values(workflowModes).includes(state.workflowMode)) {
        state.workflowMode = state.memoryStrategy === memoryStrategies.GENERIC
            ? workflowModes.GENERIC
            : workflowModes.BAKEMONO;
    }
    if (!Object.values(stageSourceModes).includes(state.stageSourceMode)) {
        state.stageSourceMode = state.workflowMode === workflowModes.GENERIC
            ? stageSourceModes.BACKFILL
            : stageSourceModes.SUMMARIES;
    }
    if (!Object.values(outputModes).includes(state.outputMode)) {
        state.outputMode = state.workflowMode === workflowModes.GENERIC
            ? outputModes.PLAIN
            : outputModes.BAKEMONO;
    }
    return state;
}
