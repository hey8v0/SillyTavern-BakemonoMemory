export function createSummaryDraftService({
    getChat,
    ensureState,
    getHash,
    getBlockTitle,
    blockTypes,
    messageHasConfiguredSummary,
    toastr,
    saveChatConditional,
    scanBakemonoBlocks,
    updateInjectionFromSummaries,
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    confirmDanger,
    getSummaryTaskQueue,
    setBusy,
    processTaskQueue,
    getSourceStart,
    getSourceEnd,
    getSummaryLevel,
    sortSummariesBySource,
    unique,
    mergeBlocks,
    getKindLabel,
    runGeneration,
    callGenerationModel,
    buildEpicSystemPrompt,
    buildStageSystemPrompt,
    persistSharedConfigurationFromState,
    getFiniteMessageIds,
    formatSourceRange,
    hideChatMessageRange,
    markVectorIndexDirty,
    parseList,
    extractConfiguredSegments,
    removeExactTextBlock,
    confirm,
} = {}) {
    const durableSummaryStateKeys = [
        'blocks',
        'storySummaries',
        'stageSummaries',
        'epicSummaries',
        'drafts',
        'history',
        'coveredBlockHashes',
        'coveredStageHashes',
        'generatedMemory',
        'injection',
        'autoSummaryTransactions',
    ];

    function cloneSerializable(value) {
        if (value === undefined) return undefined;
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    function captureSummaryState(state = ensureState()) {
        return Object.fromEntries(durableSummaryStateKeys.map(key => {
            const value = state[key];
            if (Array.isArray(value)) return [key, value.slice()];
            if (value && typeof value === 'object') return [key, { ...value }];
            return [key, value];
        }));
    }

    function restoreSummaryState(snapshot, state = ensureState()) {
        for (const key of durableSummaryStateKeys) {
            if (!Object.hasOwn(snapshot, key)) continue;
            const value = snapshot[key];
            state[key] = Array.isArray(value) ? value.slice() : value && typeof value === 'object' ? { ...value } : value;
        }
        saveState();
    }

    function captureMessage(message) {
        return {
            mes: message?.mes,
            swipes: cloneSerializable(message?.swipes),
        };
    }

    function restoreMessage(message, snapshot) {
        if (!message || !snapshot) return;
        message.mes = snapshot.mes;
        if (snapshot.swipes === undefined) delete message.swipes;
        else message.swipes = cloneSerializable(snapshot.swipes);
    }

    async function persistSummaryStateDurably(recoveryMessageIds = []) {
        const recovery = saveState({ recoveryMessageIds });
        if (recovery?.status === 'error') {
            throw new Error(`本地恢复保护写入失败：${recovery.error?.message || recovery.error || '存储空间不可用'}`);
        }
        await saveChatConditional();
        if (recovery && ['quota-exceeded', 'unavailable'].includes(recovery.status)) {
            toastr.warning(
                recovery.status === 'quota-exceeded'
                    ? 'TT 本地恢复空间已满；本次已继续交给酒馆保存，但本次操作暂时没有额外崩溃恢复副本。'
                    : '当前无法使用本地恢复空间；本次已继续交给酒馆保存。',
                '剧情剪辑台 · 恢复保护已降级',
            );
        }
        return recovery;
    }

    function showDurableSaveFailure(error) {
        const reason = error?.message || String(error || '未知错误');
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `保存失败，已恢复保存前状态：${reason}`);
        toastr.error(`没有写入酒馆存档，已恢复原状态：${reason}`, '剧情剪辑台');
    }

    function createDraft({ kind, content, sourceHashes = [], sourceStageHashes = [], sourceMessageIds = [], prompt = '', trigger = 'manual', metadata = {} }) {
        const state = ensureState();
        const createdAt = new Date().toISOString();
        const id = `draft-${getHash(`${kind}|${createdAt}|${content}`)}`;
        const fallbackTitle = metadata?.suggestedTitle || getDefaultDraftTitle(kind, state);
        const draft = {
            id,
            kind,
            title: metadata?.lockTitle ? fallbackTitle : getBlockTitle(content, fallbackTitle),
            content,
            sourceHashes,
            sourceStageHashes,
            sourceMessageIds,
            prompt,
            trigger,
            metadata,
            createdAt,
            provider: state.automation.apiProvider || 'tavern',
        };
        state.drafts.unshift(draft);
        return draft;
    }
    
    function getDefaultDraftTitle(kind, state = ensureState()) {
        if (kind === blockTypes.STORY) {
            return `剧情摘要草稿 ${state.storySummaries.length + 1}`;
        }
        if (kind === blockTypes.EPIC) {
            return `多次总结草稿 ${state.epicSummaries.length + 1}`;
        }
        return `剧集终了草稿 ${state.stageSummaries.length + 1}`;
    }
    
    function updateChatMessageText(message, text) {
        message.mes = text;
        if (Array.isArray(message.swipes)) {
            const swipeId = Number.isFinite(Number(message.swipe_id)) ? Number(message.swipe_id) : 0;
            if (swipeId >= 0 && swipeId < message.swipes.length) {
                message.swipes[swipeId] = text;
            }
        }
    }
    
    function getMissingSummaryDraftConflict(draft, state = ensureState()) {
        const targetMessageId = Number(draft?.metadata?.targetMessageId);
        if (!Number.isFinite(targetMessageId) || !getChat()[targetMessageId]) {
            return '目标楼层不存在，可能已经被删除。';
        }
        const message = getChat()[targetMessageId];
        if (message.is_user) {
            return '目标楼层不是助手正文。';
        }
        if (messageHasConfiguredSummary(message, state)) {
            return '目标楼层已经包含摘要块。';
        }
        const expectedHash = String(draft?.metadata?.targetMessageHash || '');
        if (expectedHash && getHash(String(message.mes || '')) !== expectedHash) {
            return '目标楼层正文已经变化，请重新补写。';
        }
        return '';
    }
    
    async function commitMissingSummaryDraft(draftIndex, editedContent = null, options = {}) {
        const state = ensureState();
        const draft = state.drafts[draftIndex];
        const conflict = getMissingSummaryDraftConflict(draft, state);
        if (conflict) {
            toastr.warning(conflict);
            return null;
        }
    
        const targetMessageId = Number(draft.metadata.targetMessageId);
        const message = getChat()[targetMessageId];
        const stateSnapshot = captureSummaryState(state);
        const messageSnapshot = captureMessage(message);
        const content = normalizeGeneratedBakemono(editedContent ?? draft.content);
        try {
            const original = String(message.mes || '').trimEnd();
            updateChatMessageText(message, `${original}\n\n${content}`);

            state.drafts.splice(draftIndex, 1);
            state.history.unshift({
                id: `append-missing-${getHash(`${draft.id}|${Date.now()}`)}`,
                kind: draft.kind,
                summaryHash: getHash(content),
                draft,
                summary: {
                    hash: getHash(content),
                    type: draft.kind,
                    title: draft.title || getBlockTitle(content, '补写摘要'),
                    content,
                    sourceHashes: draft.sourceHashes || [],
                    sourceMessageIds: [targetMessageId],
                    sourceKind: 'missing_summary',
                    metadata: draft.metadata || {},
                    createdAt: new Date().toISOString(),
                    draftId: draft.id,
                },
                action: 'append_missing_summary',
                createdAt: new Date().toISOString(),
            });

            scanBakemonoBlocks({ persist: false });
            updateInjectionFromSummaries();
            await persistSummaryStateDurably([targetMessageId]);
        } catch (error) {
            restoreMessage(message, messageSnapshot);
            restoreSummaryState(stateSnapshot, state);
            showDurableSaveFailure(error);
            if (options.silent) throw error;
            return null;
        }
        if (!options.silent) {
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `已把摘要补写到第 ${targetMessageId} 楼。`);
            toastr.success(`已补写到第 ${targetMessageId} 楼。`);
        }
        return content;
    }
    
    async function commitAllMissingSummaryDrafts() {
        const state = ensureState();
        const drafts = state.drafts.filter(draft => draft.metadata?.appendMode === 'missing_summary');
        if (!drafts.length) {
            toastr.info('暂无可应用的缺失摘要草稿。');
            return;
        }
    
        const ready = [];
        const conflicts = [];
        const seenTargets = new Set();
        for (const draft of drafts) {
            const conflict = getMissingSummaryDraftConflict(draft, state);
            if (conflict) {
                conflicts.push({ draft, conflict });
            } else if (seenTargets.has(Number(draft.metadata?.targetMessageId))) {
                conflicts.push({ draft, conflict: '同一楼层存在多个缺失摘要草稿，请手动处理。' });
            } else {
                seenTargets.add(Number(draft.metadata?.targetMessageId));
                ready.push(draft);
            }
        }
    
        if (!ready.length) {
            toastr.warning(`没有无冲突草稿可应用。${conflicts[0]?.conflict || ''}`);
            return;
        }
    
        const confirmed = confirmDanger(
            `一键应用 ${ready.length} 个缺失摘要草稿？`,
            [
                '插件会把摘要追加到对应助手正文末尾，然后重新扫描登记。',
                conflicts.length ? `${conflicts.length} 个有冲突的草稿会保留，不会被自动应用。` : '所有缺失摘要草稿都会被应用。',
            ],
        );
        if (!confirmed) {
            return;
        }
    
        const toast = toastr.info(`正在批量应用 ${ready.length} 个缺失摘要...`, '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
        const stateSnapshot = captureSummaryState(state);
        const messageSnapshots = new Map(ready.map(draft => {
            const messageId = Number(draft.metadata.targetMessageId);
            return [messageId, captureMessage(getChat()[messageId])];
        }));
        const appliedDraftIds = new Set();
        let applied = 0;
        const createdAt = new Date().toISOString();
        try {
            for (const draft of ready) {
                const targetMessageId = Number(draft.metadata.targetMessageId);
                const message = getChat()[targetMessageId];
                const content = normalizeGeneratedBakemono(draft.content);
                const original = String(message.mes || '').trimEnd();
                updateChatMessageText(message, `${original}\n\n${content}`);
                appliedDraftIds.add(draft.id);
                applied += 1;
                state.history.unshift({
                    id: `append-missing-${getHash(`${draft.id}|${createdAt}`)}`,
                    kind: draft.kind,
                    summaryHash: getHash(content),
                    draft,
                    summary: {
                        hash: getHash(content),
                        type: draft.kind,
                        title: draft.title || getBlockTitle(content, '补写摘要'),
                        content,
                        sourceHashes: draft.sourceHashes || [],
                        sourceMessageIds: [targetMessageId],
                        sourceKind: 'missing_summary',
                        metadata: draft.metadata || {},
                        createdAt,
                        draftId: draft.id,
                    },
                    action: 'append_missing_summary',
                    createdAt,
                });
            }
            state.drafts = state.drafts.filter(draft => !appliedDraftIds.has(draft.id));
            scanBakemonoBlocks({ persist: false });
            updateInjectionFromSummaries();
            await persistSummaryStateDurably(ready.map(draft => Number(draft.metadata.targetMessageId)));
        } catch (error) {
            for (const [messageId, snapshot] of messageSnapshots) {
                restoreMessage(getChat()[messageId], snapshot);
            }
            restoreSummaryState(stateSnapshot, state);
            showDurableSaveFailure(error);
            throw error;
        } finally {
            toastr.clear(toast);
        }
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `已补写 ${applied} 个缺失摘要。${conflicts.length ? `保留 ${conflicts.length} 个冲突草稿。` : ''}`);
        toastr.success(`已补写 ${applied} 个缺失摘要。`);
    }
    
    function removeMissingSummaryDraftsAndTasks() {
        const state = ensureState();
        const draftCount = state.drafts.filter(draft => draft.metadata?.appendMode === 'missing_summary').length;
        const removableTaskStatuses = new Set(['queued', 'failed', 'done']);
        const taskCount = state.taskQueue.filter(task => isMissingSummaryTask(task) && removableTaskStatuses.has(task.status)).length;
        if (!draftCount && !taskCount) {
            toastr.info('没有可移除的缺失摘要草稿或批次任务。');
            return;
        }
        const confirmed = confirmDanger(
            `移除 ${draftCount} 个缺失摘要草稿和 ${taskCount} 个批次任务？`,
            [
                '这只会清理插件里的待确认内容和未运行/失败/完成的补写任务。',
                '已经追加进正文的摘要不会被删除。',
                '正在运行中的任务会保留，避免队列状态损坏。',
            ],
        );
        if (!confirmed) {
            return;
        }
        state.drafts = state.drafts.filter(draft => draft.metadata?.appendMode !== 'missing_summary');
        state.taskQueue = state.taskQueue.filter(task => !(isMissingSummaryTask(task) && removableTaskStatuses.has(task.status)));
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `已移除 ${draftCount} 个缺失摘要草稿和 ${taskCount} 个批次任务。`);
        toastr.success('缺失摘要待处理内容已移除。');
    }
    
    function clearStuckQueueTasks(predicate = () => true, label = '任务') {
        const state = ensureState();
        const stuckTasks = state.taskQueue.filter(task => task.status === 'running' && predicate(task));
        if (!stuckTasks.length) {
            toastr.info(`没有卡住的${label}。`);
            return;
        }
        const confirmed = confirmDanger(
            `解除 ${stuckTasks.length} 个生成中的${label}？`,
            [
                '这只会清理显示“生成中”的队列项，不会删除已经生成的草稿或保存记录。',
                '如果旧请求稍后返回，插件会忽略它，不再写入草稿。',
                '解除后，后面的等待任务会继续排队处理。',
            ],
        );
        if (!confirmed) {
            return;
        }
        getSummaryTaskQueue().cancelTasks(stuckTasks.map(task => task.id));
        const stuckTaskIds = new Set(stuckTasks.map(task => task.id));
        state.taskQueue = state.taskQueue.filter(task => !stuckTaskIds.has(task.id));
        getSummaryTaskQueue().resetRunning();
        setBusy(false);
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, `已解除 ${stuckTasks.length} 个卡住的${label}。`);
        toastr.success('已解除卡住任务，队列可以继续。');
        processTaskQueue();
    }
    
    function clearStuckMissingSummaryTasks() {
        clearStuckQueueTasks(isMissingSummaryTask, '缺失摘要任务');
    }
    
    function isMissingSummaryTask(task) {
        return task?.trigger === 'missing_summary_batch'
            || task?.trigger === 'missing_summary'
            || task?.metadata?.appendMode === 'missing_summary'
            || task?.metadata?.appendMode === 'missing_summary_batch';
    }
    
    async function commitDraft(draftId, editedContent = null, options = {}) {
        const state = ensureState();
        const draftIndex = state.drafts.findIndex(draft => draft.id === draftId);
        if (draftIndex < 0) {
            toastr.warning('没有找到这个草稿。');
            return;
        }
    
        const draft = state.drafts[draftIndex];
        if (draft.metadata?.appendMode === 'missing_summary') {
            return await commitMissingSummaryDraft(draftIndex, editedContent, options);
        }

        const stateSnapshot = captureSummaryState(state);
    
        const content = normalizeGeneratedBakemono(editedContent ?? draft.content);
        const titleText = String(draft.title || getDefaultDraftTitle(draft.kind, state)).trim();
        const hash = getHash(content);
        const sourceStart = getSourceStart(draft.sourceMessageIds || []);
        const sourceEnd = getSourceEnd(draft.sourceMessageIds || []);
        const sourceSortKey = Number.isFinite(Number(draft.metadata?.sourceSortKey))
            ? Number(draft.metadata.sourceSortKey)
            : sourceStart;
        const summary = {
            hash,
            type: draft.kind,
            title: titleText || getBlockTitle(content, getDefaultDraftTitle(draft.kind, state)),
            content,
            sourceHashes: draft.sourceHashes || [],
            sourceStageHashes: draft.sourceStageHashes || [],
            sourceMessageIds: draft.sourceMessageIds || [],
            sourceStart,
            sourceEnd,
            sourceSortKey,
            sourceKind: draft.metadata?.sourceKind || draft.trigger || 'manual',
            metadata: draft.metadata || {},
            level: draft.kind === blockTypes.EPIC ? getSummaryLevel(draft) : getSummaryLevel({ ...draft, type: draft.kind }),
            createdAt: new Date().toISOString(),
            draftId: draft.id,
        };
    
        const block = {
            hash,
            type: draft.kind,
            messageId: Number.isFinite(sourceSortKey) && sourceSortKey < Number.MAX_SAFE_INTEGER ? sourceSortKey : Number.MAX_SAFE_INTEGER,
            blockIndex: getSummaryIndexForKind(draft.kind, state) + 1,
            title: summary.title,
            content,
            sourceHashes: summary.sourceHashes,
            sourceStageHashes: summary.sourceStageHashes,
            sourceMessageIds: summary.sourceMessageIds,
            sourceSortKey,
            sourceKind: summary.sourceKind,
            level: summary.level,
            isGeneratedSummary: true,
            isHidden: false,
        };
    
        if (draft.kind === blockTypes.STORY) {
            state.storySummaries.push(summary);
            sortSummariesBySource(state.storySummaries);
        } else if (draft.kind === blockTypes.EPIC) {
            state.epicSummaries.push(summary);
            sortSummariesBySource(state.epicSummaries);
            state.coveredStageHashes = unique([...state.coveredStageHashes, ...(draft.sourceStageHashes || [])]);
        } else {
            state.stageSummaries.push(summary);
            sortSummariesBySource(state.stageSummaries);
            state.coveredBlockHashes = unique([...state.coveredBlockHashes, ...(draft.sourceHashes || [])]);
        }
    
        state.blocks = mergeBlocks(state.blocks, [block]);
        state.drafts.splice(draftIndex, 1);
        state.history.unshift({
            id: `commit-${getHash(`${draft.id}|${summary.createdAt}`)}`,
            kind: draft.kind,
            summaryHash: hash,
            draft,
            summary,
            coveredBlockHashes: draft.kind === blockTypes.STAGE ? (draft.sourceHashes || []) : [],
            coveredStageHashes: draft.kind === blockTypes.EPIC ? (draft.sourceStageHashes || []) : [],
            createdAt: summary.createdAt,
        });
        if (!options.skipInjection) {
            updateInjectionFromSummaries();
        }
        try {
            await persistSummaryStateDurably();
        } catch (error) {
            restoreSummaryState(stateSnapshot, state);
            showDurableSaveFailure(error);
            if (options.silent) throw error;
            return null;
        }
        if (!options.silent) {
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '草稿已确认保存。');
            toastr.success('草稿已保存进长期记忆。');
        }
        return summary;
    }
    
    function getSummaryIndexForKind(kind, state = ensureState()) {
        if (kind === blockTypes.STORY) {
            return state.storySummaries.length;
        }
        if (kind === blockTypes.EPIC) {
            return state.epicSummaries.length;
        }
        return state.stageSummaries.length;
    }
    
    function discardDraft(draftId) {
        const state = ensureState();
        const draft = state.drafts.find(item => item.id === draftId);
        const confirmed = confirmDanger(
            `丢弃草稿「${draft?.title || getKindLabel(draft?.kind) || '未命名草稿'}」？`,
            ['草稿丢弃后不会写入长期记忆，也不能从草稿箱恢复。'],
        );
        if (!confirmed) {
            return;
        }
        const before = state.drafts.length;
        state.drafts = state.drafts.filter(draft => draft.id !== draftId);
        if (state.drafts.length !== before) {
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '草稿已丢弃。');
        }
    }
    
    async function regenerateDraft(draftId) {
        const state = ensureState();
        const draft = state.drafts.find(item => item.id === draftId);
        if (!draft) {
            toastr.warning('没有找到这个草稿。');
            return;
        }
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '正在重新总结草稿，请稍等...');
        await runGeneration('正在重新生成草稿...', async () => {
            const result = normalizeGeneratedBakemono(await callGenerationModel({
                prompt: draft.prompt,
                systemPrompt: draft.kind === blockTypes.EPIC ? buildEpicSystemPrompt() : buildStageSystemPrompt(),
            }));
            draft.content = result;
            draft.title = draft.metadata?.lockTitle ? (draft.title || draft.metadata?.suggestedTitle || getDefaultDraftTitle(draft.kind, state)) : getBlockTitle(result, draft.title);
            draft.createdAt = new Date().toISOString();
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '草稿已重新生成。');
            toastr.success('草稿已重新生成。');
        }, '草稿已重新生成', workbenchRenderScopes.DRAFTS);
    }
    
    async function undoLastCommit() {
        const state = ensureState();
        const commit = state.history[0];
        if (!commit) {
            toastr.info('暂无可撤回的保存记录。');
            return;
        }
        const confirmed = confirmDanger(
            `撤回上次保存「${commit.summary?.title || getKindLabel(commit.kind)}」？`,
            ['已保存摘要会从长期记忆中移除，原草稿会放回草稿箱。'],
        );
        if (!confirmed) {
            return;
        }
        const stateSnapshot = captureSummaryState(state);
        state.history.shift();
    
        removeSummaryByHash(commit.kind, commit.summaryHash);
        state.blocks = state.blocks.filter(block => block.hash !== commit.summaryHash);
        state.coveredBlockHashes = state.coveredBlockHashes.filter(hash => !(commit.coveredBlockHashes || []).includes(hash));
        state.coveredStageHashes = state.coveredStageHashes.filter(hash => !(commit.coveredStageHashes || []).includes(hash));
        state.drafts.unshift(commit.draft);
        updateInjectionFromSummaries();
        try {
            await persistSummaryStateDurably();
        } catch (error) {
            restoreSummaryState(stateSnapshot, state);
            showDurableSaveFailure(error);
            return;
        }
        renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '已撤回上次保存，原草稿已放回草稿箱。');
        toastr.success('已撤回上次保存。');
    }
    
    function recordAutoSummaryTransaction({ task, summary, hiddenMessageIds = [], preserveRecent = 0 }) {
        if (!summary?.hash) {
            return null;
        }
        const state = ensureState();
        const sourceMessageIds = unique(getFiniteMessageIds([
            ...(task?.sourceMessageIds || []),
            ...(summary.sourceMessageIds || []),
        ]));
        const transaction = {
            id: `auto-summary-${getHash(`${summary.hash}|${Date.now()}`)}`,
            kind: summary.type || task?.kind || blockTypes.STAGE,
            summaryHash: summary.hash,
            summaryTitle: summary.title || getBlockTitle(summary.content, '自动阶段总结'),
            sourceMessageIds,
            sourceStart: getSourceStart(sourceMessageIds),
            sourceEnd: getSourceEnd(sourceMessageIds),
            coveredBlockHashes: summary.type === blockTypes.EPIC ? [] : (summary.sourceHashes || task?.sourceHashes || []),
            coveredStageHashes: summary.type === blockTypes.EPIC ? (summary.sourceStageHashes || task?.sourceStageHashes || []) : [],
            hiddenMessageIds: unique(getFiniteMessageIds(hiddenMessageIds)),
            preserveRecent,
            taskId: task?.id || '',
            status: 'active',
            reason: '',
            createdAt: new Date().toISOString(),
            invalidatedAt: '',
            invalidatedMessageIds: [],
        };
        state.autoSummaryTransactions.unshift(transaction);
        state.autoSummaryTransactions = state.autoSummaryTransactions.slice(0, 50);
        saveState();
        return transaction;
    }
    
    function transactionTouchesMessage(transaction, messageIds = []) {
        const ids = getFiniteMessageIds(messageIds);
        if (!ids.length || !transaction) {
            return false;
        }
        const sourceIds = new Set(getFiniteMessageIds(transaction.sourceMessageIds || []));
        const sourceStart = Number(transaction.sourceStart);
        const sourceEnd = Number(transaction.sourceEnd);
        return ids.some(id => sourceIds.has(id) || (
            Number.isFinite(sourceStart)
            && Number.isFinite(sourceEnd)
            && id >= sourceStart
            && id <= sourceEnd
        ));
    }
    
    function markAffectedAutoSummaryTransactions(messageIds = [], reason = '消息变更') {
        const state = ensureState();
        const ids = getFiniteMessageIds(messageIds);
        if (!ids.length || !Array.isArray(state.autoSummaryTransactions)) {
            return [];
        }
        const affected = [];
        for (const transaction of state.autoSummaryTransactions) {
            if (transaction.status === 'rolled_back' || !transactionTouchesMessage(transaction, ids)) {
                continue;
            }
            transaction.status = 'needs_review';
            transaction.reason = reason;
            transaction.invalidatedAt = new Date().toISOString();
            transaction.invalidatedMessageIds = unique([...(transaction.invalidatedMessageIds || []), ...ids]);
            affected.push(transaction);
        }
        if (affected.length) {
            saveState();
            toastr.warning(`检测到 ${affected.length} 条自动总结覆盖的楼层被改动，可在“待确认”的自动总结回滚里处理。`, '剧情剪辑台');
        }
        return affected;
    }
    
    async function rollbackAutoSummaryTransaction(transactionId) {
        const state = ensureState();
        const transaction = state.autoSummaryTransactions.find(item => item.id === transactionId);
        if (!transaction) {
            toastr.warning('没有找到这条自动总结事务。');
            return;
        }
        const saved = findSavedSummaryByHash(transaction.summaryHash);
        const dependents = saved ? getSummaryDependents(saved.kind, transaction.summaryHash) : [];
        if (dependents.length) {
            toastr.warning('这条总结已经被上层总结引用，请先删除上层总结后再回滚。');
            return;
        }
        const hiddenIds = unique(getFiniteMessageIds(transaction.hiddenMessageIds || []).filter(id => getChat()[id]));
        const confirmed = confirmDanger(
            `回滚自动总结「${transaction.summaryTitle || transaction.summaryHash}」？`,
            [
                saved ? '会移除这条自动保存的阶段总结，并同步更新长期记忆。' : '这条总结已不存在，本次只会处理隐藏楼层记录。',
                hiddenIds.length ? `会恢复这次自动总结新隐藏的 ${hiddenIds.length} 楼。` : '没有可恢复的隐藏楼层。',
                '不会恢复更早之前已经隐藏的楼层。',
            ],
        );
        if (!confirmed) {
            return;
        }
    
        if (saved) {
            removeSummaryByHash(saved.kind, transaction.summaryHash);
            state.blocks = state.blocks.filter(block => block.hash !== transaction.summaryHash);
            state.coveredBlockHashes = state.coveredBlockHashes.filter(hash => !(transaction.coveredBlockHashes || []).includes(hash));
            state.coveredStageHashes = state.coveredStageHashes.filter(hash => !(transaction.coveredStageHashes || []).includes(hash));
            state.history = state.history.filter(item => item.summaryHash !== transaction.summaryHash);
        }
    
        for (const messageId of hiddenIds) {
            await hideChatMessageRange(messageId, messageId, true);
        }
        if (hiddenIds.length) {
            state.hiddenMessageIds = state.hiddenMessageIds.filter(id => !hiddenIds.includes(id));
            await saveChatConditional();
        }
    
        transaction.status = 'rolled_back';
        transaction.rolledBackAt = new Date().toISOString();
        state.autoSummaryTransactions = state.autoSummaryTransactions.filter(item => item.status !== 'rolled_back');
        updateInjectionFromSummaries();
        markVectorIndexDirty('自动总结已回滚', state);
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, `已回滚自动总结，恢复 ${hiddenIds.length} 楼。`);
        toastr.success('自动总结已回滚。');
    }
    
    function removeSummaryByHash(kind, hash) {
        const state = ensureState();
        if (kind === blockTypes.STORY) {
            state.storySummaries = state.storySummaries.filter(summary => summary.hash !== hash);
        } else if (kind === blockTypes.EPIC) {
            state.epicSummaries = state.epicSummaries.filter(summary => summary.hash !== hash);
        } else {
            state.stageSummaries = state.stageSummaries.filter(summary => summary.hash !== hash);
        }
    }
    
    function findSavedSummaryByHash(hash) {
        const state = ensureState();
        const groups = [
            [blockTypes.STORY, state.storySummaries],
            [blockTypes.STAGE, state.stageSummaries],
            [blockTypes.EPIC, state.epicSummaries],
        ];
        for (const [kind, list] of groups) {
            const index = list.findIndex(summary => summary.hash === hash);
            if (index >= 0) {
                return { kind, list, index, summary: list[index] };
            }
        }
        return null;
    }
    
    function getSummaryDependents(kind, hash) {
        const state = ensureState();
        if (kind === blockTypes.STORY) {
            return state.stageSummaries.filter(summary => (summary.sourceHashes || []).includes(hash));
        }
        if (kind === blockTypes.STAGE) {
            return state.epicSummaries.filter(summary => [...(summary.sourceStageHashes || []), ...(summary.sourceHashes || [])].includes(hash));
        }
        return [];
    }
    
    async function saveEditedSummary(hash, title, content) {
        const found = findSavedSummaryByHash(hash);
        if (!found) {
            toastr.warning('没有找到这个已保存摘要。');
            return;
        }
        const state = ensureState();
        const stateSnapshot = captureSummaryState(state);
        const nextTitle = String(title || found.summary.title || '').trim() || found.summary.title;
        const nextSummary = {
            ...found.summary,
            title: nextTitle,
            metadata: {
                ...(found.summary.metadata || {}),
                userTitle: nextTitle,
                userTitleUpdatedAt: new Date().toISOString(),
            },
            content: normalizeGeneratedBakemono(content || found.summary.content || ''),
        };
        found.list[found.index] = nextSummary;
        state.blocks = state.blocks.map(block => block.hash === hash ? {
            ...block,
            title: nextSummary.title,
            content: nextSummary.content,
            metadata: { ...(block.metadata || {}), userTitle: nextTitle },
        } : block);
        updateInjectionFromSummaries();
        try {
            await persistSummaryStateDurably();
        } catch (error) {
            restoreSummaryState(stateSnapshot, state);
            showDurableSaveFailure(error);
            return;
        }
        renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '摘要已更新。');
        toastr.success('摘要已更新。');
    }
    
    async function deleteSavedSummary(hash) {
        const found = findSavedSummaryByHash(hash);
        if (!found) {
            toastr.warning('没有找到这个已保存摘要。');
            return;
        }
        const dependents = getSummaryDependents(found.kind, hash);
        if (dependents.length) {
            toastr.warning(`这个摘要已被 ${dependents.length} 个上层总结引用，请先删除上层总结。`);
            return;
        }
        const confirmed = confirm([
            `删除已保存的「${found.summary.title || getKindLabel(found.kind)}」？`,
            '这不会删除聊天正文，但会更新摘要树和注入内容。',
            '',
            '确认删除吗？',
        ].join('\n'));
        if (!confirmed) {
            return;
        }

        const state = ensureState();
        const stateSnapshot = captureSummaryState(state);
        removeSummaryByHash(found.kind, hash);
        recomputeCoveredHashes(state);
        state.blocks = state.blocks.filter(block => block.hash !== hash);
        state.history = state.history.filter(item => item.summaryHash !== hash);
        updateInjectionFromSummaries();
        try {
            await persistSummaryStateDurably();
        } catch (error) {
            restoreSummaryState(stateSnapshot, state);
            showDurableSaveFailure(error);
            return;
        }
        renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '摘要已删除。');
        toastr.success('摘要已删除。');
    }

    function canRemoveScannedSummaryBlock(block) {
        return !!block
            && !block.isGeneratedSummary
            && block.sourceKind === 'tag'
            && Number.isFinite(Number(block.messageId))
            && Number(block.messageId) < Number.MAX_SAFE_INTEGER
            && !findSavedSummaryByHash(block.hash);
    }

    async function removeScannedSummaryBlock(hash) {
        const state = ensureState();
        const block = state.blocks.find(item => item.hash === hash);
        if (!canRemoveScannedSummaryBlock(block)) {
            toastr.warning('这条内容不是可清理的正文摘要块。');
            return false;
        }
        const messageId = Number(block.messageId);
        const message = getChat()[messageId];
        const nextText = removeExactTextBlock(message?.mes || '', block.content || '');
        if (nextText === null) {
            toastr.warning('原楼层中的摘要标签已经变化，请重新扫描后再试。');
            return false;
        }
        const confirmed = confirmDanger(
            `从第 ${messageId} 楼正文移除「${block.title || `#${messageId}.${Number(block.blockIndex || 0) + 1}`}」？`,
            [
                '这条摘要由“扫描与识别”从聊天正文标签读取。',
                '删除后会修改该楼正文，并从剧情回看中移除这条摘要。',
            ],
        );
        if (!confirmed) return false;

        const stateSnapshot = captureSummaryState(state);
        const messageSnapshot = captureMessage(message);
        try {
            updateChatMessageText(message, nextText);
            state.blocks = state.blocks.filter(item => item.hash !== hash);
            scanBakemonoBlocks({ persist: false });
            updateInjectionFromSummaries();
            await persistSummaryStateDurably([messageId]);
        } catch (error) {
            restoreMessage(message, messageSnapshot);
            restoreSummaryState(stateSnapshot, state);
            showDurableSaveFailure(error);
            return false;
        }
        renderWorkbenchScope(workbenchRenderScopes.SUMMARY, `已从第 ${messageId} 楼移除正文摘要块。`);
        toastr.success('正文摘要已从原楼层移除。');
        return true;
    }
    
    function recomputeCoveredHashes(state = ensureState()) {
        state.coveredBlockHashes = unique(state.stageSummaries.flatMap(summary => summary.sourceHashes || []));
        const summaryHashes = new Set([
            ...state.stageSummaries.map(summary => summary.hash),
            ...state.epicSummaries.map(summary => summary.hash),
        ]);
        state.coveredStageHashes = unique(state.epicSummaries.flatMap(summary => [
            ...(summary.sourceStageHashes || []),
            ...(summary.sourceHashes || []).filter(hash => summaryHashes.has(hash)),
        ]));
    }
    
    function normalizeGeneratedBakemono(result) {
        const state = ensureState();
        if (state.outputMode === 'plain') {
            return String(result || '').trim();
        }
        const includeTags = unique([...parseList(state.scanRules.includeTags), 'bakemono']).join(',');
        const blocks = extractConfiguredSegments(result, {
            ...state.scanRules,
            mode: 'tag',
            includeTags,
            excludeTags: '',
        });
        if (blocks.length) {
            return blocks[0].content;
        }
        return `<bakemono>\n${String(result || '').trim()}\n</bakemono>`;
    }

    return {
        clearStuckMissingSummaryTasks,
        clearStuckQueueTasks,
        commitAllMissingSummaryDrafts,
        commitDraft,
        commitMissingSummaryDraft,
        canRemoveScannedSummaryBlock,
        createDraft,
        deleteSavedSummary,
        discardDraft,
        findSavedSummaryByHash,
        getDefaultDraftTitle,
        getMissingSummaryDraftConflict,
        getSummaryDependents,
        getSummaryIndexForKind,
        isMissingSummaryTask,
        markAffectedAutoSummaryTransactions,
        normalizeGeneratedBakemono,
        recomputeCoveredHashes,
        recordAutoSummaryTransaction,
        regenerateDraft,
        removeMissingSummaryDraftsAndTasks,
        removeScannedSummaryBlock,
        removeSummaryByHash,
        rollbackAutoSummaryTransaction,
        saveEditedSummary,
        transactionTouchesMessage,
        undoLastCommit,
        updateChatMessageText,
    };
}
