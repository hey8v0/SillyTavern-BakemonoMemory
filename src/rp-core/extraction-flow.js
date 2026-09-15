import { readChatSource, findChatSource } from './chat-sources.js';
import { evidenceHash, sourceStamp } from './source.js';
import { summaryStateEvents } from './summary-source.js';
import { parsePayload } from './extraction.js';
import { assertLedgerVersion } from './ledger.js';

import { RP_EVENT_GUIDE } from './prompt.js';
export { RP_EVENT_GUIDE } from './prompt.js';

export function stripRpProtocol(value) {
    return String(value || '').replace(/<rpEvents\b[^>]*>[\s\S]*?(?:<\/rpEvents\s*>|$)/gi, '').trim();
}

export function createRpExtractionFlow({ getState, getChat, service, makeSourceId, callGenerationModel, getPrompt = () => RP_EVENT_GUIDE, getReferenceContext = async () => '', runGeneration = async (_label, run) => run(), isBusy = () => false }) {
    let independentRun = null;
    function channel(state = getState()) {
        if (!state.rpCore?.settings?.enabled) return null;
        try { assertLedgerVersion(state.rpCore); } catch { return null; }
        if (state.rpCore.settings.mode === 'independent') return 'independent';
        if (state.rpCore.settings.mode === 'inline') return 'inline';
        if (state.rpCore.settings.mode === 'reply') return state.turnSummary?.enabled || (state.tableDatabase?.enabled && state.tableDatabase.tables?.length) ? 'reply' : null;
        if (state.rpCore.settings.mode !== 'reuse') return null;
        if (state.inlineGeneration?.summaryEnabled || state.inlineGeneration?.tableEnabled) return 'inline';
        if (state.turnSummary?.enabled || (state.tableDatabase?.enabled && state.tableDatabase.tables?.length)) return 'reply';
        return 'inline';
    }
    function prompt(requested, state = getState()) {
        if (channel(state) !== requested) return '';
        const projection = service.view(state)?.projection;
        if (!projection) return '';
        const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
        const context = { clock: projection.clock, scene: projection.scene || null };
        for (const [key, fields] of Object.entries({
            people: ['id', 'name', 'aliases', 'location', 'states', 'birthDate', 'traits'], relationships: ['id', 'from', 'to', 'kind', 'status', 'mutual', 'since'],
            plans: ['id', 'title', 'participants', 'due', 'status'], items: ['id', 'name', 'owner', 'holder', 'location', 'quantity', 'loan'],
            locations: ['id', 'name', 'parent'],
        })) context[key] = projection[key].slice(0, 100).map(item => pick(item, fields));
        return getPrompt() + '\n\n已有对象参考（仅用于引用；各类最多 100 项）：\n' + JSON.stringify(context);
    }
    function capture(floor, requested) {
        const state = getState();
        if (channel(state) !== requested) return null;
        const message = getChat()[floor];
        const source = readChatSource(message, state, { allocate: true, makeId: makeSourceId });
        if (!source) throw new Error('没有可提取的助手正文');
        return { state, requested, source, revision: state.rpCore.revision, settings: JSON.stringify(state.rpCore.settings), prompt: getPrompt() };
    }
    function assertCurrent(ticket) {
        if (!ticket) return null;
        const state = getState();
        if (state !== ticket.state || channel(state) !== ticket.requested || state.rpCore.revision !== ticket.revision
            || JSON.stringify(state.rpCore.settings) !== ticket.settings || getPrompt() !== ticket.prompt) throw new Error('提取期间聊天、提示词或剧情状态已变化');
        const source = findChatSource(getChat(), state, ticket.source.messageId + '|' + ticket.source.variantId);
        if (!source || sourceStamp(source) !== sourceStamp(ticket.source)) throw new Error('提取期间正文来源已变化');
        return source;
    }
    async function consume(ticket, response, { manual = false } = {}) {
        if (!ticket) return { status: 'inactive' };
        const source = assertCurrent(ticket);
        const blocks = [...String(response || '').matchAll(/<rpEvents\b[^>]*>[\s\S]*?<\/rpEvents\s*>/gi)];
        if (blocks.length > 1) throw new Error('同一回复含多个剧情事件块，请重新提取');
        const protocolStatus = blocks.length ? 'complete' : /<rpEvents\b/i.test(response || '') ? 'incomplete' : 'missing';
        const events = blocks.length ? parsePayload(blocks[0][0]) : [];
        const metadata = summaryStateEvents(source).filter(event => !events.some(item => item?.track === 'facts' && ((item.action === event.action || event.action === 'clock_set' && item.action === 'clock_advanced') && ['clock_set', 'clock_advanced', 'scene_recorded'].includes(item.action)
            || item.action === 'state_updated' && item.data?.collection === (event.action === 'clock_set' ? 'clock' : event.action === 'scene_recorded' ? 'scene' : '')))).slice(0, Math.max(0, 100 - events.length));
        if (!blocks.length && !metadata.length) return { status: protocolStatus === 'incomplete' ? 'incomplete' : 'missing' };
        const payload = JSON.stringify({ version: 1, events: [...events, ...metadata] });
        const inputHash = evidenceHash(payload + sourceStamp(source));
        const sourceKey = source.messageId + '|' + source.variantId;
        if (!manual && ticket.state.rpCore.batches.some(batch => batch.sourceKey === sourceKey
            && batch.recordingPolicy === 'model' && batch.sourceRevision === source.revision && batch.inputHash === inputHash)) return { status: 'unchanged' };
        const result = await service.ingest(payload, source.floor, {
            manual, expectedSource: source, channel: ticket.state.rpCore.settings.mode, inputHash, protocolStatus,
        });
        ticket.revision = result.core.revision;
        assertCurrent(ticket);
        return { status: 'processed', result, protocolStatus };
    }
    async function captureInline({ detailed = false } = {}) {
        const state = getState(), chat = getChat();
        const report = result => detailed ? result : result.status === 'processed';
        if (channel(state) !== 'inline') return report({ status: 'inactive' });
        if (isBusy()) return report({ status: 'busy' });
        const latestVisible = [...chat].reverse().find(message => message && !message.is_system);
        if (state.turnSummary?.triggerTiming === 'next_user' && !latestVisible?.is_user) return report({ status: 'delayed' });
        let floor = chat.length - 1;
        while (floor >= 0 && (!chat[floor] || chat[floor].is_user || chat[floor].is_system)) floor--;
        if (floor < 0) return report({ status: 'missing' });
        const result = await consume(capture(floor, 'inline'), chat[floor].mes);
        return report(result);
    }
    async function runIndependent({ manual = false, sourceFloor = null } = {}) {
        const state = getState();
        if (channel(state) !== 'independent' || independentRun || isBusy()) return false;
        const chat = getChat(), latest = [...chat].reverse().find(message => message && !message.is_system);
        if (!manual && state.turnSummary?.triggerTiming === 'next_user' && !latest?.is_user) return false;
        let floor = sourceFloor ?? chat.length - 1;
        if (sourceFloor == null) while (floor >= 0 && (!chat[floor] || chat[floor].is_user || chat[floor].is_system)) floor--;
        if (floor < 0) return false;
        const initial = capture(floor, 'independent'), key = initial.source.messageId + '|' + initial.source.variantId;
        const job = state.rpCore.extractionJobs?.find(item => item.sourceKey === key && item.sourceRevision === initial.source.revision);
        if (!manual && (job && (job.sourceStamp || job.sourceRevision) === sourceStamp(initial.source)
            || state.rpCore.batches.some(batch => batch.sourceKey === key && (batch.sourceStamp || batch.sourceRevision) === sourceStamp(initial.source)))) return false;
        const controller = new AbortController(), running = { state, controller };
        independentRun = running;
        try {
            await service.setExtractionJob({ sourceKey: key, sourceRevision: initial.source.revision, sourceStamp: sourceStamp(initial.source), status: 'running' }, state);
            const ticket = capture(floor, 'independent');
            if (!ticket || ticket.state !== state || sourceStamp(ticket.source) !== sourceStamp(initial.source)) throw new Error('提取开始前正文或聊天已变化');
            await runGeneration('正在提取剧情事件...', async () => {
                assertCurrent(ticket);
                if (controller.signal.aborted) throw new Error('提取已停止');
                const reference = String(await getReferenceContext(state, floor)).slice(0, 12000);
                assertCurrent(ticket);
                if (controller.signal.aborted) throw new Error('提取已停止');
                const recent = chat.slice(Math.max(0, floor - 4), floor).filter(message => message && !message.is_system)
                    .map(message => message.is_user ? '用户：' + stripRpProtocol(message.mes).slice(-2000)
                        : '此前正文：' + (readChatSource(message, state)?.text || '').slice(-2000)).filter(value => !value.endsWith('：')).join('\n');
                const summaries = ticket.source.supplements?.map(item => item.text).join('\n').slice(0, 10000) || '';
                const result = await callGenerationModel({ prompt: ticket.source.text + (summaries ? '\n\n本楼摘要（source:summary）：\n' + summaries : ''),
                    systemPrompt: prompt('independent', state) + '\n本请求只输出 rpEvents，不另外生成摘要或填表。'
                        + (recent ? '\n近期参考（非本轮新证据）：\n' + recent : '') + (reference ? '\n角色/设定参考（非本轮新证据）：\n' + reference : ''), signal: controller.signal });
                if (controller.signal.aborted) throw new Error('提取已停止');
                const consumed = await consume(ticket, result, { manual });
                if (['missing', 'incomplete'].includes(consumed.status) || consumed.protocolStatus === 'incomplete') throw new Error('剧情状态输出不完整；已写入的明确摘要状态保留，可手动重试');
                await service.setExtractionJob({ sourceKey: key, sourceRevision: initial.source.revision, sourceStamp: sourceStamp(initial.source), status: 'done' }, state);
            });
            return true;
        } catch (error) {
            if (getState() === state) await service.setExtractionJob({ sourceKey: key, sourceRevision: initial.source.revision, sourceStamp: sourceStamp(initial.source),
                status: controller.signal.aborted ? 'paused' : 'failed' }, state).catch(() => {});
            throw error;
        } finally { if (independentRun === running) independentRun = null; }
    }
    function stopIndependent() { independentRun?.controller.abort(); }
    return { channel, prompt, capture, assertCurrent, consume, captureInline, runIndependent, stopIndependent, reconcilePending: () => service.reconcilePending?.() };
}
