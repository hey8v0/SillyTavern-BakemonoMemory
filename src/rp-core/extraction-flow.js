import { readChatSource, findChatSource } from './chat-sources.js';
import { evidenceHash } from './source.js';
import { assertLedgerVersion } from './ledger.js';

const guide = `## 剧情事件提取
完成本请求原本要求的输出后，另输出一个 <rpEvents>{"version":1,"events":[]}</rpEvents> JSON 块。不要执行或输出代码。
只从本轮助手正文提取事件，参考资料和已有状态不是本轮新事件。没有可提取事件就输出空数组。
每个候选包含 track（facts/claims/observations）、action、data、excerpt（逐字引用本轮剧情正文，不改写，不从 bakemono 摘要、推理或操作块引用）。保留用户预设原有的 bakemono 摘要格式；rpEvents 必须单独放在 bakemono 块外，不替换摘要。
context 必须标明 current/dream/hypothetical/flashback，后三种只能进入说法或观察，不得标为 facts。
角色说法放 claims；怀疑、推断和主观观察放 observations。回忆、梦境、假设不能写成当前事实。不得把小剧场、推理或旧操作块当作证据。
facts 行为及 data 字段：
person_created: id,name,birthDate? 或 age?,ageDate?；person_renamed: id,name；person_trait_recorded: id,trait；person_age_recorded: id,age,ageDate?；person_moved: id,location。
relationship_established: id,from,to,kind,mutual；relationship_ended: id；relationship_conflict / relationship_milestone: id,description。
plan_proposed / promise_created: id,title,participants,due?；plan_accepted / plan_cancelled: id；plan_completed / plan_failed: id,outcome；plan_modified: id,title?,due?。
item_acquired: id,name,owner?,holder?,location?,quantity?；item_lent: id,from,to,loanId；item_gifted: id,from,to；item_returned: id,from,loanId；item_placed: id,from,location；item_consumed: id,quantity；item_quantity_changed: id,delta；item_damaged / item_destroyed: id。
location_created: id,name,parent?；location_reparented: id,parent；clock_set: date 或 description；clock_advanced: from,days,to。
person_state_started: id,stateId,description,expiresAt?；person_state_ended: id,stateId。
已有对象必须使用下方 ID，新对象使用同批唯一临时 ID，插件将分配正式身份。不得自行合并同名人物；不确定对象则留下候选说明，不猜测 ID。
表白不等于交往，争执不等于分手，道歉不等于恢复信任；romantic/partner/married 必须有双方确认且 mutual=true。
想做某事用 plan_proposed，明确承诺用 promise_created；到期不等于完成或失败。借用不转移所有权。未知数量用 null，不猜零。
日期只用明确公历 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm；相对推进必须提供当时已知的 from 与算出的 to。不确定时间不能臆造日期。
claims/observations 的 data 使用 speaker?、subject?、description，说明谁说了什么或谁作何观察，不能夹带世界状态修改。`;

export function stripRpProtocol(value) {
    return String(value || '').replace(/<rpEvents\b[^>]*>[\s\S]*?(?:<\/rpEvents\s*>|$)/gi, '').trim();
}

export function createRpExtractionFlow({ getState, getChat, service, makeSourceId, callGenerationModel, runGeneration = async (_label, run) => run(), isBusy = () => false }) {
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
        const context = { clock: projection.clock };
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
        if (!source || source.revision !== ticket.source.revision) throw new Error('提取期间正文来源已变化');
        return source;
    }
    async function consume(ticket, response, { manual = false } = {}) {
        if (!ticket) return { status: 'inactive' };
        const source = assertCurrent(ticket);
        const blocks = [...String(response || '').matchAll(/<rpEvents\b[^>]*>[\s\S]*?<\/rpEvents\s*>/gi)];
        if (!blocks.length) return { status: 'missing' };
        if (blocks.length !== 1) throw new Error('同一回复含多个剧情事件块，请重新提取');
        const inputHash = evidenceHash(blocks[0][0]);
        const sourceKey = source.messageId + '|' + source.variantId;
        if (!manual && ticket.state.rpCore.batches.some(batch => batch.sourceKey === sourceKey
            && batch.sourceRevision === source.revision && batch.inputHash === inputHash)) return { status: 'unchanged' };
        const result = await service.ingest(blocks[0][0], source.floor, {
            manual, expectedSource: source, channel: ticket.state.rpCore.settings.mode, inputHash,
        });
        ticket.revision = result.core.revision;
        assertCurrent(ticket);
        return { status: 'processed', result };
    }
    async function captureInline() {
        const state = getState(), chat = getChat();
        if (channel(state) !== 'inline' || isBusy()) return false;
        const latestVisible = [...chat].reverse().find(message => message && !message.is_system);
        if (state.turnSummary?.triggerTiming === 'next_user' && !latestVisible?.is_user) return false;
        let floor = chat.length - 1;
        while (floor >= 0 && (!chat[floor] || chat[floor].is_user || chat[floor].is_system)) floor--;
        if (floor < 0 || !/<rpEvents\b/i.test(chat[floor].mes || '')) return false;
        const result = await consume(capture(floor, 'inline'), chat[floor].mes);
        return result.status === 'processed';
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
        if (!manual && (job || state.rpCore.batches.some(batch => batch.sourceKey === key && batch.sourceRevision === initial.source.revision))) return false;
        const controller = new AbortController(), running = { state, controller };
        independentRun = running;
        try {
            await service.setExtractionJob({ sourceKey: key, sourceRevision: initial.source.revision, status: 'running' }, state);
            const ticket = capture(floor, 'independent');
            if (!ticket || ticket.state !== state || ticket.source.revision !== initial.source.revision) throw new Error('提取开始前正文或聊天已变化');
            await runGeneration('正在提取剧情事件...', async () => {
                assertCurrent(ticket);
                if (controller.signal.aborted) throw new Error('提取已停止');
                const result = await callGenerationModel({ prompt: ticket.source.text,
                    systemPrompt: prompt('independent', state) + '\n本请求只输出 rpEvents，不另外生成摘要或填表。', signal: controller.signal });
                if (controller.signal.aborted) throw new Error('提取已停止');
                const consumed = await consume(ticket, result, { manual });
                if (consumed.status === 'missing') throw new Error('模型没有返回剧情事件块，请重试');
                await service.setExtractionJob({ sourceKey: key, sourceRevision: initial.source.revision, status: 'done' }, state);
            });
            return true;
        } catch (error) {
            if (getState() === state) await service.setExtractionJob({ sourceKey: key, sourceRevision: initial.source.revision,
                status: controller.signal.aborted ? 'paused' : 'failed' }, state).catch(() => {});
            throw error;
        } finally { if (independentRun === running) independentRun = null; }
    }
    function stopIndependent() { independentRun?.controller.abort(); }
    return { channel, prompt, capture, assertCurrent, consume, captureInline, runIndependent, stopIndependent };
}
