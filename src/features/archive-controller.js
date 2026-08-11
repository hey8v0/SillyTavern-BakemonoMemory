export function createArchiveController({
    query,
    getChat,
    getContext,
    scanBakemonoBlocks,
    ensureState,
    blockTypes,
    getFiniteMessageIds,
    unique,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    hideChatMessageRange,
    saveChatConditional,
    saveState,
    defaultState,
    memoryStrategies,
    confirm,
} = {}) {
    let autoHideRecentTimer = null;

    async function hideCoveredMessages(options = {}) {
        scanBakemonoBlocks({ persist: false });
        const state = ensureState();
        const covered = new Set(state.coveredBlockHashes);
        const summaryMessageIds = unique(state.blocks
            .filter(block => block.type === blockTypes.STORY && covered.has(block.hash) && Number.isFinite(block.messageId))
            .flatMap(block => getFiniteMessageIds([block.messageId, ...(block.sourceMessageIds || [])])));
        const preserveRecent = Math.max(0, Number(options.preserveRecent || 0));
        const maxHideId = (getChat()?.length || 0) - preserveRecent - 1;
        const messageIds = collectHideMessageIds(summaryMessageIds)
            .filter(messageId => preserveRecent <= 0 || messageId <= maxHideId);
    
        if (!messageIds.length) {
            if (!options.silent) {
                renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, '没有可隐藏的已总结楼层。');
                toastr.info('没有可隐藏的已总结楼层。');
            }
            return;
        }
    
        if (options.confirm !== false) {
            const confirmed = confirmDanger(
                `隐藏 ${messageIds.length} 个已总结楼层？`,
                [
                    '这些楼层不会被删除，可以用“恢复插件隐藏楼层”找回。',
                    '如果阶段总结不完整，隐藏后可能影响后续上下文。',
                    preserveRecent ? `本次会保留最近 ${preserveRecent} 楼不隐藏。` : '',
                ],
            );
            if (!confirmed) {
                renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, '已取消隐藏楼层。');
                return;
            }
        }
    
        for (const messageId of messageIds) {
            await hideChatMessageRange(messageId, messageId, false);
        }
    
        state.hiddenMessageIds = unique([...state.hiddenMessageIds, ...messageIds]);
        await saveChatConditional();
        saveState();
        scanBakemonoBlocks({ persist: false });
        if (!options.silent) {
            renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, `已隐藏 ${messageIds.length} 个已总结楼层。`);
            toastr.success(`已隐藏 ${messageIds.length} 个楼层。`);
        }
        return messageIds;
    }
    
    function collectHideMessageIds(summaryMessageIds) {
        const ids = new Set();
        for (const messageId of summaryMessageIds) {
            if (!getChat()[messageId]) {
                continue;
            }
    
            ids.add(messageId);
            const pairedUserId = findPairedUserMessageId(messageId);
            if (pairedUserId !== null) {
                ids.add(pairedUserId);
            }
        }
    
        return [...ids].sort((a, b) => a - b);
    }
    
    function findPairedUserMessageId(messageId) {
        for (let index = messageId - 1; index >= 0; index--) {
            const message = getChat()[index];
            if (!message) {
                continue;
            }
            if (message.is_user) {
                return index;
            }
            if (!message.is_system) {
                return null;
            }
        }
        return null;
    }
    
    async function restoreHiddenMessages() {
        const state = ensureState();
        const messageIds = unique(state.hiddenMessageIds).filter(messageId => getChat()[messageId]);
    
        if (!messageIds.length) {
            state.hiddenMessageIds = [];
            saveState();
            renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, '没有可恢复的隐藏楼层。');
            toastr.info('没有可恢复的隐藏楼层。');
            return;
        }
    
        const confirmed = confirmDanger(
            `恢复 ${messageIds.length} 个插件隐藏楼层？`,
            ['恢复后这些楼层会重新进入聊天上下文，可能增加 token。'],
        );
        if (!confirmed) {
            renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, '已取消恢复隐藏楼层。');
            return;
        }
    
        for (const messageId of messageIds) {
            await hideChatMessageRange(messageId, messageId, true);
        }
    
        state.hiddenMessageIds = [];
        await saveChatConditional();
        saveState();
        scanBakemonoBlocks({ persist: false });
        renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, `已恢复 ${messageIds.length} 个楼层。`);
        toastr.success(`已恢复 ${messageIds.length} 个楼层。`);
    }
    
    function getActualHiddenMessageIds() {
        const sourceChat = getContext()?.chat || getChat() || [];
        return sourceChat
            .map((message, index) => ({ message, index }))
            .filter(({ message }) => message?.is_system)
            .map(({ index }) => index);
    }
    
    function parseMessageRangeInput(value) {
        const maxId = Math.max(0, (getChat()?.length || 1) - 1);
        const ids = new Set();
        const invalid = [];
        for (const rawPart of String(value || '').split(/[,，\s]+/).map(item => item.trim()).filter(Boolean)) {
            const match = rawPart.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (!match) {
                invalid.push(rawPart);
                continue;
            }
            let start = Number(match[1]);
            let end = Number(match[2] || match[1]);
            if (start > end) {
                [start, end] = [end, start];
            }
            start = Math.max(0, start);
            end = Math.min(maxId, end);
            for (let id = start; id <= end; id++) {
                if (getChat()[id]) {
                    ids.add(id);
                }
            }
        }
        return { ids: [...ids].sort((a, b) => a - b), invalid };
    }
    
    function getSummaryCoveredMessageIds() {
        const state = ensureState();
        const ids = new Set();
        for (const summary of [...state.storySummaries, ...state.stageSummaries, ...state.epicSummaries]) {
            for (const id of getFiniteMessageIds(summary.sourceMessageIds || [])) {
                ids.add(id);
            }
        }
        for (const stage of state.stageSummaries) {
            for (const hash of stage.sourceHashes || []) {
                const story = state.storySummaries.find(item => item.hash === hash);
                for (const id of getFiniteMessageIds(story?.sourceMessageIds || [])) {
                    ids.add(id);
                }
            }
        }
        for (const epic of state.epicSummaries) {
            for (const hash of [...(epic.sourceStageHashes || []), ...(epic.sourceHashes || [])]) {
                const stage = state.stageSummaries.find(item => item.hash === hash);
                const story = state.storySummaries.find(item => item.hash === hash);
                for (const id of getFiniteMessageIds([...(stage?.sourceMessageIds || []), ...(story?.sourceMessageIds || [])])) {
                    ids.add(id);
                }
            }
        }
        return ids;
    }
    
    function getRangePreviewText(ids, invalid = []) {
        if (!ids.length) {
            return invalid.length ? `没有有效楼层。无法识别：${invalid.join(', ')}` : '没有有效楼层。';
        }
        const hidden = ids.filter(id => getChat()[id]?.is_system).length;
        const coveredIds = getSummaryCoveredMessageIds();
        const covered = ids.filter(id => coveredIds.has(id)).length;
        const parts = [
            `范围内 ${ids.length} 楼`,
            `已隐藏 ${hidden} 楼`,
            `已有摘要覆盖 ${covered} 楼`,
            `未覆盖 ${ids.length - covered} 楼`,
        ];
        if (invalid.length) {
            parts.push(`无法识别：${invalid.join(', ')}`);
        }
        return parts.join(' · ');
    }
    
    function previewMessageRange() {
        const { ids, invalid } = parseMessageRangeInput(query('#bakemono-memory-range-input').val());
        const text = getRangePreviewText(ids, invalid);
        query('#bakemono-memory-range-preview').text(text);
        renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, text);
    }
    
    function getVisibleMessageIds() {
        return (getChat() || [])
            .map((message, index) => ({ message, index }))
            .filter(({ message }) => message && !message.is_system)
            .map(({ index }) => index);
    }
    
    function getHideBeforeRecentIds(preserveRecent = 2) {
        const keep = Math.max(0, Number(preserveRecent || 0));
        const visibleIds = getVisibleMessageIds();
        if (!visibleIds.length) {
            return [];
        }
        const cutoffPosition = Math.max(0, visibleIds.length - keep);
        return visibleIds.slice(0, cutoffPosition);
    }
    
    function getAutoHideRecentPlan(preserveRecent = defaultState.autoHideRecent.preserveRecent, state = ensureState()) {
        const keep = Math.max(0, Number(preserveRecent || 0));
        const managedSet = new Set(getFiniteMessageIds(state.autoHideRecent?.managedMessageIds || []));
        const sourceChat = getContext()?.chat || getChat() || [];
        const sourceIds = sourceChat
            .map((message, index) => ({ message, index }))
            .filter(({ message, index }) => message?.mes && (!message.is_system || managedSet.has(index)))
            .map(({ index }) => index);
        const keepIds = keep > 0 ? sourceIds.slice(-keep) : [];
        const keepSet = new Set(keepIds);
        const hideIds = sourceIds.filter(id => !keepSet.has(id) && !sourceChat?.[id]?.is_system);
        const restoreIds = keepIds.filter(id => managedSet.has(id) && sourceChat?.[id]?.is_system);
        return { sourceIds, keepIds, hideIds, restoreIds };
    }
    
    function getAutoHideRecentPreviewText(preserveRecent = defaultState.autoHideRecent.preserveRecent, state = ensureState()) {
        const { sourceIds, keepIds, hideIds, restoreIds } = getAutoHideRecentPlan(preserveRecent, state);
        const keepText = keepIds.length ? `${keepIds[0]}-${keepIds.at(-1)}` : '无';
        return `当前可收纳正文 ${sourceIds.length} 楼；将保留最近 ${preserveRecent} 楼（${keepText}），隐藏 ${hideIds.length} 楼，恢复 ${restoreIds.length} 楼。`;
    }
    
    function readAutoHideRecentFieldsFromUi(state = ensureState()) {
        if (!query('#bakemono-memory-preserve-recent-input').length) {
            return state;
        }
        state.autoHideRecent.enabled = query('#bakemono-memory-auto-hide-enabled').prop('checked');
        const preserveValue = query('#bakemono-memory-preserve-recent-input').val();
        state.autoHideRecent.preserveRecent = Math.max(0, Number(preserveValue === '' ? defaultState.autoHideRecent.preserveRecent : preserveValue));
        return state;
    }
    
    function renderAutoHideRecentPanel(state = ensureState()) {
        query('#bakemono-memory-auto-hide-enabled').prop('checked', !!state.autoHideRecent.enabled);
        query('#bakemono-memory-preserve-recent-input').val(state.autoHideRecent.preserveRecent ?? defaultState.autoHideRecent.preserveRecent);
        query('#bakemono-memory-auto-hide-options').prop('hidden', !state.autoHideRecent.enabled);
        const managedCount = getFiniteMessageIds(state.autoHideRecent.managedMessageIds || []).length;
        const status = state.autoHideRecent.enabled
            ? `自动收纳已开启：保留最近 ${state.autoHideRecent.preserveRecent} 楼正文，已管理 ${managedCount} 楼。${state.autoHideRecent.lastRunAt ? `上次整理：${new Date(state.autoHideRecent.lastRunAt).toLocaleString()}` : ''}`
            : `自动收纳未开启。已管理 ${managedCount} 楼，可点击“恢复自动收纳楼层”恢复。`;
        query('#bakemono-memory-auto-hide-status').text(status);
    }
    
    function previewPreserveRecentMessages() {
        const preserve = Math.max(0, Number(query('#bakemono-memory-preserve-recent-input').val() || 0));
        const previewText = getAutoHideRecentPreviewText(preserve);
        query('#bakemono-memory-range-preview').text(previewText);
        renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, previewText);
        return;
        const ids = getHideBeforeRecentIds(preserve);
        const text = ids.length
            ? `将隐藏较早的 ${ids.length} 楼正文，保留最近 ${preserve} 楼可见正文。范围约 ${ids[0]}-${ids.at(-1)}。`
            : `无需隐藏：当前可见正文不超过 ${preserve} 楼。`;
        query('#bakemono-memory-range-preview').text(text);
        renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, text);
    }
    
    async function applyAutoHideRecentBalance({ silent = false, confirm = false } = {}) {
        const state = ensureState();
        const preserve = Math.max(0, Number(state.autoHideRecent?.preserveRecent ?? defaultState.autoHideRecent.preserveRecent));
        const { hideIds, restoreIds } = getAutoHideRecentPlan(preserve, state);
        if (!hideIds.length && !restoreIds.length) {
            const text = getAutoHideRecentPreviewText(preserve, state);
            query('#bakemono-memory-range-preview').text(text);
            if (!silent) {
                renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, text);
                toastr.info(text);
            } else {
                renderAutoHideRecentPanel(state);
            }
            return;
        }
        if (confirm) {
            const confirmed = confirm([
                `自动收纳将保留最近 ${preserve} 楼正文。`,
                `本次会隐藏 ${hideIds.length} 楼，恢复 ${restoreIds.length} 楼。`,
                '',
                '确认继续吗？',
            ].join('\n'));
            if (!confirmed) {
                return;
            }
        }
        for (const id of restoreIds) {
            await hideChatMessageRange(id, id, true);
        }
        for (const id of hideIds) {
            await hideChatMessageRange(id, id, false);
        }
        state.hiddenMessageIds = unique([
            ...state.hiddenMessageIds.filter(id => !restoreIds.includes(id)),
            ...hideIds,
        ]);
        const sourceChat = getContext()?.chat || getChat() || [];
        const currentManaged = getFiniteMessageIds(state.autoHideRecent.managedMessageIds || [])
            .filter(id => sourceChat?.[id]?.mes && !restoreIds.includes(id));
        state.autoHideRecent.managedMessageIds = unique([...currentManaged, ...hideIds]);
        state.autoHideRecent.lastRunAt = new Date().toISOString();
        await saveChatConditional();
        saveState();
        scanBakemonoBlocks({ persist: false });
        const text = `自动收纳已整理：隐藏 ${hideIds.length} 楼，恢复 ${restoreIds.length} 楼，保留最近 ${preserve} 楼正文。`;
        query('#bakemono-memory-range-preview').text(text);
        if (!silent) {
            renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, text);
            toastr.success(text);
        } else {
            renderAutoHideRecentPanel(state);
        }
    }
    
    async function hideBeforeRecentMessages({ silent = false, fromAuto = false } = {}) {
        const state = ensureState();
        if (!fromAuto) {
            readAutoHideRecentFieldsFromUi(state);
        }
        if (fromAuto) {
            await applyAutoHideRecentBalance({ silent });
            return;
        }
        const fallbackPreserve = query('#bakemono-memory-preserve-recent-input').val();
        const preserve = Math.max(0, Number(state.autoHideRecent?.preserveRecent ?? fallbackPreserve ?? 0));
        const ids = getHideBeforeRecentIds(preserve);
        if (!ids.length) {
            const text = `无需隐藏：当前可见正文不超过 ${preserve} 楼。`;
            query('#bakemono-memory-range-preview').text(text);
            if (!silent) {
                toastr.info(text);
                renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, text);
            }
            return;
        }
        const coveredIds = getSummaryCoveredMessageIds();
        const uncovered = ids.filter(id => !coveredIds.has(id));
        const confirmed = fromAuto || confirm([
            `只保留最近 ${preserve} 楼正文？`,
            `将隐藏更早的 ${ids.length} 楼，范围约 ${ids[0]}-${ids.at(-1)}。`,
            uncovered.length ? `其中 ${uncovered.length} 楼没有已保存摘要覆盖，可能导致模型遗忘。` : '这些楼层已有摘要覆盖。',
            '',
            '确认继续吗？',
        ].join('\n'));
        if (!confirmed) {
            return;
        }
        for (const id of ids) {
            await hideChatMessageRange(id, id, false);
        }
        state.hiddenMessageIds = unique([...state.hiddenMessageIds, ...ids]);
        if (fromAuto) {
            state.autoHideRecent.managedMessageIds = unique([...(state.autoHideRecent.managedMessageIds || []), ...ids]);
            state.autoHideRecent.lastRunAt = new Date().toISOString();
        } else {
            state.customHiddenMessageIds = unique([...state.customHiddenMessageIds, ...ids]);
        }
        await saveChatConditional();
        saveState();
        scanBakemonoBlocks({ persist: false });
        const text = `已隐藏 ${ids.length} 楼，只保留最近 ${preserve} 楼正文。`;
        query('#bakemono-memory-range-preview').text(text);
        if (!silent) {
            renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, text);
            toastr.success(text);
        } else {
            renderAutoHideRecentPanel(state);
        }
    }
    
    async function applyAutoHideRecentSettings() {
        const state = ensureState();
        readAutoHideRecentFieldsFromUi(state);
        saveState();
        if (!state.autoHideRecent.enabled) {
            renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, '自动收纳已关闭。');
            toastr.info('自动收纳已关闭。');
            return;
        }
        await hideBeforeRecentMessages({ fromAuto: true });
    }
    
    function scheduleAutoHideRecent(reason = 'auto') {
        const state = ensureState();
        if (!state.autoHideRecent?.enabled) {
            return;
        }
        clearTimeout(autoHideRecentTimer);
        autoHideRecentTimer = setTimeout(async () => {
            try {
                await hideBeforeRecentMessages({ silent: true, fromAuto: true, reason });
            } catch (error) {
                console.warn('[BakemonoMemory] auto hide recent failed', error);
                toastr.warning(`自动收纳失败：${error?.message || error}`);
            }
        }, 900);
    }
    
    async function restoreAutoHiddenMessages() {
        const state = ensureState();
        const ids = getFiniteMessageIds(state.autoHideRecent?.managedMessageIds || []);
        if (!ids.length) {
            toastr.info('没有由自动收纳隐藏的楼层。');
            return;
        }
        const confirmed = confirm([
            `恢复自动收纳隐藏的 ${ids.length} 楼？`,
            `范围约 ${ids[0]}-${ids.at(-1)}。`,
            '',
            '确认继续吗？',
        ].join('\n'));
        if (!confirmed) {
            return;
        }
        for (const id of ids) {
            await hideChatMessageRange(id, id, true);
        }
        state.hiddenMessageIds = state.hiddenMessageIds.filter(id => !ids.includes(id));
        state.autoHideRecent.enabled = false;
        state.autoHideRecent.managedMessageIds = [];
        state.autoHideRecent.lastRunAt = null;
        await saveChatConditional();
        saveState();
        scanBakemonoBlocks({ persist: false });
        const text = `已恢复自动收纳隐藏的 ${ids.length} 楼。`;
        query('#bakemono-memory-range-preview').text(text);
        renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, text);
        toastr.success(text);
    }
    
    async function setMessageRangeHidden(unhide = false) {
        const state = ensureState();
        const { ids, invalid } = parseMessageRangeInput(query('#bakemono-memory-range-input').val());
        if (!ids.length) {
            const text = getRangePreviewText(ids, invalid);
            query('#bakemono-memory-range-preview').text(text);
            toastr.warning(text);
            return;
        }
    
        const coveredIds = getSummaryCoveredMessageIds();
        const uncovered = ids.filter(id => !coveredIds.has(id));
        const strategyHint = state.memoryStrategy === memoryStrategies.GENERIC
            ? '通用模式：普通补课摘要可以临时承担记忆，但仍建议之后生成阶段总结压缩 token。'
            : '摘要块手账模式：普通摘要通常不注入，建议只隐藏已经被阶段总结覆盖的楼层。';
        const warning = uncovered.length
            ? `其中 ${uncovered.length} 楼没有任何已保存摘要覆盖，隐藏后可能导致模型遗忘。`
            : '这些楼层已有摘要覆盖。';
        const confirmed = confirm([
            `${unhide ? '恢复' : '隐藏'} ${ids.length} 个楼层？`,
            getRangePreviewText(ids, invalid),
            warning,
            strategyHint,
            '',
            '确认继续吗？',
        ].join('\n'));
        if (!confirmed) {
            return;
        }
    
        for (const id of ids) {
            await hideChatMessageRange(id, id, unhide);
        }
        if (unhide) {
            state.hiddenMessageIds = state.hiddenMessageIds.filter(id => !ids.includes(id));
            state.customHiddenMessageIds = state.customHiddenMessageIds.filter(id => !ids.includes(id));
        } else {
            state.hiddenMessageIds = unique([...state.hiddenMessageIds, ...ids]);
            state.customHiddenMessageIds = unique([...state.customHiddenMessageIds, ...ids]);
        }
        await saveChatConditional();
        saveState();
        scanBakemonoBlocks({ persist: false });
        const text = `${unhide ? '已恢复' : '已隐藏'} ${ids.length} 个楼层。`;
        query('#bakemono-memory-range-preview').text(text);
        renderWorkbenchScope(workbenchRenderScopes.ARCHIVE, text);
        toastr.success(text);
    }

    return {
        applyAutoHideRecentBalance,
        applyAutoHideRecentSettings,
        getActualHiddenMessageIds,
        getAutoHideRecentPlan,
        getAutoHideRecentPreviewText,
        getSummaryCoveredMessageIds,
        hideBeforeRecentMessages,
        hideCoveredMessages,
        parseMessageRangeInput,
        previewMessageRange,
        previewPreserveRecentMessages,
        readAutoHideRecentFieldsFromUi,
        renderAutoHideRecentPanel,
        restoreAutoHiddenMessages,
        restoreHiddenMessages,
        scheduleAutoHideRecent,
        setMessageRangeHidden,
    };
}
