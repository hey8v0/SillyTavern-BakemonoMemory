import { readChatSource, findChatSource } from './chat-sources.js';
import { evidenceHash, sourceStamp } from './source.js';
import { parsePayload } from './extraction.js';
import { assertLedgerVersion } from './ledger.js';
import { compileRpContext } from './context.js';
import { RP_EVENT_GUIDE } from './prompt.js';
export { RP_EVENT_GUIDE } from './prompt.js';

export function stripRpProtocol(value) {
    return String(value || '').replace(/<rpEvents\b[^>]*>[\s\S]*?(?:<\/rpEvents\s*>|$)/gi, '').trim();
}
export function createRpExtractionFlow({ getState, getChat, service, makeSourceId, callGenerationModel,
    getPrompt = () => RP_EVENT_GUIDE, getReferenceContext = async () => '',
    runGeneration = async (_label, run) => run(), isBusy = () => false, onBackgroundResult = () => {}, onBackgroundError = () => {}, delay = setTimeout, cancelDelay = clearTimeout }) {
    let independentRun = null, inlineRun = false, nextTask = 0, captureTimer = null;
    function channel(state = getState()) {
        if (!state.rpCore?.settings?.enabled || state.rpCore.settings.automatic === false) return null;
        try { assertLedgerVersion(state.rpCore); } catch { return null; }
        return ['inline', 'independent'].includes(state.rpCore.settings.mode) ? state.rpCore.settings.mode : null;
    }
    function context(state = getState(), { manual = false, query = getChat().at(-1)?.mes || '', availableBudget = Infinity, includeBrief = !manual } = {}) {
        return compileRpContext(state.rpCore, service.memoryView?.(state) ?? service.view?.(state), { query,
            guide: manual || channel(state) === 'inline' ? getPrompt() : '', maintenance: manual || channel(state) === 'inline', availableBudget, includeBrief });
    }
    function prompt(requested, state = getState(), { manual = false } = {}) {
        if (!manual && channel(state) !== requested) return '';
        const compiled = context(state, { manual: manual || requested === 'independent', query: getChat().at(-1)?.mes || '' });
        if (compiled.blocked) return '';
        return compiled.maintenance;
    }
    function capture(floor, requested, { manual = false } = {}) {
        const state = getState();
        if (!state.rpCore?.settings?.enabled || !manual && channel(state) !== requested) return null;
        const source = readChatSource(getChat()[floor], state, { allocate: true, makeId: makeSourceId });
        if (!source) throw new Error('没有可提取的助手正文');
        if (floor < state.rpCore.baseline.floor) throw new Error('来源在剧情状态起点之前');
        source.floor = floor;
        return { taskId: 'rp-task-' + (++nextTask), state, requested, manual, source, revision: state.rpCore.revision,
            settings: JSON.stringify(state.rpCore.settings), prompt: getPrompt() };
    }
    function assertCurrent(ticket) {
        if (!ticket) return null;
        const state = getState();
        if (state !== ticket.state || !state.rpCore?.settings?.enabled || !ticket.manual && channel(state) !== ticket.requested
            || state.rpCore.revision !== ticket.revision || JSON.stringify(state.rpCore.settings) !== ticket.settings || getPrompt() !== ticket.prompt)
            throw new Error('提取期间聊天、提示词或剧情状态已变化');
        const source = findChatSource(getChat(), state, ticket.source.messageId + '|' + ticket.source.variantId, ticket.source.policy);
        if (!source || sourceStamp(source) !== sourceStamp(ticket.source)) throw new Error('提取期间正文来源已变化');
        return source;
    }
    async function consume(ticket, response, { manual = ticket?.manual || false } = {}) {
        if (!ticket) return { status: 'inactive' };
        const source = assertCurrent(ticket);
        const blocks = [...String(response || '').matchAll(/<rpEvents\b[^>]*>[\s\S]*?<\/rpEvents\s*>/gi)];
        if (blocks.length > 1) throw new Error('同一回复含多个剧情事件块，请重新提取');
        if (!blocks.length) return { status: /<rpEvents\b/i.test(response || '') ? 'incomplete' : 'missing' };
        parsePayload(blocks[0][0]);
        const key = source.messageId + '|' + source.variantId, stamp = sourceStamp(source);
        if (!manual && ticket.state.rpCore.batches.some(batch => batch.sourceKey === key && batch.sourceStamp === stamp && !batch.superseded))
            return { status: 'unchanged' };
        const result = await service.ingest(blocks[0][0], source.floor, { manual, expectedSource: source,
            inputHash: evidenceHash(blocks[0][0] + stamp), protocolStatus: 'complete', taskId: ticket.taskId });
        if (!result) return { status: 'inactive' };
        ticket.revision = result.core.revision;
        assertCurrent(ticket);
        return { status: 'processed', result, protocolStatus: 'complete' };
    }
    const latestFloor = () => getChat().findLastIndex(message => message && !message.is_user && !message.is_system);
    const delayed = state => state.rpCore.settings.triggerTiming === 'next_user' && !getChat().findLast(message => message && !message.is_system)?.is_user;
    async function captureInline(options = {}) {
        if (inlineRun) return options.detailed ? { status: 'busy' } : false;
        inlineRun = true;
        try { return await captureInlineOnce(options); }
        finally { inlineRun = false; }
    }
    async function captureInlineOnce({ detailed = false } = {}) {
        await service.migrate?.();
        const report = result => detailed ? result : result.status === 'processed', state = getState();
        if (channel(state) !== 'inline') return report({ status: 'inactive' });
        if (isBusy()) return report({ status: 'busy' });
        if (delayed(state)) return report({ status: 'delayed' });
        const floor = latestFloor();
        if (floor < (state.rpCore?.baseline.floor ?? 0)) return report({ status: 'missing' });
        const ticket = capture(floor, 'inline');
        const response = getChat()[floor].mes;
        const protocolHash = evidenceHash((String(response).match(/<rpEvents\b[^>]*>[\s\S]*?(?:<\/rpEvents\s*>|$)/gi) || []).join('\n'));
        const previous = state.rpCore.extractionJobs?.find(job => job.sourceKey === ticket.source.messageId + '|' + ticket.source.variantId
            && job.sourceStamp === sourceStamp(ticket.source) && job.protocolHash === protocolHash && job.status === 'failed');
        if (previous) return report({ status: 'failed', errorClass: previous.errorClass });
        try {
            const result = await consume(ticket, response);
            if (['missing', 'incomplete'].includes(result.status)) await service.setExtractionJob({ sourceKey: ticket.source.messageId + '|' + ticket.source.variantId,
                sourceRevision: ticket.source.revision, sourceStamp: sourceStamp(ticket.source), sourceFloor: floor, protocolHash, status: 'failed', errorClass: result.status }, state);
            return report(result);
        } catch (error) {
            if (getState() === state && state.rpCore?.revision === ticket.revision) await service.setExtractionJob({
                sourceKey: ticket.source.messageId + '|' + ticket.source.variantId, sourceRevision: ticket.source.revision,
                sourceStamp: sourceStamp(ticket.source), sourceFloor: floor, protocolHash, status: 'failed', errorClass: error.code === 'invalid_json' ? 'invalid_json' : 'invalid_or_unsaved',
            }, state).catch(() => {});
            throw error;
        }
    }
    async function runIndependent({ manual = false, sourceFloor = null } = {}) {
        await service.migrate?.();
        const state = getState();
        if (!state.rpCore?.settings?.enabled || !manual && channel(state) !== 'independent' || independentRun || isBusy()) return false;
        if (!manual && delayed(state)) return false;
        const floor = sourceFloor ?? latestFloor();
        if (floor < state.rpCore.baseline.floor) { if (manual) throw new Error('没有处于记录起点之后的有效正文'); return false; }
        const initial = capture(floor, 'independent', { manual }), key = initial.source.messageId + '|' + initial.source.variantId, stamp = sourceStamp(initial.source);
        const job = state.rpCore.extractionJobs?.find(item => item.sourceKey === key && item.sourceStamp === stamp);
        if (!manual && (job || state.rpCore.batches.some(batch => batch.sourceKey === key && batch.sourceStamp === stamp && !batch.superseded))) return false;
        const controller = new AbortController(), running = { state, controller };
        let ticket = null;
        independentRun = running;
        const updateJob = status => service.setExtractionJob({ sourceKey: key, sourceRevision: initial.source.revision, sourceStamp: stamp, sourceFloor: floor, status }, state);
        try {
            await updateJob('running');
            ticket = capture(floor, 'independent', { manual });
            if (!ticket || ticket.state !== state || sourceStamp(ticket.source) !== stamp) throw new Error('提取开始前正文或聊天已变化');
            await runGeneration('正在记录剧情状态...', async () => {
                assertCurrent(ticket);
                const instruction = '\n只从本轮正文记录新事件。近期及设定资料仅供理解，不作为本轮新事实。\n';
                const budget = state.rpCore.settings.contextBudget || 16000;
                const compiled = context(state, { manual: true, query: ticket.source.text, availableBudget: Math.max(0, budget - ticket.source.text.length - instruction.length) });
                if (compiled.blocked) throw new Error(compiled.warning);
                const reference = String(await getReferenceContext(state, floor));
                assertCurrent(ticket);
                const recent = getChat().slice(Math.max(0, floor - 4), floor).filter(message => message && !message.is_system)
                    .map(message => message.is_user ? '用户：' + stripRpProtocol(message.mes).slice(-2000) : '此前正文：' + (readChatSource(message, state)?.text || '').slice(-2000));
                // Current body and state are mandatory; optional context cannot
                // make an otherwise valid extraction exceed its request budget.
                let systemPrompt = compiled.maintenance + instruction;
                const selected = [];
                for (const text of recent.reverse()) if (systemPrompt.length + selected.join('\n').length + text.length + 2 + ticket.source.text.length <= budget) selected.unshift(text);
                if (selected.length) systemPrompt += selected.join('\n') + '\n';
                const remaining = Math.max(0, budget - systemPrompt.length - ticket.source.text.length);
                if (reference.length <= remaining) systemPrompt += reference;
                else if (remaining > 100) systemPrompt += '\n设定节选（已按预算截短）：\n' + reference.slice(0, remaining - 30);
                if (systemPrompt.length + ticket.source.text.length > budget) throw new Error('状态提取上下文超出预算，请提高预算后重试');
                if (controller.signal.aborted) throw new Error('提取已停止');
                const result = await callGenerationModel({ prompt: ticket.source.text, systemPrompt, signal: controller.signal });
                if (controller.signal.aborted) throw new Error('提取已停止');
                const consumed = await consume(ticket, result, { manual });
                if (['missing', 'incomplete'].includes(consumed.status)) throw new Error('剧情状态事件块缺失或截断，未标记成功，可重试');
                await updateJob('done');
            });
            return true;
        } catch (error) {
            if (getState() === state && state.rpCore?.revision === (ticket?.revision ?? initial.revision + 1)) await updateJob(controller.signal.aborted ? 'paused' : 'failed').catch(() => {});
            throw error;
        } finally { if (independentRun === running) independentRun = null; }
    }
    function scheduleCapture({ independent = false } = {}) {
        cancelDelay(captureTimer);
        const state = getState();
        captureTimer = delay(async () => {
            captureTimer = null;
            if (getState() !== state) return;
            try { await captureInline(); if (getState() !== state) return; if (independent) await runIndependent(); if (getState() === state) onBackgroundResult(); }
            catch (error) { if (getState() === state) onBackgroundError(error); }
        }, 1200);
    }
    function stopIndependent() { independentRun?.controller.abort(); cancelDelay(captureTimer); captureTimer = null; }
    return { channel, context, prompt, capture, assertCurrent, consume, captureInline, runIndependent, scheduleCapture, stopIndependent,
        reconcilePending: () => service.migrate?.() };
}
