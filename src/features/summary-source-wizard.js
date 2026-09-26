import { summarySourceChoice, workflowForSummarySource } from './turn-trigger-policy.js';

export const summarySourceLabels = Object.freeze({
    existing: '回复里已经自带摘要',
    inline: '让模型在回复里顺带写摘要',
    independent: '每次回复后另外生成摘要',
    manual: '需要时再手动生成',
    legacy: '旧版组合设置',
});

export const summarySourceShortLabels = Object.freeze({
    existing: '回复自带', inline: '顺带写', independent: '另外生成', manual: '手动生成', legacy: '旧版组合',
});

// Custom advanced combinations stay visible instead of being hidden behind the source label.
export function getSummarySourceShortLabel(state) {
    const choice = summarySourceChoice(state);
    const base = summarySourceShortLabels[choice] || summarySourceShortLabels.legacy;
    return state.workflowMode === 'mixed' ? `${base} · 自定义` : base;
}

const radioName = 'bakemono-memory-summary-source';
const workflowFields = Object.freeze({
    workflowMode: 'bakemono-memory-workflow-mode',
    memoryStrategy: 'bakemono-memory-memory-strategy',
    stageSourceMode: 'bakemono-memory-stage-source-mode',
    outputMode: 'bakemono-memory-output-mode',
});

export function describeSummarySource(choice, includeTags = 'bakemono') {
    if (['independent', 'manual'].includes(choice)) {
        return '摘要保存在插件里；在被阶段总结覆盖之前会注入上下文。阶段总结只读取插件已保存的摘要。';
    }
    const tags = String(includeTags || '').split(/[,，\s]+/).filter(Boolean);
    const shown = (tags.length ? tags : ['bakemono']).map(tag => `<${tag}>`).join('、');
    return `从回复里的 ${shown} 标签读取摘要（可在“扫描与识别”中修改）。这些摘要已在聊天上下文中，不再重复注入。`;
}

// The wizard only fills the form: the page save bar applies it, like any other settings page.
export function createSummarySourceWizard({ documentRef, getState, defaultScanRules, openBackfill = () => {} }) {
    const radios = () => [...documentRef.querySelectorAll(`input[name="${radioName}"]`)];
    const field = key => documentRef.getElementById(workflowFields[key]);
    const setText = (id, text) => { const el = documentRef.getElementById(id); if (el) el.textContent = text; };

    function describe(choice, state = getState()) {
        const tags = state.scanRules?.includeTags || defaultScanRules?.includeTags;
        setText('bakemono-memory-summary-source-effect', choice ? describeSummarySource(choice, tags) : '选择一种方式后，这里会说明插件将如何读取和注入摘要。');
        const expected = choice && workflowForSummarySource(choice);
        const custom = !!expected && Object.keys(workflowFields).some(key => field(key) && field(key).value !== expected[key]);
        const note = documentRef.getElementById('bakemono-memory-summary-source-custom');
        if (note) note.hidden = !custom;
        // Plugin-stored summaries are only injected with the matching strategy; say so plainly.
        const lost = ['independent', 'manual'].includes(choice) && field('memoryStrategy')?.value !== expected?.memoryStrategy;
        setText('bakemono-memory-summary-source-custom-text', lost
            ? '当前搭配下，插件里保存的摘要不会注入上下文。点“恢复默认搭配”并保存即可修正。'
            : '下方“高级”里的搭配已单独调整，与所选方式的默认搭配不同。');
    }

    // Called before the page save bar restores drafts, so checked state reflects the saved choice.
    function render(state = getState()) {
        const choice = summarySourceChoice(state);
        for (const radio of radios()) radio.checked = radio.value === choice;
        const legacy = documentRef.getElementById('bakemono-memory-summary-source-legacy');
        if (legacy) legacy.hidden = choice !== 'legacy';
        describe(radios().find(radio => radio.checked)?.value || '', state);
    }

    // Fill the advanced fields with the default combination; each change is a normal draft edit.
    function fill(choice) {
        for (const [key, value] of Object.entries(workflowForSummarySource(choice))) {
            const select = field(key);
            if (!select || select.value === value) continue;
            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        describe(choice);
    }

    function onChange(event) {
        const radio = event.target;
        if (radio?.name === radioName && radio.checked) fill(radio.value);
    }

    function onClick(event) {
        if (event.target?.closest?.('[data-bakemono-summary-source-reset]')) {
            const choice = radios().find(radio => radio.checked)?.value;
            if (choice) fill(choice);
            return;
        }
        if (!event.target?.closest?.('[data-bakemono-summary-backfill]')) return;
        const choice = radios().find(radio => radio.checked)?.value || summarySourceChoice(getState());
        // Summaries kept in replies are written back into old floors; plugin-stored ones stay in the plugin.
        openBackfill(['independent', 'manual'].includes(choice) ? 'backfill' : 'missing');
    }

    function onFieldChange(event) {
        if (Object.values(workflowFields).includes(event.target?.id)) describe(radios().find(radio => radio.checked)?.value || '');
    }

    let root = null;
    function bind(nextRoot) {
        if (root === nextRoot) return;
        root?.removeEventListener('change', onChange);
        root?.removeEventListener('change', onFieldChange);
        root?.removeEventListener('click', onClick);
        root = nextRoot;
        root?.addEventListener('change', onChange);
        root?.addEventListener('change', onFieldChange);
        root?.addEventListener('click', onClick);
    }

    // Re-describe from the form after drafts are restored (the checked radio may be a draft).
    const refresh = () => describe(radios().find(radio => radio.checked)?.value || '');

    return { bind, refresh, render };
}
