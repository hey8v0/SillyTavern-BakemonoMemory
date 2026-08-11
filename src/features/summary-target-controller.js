export function createSummaryTargetController({
    query,
    getState: ensureState,
    defaultGenerationTargets,
    targetSelectionModes,
    persistSharedConfigurationFromState,
    parseLooseNumberRange,
    toastr,
    saveState,
    getIsBusy,
    generateStageDraft,
    generateStageBatchTasks,
    generateEpicDraft,
    generateEpicBatchTasks,
    confirmDanger,
    getSourceMessageIdsFromBlocks,
    formatSourceRange,
    renderWorkbenchScope,
    workbenchRenderScopes,
} = {}) {
    function readGenerationTargetSettings() {
        const state = ensureState();
        const readKind = kind => {
            const modeInput = query(`#bakemono-memory-${kind}-target-mode`);
            const countInput = query(`#bakemono-memory-${kind}-target-count`);
            const rangeInput = query(`#bakemono-memory-${kind}-target-range`);
            if (!modeInput.length && !countInput.length && !rangeInput.length) {
                return {
                    ...defaultGenerationTargets[kind],
                    ...(state.generationTargets?.[kind] || {}),
                };
            }
            return {
                mode: String(modeInput.val() || state.generationTargets[kind]?.mode || defaultGenerationTargets[kind].mode),
                count: Math.max(1, Number(countInput.val() || state.generationTargets[kind]?.count || defaultGenerationTargets[kind].count)),
                range: String(rangeInput.val() || state.generationTargets[kind]?.range || '').trim(),
            };
        };
        state.generationTargets = {
            stage: readKind('stage'),
            epic: readKind('epic'),
        };
        persistSharedConfigurationFromState(state);
        return state.generationTargets;
    }
    
    function getTargetSelectionLabel(kind, selectedLength, totalLength) {
        const state = ensureState();
        const config = state.generationTargets?.[kind] || defaultGenerationTargets[kind];
        const modeLabels = {
            [targetSelectionModes.ALL]: '全部',
            [targetSelectionModes.OLDEST]: `最早 ${config.count || defaultGenerationTargets[kind].count} 个`,
            [targetSelectionModes.RANGE]: `楼层 ${config.range || '未填写'}`,
        };
        return `${modeLabels[config.mode] || '全部'}：${selectedLength}/${totalLength} 个`;
    }
    
    function inferNextRange(range) {
        const match = String(range || '').trim().match(/^(\d+)\s*-\s*(\d+)$/);
        if (!match) {
            return '';
        }
        const start = Number(match[1]);
        const end = Number(match[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            return '';
        }
        const left = Math.min(start, end);
        const right = Math.max(start, end);
        const nextStart = right + 1;
        const nextEnd = right + Math.max(1, right - left);
        return `${nextStart}-${nextEnd}`;
    }
    
    function parseGenerationTargetInput(input, fallbackConfig = {}) {
        const text = String(input || '').trim();
        if (!text) {
            return null;
        }
        if (/^(all|全部)$/i.test(text)) {
            return {
                ...fallbackConfig,
                mode: targetSelectionModes.ALL,
            };
        }
        const oldest = text.match(/^(?:oldest|前|最早|n)\s*[:：]?\s*(\d+)$/i);
        if (oldest) {
            return {
                ...fallbackConfig,
                mode: targetSelectionModes.OLDEST,
                count: Math.max(1, Number(oldest[1])),
            };
        }
        const range = text.match(/^(?:range|楼层|范围)?\s*[:：]?\s*(\d+(?:\s*-\s*\d+)?(?:[,\s，]+\d+(?:\s*-\s*\d+)?)*)$/i);
        if (range) {
            return {
                ...fallbackConfig,
                mode: targetSelectionModes.RANGE,
                range: range[1].trim(),
            };
        }
        return null;
    }
    
    function promptGenerationTargetSelection(kind, totalLength, options = {}) {
        const state = ensureState();
        const defaults = defaultGenerationTargets[kind] || defaultGenerationTargets.stage;
        const isBatch = !!options.batch;
        const current = {
            ...defaults,
            ...(state.generationTargets?.[kind] || {}),
        };
        const kindLabel = kind === 'epic' ? '多次总结' : '阶段总结';
        const suggestedRange = current.mode === targetSelectionModes.RANGE
            ? (inferNextRange(current.range) || current.range || defaults.range)
            : (current.range || defaults.range);
        return new Promise(resolve => {
            document.querySelector('.bakemono-memory-target-dialog')?.remove();
    
            const overlay = document.createElement('div');
            overlay.className = 'bakemono-memory-target-dialog';
            overlay.innerHTML = `
                <section class="bakemono-memory-target-box" role="dialog" aria-modal="true">
                    <header>
                        <div>
                            <span>生成范围</span>
                            <h3>${kindLabel}</h3>
                        </div>
                        <button type="button" class="menu_button" data-bakemono-target-cancel><i class="fa-solid fa-xmark"></i></button>
                    </header>
                    <div class="bakemono-memory-target-body">
                        <p>${isBatch
                            ? `本次可用材料：${totalLength} 个。设置每批数量后会分批加入队列。`
                            : `本次可用材料：${totalLength} 个。你可以只合并一部分，避免一次压得太简洁。`}</p>
                        <label class="bakemono-memory-field">
                            <span>读取范围</span>
                            <select class="text_pole" data-bakemono-target-mode>
                                <option value="all">全部未总结内容</option>
                                <option value="oldest">最早 N 个</option>
                                <option value="range">指定来源楼层</option>
                            </select>
                        </label>
                        <div class="bakemono-memory-editor-grid bakemono-memory-mini-grid">
                            <label class="bakemono-memory-field">
                                <span>${isBatch ? '每批数量' : 'N 个'}</span>
                                <input class="text_pole" data-bakemono-target-count type="number" min="1" step="1">
                            </label>
                            <label class="bakemono-memory-field">
                                <span>来源楼层</span>
                                <input class="text_pole" data-bakemono-target-range type="text" placeholder="例如 0-20, 80-120">
                            </label>
                        </div>
                        <div class="bakemono-memory-prompt-hint" data-bakemono-target-hint></div>
                    </div>
                    <footer class="bakemono-memory-inline-actions">
                        <button type="button" class="menu_button" data-bakemono-target-cancel><i class="fa-solid fa-ban"></i><span>取消</span></button>
                        <button type="button" class="menu_button" data-bakemono-target-confirm><i class="fa-solid fa-check"></i><span>使用这个范围</span></button>
                    </footer>
                </section>
            `;
    
            const modeInput = overlay.querySelector('[data-bakemono-target-mode]');
            const countInput = overlay.querySelector('[data-bakemono-target-count]');
            const rangeInput = overlay.querySelector('[data-bakemono-target-range]');
            const hint = overlay.querySelector('[data-bakemono-target-hint]');
    
            modeInput.value = current.mode || targetSelectionModes.ALL;
            countInput.value = current.count || defaults.count;
            rangeInput.value = current.mode === targetSelectionModes.RANGE
                ? (suggestedRange || current.range || '0-20')
                : (current.range || '');
    
            const close = value => {
                overlay.remove();
                resolve(value);
            };
            const syncHint = () => {
                const mode = modeInput.value;
                countInput.disabled = !isBatch && mode !== targetSelectionModes.OLDEST;
                rangeInput.disabled = mode !== targetSelectionModes.RANGE;
                if (mode === targetSelectionModes.RANGE && !rangeInput.value.trim()) {
                    rangeInput.value = suggestedRange || '0-20';
                }
                if (isBatch) {
                    hint.textContent = mode === targetSelectionModes.RANGE
                        ? `只处理指定楼层范围，并按每批 ${countInput.value || current.count || defaults.count} 个材料入队。`
                        : `会按来源楼层从早到晚分批；每批 ${countInput.value || current.count || defaults.count} 个材料。`;
                    return;
                }
                hint.textContent = mode === targetSelectionModes.RANGE && current.range
                    ? `上次范围：${current.range}。已为你推导到：${rangeInput.value || suggestedRange}，可以直接修改。`
                    : mode === targetSelectionModes.OLDEST
                        ? '会按来源楼层从早到晚取前 N 个。'
                        : '会合并当前所有尚未进入上层总结的内容。';
            };
    
            overlay.querySelectorAll('[data-bakemono-target-cancel]').forEach(button => {
                button.addEventListener('click', () => close(null));
            });
            overlay.querySelector('[data-bakemono-target-confirm]').addEventListener('click', () => {
                const parsed = {
                    ...current,
                    mode: Object.values(targetSelectionModes).includes(modeInput.value) ? modeInput.value : targetSelectionModes.ALL,
                    count: Math.max(1, Number(countInput.value || current.count || defaults.count)),
                    range: String(rangeInput.value || '').trim(),
                };
                if (parsed.mode === targetSelectionModes.RANGE && !parseLooseNumberRange(parsed.range).ids.size) {
                    toastr.warning('请填写可识别的楼层范围，例如 0-20 或 0-20, 35-50。');
                    return;
                }
                state.generationTargets[kind] = parsed;
                query(`#bakemono-memory-${kind}-target-mode`).val(parsed.mode);
                query(`#bakemono-memory-${kind}-target-count`).val(parsed.count);
                query(`#bakemono-memory-${kind}-target-range`).val(parsed.range);
                saveState();
                close(parsed);
            });
            modeInput.addEventListener('change', syncHint);
            countInput.addEventListener('input', syncHint);
            syncHint();
    
            const host = document.getElementById('bakemono-workbench-root') || document.body;
            host.append(overlay);
            modeInput.focus();
        });
    }
    
    function promptGenerationModeSelection(kind) {
        const kindLabel = kind === 'epic' ? '多次总结' : '阶段总结';
        const batchLabel = kind === 'epic' ? '批量多次总结' : '批量阶段总结';
        const singleHint = kind === 'epic'
            ? '选范围，生成一条上层草稿。'
            : '选范围，生成一条阶段草稿。';
        const batchHint = kind === 'epic'
            ? '大量总结分批入队。'
            : '大量摘要分批入队。';
    
        return new Promise(resolve => {
            document.querySelector('.bakemono-memory-generation-mode-dialog')?.remove();
    
            const overlay = document.createElement('div');
            overlay.className = 'bakemono-memory-target-dialog bakemono-memory-generation-mode-dialog';
            overlay.innerHTML = `
                <section class="bakemono-memory-target-box bakemono-memory-generation-mode-box" role="dialog" aria-modal="true">
                    <header>
                        <div>
                            <span>选择生成方式</span>
                            <h3>${kindLabel}</h3>
                        </div>
                        <button type="button" class="menu_button" data-bakemono-mode-cancel><i class="fa-solid fa-xmark"></i></button>
                    </header>
                    <div class="bakemono-memory-generation-mode-list">
                        <button type="button" class="menu_button bakemono-memory-generation-mode-option" data-bakemono-mode-choice="single">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                            <span>
                                <strong>单次生成</strong>
                                <small>${singleHint}</small>
                            </span>
                        </button>
                        <button type="button" class="menu_button bakemono-memory-generation-mode-option" data-bakemono-mode-choice="batch">
                            <i class="fa-solid fa-list-check"></i>
                            <span>
                                <strong>${batchLabel}</strong>
                                <small>${batchHint}</small>
                            </span>
                        </button>
                    </div>
                    <footer class="bakemono-memory-inline-actions">
                        <button type="button" class="menu_button" data-bakemono-mode-cancel><i class="fa-solid fa-ban"></i><span>取消</span></button>
                    </footer>
                </section>
            `;
    
            const close = value => {
                overlay.remove();
                resolve(value);
            };
            overlay.querySelectorAll('[data-bakemono-mode-cancel]').forEach(button => {
                button.addEventListener('click', () => close(null));
            });
            overlay.querySelectorAll('[data-bakemono-mode-choice]').forEach(button => {
                button.addEventListener('click', () => close(button.dataset.bakemonoModeChoice));
            });
    
            const host = document.getElementById('bakemono-workbench-root') || document.body;
            host.append(overlay);
            overlay.querySelector('[data-bakemono-mode-choice]')?.focus();
        });
    }
    
    async function chooseStageGenerationMode() {
        if (getIsBusy?.()) {
            return;
        }
        const mode = await promptGenerationModeSelection('stage');
        if (mode === 'single') {
            await generateStageDraft();
        } else if (mode === 'batch') {
            await generateStageBatchTasks();
        }
    }
    
    async function chooseEpicGenerationMode() {
        if (getIsBusy?.()) {
            return;
        }
        const mode = await promptGenerationModeSelection('epic');
        if (mode === 'single') {
            await generateEpicDraft();
        } else if (mode === 'batch') {
            await generateEpicBatchTasks();
        }
    }
    
    function confirmGenerationTargets(kind, targets, totalLength) {
        const state = ensureState();
        const kindLabel = kind === 'epic' ? '多次总结' : '阶段总结';
        const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
        const confirmed = confirmDanger(
            `生成【${kindLabel}】草稿？`,
            [
                `本次范围：${getTargetSelectionLabel(kind, targets.length, totalLength)}`,
                `来源：${formatSourceRange(sourceMessageIds)}`,
                '生成结果会先进入草稿箱，确认保存后才会写入长期记忆。',
            ],
            '确认生成吗？',
        );
        if (!confirmed) {
            renderWorkbenchScope(workbenchRenderScopes.SUMMARY, `已取消${kindLabel}生成。`);
        }
        return confirmed;
    }
    
    

    return {
        chooseEpicGenerationMode,
        chooseStageGenerationMode,
        confirmGenerationTargets,
        getTargetSelectionLabel,
        parseGenerationTargetInput,
        promptGenerationModeSelection,
        promptGenerationTargetSelection,
        readGenerationTargetSettings,
    };
}
