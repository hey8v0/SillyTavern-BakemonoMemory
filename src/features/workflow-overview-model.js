export function createWorkflowOverviewModel({
    getState,
    getChat,
    getContext,
    buildFloorMemoryIndex,
    createMemoryOrchestrationPlan,
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    getStageSourceMode,
    getIsBusy,
    isTaskQueueRunning,
    scanBlocks,
    updateInjection,
    saveState,
    renderSettings,
    logWarning,
}) {
    function getMemoryStrategyLabel(strategy = getState().memoryStrategy) {
        return strategy === memoryStrategies.GENERIC ? '补课摘要会临时注入' : '普通摘要不重复注入';
    }

    function getWorkflowModeLabel(mode = getState().workflowMode) {
        if (mode === workflowModes.GENERIC) return '补课旧聊天';
        if (mode === workflowModes.MIXED) return '高级自定义';
        return '已有摘要';
    }

    function getStageSourceModeLabel(mode = getStageSourceMode()) {
        const labels = {
            [stageSourceModes.SUMMARIES]: '读取已有摘要',
            [stageSourceModes.BACKFILL]: '读取补课摘要',
            [stageSourceModes.RAW]: '直接读取正文',
            [stageSourceModes.MIXED]: '摘要和正文都读',
            [stageSourceModes.AUTO]: '自动选择',
        };
        return labels[mode] || labels[stageSourceModes.SUMMARIES];
    }

    function getLegacyOverviewRecommendation(state = getState()) {
        const storySummaries = Array.isArray(state.storySummaries) ? state.storySummaries : [];
        const stageSummaries = Array.isArray(state.stageSummaries) ? state.stageSummaries : [];
        const drafts = Array.isArray(state.drafts) ? state.drafts : [];
        const taskQueue = Array.isArray(state.taskQueue) ? state.taskQueue : [];
        const coveredStoryHashes = new Set(state.coveredBlockHashes || []);
        const coveredStageHashes = new Set(state.coveredStageHashes || []);
        const coveredStoryCount = storySummaries.filter(summary => summary?.hash && coveredStoryHashes.has(summary.hash)).length;
        const uncoveredStoryCount = Math.max(0, storySummaries.length - coveredStoryCount);
        const uncoveredStageCount = stageSummaries.filter(summary => summary?.hash && !coveredStageHashes.has(summary.hash)).length;
        const activeTaskCount = taskQueue.filter(task => ['queued', 'running'].includes(task?.status)).length;
        const progress = storySummaries.length
            ? Math.max(0, Math.min(100, Math.round((coveredStoryCount / storySummaries.length) * 100)))
            : 0;

        if (drafts.length) {
            return {
                stateLabel: '等待确认',
                statusLabel: `${drafts.length.toLocaleString()} 条待办`,
                title: '先确认刚生成的内容',
                copy: '生成结果还没有写入长期记忆，确认后再继续整理。',
                kind: 'nav',
                target: 'drafts',
                buttonLabel: '查看待确认',
                icon: 'fa-inbox',
                progress,
            };
        }

        if (activeTaskCount) {
            return {
                stateLabel: '正在处理',
                statusLabel: `${activeTaskCount.toLocaleString()} 个任务`,
                title: '查看正在处理的任务',
                copy: '任务会在后台继续运行，可以到待确认页查看进度。',
                kind: 'nav',
                target: 'drafts',
                buttonLabel: '查看任务进度',
                icon: 'fa-list-check',
                progress,
            };
        }

        if ((state.workflowMode || workflowModes.BAKEMONO) === workflowModes.GENERIC) {
            const currentFloor = Math.max(0, (Array.isArray(getChat()) ? getChat().length : 1) - 1);
            return {
                stateLabel: '旧聊天补课',
                statusLabel: `${currentFloor.toLocaleString()} 楼`,
                title: '给旧聊天补上记忆',
                copy: '先选择要整理的楼层范围，再让剪辑台分批处理。',
                kind: 'nav',
                target: 'settings',
                buttonLabel: '设置补课范围',
                icon: 'fa-box-archive',
                progress,
            };
        }

        if (!storySummaries.length) {
            return {
                stateLabel: '新聊天',
                statusLabel: '准备开始',
                title: '建立第一段剧情记忆',
                copy: '还没有找到剧情摘要，先扫描一次当前聊天。',
                kind: 'action',
                target: 'scan',
                buttonLabel: '扫描当前聊天',
                icon: 'fa-magnifying-glass',
                progress: 0,
            };
        }

        if (uncoveredStoryCount) {
            return {
                stateLabel: '已有摘要',
                statusLabel: `${uncoveredStoryCount.toLocaleString()} 条待整理`,
                title: '整理下一段长期记忆',
                copy: `${uncoveredStoryCount.toLocaleString()} 条剧情摘要还没有进入阶段记忆。`,
                kind: 'action',
                target: 'generate-stage',
                buttonLabel: '生成阶段总结',
                icon: 'fa-wand-magic-sparkles',
                progress,
            };
        }

        if (uncoveredStageCount >= 2) {
            return {
                stateLabel: '阶段已整理',
                statusLabel: `${uncoveredStageCount.toLocaleString()} 段可汇总`,
                title: '把阶段记忆串成时间线',
                copy: '已有多段阶段记忆，可以继续生成一份多次总结。',
                kind: 'action',
                target: 'generate-epic',
                buttonLabel: '生成多次总结',
                icon: 'fa-layer-group',
                progress: 100,
            };
        }

        return {
            stateLabel: '进度正常',
            statusLabel: '已经同步',
            title: '继续整理这段剧情',
            copy: '已识别的摘要都已收入长期记忆，可以扫描最新楼层。',
            kind: 'action',
            target: 'scan',
            buttonLabel: '扫描最新剧情',
            icon: 'fa-magnifying-glass',
            progress: 100,
        };
    }

    function getCurrentFloorMemoryIndex(state = getState()) {
        const context = getContext();
        return buildFloorMemoryIndex({
            messages: context?.chat || getChat() || [],
            state,
        });
    }

    function getMemoryOrchestrationPlan(state = getState(), index = getCurrentFloorMemoryIndex(state)) {
        return createMemoryOrchestrationPlan(index, state, { busy: getIsBusy() || isTaskQueueRunning() });
    }

    function getOverviewRecommendation(state = getState(), index = getCurrentFloorMemoryIndex(state)) {
        try {
            return getMemoryOrchestrationPlan(state, index).recommendation;
        } catch (error) {
            logWarning('[BakemonoMemory] floor memory planning failed, using summary fallback', error);
            return getLegacyOverviewRecommendation(state);
        }
    }

    function applyWorkflowPreset(mode) {
        const state = getState();
        if (mode === workflowModes.MIXED) {
            state.workflowMode = workflowModes.MIXED;
            state.stageSourceMode = stageSourceModes.AUTO;
            state.outputMode = 'custom';
        } else if (mode === workflowModes.GENERIC) {
            state.workflowMode = workflowModes.GENERIC;
            state.memoryStrategy = memoryStrategies.GENERIC;
            state.stageSourceMode = stageSourceModes.BACKFILL;
            state.outputMode = 'plain';
        } else {
            state.workflowMode = workflowModes.BAKEMONO;
            state.memoryStrategy = memoryStrategies.BAKEMONO;
            state.stageSourceMode = stageSourceModes.SUMMARIES;
            state.outputMode = 'bakemono';
        }

        scanBlocks({ persist: false });
        updateInjection();
        saveState();
        renderSettings(`已切换到：${getWorkflowModeLabel(state.workflowMode)}。扫描、自动总结和提示词配置已保留。`);
    }

    function getOverviewHealth(floorStats, state = getState()) {
        if (!state.injection?.enabled) {
            return { badge: '注入关闭', title: '长期记忆暂未注入', copy: '已保存内容仍保留在档案中，不会发送给模型。', tone: 'paused' };
        }
        if (floorStats.pendingDraftCount) {
            return { badge: `${floorStats.pendingDraftCount.toLocaleString()} 条待确认`, title: '有内容等待确认', copy: '草稿尚未写入长期记忆，现有已确认内容仍正常注入。', tone: 'attention' };
        }
        if (floorStats.activeTaskCount || getIsBusy() || isTaskQueueRunning()) {
            return { badge: '正在处理', title: '记忆正在整理', copy: '后台任务完成后，这里的覆盖状态会自动更新。', tone: 'working' };
        }
        if (!floorStats.total) {
            return { badge: '等待正文', title: '等待聊天内容', copy: '当前聊天还没有可整理的助手正文。', tone: 'idle' };
        }
        if (!floorStats.summarized) {
            return { badge: '等待记忆', title: '尚未建立剧情记忆', copy: `${floorStats.missing.toLocaleString()} 楼正文还没有识别为可用记忆。`, tone: 'attention' };
        }
        if (floorStats.missing) {
            return { badge: '运行正常', title: '记忆链路运行正常', copy: `最近 ${floorStats.missing.toLocaleString()} 楼尚未整理；已有内容仍正常注入。`, tone: 'healthy' };
        }
        return { badge: '已同步', title: '现有记忆已经同步', copy: '当前可识别楼层均已有记忆记录。', tone: 'healthy' };
    }

    function getWorkflowStatusText(state = getState(), stats, uncoveredStory = 0) {
        if (state.workflowMode === workflowModes.GENERIC) {
            return `补课模式：未被阶段总结覆盖的补课摘要会临时注入。当前注入普通摘要 ${stats.story} 个，待压缩摘要 ${uncoveredStory} 个。`;
        }
        if (state.workflowMode === workflowModes.MIXED) {
            return '高级模式：请先确认扫描预览和阶段材料来源，再生成总结。';
        }
        return uncoveredStory
            ? `已有摘要模式：普通摘要不会重复注入。当前有 ${uncoveredStory} 个摘要可用于生成阶段总结。`
            : '已有摘要模式：适合配合正文摘要正则使用，普通摘要不重复占用 token。';
    }

    return {
        applyWorkflowPreset,
        getCurrentFloorMemoryIndex,
        getMemoryOrchestrationPlan,
        getMemoryStrategyLabel,
        getOverviewHealth,
        getOverviewRecommendation,
        getStageSourceModeLabel,
        getWorkflowModeLabel,
        getWorkflowStatusText,
    };
}
