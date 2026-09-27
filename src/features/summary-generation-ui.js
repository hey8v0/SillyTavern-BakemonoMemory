// The 总结 page has one row of levels; each level's “next step” is one of these generation modes.
const modeByLevel = { story: 'batch', stage: 'stage', epic: 'epic' };
const levelNames = { batch: '剧情摘要', stage: '阶段总结', epic: '多次总结' };

function floorSpan(blocks) {
    const floors = blocks.map(block => Number(block?.messageId)).filter(id => Number.isFinite(id) && id < Number.MAX_SAFE_INTEGER);
    if (!floors.length) return '';
    const [first, last] = [Math.min(...floors), Math.max(...floors)];
    return first === last ? `第 ${first} 楼` : `第 ${first}–${last} 楼`;
}

export function createSummaryGenerationUi({ documentRef, query, getState, getStageMaterialOverview, getStageSourceModeLabel, getCurrentFloorMemoryIndex }) {
    let mode = 'stage';
    let batchOpen = false;
    let snapshot = { story: [], stage: [], epic: [] };

    // The 补写旧聊天 form stays folded until asked for; the level's button opens and closes it.
    function setBatchOpen(open) {
        batchOpen = !!open;
        return batchOpen;
    }

    function getMode() {
        return mode;
    }

    function setMode(nextMode) {
        const target = modeByLevel[nextMode] || nextMode;
        if (['stage', 'epic', 'batch'].includes(target)) mode = target;
        return mode;
    }

    function missingFloors(state) {
        try {
            return getCurrentFloorMemoryIndex?.(state)?.aggregates || null;
        } catch {
            return null;
        }
    }

    function render(state = getState(), blocks = null) {
        const auto = state.automation || {};
        query('#bakemono-memory-summary-auto-status').text('自动总结：' + (!auto.enabled ? '未开启'
            : auto.triggerType === 'chars' ? `每 ${auto.charInterval || 12000} 字触发` : `每 ${auto.floorInterval || 10} 个片段触发`));
        if (blocks) {
            snapshot = {
                story: Array.isArray(blocks.story) ? blocks.story : [],
                stage: Array.isArray(blocks.stage) ? blocks.stage : [],
                epic: Array.isArray(blocks.epic) ? blocks.epic : [],
            };
        }

        const storyBlocks = snapshot.story;
        const stageBlocks = snapshot.stage;
        const epicBlocks = snapshot.epic;
        const materials = getStageMaterialOverview();
        const coveredStoryCount = materials.coveredCount;
        const uncoveredStoryCount = materials.targets.length;
        const upperLevelMaterialCount = stageBlocks.length + epicBlocks.length;
        const floorStats = mode === 'batch' ? missingFloors(state) : null;
        const missing = Number(floorStats?.missing) || 0;
        const firstMissing = Number.isInteger(Number(floorStats?.firstMissingFloor)) ? `最早是第 ${Number(floorStats.firstMissingFloor).toLocaleString()} 楼。` : '';
        const modes = {
            stage: {
                action: 'generate-stage',
                empty: !materials.totalCount,
                emptyTitle: '还没有剧情摘要',
                emptyHint: '先在“自动记忆”里开启摘要，或在“剧情摘要”里补写旧聊天。',
                title: uncoveredStoryCount ? `${uncoveredStoryCount} 条剧情摘要还没整理成阶段总结` : '剧情摘要都已整理进阶段总结',
                button: '生成阶段总结',
                code: `${uncoveredStoryCount} 条待整理`,
                description: [floorSpan(materials.targets), `${getStageSourceModeLabel(materials.sourceMode)} · ${materials.totalCount} 条材料 · ${coveredStoryCount} 条已收录`].filter(Boolean).join(' · ')
                    + (materials.invalid?.length ? ' · ' + materials.invalid.length + ' 条材料无效：' + materials.invalid.slice(0, 3).join('；') : '')
                    + (materials.excludedCount ? ` · ${materials.excludedCount} 条因来源设置未纳入` : ''),
                progress: materials.totalCount ? Math.round((coveredStoryCount / materials.totalCount) * 100) : 0,
            },
            epic: {
                action: 'generate-epic',
                empty: !(storyBlocks.length + upperLevelMaterialCount),
                emptyTitle: '还没有可以串成一卷的总结',
                emptyHint: '先生成阶段总结，或积累剧情摘要。',
                title: stageBlocks.length ? `${stageBlocks.length} 条阶段总结可以串成一卷` : '可以直接用剧情摘要整理一卷',
                button: '生成多次总结',
                code: `${upperLevelMaterialCount} 条材料`,
                description: `${stageBlocks.length} 条阶段总结与 ${epicBlocks.length} 条上层总结可继续压缩，适合整理一卷或一条长期剧情线。`,
                progress: upperLevelMaterialCount ? Math.min(100, Math.round((epicBlocks.length / upperLevelMaterialCount) * 100)) : 0,
            },
            batch: {
                action: '',
                title: missing ? `有 ${missing.toLocaleString()} 楼还没有摘要` : '补写旧聊天的剧情摘要',
                button: batchOpen ? '收起补写表单' : '补写旧聊天',
                code: `${storyBlocks.length} 条已识别`,
                description: missing
                    ? `${firstMissing}点“补写旧聊天”选范围，摘要会写回原楼层并进入待确认。`
                    : '按楼层范围补写缺失摘要或整理旧正文；任务会分批运行，并统一进入待确认。',
                progress: 0,
            },
        };
        const current = modes[mode];

        query('#bakemono-memory-summary-generation-kicker').text(`${levelNames[mode]} · 下一步`);
        query('#bakemono-memory-summary-generation-title').text(current.empty ? current.emptyTitle : current.title);
        query('#bakemono-memory-summary-generation-code').text(current.code);
        query('#bakemono-memory-summary-generation-description').text(current.empty ? current.emptyHint : current.description);
        query('#bakemono-memory-summary-generation-progress').css('width', `${current.progress}%`);
        // 补写旧聊天 has no progress of its own; the form below says what will happen.
        const progressBar = documentRef.querySelector('.bk-sum-progress');
        if (progressBar) progressBar.hidden = mode === 'batch';
        const primary = documentRef.getElementById('bakemono-memory-summary-primary-action');
        if (primary) {
            primary.hidden = false;
            // Empty material has nothing to generate; the hint above says where to start instead.
            primary.disabled = !!current.empty;
            // Under 剧情摘要 the button only unfolds the form; the form's own button starts the work.
            if (current.action) {
                primary.dataset.bakemonoAction = current.action;
                delete primary.dataset.bakemonoBatchToggle;
                primary.removeAttribute?.('aria-expanded');
            } else {
                delete primary.dataset.bakemonoAction;
                primary.dataset.bakemonoBatchToggle = '';
                primary.setAttribute?.('aria-expanded', String(batchOpen));
            }
            const label = primary.querySelector('span');
            if (label) label.textContent = current.button;
        }
        const batchPanel = documentRef.querySelector('[data-bakemono-owned-section="batch"]');
        if (batchPanel) {
            batchPanel.hidden = mode !== 'batch' || !batchOpen;
            if (!batchPanel.hidden) batchPanel.open = true;
        }
    }

    function bindEvents(rootSelector = '#bakemono-workbench-root') {
        query(rootSelector).off('click.bakemonoSummaryMode').on('click.bakemonoSummaryMode', '[data-bakemono-summary-mode], [data-bakemono-preview-type]', function () {
            if (this.hasAttribute('data-bakemono-preview-page')) return;
            setMode(this.dataset.bakemonoSummaryMode || this.dataset.bakemonoPreviewType || 'stage');
            render();
        });
        query(rootSelector).off('click.bakemonoBatchToggle').on('click.bakemonoBatchToggle', '[data-bakemono-batch-toggle]', () => {
            setBatchOpen(!batchOpen);
            render();
            if (batchOpen) documentRef.getElementById('bakemono-memory-batch-summary-mode')?.focus({ preventScroll: true });
        });
    }

    return { bindEvents, getMode, render, setBatchOpen, setMode };
}
