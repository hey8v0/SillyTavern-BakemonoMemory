import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as display from '../src/features/rp-protocol-display.js';

const block = '<rpEvents>{"version":1,"state":{"people":[{"name":"甲","traits":["**胃痛**、`钥匙`、:smile:"]}]}}</rpEvents>';
function apply(rule, source, { placement = 2, markdown = true, prompt = false } = {}) {
    if (rule.disabled || !rule.placement.includes(placement) || !(rule.markdownOnly && markdown || rule.promptOnly && prompt)) return source;
    const slash = rule.findRegex.lastIndexOf('/');
    return source.replace(new RegExp(rule.findRegex.slice(1, slash), rule.findRegex.slice(slash + 1)), rule.replaceString);
}
function fixture(settings = {}) {
    let saved = 0;
    const install = () => display.ensureRpDisplayFilter(settings, () => saved++);
    return { settings, install, saved: () => saved };
}

test('display rule removes the tagged protocol before Markdown transforms its content', () => {
    const f = fixture(); f.install();
    assert.equal(apply(f.settings.regex[0], '正文\n' + block + '\n后续正文'), '正文\n\n后续正文');
});
test('display rule never changes prompt, stored, edited or user message text', () => {
    const f = fixture(); f.install(); const rule = f.settings.regex[0];
    for (const options of [{ markdown: false }, { markdown: false, prompt: true }, { placement: 1 }, { placement: 6 }]) {
        assert.equal(apply(rule, block, options), block);
    }
    assert.equal(rule.promptOnly, false);
    assert.equal(rule.runOnEdit, true); // Rendered edited reply, not its raw edit field.
});
test('display rule preserves ordinary JSON, summaries, widgets and text on either side', () => {
    const f = fixture(); f.install();
    const before = '普通 {"version":1,"state":{}}\n<bakemono>摘要</bakemono>';
    const after = '<widget>小组件</widget>\n结尾';
    assert.equal(apply(f.settings.regex[0], before + block + after), before + after);
    assert.equal(apply(f.settings.regex[0], before + after), before + after);
});
test('display rule hides repeated blocks and incomplete streaming tails', () => {
    const f = fixture(); f.install(); const rule = f.settings.regex[0];
    assert.equal(apply(rule, '前' + block + '中' + block + '后'), '前中后');
    assert.equal(apply(rule, '前<rpEvents>{"version":1,"state":{"people":['), '前');
    assert.equal(apply(rule, '前<RPEVENTS version="1">{"version":1}</RPEVENTS >后'), '前后');
});
test('display rule removes an isolated protocol code fence, retaining adjacent code', () => {
    const f = fixture(); f.install(); const rule = f.settings.regex[0];
    for (const fence of ['```', '~~~']) {
        const code = '```js\nconst x = 1;\n```';
        assert.equal(apply(rule, '前\n' + fence + 'json\n' + block + '\n' + fence + '\n' + code), '前\n\n' + code);
    }
});
test('pretty printed blocks and streaming tails are removed through the end, not just one line', () => {
    const f = fixture(); f.install(); const rule = f.settings.regex[0];
    const multiline = '<rpEvents>\n{\n  "version": 1,\n  "state": {}\n}\n</rpEvents>';
    assert.equal(apply(rule, '前\n' + multiline + '\n后'), '前\n\n后');
    assert.equal(apply(rule, '前\n' + multiline.replace('</rpEvents>', '')), '前\n');
});
test('an unmatched surrounding fence does not consume narrative between two protocol blocks', () => {
    const f = fixture(); f.install(); const rule = f.settings.regex[0];
    const raw = '```json\n' + block + '\n必须保留的正文\n' + block + '\n```';
    assert.match(apply(rule, raw), /必须保留的正文/);
});
test('display filter installs once ahead of other filters without modifying them', () => {
    const foreign = { id: 'user-rule', findRegex: '/<[^>]+>/g', disabled: true };
    const f = fixture({ regex: [foreign], disabledExtensions: ['regex'] });
    assert.equal(f.install(), true); assert.equal(f.install(), false);
    assert.equal(f.saved(), 1); assert.equal(f.settings.regex.length, 2);
    assert.equal(f.settings.regex[1], foreign);
    assert.deepEqual(f.settings.disabledExtensions, ['regex']);
});
test('display filter does not overwrite a user-edited managed rule or invalid settings', () => {
    const f = fixture(); f.install(); const rule = f.settings.regex[0];
    rule.disabled = true; rule.findRegex = '/custom/g';
    assert.equal(f.install(), false); assert.equal(rule.findRegex, '/custom/g');
    assert.equal(display.ensureRpDisplayFilter(null), false);
    assert.equal(display.ensureRpDisplayFilter({ regex: 'invalid' }), false);
});
test('fresh settings after reload get their own rule without reusing the old array', () => {
    const a = fixture(), b = fixture(); a.install(); b.install();
    assert.notEqual(a.settings.regex, b.settings.regex);
    assert.deepEqual(a.settings.regex, b.settings.regex);
});
test('production display wiring installs the rule and uses a synthetic formatting ID', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const binding = source.match(/const rpProtocolDisplay = createRpProtocolDisplay\(\{[\s\S]*?\n\}\);/)?.[0];
    assert.ok(binding);
    const settings = {}; let saved = 0, formatted;
    const context = vm.createContext({ document: {}, chat: [], extension_settings: settings,
        saveSettingsDebounced: () => saved++, ensureRpDisplayFilter: display.ensureRpDisplayFilter,
        createRpProtocolDisplay: options => options,
        tavernHost: { messageFormatting: (...args) => { formatted = args; return 'formatted'; } } });
    vm.runInContext(binding + '\nglobalThis.options = rpProtocolDisplay;', context);
    context.options.installDisplayFilter(); context.options.installDisplayFilter();
    assert.equal(settings.regex.length, 1); assert.equal(saved, 1);
    assert.equal(context.options.renderProtocol('payload', { name: '甲' }), 'formatted');
    assert.deepEqual(formatted, ['payload', '甲', false, false, -1]);
});
