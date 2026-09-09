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
    getTaskSourceSignature = () => '',
    rebuildMissingTask,
} = {}) {
    let isQueueRunning = false;
    let runVersion = 0;
    let activeController = null;
    let activeState = null;
    const retrying = new Set();
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
        task.metadata = { ...metadata, sourceFingerprint: getTaskSourceSignature(task) };
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
        if (state.taskQueuePaused || isQueueRunning || getIsBusy?.() || !state.taskQueue.some(task => task.status === 'queued')) {
            return;
        }
    
        isQueueRunning = true;
        activeState = state;
        const run = ++runVersion;
        const isCurrentRun = () => run === runVersion && ensureState() === state;
        setBusy(true);
        const toast = toastr.info('正在处理总结任务队列...', '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
        let createdDrafts = 0;
        let autoCommitted = 0;
        try {
            while (true) {
                if (!isCurrentRun()) return;
                if (state.taskQueuePaused) break;
                const task = state.taskQueue.find(item => item.status === 'queued');
                if (!task) {
                    break;
                }
    
                task.status = 'running';
                task.metadata ||= {};
                task.updatedAt = new Date().toISOString();
                saveState();
                renderTaskQueueProgress(`正在处理任务：${task.label}`);
    
                try {
                    const saved = [...(state.storySummaries || []), ...(state.stageSummaries || []), ...(state.epicSummaries || [])]
                        .find(summary => summary.metadata?.queueTaskId === task.id);
                    if (saved) {
                        task.status = 'done';
                        task.error = '';
                        saveState();
                        continue;
                    }
                    const sourceSignature = getTaskSourceSignature(task);
                    if (task.metadata?.sourceFingerprint && task.metadata.sourceFingerprint !== sourceSignature) {
                        throw new Error('任务排队后来源正文已变化，请重新选择材料生成，不要重试旧提示词。');
                    }
                    const existingDraft = (state.drafts || []).find(draft => draft.metadata?.queueTaskId === task.id);
                    activeController = new AbortController();
                    const controller = activeController;
                    const rawResult = existingDraft ? existingDraft.content : await callGenerationModel({
                        prompt: task.prompt,
                        systemPrompt: task.systemPrompt,
                        signal: controller.signal,
                    });
                    if (!isCurrentRun()) {
                        cancelledQueueTaskIds.delete(task.id);
                        task.status = 'failed';
                        task.error = '聊天或队列已切换，本次返回未写入；请回原聊天检查后重试。';
                        return;
                    }
                    if (controller.signal.aborted) throw new Error('当前任务已停止，返回内容未写入；可以稍后重试。');
                    if (sourceSignature !== getTaskSourceSignature(task)) {
                        throw new Error('生成期间来源正文或回复版本已变化，本次返回未写入，请重新选择材料生成。');
                    }
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
                        const createdMessageIds = new Set(task.metadata?.completedMessageIds || []);
                        for (const item of items) {
                            if (createdMessageIds.has(Number(item.target.messageId))) continue;
                            createMissingSummaryDraftFromBatchItem(item, task);
                            createdMessageIds.add(Number(item.target.messageId));
                            task.metadata.completedMessageIds = [...createdMessageIds];
                        }
                        task.metadata.completedMessageIds = [...createdMessageIds];
                        createdDrafts += items.length;
                        const expectedCount = Array.isArray(task.metadata?.missingTargets) ? task.metadata.missingTargets.length : 0;
                        let partial = false;
                        if (expectedCount) {
                            const expectedIds = task.metadata.missingTargets.map(target => Number(target.messageId));
                            const missed = expectedIds.filter(id => !createdMessageIds.has(id));
                            partial = missed.length > 0;
                            task.error = partial ? `部分完成：缺少 ${missed.map(id => `#${id}`).join(', ')}；重试只补这些楼层。` : '';
                        } else {
                            task.error = '';
                        }
                        task.status = partial ? 'partial' : 'done';
                        task.updatedAt = new Date().toISOString();
                        saveState();
                        renderTaskQueueProgress(`已处理任务：${task.label}`);
                        continue;
                    }
    
                    const result = normalizeGeneratedBakemono(rawResult);
                    const draft = existingDraft || createDraft({
                        kind: task.kind,
                        content: result,
                        sourceHashes: task.sourceHashes || [],
                        sourceStageHashes: task.sourceStageHashes || [],
                        sourceMessageIds: task.sourceMessageIds || [],
                        prompt: task.prompt,
                        trigger: task.trigger || 'manual',
                        metadata: { ...task.metadata, queueTaskId: task.id },
                    });
                    saveState();
                    if (task.trigger === 'auto' && state.automation.mode === 'commit_hide' && task.kind === blockTypes.STAGE) {
                        const summary = await commitDraft(draft.id, draft.content, { silent: true });
                        if (!isCurrentRun()) return;
                        autoCommitted += 1;
                        const preserveRecent = Math.max(0, Number(state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent));
                        task.metadata = {
                            ...(task.metadata || {}),
                            autoCommitted: true,
                            autoHiddenPreserveRecent: preserveRecent,
                        };
                        const hiddenBefore = new Set(state.hiddenMessageIds || []);
                        const hiddenIds = await hideCoveredMessages({ confirm: false, preserveRecent, silent: true }) || [];
                        if (!isCurrentRun()) return;
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
                    if (!isCurrentRun()) return;
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
            const message = state.taskQueuePaused ? '队列已暂停，已完成的草稿保留；点击继续队列可处理剩余任务。' : autoCommitted && !createdDrafts
                ? `任务队列处理完成，已自动保存 ${autoCommitted} 个阶段总结并收纳旧楼层。`
                : autoCommitted
                    ? `任务队列处理完成，已自动保存 ${autoCommitted} 个阶段总结，另有 ${createdDrafts} 个草稿待确认。`
                    : createdDrafts ? '任务队列处理完成，生成结果已进入草稿箱。' : '本次没有生成草稿，请查看任务中的失败原因。';
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, message);
        } finally {
            toastr.clear(toast);
            if (run === runVersion) {
                isQueueRunning = false;
                activeController = null;
                activeState = null;
                setBusy(false);
                renderTaskQueueProgress();
            }
        }
    }
    
    async function retryQueueTask(taskId) {
        const state = ensureState();
        const task = state.taskQueue.find(item => item.id === taskId);
        if (!task || isQueueRunning || getIsBusy?.() || retrying.has(taskId) || !['failed', 'partial'].includes(task.status)) {
            return;
        }
        retrying.add(taskId);
        try {
        if (task.trigger === 'missing_summary_batch') {
            task.metadata ||= {};
            task.metadata.completedMessageIds = [...new Set([
                ...(task.metadata.completedMessageIds || []),
                ...(state.drafts || []).filter(draft => draft.metadata?.missingBatchTaskId === task.id)
                    .map(draft => Number(draft.metadata.targetMessageId)),
            ])];
        }
        if (task.trigger === 'missing_summary_batch' && task.metadata?.completedMessageIds?.length) {
            if (!rebuildMissingTask) throw new Error('请重新选择缺失楼层进行补写。');
            const replacement = await rebuildMissingTask(task);
            if (ensureState() !== state || !state.taskQueue.includes(task)) return;
            Object.assign(task, replacement);
            task.metadata.sourceFingerprint = getTaskSourceSignature(task);
        }
        task.status = 'queued';
        task.error = '';
        task.updatedAt = new Date().toISOString();
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, state.taskQueuePaused ? '任务已重新排队；点击继续队列开始处理。' : '任务已重新排队。');
        await processTaskQueue();
        } catch (error) {
            if (ensureState() === state) {
                task.error = error?.message || String(error);
                renderWorkbenchScope(workbenchRenderScopes.DRAFTS, task.error);
                toastr.error(task.error);
            }
        } finally { retrying.delete(taskId); }
    }

    function pauseQueue() {
        const state = ensureState();
        state.taskQueuePaused = true;
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, isQueueRunning ? '当前任务完成后暂停，后续任务暂不发送。' : '队列已暂停。');
    }

    function resumeQueue() {
        const state = ensureState();
        recoverInterruptedTasks(state);
        state.taskQueuePaused = false;
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '队列已继续；失败或部分完成的项目请单独重试。');
        return processTaskQueue();
    }

    function stopCurrentTask() {
        pauseQueue();
        activeController?.abort();
    }

    function recoverInterruptedTasks(state = ensureState()) {
        if (activeState === state && isQueueRunning) return;
        if (activeState && activeState !== state && isQueueRunning) {
            resetRunning();
            setBusy(false);
        }
        let changed = false;
        for (const task of state.taskQueue || []) {
            if (task.status !== 'running') continue;
            task.metadata ||= {};
            if (task.trigger === 'missing_summary_batch') {
                task.metadata.completedMessageIds = [...new Set([
                    ...(task.metadata.completedMessageIds || []),
                    ...(state.drafts || []).filter(draft => draft.metadata?.missingBatchTaskId === task.id)
                        .map(draft => Number(draft.metadata.targetMessageId)),
                ])];
            }
            task.status = 'failed';
            task.error = '上次处理被中断，请检查已有草稿后重试。';
            changed = true;
        }
        if (changed) {
            state.taskQueuePaused = true;
            saveState();
        }
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
                    '会尝试停止自定义接口请求；酒馆主模型能否停止由酒馆决定，服务商仍可能计费。',
                ] : []),
            ],
        );
        if (!confirmed) {
            return;
        }
        if (isRunningTask) {
            activeController?.abort();
            cancelledQueueTaskIds.add(task.id);
            runVersion += 1;
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
        activeController?.abort();
        runVersion += 1;
        isQueueRunning = false;
        activeController = null;
        activeState = null;
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
        pauseQueue,
        resumeQueue,
        stopCurrentTask,
        recoverInterruptedTasks,
    };
}
