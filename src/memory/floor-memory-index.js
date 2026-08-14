import { getHash } from '../shared/text.js';

function finiteIds(values = []) {
    return [...new Set((Array.isArray(values) ? values : [values])
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value >= 0))];
}

function sourceIds(item = {}) {
    return finiteIds([
        item.messageId,
        ...(Array.isArray(item.sourceMessageIds) ? item.sourceMessageIds : []),
    ]);
}

function addToFloors(floors, ids, apply) {
    for (const id of finiteIds(ids)) {
        const floor = floors.get(id);
        if (floor) apply(floor);
    }
}

function addUnique(target, value) {
    if (value && !target.includes(value)) target.push(value);
}

export function buildFloorMemoryIndex({ messages = [], state = {} } = {}) {
    const hiddenIds = new Set(finiteIds([
        ...(state.hiddenMessageIds || []),
        ...(state.customHiddenMessageIds || []),
        ...(state.autoHideRecent?.managedMessageIds || []),
    ]));
    const floors = new Map();

    (Array.isArray(messages) ? messages : []).forEach((message, id) => {
        const text = String(message?.mes || '');
        const isManagedHidden = hiddenIds.has(id);
        if (!text.trim() || message?.is_user || (message?.is_system && !isManagedHidden)) return;
        floors.set(id, {
            id,
            fingerprint: getHash(`${id}|${message?.swipe_id ?? message?.swipeId ?? ''}|${text}`),
            hidden: !!message?.is_system || isManagedHidden,
            summaryState: 'missing',
            summarySources: [],
            coveredBy: [],
            tableState: 'none',
            tableDraftCount: 0,
            tableAppliedCount: 0,
            vectorState: state.vectorMemory?.enabled ? (state.vectorMemory?.dirty ? 'pending' : 'missing') : 'off',
            vectorRecordCount: 0,
        });
    });

    const coveredHashes = new Set(state.coveredBlockHashes || []);
    const blockIdsByHash = new Map();
    for (const block of state.blocks || []) {
        const ids = sourceIds(block);
        if (block?.hash) blockIdsByHash.set(block.hash, ids);
        addToFloors(floors, ids, floor => {
            if (block.sourceKind !== 'raw' && floor.summaryState === 'missing') {
                floor.summaryState = coveredHashes.has(block.hash) ? 'covered' : 'saved';
            }
            if (block.sourceKind !== 'raw' && coveredHashes.has(block.hash)) floor.summaryState = 'covered';
            addUnique(floor.summarySources, block.sourceKind === 'raw' ? '正文扫描' : '摘要块');
        });
    }

    for (const summary of state.storySummaries || []) {
        addToFloors(floors, sourceIds(summary), floor => {
            floor.summaryState = coveredHashes.has(summary?.hash) ? 'covered' : 'saved';
            addUnique(floor.summarySources, summary?.sourceKind === 'backfill' ? '补课摘要' : '已保存摘要');
        });
    }

    for (const stage of state.stageSummaries || []) {
        const ids = new Set(sourceIds(stage));
        for (const hash of stage?.sourceHashes || []) {
            for (const id of blockIdsByHash.get(hash) || []) ids.add(id);
        }
        addToFloors(floors, [...ids], floor => {
            if (floor.summaryState !== 'missing') floor.summaryState = 'covered';
            addUnique(floor.coveredBy, stage?.title || '阶段总结');
        });
    }

    for (const draft of state.drafts || []) {
        addToFloors(floors, sourceIds(draft), floor => {
            if (floor.summaryState === 'missing') floor.summaryState = 'draft';
            addUnique(floor.summarySources, draft?.trigger === 'auto' ? '自动草稿' : '待确认草稿');
        });
    }

    for (const draft of state.tableDatabase?.editDrafts || []) {
        addToFloors(floors, sourceIds(draft), floor => {
            floor.tableState = floor.tableState === 'applied' ? 'applied' : 'draft';
            floor.tableDraftCount += 1;
        });
    }
    for (const history of state.tableDatabase?.history || []) {
        if (!history?.appliedAt) continue;
        addToFloors(floors, sourceIds(history), floor => {
            floor.tableState = 'applied';
            floor.tableAppliedCount += 1;
        });
    }

    for (const record of state.vectorMemory?.records || []) {
        addToFloors(floors, sourceIds(record), floor => {
            floor.vectorState = state.vectorMemory?.dirty ? 'pending' : 'indexed';
            floor.vectorRecordCount += 1;
        });
    }

    const records = [...floors.values()].sort((a, b) => a.id - b.id);
    const count = predicate => records.filter(predicate).length;
    const summarized = count(floor => ['saved', 'covered'].includes(floor.summaryState));
    const covered = count(floor => floor.summaryState === 'covered');
    const missing = count(floor => floor.summaryState === 'missing');
    const summaryDrafts = count(floor => floor.summaryState === 'draft');
    const latestReady = records.filter(floor => ['saved', 'covered'].includes(floor.summaryState)).at(-1)?.id ?? null;
    const firstMissing = records.find(floor => floor.summaryState === 'missing')?.id ?? null;
    const storySummaries = state.storySummaries || [];
    const stageSummaries = state.stageSummaries || [];
    const storyMaterials = new Map();
    for (const block of state.blocks || []) {
        if (block?.hash && block?.type === 'story' && block?.sourceKind !== 'raw') storyMaterials.set(block.hash, block);
    }
    for (const summary of storySummaries) {
        if (summary?.hash) storyMaterials.set(summary.hash, summary);
    }
    const coveredStoryCount = [...storyMaterials.keys()].filter(hash => coveredHashes.has(hash)).length;
    const uncoveredStoryCount = Math.max(0, storyMaterials.size - coveredStoryCount);
    const coveredStageHashes = new Set(state.coveredStageHashes || []);
    const uncoveredStageCount = stageSummaries.filter(summary => summary?.hash && !coveredStageHashes.has(summary.hash)).length;

    return {
        records,
        byId: floors,
        latest: records.at(-1) || null,
        aggregates: {
            total: records.length,
            summarized,
            covered,
            missing,
            summaryDrafts,
            hidden: count(floor => floor.hidden),
            tableDrafts: count(floor => floor.tableState === 'draft'),
            tableApplied: count(floor => floor.tableState === 'applied'),
            vectorIndexed: count(floor => floor.vectorState === 'indexed'),
            latestFloor: records.at(-1)?.id ?? null,
            latestReadyFloor: latestReady,
            firstMissingFloor: firstMissing,
            storySummaryCount: storyMaterials.size,
            stageSummaryCount: stageSummaries.length,
            epicSummaryCount: (state.epicSummaries || []).length,
            coveredStoryCount,
            uncoveredStoryCount,
            uncoveredStageCount,
            pendingDraftCount: (state.drafts || []).length,
            activeTaskCount: (state.taskQueue || []).filter(task => ['queued', 'running'].includes(task?.status)).length,
        },
    };
}

export function createMemoryOrchestrationPlan(index, state = {}, { busy = false } = {}) {
    const stats = index?.aggregates || {};
    const latest = index?.latest || null;
    const mode = state.turnSummary?.processingMode || 'both';
    const needsSummary = !!latest && latest.summaryState === 'missing' && mode !== 'table';
    const needsTable = !!latest && latest.tableState === 'none' && mode !== 'summary'
        && !!state.tableDatabase?.enabled && (state.tableDatabase?.tables || []).length > 0;
    const turnAlreadyProcessed = Number(state.turnSummary?.lastProcessedMessageId) === Number(latest?.id);
    const progress = stats.storySummaryCount
        ? Math.max(0, Math.min(100, Math.round((stats.coveredStoryCount / stats.storySummaryCount) * 100)))
        : 0;
    const actions = {
        captureInline: !!latest && (!!state.inlineGeneration?.summaryEnabled || !!state.inlineGeneration?.tableEnabled),
        processLatestTurn: !busy && !!state.turnSummary?.auto && !turnAlreadyProcessed && needsSummary,
        processLatestTableOnly: !busy && !!state.turnSummary?.auto && !turnAlreadyProcessed && !needsSummary && needsTable,
        runStageAutomation: !busy && !!state.automation?.enabled && stats.uncoveredStoryCount > 0,
        balanceHiddenFloors: !!state.autoHideRecent?.enabled,
        refreshVectorIndex: !!state.vectorMemory?.enabled && !!state.vectorMemory?.dirty && state.vectorMemory?.autoIndex !== false,
    };

    let recommendation;
    if (stats.pendingDraftCount > 0) {
        recommendation = { stateLabel: '等待确认', statusLabel: `${stats.pendingDraftCount} 条待办`, title: '先确认刚生成的内容', copy: '确认后，编排器会继续安排下一步。', kind: 'nav', target: 'drafts', buttonLabel: '查看待确认', icon: 'fa-inbox', progress };
    } else if (stats.activeTaskCount > 0 || busy) {
        recommendation = { stateLabel: '正在处理', statusLabel: `${Math.max(1, stats.activeTaskCount || 0)} 个任务`, title: '正在整理这段剧情', copy: '完成后会自动更新楼层记忆状态。', kind: 'nav', target: 'drafts', buttonLabel: '查看任务进度', icon: 'fa-list-check', progress };
    } else if (state.workflowMode === 'generic' && stats.storySummaryCount === 0) {
        recommendation = { stateLabel: '旧聊天补课', statusLabel: stats.latestFloor === null ? '等待正文' : `第 ${stats.latestFloor} 楼`, title: '给旧聊天补上记忆', copy: '先选择要整理的楼层范围。', kind: 'nav', target: 'settings', buttonLabel: '设置补课范围', icon: 'fa-box-archive', progress };
    } else if (stats.storySummaryCount === 0) {
        recommendation = { stateLabel: '等待扫描', statusLabel: stats.latestFloor === null ? '准备开始' : `${stats.missing} 楼待识别`, title: '建立第一段剧情记忆', copy: '扫描后，剪辑台会接管后续编排。', kind: 'action', target: 'scan', buttonLabel: '扫描当前聊天', icon: 'fa-magnifying-glass', progress: 0 };
    } else if (stats.missing > 0) {
        const firstMissing = Number.isInteger(Number(stats.firstMissingFloor)) ? `最早第 ${stats.firstMissingFloor} 楼` : '存在未整理楼层';
        recommendation = { stateLabel: '记忆缺口', statusLabel: `${stats.missing} 楼待补`, title: '先补齐漏掉的助手楼层', copy: `${firstMissing}；补齐后再生成阶段总结。`, kind: 'nav', target: 'preview', buttonLabel: '补写缺失摘要', icon: 'fa-triangle-exclamation', progress };
    } else if (stats.uncoveredStoryCount > 0) {
        recommendation = { stateLabel: '等待整理', statusLabel: `${stats.uncoveredStoryCount} 条摘要`, title: '整理下一段长期记忆', copy: '把尚未覆盖的剧情摘要整理成阶段记忆。', kind: 'action', target: 'generate-stage', buttonLabel: '生成阶段总结', icon: 'fa-wand-magic-sparkles', progress };
    } else if (stats.uncoveredStageCount >= 2) {
        recommendation = { stateLabel: '阶段已整理', statusLabel: `${stats.uncoveredStageCount} 段可汇总`, title: '把阶段记忆串成时间线', copy: '已有多段阶段记忆，可以继续压缩。', kind: 'action', target: 'generate-epic', buttonLabel: '生成多次总结', icon: 'fa-layer-group', progress: 100 };
    } else {
        recommendation = { stateLabel: '编排正常', statusLabel: stats.latestReadyFloor === null ? '等待记忆' : `已整理至 ${stats.latestReadyFloor} 楼`, title: '继续剪辑这段剧情', copy: stats.missing > 0 ? `还有 ${stats.missing} 楼等待识别。` : '现有记忆已经同步。', kind: 'action', target: 'scan', buttonLabel: '扫描最新剧情', icon: 'fa-magnifying-glass', progress: 100 };
    }

    return { actions, recommendation, progress };
}
