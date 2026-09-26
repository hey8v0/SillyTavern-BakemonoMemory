import { getSummarySourceShortLabel } from './summary-source-wizard.js';

const reelBand = state => state === 'covered' ? 'covered' : state === 'saved' ? 'saved' : 'open';

// Coverage for the home page: the whole story as a few runs plus gap ticks (constant size at any
// length), and the latest floors one by one. User messages are not indexed and show as plain frames.
export function buildFloorReel(index, chatLength, recentCount = 24) {
    const records = index?.records || [];
    const byId = index?.byId || new Map(records.map(record => [record.id, record]));
    const lastFloor = Math.max(chatLength - 1, records.at(-1)?.id ?? -1);
    const runs = [];
    for (const record of records) {
        const band = reelBand(record.summaryState);
        const run = runs.at(-1);
        if (run?.band === band) { run.to = record.id; run.count++; }
        else runs.push({ band, from: record.id, to: record.id, count: 1 });
    }
    const gaps = records.filter(record => record.summaryState === 'missing').map(record => record.id);
    // Neighbouring gaps closer than half a percent share one tick.
    const ticks = [];
    for (const id of gaps) {
        const at = lastFloor > 0 ? id / lastFloor : 0;
        if (!ticks.length || at - ticks.at(-1).at > 0.005) ticks.push({ at, from: id, to: id });
        else ticks.at(-1).to = id;
    }
    const first = Math.max(0, lastFloor - recentCount + 1);
    const recent = lastFloor < 0 ? [] : Array.from({ length: lastFloor - first + 1 }, (_, i) => {
        const id = first + i, record = byId.get(id);
        return { id, state: record ? record.summaryState : 'user' };
    });
    const count = state => records.filter(record => record.summaryState === state).length;
    return { lastFloor, runs, ticks, recent, counts: { covered: count('covered'), saved: count('saved'), missing: count('missing'), draft: count('draft') } };
}

export function createOverviewWorkbenchUi({
    query,
    getState,
    getChat = () => [],
    escapeHtml = value => String(value ?? ''),
    getActiveGlobalConfig,
    defaultAutomation,
    defaultScanRules,
    defaultState,
    getCurrentFloorMemoryIndex,
    getOverviewHealth,
    getOverviewRecommendation = () => null,
    getActiveTab,
    renderTokenManifest,
}) {
    const esc = escapeHtml;
    const frameNames = { covered: '已进入阶段总结', saved: '有剧情摘要，还没整理成阶段总结', missing: '助手回复，还没有摘要', draft: '摘要待确认', user: '用户发言或系统消息（不需要摘要）' };

    function renderOverviewConfigManifest(state = getState()) {
        const activeConfig = getActiveGlobalConfig();
        const scanMode = state.scanRules?.mode || defaultScanRules.mode;
        const apiProvider = state.automation?.apiProvider || defaultAutomation.apiProvider;
        const backgroundFeatures = [];
        if (state.turnSummary?.auto) backgroundFeatures.push('自动记忆');
        if (state.automation?.enabled) backgroundFeatures.push('自动总结');
        if (state.autoHideRecent?.enabled) backgroundFeatures.push('楼层收纳');
        const vectorProvider = state.vectorMemory?.embeddingProvider === 'custom-openai' ? '外部语义检索' : '本地轻量检索';
        const set = (id, text, off = false) => query(id).text(text).toggleClass('is-off', off);

        query('#bakemono-memory-overview-config-scope').text(activeConfig ? '全部聊天' : '当前聊天');
        query('#bakemono-memory-overview-config-name').text(activeConfig?.name || '当前聊天配置');
        set('#bakemono-memory-overview-config-workflow', getSummarySourceShortLabel(state));
        set('#bakemono-memory-overview-config-scan', scanMode === 'full' ? '全文管线' : '标签块模式');
        set('#bakemono-memory-overview-config-model', apiProvider === 'custom'
            ? (String(state.automation?.customApi?.model || '').trim() || '自定义接口')
            : '酒馆主模型');
        set('#bakemono-memory-overview-config-auto', backgroundFeatures.length ? backgroundFeatures.join(' · ') : '全部关闭', !backgroundFeatures.length);
        set('#bakemono-memory-overview-config-injection', state.injection?.enabled
            ? `开启 · 深度 ${Number(state.injection?.depth ?? defaultState.injection.depth).toLocaleString()}`
            : '关闭', !state.injection?.enabled);
        set('#bakemono-memory-overview-config-vector', state.vectorMemory?.enabled ? vectorProvider : '未开启', !state.vectorMemory?.enabled);
    }

    function renderActions(floorStats, recommendation) {
        const actions = [];
        if (recommendation?.buttonLabel) {
            const attribute = recommendation.kind === 'nav' ? 'data-bakemono-nav' : 'data-bakemono-action';
            actions.push(`<button type="button" class="menu_button bk-home-primary" ${attribute}="${esc(recommendation.target)}">${esc(recommendation.buttonLabel)}</button>`);
        }
        if (floorStats.pendingDraftCount && recommendation?.target !== 'drafts') actions.push(`<button type="button" class="bk-home-more" data-bakemono-nav="drafts">待确认 ${floorStats.pendingDraftCount.toLocaleString()} 条 ›</button>`);
        if (floorStats.storySummaryCount || floorStats.stageSummaryCount) actions.push('<button type="button" class="bk-home-more" data-bakemono-nav="timeline">看摘要树 ›</button>');
        query('#bakemono-memory-overview-actions').html(actions.join(''));
    }

    function renderReel(index) {
        const reel = buildFloorReel(index, (getChat() || []).length);
        const floors = reel.lastFloor + 1;
        query('#bakemono-memory-overview-floor-total').text(`共 ${floors.toLocaleString()} 楼`);
        query('#bakemono-memory-overview-span-range').text(floors ? `第 0 – ${reel.lastFloor.toLocaleString()} 楼` : '');
        query('#bakemono-memory-overview-span').html(reel.runs.map(run => `<i class="is-${run.band}" style="flex-grow:${run.count}" title="第 ${run.from}–${run.to} 楼 · ${esc(frameNames[run.band === 'open' ? 'missing' : run.band])}"></i>`).join(''));
        query('#bakemono-memory-overview-ticks').html(reel.ticks.slice(0, 400).map(tick => `<i style="left:${(tick.at * 100).toFixed(2)}%" title="第 ${tick.from}${tick.to !== tick.from ? '–' + tick.to : ''} 楼没有摘要"></i>`).join(''));
        const recent = reel.recent;
        query('#bakemono-memory-overview-recent-label').text(`最近 ${recent.length} 楼`);
        query('#bakemono-memory-overview-recent-range').text(recent.length ? `第 ${recent[0].id} – ${recent.at(-1).id} 楼` : '');
        query('#bakemono-memory-overview-recent').css('--bk-frames', String(Math.max(1, recent.length))).html(recent.map(frame =>
            `<button type="button" class="bk-home-frame is-${frame.state}" data-bakemono-floor="${frame.id}" aria-label="第 ${frame.id} 楼：${frameNames[frame.state]}"></button>`).join(''));
        const middle = recent[Math.floor(recent.length / 2)];
        query('#bakemono-memory-overview-recent-scale').html(recent.length ? `<span>${recent[0].id}</span>${recent.length > 2 ? `<span>${middle.id}</span>` : ''}<span>${recent.at(-1).id}</span>` : '');
        query('#bakemono-memory-overview-covered-count').text(reel.counts.covered.toLocaleString());
        query('#bakemono-memory-overview-saved-count').text(reel.counts.saved.toLocaleString());
        query('#bakemono-memory-overview-reel-tip').text(recent.length ? '点最近楼层的一格，查看是哪一楼' : '当前聊天还没有楼层');
    }

    function renderWorkflowGuide(state = getState()) {
        const index = getCurrentFloorMemoryIndex(state);
        const floorStats = index.aggregates;
        const health = getOverviewHealth(floorStats, state);
        let recommendation = null;
        try { recommendation = getOverviewRecommendation(state, index); } catch { recommendation = null; }

        query('#bakemono-memory-overview-status-label').text(health.badge);
        query('#bakemono-memory-workflow-title').text(health.title);
        query('#bakemono-memory-overview-next-copy').text(health.copy);
        query('#bakemono-memory-index-ready-floor').text(floorStats.summarized.toLocaleString());
        query('#bakemono-memory-index-pending-count').text(floorStats.missing.toLocaleString());
        query('#bakemono-memory-count-drafts').text(floorStats.pendingDraftCount.toLocaleString());
        query('.bk-home-status').attr('data-health-tone', health.tone);
        renderActions(floorStats, recommendation);
        renderReel(index);
        renderOverviewConfigManifest(state);
        if (getActiveTab() === 'overview') void renderTokenManifest(state);
    }

    function describeFloor(id) {
        const index = getCurrentFloorMemoryIndex(getState());
        const record = index.byId?.get(Number(id));
        const text = `第 ${id} 楼 · ${frameNames[record ? record.summaryState : 'user']}`;
        query('#bakemono-memory-overview-reel-tip').text(record?.coveredBy?.length ? `${text}（${record.coveredBy.slice(0, 2).join('、')}）` : text);
        query('#bakemono-memory-overview-recent .is-picked').removeClass('is-picked');
        query(`#bakemono-memory-overview-recent [data-bakemono-floor="${Number(id)}"]`).addClass('is-picked');
    }

    // Pointing at a colour segment or a source row highlights both and names its share.
    function focusSource(key) {
        const row = key && query(`[data-bakemono-token-source="${key}"]`);
        const value = row?.find(`#bakemono-memory-token-${key}`).text();
        const on = !!row?.length && value && value !== '—';
        query('#bakemono-memory-overview-token-stack').toggleClass('is-focus', on);
        query('[data-bakemono-stack-source], .bk-home-src').removeClass('is-on');
        if (on) {
            query(`[data-bakemono-stack-source="${key}"]`).addClass('is-on');
            row.addClass('is-on');
            query('#bakemono-memory-overview-token-readout').text(`${row.find('strong').text()} · ${value} tokens · ${row.find(`#bakemono-memory-token-pct-${key}`).text()}`);
        }
    }

    function bind(root) {
        if (!root) return;
        query(root).off('.bakemonoHome')
            .on('click.bakemonoHome', '[data-bakemono-floor]', function () { describeFloor(this.dataset.bakemonoFloor); })
            .on('pointerover.bakemonoHome', '[data-bakemono-stack-source], .bk-home-src', function () { focusSource(this.dataset.bakemonoStackSource || this.dataset.bakemonoTokenSource); })
            .on('pointerleave.bakemonoHome', '.bk-home-context', () => focusSource(null))
            .on('pointermove.bakemonoHome', '.bk-home-cell', function (event) {
                const box = this.getBoundingClientRect();
                this.style.setProperty('--bk-mx', `${event.clientX - box.left}px`);
                this.style.setProperty('--bk-my', `${event.clientY - box.top}px`);
            });
    }

    return { bind, buildFloorReel, describeFloor, renderOverviewConfigManifest, renderWorkflowGuide };
}
