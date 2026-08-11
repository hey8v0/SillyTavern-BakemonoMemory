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
    syncCurrentTableSchemas,
    updateInjectionFromSummaries,
    parseList,
    getHash,
    getNextTableIndex,
} = {}) {
    const tableUiState = {
        openTableIndex: '',
        focusCell: null,
        openSection: '',
        focusField: null,
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

    function renderTablePreviewMarkup(table) {
        const columns = Array.isArray(table.columns) ? table.columns : [];
        const rows = Array.isArray(table.rows) ? table.rows : [];
        const headerCells = columns.length
            ? columns.map((column, index) => `<th>${escapeHtml(column || `字段 ${index}`)}</th>`).join('')
            : '<th>暂无字段</th>';
        const rowCells = rows.length
            ? rows.map((row, rowIndex) => `
                <tr>
                    ${columns.map((_, colIndex) => `<td>${escapeHtml(row?.[colIndex] ?? '') || '<span class="bakemono-memory-table-muted">空</span>'}</td>`).join('')}
                </tr>
            `).join('')
            : `<tr><td colspan="${Math.max(1, columns.length)}" class="bakemono-memory-table-preview-empty">暂无数据行</td></tr>`;
        return `
            <div class="bakemono-memory-table-preview-scroll" aria-label="${escapeHtml(table.name || '表格')}预览">
                <table class="bakemono-memory-table-preview">
                    <thead><tr>${headerCells}</tr></thead>
                    <tbody>${rowCells}</tbody>
                </table>
            </div>
        `;
    }

    function renderTableList(state = ensureState()) {
        const container = document.querySelector('#bakemono-memory-table-list');
        if (!container) {
            return;
        }
        const openTableIndexes = new Set(
            [...container.querySelectorAll('.bakemono-memory-table-item[open]')]
                .map(item => String(item.dataset.tableIndex || '')),
        );
        const openSections = new Set(
            [...container.querySelectorAll('.bakemono-memory-table-section[open]')]
                .map(item => `${item.closest('.bakemono-memory-table-item')?.dataset.tableIndex || ''}:${item.dataset.tableSection || ''}`),
        );
        if (tableUiState.openTableIndex !== '') {
            openTableIndexes.add(String(tableUiState.openTableIndex));
        }
        if (tableUiState.openTableIndex !== '' && tableUiState.openSection) {
            openSections.add(`${tableUiState.openTableIndex}:${tableUiState.openSection}`);
        }
        container.innerHTML = '';
        const tables = state.tableDatabase.tables || [];
        if (!tables.length) {
            const empty = document.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无表格。可以导入表格结构或聊天表格数据。';
            container.append(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        tables.forEach(table => {
            table.columnPrompts = Array.isArray(table.columnPrompts) ? table.columnPrompts : [];
            const row = document.createElement('details');
            row.className = 'bakemono-memory-table-item';
            row.dataset.tableIndex = String(table.tableIndex);
            row.open = openTableIndexes.has(String(table.tableIndex));
            const summary = document.createElement('summary');
            const statusChips = [
                `${table.columns.length} 列`,
                `${(table.rows || []).length} 行`,
                table.readOnly ? '只读' : (table.allowAiEdit === false ? '禁止 AI 修改' : 'AI 可改'),
            ];
            summary.innerHTML = `
                <div class="bakemono-memory-table-summary-main">
                    <div class="bakemono-memory-table-summary-head">
                        <strong>#${escapeHtml(table.tableIndex)} ${escapeHtml(table.name)}</strong>
                        <span>${statusChips.map(chip => escapeHtml(chip)).join(' / ')}</span>
                    </div>
                    ${renderTablePreviewMarkup(table)}
                    <div class="bakemono-memory-table-summary-hint">
                        <i class="fa-solid fa-hand-pointer"></i>
                        <span>点开后编辑字段、数据行和操作</span>
                    </div>
                </div>
            `;
            const body = document.createElement('div');
            body.className = 'bakemono-memory-table-body';
            const rows = Array.isArray(table.rows) ? table.rows : [];
            const fieldEditors = table.columns.map((col, index) => `
                <div class="bakemono-memory-table-field" data-table-field="${index}">
                    <label>
                        <span>${escapeHtml(index)} · 字段名</span>
                        <input class="text_pole" data-table-column-name="${index}" type="text" value="${escapeHtml(col)}">
                    </label>
                    <label>
                        <span>字段提示词</span>
                        <textarea class="text_pole textarea_compact" data-table-column-prompt="${index}" rows="3" spellcheck="false" placeholder="告诉 AI 这一栏应该记录什么、什么时候更新、不要写什么。">${escapeHtml(table.columnPrompts?.[index] || '')}</textarea>
                    </label>
                    <button type="button" class="menu_button danger_button" data-bakemono-table-action="delete-column" data-table-col="${index}"><i class="fa-solid fa-trash"></i><span>删除字段</span></button>
                </div>
            `).join('');
            const headerCells = table.columns.map((col, index) => `<th>${escapeHtml(index)} · ${escapeHtml(col)}</th>`).join('');
            const rowCells = rows.length
                ? rows.map((cells, rowIndex) => `
                    <tr data-table-row="${rowIndex}">
                        ${table.columns.map((_, colIndex) => `<td><textarea class="text_pole textarea_compact bakemono-memory-table-cell" data-table-col="${colIndex}" rows="2" spellcheck="false">${escapeHtml(cells?.[colIndex] ?? '')}</textarea></td>`).join('')}
                        <td class="bakemono-memory-table-row-tools"><button type="button" class="menu_button danger_button" data-bakemono-table-action="delete-row"><i class="fa-solid fa-trash"></i><span>删行</span></button></td>
                    </tr>`).join('')
                : `<tr class="bakemono-memory-table-empty-row"><td colspan="${Math.max(1, table.columns.length + 1)}">暂无数据行。点“新增一行”开始编辑。</td></tr>`;
            body.innerHTML = `
                <details class="bakemono-memory-table-section" data-table-section="fields" ${openSections.has(`${table.tableIndex}:fields`) ? 'open' : ''}>
                    <summary><i class="fa-solid fa-wand-magic-sparkles"></i><span>字段提示词</span><small>${table.columns.length} 栏</small></summary>
                    <label class="bakemono-memory-editor">
                        <span>表格名称</span>
                        <input class="text_pole" data-table-name type="text" value="${escapeHtml(table.name || '')}">
                    </label>
                    <label class="bakemono-memory-editor">
                        <span>整张表规则</span>
                        <textarea class="text_pole textarea_compact" data-table-note rows="3" spellcheck="false" placeholder="这张表的整体用途、更新原则、禁止事项。">${escapeHtml(table.note || '')}</textarea>
                    </label>
                    <div class="bakemono-memory-table-flags">
                        <label class="checkbox_label bakemono-memory-switch">
                            <input type="checkbox" data-table-readonly ${table.readOnly ? 'checked' : ''}>
                            <span>只读，禁止 AI 修改</span>
                        </label>
                        <label class="checkbox_label bakemono-memory-switch">
                            <input type="checkbox" data-table-allow-ai ${!table.readOnly && table.allowAiEdit !== false ? 'checked' : ''} ${table.readOnly ? 'disabled' : ''}>
                            <span>允许 AI 修改</span>
                        </label>
                    </div>
                    <div class="bakemono-memory-table-fields">${fieldEditors}</div>
                    <div class="bakemono-memory-inline-actions">
                        <button type="button" class="menu_button" data-bakemono-table-action="add-column"><i class="fa-solid fa-plus"></i><span>新增字段</span></button>
                    </div>
                </details>
                <details class="bakemono-memory-table-section" data-table-section="rows" ${openSections.has(`${table.tableIndex}:rows`) || !openSections.has(`${table.tableIndex}:fields`) ? 'open' : ''}>
                    <summary><i class="fa-solid fa-table"></i><span>数据行</span><small>${rows.length} 行</small></summary>
                    <div class="bakemono-memory-table-scroll">
                        <table class="bakemono-memory-edit-table">
                            <thead><tr>${headerCells}<th>操作</th></tr></thead>
                            <tbody>${rowCells}</tbody>
                        </table>
                    </div>
                </details>
                <div class="bakemono-memory-inline-actions">
                    <button type="button" class="menu_button" data-bakemono-table-action="add-row"><i class="fa-solid fa-plus"></i><span>新增一行</span></button>
                    <button type="button" class="menu_button" data-bakemono-table-action="save-table"><i class="fa-solid fa-floppy-disk"></i><span>保存表格</span></button>
                    <button type="button" class="menu_button danger_button" data-bakemono-table-action="delete-table"><i class="fa-solid fa-trash"></i><span>删除表格</span></button>
                </div>
            `;
            row.append(summary, body);
            fragment.append(row);
        });
        container.append(fragment);
        if (tableUiState.focusCell) {
            const { tableIndex, rowIndex, colIndex } = tableUiState.focusCell;
            tableUiState.focusCell = null;
            requestFrame(() => {
                const tableItem = container.querySelector(`.bakemono-memory-table-item[data-table-index="${tableIndex}"]`);
                tableItem?.setAttribute('open', '');
                const cell = tableItem?.querySelector(`tr[data-table-row="${rowIndex}"] [data-table-col="${colIndex}"]`);
                cell?.focus();
                cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            });
        }
        if (tableUiState.focusField) {
            const { tableIndex, colIndex } = tableUiState.focusField;
            tableUiState.focusField = null;
            requestFrame(() => {
                const tableItem = container.querySelector(`.bakemono-memory-table-item[data-table-index="${tableIndex}"]`);
                tableItem?.setAttribute('open', '');
                tableItem?.querySelector('[data-table-section="fields"]')?.setAttribute('open', '');
                const field = tableItem?.querySelector(`[data-table-column-name="${colIndex}"]`);
                field?.focus();
                field?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            });
        }
    }

    function renderTableEditDrafts(state = ensureState()) {
        const container = document.querySelector('#bakemono-memory-table-draft-list');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        const drafts = state.tableDatabase.editDrafts || [];
        if (!drafts.length) {
            const empty = document.createElement('div');
            empty.className = 'bakemono-memory-empty';
            empty.textContent = '暂无表格修改草稿。';
            container.append(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        drafts.forEach(draft => {
            const operations = Array.isArray(draft.operations) ? draft.operations : [];
            const card = document.createElement('article');
            card.className = 'bakemono-memory-table-draft-card';
            card.dataset.tableDraftId = draft.id;
            const header = document.createElement('div');
            header.className = 'bakemono-memory-table-draft-header';
            const badge = document.createElement('span');
            badge.className = 'bakemono-memory-table-draft-badge';
            badge.textContent = '表格修改';
            const time = document.createElement('small');
            time.textContent = draft.createdAt ? new Date(draft.createdAt).toLocaleString() : '刚刚生成';
            header.append(badge, time);
            const title = document.createElement('h4');
            title.textContent = `${operations.length} 处变化等待应用`;
            const meta = document.createElement('span');
            meta.className = 'bakemono-memory-table-draft-meta';
            meta.textContent = formatSourceRange(draft.sourceMessageIds || []) || '本轮正文';
    
            const preview = document.createElement('div');
            preview.className = 'bakemono-memory-table-diff-list';
            operations.slice(0, 4).forEach(operation => {
                const item = document.createElement('div');
                item.className = `bakemono-memory-table-diff-item is-${operation.op || 'update'}`;
                const sign = document.createElement('span');
                sign.className = 'bakemono-memory-table-diff-sign';
                sign.textContent = operation.op === 'insert' ? '+' : operation.op === 'delete' ? '−' : '~';
                const copy = document.createElement('div');
                const itemTitle = document.createElement('strong');
                const operationLabel = operation.op === 'insert' ? '新增记录' : operation.op === 'delete' ? '删除记录' : '更新记录';
                itemTitle.textContent = `表格 #${operation.tableIndex} · ${operationLabel}`;
                const itemText = document.createElement('p');
                const dataText = Object.entries(operation.data || {}).map(([key, value]) => `${key}：${value}`).join(' · ');
                itemText.textContent = dataText || (Number.isFinite(operation.rowIndex) ? `第 ${operation.rowIndex} 行` : '等待查看具体内容');
                copy.append(itemTitle, itemText);
                item.append(sign, copy);
                preview.append(item);
            });
            if (operations.length > 4) {
                const more = document.createElement('small');
                more.className = 'bakemono-memory-table-diff-more';
                more.textContent = `另有 ${operations.length - 4} 处修改，可在原始指令中查看。`;
                preview.append(more);
            }
    
            const textarea = document.createElement('textarea');
            textarea.className = 'text_pole textarea_compact bakemono-memory-table-draft-editor';
            textarea.rows = 7;
            textarea.spellcheck = false;
            textarea.value = draft.raw || '';
            const details = document.createElement('details');
            details.className = 'bakemono-memory-table-draft-details bakemono-memory-console-disclosure';
            details.innerHTML = '<summary><span><i class="fa-solid fa-code"></i> 查看原始修改指令</span><small>重新解析或丢弃</small></summary>';
            const secondaryActions = document.createElement('div');
            secondaryActions.className = 'bakemono-memory-table-draft-secondary-actions';
            secondaryActions.innerHTML = `
                <button type="button" class="menu_button" data-bakemono-table-draft-action="reparse"><i class="fa-solid fa-code"></i><span>重新解析</span></button>
                <button type="button" class="menu_button danger_button" data-bakemono-table-draft-action="discard"><i class="fa-solid fa-trash"></i><span>丢弃</span></button>
            `;
            details.append(textarea, secondaryActions);
            const apply = document.createElement('button');
            apply.type = 'button';
            apply.className = 'menu_button bakemono-memory-table-draft-apply';
            apply.dataset.bakemonoTableDraftAction = 'apply';
            apply.innerHTML = '<i class="fa-solid fa-check"></i><span>应用修改</span>';
            card.append(header, title, meta, preview, details, apply);
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
        table.name = String(details.querySelector('[data-table-name]')?.value || table.name || '').trim() || '未命名表格';
        const columnNames = table.columns.map((name, colIndex) => String(details.querySelector(`[data-table-column-name="${colIndex}"]`)?.value || name || '').trim() || `字段 ${colIndex}`);
        table.columns = columnNames;
        table.columnPrompts = columnNames.map((_, colIndex) => String(details.querySelector(`[data-table-column-prompt="${colIndex}"]`)?.value || '').trim());
        table.note = String(details.querySelector('[data-table-note]')?.value || '').trim();
        table.readOnly = !!details.querySelector('[data-table-readonly]')?.checked;
        table.allowAiEdit = table.readOnly ? false : !!details.querySelector('[data-table-allow-ai]')?.checked;
        table.inject = true;
        table.injectLimit = Math.max(120, Number(table.injectLimit || 1200));
        const rows = [...details.querySelectorAll('tbody tr[data-table-row]')].map(row => (
            table.columns.map((_, colIndex) => String(row.querySelector(`[data-table-col="${colIndex}"]`)?.value || '').trim())
        ));
        table.rows = rows;
        if (options.persist !== false) {
            persistCurrentTableDatabase(state);
        }
        if (options.render !== false) {
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已保存表格：${table.name}`);
        }
        return table;
    }

    function importTablesFromText(raw, sourceLabel = '表格数据') {
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
        const confirmed = confirmDanger(
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
        syncCurrentTableSchemas(state);
        updateInjectionFromSummaries();
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
        syncCurrentTableSchemas(state);
        query('#bakemono-memory-new-table-name').val('');
        query('#bakemono-memory-new-table-columns').val('');
        updateInjectionFromSummaries();
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已创建表格：${name}`);
        toastr.success('表格已创建。');
    }

    return {
        renderTableProfileControls,
        renderTablePromptPresetControls,
        renderTablePreviewMarkup,
        renderTableList,
        renderTableEditDrafts,
        saveEditedTableFromElement,
        importTablesFromText,
        createCustomTableFromUi,
        uiState: tableUiState,
    };
}
