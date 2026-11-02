/**
 * Which 阶段总结 go with every message and which come back only when the story reaches for them. Pure.
 * Saved chapters pile up as a chat goes on. The latest few stay, with the 多次总结; older ones are found by recall (a
 * floor that matches brings its chapter, see selectRecallPlan), and a line naming them keeps the order of events in view.
 * It needs recall that works on meaning, so the local hash embedding does not count. Only saved chapters go on demand:
 * those are what the index holds whole. Whether recall worked this round is decided by the caller, who falls back to
 * sending every chapter; this only says what the settings allow.
 */
export const defaultRecentStages = 3;

export function stageOnDemandConfigured(state) {
    return state?.injection?.stageOnDemand === true && !!state?.vectorMemory?.enabled && state.vectorMemory.embeddingProvider === 'custom-openai';
}

export const recentStageCount = state => Math.max(1, Math.min(50, Math.round(Number(state?.injection?.recentStages)) || defaultRecentStages));

const floorsOf = block => [...(Array.isArray(block?.sourceMessageIds) ? block.sourceMessageIds : []), block?.sourceStart, block?.sourceEnd, block?.messageId]
    .map(Number).filter(floor => Number.isFinite(floor) && floor >= 0 && floor < Number.MAX_SAFE_INTEGER);
const endFloor = block => Math.max(-1, ...floorsOf(block));

// `stages`: the current chapters no 多次总结 covers. Returns { always, onDemand }, each in the order given.
export function planStageInjection(state, stages = []) {
    if (!stageOnDemandConfigured(state)) return { always: stages, onDemand: [] };
    const saved = new Set((state.stageSummaries || []).map(stage => stage.hash));
    const newest = new Set([...stages].sort((a, b) => endFloor(b) - endFloor(a)).slice(0, recentStageCount(state)).map(stage => stage.hash));
    const stays = stage => newest.has(stage.hash) || !saved.has(stage.hash);
    return { always: stages.filter(stays), onDemand: stages.filter(stage => !stays(stage)) };
}

// The default title of a chapter is the same for all of them; the name the summary gave itself tells them apart.
function chapterName(stage) {
    const named = /『([^』\n]{1,30})』/.exec(String(stage?.content || ''))?.[1];
    if (named) return named.trim();
    const title = String(stage?.title || '').replace(/^【|】$/g, '').trim();
    return title && !/点击回看|阶段总结|剧集终了|未命名/.test(title) ? title.slice(0, 20) : '';
}

// One line that keeps the chapters in view: the model knows they exist, and in what order.
export function stageIndexLine(stages = [], { maxEntries = 40 } = {}) {
    if (!stages.length) return '';
    const ordered = [...stages].sort((a, b) => endFloor(a) - endFloor(b));
    const shown = ordered.slice(-maxEntries).map(stage => {
        const floors = floorsOf(stage);
        const range = !floors.length ? '' : Math.min(...floors) === Math.max(...floors) ? `第 ${floors[0]} 楼` : `第 ${Math.min(...floors)}–${Math.max(...floors)} 楼`;
        return [range, chapterName(stage)].filter(Boolean).join(' ');
    }).filter(Boolean);
    const more = ordered.length - shown.length;
    return `更早的阶段（提到时才带上详情，这里没写的细节不要编）：${more > 0 ? `更早还有 ${more} 段；` : ''}${shown.join('；')}`;
}
