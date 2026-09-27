import {getSummaryStatus, resolveSummaryGraph, summarySourceFloors} from '../memory/summary-provenance.js';

// 摘要树: which part of the story sits at which level. Volumes (多次总结) hold chapters (阶段总结), chapters hold
// story summaries; whatever is not gathered yet comes last. The tree shows structure only — every item has
// “打开 ›”, which opens it on the 总结 page.

// Runs of consecutive floors in the same state, for the coverage strip.
export function coverageRuns(records = [], epicFloors = new Set()) {
    const runs = [];
    for (const record of records) {
        const state = record.summaryState;
        const band = state === 'covered' ? (epicFloors.has(record.id) ? 'epic' : 'stage') : state === 'saved' ? 'story' : 'missing';
        const last = runs.at(-1);
        if (last?.band === band) { last.to = record.id; last.count += 1; } else runs.push({ band, from: record.id, to: record.id, count: 1 });
    }
    return runs;
}

export function createSummaryTimelineUi({
    documentRef,
    getState,
    getStoryBlocks,
    getBlocksByType,
    blockTypes,
    dedupeByHash,
    summaryToBlock,
    unique,
    getMultiSummaryLabel,
    getKindLabel,
    getBlockTitle,
    getFloorIndex = null,
    describeSummary = null,
    escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
    pageSize = 25,
    storyPreview = 12,
}) {
    const esc = escapeHtml;
    const pageState = { page: 0 };
    const view = { filter: 'all', ascending: true };
    const closedVolumes = new Set();
    const openChapters = new Set();
    const fullLists = new Set();

    function changePage(direction) {
        pageState.page = Math.max(0, (pageState.page || 0) + direction);
    }

    function setFilter(filter) {
        view.filter = ['all', 'loose', 'stale'].includes(filter) ? filter : 'all';
        pageState.page = 0;
    }

    function toggleOrder() {
        view.ascending = !view.ascending;
    }

    // Open state lives here so a re-render keeps what the reader unfolded.
    function toggle(kind, key) {
        const set = kind === 'volume' ? closedVolumes : kind === 'chapter' ? openChapters : fullLists;
        if (set.has(key)) set.delete(key); else set.add(key);
    }

    const keyOf = block => block.id || block.hash;

    function floorText(state, block) {
        const floors = summarySourceFloors(state, block);
        if (!floors.length) {
            const own = Number(block.messageId);
            return Number.isFinite(own) && own < Number.MAX_SAFE_INTEGER ? { first: own, last: own, text: `第 ${own} 楼` } : { first: Infinity, last: Infinity, text: '' };
        }
        const [first, last] = [floors[0], floors.at(-1)];
        return { first, last, text: first === last ? `第 ${first} 楼` : `第 ${first}–${last} 楼` };
    }

    function nameOf(block, kind) {
        const described = describeSummary?.({ ...block, type: kind })?.title;
        if (described) return described;
        return block.title || getBlockTitle(block.content || '', kind === blockTypes.EPIC ? getMultiSummaryLabel(block) : getKindLabel(kind));
    }

    const openLink = (block, kind) => `<button type="button" class="bk-sum-link bk-tree-open" data-bakemono-summary-focus="${esc(keyOf(block))}" data-summary-type="${esc(kind)}">打开 ›</button>`;

    function storyRow(state, story) {
        const status = getSummaryStatus(state, { ...story, type: blockTypes.STORY });
        const floor = floorText(state, story);
        return `<div class="bk-tree-story${status.valid ? '' : ' is-stale'}"><span class="bk-tree-no">${Number.isFinite(floor.first) ? `#${floor.first}` : '#?'}</span>
            <span class="bk-tree-title"${status.valid ? '' : ` title="${esc(status.reason)}"`}>${esc(nameOf(story, blockTypes.STORY))}</span>${openLink(story, blockTypes.STORY)}</div>`;
    }

    function missingRow(floor) {
        return `<div class="bk-tree-story is-missing"><span class="bk-tree-no">#${floor}</span><span class="bk-tree-title">没有摘要</span>
            <button type="button" class="bk-sum-link bk-tree-open" data-bakemono-nav="preview" data-bakemono-preview-type="story" data-bakemono-open-batch>去补写 ›</button></div>`;
    }

    function storyList(state, key, stories, extra = []) {
        const ordered = view.ascending ? stories : [...stories].reverse();
        const rows = [...ordered.map(story => ({ at: floorText(state, story).first, html: () => storyRow(state, story) })), ...extra];
        rows.sort((a, b) => view.ascending ? a.at - b.at : b.at - a.at);
        const shown = fullLists.has(key) ? rows : rows.slice(0, storyPreview);
        return `<div class="bk-tree-stories">${shown.map(row => row.html()).join('')}${rows.length > shown.length
            ? `<button type="button" class="bk-sum-link bk-tree-more" data-bakemono-tree-toggle="list" data-tree-key="${esc(key)}">其余 ${rows.length - shown.length} 条 ›</button>` : ''}</div>`;
    }

    function chapterNode(state, stage, stories, loose) {
        const key = keyOf(stage);
        const open = openChapters.has(key);
        const status = getSummaryStatus(state, { ...stage, type: blockTypes.STAGE });
        const floor = floorText(state, stage);
        return `<div class="bk-tree-chapter${status.valid ? '' : ' is-stale'}${open ? ' is-open' : ''}">
            <div class="bk-tree-chapter-h">
                <button type="button" class="bk-tree-head" data-bakemono-tree-toggle="chapter" data-tree-key="${esc(key)}" aria-expanded="${open}">
                    <span class="bk-tree-chev" aria-hidden="true">›</span>
                    <span class="bk-tree-main"><strong>${esc(nameOf(stage, blockTypes.STAGE))}</strong>
                    <span class="bk-sum-meta">${[floor.text, `${stories.length} 条摘要`].filter(Boolean).map(text => `<span>${esc(text)}</span>`).join('')}${loose ? '<span class="is-alert">还没收进卷</span>' : ''}</span>
                    ${status.valid ? '' : `<span class="bk-tree-why">需重建：${esc(status.reason)}</span>`}</span>
                </button>${openLink(stage, blockTypes.STAGE)}
            </div>
            ${open ? storyList(state, key, stories) : ''}</div>`;
    }

    function volumeNode({ key, kicker, title, meta = [], warn = '', loose = false, link = '', body }) {
        const open = !closedVolumes.has(key);
        return `<section class="bk-tree-volume${loose ? ' is-loose' : ''}${open ? ' is-open' : ''}">
            <div class="bk-tree-volume-h">
                <button type="button" class="bk-tree-head" data-bakemono-tree-toggle="volume" data-tree-key="${esc(key)}" aria-expanded="${open}">
                    <span class="bk-tree-chev" aria-hidden="true">›</span>
                    <span class="bk-tree-main"><span class="bk-tree-kicker">${esc(kicker)}</span><strong>${esc(title)}</strong>
                    <span class="bk-sum-meta">${meta.filter(Boolean).map(text => `<span>${esc(text)}</span>`).join('')}${warn ? `<span class="is-alert">${esc(warn)}</span>` : ''}</span></span>
                </button>${link}
            </div>
            ${open ? `<div class="bk-tree-volume-body">${body()}</div>` : ''}</section>`;
    }

    function renderSummary(state, counts, runs, missingFloors) {
        const set = (selector, text) => { const node = documentRef.querySelector(selector); if (node) node.textContent = text; };
        set('#bakemono-memory-timeline-story-count', counts.story);
        set('#bakemono-memory-timeline-stage-count', counts.stage);
        set('#bakemono-memory-timeline-epic-count', counts.epic);
        const total = runs.reduce((sum, run) => sum + run.count, 0);
        const inVolume = runs.filter(run => run.band === 'epic').reduce((sum, run) => sum + run.count, 0);
        set('#bakemono-memory-timeline-headline', !total ? '还没有楼层' : counts.epic ? `${inVolume} / ${total} 楼已收进卷` : `${total} 楼，还没有卷`);
        const strip = documentRef.querySelector('#bakemono-memory-timeline-strip');
        if (strip) {
            strip.innerHTML = runs.map(run => `<i class="is-${run.band}" style="flex:${run.count}" title="${run.from === run.to ? `第 ${run.from} 楼` : `第 ${run.from}–${run.to} 楼`}"></i>`).join('');
            strip.setAttribute('aria-label', runs.map(run => `${run.from === run.to ? `第 ${run.from} 楼` : `第 ${run.from}–${run.to} 楼`}${{ epic: '收进卷', stage: '只收进章', story: '只有剧情摘要', missing: '没有摘要' }[run.band]}`).join('，') || '还没有楼层');
            strip.hidden = !runs.length;
        }
        documentRef.querySelectorAll('[data-bakemono-tree-filter]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.bakemonoTreeFilter === view.filter));
        });
        set('#bakemono-memory-timeline-order', view.ascending ? '最早在前 ⇅' : '最新在前 ⇅');
        return missingFloors;
    }

    function render(state = getState()) {
        const container = documentRef.querySelector('#bakemono-memory-timeline');
        if (!container) return;
        const storyBlocks = getStoryBlocks();
        const stageBlocks = dedupeByHash([...getBlocksByType(blockTypes.STAGE), ...state.stageSummaries.map(summaryToBlock)]);
        const epicBlocks = dedupeByHash([...getBlocksByType(blockTypes.EPIC), ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC }))]);
        const byHash = new Map([...storyBlocks, ...stageBlocks, ...epicBlocks].map(block => [block.hash, block]));
        const graph = resolveSummaryGraph(state);
        const isValid = (block, kind) => getSummaryStatus(state, { ...block, type: kind }, graph).valid;

        let records = [];
        try { records = getFloorIndex?.(state)?.records || []; } catch { records = []; }
        const epicFloors = new Set(epicBlocks.flatMap(epic => summarySourceFloors(state, epic, graph)));
        const runs = coverageRuns(records, epicFloors);
        const missingFloors = records.filter(record => record.summaryState === 'missing').map(record => record.id);
        renderSummary(state, { story: storyBlocks.length, stage: stageBlocks.length, epic: epicBlocks.length }, runs, missingFloors);

        container.innerHTML = '';
        if (!storyBlocks.length && !stageBlocks.length && !epicBlocks.length) {
            container.innerHTML = '<p class="bk-sum-empty">还没有摘要。扫描聊天或保存草稿后，这里会显示每段剧情收在哪一层。</p>';
            return;
        }

        const storiesOf = stage => (stage.sourceHashes || []).map(hash => byHash.get(hash)).filter(block => block && block.type !== blockTypes.STAGE && block.type !== blockTypes.EPIC);
        const staleOnly = view.filter === 'stale';
        const chapterPasses = stage => !staleOnly || !isValid(stage, blockTypes.STAGE) || storiesOf(stage).some(story => !isValid(story, blockTypes.STORY));
        const order = list => list.sort((a, b) => (floorText(state, a).first - floorText(state, b).first) * (view.ascending ? 1 : -1));

        // A volume's body: chapters and any nested volumes or loose stories it gathered directly.
        const volumeBody = (epic, ancestors = new Set()) => () => {
            const visited = new Set([...ancestors, epic.hash]);
            const parts = unique([...(epic.sourceStageHashes || []), ...(epic.sourceHashes || [])]).map(hash => byHash.get(hash)).filter(Boolean);
            const chapters = order(parts.filter(block => block.type === blockTypes.STAGE && chapterPasses(block)));
            const nested = order(parts.filter(block => block.type === blockTypes.EPIC && !visited.has(block.hash) && visited.size < 50));
            const stories = parts.filter(block => block.type !== blockTypes.STAGE && block.type !== blockTypes.EPIC);
            return [
                ...chapters.map(stage => chapterNode(state, stage, storiesOf(stage), false)),
                ...nested.map(child => volumeNode(volumeOptions(child, visited))),
                stories.length ? storyList(state, keyOf(epic) + ':stories', stories) : '',
            ].join('') || '<p class="bk-sum-empty">这一卷里没有符合筛选的内容。</p>';
        };
        const volumeOptions = (epic, ancestors = new Set()) => {
            const floor = floorText(state, epic);
            const chapterCount = (epic.sourceStageHashes || []).length;
            const valid = isValid(epic, blockTypes.EPIC);
            return {
                key: keyOf(epic), kicker: '卷 · 多次总结', title: nameOf(epic, blockTypes.EPIC),
                meta: [floor.text, chapterCount ? `${chapterCount} 章` : ''],
                warn: valid ? '' : '需重建：' + getSummaryStatus(state, { ...epic, type: blockTypes.EPIC }, graph).reason,
                link: openLink(epic, blockTypes.EPIC),
                body: volumeBody(epic, ancestors),
            };
        };

        // An item listed inside a volume or chapter stays there even when that parent needs rebuilding (it is marked
        // there instead), so nothing shows up twice.
        const coveredStage = new Set([...graph.coveredStageHashes, ...graph.coveredEpicHashes]);
        const listedInVolume = new Set(epicBlocks.flatMap(epic => [...(epic.sourceStageHashes || []), ...(epic.sourceHashes || [])]));
        const listedInChapter = new Set([...stageBlocks, ...epicBlocks].flatMap(block => block.sourceHashes || []));
        const rootEpics = order(epicBlocks.filter(epic => !coveredStage.has(epic.hash) && !listedInVolume.has(epic.hash)));
        const looseStages = order(stageBlocks.filter(stage => !coveredStage.has(stage.hash) && !listedInVolume.has(stage.hash) && chapterPasses(stage)));
        const looseStories = storyBlocks.filter(story => !graph.coveredStoryHashes.has(story.hash) && !listedInChapter.has(story.hash) && (!staleOnly || !isValid(story, blockTypes.STORY)));

        const rootFactories = [];
        if (view.filter !== 'loose') {
            for (const epic of rootEpics) {
                const options = volumeOptions(epic);
                if (staleOnly && !options.warn && !options.body().includes('is-stale')) continue;
                rootFactories.push(() => volumeNode(options));
            }
        }
        if (looseStages.length) {
            const first = floorText(state, looseStages[0]), last = floorText(state, looseStages.at(-1));
            rootFactories.push(() => volumeNode({
                key: 'loose-stages', kicker: '还没整理', title: '没收进卷的章', loose: true,
                meta: [`${looseStages.length} 章`, Number.isFinite(first.first) ? `第 ${Math.min(first.first, last.first)}–${Math.max(first.last, last.last)} 楼` : ''],
                body: () => looseStages.map(stage => chapterNode(state, stage, storiesOf(stage), true)).join(''),
            }));
        }
        const missingRows = staleOnly ? [] : missingFloors.map(floor => ({ at: floor, html: () => missingRow(floor) }));
        if (looseStories.length || missingRows.length) {
            rootFactories.push(() => volumeNode({
                key: 'loose-stories', kicker: '还没整理', title: '没收进章的剧情摘要', loose: true,
                meta: [looseStories.length ? `${looseStories.length} 条` : ''],
                warn: missingRows.length ? `${missingRows.length} 楼没有摘要` : '',
                link: looseStories.length ? '<button type="button" class="bk-sum-link bk-tree-open" data-bakemono-nav="preview" data-bakemono-preview-type="stage">整理成一章 ›</button>' : '',
                body: () => storyList(state, 'loose-stories', looseStories, missingRows),
            }));
        }

        const pageCount = Math.max(1, Math.ceil(rootFactories.length / pageSize));
        pageState.page = Math.min(Math.max(0, pageState.page || 0), pageCount - 1);
        const start = pageState.page * pageSize;
        const html = rootFactories.slice(start, start + pageSize).map(createRoot => createRoot()).join('');
        container.innerHTML = (html || '<p class="bk-sum-empty">没有符合筛选的内容。</p>') + (pageCount > 1 ? `<div class="bakemono-memory-preview-pager bk-sum-pager">
            <button type="button" class="bk-sum-link bakemono-preview-page-button" data-bakemono-timeline-page="prev"${pageState.page <= 0 ? ' disabled' : ''}>‹ 上一页</button>
            <span class="bakemono-memory-preview-page-info">${start + 1}-${Math.min(start + pageSize, rootFactories.length)} / ${rootFactories.length}</span>
            <button type="button" class="bk-sum-link bakemono-preview-page-button" data-bakemono-timeline-page="next"${pageState.page >= pageCount - 1 ? ' disabled' : ''}>下一页 ›</button></div>` : '');
    }

    return { changePage, render, setFilter, toggle, toggleOrder };
}
