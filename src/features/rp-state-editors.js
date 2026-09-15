const specs = {
    people: [['name', '姓名'], ['aliases', '别名（每行一个）', 'lines'], ['location', '当前位置', 'locations'], ['birthDate', '出生日期'], ['traits', '特征（每行一项）', 'lines'], ['states', '临时状态（每行一项）', 'descriptions']],
    relationships: [['from', '人物', 'people'], ['to', '关联人物', 'people'], ['kind', '关系'], ['mutual', '双向关系', 'boolean'], ['status', '状态', ['active', 'ended']], ['since', '开始日期'], ['endedAt', '结束日期'], ['milestones', '共同经历（每行一项）', 'descriptions'], ['conflicts', '冲突（每行一项）', 'descriptions']],
    plans: [['title', '约定'], ['participants', '参与者', 'participants'], ['status', '状态', ['proposed', 'accepted', 'completed', 'cancelled', 'failed']], ['due', '约定日期'], ['outcome', '结果']],
    items: [['name', '物品名称'], ['owner', '所有者', 'people'], ['holder', '持有者', 'people'], ['location', '存放地点', 'locations'], ['quantity', '数量（留空表示未知）', 'number'], ['status', '状态', ['available', 'damaged', 'destroyed']]],
    locations: [['name', '地点名称'], ['parent', '上级地点', 'locations']],
    clock: [['date', '剧情日期 / 时间'], ['description', '时间描述']], scene: [['location', '当前场景', 'locations']],
    claims: [['speaker', '说话者'], ['subject', '涉及对象'], ['description', '说法内容', 'text']],
    observations: [['speaker', '观察者'], ['subject', '涉及对象'], ['description', '观察内容', 'text']],
};
const labels = { active: '持续中', ended: '已结束', proposed: '提议中', accepted: '已接受', completed: '已完成', cancelled: '已取消', failed: '未履行', available: '可用', damaged: '损坏', destroyed: '已销毁' };
const dateFields = new Set(['date', 'birthDate', 'since', 'endedAt', 'due']);
export function createRpStateEditors({ escapeHtml: esc, button, help }) {
    function draft(kind, id, entity, revision) {
        return { kind, id, revision, original: structuredClone(entity), values: Object.fromEntries(specs[kind].map(([field, , type]) => [field,
            type === 'lines' ? (entity[field] || []).join('\n') : type === 'descriptions' ? (entity[field] || []).map(item => item.description).join('\n')
                : type === 'participants' ? [...(entity[field] || [])] : type === 'boolean' ? !!entity[field] : entity[field] ?? ''])) };
    }
    function renderEdit(edit, projection) {
        return `<section class="rp-edit-form"><h3 tabindex="-1">修改${({ people: '人物', relationships: '关系', plans: '约定', items: '物品', locations: '地点', clock: '剧情时间', scene: '当前场景', claims: '说法', observations: '观察' })[edit.kind]}</h3>${specs[edit.kind].map(([field, label, type]) => {
            const value = edit.values[field], attr = `data-rp-edit-field="${field}"`;
            let input;
            if (['lines', 'descriptions', 'text'].includes(type)) input = `<textarea class="text_pole" ${attr} rows="3" maxlength="12000">${esc(value)}</textarea>`;
            else if (type === 'boolean') input = `<input type="checkbox" ${attr} ${value ? 'checked' : ''}>`;
            else if (type === 'participants') return `<fieldset><legend>${esc(label)}</legend>${projection.people.map(person => `<label class="rp-choice"><input type="checkbox" ${attr} value="${esc(person.id)}" ${value.includes(person.id) ? 'checked' : ''}><span>${esc(person.name)}</span></label>`).join('')}</fieldset>`;
            else if (['people', 'locations'].includes(type) || Array.isArray(type)) {
                const options = Array.isArray(type) ? type.map(id => ({ id, name: labels[id] })) : projection[type];
                input = `<select class="text_pole" ${attr}>${Array.isArray(type) ? '' : '<option value="">未知 / 无</option>'}${options.filter(item => edit.kind !== 'locations' || item.id !== edit.id).map(item => `<option value="${esc(item.id)}" ${item.id === value ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`;
            } else input = `<input class="text_pole" ${attr} type="${type === 'number' ? 'number' : 'text'}" ${type === 'number' ? 'min="0" step="any"' : 'maxlength="4000"'} value="${esc(value)}" ${dateFields.has(field) ? 'placeholder="YYYY-MM-DD 或 YYYY-MM-DDTHH:mm"' : ''}>`;
            return `<label class="rp-edit-field">${esc(label)}${input}</label>`;
        }).join('')}<div class="rp-controls">${button('edit-save', '保存修改')}${button('edit-cancel', '取消')}${help('保存后立即更新当前状态，并保留修改记录。留空可清除字段；修改不会改写聊天正文。')}</div></section>`;
    }
    function readEdit(root, edit) {
        for (const [field, , type] of specs[edit.kind]) {
            const inputs = [...root.querySelectorAll(`[data-rp-edit-field="${field}"]`)];
            if (!inputs.length) continue;
            edit.values[field] = type === 'participants' ? inputs.filter(input => input.checked).map(input => input.value) : type === 'boolean' ? !!inputs[0].checked : inputs[0].value;
        }
    }
    function values(edit) {
        const result = {};
        for (const [field, , type] of specs[edit.kind]) {
            const value = edit.values[field];
            if (type === 'lines') result[field] = value.split('\n').map(item => item.trim()).filter(Boolean);
            else if (type === 'descriptions') result[field] = value.split('\n').map(item => item.trim()).filter(Boolean).map((description, index) => {
                const old = edit.original[field]?.find(item => item.description === description);
                if (old) { const { active, timing, ...stored } = old; return structuredClone(stored); }
                return { ...(field === 'states' ? { id: 'user-state-' + edit.revision + '-' + index } : {}), description };
            });
            else if (type === 'number') result[field] = value === '' ? null : Number(value);
            else if (dateFields.has(field) || ['people', 'locations'].includes(type)) result[field] = value || null;
            else result[field] = value;
        }
        // Submit only modified fields so unrelated model updates stay untouched.
        return Object.fromEntries(Object.entries(result).filter(([field, value]) => {
            const original = field === 'states' ? (edit.original[field] || []).map(({ active, timing, ...stored }) => stored) : edit.original[field];
            return JSON.stringify(value) !== JSON.stringify(original ?? (Array.isArray(value) ? [] : typeof value === 'boolean' ? false : value === '' ? '' : null));
        }));
    }
    function renderPrompt(library, nav) {
        if (!library) return '';
        const value = nav.promptDraft ||= library.draft();
        return `<details class="rp-prompt-editor" ${nav.promptOpen ? 'open' : ''}><summary>剧情状态提示词</summary>${help('编辑后点击应用；另存或覆盖预设也会应用。预设跨聊天共用，仅改变后续提取，不重写已有记录。载入预设只填入编辑框，删除预设不会停止当前提示词。')}<label class="rp-edit-field">预设<select class="text_pole" data-rp-prompt-select><option value="">自定义</option>${library.list().map(item => `<option value="${esc(item.id)}" ${item.id === value.selectedId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label><div class="rp-controls">${button('prompt-load', '载入所选预设')}</div><label class="rp-edit-field">预设名称<input class="text_pole" data-rp-prompt-name maxlength="80" value="${esc(value.name)}"></label><label class="rp-edit-field">提示词<textarea class="text_pole" data-rp-prompt-text rows="12" maxlength="30000">${esc(value.prompt)}</textarea></label><div class="rp-controls">${button('prompt-apply', '应用提示词')}${button('prompt-save-as', '另存预设')}${button('prompt-overwrite', '覆盖预设', value.selectedId === 'default' || !value.selectedId ? 'disabled' : '')}${button('prompt-delete', '删除预设', value.selectedId === 'default' || !value.selectedId ? 'disabled' : '')}</div></details>`;
    }
    function readPrompt(root, nav) {
        if (!nav.promptDraft) return;
        const text = root.querySelector('[data-rp-prompt-text]');
        if (text) Object.assign(nav.promptDraft, { selectedId: root.querySelector('[data-rp-prompt-select]').value, name: root.querySelector('[data-rp-prompt-name]').value, prompt: text.value });
        nav.promptOpen = root.querySelector('.rp-prompt-editor')?.open ?? nav.promptOpen;
    }
    return { draft, renderEdit, readEdit, values, renderPrompt, readPrompt };
}
