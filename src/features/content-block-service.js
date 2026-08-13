export function createContentBlockService({
    documentRef,
    getState,
    parseList,
    stripConfiguredTags,
    extractConfiguredTagBlocks,
    matchesAnyKeyword,
    blockTypes,
    workflowModes,
    stageSourceModes,
    getBlockSortKey,
}) {
    function stripHtml(value) {
        const template = documentRef.createElement('template');
        template.innerHTML = value;
        return template.content.textContent || '';
    }

    function toPlainPreview(value, maxLength = 420) {
        const text = stripHtml(value).replace(/\n{3,}/g, '\n\n').trim();
        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    }

    function getBlockPlainText(block) {
        return stripHtml(String(block || '')
            .replace(/<\/?(bakemono|details)[^>]*>/gi, '')
            .replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, ''))
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function extractConfiguredSegments(text, rules = getState().scanRules) {
        if (!text) {
            return [];
        }

        const includeTags = parseList(rules.includeTags);
        const excludeTags = parseList(rules.excludeTags);
        const stripped = stripConfiguredTags(text, excludeTags);
        const mode = rules.mode === 'full' ? 'full' : 'tag';

        if (mode === 'tag') {
            return extractConfiguredTagBlocks(stripped, includeTags.length ? includeTags : ['bakemono'])
                .map(segment => ({ ...segment, mode }));
        }

        if (includeTags.length) {
            const tagSegments = extractConfiguredTagBlocks(stripped, includeTags);
            if (tagSegments.length) {
                return tagSegments.map(segment => ({ ...segment, mode }));
            }
        }

        const minLength = Math.max(0, Number(rules.fullTextMinLength || 0));
        const content = stripped.trim();
        return content.length >= minLength ? [{ content, matchedTag: '全文', mode }] : [];
    }

    function extractBakemonoBlocks(text) {
        if (!text) {
            return [];
        }

        const matches = String(text).match(/<bakemono\b[^>]*>[\s\S]*?<\/bakemono>/gi);
        return matches ? matches.map(block => block.trim()).filter(Boolean) : [];
    }

    function classifyBlock(block) {
        const state = getState();
        const text = stripHtml(block);
        if (matchesAnyKeyword(text, parseList(state.classificationRules.epic))) {
            return blockTypes.EPIC;
        }
        if (matchesAnyKeyword(text, parseList(state.classificationRules.stage))) {
            return blockTypes.STAGE;
        }
        return blockTypes.STORY;
    }

    function getBlockTitle(block, fallback) {
        const summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
        if (summaryMatch?.[1]) {
            return stripHtml(summaryMatch[1]).trim() || fallback;
        }

        const titleMatch = block.match(/【([^】]+)】/);
        if (titleMatch?.[1]) {
            return titleMatch[1].trim();
        }

        return fallback;
    }

    function getMessageVariantKey(message) {
        if (!message || typeof message !== 'object') {
            return '';
        }
        if (message.swipe_id !== undefined) {
            return `swipe:${message.swipe_id}`;
        }
        if (message.swipeId !== undefined) {
            return `swipe:${message.swipeId}`;
        }
        if (Array.isArray(message.swipes) && message.mes) {
            const index = message.swipes.indexOf(message.mes);
            if (index >= 0) {
                return `swipe:${index}`;
            }
        }
        return '';
    }

    function getSegmentSourceKind(segment) {
        if (segment?.mode !== 'full') {
            return 'tag';
        }
        const includeTags = parseList(getState().scanRules.includeTags).map(tag => tag.toLowerCase());
        const matchedTag = String(segment.matchedTag || '').toLowerCase();
        return includeTags.includes(matchedTag) ? 'tag' : 'raw';
    }

    function shouldPersistScannedBlock(block, state = getState()) {
        if (block.sourceKind !== 'raw') {
            return true;
        }
        return state.workflowMode !== workflowModes.GENERIC
            || [stageSourceModes.RAW, stageSourceModes.MIXED, stageSourceModes.AUTO].includes(state.stageSourceMode);
    }

    function isPersistentMemoryBlock(block, state = getState()) {
        const summaryHashes = new Set([
            ...state.storySummaries,
            ...state.stageSummaries,
            ...state.epicSummaries,
        ].map(summary => summary.hash));
        return !!block?.isGeneratedSummary
            || summaryHashes.has(block?.hash)
            || (Number(block?.messageId) >= Number.MAX_SAFE_INTEGER && ((block?.sourceHashes || []).length || (block?.sourceStageHashes || []).length));
    }

    function mergeBlocks(existing, scanned, state = getState(), options = {}) {
        const scannedByHash = new Map(scanned.map(block => [block.hash, block]));
        const scannedByLegacyContent = new Map(scanned.map(block => [block.content, block]));
        const merged = [];
        const seen = new Set();

        for (const block of existing) {
            const fresh = scannedByHash.get(block.hash) || (!block.matchedTag ? scannedByLegacyContent.get(block.content) : null);
            if (fresh) {
                merged.push({ ...block, ...fresh });
                seen.add(block.hash);
                seen.add(fresh.hash);
            } else if (!options.replaceScanned || isPersistentMemoryBlock(block, state)) {
                merged.push(block);
                seen.add(block.hash);
            }
        }

        for (const block of scanned) {
            if (!seen.has(block.hash)) {
                merged.push(block);
            }
        }

        return merged.sort((a, b) => (getBlockSortKey(a) - getBlockSortKey(b)) || (a.blockIndex - b.blockIndex));
    }

    function getBlocksByType(type) {
        return getState().blocks.filter(block => block.type === type);
    }

    return {
        classifyBlock,
        extractBakemonoBlocks,
        extractConfiguredSegments,
        getBlockPlainText,
        getBlocksByType,
        getBlockTitle,
        getMessageVariantKey,
        getSegmentSourceKind,
        isPersistentMemoryBlock,
        mergeBlocks,
        shouldPersistScannedBlock,
        stripHtml,
        toPlainPreview,
    };
}
