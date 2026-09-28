import { semanticKinds, ensureTableIdentity } from '../memory/story-state.js';
import { scrollIntoMain } from '../ui/scroll-into-main.js';

export function createTableWorkbenchUi({
    query,
    document,
    requestFrame,
    getState: ensureState,
    getTableProfilesForScope,
    tableSchemaScopes,
    getActiveTableProfile,
    getTablePromptPresets,
    getSelectedTablePromptPresetId,
    escapeHtml,
    formatSourceRange,
    toastr,
    persistCurrentTableDatabase,
    renderWorkbenchScope,
    workbenchRenderScopes,
    normalizeImportedTablesFromJson,
    confirmDanger,
    parseList,
    getHash,
    getNextTableIndex,
    inspectTableEditDraft,
} = {}) {
    const tableUiState = {
        openTableIndex: '',
        focusCell: null,
        openSection: '',
        focusField: null,
        view: 'records',
        closed: new Set(),
        full: new Set(),
        fullDiffs: new Set(),
        editRow: null,
        editFields: null,
    };
    function renderTableProfileControls(state = ensureState()) {
        const select = document.querySelector('#bakemono-memory-table-profile-select');
        if (!select) {
            return;
        }
        const profiles = getTableProfilesForScope(state.tableDatabase.schemaScope || tableSchemaScopes.CHAT, state);
        select.innerHTML = '';
        for (const profile of profiles) {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = profile.name || '未命名表格组';
            select.append(option);
        }
        select.value = state.tableDatabase.activeProfileId || profiles[0]?.id || '';
        query('#bakemono-memory-table-profile-name').val(getActiveTableProfile(state)?.name || '');
        renderTablePromptPresetControls();
    }

    function renderTablePromptPresetControls() {
        const select = document.querySelector('#bakemono-memory-table-preset-select');
        if (!select) {
            return;
        }
        const presets = getTablePromptPresets();
        select.innerHTML = '';
        for (const preset of presets) {
            const option = document.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name || '未命名表格提示词';
            select.append(option);
        }
        select.value = getSelectedTablePromptPresetId();
    }

    // Long cell text (models sometimes write a paragraph into one column) takes a full row and folds after a few lines.
    const longCell = value => String(value || '').length > 60;
    const kindLabels = { text: '自由文本', person: '人物', item: '物品', plan: '计划', location: '地点' };

    // Rows the latest applied change touched, so readers can see what moved this turn.
    function recentlyChanged(state) {
        const last = (state.tableDatabase.history || [])[0];
        const touched = new Set();
        for (const operation of last?.operations || []) {
            if (operation.op === 'update' && Number.isFinite(Number(operation.rowIndex))) touched.add(`${operation.tableIndex}:${operation.rowIndex}`);
        }
        return touched;
    }

    function fieldEditorMarkup(table) {
        const fields = table.columns.map((col, index) => `
            <div class="bk-tbl-field" data-table-field="${index}">
                <label class="bk-sum-field"><span>第 ${index + 1} 栏 · 栏名</span><input class="text_pole" data-table-column-name="${index}" type="text" value="${escapeHtml(col)}"></label>
                <label class="bk-sum-field"><span>这一栏写什么</span><textarea class="text_pole" data-table-column-prompt="${index}" rows="2" spellcheck="false" placeholder="告诉 AI 这一栏应该记录什么、什么时候更新、不要写什么。">${escapeHtml(table.columnPrompts?.[index] || '')}</textarea></label>
                <div class="bk-tbl-field-foot">
                    <label class="bk-tbl-kind"><span>内容类型</span><select class="text_pole" data-table-column-kind="${index}">${semanticKinds.map(kind => `<option value="${kind}" ${kind === (table.columnKinds?.[index] || 'text') ? 'selected' : ''}>${kindLabels[kind]}</option>`).join('')}</select></label>
                    <button type="button" class="bk-sum-link is-alert" data-bakemono-table-action="delete-column" data-table-col="${index}">删除这一栏…</button>
                </div>
            </div>`).join('');
        return `<div class="bk-tbl-fields">
            <label class="bk-sum-field"><span>表格名称</span><input class="text_pole" data-table-name type="text" value="${escapeHtml(table.name || '')}"></label>
            <label class="bk-sum-field"><span>整张表的规则</span><textarea class="text_pole" data-table-note rows="3" spellcheck="false" placeholder="这张表的整体用途、更新原则、禁止事项。">${escapeHtml(table.note || '')}</textarea></label>
            <div class="bk-tbl-flags">
                <label class="checkbox_label"><input type="checkbox" data-table-readonly ${table.readOnly ? 'checked' : ''}><span>只读，AI 不能改</span></label>
                <label class="checkbox_label"><input type="checkbox" data-table-allow-ai ${!table.readOnly && table.allowAiEdit !== false ? 'checked' : ''} ${table.readOnly ? 'disabled' : ''}><span>允许 AI 修改</span></label>
            </div>
            ${fields}
            <div class="bk-sum-editor-actions">
                <button type="button" class="bk-sum-link" data-bakemono-table-action="add-column">+ 新增一栏</button>
                <span class="bk-tbl-spacer"></span>
                <button type="button" class="bk-sum-link" data-bakemono-table-action="close-fields">取消</button>
                <button type="button" class="menu_button bk-sum-primary" data-bakemono-table-action="save-table">保存</button>
            </div>
        </div>`;
    }

    function recordMarkup(table, cells, rowIndex, changed) {
        const title = String(cells?.[0] ?? '').trim() || `第 ${rowIndex + 1} 行`;
        const fields = table.columns.slice(1).map((column, offset) => {
            const value = String(cells?.[offset + 1] ?? '').trim();
            return `<div class="bk-tbl-cell${longCell(value) ? ' is-long' : ''}"><dt>${escapeHtml(column)}</dt><dd class="${value ? '' : 'is-empty'}">${escapeHtml(value || '—')}</dd>${longCell(value) ? '<button type="button" class="bk-sum-link bk-tbl-expand" data-bk-tbl-expand>展开 ›</button>' : ''}</div>`;
        }).join('');
        return `<div class="bk-tbl-rec${changed ? ' is-new' : ''}" data-table-record="${rowIndex}">
            <div class="bk-tbl-rec-h"><strong>${escapeHtml(title)}</strong>${changed ? '<small>本轮更新</small>' : ''}<span class="bk-tbl-spacer"></span>
                <button type="button" class="bk-sum-link" data-bakemono-table-action="edit-row" data-table-row="${rowIndex}">编辑</button></div>
            ${fields ? `<dl>${fields}</dl>` : ''}</div>`;
    }

    function rowEditorMarkup(table, cells, rowIndex) {
        return `<div class="bk-tbl-edit" data-table-row-edit="${rowIndex}">
            ${table.columns.map((column, colIndex) => `<label class="bk-sum-field"><span>${escapeHtml(column)}</span><textarea class="text_pole" data-table-col="${colIndex}" rows="${longCell(cells?.[colIndex]) ? 4 : 1}" spellcheck="false">${escapeHtml(cells?.[colIndex] ?? '')}</textarea></label>`).join('')}
            <div class="bk-sum-editor-actions">
                <button type="button" class="bk-sum-link is-alert" data-bakemono-table-action="delete-row" data-table-row="${rowIndex}">删除这一行…</button>
                <span class="bk-tbl-spacer"></span>
                <button type="button" class="bk-sum-link" data-bakemono-table-action="cancel-row">取消</button>
                <button type="button" class="menu_button bk-sum-primary" data-bakemono-table-action="save-row">保存</button>
            </div></div>`;
    }

    function gridMarkup(table, rows, changedRows) {
        return `<div class="bk-tbl-grid-wrap"><table class="bk-tbl-grid"><thead><tr>${table.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}<th><span class="bk-sr">操作</span></th></tr></thead>
            <tbody>${rows.map((cells, rowIndex) => `<tr class="${changedRows.has(`${table.tableIndex}:${rowIndex}`) ? 'is-new' : ''}">${table.columns.map((_, colIndex) => `<td>${escapeHtml(cells?.[colIndex] ?? '') || '—'}</td>`).join('')}
                <td><button type="button" class="bk-sum-link" data-bakemono-table-action="edit-row" data-table-row="${rowIndex}">编辑</button></td></tr>`).join('')}</tbody></table></div>`;
    }

    function renderTableList(state = ensureState()) {
        const container = document.querySelector('#bakemono-memory-table-list');
        if (!container) {
            return;
        }
        const tables = state.tableDatabase.tables || [];
        if (!tables.length) {
            container.innerHTML = '<p class="bk-sum-empty">还没有表格。在下面的“新建与导入”里创建基础表格，或导入已有的表格。</p>';
            return;
        }
        const changedRows = recentlyChanged(state);
        const shortName = name => String(name || '').replace(/表格?$/, '').slice(0, 6) || '表';
        const directory = `<div class="bk-tbl-dir" role="group" aria-label="表格目录">${tables.map((table, index) => `${index ? '<span class="bk-tbl-sep" aria-hidden="true">/</span>' : ''}<button type="button" data-bk-tbl-jump="${escapeHtml(table.tableIndex)}">${escapeHtml(shortName(table.name))}<b>${(table.rows || []).length}</b></button>`).join('')}
            <button type="button" class="bk-tbl-view" data-bk-tbl-view>${tableUiState.view === 'grid' ? '条目视图' : '表格视图'} ⇄</button></div>`;
        const sections = tables.map(table => {
            table.columnPrompts = Array.isArray(table.columnPrompts) ? table.columnPrompts : [];
            const key = String(table.tableIndex);
            const open = !tableUiState.closed.has(key);
            const rows = Array.isArray(table.rows) ? table.rows : [];
            const editing = tableUiState.editRow?.tableIndex === key ? Number(tableUiState.editRow.rowIndex) : null;
            const shown = tableUiState.full.has(key) || editing !== null ? rows : rows.slice(0, 5);
            let body = '';
            if (open && tableUiState.editFields === key) body = fieldEditorMarkup(table);
            else if (open && tableUiState.view === 'grid' && editing === null) body = rows.length ? gridMarkup(table, rows, changedRows) : '<p class="bk-sum-empty">还没有数据。</p>';
            else if (open) {
                body = shown.map((cells, rowIndex) => rowIndex === editing ? rowEditorMarkup(table, cells, rowIndex) : recordMarkup(table, cells, rowIndex, changedRows.has(`${key}:${rowIndex}`))).join('')
                    || '<p class="bk-sum-empty">还没有数据。</p>';
                if (rows.length > shown.length) body += `<button type="button" class="bk-sum-link bk-tbl-more" data-bk-tbl-all="${escapeHtml(key)}">其余 ${rows.length - shown.length} 条 ›</button>`;
            }
            if (open && tableUiState.editFields !== key) body += '<button type="button" class="bk-sum-link bk-tbl-add" data-bakemono-table-action="add-row">+ 新增一行</button>';
            const access = table.readOnly ? '<span class="is-alert">只读</span>' : table.allowAiEdit === false ? '<span>AI 不改</span>' : '<span>AI 可改</span>';
            return `<section class="bakemono-memory-table-item bk-tbl${open ? ' is-open' : ''}" data-table-index="${escapeHtml(key)}" id="bk-tbl-${escapeHtml(key)}">
                <div class="bk-tbl-h">
                    <button type="button" class="bk-tbl-head" data-bk-tbl-fold="${escapeHtml(key)}" aria-expanded="${open}"><span class="bk-tbl-chev" aria-hidden="true">›</span>
                        <span class="bk-tbl-main"><strong><span class="bk-tbl-no">#${escapeHtml(key)}</span>${escapeHtml(table.name)}</strong>
                        <span class="bk-sum-meta"><span>${table.columns.length} 栏</span><span>${rows.length} 行</span>${access}</span></span></button>
                    <button type="button" class="bk-sum-dots" data-bk-tbl-menu aria-label="${escapeHtml(table.name)} 的操作">⋯</button>
                </div>${open ? `<div class="bk-tbl-body">${body}</div>` : ''}</section>`;
        }).join('');
        container.innerHTML = directory + sections;
        const focus = tableUiState.editRow || tableUiState.focusField;
        if (focus) {
            requestFrame(() => {
                const section = container.querySelector(`[data-table-index="${focus.tableIndex}"]`);
                const target = tableUiState.focusField
                    ? section?.querySelector(`[data-table-column-name="${focus.colIndex}"]`)
                    : section?.querySelector(`[data-table-row-edit] [data-table-col="${focus.colIndex || 0}"]`);
                tableUiState.focusField = null;
                target?.focus({ preventScroll: true });
                if (target) scrollIntoMain(target, { block: 'nearest', offset: 80 });
            });
        }
    }

    // One change as the reader sees it: which table and row, and for an update the old value next to the new one.
    function describeOperation(operation, state) {
        const table = (state.tableDatabase.tables || []).find(item => Number(item.tableIndex) === Number(operation.tableIndex));
        const tableName = table?.name || `表格 #${operation.tableIndex}`;
        const columnName = key => table?.columns?.[Number(key)] ?? key;
        const row = table?.rows?.[Number(operation.rowIndex)] || [];
        const entries = Object.entries(operation.data || {});
        if (operation.op === 'clock') return { sign: '~', where: '剧情时间', title: '更新剧情时间', lines: entries.map(([, value]) => ({ to: value })) };
        if (operation.op === 'semantic') return { sign: '~', where: tableName, title: `第 ${Number(operation.columnIndex) + 1} 栏的内容类型`, lines: [{ to: kindLabels[operation.kind] || operation.kind }] };
        if (operation.op === 'insert') {
            const values = table ? table.columns.map((_, index) => operation.data?.[index] ?? operation.data?.[String(index)] ?? '') : entries.map(([, value]) => value);
            return { sign: '+', where: `${tableName} · 新增一行`, title: String(values[0] || '新的一行'), lines: [{ to: values.slice(1).filter(Boolean).join(' · ') }] };
        }
        if (operation.op === 'delete') return { sign: '−', where: `${tableName} · 删除一行`, title: String(row[0] || `第 ${Number(operation.rowIndex) + 1} 行`), lines: [{ to: row.slice(1).filter(Boolean).join(' · ') }], danger: true };
        return { sign: '~', where: tableName, title: String(row[0] || `第 ${Number(operation.rowIndex) + 1} 行`),
            lines: entries.map(([key, value]) => ({ label: columnName(key), from: row[Number(key)] ?? '', to: value })) };
    }

    function renderTableEditDrafts(state = ensureState()) {
        const container = document.querySelector('#bakemono-memory-table-draft-list');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        const drafts = state.tableDatabase.editDrafts || [];
        const fragment = document.createDocumentFragment();
        drafts.forEach(draft => {
            const feedback = inspectTableEditDraft(draft, state);
            const operations = feedback.operations;
            const errorText = draft.applicationError || feedback.error;
            const card = document.createElement('article');
            card.className = 'bakemono-memory-table-draft-card bk-tbl-diff';
            card.dataset.tableDraftId = draft.id;
            const header = document.createElement('div');
            header.className = 'bk-tbl-diff-h';
            const title = document.createElement('h4');
            title.textContent = errorText ? '修改未应用' : `本轮修改 · ${operations.length} 处`;
            const meta = document.createElement('span');
            meta.className = 'bk-sum-meta';
            [formatSourceRange(draft.sourceMessageIds || []) || '本轮正文', draft.createdAt ? new Date(draft.createdAt).toLocaleString() : '刚刚生成']
                .forEach(text => { const part = document.createElement('span'); part.textContent = text; meta.append(part); });
            header.append(title, meta);
            const feedbackBox = document.createElement('div');
            feedbackBox.className = 'bk-tbl-diff-note';
            if (errorText) {
                feedbackBox.classList.add('is-error');
                feedbackBox.setAttribute('role', 'alert');
                const reason = document.createElement('p');
                reason.textContent = errorText;
                const hint = document.createElement('small');
                hint.textContent = '草稿已保留，可以在“查看原始指令”里修正后重新解析。';
                feedbackBox.append(reason, hint);
            } else if (feedback.warnings.length) {
                feedbackBox.setAttribute('role', 'status');
                feedbackBox.textContent = feedback.warnings.join(' ');
            } else feedbackBox.hidden = true;

            const preview = document.createElement('div');
            preview.className = 'bakemono-memory-table-diff-list';
            const limit = tableUiState.fullDiffs.has(draft.id) ? operations.length : 6;
            operations.slice(0, limit).forEach(operation => {
                const described = describeOperation(operation, state);
                const item = document.createElement('div');
                item.className = `bk-tbl-op${described.danger ? ' is-delete' : ''}`;
                const sign = document.createElement('span');
                sign.className = 'bk-tbl-op-sign';
                sign.textContent = described.sign;
                const copy = document.createElement('div');
                const where = document.createElement('span');
                where.className = 'bk-tbl-op-where';
                where.textContent = described.where;
                const strong = document.createElement('strong');
                strong.textContent = described.title;
                copy.append(where, strong);
                described.lines.forEach(line => {
                    if (!line.to && !line.from) return;
                    const text = document.createElement('p');
                    text.className = 'bk-tbl-op-change';
                    if (line.label) { const label = document.createElement('span'); label.className = 'bk-tbl-op-label'; label.textContent = line.label; text.append(label); }
                    if (line.from !== undefined && line.from !== '') { const from = document.createElement('s'); from.textContent = line.from; text.append(from, ' → '); }
                    const to = document.createElement('b');
                    to.textContent = line.to === '' ? '（清空）' : line.to;
                    text.append(to);
                    copy.append(text);
                });
                item.append(sign, copy);
                preview.append(item);
            });
            if (operations.length > limit) {
                const more = document.createElement('button');
                more.type = 'button';
                more.className = 'bk-sum-link bk-tbl-more';
                more.dataset.bkTblDiffAll = draft.id;
                more.textContent = `其余 ${operations.length - limit} 处 ›`;
                preview.append(more);
            }

            const textarea = document.createElement('textarea');
            textarea.className = 'text_pole bakemono-memory-table-draft-editor';
            textarea.rows = 7;
            textarea.spellcheck = false;
            textarea.value = draft.raw || '';
            const details = document.createElement('details');
            details.className = 'bakemono-memory-table-draft-details bk-tbl-raw';
            details.open = !!errorText;
            details.innerHTML = '<summary>查看原始指令 ›</summary>';
            const secondaryActions = document.createElement('div');
            secondaryActions.className = 'bk-sum-editor-actions';
            secondaryActions.innerHTML = `
                <button type="button" class="bk-sum-link is-alert" data-bakemono-table-draft-action="discard">丢弃这些修改…</button>
                <span class="bk-tbl-spacer"></span>
                <button type="button" class="bk-sum-link" data-bakemono-table-draft-action="reparse">按改过的指令重新解析</button>`;
            details.append(textarea, secondaryActions);
            const actions = document.createElement('div');
            actions.className = 'bk-tbl-diff-actions';
            const apply = document.createElement('button');
            apply.type = 'button';
            apply.className = 'menu_button bk-sum-primary bakemono-memory-table-draft-apply';
            apply.dataset.bakemonoTableDraftAction = 'apply';
            apply.disabled = !!errorText || !operations.length;
            apply.textContent = operations.length ? `应用 ${operations.length} 处修改` : '没有可应用的修改';
            actions.append(details, apply);
            card.append(header, feedbackBox, preview, actions);
            fragment.append(card);
        });
        container.append(fragment);
    }

    function saveEditedTableFromElement(details, options = {}) {
        const state = options.state || ensureState();
        const tableIndex = Number(details?.dataset.tableIndex);
        const table = (state.tableDatabase.tables || []).find(item => Number(item.tableIndex) === tableIndex);
        if (!table) {
            toastr.warning('没有找到这张表。');
            return;
        }
        // Only what is on screen is written back: the field editor, or the record being edited. A table shown as
        // plain records has no inputs, and must keep its rows and column notes when an action saves it.
        if (details.querySelector('[data-table-name]')) {
            table.name = String(details.querySelector('[data-table-name]')?.value || table.name || '').trim() || '未命名表格';
        }
        if (details.querySelector('[data-table-column-name]')) {
            const columnNames = table.columns.map((name, colIndex) => String(details.querySelector(`[data-table-column-name="${colIndex}"]`)?.value || name || '').trim() || `字段 ${colIndex}`);
            table.columns = columnNames;
            table.columnKinds = columnNames.map((_, i) => details.querySelector(`[data-table-column-kind="${i}"]`)?.value || table.columnKinds?.[i] || 'text');
            table.semanticOverrides = {};
            table.columnPrompts = columnNames.map((_, colIndex) => String(details.querySelector(`[data-table-column-prompt="${colIndex}"]`)?.value || '').trim());
        }
        if (details.querySelector('[data-table-note]')) table.note = String(details.querySelector('[data-table-note]')?.value || '').trim();
        if (details.querySelector('[data-table-readonly]')) {
            table.readOnly = !!details.querySelector('[data-table-readonly]')?.checked;
            table.allowAiEdit = table.readOnly ? false : !!details.querySelector('[data-table-allow-ai]')?.checked;
        }
        table.inject = true;
        table.injectLimit = Math.max(120, Number(table.injectLimit || 1200));
        table.rows = Array.isArray(table.rows) ? table.rows : [];
        const readRow = (node, previous = []) => table.columns.map((_, colIndex) => {
            const input = node.querySelector(`[data-table-col="${colIndex}"]`);
            return input ? String(input.value || '').trim() : String(previous[colIndex] ?? '');
        });
        const gridRows = [...details.querySelectorAll('tbody tr[data-table-row]')];
        if (gridRows.length) table.rows = gridRows.map(row => readRow(row, table.rows[Number(row.dataset.tableRow)]));
        details.querySelectorAll('[data-table-row-edit]').forEach(form => {
            const rowIndex = Number(form.dataset.tableRowEdit);
            if (Number.isInteger(rowIndex) && rowIndex >= 0) table.rows[rowIndex] = readRow(form, table.rows[rowIndex]);
        });
        ensureTableIdentity(table);
        if (options.persist !== false) {
            persistCurrentTableDatabase(state);
        }
        if (options.render !== false) {
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已保存表格：${table.name}`);
        }
        return table;
    }

    async function importTablesFromText(raw, sourceLabel = '表格数据') {
        const text = String(raw || '').trim();
        if (!text) {
            toastr.warning('请先选择或粘贴表格数据。');
            return false;
        }
        let tables;
        try {
            tables = normalizeImportedTablesFromJson(text);
        } catch (error) {
            toastr.error(`表格数据解析失败：${error?.message || error}`);
            return false;
        }
        if (!tables.length) {
            toastr.warning('没有在导入内容中找到可用表格。');
            return false;
        }
        const confirmed = await confirmDanger(
            `导入 ${tables.length} 张表格？`,
            [`来源：${sourceLabel}`, '这会覆盖当前聊天里剧情剪辑台保存的表格数据库，但不会删除摘要。'],
        );
        if (!confirmed) {
            return false;
        }
        const state = ensureState();
        state.tableDatabase.tables = tables;
        state.tableDatabase.lastImportAt = new Date().toISOString();
        state.tableDatabase.enabled = true;
        persistCurrentTableDatabase(state);
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已导入 ${tables.length} 张表格。`);
        toastr.success(`已导入 ${tables.length} 张表格。`);
        return true;
    }

    function createCustomTableFromUi() {
        const state = ensureState();
        const name = String(query('#bakemono-memory-new-table-name').val() || '').trim();
        const columns = parseList(query('#bakemono-memory-new-table-columns').val()).filter(Boolean);
        if (!name) {
            toastr.warning('请先填写新表名称。');
            return;
        }
        if (!columns.length) {
            toastr.warning('请至少填写一个字段名。');
            return;
        }
        const table = {
            id: `table-${getHash(`${Date.now()}|${name}|${columns.join('|')}`)}`,
            tableIndex: getNextTableIndex(state),
            name,
            columns,
            columnPrompts: columns.map(() => ''),
            note: '',
            initNode: '',
            insertNode: '',
            updateNode: '',
            deleteNode: '',
            rows: [],
            required: false,
            readOnly: false,
            inject: true,
            injectLimit: 1200,
            allowAiEdit: true,
        };
        state.tableDatabase.tables.push(table);
        state.tableDatabase.enabled = true;
        persistCurrentTableDatabase(state);
        query('#bakemono-memory-new-table-name').val('');
        query('#bakemono-memory-new-table-columns').val('');
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已创建表格：${name}`);
        toastr.success('表格已创建。');
    }

    return {
        renderTableProfileControls,
        renderTablePromptPresetControls,
        renderTableList,
        renderTableEditDrafts,
        saveEditedTableFromElement,
        importTablesFromText,
        createCustomTableFromUi,
        uiState: tableUiState,
    };
}
