export function createReviewQueueUi({
    documentRef,
    query,
    getState,
    isMissingSummaryTask,
    getKindLabel,
    blockTypes,
    historyPageSize = 10,
}) {
    const historyState = { page: 0 };
    let activeView = 'drafts';

    function setActiveView(view) {
        activeView = ['drafts', 'tasks', 'history'].includes(view) ? view : 'drafts';
    }

    function changeHistoryPage(direction) {
        historyState.page = Math.max(0, (historyState.page || 0) + direction);
    }

    function getTaskStatusLabel(status) {
        return { queued: '等待中', running: '生成中', done: '已完成', failed: '失败' }[status] || '等待中';
    }

    function renderTabs(state = getState()) {
        const counts = { drafts: state.drafts.length, tasks: state.taskQueue.length, history: state.history.length };
        query('#bakemono-memory-review-draft-count').text(counts.drafts);
        query('#bakemono-memory-review-task-count').text(counts.tasks);
        query('#bakemono-memory-review-history-count').text(counts.history);
        documentRef.querySelectorAll('[data-bakemono-review-view]').forEach(button => {
            const isActive = button.dataset.bakemonoReviewView === activeView;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });
        documentRef.querySelectorAll('[data-bakemono-review-panel]').forEach(panel => {
            const isActive = panel.dataset.bakemonoReviewPanel === activeView;
            panel.classList.toggle('is-active', isActive);
            panel.hidden = !isActive;
        });
    }

    function renderDrafts(state = getState()) {
        const container = documentRef.querySelector('#bakemono-memory-draft-list');
        if (!container) return;
        renderTabs(state);
        container.innerHTML = '';
        const missingDraftCount = state.drafts.filter(draft => draft.metadata?.appendMode === 'missing_summary').length;
        const missingTaskCount = state.taskQueue.filter(task => isMissingSummaryTask(task) && ['queued', 'failed', 'done'].includes(task.status)).length;
        if (missingDraftCount || missingTaskCount) {
            const bulkActions = documentRef.createElement('div');
            bulkActions.className = 'bakemono-memory-inline-actions bakemono-memory-draft-bulk-actions';
            bulkActions.innerHTML = `
                ${missingDraftCount ? `<button class="menu_button" data-bakemono-action="commit-missing-all"><i class="fa-solid fa-file-circle-check"></i><span>一键应用缺失摘要 ${missingDraftCount}</span></button>` : ''}
                <button class="menu_button danger" data-bakemono-action="remove-missing-all"><i class="fa-solid fa-broom"></i><span>移除缺失摘要待处理 ${missingDraftCount + missingTaskCount}</span></button>`;
            container.append(bulkActions);
        }
        if (!state.drafts.length) {
            const empty = documentRef.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无待确认草稿。自动总结和手动生成都会先放在这里。';
            container.append(empty);
            return;
        }

        const fragment = documentRef.createDocumentFragment();
        state.drafts.forEach(draft => {
            const card = documentRef.createElement('article');
            card.className = 'bakemono-memory-draft-card';
            card.dataset.draftId = draft.id;
            const header = documentRef.createElement('div');
            header.className = 'bakemono-memory-draft-header';
            const badge = documentRef.createElement('span');
            badge.className = `bakemono-memory-draft-kind is-${draft.kind || 'story'}`;
            badge.textContent = getKindLabel(draft.kind);
            const time = documentRef.createElement('small');
            time.textContent = draft.createdAt ? new Date(draft.createdAt).toLocaleString() : '刚刚生成';
            header.append(badge, time);

            const titleWrap = documentRef.createElement('label');
            titleWrap.className = 'bakemono-memory-draft-title-field';
            const titleInput = documentRef.createElement('input');
            titleInput.className = 'text_pole bakemono-memory-draft-title';
            titleInput.type = 'text';
            titleInput.value = draft.title || '';
            titleInput.placeholder = '草稿标题';
            titleInput.setAttribute('aria-label', '草稿标题');
            titleWrap.append(titleInput);

            const preview = documentRef.createElement('p');
            preview.className = 'bakemono-memory-draft-preview';
            preview.textContent = String(draft.content || '').replace(/\s+/g, ' ').trim().slice(0, 180) || '草稿尚无正文内容。';
            const meta = documentRef.createElement('div');
            meta.className = 'bakemono-memory-draft-meta';
            const draftMeta = draft.metadata?.sourceRange
                ? `${draft.metadata.sourceRange}${draft.metadata.batchIndex ? ` · 第 ${draft.metadata.batchIndex}/${draft.metadata.batchTotal || '?'} 批` : ''}`
                : '';
            const appendLabel = draft.metadata?.appendMode === 'missing_summary' ? '确认后追加到原助手楼层' : '';
            [draftMeta, appendLabel, draft.trigger || 'manual'].filter(Boolean).forEach(text => {
                const item = documentRef.createElement('span');
                item.textContent = text;
                meta.append(item);
            });

            const textarea = documentRef.createElement('textarea');
            textarea.className = 'text_pole textarea_compact bakemono-memory-draft-editor';
            textarea.rows = 9;
            textarea.spellcheck = false;
            textarea.value = draft.content || '';
            const editorDetails = documentRef.createElement('details');
            editorDetails.className = 'bakemono-memory-draft-editor-disclosure bakemono-memory-console-disclosure';
            editorDetails.innerHTML = '<summary><span><i class="fa-solid fa-pen-to-square"></i> 查看并编辑完整草稿</span><small>修改正文、重新总结或丢弃</small></summary>';
            const secondaryActions = documentRef.createElement('div');
            secondaryActions.className = 'bakemono-memory-inline-actions bakemono-memory-draft-secondary-actions';
            secondaryActions.innerHTML = '<button class="menu_button" data-bakemono-draft-action="regenerate"><i class="fa-solid fa-rotate"></i><span>重新总结</span></button><button class="menu_button danger_button" data-bakemono-draft-action="discard"><i class="fa-solid fa-trash"></i><span>丢弃草稿</span></button>';
            editorDetails.append(textarea, secondaryActions);
            const actions = documentRef.createElement('div');
            actions.className = 'bakemono-memory-draft-actions';
            actions.innerHTML = '<button class="menu_button" type="button" data-bakemono-draft-editor-toggle><i class="fa-solid fa-pen"></i><span>继续编辑</span></button><button class="menu_button bakemono-memory-draft-commit" data-bakemono-draft-action="commit"><i class="fa-solid fa-check"></i><span>确认保存</span></button>';
            card.append(header, titleWrap, preview, meta, editorDetails, actions);
            fragment.append(card);
        });
        container.append(fragment);
    }

    function renderHistory(state = getState()) {
        const container = documentRef.querySelector('#bakemono-memory-history-list');
        if (!container) return;
        renderTabs(state);
        container.innerHTML = '';
        if (!state.history.length) {
            const empty = documentRef.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无保存记录。';
            container.append(empty);
            return;
        }
        const pageCount = Math.max(1, Math.ceil(state.history.length / historyPageSize));
        historyState.page = Math.min(Math.max(0, historyState.page || 0), pageCount - 1);
        const start = historyState.page * historyPageSize;
        const visibleHistory = state.history.slice(start, start + historyPageSize);
        const controls = documentRef.createElement('div');
        controls.className = 'bakemono-memory-preview-pager bakemono-memory-history-pager';
        const prev = documentRef.createElement('button');
        prev.type = 'button';
        prev.className = 'menu_button bakemono-preview-page-button';
        prev.dataset.bakemonoHistoryPage = 'prev';
        prev.disabled = historyState.page <= 0;
        prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i><span>上一页</span>';
        const info = documentRef.createElement('span');
        info.className = 'bakemono-memory-preview-page-info';
        info.textContent = `${start + 1}-${Math.min(start + historyPageSize, state.history.length)} / ${state.history.length}`;
        const next = documentRef.createElement('button');
        next.type = 'button';
        next.className = 'menu_button bakemono-preview-page-button';
        next.dataset.bakemonoHistoryPage = 'next';
        next.disabled = historyState.page >= pageCount - 1;
        next.innerHTML = '<span>下一页</span><i class="fa-solid fa-chevron-right"></i>';
        controls.append(prev, info, next);

        const fragment = documentRef.createDocumentFragment();
        visibleHistory.forEach(item => {
            const row = documentRef.createElement('div');
            row.className = 'bakemono-memory-history-item';
            const marker = documentRef.createElement('span');
            marker.className = `bakemono-memory-history-marker is-${item.kind || 'story'}`;
            marker.textContent = item.kind === blockTypes.EPIC ? 'E' : item.kind === blockTypes.STAGE ? 'S' : '#';
            const main = documentRef.createElement('div');
            main.className = 'bakemono-memory-history-main';
            const title = documentRef.createElement('strong');
            title.textContent = item.summary?.title || item.draft?.title || item.summaryHash;
            const kind = documentRef.createElement('span');
            kind.textContent = getKindLabel(item.kind);
            main.append(title, kind);
            const time = documentRef.createElement('time');
            time.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
            row.append(marker, main, time);
            fragment.append(row);
        });
        container.append(fragment, controls);
    }

    function renderTaskQueue(state = getState()) {
        const container = documentRef.querySelector('#bakemono-memory-task-list');
        if (!container) return;
        renderTabs(state);
        container.innerHTML = '';
        const removableTaskStatuses = new Set(['queued', 'failed', 'done']);
        const missingTaskCount = state.taskQueue.filter(task => isMissingSummaryTask(task) && removableTaskStatuses.has(task.status)).length;
        const stuckTaskCount = state.taskQueue.filter(task => task.status === 'running').length;
        if (missingTaskCount || stuckTaskCount) {
            const bulkActions = documentRef.createElement('div');
            bulkActions.className = 'bakemono-memory-inline-actions bakemono-memory-draft-bulk-actions';
            bulkActions.innerHTML = `${stuckTaskCount ? `<button class="menu_button danger" data-bakemono-action="clear-stuck-tasks"><i class="fa-solid fa-unlink"></i><span>解除卡住任务 ${stuckTaskCount}</span></button>` : ''}${missingTaskCount ? `<button class="menu_button danger" data-bakemono-action="remove-missing-all"><i class="fa-solid fa-broom"></i><span>移除缺失摘要任务 ${missingTaskCount}</span></button>` : ''}`;
            container.append(bulkActions);
        }
        if (!state.taskQueue.length) {
            const empty = documentRef.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无任务。生成阶段总结、多次总结或旧正文补课时，会先进入这里排队。';
            container.append(empty);
            return;
        }
        const fragment = documentRef.createDocumentFragment();
        state.taskQueue.slice().reverse().forEach(task => {
            const row = documentRef.createElement('div');
            row.className = `bakemono-memory-task-item is-${task.status || 'queued'}`;
            row.dataset.taskId = task.id;
            const marker = documentRef.createElement('span');
            marker.className = 'bakemono-memory-task-marker';
            const markerIcon = documentRef.createElement('i');
            markerIcon.className = task.status === 'running' ? 'fa-solid fa-spinner fa-spin' : task.status === 'done' ? 'fa-solid fa-check' : task.status === 'failed' ? 'fa-solid fa-exclamation' : 'fa-solid fa-clock';
            marker.append(markerIcon);
            const main = documentRef.createElement('div');
            main.className = 'bakemono-memory-task-main';
            const title = documentRef.createElement('strong');
            title.textContent = task.label || getKindLabel(task.kind);
            const meta = documentRef.createElement('span');
            meta.textContent = `${getTaskStatusLabel(task.status)} · ${task.createdAt ? new Date(task.createdAt).toLocaleString() : ''}`;
            main.append(title, meta);
            if (task.error) {
                const error = documentRef.createElement('em');
                error.textContent = task.error;
                main.append(error);
            }
            const actions = documentRef.createElement('div');
            actions.className = 'bakemono-memory-task-actions';
            if (task.status === 'failed') actions.innerHTML = '<button class="menu_button" data-bakemono-task-action="retry"><i class="fa-solid fa-rotate"></i><span>重试</span></button>';
            const removeLabel = task.status === 'running' ? '强制移除' : '移除';
            actions.insertAdjacentHTML('beforeend', `<button class="menu_button${task.status === 'running' ? ' danger' : ''}" data-bakemono-task-action="remove"><i class="fa-solid fa-xmark"></i><span>${removeLabel}</span></button>`);
            row.append(marker, main, actions);
            fragment.append(row);
        });
        container.append(fragment);
    }

    return {
        changeHistoryPage,
        historyState,
        renderDrafts,
        renderHistory,
        renderTabs,
        renderTaskQueue,
        setActiveView,
    };
}
