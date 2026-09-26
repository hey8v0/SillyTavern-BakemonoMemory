import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applySummarySourceChoice, summarySourceChoice, workflowForSummarySource } from '../src/features/turn-trigger-policy.js';
import { createSummarySourceWizard, describeSummarySource, getSummarySourceShortLabel } from '../src/features/summary-source-wizard.js';
import { createConfigurationService } from '../src/features/configuration-service.js';
import { createPageSettings } from '../src/ui/page-settings.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const choices = ['existing', 'inline', 'independent', 'manual'];
const baseState = () => ({
    turnSummary: { enabled: false, auto: false, processingMode: 'both' }, inlineGeneration: { summaryEnabled: false },
    workflowMode: 'bakemono', memoryStrategy: 'bakemono', stageSourceMode: 'summaries', outputMode: 'bakemono',
    scanRules: { includeTags: 'bakemono' },
});

test('summaries kept in plugin storage are injected; summaries written into replies are not', () => {
    for (const choice of ['existing', 'inline']) {
        assert.deepEqual(workflowForSummarySource(choice),
            { workflowMode: 'bakemono', memoryStrategy: 'bakemono', stageSourceMode: 'summaries', outputMode: 'bakemono' });
    }
    for (const choice of ['independent', 'manual']) {
        assert.deepEqual(workflowForSummarySource(choice),
            { workflowMode: 'generic', memoryStrategy: 'generic', stageSourceMode: 'backfill', outputMode: 'plain' });
    }
    // The mapping agrees with the material source the policy already picks for each choice.
    for (const choice of choices) {
        const state = baseState();
        applySummarySourceChoice(state, choice === 'existing' ? 'inline' : 'existing');
        applySummarySourceChoice(state, choice);
        assert.equal(summarySourceChoice(state), choice);
        assert.equal(state.stageSourceMode, workflowForSummarySource(choice).stageSourceMode, choice);
    }
});

test('the description names every configured tag and explains plugin-stored injection', () => {
    assert.match(describeSummarySource('existing', 'bakemono, recap'), /<bakemono>、<recap>/);
    assert.match(describeSummarySource('independent'), /保存在插件里/);
    assert.equal(getSummarySourceShortLabel({ ...baseState(), workflowMode: 'mixed' }), '回复自带 · 自定义');
});

test('saving the workflow page applies the chosen source and its workflow fields together', () => {
    const form = { 'input[name="bakemono-memory-summary-source"]:checked': 'independent', ...Object.fromEntries(
        Object.entries(workflowForSummarySource('independent')).map(([key, value]) => [`#bakemono-memory-${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`, value])) };
    const service = createConfigurationService({ query: selector => ({ val: () => form[selector], length: 1 }),
        getState: baseState, memoryStrategies: { BAKEMONO: 'bakemono', GENERIC: 'generic' },
        workflowModes: { BAKEMONO: 'bakemono', GENERIC: 'generic', MIXED: 'mixed' },
        stageSourceModes: { SUMMARIES: 'summaries', BACKFILL: 'backfill', RAW: 'raw', MIXED: 'mixed', AUTO: 'auto' } });
    const state = baseState();
    service.readWorkflowFieldsFromUi(state);
    assert.equal(summarySourceChoice(state), 'independent');
    assert.deepEqual([state.workflowMode, state.memoryStrategy, state.stageSourceMode, state.outputMode],
        ['generic', 'generic', 'backfill', 'plain']);
});

function wizardDom() {
    const listeners = {};
    const radios = choices.map(value => ({ name: 'bakemono-memory-summary-source', id: `bakemono-memory-summary-source-${value}`,
        type: 'radio', value, checked: false, readOnly: false, removeAttribute() {}, setAttribute() {}, matches: () => false }));
    const select = (id, group = true) => ({ id, type: 'select-one', value: '', readOnly: false, removeAttribute() {}, setAttribute() {}, matches: () => false,
        dataset: group ? { bakemonoEditGroup: 'bakemono-memory-summary-source' } : {},
        dispatchEvent(event) { listeners.change?.forEach(listener => listener({ ...event, type: event.type, target: this })); } });
    const selects = ['workflow-mode', 'memory-strategy', 'stage-source-mode', 'output-mode'].map(name => select(`bakemono-memory-${name}`));
    const text = id => ({ id, textContent: '', hidden: true, classList: { toggle() {} }, disabled: false });
    const nodes = Object.fromEntries([...selects, ...['summary-source-effect', 'summary-source-custom', 'summary-source-legacy',
        'summary-source-custom-text', 'page-savebar', 'page-save-status', 'page-save', 'page-discard'].map(name => text(`bakemono-memory-${name}`))].map(node => [node.id, node]));
    const panel = { querySelectorAll: () => [...radios, ...selects] };
    const root = {
        querySelector: selector => selector.includes('"settings"') ? panel : null,
        addEventListener: (type, listener) => { (listeners[type] ||= []).push(listener); }, removeEventListener() {},
    };
    const documentRef = { getElementById: id => nodes[id] || null, querySelectorAll: () => radios };
    const fire = target => listeners.change.forEach(listener => listener({ type: 'change', target }));
    const click = selector => listeners.click.forEach(listener => listener({ preventDefault() {}, stopImmediatePropagation() {},
        target: { closest: wanted => wanted === selector ? nodes[selector.slice(1)] : null } }));
    return { documentRef, root, radios, selects, nodes, fire, click };
}

test('choosing a source fills the advanced fields, counts as one change and discards cleanly', () => {
    const dom = wizardDom();
    let state = baseState();
    const wizard = createSummarySourceWizard({ documentRef: dom.documentRef, getState: () => state });
    const settings = createPageSettings({ documentRef: dom.documentRef, getState: () => state, getActiveTab: () => 'settings',
        refresh() {}, savePage: async () => true });
    settings.bind(dom.root); wizard.bind(dom.root);
    Object.assign(dom.selects[0], { value: 'bakemono' }); Object.assign(dom.selects[1], { value: 'bakemono' });
    Object.assign(dom.selects[2], { value: 'summaries' }); Object.assign(dom.selects[3], { value: 'bakemono' });
    wizard.render(state); settings.render();
    assert.deepEqual(dom.radios.filter(radio => radio.checked).map(radio => radio.value), ['existing']);
    assert.equal(dom.nodes['bakemono-memory-summary-source-custom'].hidden, true);

    dom.radios[0].checked = false; dom.radios[2].checked = true; dom.fire(dom.radios[2]);
    assert.deepEqual(dom.selects.map(select => select.value), ['generic', 'generic', 'backfill', 'plain']);
    assert.match(dom.nodes['bakemono-memory-page-save-status'].textContent, /未保存 · 1 项修改/);
    assert.match(dom.nodes['bakemono-memory-summary-source-effect'].textContent, /保存在插件里/);

    dom.selects[3].value = 'bakemono'; dom.fire(dom.selects[3]);
    assert.equal(dom.nodes['bakemono-memory-summary-source-custom'].hidden, false, 'a hand-tuned combination is called out');

    dom.click('#bakemono-memory-page-discard');
    assert.deepEqual(dom.radios.filter(radio => radio.checked).map(radio => radio.value), ['existing']);
    assert.deepEqual(dom.selects.map(select => select.value), ['bakemono', 'bakemono', 'summaries', 'bakemono']);

    // Independent summaries with the in-reply strategy are saved but never injected: say so.
    state = { ...baseState(), turnSummary: { enabled: true, auto: true, processingMode: 'both' } };
    wizard.render(state);
    assert.equal(dom.nodes['bakemono-memory-summary-source-custom'].hidden, false);
    assert.match(dom.nodes['bakemono-memory-summary-source-custom-text'].textContent, /不会注入/);

    state = { ...baseState(), turnSummary: { enabled: true, auto: true, processingMode: 'table' } };
    wizard.render(state);
    assert.equal(dom.nodes['bakemono-memory-summary-source-legacy'].hidden, false);
    assert.equal(dom.radios.some(radio => radio.checked), false, 'legacy combinations are not shown as a choice');
});

test('workflow page asks one question; injection switch, depth and role live on the injection page', async () => {
    const html = await read('settings.html');
    const panel = name => html.slice(html.indexOf(`data-bakemono-panel="${name}"`), html.indexOf('<section', html.indexOf(`data-bakemono-panel="${name}"`)));
    const settingsPanel = panel('settings'), injectionPanel = panel('injection');
    for (const choice of choices) assert.match(settingsPanel, new RegExp(`id="bakemono-memory-summary-source-${choice}"`));
    assert.doesNotMatch(html, /data-bakemono-workflow-preset|id="bakemono-memory-turn-source"/);
    for (const id of ['injection-enabled', 'depth', 'role']) {
        assert.match(injectionPanel, new RegExp(`id="bakemono-memory-${id}"`), id);
        assert.doesNotMatch(settingsPanel, new RegExp(`id="bakemono-memory-${id}"`), id);
    }
    assert.match(html, /id="bakemono-memory-turn-source-label"/);
});
