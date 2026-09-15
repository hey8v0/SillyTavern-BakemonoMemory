import { readChatSource, findChatSource } from './chat-sources.js';
import { evidenceHash, sourceStamp } from './source.js';
import { summaryStateEvents } from './summary-source.js';
import { parsePayload } from './extraction.js';
import { assertLedgerVersion } from './ledger.js';

const guide = `## 剧情事件提取
完成本请求原本要求的输出后，另输出一个 <rpEvents>{"version":1,"events":[]}</rpEvents> JSON 块。不要执行或输出代码。
你负责判断本轮剧情中的明确状态与变化。参考资料用于理解身份和设定，不当作本轮新发生的事件。没有变化就输出空数组。
每项包含 track（facts/claims/observations）、action、data、excerpt（优先引用足以定位的一小段连续原文，不复述整个段落、不用省略号拼句）。可引用本楼已写出的摘要中的明确状态，注明 source:"summary"；不能引用小剧场、第四面墙、推理或操作块。保留原 bakemono 摘要格式；rpEvents 单独放在块外。
context 必须标明 current/dream/hypothetical/flashback，后三种只能进入说法或观察，不得标为 facts。
角色说法放 claims；怀疑、推断和主观观察放 observations。回忆、梦境、假设不能写成当前事实。不得把小剧场、推理或旧操作块当作证据。
facts 行为及 data 字段：
person_registered: id,name,birthDate? 或 age?,ageDate?（登记已有的人，不是出生事件）；person_created 同义兼容；person_renamed: id,name；person_trait_recorded: id,trait；person_age_recorded: id,age,ageDate?；person_moved: id,location。
relationship_recorded: id,from,to,kind,mutual（已存在的关系，不以当前日期充当开始日期）；relationship_established 同字段（本轮新建立）；relationship_ended: id；relationship_conflict / relationship_milestone: id,description。
plan_proposed / promise_created: id,title,participants,due?；plan_accepted / plan_cancelled: id；plan_completed / plan_failed: id,outcome；plan_modified: id,title?,due?。
item_acquired: id,name,owner?,holder?,location?,quantity?；item_lent: id,from,to,loanId；item_gifted: id,from,to；item_returned: id,from,loanId；item_placed: id,from,location；item_consumed: id,quantity；item_quantity_changed: id,delta；item_damaged / item_destroyed: id。
item_registered: id,name,owner?,holder?,location?,quantity?（首次明确出现的已有物品，不代表本轮获得）；没有明确所有权、持有或数量依据时对应字段留 null。
scene_recorded: location（本轮当前场景，不默认所有人都在此）；location_created: id,name,parent?；location_reparented: id,parent；clock_set: date 或 description；clock_advanced: from,days,to。
person_state_started: id,stateId,description,expiresAt?；person_state_ended: id,stateId。
已有对象可引用下方 ID 或唯一名称。首次出现的人物、地点、已有物品可以直接引用摘录中的全名，插件自动登记身份；需补特征时才单独登记。不要编造 char_1 等未声明代号；同名对象要区分。姿势变化不等于换地点，桌上物品翻转不等于角色曾持有。
首次处理时补齐明确的当前时间、场景、人物位置与已知关系；之后只输出变化，未提及的值保持不变。摘要中的时间/当前地点/在场角色字段由插件直接读取，不必重复输出同样的事件。时间跨度不能充当当前日期；不要为填空而猜测状态。控制单轮事件数量，优先完整输出时间、场景、关系和重要变化。
表白不等于交往，争执不等于分手，道歉不等于恢复信任；romantic/partner/married 必须有双方确认且 mutual=true。
想做某事用 plan_proposed，明确承诺用 promise_created；到期不等于完成或失败。借用不转移所有权。未知数量用 null，不猜零。
日期只用明确公历 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm；相对推进必须提供当时已知的 from 与算出的 to。不确定时间不能臆造日期。
claims/observations 的 data 使用 speaker?、subject?、description，说明谁说了什么或谁作何观察，不能夹带世界状态修改。`;

export function stripRpProtocol(value) {
    return String(value || '').replace(/<rpEvents\b[^>]*>[\s\S]*?(?:<\/rpEvents\s*>|$)/gi, '').trim();
}

export function createRpExtractionFlow({ getState, getChat, service, makeSourceId, callGenerationModel, getReferenceContext = async () => '', runGeneration = async (_label, run) => run(), isBusy = () => false }) {
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
            people: ['id', 'name', 'aliases', 'location'], relationships: ['id', 'from', 'to', 'kind', 'status'],
            plans: ['id', 'title', 'participants', 'due', 'status'], items: ['id', 'name', 'owner', 'holder', 'location', 'quantity', 'loan'],
            locations: ['id', 'name', 'parent'],
        })) context[key] = projection[key].slice(0, 100).map(item => pick(item, fields));
        return guide + '\n\n已有对象参考（仅用于引用，非新证据；列表最多展示各类 100 项）：\n' + JSON.stringify(context);
    }
    function capture(floor, requested) {
        const state = getState();
        if (channel(state) !== requested) return null;
        const message = getChat()[floor];
        const source = readChatSource(message, state, { allocate: true, makeId: makeSourceId });
        if (!source) throw new Error('没有可提取的助手正文');
        return { state, requested, source, revision: state.rpCore.revision, settings: JSON.stringify(state.rpCore.settings) };
    }
    function assertCurrent(ticket) {
        if (!ticket) return null;
        const state = getState();
        if (state !== ticket.state || channel(state) !== ticket.requested || state.rpCore.revision !== ticket.revision
            || JSON.stringify(state.rpCore.settings) !== ticket.settings) throw new Error('提取期间聊天或剧情状态已变化');
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
        const metadata = summaryStateEvents(source).filter(event => !events.some(item => item?.track === 'facts' && (item.action === event.action || event.action === 'clock_set' && item.action === 'clock_advanced') && ['clock_set', 'clock_advanced', 'scene_recorded'].includes(item.action))).slice(0, Math.max(0, 100 - events.length));
        if (!blocks.length && !metadata.length) return { status: protocolStatus === 'incomplete' ? 'incomplete' : 'missing' };
        const payload = JSON.stringify({ version: 1, events: [...events, ...metadata] });
        const inputHash = evidenceHash(payload + sourceStamp(source));
        const sourceKey = source.messageId + '|' + source.variantId;
        if (!manual && ticket.state.rpCore.batches.some(batch => batch.sourceKey === sourceKey
            && batch.sourceRevision === source.revision && batch.inputHash === inputHash)) return { status: 'unchanged' };
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
    return { channel, prompt, capture, assertCurrent, consume, captureInline, runIndependent, stopIndependent };
}
