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

    return { scanBakemonoBlocks };
}
