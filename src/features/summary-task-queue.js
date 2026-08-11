export function createSummaryTaskQueue({
    getState: ensureState,
    getHash,
    getKindLabel,
    saveState,
    renderWorkbenchScope,
    renderTaskQueueProgress,
    workbenchRenderScopes,
    getIsBusy,
    setBusy,
    toastr,
    callGenerationModel,
    parseMissingSummaryBatchResult,
    normalizeGeneratedBakemono,
    createMissingSummaryDraftFromBatchItem,
    createDraft,
    commitDraft,
    blockTypes,
    defaultAutomation,
    hideCoveredMessages,
    recordAutoSummaryTransaction,
    switchWorkbenchTab,
    confirmDanger,
    historyState,
} = {}) {
    let isQueueRunning = false;
    const cancelledQueueTaskIds = new Set();
    function enqueueSummaryTask({ kind, prompt, systemPrompt, sourceHashes = [], sourceStageHashes = [], sourceMessageIds = [], trigger = 'manual', label = '', metadata = {}, autoStart = true, silent = false }) {
        const state = ensureState();
        const task = {
            id: `task-${getHash(`${kind}|${Date.now()}|${prompt}`)}`,
            kind,
            label: label || getKindLabel(kind),
            prompt,
            systemPrompt,
            sourceHashes,
            sourceStageHashes,
            sourceMessageIds,
            trigger,
            metadata,
            status: 'queued',
            error: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        state.taskQueue.push(task);
        saveState();
        if (!silent) {
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '任务已加入队列。');
        }
        if (autoStart) {
            processTaskQueue();
        }
        return task;
    }
    
    async function processTaskQueue() {
        const state = ensureState();
        if (isQueueRunning || getIsBusy?.() || !state.taskQueue.some(task => task.status === 'queued')) {
            return;
        }
    
        isQueueRunning = true;
        setBusy(true);
        const toast = toastr.info('正在处理总结任务队列...', '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
        let createdDrafts = 0;
        let autoCommitted = 0;
        try {
            while (true) {
                const task = state.taskQueue.find(item => item.status === 'queued');
                if (!task) {
                    break;
                }
    
                task.status = 'running';
                task.updatedAt = new Date().toISOString();
                saveState();
                renderTaskQueueProgress(`正在处理任务：${task.label}`);
    
                try {
                    const rawResult = await callGenerationModel({
                        prompt: task.prompt,
                        systemPrompt: task.systemPrompt,
                    });
                    if (cancelledQueueTaskIds.has(task.id)) {
                        cancelledQueueTaskIds.delete(task.id);
                        task.status = 'cancelled';
                        task.error = '任务已被手动解除。';
                        task.updatedAt = new Date().toISOString();
                        saveState();
                        renderTaskQueueProgress();
                        continue;
                    }
                    if (task.trigger === 'missing_summary_batch') {
                        const items = parseMissingSummaryBatchResult(rawResult, task, normalizeGeneratedBakemono);
                        if (!items.length) {
                            throw new Error('这一批没有解析出任何楼层摘要。请检查模型是否按“===楼层#数字===”分隔输出。');
                        }
                        const createdMessageIds = new Set();
                        for (const item of items) {
                            createMissingSummaryDraftFromBatchItem(item, task);
                            createdMessageIds.add(Number(item.target.messageId));
                        }
                        createdDrafts += items.length;
                        const expectedCount = Array.isArray(task.metadata?.missingTargets) ? task.metadata.missingTargets.length : 0;
                        if (expectedCount && items.length < expectedCount) {
                            const expectedIds = task.metadata.missingTargets.map(target => Number(target.messageId));
                            const missed = expectedIds.filter(id => !createdMessageIds.has(id));
                            task.error = `部分完成：本批 ${expectedCount} 楼中解析出 ${items.length} 楼，缺少 ${missed.map(id => `#${id}`).join(', ')}。`;
                        } else {
                            task.error = '';
                        }
                        task.status = 'done';
                        task.updatedAt = new Date().toISOString();
                        saveState();
                        renderTaskQueueProgress(`已处理任务：${task.label}`);
                        continue;
                    }
    
                    const result = normalizeGeneratedBakemono(rawResult);
                    const draft = createDraft({
                        kind: task.kind,
                        content: result,
                        sourceHashes: task.sourceHashes || [],
                        sourceStageHashes: task.sourceStageHashes || [],
                        sourceMessageIds: task.sourceMessageIds || [],
                        prompt: task.prompt,
                        trigger: task.trigger || 'manual',
                        metadata: task.metadata || {},
                    });
                    if (task.trigger === 'auto' && state.automation.mode === 'commit_hide' && task.kind === blockTypes.STAGE) {
                        const summary = await commitDraft(draft.id, draft.content, { silent: true });
                        autoCommitted += 1;
                        const preserveRecent = Math.max(0, Number(state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent));
                        task.metadata = {
                            ...(task.metadata || {}),
                            autoCommitted: true,
                            autoHiddenPreserveRecent: preserveRecent,
                        };
                        const hiddenBefore = new Set(state.hiddenMessageIds || []);
                        const hiddenIds = await hideCoveredMessages({ confirm: false, preserveRecent, silent: true }) || [];
                        const newlyHiddenIds = hiddenIds.filter(id => !hiddenBefore.has(id));
                        recordAutoSummaryTransaction({
                            task,
                            summary,
                            hiddenMessageIds: newlyHiddenIds,
                            preserveRecent,
                        });
                        toastr.info(`自动阶段总结已保存进长期记忆，并已隐藏被覆盖楼层（保留最近 ${preserveRecent} 楼）。`, '剧情剪辑台');
                    } else {
                        createdDrafts += 1;
                    }
                    task.status = 'done';
                    task.error = '';
                    task.updatedAt = new Date().toISOString();
                    if (task.trigger === 'auto') {
                        state.automation.lastAutoAt = new Date().toISOString();
                    }
                } catch (error) {
                    task.status = 'failed';
                    task.error = error?.message || String(error);
                    task.updatedAt = new Date().toISOString();
                    toastr.error(task.error, '任务失败');
                }
                saveState();
                renderTaskQueueProgress();
            }
            if (createdDrafts) {
                switchWorkbenchTab('drafts');
            }
            const message = autoCommitted && !createdDrafts
                ? `任务队列处理完成，已自动保存 ${autoCommitted} 个阶段总结并收纳旧楼层。`
                : autoCommitted
                    ? `任务队列处理完成，已自动保存 ${autoCommitted} 个阶段总结，另有 ${createdDrafts} 个草稿待确认。`
                    : '任务队列处理完成，生成结果已进入草稿箱。';
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, message);
        } finally {
            toastr.clear(toast);
            isQueueRunning = false;
            setBusy(false);
            renderTaskQueueProgress();
        }
    }
    
    function retryQueueTask(taskId) {
        const state = ensureState();
        const task = state.taskQueue.find(item => item.id === taskId);
        if (!task) {
            return;
        }
        task.status = 'queued';
        task.error = '';
        task.updatedAt = new Date().toISOString();
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '失败任务已重新排队。');
        processTaskQueue();
    }
    
    function removeQueueTask(taskId) {
        const state = ensureState();
        const task = state.taskQueue.find(item => item.id === taskId);
        const isRunningTask = task?.status === 'running';
        const confirmed = confirmDanger(
            `${isRunningTask ? '强制移除卡住任务' : '移除任务'}「${task?.label || '未命名任务'}」？`,
            [
                '任务移除后不会删除已保存摘要，但这个队列项无法从队列中恢复。',
                ...(isRunningTask ? [
                    '如果旧请求稍后返回，插件会忽略它，不再写入草稿。',
                    '这只解除插件队列状态，不能中止已经发出的模型请求。',
                ] : []),
            ],
        );
        if (!confirmed) {
            return;
        }
        if (isRunningTask) {
            cancelledQueueTaskIds.add(task.id);
            isQueueRunning = false;
            setBusy(false);
        }
        state.taskQueue = state.taskQueue.filter(task => task.id !== taskId);
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, isRunningTask ? '已解除卡住的队列任务。' : '任务已从队列移除。');
        processTaskQueue();
    }
    
    function clearFinishedQueueTasks() {
        const state = ensureState();
        const count = state.taskQueue.filter(task => ['done', 'failed'].includes(task.status)).length;
        if (!count) {
            toastr.info('没有可清理的完成/失败队列记录。');
            return;
        }
        const confirmed = confirmDanger(
            `清理 ${count} 条完成/失败队列记录？`,
            ['只会清理队列记录，不会删除已保存摘要。'],
        );
        if (!confirmed) {
            return;
        }
        state.taskQueue = state.taskQueue.filter(task => !['done', 'failed'].includes(task.status));
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '已清理完成/失败的队列记录。');
    }
    
    function clearHistoryRecords() {
        const state = ensureState();
        if (!state.history.length) {
            toastr.info('暂无保存记录可清理。');
            return;
        }
        const confirmed = window.confirm('只清理保存记录列表，不删除已保存的总结和注入记忆。确定继续吗？');
        if (!confirmed) {
            return;
        }
        state.history = [];
        historyState.page = 0;
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '保存记录已清理。');
        toastr.success('保存记录已清理。');
    }
    

    function isRunning() {
        return isQueueRunning;
    }

    function cancelTasks(taskIds = []) {
        for (const taskId of taskIds) cancelledQueueTaskIds.add(taskId);
    }

    function resetRunning() {
        isQueueRunning = false;
    }

    return {
        cancelTasks,
        clearFinishedQueueTasks,
        clearHistoryRecords,
        enqueueSummaryTask,
        isRunning,
        processTaskQueue,
        removeQueueTask,
        resetRunning,
        retryQueueTask,
    };
}
