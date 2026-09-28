export function createSummaryTargetController({
    query,
    getState: ensureState,
    defaultGenerationTargets,
    targetSelectionModes,
    persistSharedConfigurationFromState,
    parseLooseNumberRange,
    toastr,
    saveState,
    confirmDanger,
    getSourceMessageIdsFromBlocks,
    formatSourceRange,
    getSummaryMaterialPreview = () => '',
    renderWorkbenchScope,
    workbenchRenderScopes,
    openDialog,
    openMissingBackfill = null,
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
    
    // The generation panel: which material, one chapter or batches, and what that selection will send — the
    // count, floors, length, floors with no summary and the start of the material — all in one place. It used to
    // be this dialog plus two confirm() boxes; the controller skips those when the result says `reviewed`.
    // options.describe(config) → { count, textLength, range, gaps: [floor], samples: [{ where, text }], requests }.
    function promptGenerationTargetSelection(kind, totalLength, options = {}) {
        const state = ensureState();
        const defaults = defaultGenerationTargets[kind] || defaultGenerationTargets.stage;
        const current = { ...defaults, ...(state.generationTargets?.[kind] || {}) };
        const kindLabel = kind === 'epic' ? '多次总结' : '阶段总结';
        const unit = kind === 'epic' ? '条' : '章';
        const sources = kind === 'epic' && options.sourceCounts ? options.sourceCounts : null;
        const suggestedRange = current.mode === targetSelectionModes.RANGE
            ? (inferNextRange(current.range) || current.range || defaults.range)
            : (current.range || defaults.range || '');
        const initialBatch = options.batch ?? !!current.batch;
        const initialSource = sources ? (sources[current.sourceMode] ? current.sourceMode : Object.keys(sources).find(key => sources[key] > 0) || 'stage') : '';
        const initialMode = Object.values(targetSelectionModes).includes(current.mode) ? current.mode : targetSelectionModes.ALL;
        const radio = (name, value, checked, label, extra = '') => `<label class="bk-dlg-choice"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}><span class="bk-dlg-choice-t">${label}</span>${extra}</label>`;
        const sourceRows = sources ? `<div class="bk-dlg-section"><span class="bk-dlg-label">用什么整理</span>`
            + radio('bk-gen-source', 'stage', initialSource === 'stage', '阶段总结', `<span class="bk-dlg-n">${Number(sources.stage || 0)} 条</span>`)
            + radio('bk-gen-source', 'epic', initialSource === 'epic', '已有的多次总结，再合一次', `<span class="bk-dlg-n">${Number(sources.epic || 0)} 条</span>`)
            + '</div>' : '';
        const html = `<div class="bk-dlg-h"><div><span class="bk-dlg-label">${kindLabel} · 生成</span><h3 data-dlg-title>整理成${kindLabel}</h3>
                <div class="bk-dlg-meta" data-gen-meta></div></div>
                <button type="button" class="bk-dlg-x" data-dlg-value="" aria-label="取消">×</button></div>
            <p class="bk-dlg-gap" data-gen-gap hidden></p>
            ${sourceRows}
            <div class="bk-dlg-section"><span class="bk-dlg-label">用哪些</span>
                ${radio('bk-gen-mode', targetSelectionModes.ALL, initialMode === targetSelectionModes.ALL, '全部没整理的', '<span class="bk-dlg-n" data-gen-total></span>')}
                ${radio('bk-gen-mode', targetSelectionModes.OLDEST, initialMode === targetSelectionModes.OLDEST, '最早的几条', `<input class="bk-dlg-num" data-gen-oldest type="number" min="1" step="1" inputmode="numeric" aria-label="条数" value="${Math.max(1, Number(!current.batch && current.mode === targetSelectionModes.OLDEST ? current.count : defaults.count) || 1)}">`)}
                ${radio('bk-gen-mode', targetSelectionModes.RANGE, initialMode === targetSelectionModes.RANGE, '指定楼层', `<input class="bk-dlg-num is-wide" data-gen-range type="text" aria-label="楼层范围" placeholder="0-20, 35-50" value="${String(suggestedRange || '').replace(/"/g, '&quot;')}">`)}
            </div>
            <div class="bk-dlg-section"><span class="bk-dlg-label">生成几${unit}</span>
                ${radio('bk-gen-batch', 'single', !initialBatch, `合成一${unit}`)}
                ${radio('bk-gen-batch', 'batch', initialBatch, `分批，每${unit}用`, `<input class="bk-dlg-num" data-gen-size type="number" min="1" step="1" inputmode="numeric" aria-label="每批条数" value="${Math.max(1, Number(current.batch ? current.count : defaults.count) || 1)}"><span class="bk-dlg-n">条</span>`)}
            </div>
            <details class="bk-dlg-fold" data-gen-samples-box><summary>看材料开头<small data-gen-samples-count></small></summary><div data-gen-samples></div></details>
            <details class="bk-dlg-fold"><summary>更多<small>重新整理 · 有效材料</small></summary>
                <label class="bk-dlg-check"><input type="checkbox" data-gen-covered${current.includeCovered ? ' checked' : ''}><span>包括已经整理过的（重新整理）</span></label>
                <label class="bk-dlg-check"><input type="checkbox" data-gen-valid${current.validOnly ? ' checked' : ''}><span>只用有效材料，跳过来源改过的</span></label>
            </details>
            <div class="bk-dlg-foot"><span class="bk-dlg-note">结果先放进待确认，看过再保存。</span>
                <button type="button" class="bk-dlg-text" data-dlg-value="">取消</button>
                <button type="button" class="bk-dlg-btn" data-gen-go>生成</button></div>`;
        let result = null;
        return openDialog({ className: 'bk-dlg-gen', html, dismiss: '', onReady(dialog, finish) {
            const field = selector => dialog.querySelector(selector);
            const read = () => {
                const mode = field('input[name="bk-gen-mode"]:checked')?.value || targetSelectionModes.ALL;
                const batch = field('input[name="bk-gen-batch"]:checked')?.value === 'batch';
                const count = batch ? Number(field('[data-gen-size]').value) : mode === targetSelectionModes.OLDEST ? Number(field('[data-gen-oldest]').value) : Number(current.count || defaults.count);
                return {
                    ...current,
                    ...(sources ? { sourceMode: field('input[name="bk-gen-source"]:checked')?.value || initialSource } : {}),
                    mode, batch,
                    count: Math.max(1, Math.floor(count) || Number(defaults.count) || 1),
                    range: String(field('[data-gen-range]').value || '').trim(),
                    includeCovered: field('[data-gen-covered]').checked,
                    validOnly: field('[data-gen-valid]').checked,
                };
            };
            const sync = () => {
                const config = read();
                // One batch of “the oldest N” is just one chapter; batches only make sense over all or a range.
                const oldest = field(`input[name="bk-gen-mode"][value="${targetSelectionModes.OLDEST}"]`);
                oldest.disabled = config.batch;
                field('[data-gen-oldest]').disabled = config.batch;
                if (config.batch && config.mode === targetSelectionModes.OLDEST) {
                    field(`input[name="bk-gen-mode"][value="${targetSelectionModes.ALL}"]`).checked = true;
                    return sync();
                }
                field('[data-gen-size]').disabled = !config.batch;
                field('[data-gen-range]').disabled = config.mode !== targetSelectionModes.RANGE;
                const total = sources ? Number(sources[config.sourceMode] || 0) : totalLength;
                field('[data-gen-total]').textContent = `${total} 条`;
                const rangeInvalid = config.mode === targetSelectionModes.RANGE && !parseLooseNumberRange(config.range).ids.size;
                const info = rangeInvalid ? null : options.describe?.(config);
                const count = info ? info.count : total;
                field('[data-gen-meta]').innerHTML = rangeInvalid ? '<span class="is-alert">楼层范围没看懂，写成 0-20 或 0-20, 35-50</span>'
                    : [`<span><b>${count}</b> 条材料</span>`, info?.range ? `<span>${info.range.replace(/[<>&]/g, '')}</span>` : '',
                        info?.textLength ? `<span>约 ${Number(info.textLength).toLocaleString()} 字</span>` : ''].filter(Boolean).join('');
                const gaps = info?.gaps || [];
                const gap = field('[data-gen-gap]');
                gap.hidden = !gaps.length;
                if (gaps.length) {
                    const floors = `第 ${gaps.slice(0, 8).join('、')}${gaps.length > 8 ? ` 等 ${gaps.length}` : ''} 楼`;
                    gap.innerHTML = `<b>${floors}还没有摘要。</b>现在生成的话，这些楼之后不会再进${kindLabel}。`
                        + (openMissingBackfill ? ' <button type="button" class="bk-dlg-link" data-dlg-value="backfill">先去补写 ›</button>' : '');
                }
                const samples = info?.samples || [];
                field('[data-gen-samples-box]').hidden = !samples.length;
                field('[data-gen-samples-count]').textContent = samples.length ? `前 ${samples.length} 条` : '';
                field('[data-gen-samples]').innerHTML = samples.map(sample => `<p class="bk-dlg-sample"><span>${String(sample.where || '').replace(/[<>&]/g, '')}</span>${String(sample.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('');
                const requests = info ? info.requests : (count ? 1 : 0);
                const go = field('[data-gen-go]');
                go.disabled = rangeInvalid || !count;
                go.innerHTML = count ? `生成<span class="bk-dlg-cost">${requests} 次请求</span>` : '这里没有可用的材料';
            };
            dialog.addEventListener('input', sync);
            dialog.addEventListener('change', sync);
            field('[data-gen-go]').addEventListener('click', () => {
                const parsed = read();
                if (parsed.mode === targetSelectionModes.RANGE && !parseLooseNumberRange(parsed.range).ids.size) return;
                if (ensureState() !== state) { finish(''); return; }
                state.generationTargets[kind] = parsed;
                query(`#bakemono-memory-${kind}-target-mode`).val(parsed.mode);
                query(`#bakemono-memory-${kind}-target-count`).val(parsed.count);
                query(`#bakemono-memory-${kind}-target-range`).val(parsed.range);
                saveState();
                result = { ...parsed, reviewed: true };
                finish('go');
            });
            sync();
        } }).then(value => {
            if (value === 'backfill') openMissingBackfill?.();
            return value === 'go' ? result : null;
        });
    }

    async function confirmGenerationTargets(kind, targets, totalLength) {
        const state = ensureState();
        const kindLabel = kind === 'epic' ? '多次总结' : '阶段总结';
        const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
        const confirmed = await confirmDanger(
            `生成【${kindLabel}】草稿？`,
            [
                `本次范围：${getTargetSelectionLabel(kind, targets.length, totalLength)}`,
                `来源：${formatSourceRange(sourceMessageIds)}`,
                getSummaryMaterialPreview(targets),
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
        confirmGenerationTargets,
        getTargetSelectionLabel,
        parseGenerationTargetInput,
        promptGenerationTargetSelection,
        readGenerationTargetSettings,
    };
}
