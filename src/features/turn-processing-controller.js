export function createTurnProcessingController({
    getContext,
    getChat,
    chatMetadata,
    ensureState,
    getHash,
    blockTypes,
    stripPostProcessNoise,
    extractAllTaggedBlocks,
    normalizeGeneratedBakemono,
    createDraft,
    defaultInlineSummaryPrompt,
    commitDraft,
    getAppliedTableHistoriesForMessage,
    saveState,
    rollbackLatestTableOperationForChangedMessages,
    createTableEditDraft,
    applyTableOperations,
    formatSourceRange,
    toastr,
    stripTableEditTags,
    updateInjectionFromSummaries,
    saveChatConditional,
    scheduleRenderAll,
    syncInjection,
    renderWorkbenchScope,
    workbenchRenderScopes,
    getSourceMessageIdsFromBlocks,
    renderGenerationPrompt,
    defaultTurnSummaryPrompt,
    getSourceStart,
    stripHtml,
    turnProcessingModes,
    processLatestTableEdit,
    hasAppliedTableEditForMessage,
    runGeneration,
    callGenerationModel,
    extractTaggedContent,
    buildTableEditPrompt,
} = {}) {
    let inlineCaptureTimer = null;

    function findLatestAssistantTurn() {
        const sourceChat = getContext().chat || getChat() || [];
        for (let index = sourceChat.length - 1; index >= 0; index--) {
            const message = sourceChat[index];
            if (!message || message.is_user || message.is_system || !String(message.mes || '').trim()) {
                continue;
            }
            const sourceMessageIds = [index];
            let userMessage = null;
            for (let userIndex = index - 1; userIndex >= 0; userIndex--) {
                const candidate = sourceChat[userIndex];
                if (!candidate) {
                    continue;
                }
                if (candidate.is_user) {
                    userMessage = { ...candidate, messageId: userIndex };
                    sourceMessageIds.unshift(userIndex);
                    break;
                }
                if (!candidate.is_system) {
                    break;
                }
            }
            return {
                assistantMessage: { ...message, messageId: index },
                userMessage,
                sourceMessageIds,
            };
        }
        return null;
    }
    
    function buildLatestTurnBlocks(state = ensureState()) {
        const turn = findLatestAssistantTurn();
        if (!turn) {
            return [];
        }
        const blocks = [];
        if (state.turnSummary.includeUserMessage !== false && turn.userMessage) {
            blocks.push({
                hash: getHash(`turn-user|${turn.userMessage.messageId}|${turn.userMessage.mes || ''}`),
                type: blockTypes.STORY,
                messageId: turn.userMessage.messageId,
                blockIndex: 0,
                title: `用户楼层 ${turn.userMessage.messageId}`,
                content: stripPostProcessNoise(turn.userMessage.mes || ''),
            });
        }
        blocks.push({
            hash: getHash(`turn-assistant|${turn.assistantMessage.messageId}|${turn.assistantMessage.mes || ''}`),
            type: blockTypes.STORY,
            messageId: turn.assistantMessage.messageId,
            blockIndex: 0,
            title: `正文楼层 ${turn.assistantMessage.messageId}`,
            content: stripPostProcessNoise(turn.assistantMessage.mes || ''),
        });
        return blocks.filter(block => block.content.trim());
    }
    
    async function captureInlineGenerationFromLatestMessage() {
        const state = ensureState();
        if (!state.inlineGeneration?.summaryEnabled && !state.inlineGeneration?.tableEnabled) {
            return false;
        }
        const turn = findLatestAssistantTurn();
        if (!turn) {
            return false;
        }
        const message = getChat()[turn.assistantMessage.messageId];
        const text = String(message?.mes || '');
        if (!text.trim()) {
            return false;
        }
        const signature = getHash(`inline|${turn.assistantMessage.messageId}|${text}`);
        if (state.inlineGeneration.lastProcessedSignature === signature) {
            return false;
        }
        const sourceMessageIds = turn.sourceMessageIds || [turn.assistantMessage.messageId];
        let changedMessage = false;
        let capturedSomething = false;
    
        if (state.inlineGeneration.summaryEnabled) {
            for (const content of extractAllTaggedBlocks(text, 'bakemono')) {
                const draft = createDraft({
                    kind: blockTypes.STORY,
                    content: normalizeGeneratedBakemono(content),
                    sourceHashes: [],
                    sourceMessageIds,
                    prompt: state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt,
                    trigger: 'inline_summary',
                    metadata: {
                        sourceKind: 'inline',
                        sourceRange: formatSourceRange(sourceMessageIds),
                        sourceSortKey: getSourceStart(sourceMessageIds),
                    },
                });
                await commitDraft(draft.id, draft.content, { silent: true });
                capturedSomething = true;
            }
        }
    
        if (state.inlineGeneration.tableEnabled && /<tableEdit[\s>]/i.test(text)) {
            try {
                const existingHistories = getAppliedTableHistoriesForMessage(turn.assistantMessage.messageId, state);
                if (existingHistories.some(history => history.sourceSignature === signature)) {
                    state.inlineGeneration.lastProcessedMessageId = turn.assistantMessage.messageId;
                    state.inlineGeneration.lastProcessedSignature = signature;
                    saveState();
                    return capturedSomething;
                }
                if ((state.tableDatabase.editDrafts || []).some(draft => draft.sourceSignature === signature)) {
                    state.inlineGeneration.lastProcessedMessageId = turn.assistantMessage.messageId;
                    state.inlineGeneration.lastProcessedSignature = signature;
                    saveState();
                    return capturedSomething;
                }
                const latestHistory = existingHistories[0];
                if (latestHistory && latestHistory.sourceSignature !== signature) {
                    rollbackLatestTableOperationForChangedMessages([turn.assistantMessage.messageId], state);
                }
                const blocks = buildLatestTurnBlocks(state);
                const draft = createTableEditDraft(text, blocks, state);
                if (draft) {
                    draft.sourceSignature = signature;
                }
                if (draft && state.tableDatabase.autoApply) {
                    const undoSnapshot = applyTableOperations(draft.operations, state, {
                        sourceMessageIds: draft.sourceMessageIds,
                        undoLabel: `随正文表格修改：${formatSourceRange(draft.sourceMessageIds || [])}`,
                    });
                    state.tableDatabase.history.unshift({ ...draft, appliedAt: new Date().toISOString(), undoSnapshotId: undoSnapshot?.id || '', sourceSignature: signature });
                    state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draft.id);
                    toastr.success(`已自动应用 ${draft.operations.length} 项随正文表格修改。`);
                } else if (draft) {
                    toastr.info(`已捕获 ${draft.operations.length} 项随正文表格修改，请到草稿确认。`);
                }
                capturedSomething = capturedSomething || !!draft;
                if (state.inlineGeneration.hideTableEdit !== false && message) {
                    message.mes = stripTableEditTags(message.mes || '');
                    changedMessage = true;
                }
            } catch (error) {
                toastr.warning(`随正文表格修改解析失败：${error?.message || error}`);
            }
        }
    
        state.inlineGeneration.lastProcessedMessageId = turn.assistantMessage.messageId;
        state.inlineGeneration.lastProcessedSignature = signature;
        saveState();
        updateInjectionFromSummaries();
        if (changedMessage) {
            await saveChatConditional();
        }
        if (capturedSomething) {
            scheduleRenderAll();
        }
        return capturedSomething;
    }
    
    function scheduleInlineGenerationCapture(reason = '') {
        clearTimeout(inlineCaptureTimer);
        inlineCaptureTimer = setTimeout(async () => {
            try {
                const captured = await captureInlineGenerationFromLatestMessage();
                if (!captured) {
                    return;
                }
                syncInjection();
                if (reason) {
                    renderWorkbenchScope(workbenchRenderScopes.SUMMARY, `已复查随正文输出：${reason}`);
                } else {
                    renderWorkbenchScope(workbenchRenderScopes.SUMMARY);
                }
            } catch (error) {
                console.warn('[BakemonoMemory] delayed inline capture failed', error);
            }
        }, 1200);
    }
    
    function buildTurnSummaryPrompt(blocks, state = ensureState()) {
        const sourceIds = getSourceMessageIdsFromBlocks(blocks);
        return renderGenerationPrompt(state.turnSummary.prompt || defaultTurnSummaryPrompt, blocks, {
            sourceRange: formatSourceRange(sourceIds),
            suggestedTitle: `正文摘要 ${state.storySummaries.length + state.drafts.filter(draft => draft.kind === blockTypes.STORY).length + 1}`,
        });
    }
    
    function getCurrentCharacterForReference() {
        const context = getContext();
        return context.characters?.[context.characterId] || null;
    }
    
    function getCharacterReferenceContext() {
        const context = getContext();
        const character = getCurrentCharacterForReference();
        if (!character) {
            return '';
        }
        const data = character.data || {};
        const fields = [
            ['角色名', character.name || data.name],
            ['角色描述', character.description || data.description],
            ['性格', character.personality || data.personality],
            ['场景', character.scenario || data.scenario],
            ['创作者备注', character.creator_notes || data.creator_notes],
            ['系统提示', chatMetadata.system_prompt || data.system_prompt],
            ['用户人设', context.powerUserSettings?.persona_description],
        ];
        return fields
            .map(([label, value]) => String(value || '').trim() ? `【${label}】\n${String(value).trim()}` : '')
            .filter(Boolean)
            .join('\n\n');
    }
    
    function buildWorldInfoScanMessages(blocks = []) {
        const sourceIds = new Set(getSourceMessageIdsFromBlocks(blocks));
        const context = getContext();
        const sourceChat = context.chat || getChat() || [];
        const recentStart = Math.max(0, sourceChat.length - 12);
        return sourceChat
            .map((message, messageId) => ({ message, messageId }))
            .filter(({ message }) => message?.mes && !message.is_system)
            .filter(({ messageId }) => sourceIds.has(messageId) || messageId >= recentStart)
            .map(({ message, messageId }) => `${message.is_user ? context.name1 || '用户' : context.name2 || '助手'} #${messageId}: ${stripHtml(message.mes || '')}`)
            .reverse();
    }
    
    function getWorldInfoGlobalScanData() {
        const context = getContext();
        const character = getCurrentCharacterForReference();
        const data = character?.data || {};
        return {
            trigger: 'quiet',
            personaDescription: String(context.powerUserSettings?.persona_description || ''),
            characterDescription: String(character?.description || data.description || ''),
            characterPersonality: String(character?.personality || data.personality || ''),
            characterDepthPrompt: String(data.extensions?.depth_prompt?.prompt || data.character_depth_prompt || ''),
            scenario: String(character?.scenario || data.scenario || ''),
            creatorNotes: String(character?.creator_notes || data.creator_notes || ''),
        };
    }
    
    async function getWorldInfoReferenceContext(blocks = [], state = ensureState()) {
        if (!state.turnSummary.includeWorldInfo) {
            return '';
        }
        const context = getContext();
        if (typeof context.getWorldInfoPrompt !== 'function') {
            return '';
        }
        try {
            const result = await context.getWorldInfoPrompt(
                buildWorldInfoScanMessages(blocks),
                Math.max(1024, Number(state.turnSummary.worldInfoMaxContext || 4096)),
                true,
                getWorldInfoGlobalScanData(),
            );
            return String(result?.worldInfoString || '').trim();
        } catch (error) {
            console.warn('[BakemonoMemory] failed to read world info for turn summary', error);
            toastr.warning(`世界书参考读取失败：${error?.message || error}`);
            return '';
        }
    }
    
    async function buildTurnReferenceSystemPrompt(blocks, purpose = 'summary', state = ensureState()) {
        const sections = [];
        if (state.turnSummary.includeCharacterContext !== false) {
            const characterContext = getCharacterReferenceContext();
            if (characterContext) {
                sections.push(`## 角色卡/人设参考\n${characterContext}`);
            }
        }
        const worldInfo = await getWorldInfoReferenceContext(blocks, state);
        if (worldInfo) {
            sections.push(`## 世界书命中参考\n${worldInfo}`);
        }
        const manual = String(state.turnSummary.referenceContext || '').trim();
        if (manual) {
            sections.push(`## 用户手动参考资料\n${manual}`);
        }
        const base = purpose === 'table'
            ? '你是剧情剪辑台的表格整理助手。只输出 tableThink 和 tableEdit，不写正文。'
            : '你是剧情剪辑台的正文摘要器。只总结输入正文，不续写剧情。输出必须包含 summaryDraft 标签。';
        return sections.length
            ? `${base}\n\n以下是摘要/填表时必须参考的人设与世界观资料。它们只用于理解正文，不代表本轮新发生事件；不要把参考资料当成本轮剧情直接写入。\n\n${sections.join('\n\n')}`
            : base;
    }
    
    
    
    
    
    
    
    
    
    
    
    
    async function processLatestTurnSummary(options = {}) {
        const state = ensureState();
        const mode = state.turnSummary.processingMode || turnProcessingModes.BOTH;
        const shouldGenerateSummary = mode !== turnProcessingModes.TABLE;
        const shouldGenerateTable = mode !== turnProcessingModes.SUMMARY && state.tableDatabase.enabled && state.tableDatabase.tables.length;
        if (!shouldGenerateSummary && shouldGenerateTable) {
            await processLatestTableEdit(options);
            return;
        }
        if (!shouldGenerateSummary || (!state.turnSummary.enabled && !options.manual)) {
            return;
        }
        const turn = findLatestAssistantTurn();
        if (!turn) {
            toastr.info('没有找到可处理的最新正文。');
            return;
        }
        if (!options.manual && state.turnSummary.lastProcessedMessageId === turn.assistantMessage.messageId) {
            return;
        }
        if (!options.manual && hasAppliedTableEditForMessage(turn.assistantMessage.messageId, state)) {
            state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.TABLES, '本楼已经通过随正文表格修改应用过表格内容，已跳过回复后填表。');
            return;
        }
        const blocks = buildLatestTurnBlocks(state);
        if (!blocks.length) {
            toastr.info('最新正文为空，无法摘要。');
            return;
        }
    
        await runGeneration(options.manual ? '正在处理最新正文...' : '正在自动生成正文摘要草稿...', async () => {
            const summaryResult = await callGenerationModel({
                prompt: buildTurnSummaryPrompt(blocks, state),
                systemPrompt: await buildTurnReferenceSystemPrompt(blocks, 'summary', state),
            });
            const summaryContent = normalizeGeneratedBakemono(extractTaggedContent(summaryResult, 'summaryDraft') || summaryResult);
            const summaryDraft = createDraft({
                kind: blockTypes.STORY,
                content: summaryContent,
                sourceHashes: [],
                sourceMessageIds: getSourceMessageIdsFromBlocks(blocks),
                prompt: buildTurnSummaryPrompt(blocks, state),
                trigger: options.manual ? 'turn_manual' : 'turn_auto',
                metadata: {
                    sourceKind: 'turn',
                    sourceRange: formatSourceRange(getSourceMessageIdsFromBlocks(blocks)),
                    sourceSortKey: getSourceStart(getSourceMessageIdsFromBlocks(blocks)),
                },
            });
            if (state.turnSummary.saveMode === 'commit') {
                await commitDraft(summaryDraft.id, summaryDraft.content, { silent: true });
            }
    
            if (shouldGenerateTable && !hasAppliedTableEditForMessage(turn.assistantMessage.messageId, state)) {
                const tableResult = await callGenerationModel({
                    prompt: buildTableEditPrompt(blocks, state),
                    systemPrompt: await buildTurnReferenceSystemPrompt(blocks, 'table', state),
                });
                try {
                    const draft = createTableEditDraft(tableResult, blocks, state);
                    if (draft && state.tableDatabase.autoApply) {
                        const undoSnapshot = applyTableOperations(draft.operations, state, {
                            sourceMessageIds: draft.sourceMessageIds,
                            undoLabel: `回复后表格修改：${formatSourceRange(draft.sourceMessageIds || [])}`,
                        });
                        state.tableDatabase.history.unshift({ ...draft, appliedAt: new Date().toISOString(), undoSnapshotId: undoSnapshot?.id || '' });
                        state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draft.id);
                    }
                } catch (error) {
                    toastr.warning(`表格草稿解析失败：${error?.message || error}`);
                }
            }
    
            state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
            saveState();
            updateInjectionFromSummaries();
            const savedText = state.turnSummary.saveMode === 'commit' ? '已保存到长期记忆。' : '摘要进入草稿箱。';
            renderWorkbenchScope(workbenchRenderScopes.TABLES, options.manual ? `最新正文已处理，${savedText}` : `正文摘要已自动生成，${savedText}`);
        }, options.manual ? '最新正文已处理' : '正文摘要草稿已生成', workbenchRenderScopes.TABLES);
    }

    return {
        buildLatestTurnBlocks,
        buildTurnReferenceSystemPrompt,
        buildTurnSummaryPrompt,
        buildWorldInfoScanMessages,
        captureInlineGenerationFromLatestMessage,
        findLatestAssistantTurn,
        getCharacterReferenceContext,
        getCurrentCharacterForReference,
        getWorldInfoGlobalScanData,
        getWorldInfoReferenceContext,
        processLatestTurnSummary,
        scheduleInlineGenerationCapture,
    };
}
