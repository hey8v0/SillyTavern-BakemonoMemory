export function createSummaryGenerationUi({ documentRef, query, getState }) {
    let mode = 'stage';
    let snapshot = { story: [], stage: [], epic: [] };

    function getMode() {
        return mode;
    }

    function setMode(nextMode) {
        if (['stage', 'epic', 'batch'].includes(nextMode)) mode = nextMode;
        return mode;
    }

    function render(state = getState(), blocks = null) {
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
        const coveredHashes = new Set(state.coveredBlockHashes || []);
        const coveredStoryCount = storyBlocks.filter(block => block?.hash && coveredHashes.has(block.hash)).length;
        const uncoveredStoryCount = Math.max(0, storyBlocks.length - coveredStoryCount);
        const upperLevelMaterialCount = stageBlocks.length + epicBlocks.length;
        const modes = {
            stage: {
                action: 'generate-stage',
                icon: 'fa-wand-magic-sparkles',
                title: '整理下一段长期记忆',
                button: '生成阶段总结',
                code: `${uncoveredStoryCount} 条待整理`,
                description: `${storyBlocks.length} 条剧情摘要，其中 ${coveredStoryCount} 条已经收入阶段记忆。生成结果会先进入待确认。`,
                progress: storyBlocks.length ? Math.round((coveredStoryCount / storyBlocks.length) * 100) : 0,
            },
            epic: {
                action: 'generate-epic',
                icon: 'fa-layer-group',
                title: '把多个阶段连成时间线',
                button: '生成多次总结',
                code: `${upperLevelMaterialCount} 条材料`,
                description: `${stageBlocks.length} 条阶段总结与 ${epicBlocks.length} 条上层总结可继续压缩，适合整理一卷或一条长期剧情线。`,
                progress: upperLevelMaterialCount ? Math.min(100, Math.round((epicBlocks.length / upperLevelMaterialCount) * 100)) : 0,
            },
            batch: {
                action: 'batch-summary',
                icon: 'fa-list-check',
                title: '把旧聊天分批整理',
                button: '打开批量生成',
                code: `${storyBlocks.length} 条已识别`,
                description: '按楼层范围补写缺失摘要或整理旧正文；任务会分批运行，并统一进入待确认。',
                progress: 0,
            },
        };
        const current = modes[mode];

        documentRef.querySelectorAll('[data-bakemono-summary-mode]').forEach(button => {
            button.classList.toggle('is-active', button.dataset.bakemonoSummaryMode === mode);
        });
        query('#bakemono-memory-summary-generation-title').text(current.title);
        query('#bakemono-memory-summary-generation-code').text(current.code);
        query('#bakemono-memory-summary-generation-description').text(current.description);
        query('#bakemono-memory-summary-generation-progress').css('width', `${current.progress}%`);
        const primary = documentRef.getElementById('bakemono-memory-summary-primary-action');
        if (primary) {
            primary.hidden = mode === 'batch';
            primary.dataset.bakemonoAction = current.action;
            const icon = primary.querySelector('i');
            if (icon) icon.className = `fa-solid ${current.icon}`;
            const label = primary.querySelector('span');
            if (label) label.textContent = current.button;
        }
        const batchPanel = documentRef.querySelector('[data-bakemono-owned-section="batch"]');
        if (batchPanel) {
            batchPanel.hidden = mode !== 'batch';
            if (mode === 'batch') batchPanel.open = true;
        }
    }

    function bindEvents(rootSelector = '#bakemono-workbench-root') {
        query(rootSelector).off('click.bakemonoSummaryMode').on('click.bakemonoSummaryMode', '[data-bakemono-summary-mode]', function () {
            setMode(this.dataset.bakemonoSummaryMode || 'stage');
            render();
        });
    }

    return { bindEvents, getMode, render, setMode };
}
