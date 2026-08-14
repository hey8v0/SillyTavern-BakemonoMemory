export function createSummaryGenerationController({
    getIsBusy,
    scanBlocks,
    getState,
    getUnsummarizedStoryBlocks,
    getAutoStageTargets,
    getUnsummarizedStageBlocks,
    getUnsummarizedMultiSummaryBlocks,
    getStoryMaterialBlocks,
    readGenerationTargetSettings,
    promptGenerationTargetSelection,
    selectGenerationTargets,
    partitionGenerationTargets,
    findTargetContinuityGaps,
    getFloorMemoryIndex,
    confirmGenerationTargets,
    getTargetSelectionLabel,
    getStageSourceMode,
    renderGenerationPrompt,
    defaultStoryGenerationPrompt,
    getSourceMessageIdsFromBlocks,
    enqueueSummaryTask,
    processTaskQueue,
    blockTypes,
    defaultGenerationTargets,
    getSourceStart,
    getSourceEnd,
    formatSourceRange,
    getNextMultiSummaryLevel,
    getMultiSummaryLabel,
    unique,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    confirm,
}) {
    function buildStageSystemPrompt() {
        return '你是剧情剪辑台的总结器。严格遵守用户提供的总结模板；只总结输入材料，不续写剧情，不扮演角色，不新增事件；不要输出寒暄、解释或 Markdown 代码围栏。';
    }

    function buildEpicSystemPrompt() {
        return buildStageSystemPrompt();
    }

    function buildStageUserPrompt(blocks) {
        return renderGenerationPrompt(getState().generationPrompts.stage, blocks);
    }

    function buildEpicUserPrompt(blocks) {
        return renderGenerationPrompt(getState().generationPrompts.epic, blocks);
    }

    function buildStoryUserPrompt(blocks, context = {}) {
        return renderGenerationPrompt(getState().generationPrompts.story || defaultStoryGenerationPrompt, blocks, context);
    }

    function confirmStageContinuity(targets, { automatic = false } = {}) {
        const gaps = findTargetContinuityGaps(targets, getFloorMemoryIndex(getState())?.records || []);
        if (!gaps.length) {
            return true;
        }
        const floorPreview = gaps.slice(0, 12).map(record => `第 ${record.id} 楼`).join('、');
        const overflow = gaps.length > 12 ? `等 ${gaps.length} 楼` : '';
        const status = `发现 ${gaps.length} 个助手楼层尚未保存摘要：${floorPreview}${overflow}`;
        if (automatic) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, `${status}。已暂停自动阶段总结，请先补写缺失摘要。`);
            toastr.warning('阶段总结已暂停：请先补齐缺失摘要。');
            return false;
        }
        return confirmDanger(
            '阶段材料中间存在记忆缺口，仍要继续吗？',
            [
                status,
                '建议先在“扫描与识别”中补写缺失摘要，避免后续阶段总结永久跳过这些楼层。',
                '只有确认这些楼层不需要记忆时，才继续生成。',
            ],
        );
    }

    async function generateStageDraft(options = {}) {
        if (getIsBusy()) {
            return;
        }

        scanBlocks({ persist: false });
        const state = getState();
        const allTargets = getUnsummarizedStoryBlocks();
        if (!allTargets.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '没有新的剧情摘要需要生成阶段总结。');
            toastr.info('没有新的剧情摘要需要生成阶段总结。');
            return;
        }
        let targetConfig = state.generationTargets.stage;
        if (!options.automatic) {
            readGenerationTargetSettings();
            targetConfig = await promptGenerationTargetSelection('stage', allTargets.length);
            if (!targetConfig) {
                renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消阶段总结生成。');
                return;
            }
        }
        const targets = options.automatic
            ? getAutoStageTargets(allTargets)
            : selectGenerationTargets(allTargets, targetConfig);
        if (!targets.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '当前生成范围没有匹配到可总结摘要。');
            toastr.warning('当前生成范围没有匹配到可总结摘要。');
            return;
        }
        if (!confirmStageContinuity(targets, { automatic: !!options.automatic })) {
            return;
        }
        if (!options.automatic && !confirmGenerationTargets('stage', targets, allTargets.length)) {
            return;
        }

        const prompt = buildStageUserPrompt(targets);
        const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
        enqueueSummaryTask({
            kind: blockTypes.STAGE,
            label: `阶段总结 · ${targets.length} 个片段`,
            prompt,
            systemPrompt: buildStageSystemPrompt(),
            sourceHashes: targets.map(block => block.hash),
            sourceMessageIds,
            trigger: options.automatic ? 'auto' : 'manual',
            metadata: {
                sourceRange: formatSourceRange(sourceMessageIds),
                sourceStart: getSourceStart(sourceMessageIds),
                sourceEnd: getSourceEnd(sourceMessageIds),
                sourceSortKey: getSourceStart(sourceMessageIds),
                sourceMode: getStageSourceMode(),
                selectionLabel: options.automatic
                    ? `自动取最早一批：${targets.length}/${allTargets.length} 个`
                    : getTargetSelectionLabel('stage', targets.length, allTargets.length),
            },
        });
    }

    async function generateStageBatchTasks() {
        if (getIsBusy()) {
            return;
        }

        scanBlocks({ persist: false });
        const state = getState();
        readGenerationTargetSettings();
        const allTargets = getUnsummarizedStoryBlocks();
        if (!allTargets.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '没有新的剧情摘要需要生成阶段总结。');
            toastr.info('没有新的剧情摘要需要生成阶段总结。');
            return;
        }

        const targetConfig = await promptGenerationTargetSelection('stage', allTargets.length, { batch: true });
        if (!targetConfig) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消批量阶段总结。');
            return;
        }

        const config = targetConfig || state.generationTargets.stage || defaultGenerationTargets.stage;
        const batches = partitionGenerationTargets(allTargets, 'stage', config);
        if (!batches.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '当前批量范围没有匹配到可总结摘要。');
            toastr.warning('当前批量范围没有匹配到可总结摘要。');
            return;
        }

        if (!confirmStageContinuity(batches.flat())) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消批量阶段总结，请先补齐缺失摘要。');
            return;
        }

        const totalTargets = batches.reduce((sum, batch) => sum + batch.length, 0);
        const confirmed = confirmDanger(
            `加入 ${batches.length} 个阶段总结批次任务？`,
            [
                `将覆盖 ${totalTargets}/${allTargets.length} 个普通摘要。`,
                `每批最多 ${Math.max(1, Number(config.count || defaultGenerationTargets.stage.count))} 个摘要。`,
                '生成结果会进入待确认草稿，不会自动保存。',
            ],
        );
        if (!confirmed) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消批量阶段总结。');
            return;
        }

        batches.forEach((targets, index) => {
            const prompt = buildStageUserPrompt(targets);
            const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
            enqueueSummaryTask({
                kind: blockTypes.STAGE,
                label: `阶段总结 第 ${index + 1}/${batches.length} 批 · ${targets.length} 个片段`,
                prompt,
                systemPrompt: buildStageSystemPrompt(),
                sourceHashes: targets.map(block => block.hash),
                sourceMessageIds,
                trigger: 'batch_stage',
                metadata: {
                    sourceRange: formatSourceRange(sourceMessageIds),
                    sourceStart: getSourceStart(sourceMessageIds),
                    sourceEnd: getSourceEnd(sourceMessageIds),
                    sourceSortKey: getSourceStart(sourceMessageIds),
                    sourceMode: getStageSourceMode(),
                    batchIndex: index + 1,
                    batchTotal: batches.length,
                    selectionLabel: `批量阶段总结：第 ${index + 1}/${batches.length} 批，${targets.length}/${allTargets.length} 个`,
                },
                autoStart: false,
                silent: true,
            });
        });

        renderWorkbenchScope(workbenchRenderScopes.SUMMARY, `已加入 ${batches.length} 个阶段总结批次任务。`);
        toastr.success(`已加入 ${batches.length} 个阶段总结批次任务。`);
        processTaskQueue();
    }

    async function generateEpicDraft(options = {}) {
        if (getIsBusy()) {
            return;
        }

        scanBlocks({ persist: false });
        const state = getState();
        const allStageTargets = getUnsummarizedStageBlocks();
        const allMultiTargets = getUnsummarizedMultiSummaryBlocks();
        const allStoryFallback = getStoryMaterialBlocks().filter(block => !state.coveredBlockHashes.includes(block.hash));
        if (!allStageTargets.length && !allMultiTargets.length && !allStoryFallback.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '没有可用于生成多次总结的内容。');
            toastr.info('没有可用于生成多次总结的内容。');
            return;
        }
        let targetConfig = state.generationTargets.epic;
        if (!options.automatic) {
            readGenerationTargetSettings();
            targetConfig = await promptGenerationTargetSelection('epic', allStageTargets.length || allMultiTargets.length || allStoryFallback.length);
            if (!targetConfig) {
                renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消多次总结生成。');
                return;
            }
        }
        const stageTargets = selectGenerationTargets(allStageTargets, targetConfig);
        const multiTargets = selectGenerationTargets(allMultiTargets, targetConfig);
        const storyFallback = selectGenerationTargets(allStoryFallback, targetConfig);
        const targets = stageTargets.length ? stageTargets : multiTargets.length ? multiTargets : storyFallback;
        const nextLevel = getNextMultiSummaryLevel(targets);
        const sourcePoolSize = stageTargets.length ? allStageTargets.length : multiTargets.length ? allMultiTargets.length : allStoryFallback.length;

        if (!targets.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '当前生成范围没有匹配到可用于多次总结的内容。');
            toastr.warning('当前生成范围没有匹配到可用于多次总结的内容。');
            return;
        }

        if (!options.automatic) {
            const latestEpicAt = state.epicSummaries.at(-1)?.createdAt;
            const confirmed = confirm([
                `即将生成【${getMultiSummaryLabel(nextLevel)}】草稿。`,
                '',
                `阶段总结来源：${stageTargets.length}/${allStageTargets.length} 个`,
                `多次总结来源：${multiTargets.length}/${allMultiTargets.length} 个`,
                `普通摘要 fallback：${storyFallback.length}/${allStoryFallback.length} 个`,
                `当前范围：${getTargetSelectionLabel('epic', targets.length, sourcePoolSize)}`,
                `上次多次总结：${latestEpicAt ? new Date(latestEpicAt).toLocaleString() : '尚未生成'}`,
                '',
                '这只会生成待确认草稿，确认保存后才会写入长期记忆。继续吗？',
            ].join('\n'));
            if (!confirmed) {
                renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消多次总结生成。');
                return;
            }
        }

        const prompt = buildEpicUserPrompt(targets);
        enqueueSummaryTask({
            kind: blockTypes.EPIC,
            label: `${getMultiSummaryLabel(nextLevel)} · ${targets.length} 个片段`,
            prompt,
            systemPrompt: buildEpicSystemPrompt(),
            sourceHashes: targets.map(block => block.hash),
            sourceStageHashes: targets.filter(block => block.type === blockTypes.STAGE || block.type === blockTypes.EPIC).map(block => block.hash),
            sourceMessageIds: unique(targets.map(block => block.messageId).filter(Number.isFinite)),
            trigger: options.automatic ? 'auto' : 'manual',
            metadata: {
                sourceRange: formatSourceRange(targets.map(block => block.messageId)),
                sourceStart: getSourceStart(targets.map(block => block.messageId)),
                sourceEnd: getSourceEnd(targets.map(block => block.messageId)),
                sourceSortKey: getSourceStart(targets.map(block => block.messageId)),
                level: nextLevel,
                selectionLabel: getTargetSelectionLabel('epic', targets.length, sourcePoolSize),
            },
        });
    }

    async function generateEpicBatchTasks() {
        if (getIsBusy()) {
            return;
        }

        scanBlocks({ persist: false });
        const state = getState();
        readGenerationTargetSettings();
        const allStageTargets = getUnsummarizedStageBlocks();
        const allMultiTargets = getUnsummarizedMultiSummaryBlocks();
        const allStoryFallback = getStoryMaterialBlocks().filter(block => !state.coveredBlockHashes.includes(block.hash));
        const sourceBlocks = allStageTargets.length ? allStageTargets : allMultiTargets.length ? allMultiTargets : allStoryFallback;
        if (!sourceBlocks.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '没有可用于生成多次总结的内容。');
            toastr.info('没有可用于生成多次总结的内容。');
            return;
        }

        const targetConfig = await promptGenerationTargetSelection('epic', sourceBlocks.length, { batch: true });
        if (!targetConfig) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消批量多次总结。');
            return;
        }

        const config = targetConfig || state.generationTargets.epic || defaultGenerationTargets.epic;
        const batches = partitionGenerationTargets(sourceBlocks, 'epic', config);
        if (!batches.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '当前批量范围没有匹配到可用于多次总结的内容。');
            toastr.warning('当前批量范围没有匹配到可用于多次总结的内容。');
            return;
        }

        const totalTargets = batches.reduce((sum, batch) => sum + batch.length, 0);
        const confirmed = confirmDanger(
            `加入 ${batches.length} 个多次总结批次任务？`,
            [
                `将覆盖 ${totalTargets}/${sourceBlocks.length} 个阶段/多次材料。`,
                `每批最多 ${Math.max(1, Number(config.count || defaultGenerationTargets.epic.count))} 个材料。`,
                '建议先确认并保存已有阶段总结，再批量生成多次总结。',
                '生成结果会进入待确认草稿，不会自动保存。',
            ],
        );
        if (!confirmed) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消批量多次总结。');
            return;
        }

        batches.forEach((targets, index) => {
            const nextLevel = getNextMultiSummaryLevel(targets);
            const prompt = buildEpicUserPrompt(targets);
            const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
            enqueueSummaryTask({
                kind: blockTypes.EPIC,
                label: `${getMultiSummaryLabel(nextLevel)} 第 ${index + 1}/${batches.length} 批 · ${targets.length} 个片段`,
                prompt,
                systemPrompt: buildEpicSystemPrompt(),
                sourceHashes: targets.map(block => block.hash),
                sourceStageHashes: targets.filter(block => block.type === blockTypes.STAGE || block.type === blockTypes.EPIC).map(block => block.hash),
                sourceMessageIds,
                trigger: 'batch_epic',
                metadata: {
                    sourceRange: formatSourceRange(sourceMessageIds),
                    sourceStart: getSourceStart(sourceMessageIds),
                    sourceEnd: getSourceEnd(sourceMessageIds),
                    sourceSortKey: getSourceStart(sourceMessageIds),
                    level: nextLevel,
                    batchIndex: index + 1,
                    batchTotal: batches.length,
                    selectionLabel: `批量多次总结：第 ${index + 1}/${batches.length} 批，${targets.length}/${sourceBlocks.length} 个`,
                },
                autoStart: false,
                silent: true,
            });
        });

        renderWorkbenchScope(workbenchRenderScopes.SUMMARY, `已加入 ${batches.length} 个多次总结批次任务。`);
        toastr.success(`已加入 ${batches.length} 个多次总结批次任务。`);
        processTaskQueue();
    }

    return {
        buildEpicSystemPrompt,
        buildEpicUserPrompt,
        buildStageSystemPrompt,
        buildStageUserPrompt,
        buildStoryUserPrompt,
        generateEpicBatchTasks,
        generateEpicDraft,
        generateStageBatchTasks,
        generateStageDraft,
    };
}
