import { ensureChronicle, captureChronicle, replayChronicle, refreshMemoryLinks, summaryItems, getCurrentStateRows, setStoryTime, upsertEntity, bindCellEntity, storyTimeContext, markStoryChange } from '../memory/story-state.js';
import { createMemoryBackup, validateMemoryBackup, previewMemoryBackup, restoreMemoryBackup, createDiagnosticReport } from '../memory/backup-package.js';

export function createStoryToolsUi({ documentRef: document, getState, getChat, getChatKey, getScannedBlocks, saveState, saveChat, refresh, isBusy, escapeHtml: esc, notify, confirm, urlApi = URL, BlobCtor = Blob }) {
    const views = new WeakMap();
    let inFlight = false;
    const button = (action, title) => `<button type="button" class="menu_button" data-story-action="${action}">${title}</button>`;
    const field = (id, label, type = 'text', value = '') => `<label>${label}<input class="text_pole" data-story-field="${id}" type="${type}" value="${esc(value)}"></label>`;
    const viewFor = state => {
        if (!views.has(state)) views.set(state, { sequence: null, page: 0, entityId: '' });
        return views.get(state);
    };

    function download(data, name) {
        const url = urlApi.createObjectURL(new BlobCtor([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => urlApi.revokeObjectURL(url), 10000);
    }

    function backup(state) {
        captureChronicle(state, getChat());
        return createMemoryBackup(state, { chatKey: getChatKey(), chat: getChat(), scanned: getScannedBlocks() });
    }

    function render(state = getState()) {
        const c = ensureChronicle(state, getChat());
        if (!c) return;
        refreshMemoryLinks(state, getChat());
        const view = viewFor(state);
        const maintenance = document.querySelector('#bakemono-story-backup');
        if (maintenance && !maintenance.childElementCount) {
            maintenance.innerHTML = `<details class="bakemono-memory-card-panel"><summary>记忆备份与诊断</summary><p>恢复包包含私人摘要、草稿、表格和剧情账本，不含 API 配置、密钥或完整聊天正文。正文标签摘要会保存为独立副本。向量索引不打包，恢复后需刷新。</p>${button('backup', '导出记忆恢复包')}${button('import', '导入恢复包')}${button('diagnostic', '导出脱敏诊断')}<input type="file" accept=".json,application/json" data-story-import hidden><p>导入仅用于当前聊天，先检查内容并下载恢复前副本；不会修改聊天正文或隐藏楼层。诊断报告不含正文、摘要、角色名、接口地址和原始报错。</p></details>`;
        }
        const container = document.querySelector('#bakemono-story-state');
        if (!container) return;
        const selected = view.sequence === null ? null : replayChronicle(c, { sequence: view.sequence });
        const display = selected ? { ...state, chronicle: { ...c, ...selected.state } } : state;
        const tableSets = selected ? Object.entries(selected.state.profiles).filter(([key]) => key.startsWith('active:')).map(([, tables]) => tables) : [state.tableDatabase.tables || []];
        const currentRows = tableSets.flatMap(tables => getCurrentStateRows(display, tables));
        const entity = c.entities.find(item => item.id === view.entityId);
        const clock = c.clock;
        const existingOpen = new Set([...container.querySelectorAll('details[open][data-story-section]')].map(el => el.dataset.storySection));
        const section = (key, title, body) => `<details class="bakemono-memory-card-panel" data-story-section="${key}" ${existingOpen.has(key) ? 'open' : ''}><summary>${title}</summary>${body}</details>`;
        const events = [...c.events].reverse();
        view.page = Math.min(view.page, Math.max(0, Math.ceil(events.length / 20) - 1));
        const rows = currentRows.slice(0, 100).map(row => `<li><strong>${esc(row.table)}</strong> · ${row.fields.map(f => `${esc(f.name)}：${esc(f.value)}${f.unresolved ? '（实体待绑定）' : ''}`).join(' / ')}</li>`).join('');
        container.innerHTML = section('state', selected ? `历史状态 · 记录 #${selected.sequence}（只读）` : '当前剧情状态',
            `<p>${esc(storyTimeContext(display) || '剧情时间未知')}</p><ul>${rows || '<li>暂无表格状态</li>'}</ul>${currentRows.length > 100 ? '<p>仅预览前 100 行，完整内容在表格或恢复包中。</p>' : ''}${button('current', '返回当前状态')}`)
            + section('time', '剧情时间', `<p>日期使用 YYYY-MM-DD；架空历法可只填描述。回忆时间单独记录，不推进当前时钟。</p>${field('time-label', '时间描述', 'text', clock.label)}${field('time-date', '明确日期', 'text', clock.date)}${field('time-days', '相对当前日期的天数（可留空）', 'number')}${field('time-floor', '来源楼层（可留空）', 'number')}<label><input type="checkbox" data-story-field="flashback">这是回忆时间</label>${button('time', '保存剧情时间')}${clock.lastFlashback ? `<p>最近回忆：${esc([clock.lastFlashback.date, clock.lastFlashback.label].filter(Boolean).join(' · '))}</p>` : ''}`)
            + section('entities', '人物 / 物品 / 计划 / 地点', `<p>字段语义在各表的字段编辑里选择。名称唯一时自动识别；重名请手动绑定。修改实体名后，已绑定状态显示新名，原单元格文字仍保留。</p><label>编辑实体<select class="text_pole" data-story-field="entity-select"><option value="">新建</option>${c.entities.map(item => `<option value="${esc(item.id)}" ${entity?.id === item.id ? 'selected' : ''}>${esc(item.kind)} · ${esc(item.name)}</option>`).join('')}</select></label><label>类型<select class="text_pole" data-story-field="entity-kind">${['person', 'item', 'plan', 'location'].map(kind => `<option value="${kind}" ${kind === (entity?.kind || 'person') ? 'selected' : ''}>${kind}</option>`).join('')}</select></label>${field('entity-name', '名称', 'text', entity?.name || '')}${field('entity-aliases', '别名（逗号分隔）', 'text', entity?.aliases?.join(', ') || '')}${button('entity', '保存实体')}<p>将选中的实体绑定到当前表格单元格（行和列从 0 开始）：</p>${field('bind-table', '表格编号', 'number')}${field('bind-row', '行号', 'number')}${field('bind-column', '列号', 'number')}${button('bind', '绑定选中实体')}`)
            + section('history', `逐楼变更账本 · ${c.events.length} 笔`, `<p>迁移基线：第 ${c.baselineFloor} 楼。按楼层查看的是当时已记录的状态；事后补课按实际记录位置记账。删楼后保留旧历史，不把旧历史改写为新剧情。</p>${field('history-floor', '查看楼层', 'number')}${button('floor', '查看该楼状态')}<ol>${events.slice(view.page * 20, view.page * 20 + 20).map(event => `<li><strong>#${event.sequence} ${esc(event.label)}</strong> · 记录于第 ${event.actualFloor} 楼 · ${event.deltas.length} 处变化${event.sources.length ? ` · 来源 ${event.sources.map(ref => `#${ref.floor}`).join(', ')}` : ' · 手动 / 状态同步'} ${button(`event:${event.sequence}`, '查看状态')}<details><summary>变化明细（最多预览 12000 字）</summary><pre>${esc(JSON.stringify(event.deltas, null, 2).slice(0, 12000))}</pre></details></li>`).join('') || '<li>尚无变更；原表格已作为基线保留。</li>'}</ol>${button('previous', '上一页')} ${view.page + 1} / ${Math.max(1, Math.ceil(events.length / 20))} ${button('next', '下一页')}`)
            + section('links', '分层记忆来源', `<p>来源变更的总结保留供查看，但暂停自动注入与向量召回。请用现有总结流程重新生成；不会自动覆盖原内容。</p><ul>${summaryItems(state).slice(-100).map(item => {
                const link = c.links[item.hash];
                return `<li>${esc(item.title || item.memoryKind)} · ${link?.stale ? '⚠ 来源已变更，需要更新' : '来源已关联'}<details><summary>查看关联</summary><p>来源楼层：${esc((link?.refs || []).map(ref => `#${ref.floor}`).join(', ') || '未记录')}<br>下层记忆：${esc((link?.children || []).map(child => summaryItems(state).find(s => s.hash === child.hash)?.title || '已移除的材料').join(' / ') || '无')}<br>记录时剧情时间：${esc([link?.storyTime?.date, link?.storyTime?.label].filter(Boolean).join(' · ') || '未知')}</p></details></li>`;
            }).join('') || '<li>暂无已保存摘要</li>'}</ul>`);
    }

    async function persist(state) {
        if (getState() !== state) throw new Error('聊天已切换，操作停止');
        const result = saveState();
        if (result?.status === 'error') throw new Error('本次保存未确认成功，请保留当前页面并导出恢复包');
        const savedSnapshot = JSON.stringify(state);
        try { await saveChat(); }
        catch (error) {
            const failure = new Error('酒馆保存失败，正在核对是否可以回退本次修改');
            failure.savedSnapshot = savedSnapshot;
            throw failure;
        }
        if (getState() === state) { refresh(); render(state); }
    }

    async function performImport(file, state) {
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) throw new Error('恢复包超过 50 MB');
        const beforeRead = JSON.stringify(state);
        const data = validateMemoryBackup(await file.text());
        if (getState() !== state || JSON.stringify(state) !== beforeRead || isBusy()) throw new Error('读取文件期间聊天或记忆已变化，请重新导入');
        const preview = previewMemoryBackup(data, { chatKey: getChatKey(), chat: getChat() });
        if (!preview.sameChat) throw new Error('恢复包不属于当前聊天，已停止；请打开原聊天再导入');
        if (!confirm(`恢复 ${preview.summaries} 条摘要、${preview.drafts} 个草稿、${preview.tableRows} 行表格和 ${preview.events} 笔历史？\n${preview.matchingSources ? '' : '来源正文已变化，恢复的记忆可能需要重新核对。\n'}将替换当前记忆；先下载恢复前副本，确认下载完成后再继续。`)) return;
        download(backup(state), 'bakemono-before-restore');
        if (!confirm('请确认恢复前副本已下载。现在替换当前聊天记忆吗？')) return;
        if (getState() !== state || isBusy()) throw new Error('聊天或任务状态变化，恢复已取消');
        const original = JSON.parse(JSON.stringify(state));
        try {
            restoreMemoryBackup(state, data);
            await persist(state);
            notify('记忆已恢复，向量索引需重新刷新。');
        } catch (error) {
            if (error.savedSnapshot && JSON.stringify(state) !== error.savedSnapshot) throw new Error('保存结果未确认，期间记忆已变化，已保留较新的内容；请立即导出恢复包。');
            for (const key of Object.keys(state)) delete state[key];
            Object.assign(state, original);
            if (getState() === state) { saveState(); refresh(); }
            throw error;
        }
    }

    async function performAction(target) {
        const state = getState();
        const view = viewFor(state);
        const action = target.dataset.storyAction;
        const root = target.closest('#bakemono-story-state, #bakemono-story-backup');
        const val = name => String(root.querySelector(`[data-story-field="${name}"]`)?.value || '').trim();
        const floor = name => {
            const raw = val(name);
            if (!raw) return null;
            const value = Number(raw);
            if (!Number.isInteger(value) || value < 0 || value >= getChat().length) throw new Error('楼层不存在');
            return value;
        };
        if (action === 'backup') { download(backup(state), 'bakemono-memory'); return; }
        if (action === 'diagnostic') {
            let localStorage = 'untested';
            try { const key = `bakemono-diag-${Date.now()}`; globalThis.localStorage.setItem(key, '1'); globalThis.localStorage.removeItem(key); localStorage = 'available'; } catch { localStorage = 'unavailable'; }
            download(createDiagnosticReport(state, { storage: { localStorage } }), 'bakemono-diagnostic'); return;
        }
        if (action === 'current') { view.sequence = null; render(state); return; }
        if (action.startsWith('event:')) { view.sequence = Number(action.slice(6)); render(state); return; }
        if (action === 'floor') { const requested = floor('history-floor'); if (requested === null) throw new Error('请填写楼层'); view.sequence = replayChronicle(state.chronicle, { floor: requested }).sequence; render(state); return; }
        if (action === 'previous' || action === 'next') { view.page = Math.max(0, view.page + (action === 'next' ? 1 : -1)); render(state); return; }
        if (isBusy() || state.taskQueue?.some(task => task.status === 'running')) throw new Error('请等待当前任务结束后再修改或恢复');
        if (action === 'import') { root.querySelector('[data-story-import]').click(); return; }
        const rollback = JSON.parse(JSON.stringify({ chronicle: state.chronicle, tableDatabase: state.tableDatabase }));
        try {
            if (action === 'time') {
                const source = floor('time-floor');
                setStoryTime(state, { label: val('time-label'), date: val('time-date'), relativeDays: val('time-days') === '' ? null : Number(val('time-days')),
                    flashback: !!root.querySelector('[data-story-field="flashback"]')?.checked, sourceMessageIds: source === null ? [] : [source] });
            } else if (action === 'entity') {
                const entity = upsertEntity(state, { id: view.entityId, kind: val('entity-kind'), name: val('entity-name'), aliases: val('entity-aliases').split(/[,，]/) });
                view.entityId = entity.id;
            } else if (action === 'bind') {
                const table = state.tableDatabase.tables.find(item => Number(item.tableIndex) === Number(val('bind-table')));
                if (!table || !view.entityId || !val('bind-table') || !val('bind-row') || !val('bind-column') || !Number.isInteger(Number(val('bind-row'))) || !Number.isInteger(Number(val('bind-column')))) throw new Error('请选择实体并填写表格、行、列编号');
                bindCellEntity(state, table, Number(val('bind-row')), Number(val('bind-column')), view.entityId);
            } else return;
            await persist(state);
            notify('剧情状态已保存。');
        } catch (error) {
            if (error.savedSnapshot && JSON.stringify(state) !== error.savedSnapshot) throw new Error('保存结果未确认，期间记忆已变化，已保留较新的内容；请立即导出恢复包。');
            Object.assign(state, rollback); markStoryChange(state);
            if (getState() === state) { saveState(); refresh(); }
            throw error;
        }
    }

    async function exclusive(operation) {
        if (inFlight) throw new Error('上一项操作尚未完成，请稍候');
        inFlight = true;
        try { return await operation(); } finally { inFlight = false; }
    }
    const action = target => exclusive(() => performAction(target));
    const importFile = (file, state) => exclusive(() => performImport(file, state));

    function bind() {
        const root = document.querySelector('#bakemono-workbench-root');
        if (!root || root.dataset.storyBound) return;
        root.dataset.storyBound = 'true';
        root.addEventListener('click', event => {
            const target = event.target.closest('[data-story-action]');
            if (!target) return;
            event.preventDefault();
            void action(target).catch(error => notify(error.message, true));
        });
        root.addEventListener('change', event => {
            if (event.target.matches('[data-story-import]')) {
                const file = event.target.files?.[0]; event.target.value = '';
                void importFile(file, getState()).catch(error => notify(error.message, true));
            } else if (event.target.matches('[data-story-field="entity-select"]')) {
                viewFor(getState()).entityId = event.target.value; render();
            }
        });
    }
    return { bind, render, importFile, action };
}
