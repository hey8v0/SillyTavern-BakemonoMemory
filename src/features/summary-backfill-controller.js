export function createSummaryBackfillController({
    query,
    getIsBusy,
    getState,
    getContext,
    getFallbackChat,
    parseList,
    stripConfiguredTags,
    extractConfiguredTagBlocks,
    stripPostProcessNoise,
    unique,
    getHash,
    getMessageVariantKey,
    getFiniteMessageIds,
    formatSourceRange,
    getSourceStart,
    getSourceEnd,
    blockTypes,
    defaultAutomation,
    defaultMissingSummaryPrompt,
    buildStoryUserPrompt,
    buildStageSystemPrompt,
    buildTurnReferenceSystemPrompt,
    createDraft,
    enqueueSummaryTask,
    parseMessageRangeInput,
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    confirm,
}) {
    function makeBackfillBatchMetadata(blocks, index, total) {
        const sourceMessageIds = blocks.map(block => block.messageId).filter(Number.isFinite);
        const batchIndex = index + 1;
        const sourceRange = formatSourceRange(sourceMessageIds);
        return {
            batchIndex,
            batchTotal: total,
            sourceRange,
            sourceStart: getSourceStart(sourceMessageIds),
            sourceEnd: getSourceEnd(sourceMessageIds),
            sourceSortKey: getSourceStart(sourceMessageIds),
            suggestedTitle: `旧正文补课 第${batchIndex}批（${sourceRange}）`,
            lockTitle: true,
            sourceKind: 'backfill',
            trigger: 'backfill',
        };
    }

    function buildBackfillBatches(options = {}) {
        const state = getState();
        const sourceChat = getContext().chat || getFallbackChat() || [];
        const excludeTags = parseList(state.scanRules.excludeTags);
        const includeHidden = state.scanRules.includeHidden !== false;
        const batchSize = Math.max(1, Number(state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize));
        const rangeIds = options.rangeIds instanceof Set ? options.rangeIds : null;
        const covered = new Set([
            ...state.coveredBlockHashes,
            ...state.storySummaries.flatMap(summary => summary.sourceHashes || []),
        ]);
        const coveredMessageIds = new Set(state.storySummaries.flatMap(summary => getFiniteMessageIds(summary.sourceMessageIds || [])));
        const rawBlocks = [];

        sourceChat.forEach((message, messageId) => {
            if (rangeIds && !rangeIds.has(messageId)) {
                return;
            }
            if (!message?.mes || (message.is_system && !includeHidden)) {
                return;
            }
            const text = stripConfiguredTags(message.mes, excludeTags).trim();
            if (!text) {
                return;
            }
            const hash = getHash(`backfill|${messageId}|${text}`);
            if (covered.has(hash) || coveredMessageIds.has(messageId)) {
                return;
            }
            rawBlocks.push({
                hash,
                type: blockTypes.STORY,
                messageId,
                blockIndex: 0,
                title: message.is_user ? `用户 #${messageId}` : `助手 #${messageId}`,
                content: text,
                sourceKind: 'raw',
            });
        });

        const batches = [];
        for (let index = 0; index < rawBlocks.length; index += batchSize) {
            batches.push({ blocks: rawBlocks.slice(index, index + batchSize) });
        }
        const total = batches.length;
        batches.forEach((batch, index) => {
            batch.metadata = makeBackfillBatchMetadata(batch.blocks, index, total);
        });
        return batches;
    }

    function getConfiguredSummaryTags(state = getState()) {
        const nonSummaryTags = new Set(['content', 'thinking', 'think', 'reasoning', 'tableedit', 'tablethink']);
        const scanSummaryTags = parseList(state.scanRules.includeTags)
            .filter(tag => tag && !nonSummaryTags.has(String(tag).trim().toLowerCase()));
        return unique([
            ...scanSummaryTags,
            ...parseList(state.vectorMemory?.summaryTags || ''),
            'bakemono',
            'summaryDraft',
        ].filter(Boolean));
    }

    function messageHasConfiguredSummary(message, state = getState()) {
        return extractConfiguredTagBlocks(message?.mes || '', getConfiguredSummaryTags(state)).length > 0;
    }

    function buildMissingSummaryTargets(options = {}) {
        const state = getState();
        const sourceChat = getContext().chat || getFallbackChat() || [];
        const includeHidden = state.scanRules.includeHidden !== false;
        const rangeIds = options.rangeIds instanceof Set ? options.rangeIds : null;
        const excludeTags = unique([...parseList(state.scanRules.excludeTags), ...getConfiguredSummaryTags(state)]);
        const existingSourceHashes = new Set([
            ...state.storySummaries.flatMap(summary => summary.sourceHashes || []),
            ...state.drafts.flatMap(draft => draft.sourceHashes || []),
            ...state.taskQueue.flatMap(task => task.sourceHashes || []),
        ]);
        const targets = [];

        sourceChat.forEach((message, messageId) => {
            if (rangeIds && !rangeIds.has(messageId)) {
                return;
            }
            if (!message?.mes || message.is_user || (message.is_system && !includeHidden)) {
                return;
            }
            if (messageHasConfiguredSummary(message, state)) {
                return;
            }
            const rawText = String(message.mes || '');
            const cleaned = stripConfiguredTags(stripPostProcessNoise(rawText), excludeTags).trim();
            if (!cleaned) {
                return;
            }
            const sourceHash = getHash(`missing-summary|${messageId}|${getMessageVariantKey(message)}|${cleaned}`);
            if (existingSourceHashes.has(sourceHash)) {
                return;
            }
            targets.push({
                hash: sourceHash,
                type: blockTypes.STORY,
                messageId,
                blockIndex: 0,
                title: `助手 #${messageId}`,
                content: cleaned,
                sourceKind: 'missing_summary',
                targetMessageHash: getHash(rawText),
            });
        });

        return targets;
    }

    function buildMissingSummaryBatches(targets, batchSize) {
        const size = Math.max(1, Number(batchSize || 1));
        const batches = [];
        for (let index = 0; index < targets.length; index += size) {
            const blocks = targets.slice(index, index + size);
            const ids = blocks.map(block => block.messageId).filter(Number.isFinite);
            batches.push({
                blocks,
                metadata: {
                    batchIndex: batches.length + 1,
                    batchTotal: Math.ceil(targets.length / size),
                    sourceRange: formatSourceRange(ids),
                    sourceStart: getSourceStart(ids),
                    sourceEnd: getSourceEnd(ids),
                    sourceSortKey: getSourceStart(ids),
                    sourceKind: 'missing_summary_batch',
                    trigger: 'missing_summary',
                },
            });
        }
        return batches;
    }

    function buildMissingSummaryBatchPrompt(blocks, metadata = {}, state = getState()) {
        const basePrompt = state.generationPrompts?.missing || defaultMissingSummaryPrompt;
        const template = String(basePrompt || '').trim();
        const blockText = blocks.map(block => [
            `===楼层#${block.messageId}===`,
            block.content,
            `===楼层#${block.messageId}结束===`,
        ].join('\n')).join('\n\n');
        const sourceStart = getSourceStart(blocks.map(block => block.messageId));
        const sourceEnd = getSourceEnd(blocks.map(block => block.messageId));
        const replacements = {
            blocks: blockText,
            batchIndex: metadata.batchIndex ?? '',
            batchTotal: metadata.batchTotal ?? '',
            sourceRange: metadata.sourceRange || formatSourceRange(blocks.map(block => block.messageId)),
            startFloor: Number.isFinite(sourceStart) && sourceStart < Number.MAX_SAFE_INTEGER ? sourceStart : '未知',
            endFloor: Number.isFinite(sourceEnd) && sourceEnd < Number.MAX_SAFE_INTEGER ? sourceEnd : '未知',
            suggestedTitle: metadata.suggestedTitle || '补写缺失摘要',
        };
        let rendered = template || defaultMissingSummaryPrompt;
        const hadBlocksPlaceholder = rendered.includes('{{blocks}}');
        for (const [key, value] of Object.entries(replacements)) {
            rendered = rendered.replaceAll(`{{${key}}}`, String(value));
        }
        if (!hadBlocksPlaceholder) {
            rendered = `${rendered}\n\n待补写楼层：\n${blockText}`;
        }
        return rendered.trim();
    }

    function createMissingSummaryDraftFromBatchItem(item, task) {
        return createDraft({
            kind: blockTypes.STORY,
            content: item.content,
            sourceHashes: [item.target.hash],
            sourceMessageIds: [item.target.messageId],
            prompt: task.prompt,
            trigger: task.trigger || 'missing_summary',
            metadata: {
                ...(task.metadata || {}),
                sourceKind: 'missing_summary',
                sourceRange: formatSourceRange([item.target.messageId]),
                sourceSortKey: item.target.messageId,
                targetMessageId: item.target.messageId,
                targetMessageHash: item.target.targetMessageHash,
                appendMode: 'missing_summary',
                suggestedTitle: `补写摘要 #${item.target.messageId}`,
                missingBatchTaskId: task.id,
                missingBatchRange: task.metadata?.sourceRange || '',
                missingBatchIndex: task.metadata?.batchIndex || '',
                missingBatchTotal: task.metadata?.batchTotal || '',
            },
        });
    }

    function getBatchSummaryRangeIdsFromUi() {
        const raw = String(query('#bakemono-memory-batch-summary-range').val() || '').trim();
        if (!raw) {
            return { ids: null, invalid: [] };
        }
        const parsed = parseMessageRangeInput(raw);
        return { ids: new Set(parsed.ids), invalid: parsed.invalid || [] };
    }

    function readBatchSummarySettingsFromUi(state = getState()) {
        const input = query('#bakemono-memory-batch-summary-size');
        if (input.length) {
            state.automation.backfillBatchSize = Math.max(1, Number(input.val() || state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize));
            saveState();
        }
        return state;
    }

    async function generateBatchSummaryQueue() {
        readBatchSummarySettingsFromUi();
        const mode = String(query('#bakemono-memory-batch-summary-mode').val() || 'missing');
        const { ids, invalid } = getBatchSummaryRangeIdsFromUi();
        if (invalid.length) {
            toastr.warning(`这些范围没有识别：${invalid.join(', ')}`);
        }
        if (mode === 'backfill') {
            await generateBackfillQueue({ rangeIds: ids });
            return;
        }
        await generateMissingSummaryQueue({ rangeIds: ids });
    }

    async function generateMissingSummaryQueue(options = {}) {
        if (getIsBusy()) {
            return;
        }

        const state = getState();
        const targets = buildMissingSummaryTargets(options);
        if (!targets.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '没有找到缺失摘要的助手楼层。');
            toastr.info('没有找到缺失摘要的助手楼层。');
            return;
        }

        const batchSize = Math.max(1, Number(state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize));
        const batches = buildMissingSummaryBatches(targets, batchSize);
        const confirmed = confirmDanger(
            `补写 ${targets.length} 个缺失摘要？`,
            [
                `将按每批 ${batchSize} 楼加入 ${batches.length} 个批次任务。`,
                `预计最多调用 ${batches.length} 次生成 API，而不是 ${targets.length} 次。`,
                '每个批次会返回多个楼层摘要；插件会拆成逐楼草稿，确认保存后才会追加回原正文。',
                `范围：${formatSourceRange(targets.map(block => block.messageId))}`,
            ],
        );
        if (!confirmed) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消补写缺失摘要。');
            return;
        }

        for (const [index, batch] of batches.entries()) {
            const prompt = buildMissingSummaryBatchPrompt(batch.blocks, batch.metadata, state);
            enqueueSummaryTask({
                kind: blockTypes.STORY,
                label: `补写缺失摘要 第 ${index + 1}/${batches.length} 批（${batch.metadata.sourceRange}）`,
                prompt,
                systemPrompt: await buildTurnReferenceSystemPrompt(batch.blocks, 'summary', state),
                sourceHashes: batch.blocks.map(block => block.hash),
                sourceMessageIds: batch.blocks.map(block => block.messageId),
                trigger: 'missing_summary_batch',
                metadata: {
                    ...batch.metadata,
                    appendMode: 'missing_summary_batch',
                    missingTargets: batch.blocks.map(block => ({
                        hash: block.hash,
                        messageId: block.messageId,
                        targetMessageHash: block.targetMessageHash,
                        title: block.title,
                    })),
                },
            });
        }
        renderWorkbenchScope(workbenchRenderScopes.SUMMARY, `已加入 ${batches.length} 个缺失摘要批次任务。`);
        toastr.success(`已加入 ${batches.length} 个补写批次任务。`);
    }

    async function generateBackfillQueue(options = {}) {
        if (getIsBusy()) {
            return;
        }

        const batches = buildBackfillBatches(options);
        if (!batches.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '没有找到可补课的旧正文。');
            toastr.info('没有找到可补课的旧正文。');
            return;
        }

        const confirmed = confirm([
            `将按 ${batches.length} 批加入旧正文摘要任务。`,
            '队列会逐个生成草稿，生成后仍需要你确认保存。',
            '继续吗？',
        ].join('\n'));
        if (!confirmed) {
            return;
        }

        for (const [index, batch] of batches.entries()) {
            const prompt = buildStoryUserPrompt(batch.blocks, batch.metadata);
            enqueueSummaryTask({
                kind: blockTypes.STORY,
                label: `旧正文补课 ${index + 1}/${batches.length}`,
                prompt,
                systemPrompt: buildStageSystemPrompt(),
                sourceHashes: batch.blocks.map(block => block.hash),
                sourceMessageIds: batch.blocks.map(block => block.messageId),
                trigger: 'backfill',
                metadata: batch.metadata,
            });
        }
        renderWorkbenchScope(workbenchRenderScopes.SUMMARY, `已加入 ${batches.length} 个旧正文补课任务。`);
    }

    return {
        buildBackfillBatches,
        buildMissingSummaryBatches,
        buildMissingSummaryBatchPrompt,
        buildMissingSummaryTargets,
        createMissingSummaryDraftFromBatchItem,
        generateBackfillQueue,
        generateBatchSummaryQueue,
        generateMissingSummaryQueue,
        getConfiguredSummaryTags,
        makeBackfillBatchMetadata,
        messageHasConfiguredSummary,
        readBatchSummarySettingsFromUi,
    };
}
