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
    let cachedState = null;
    let cachedRules = '';
    let messageCache = [];
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
        const rulesKey = JSON.stringify([rules, state.classificationRules, state.previewLayouts]);
        if (cachedState !== state || rulesKey !== cachedRules) {
            messageCache = [];
            cachedState = state;
            cachedRules = rulesKey;
        }
        const includeHidden = rules.includeHidden !== false;

        sourceChat.forEach((message, messageId) => {
            if (!message?.mes || (message.is_system && !includeHidden)) {
                return;
            }
            const variantKey = getMessageVariantKey(message);
            let cached = messageCache[messageId];
            if (!cached || cached.text !== message.mes || cached.variant !== variantKey || cached.hidden !== !!message.is_system) {
                cached = { text: message.mes, variant: variantKey, hidden: !!message.is_system,
                    blocks: extractConfiguredSegments(message.mes, rules).map((segment, blockIndex) => {
                const content = segment.content;
                const sourceKind = getSegmentSourceKind(segment);
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
                return block;
                    }),
                };
                messageCache[messageId] = cached;
            }
            cached.blocks.forEach(block => {
                const { content, hash, type, blockIndex, matchedTag, scanMode, sourceKind } = block;
                scanned.push(block);
                if (shouldPersistScannedBlock(block, state)) {
                    scannedForBlocks.push(block);
                }
                preview.push({
                    hash,
                    type,
                    messageId,
                    blockIndex,
                    matchedTag,
                    scanMode,
                    sourceKind,
                    title: block.title,
                    isHidden: !!message?.is_system,
                    preview: toPlainPreview(content, 180),
                });
            });
        });
        messageCache.length = sourceChat.length;

        state.blocks = mergeBlocks(state.blocks, scannedForBlocks, state, { replaceScanned: true });
        const coveredBlocks = new Set(state.coveredBlockHashes);
        const coveredStages = new Set(state.coveredStageHashes);
        for (const block of scannedForBlocks) {
            const previous = previousBlockByContent.get(block.content);
            if (previous?.hash && coveredBlocks.has(previous.hash)) coveredBlocks.add(block.hash);
            if (previous?.hash && coveredStages.has(previous.hash)) coveredStages.add(block.hash);
        }
        state.coveredBlockHashes = [...coveredBlocks];
        state.coveredStageHashes = [...coveredStages];
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
