const bound = new WeakSet();
const catalogs = new WeakMap();
const sources = {
    'bakemono-memory-custom-model': ['custom-base-url', 'custom-api-key'],
    'bakemono-memory-vector-model': ['vector-base-url', 'vector-api-key'],
    'bakemono-memory-vector-query-model': ['vector-query-base-url', 'vector-query-api-key', 'vector-base-url', 'vector-api-key'],
};

export function renderModelPicker(documentRef, inputId, models = [], { refresh = false } = {}) {
    const input = documentRef.getElementById(inputId);
    const select = documentRef.querySelector(`select[data-model-input="${inputId}"]`);
    if (!input || !select) return;
    const fields = (sources[inputId] || []).map(id => documentRef.getElementById(`bakemono-memory-${id}`)).filter(Boolean);
    const key = JSON.stringify(fields.map(field => field.value.trim()));
    const previous = catalogs.get(select);
    const candidates = !refresh && previous?.key === key ? previous.models : models;
    const ids = [...new Set(candidates.map(value => String(value || '').trim()).filter(Boolean))].sort();
    catalogs.set(select, { key, models: ids });
    select.replaceChildren();
    const placeholder = documentRef.createElement('option');
    placeholder.value = ''; placeholder.textContent = ids.length ? '选择模型' : '请先拉取模型';
    placeholder.disabled = true;
    select.append(placeholder);
    for (const id of ids) {
        const option = documentRef.createElement('option');
        option.value = id; option.textContent = id;
        select.append(option);
    }
    select.disabled = !ids.length;
    select.title = ids.length ? `选择模型 · ${ids.length} 个候选` : '请先拉取模型';
    select.parentElement.classList.toggle('is-empty', !ids.length);
    const sync = () => { select.value = [...select.options].some(option => option.value === input.value) ? input.value : ''; };
    sync();
    if (bound.has(select)) return;
    bound.add(select);
    const invalidate = () => {
        if (JSON.stringify(fields.map(field => field.value.trim())) !== catalogs.get(select)?.key) {
            renderModelPicker(documentRef, inputId, [], { refresh: true });
        }
    };
    for (const field of fields) {
        field.addEventListener('input', invalidate);
        field.addEventListener('change', invalidate);
    }
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    select.addEventListener('focus', sync);
    select.addEventListener('pointerdown', sync);
    select.addEventListener('change', () => {
        if (!select.value) return;
        input.value = select.value;
        const EventClass = documentRef.defaultView.Event;
        input.dispatchEvent(new EventClass('input', { bubbles: true }));
        input.dispatchEvent(new EventClass('change', { bubbles: true }));
    });
}
