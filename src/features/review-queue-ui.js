// 待确认: drafts wait here before they reach long-term memory, next to the task queue and the save history.
// Same look as the 总结 page: a row of levels, ruled lists, one “⋯” per draft; only 保存 sits outside it.
const statusLabels = { queued: '等待中', running: '生成中', done: '已完成', partial: '部分完成', failed: '失败' };

function shortTime(value, now = new Date()) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const minutes = Math.round((now - date) / 60000);
    const pad = number => String(number).padStart(2, '0');
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (minutes >= 0 && minutes < 1) return '刚刚';
    if (minutes >= 0 && minutes < 60) return `${minutes} 分钟前`;
    if (date.toDateString() === now.toDateString()) return clock;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

function dayLabel(value, now = new Date()) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '更早';
    const start = day => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const days = Math.round((start(now) - start(date)) / 86400000);
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    return `${date.getFullYear() === now.getFullYear() ? '' : date.getFullYear() + '年'}${date.getMonth() + 1}月${date.getDate()}日`;
}

// Where a draft came from, used to group drafts that arrived together.
export function draftOrigin(draft) {
    const metadata = draft?.metadata || {};
    if (metadata.appendMode === 'missing_summary') return '补写缺失摘要';
    if (metadata.sourceKind === 'backfill' || draft?.trigger === 'backfill') return '旧正文补课';
    if (/auto/.test(String(draft?.trigger || ''))) return '自动总结';
    return '手动生成';
}

export function createReviewQueueUi({
    documentRef,
    query,
    getState,
    isMissingSummaryTask,
    getKindLabel,
    blockTypes,
    historyPageSize = 10,
    renderRpReview,
    getRpPendingCount = state => state.rpCore?.candidates?.filter(item => item.status === 'pending').length || 0,
    escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
    describeSummary = draft => ({ title: draft.title || '', lead: String(draft.content || '').replace(/\s+/g, ' ').trim().slice(0, 180) }),
    createSummaryDocument = null,
}) {
    const esc = escapeHtml;
    const historyState = { page: 0 };
    const openDrafts = new Set();
    let activeView = 'drafts';

    function setActiveView(view) {
        activeView = ['drafts', 'tasks', 'history'].includes(view) ? view : 'drafts';
    }

    function changeHistoryPage(direction) {
        historyState.page = Math.max(0, (historyState.page || 0) + direction);
    }

    function getTaskStatusLabel(status) {
        return statusLabels[status] || '等待中';
    }

    function renderTabs(state = getState()) {
        const counts = { drafts: state.drafts.length + getRpPendingCount(state), tasks: state.taskQueue.length, history: state.history.length };
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

    function draftFloors(draft) {
        const metadata = draft.metadata || {};
        if (metadata.sourceRange) return String(metadata.sourceRange);
        const ids = [metadata.targetMessageId, ...(draft.sourceMessageIds || [])].map(Number).filter(id => Number.isFinite(id) && id < Number.MAX_SAFE_INTEGER);
        if (!ids.length) return '';
        const [first, last] = [Math.min(...ids), Math.max(...ids)];
        return first === last ? `第 ${first} 楼` : `第 ${first}–${last} 楼`;
    }

    function firstFloor(draft) {
        const ids = [draft.metadata?.targetMessageId, ...(draft.sourceMessageIds || [])].map(Number).filter(id => Number.isFinite(id) && id < Number.MAX_SAFE_INTEGER);
        return ids.length ? Math.min(...ids) : '';
    }

    function draftItem(draft) {
        const metadata = draft.metadata || {};
        const open = openDrafts.has(draft.id);
        const block = { content: draft.content || '', type: draft.kind || blockTypes.STORY, title: draft.title, isGeneratedSummary: true, metadata: {} };
        const { title, lead } = describeSummary(block);
        const name = String(draft.title || '').trim() || title || getKindLabel(draft.kind);
        const where = [draftFloors(draft), metadata.batchIndex ? `第 ${metadata.batchIndex}/${metadata.batchTotal || '?'} 批` : '', shortTime(draft.createdAt)].filter(Boolean).join(' · ');
        const item = documentRef.createElement('article');
        item.className = `bk-rev-draft${open ? ' is-open' : ''}`;
        item.dataset.draftId = draft.id;
        item.dataset.draftName = name;
        item.dataset.draftWhere = where;
        item.dataset.draftFloor = firstFloor(draft);
        item.innerHTML = `
            <div class="bk-rev-draft-h">
                <button type="button" class="bk-rev-tap" data-bakemono-draft-toggle aria-expanded="${open}">
                    <span class="bk-sum-line1"><span class="bk-rev-kind">${esc(getKindLabel(draft.kind))}</span><span class="bk-sum-where">${esc(where)}</span></span>
                    <span class="bk-sum-ttl">${esc(name)}</span>
                    <span class="bk-rev-lead">${esc(lead || '草稿还没有正文。')}</span>
                    ${metadata.appendMode === 'missing_summary' ? `<span class="bk-rev-note">保存后写回${esc(draftFloors(draft) || '原楼层')}末尾</span>` : ''}
                    ${metadata.inputError ? `<span class="bk-rev-note is-alert">上次保存没有成功：${esc(metadata.inputError)}</span>` : ''}
                </button>
                <button type="button" class="bk-sum-dots" data-bakemono-draft-menu aria-label="${esc(name)} 的操作">⋯</button>
            </div>
            <div class="bk-rev-full"${open ? '' : ' hidden'}></div>
            <div class="bakemono-memory-draft-editor-disclosure bk-sum-editor" hidden>
                <label class="bk-sum-field"><span>标题</span><input class="text_pole bakemono-memory-draft-title" type="text" placeholder="草稿标题"></label>
                <label class="bk-sum-field"><span>原文</span><textarea class="text_pole bakemono-memory-draft-editor" rows="14" spellcheck="false"></textarea></label>
                <div class="bk-sum-editor-actions">
                    <button type="button" class="menu_button bk-sum-primary" data-bakemono-draft-edit="save">保存修改</button>
                    <button type="button" class="bk-sum-link" data-bakemono-draft-edit="cancel">取消</button>
                </div>
            </div>
            <div class="bk-rev-foot">
                <button type="button" class="bk-sum-link" data-bakemono-draft-toggle>${open ? '收起 ↑' : '展开全文 ›'}</button>
                <span class="bk-rev-spacer"></span>
                <button type="button" class="menu_button bk-sum-primary" data-bakemono-draft-action="commit">保存</button>
            </div>`;
        item.querySelector('.bakemono-memory-draft-title').value = draft.title || '';
        item.querySelector('.bakemono-memory-draft-editor').value = draft.content || '';
        if (open) fillDocument(item, draft);
        return item;
    }

    function fillDocument(item, draft) {
        const full = item.querySelector('.bk-rev-full');
        if (!full || full.childElementCount) return;
        const block = { content: draft.content || '', type: draft.kind || blockTypes.STORY };
        if (createSummaryDocument) full.append(createSummaryDocument(block));
        else full.textContent = draft.content || '';
    }

    // Expand or fold one draft in place; the open set survives re-renders.
    function toggleDraft(item, open = !item.classList.contains('is-open')) {
        const id = item?.dataset.draftId;
        const draft = getState().drafts.find(entry => entry.id === id);
        if (!draft) return false;
        if (open) openDrafts.add(id); else openDrafts.delete(id);
        item.classList.toggle('is-open', open);
        item.querySelectorAll('[data-bakemono-draft-toggle]').forEach(button => button.setAttribute('aria-expanded', String(open)));
        const fold = item.querySelector('.bk-rev-foot [data-bakemono-draft-toggle]');
        if (fold) fold.textContent = open ? '收起 ↑' : '展开全文 ›';
        const full = item.querySelector('.bk-rev-full');
        if (open) fillDocument(item, draft);
        if (full) full.hidden = !open;
        return open;
    }

    function startDraftEdit(item) {
        const editor = item?.querySelector('.bakemono-memory-draft-editor-disclosure');
        if (!editor) return false;
        toggleDraft(item, true);
        item.classList.add('is-editing');
        editor.hidden = false;
        editor.querySelector('textarea')?.focus({ preventScroll: true });
        return true;
    }

    function stopDraftEdit(item) {
        item?.classList.remove('is-editing');
        const editor = item?.querySelector('.bakemono-memory-draft-editor-disclosure');
        if (editor) editor.hidden = true;
    }

    function renderDrafts(state = getState()) {
        const container = documentRef.querySelector('#bakemono-memory-draft-list');
        if (!container) return;
        renderTabs(state);
        renderRpReview?.(state);
        container.innerHTML = '';
        const rpPending = getRpPendingCount(state);
        const missingDraftCount = state.drafts.filter(draft => draft.metadata?.appendMode === 'missing_summary').length;
        const missingTaskCount = state.taskQueue.filter(task => isMissingSummaryTask(task) && ['queued', 'failed', 'partial', 'done'].includes(task.status)).length;
        const total = state.drafts.length + rpPending;

        const intro = documentRef.createElement('section');
        intro.className = 'bk-sum-next bk-rev-intro';
        intro.innerHTML = `<div class="bk-sum-kicker"><span>草稿 · 等你决定</span></div>
            <h3>${total ? `${total} 条内容等你确认` : '没有要确认的内容'}</h3>
            <p>${total ? '确认之前不会写进长期记忆，也不会注入。保存之后，可以在提示里或“记录”里撤回最近一次。'
                : '手动生成、没开自动保存的自动总结和补写旧聊天的结果会先放在这里；开了自动保存的内容会直接保存。'}</p>
            ${missingDraftCount || missingTaskCount ? `<div class="bk-rev-bulk">
                <span class="bk-rev-grow">补写旧聊天${missingDraftCount ? `产生了 <strong>${missingDraftCount} 条</strong>剧情摘要，确认后写回原楼层` : `还有 ${missingTaskCount} 项任务没处理完`}</span>
                ${missingDraftCount ? `<button type="button" class="menu_button bk-sum-primary" data-bakemono-action="commit-missing-all">全部应用</button>` : ''}
                <button type="button" class="bk-sum-link is-alert" data-bakemono-action="remove-missing-all">全部移除…</button></div>` : ''}`;
        container.append(intro);

        if (rpPending) {
            const rp = documentRef.createElement('button');
            rp.type = 'button';
            rp.className = 'bk-rev-rp';
            rp.dataset.bakemonoNav = 'rp-state';
            rp.innerHTML = `<span class="bk-rev-dot" aria-hidden="true"></span><span class="bk-rev-grow">剧情状态 · ${rpPending} 条待确认<small>在剧情状态页逐条确认</small></span><span class="bk-sum-link">去看 ›</span>`;
            container.append(rp);
        }

        if (!state.drafts.length) return;
        const timeline = documentRef.createElement('div');
        timeline.className = 'bk-sum-timeline';
        let group = null, groupName = null;
        state.drafts.forEach(draft => {
            const origin = draftOrigin(draft);
            if (!group || origin !== groupName) {
                groupName = origin;
                group = documentRef.createElement('section');
                group.className = 'bk-sum-chapter';
                const count = state.drafts.filter(entry => draftOrigin(entry) === origin).length;
                group.innerHTML = `<div class="bk-sum-chapter-h"><div class="bk-sum-head"><h4>${esc(origin)}</h4><span class="bk-sum-meta"><span>${count} 条</span></span></div></div>`;
                timeline.append(group);
            }
            group.append(draftItem(draft));
        });
        container.append(timeline);
    }

    function pager(page, pageCount, total, start) {
        return `<div class="bakemono-memory-preview-pager bk-sum-pager">
            <button type="button" class="bk-sum-link bakemono-preview-page-button" data-bakemono-history-page="prev"${page <= 0 ? ' disabled' : ''}>‹ 较新</button>
            <span class="bakemono-memory-preview-page-info">${start + 1}-${Math.min(start + historyPageSize, total)} / ${total}</span>
            <button type="button" class="bk-sum-link bakemono-preview-page-button" data-bakemono-history-page="next"${page >= pageCount - 1 ? ' disabled' : ''}>较早 ›</button></div>`;
    }

    function renderHistory(state = getState()) {
        const container = documentRef.querySelector('#bakemono-memory-history-list');
        if (!container) return;
        renderTabs(state);
        const latest = state.history[0];
        const latestName = latest ? (latest.summary?.title || latest.draft?.title || getKindLabel(latest.kind)) : '';
        query('#bakemono-memory-history-latest').text(latest ? `最近一次：${latestName}（${shortTime(latest.createdAt)}）` : '还没有保存过。');
        container.innerHTML = '';
        if (!state.history.length) return;
        const pageCount = Math.max(1, Math.ceil(state.history.length / historyPageSize));
        historyState.page = Math.min(Math.max(0, historyState.page || 0), pageCount - 1);
        const start = historyState.page * historyPageSize;
        const rows = state.history.slice(start, start + historyPageSize);
        const days = [];
        rows.forEach((item, index) => {
            const day = dayLabel(item.createdAt);
            if (days.at(-1)?.day !== day) days.push({ day, items: [] });
            days.at(-1).items.push({ item, first: start + index === 0 });
        });
        const mark = kind => kind === blockTypes.EPIC ? '多次' : kind === blockTypes.STAGE ? '阶段' : '摘要';
        container.innerHTML = `<div class="bk-sum-timeline">${days.map(({ day, items }) => `<section class="bk-sum-chapter">
            <div class="bk-sum-chapter-h"><div class="bk-sum-head"><h4>${esc(day)}</h4><span class="bk-sum-meta"><span>${items.length} 次保存</span></span></div></div>
            ${items.map(({ item, first }) => `<div class="bk-rev-hist${first ? ' is-last' : ''}"><span class="bk-rev-mark">${mark(item.kind)}</span>
                <span class="bk-rev-hist-title">${esc(item.summary?.title || item.draft?.title || item.summaryHash)}</span>
                <time>${esc(shortTime(item.createdAt))}</time></div>`).join('')}</section>`).join('')}</div>
            ${pageCount > 1 ? pager(historyState.page, pageCount, state.history.length, start) : ''}`;
    }

    function renderTaskQueue(state = getState()) {
        const container = documentRef.querySelector('#bakemono-memory-task-list');
        if (!container) return;
        renderTabs(state);
        const tasks = state.taskQueue;
        const count = status => tasks.filter(task => task.status === status).length;
        const running = count('running');
        const summary = [['running', '生成中'], ['queued', '等待'], ['failed', '失败'], ['partial', '部分完成'], ['done', '已完成']]
            .map(([status, label]) => count(status) ? `${count(status)} 项${label}` : '').filter(Boolean).join(' · ');
        const removable = new Set(['queued', 'failed', 'partial', 'done']);
        const missingTaskCount = tasks.filter(task => isMissingSummaryTask(task) && removable.has(task.status)).length;
        const headline = !tasks.length ? '没有任务' : state.taskQueuePaused ? '队列已暂停' : running ? '队列运行中' : '队列空闲';
        const controls = tasks.length ? (state.taskQueuePaused
            ? '<button type="button" class="bk-sum-link" data-bakemono-queue-control="resume">继续队列</button>'
            : '<button type="button" class="bk-sum-link" data-bakemono-queue-control="pause" title="当前任务完成后暂停，保留其结果">暂停队列</button>')
            + (running ? '<button type="button" class="bk-sum-link is-alert" data-bakemono-queue-control="stop">停止当前任务</button>' : '') : '';
        const extras = [
            running ? `<button type="button" class="bk-sum-link is-alert" data-bakemono-action="clear-stuck-tasks">解除卡住的任务 ${running}</button>` : '',
            missingTaskCount ? `<button type="button" class="bk-sum-link is-alert" data-bakemono-action="remove-missing-all">移除补写任务 ${missingTaskCount}</button>` : '',
        ].filter(Boolean).join('');
        const rows = tasks.slice().reverse().map(task => {
            const status = task.status || 'queued';
            const links = [
                ['failed', 'partial'].includes(status) ? `<button type="button" class="bk-sum-link" data-bakemono-task-action="retry">${status === 'partial' ? '补齐缺失' : '重试'} ›</button>` : '',
                `<button type="button" class="bk-sum-link${status === 'running' ? ' is-alert' : ''}" data-bakemono-task-action="remove">${status === 'running' ? '强制移除' : '移除'}</button>`,
            ].join('');
            return `<div class="bk-rev-task is-${esc(status)}" data-task-id="${esc(task.id)}">
                <span class="bk-rev-st">${esc(getTaskStatusLabel(status))}</span>
                <div class="bk-rev-task-main"><strong>${esc(task.label || getKindLabel(task.kind))}</strong>
                    <span class="bk-rev-sub">${esc(shortTime(task.createdAt))}</span>
                    ${status === 'running' ? '<div class="bk-rev-bar" aria-hidden="true"><i></i></div>' : ''}
                    ${task.error ? `<p class="bk-rev-why">${esc(task.error)}</p>` : ''}
                    <div class="bk-rev-links">${links}</div></div></div>`;
        }).join('');
        container.innerHTML = `<div class="bk-rev-head"><div class="bk-rev-grow"><h3>${headline}</h3><span class="bk-sum-meta"><span>${esc(summary || '生成阶段总结、多次总结或补写旧聊天时，会先在这里排队。')}</span></span></div>
            <div class="bk-rev-links">${controls}</div></div>
            ${extras ? `<div class="bk-rev-links bk-rev-extras">${extras}</div>` : ''}
            ${rows}`;
    }

    return {
        changeHistoryPage,
        historyState,
        renderDrafts,
        renderHistory,
        renderTabs,
        renderTaskQueue,
        setActiveView,
        startDraftEdit,
        stopDraftEdit,
        toggleDraft,
    };
}
