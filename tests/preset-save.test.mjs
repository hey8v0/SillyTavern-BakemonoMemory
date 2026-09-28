import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresetEventsController } from '../src/features/preset-events-controller.js';

// A user saved a 生成模型 preset, then a second one under another name, and found only the second:
// “另存为预设” replaced whichever preset was selected, and the one just saved is selected.
function fixture() {
    const handlers = new Map(), values = new Map();
    const query = selector => ({
        off() { return this; },
        on(event, fn) { handlers.set(selector, fn); return this; },
        val(value) { if (value === undefined) return values.get(selector) ?? ''; values.set(selector, value); return this; },
    });
    const presets = [], selected = {}, asked = [];
    let answer = true;
    const controller = createPresetEventsController({
        query, toastr: { warning() {}, success() {} },
        confirmDanger: title => { asked.push(title); return answer; },
        extensionSettings: { memory: { areaPresets: { api: presets } } }, storageKey: 'memory',
        getAreaPresets: () => presets,
        getSelectedAreaPresetId: scope => selected[scope] || '',
        setSelectedAreaPresetId: (scope, id) => { selected[scope] = id; },
        saveAreaPreset(scope, name, options = {}) {
            const existing = options.replaceId && presets.find(item => item.id === options.replaceId);
            if (existing) { existing.value = values.get('#value'); return existing; }
            const preset = { id: 'p' + presets.length, name, value: values.get('#value') };
            presets.push(preset); selected[scope] = preset.id; return preset;
        },
        renderPromptPresetControls() {}, saveGlobalSettings() {}, renderAreaPresetChange() {},
    });
    controller.bindAreaPresetControls('api', { select: '#s', name: '#name', load: '#load', save: '#save', update: '#update', delete: '#delete' });
    const save = (name, value) => { values.set('#name', name); values.set('#value', value); handlers.get('#save')(); };
    return { presets, asked, save, setAnswer: value => { answer = value; } };
}

test('saving presets under different names keeps every one', () => {
    const f = fixture();
    f.save('硅基流动', 'a');
    f.save('DeepSeek 官方', 'b');
    assert.deepEqual(f.presets.map(item => item.name), ['硅基流动', 'DeepSeek 官方']);
    assert.equal(f.presets[0].value, 'a', 'the first preset is untouched');
    assert.deepEqual(f.asked, []);
});

test('the same name replaces that preset only after asking', () => {
    const f = fixture();
    f.save('硅基流动', 'a');
    f.save('DeepSeek 官方', 'b');
    f.setAnswer(false);
    f.save('硅基流动', 'changed');
    assert.equal(f.presets[0].value, 'a', 'declining keeps the old preset');
    f.setAnswer(true);
    f.save('硅基流动', 'changed');
    assert.equal(f.presets.length, 2);
    assert.equal(f.presets[0].value, 'changed');
    assert.equal(f.presets[1].value, 'b');
    assert.match(f.asked[0], /同名/);
});
