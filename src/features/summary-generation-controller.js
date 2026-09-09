import { storyTimeContext } from '../memory/story-state.js';

export function selectEpicSourcePool(pools, mode = 'auto') {
    if (['stage', 'epic', 'story'].includes(mode)) return pools[mode] || [];
    return pools.stage?.length ? pools.stage : pools.epic?.length ? pools.epic : pools.story || [];
}

export function inspectSummaryMaterials(blocks = []) {
    const invalid = [];
    let textLength = 0;
    for (const [index, block] of blocks.entries()) {
        const raw = String(block?.content || '');
        let text = raw.replace(/<(script|style|thinking)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
        // HTML disclosure headings are not story content. A custom <summary> body may be.
        if (/<details\b/i.test(text)) text = text.replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi, '');
        text = text.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160|#xA0);/gi, ' ').trim();
        const meaningful = text.replace(/[\s\p{P}\p{S}]/gu, '');
        if (!meaningful || /^(?:剧情摘要|摘要|阶段总结|总结|剧集终了点击回看)$/.test(meaningful)) {
            invalid.push(Number.isFinite(block?.messageId) && block.messageId < Number.MAX_SAFE_INTEGER ? `第 ${block.messageId} 楼` : `第 ${index + 1} 条材料`);
        }
        textLength += text.length;
    }
    return { count: blocks.length, textLength, invalid };
}

function validateSummaryMaterials(blocks) {
    const report = inspectSummaryMaterials(blocks);
    if (!report.count || report.invalid.length) {
        throw new Error(`${report.invalid.slice(0, 8).join('、') || '当前范围'}没有有效剧情内容，已停止生成。请检查“扫描与识别”的读取标签：HTML 的 summary 常常只是标题，应读取包含摘要正文的外层标签；也可检查原摘要是否为空。`);
    }
    return report;
}

export function getSummaryMaterialPreview(blocks = []) {
    const report = inspectSummaryMaterials(blocks);
    const preview = blocks.slice(0, 2).map((block, index) => `${index + 1}. ${String(block.content || '').slice(0, 220)}${String(block.content || '').length > 220 ? '…' : ''}`).join('\n');
    return `材料检查：${report.count} 条，正文约 ${report.textLength} 字。\n实际材料开头（最多前两条，完整材料仍会发送）：\n${preview}`;
}

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
        validateSummaryMaterials(blocks);
        return [storyTimeContext(getState()), renderGenerationPrompt(getState().generationPrompts.stage, blocks)].filter(Boolean).join('\n\n');
    }

    function buildEpicUserPrompt(blocks) {
        validateSummaryMaterials(blocks);
        return [storyTimeContext(getState()), renderGenerationPrompt(getState().generationPrompts.epic, blocks)].filter(Boolean).join('\n\n');
    }

    function buildStoryUserPrompt(blocks, context = {}) {
        return [storyTimeContext(getState()), renderGenerationPrompt(getState().generationPrompts.story || defaultStoryGenerationPrompt, blocks, context)].filter(Boolean).join('\n\n');
    }

    function reportNoStageMaterials(state) {
        const excluded = getStageSourceMode() === 'backfill'
            && getStoryMaterialBlocks('summaries').some(block => !state.coveredBlockHashes.includes(block.hash));
        const message = excluded
            ? '当前选择“仅插件已保存摘要”，正文标签摘要未被纳入。请将“阶段材料”改为“正文标签 + 插件摘要”，无需删除原文或重新补课。'
            : '没有新的剧情摘要需要生成阶段总结。';
        renderWorkbenchScope(workbenchRenderScopes.SUMMARY, message);
        toastr.info(message);
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
            reportNoStageMaterials(state);
            return;
        }
        let targetConfig = state.generationTargets.stage;
        if (!options.automatic) {
            readGenerationTargetSettings();
            targetConfig = await promptGenerationTargetSelection('stage', allTargets.length);
            if (getState() !== state) throw new Error('选择材料期间已切换聊天，请在当前聊天重新选择。');
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
        validateSummaryMaterials(targets);
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
            reportNoStageMaterials(state);
            return;
        }

        const targetConfig = await promptGenerationTargetSelection('stage', allTargets.length, { batch: true });
        if (getState() !== state) throw new Error('选择材料期间已切换聊天，请在当前聊天重新选择。');
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

        const materialReport = validateSummaryMaterials(batches.flat());
        const totalTargets = batches.reduce((sum, batch) => sum + batch.length, 0);
        const confirmed = confirmDanger(
            `加入 ${batches.length} 个阶段总结批次任务？`,
            [
                `将覆盖 ${totalTargets}/${allTargets.length} 个普通摘要。`,
                `有效材料约 ${materialReport.textLength} 字（已排除 HTML 标题和标签计数）。`,
                getSummaryMaterialPreview(batches.flat()),
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
            targetConfig = await promptGenerationTargetSelection('epic', allStageTargets.length || allMultiTargets.length || allStoryFallback.length, { sourceCounts: { stage: allStageTargets.length, epic: allMultiTargets.length, story: allStoryFallback.length } });
            if (getState() !== state) throw new Error('选择材料期间已切换聊天，请在当前聊天重新选择。');
            if (!targetConfig) {
                renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消多次总结生成。');
                return;
            }
        }
        const pool = selectEpicSourcePool({ stage: allStageTargets, epic: allMultiTargets, story: allStoryFallback }, targetConfig.sourceMode);
        const targets = selectGenerationTargets(pool, targetConfig);
        const nextLevel = getNextMultiSummaryLevel(targets);
        const sourcePoolSize = pool.length;

        if (!targets.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '当前生成范围没有匹配到可用于多次总结的内容。');
            toastr.warning('当前生成范围没有匹配到可用于多次总结的内容。');
            return;
        }

        validateSummaryMaterials(targets);
        if (!options.automatic) {
            const latestEpicAt = state.epicSummaries.at(-1)?.createdAt;
            const confirmed = confirm([
                `即将生成【${getMultiSummaryLabel(nextLevel)}】草稿。`,
                '',
                `本次材料：${pool === allStageTargets ? '阶段总结 → 多次总结' : pool === allMultiTargets ? '已有多次总结 → 继续压缩' : '普通摘要 → 多次总结'}，${targets.length}/${sourcePoolSize} 个`,
                `当前范围：${getTargetSelectionLabel('epic', targets.length, sourcePoolSize)}`,
                getSummaryMaterialPreview(targets),
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
        const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
        enqueueSummaryTask({
            kind: blockTypes.EPIC,
            label: `${getMultiSummaryLabel(nextLevel)} · ${targets.length} 个片段`,
            prompt,
            systemPrompt: buildEpicSystemPrompt(),
            sourceHashes: targets.map(block => block.hash),
            sourceStageHashes: targets.filter(block => block.type === blockTypes.STAGE || block.type === blockTypes.EPIC).map(block => block.hash),
            sourceMessageIds,
            trigger: options.automatic ? 'auto' : 'manual',
            metadata: {
                sourceRange: formatSourceRange(sourceMessageIds),
                sourceStart: getSourceStart(sourceMessageIds),
                sourceEnd: getSourceEnd(sourceMessageIds),
                sourceSortKey: getSourceStart(sourceMessageIds),
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
        let sourceBlocks = selectEpicSourcePool({ stage: allStageTargets, epic: allMultiTargets, story: allStoryFallback });
        if (!sourceBlocks.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '没有可用于生成多次总结的内容。');
            toastr.info('没有可用于生成多次总结的内容。');
            return;
        }

        const targetConfig = await promptGenerationTargetSelection('epic', sourceBlocks.length, { batch: true, sourceCounts: { stage: allStageTargets.length, epic: allMultiTargets.length, story: allStoryFallback.length } });
        if (getState() !== state) throw new Error('选择材料期间已切换聊天，请在当前聊天重新选择。');
        if (!targetConfig) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '已取消批量多次总结。');
            return;
        }

        sourceBlocks = selectEpicSourcePool({ stage: allStageTargets, epic: allMultiTargets, story: allStoryFallback }, targetConfig.sourceMode);
        const config = targetConfig || state.generationTargets.epic || defaultGenerationTargets.epic;
        const batches = partitionGenerationTargets(sourceBlocks, 'epic', config);
        if (!batches.length) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, '当前批量范围没有匹配到可用于多次总结的内容。');
            toastr.warning('当前批量范围没有匹配到可用于多次总结的内容。');
            return;
        }

        const materialReport = validateSummaryMaterials(batches.flat());
        const totalTargets = batches.reduce((sum, batch) => sum + batch.length, 0);
        const confirmed = confirmDanger(
            `加入 ${batches.length} 个多次总结批次任务？`,
            [
                `将覆盖 ${totalTargets}/${sourceBlocks.length} 个阶段/多次材料。`,
                `有效材料约 ${materialReport.textLength} 字（已排除 HTML 标题和标签计数）。`,
                getSummaryMaterialPreview(batches.flat()),
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
