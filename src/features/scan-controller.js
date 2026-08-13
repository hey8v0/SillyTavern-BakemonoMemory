export function createScanController({
    getState,
    getContext,
    getFallbackChat,
    extractConfiguredSegments,
    getSegmentSourceKind,
    getMessageVariantKey,
    getHash,
    classifyBlock,
    getBlockTitle,
    shouldPersistScannedBlock,
    toPlainPreview,
    mergeBlocks,
    unique,
    maxStoredScanPreviewItems,
    saveState,
    syncInjection,
    renderWorkbenchScope,
    workbenchRenderScopes,
    query,
    readRuleFieldsFromUi,
    persistSharedConfigurationFromState,
    toastr,
    confirmDanger,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
}) {
    function scanBakemonoBlocks({ persist = true, render = persist } = {}) {
        const state = getState();
        const scanned = [];
        const scannedForBlocks = [];
        const preview = [];
        const previousBlocks = state.blocks;
        const previousBlockByContent = new Map(previousBlocks.map(block => [block.content, block]));
        const context = getContext();
        const sourceChat = context.chat || getFallbackChat() || [];
        const rules = state.scanRules;
        const includeHidden = rules.includeHidden !== false;

        sourceChat.forEach((message, messageId) => {
            if (!message?.mes || (message.is_system && !includeHidden)) {
                return;
            }
            extractConfiguredSegments(message?.mes, rules).forEach((segment, blockIndex) => {
                const content = segment.content;
                const sourceKind = getSegmentSourceKind(segment);
                const variantKey = getMessageVariantKey(message);
                const hash = getHash(`${segment.mode}|${segment.matchedTag}|${sourceKind}|${messageId}|${variantKey}|${blockIndex}|${content}`);
                const type = classifyBlock(content);
                const block = {
                    hash,
                    type,
                    messageId,
                    blockIndex,
                    title: getBlockTitle(content, `#${messageId}.${blockIndex + 1}`),
                    content,
                    matchedTag: segment.matchedTag,
                    scanMode: segment.mode,
                    sourceKind,
                    sourceIdentity: `${messageId}:${variantKey}:${segment.mode}:${segment.matchedTag}:${blockIndex}`,
                    isHidden: !!message?.is_system,
                };
                scanned.push(block);
                if (shouldPersistScannedBlock(block, state)) {
                    scannedForBlocks.push(block);
                }
                preview.push({
                    hash,
                    type,
                    messageId,
                    blockIndex,
                    matchedTag: segment.matchedTag,
                    scanMode: segment.mode,
                    sourceKind,
                    title: block.title,
                    isHidden: !!message?.is_system,
                    preview: toPlainPreview(content, 180),
                });
            });
        });

        state.blocks = mergeBlocks(state.blocks, scannedForBlocks, state, { replaceScanned: true });
        for (const block of scannedForBlocks) {
            const previous = previousBlockByContent.get(block.content);
            if (previous?.hash && state.coveredBlockHashes.includes(previous.hash)) {
                state.coveredBlockHashes = unique([...state.coveredBlockHashes, block.hash]);
            }
            if (previous?.hash && state.coveredStageHashes.includes(previous.hash)) {
                state.coveredStageHashes = unique([...state.coveredStageHashes, block.hash]);
            }
        }
        state.scanPreview = preview.slice(-maxStoredScanPreviewItems);
        state.lastScanMatchCount = scanned.length;
        state.lastScanAt = new Date().toISOString();

        if (persist) {
            saveState();
        }

        syncInjection();
        if (render) {
            renderWorkbenchScope(workbenchRenderScopes.SCAN, `扫描完成：找到 ${scanned.length} 个可总结片段。`);
        }
        return state.blocks;
    }

    function bindEvents() {
        query('#bakemono-memory-apply-rules').off('click').on('click', () => {
            const state = getState();
            readRuleFieldsFromUi(state);
            scanBakemonoBlocks({ persist: false });
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.SCAN, '扫描规则已应用、刷新预览并同步到所有角色卡。');
            toastr.success('扫描规则已全局保存。');
        });
        query('#bakemono-memory-reset-rules').off('click').on('click', () => {
            const confirmed = confirmDanger(
                '恢复默认扫描与预览规则？',
                ['当前扫描标签、排除标签、分类关键词和手账分段规则会被默认值覆盖。'],
            );
            if (!confirmed) return;
            const state = getState();
            state.scanRules = structuredClone(defaultScanRules);
            state.classificationRules = structuredClone(defaultClassificationRules);
            state.previewLayouts = structuredClone(defaultPreviewLayouts);
            scanBakemonoBlocks({ persist: false });
            persistSharedConfigurationFromState(state);
            renderWorkbenchScope(workbenchRenderScopes.SCAN, '扫描规则已恢复默认。');
        });
    }

    return { bindEvents, scanBakemonoBlocks };
}
