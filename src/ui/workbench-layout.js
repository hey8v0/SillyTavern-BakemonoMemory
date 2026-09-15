const sectionOwnership = Object.freeze([
    ['database', 'bakemono-memory-data-status-slot'],
    ['config', 'bakemono-memory-config-settings-slot'],
    ['batch', 'bakemono-memory-batch-summary-slot'],
    ['archive', 'bakemono-memory-floor-archive-slot'],
    ['generation', 'bakemono-memory-generation-settings-slot'],
]);

export const workbenchParentNavigation = Object.freeze({
    'prompt-inspector': { target: 'overview', label: '返回剪辑台' },
    'turn-summary': { target: 'data-hub', label: '返回自动与数据' },
    automation: { target: 'data-hub', label: '返回自动与数据' },
    vector: { target: 'data-hub', label: '返回自动与数据' },
    settings: { target: 'settings-hub', label: '返回设置中心' },
    scan: { target: 'settings-hub', label: '返回设置中心' },
    injection: { target: 'settings-hub', label: '返回设置中心' },
    generation: { target: 'settings-hub', label: '返回设置中心' },
    archive: { target: 'settings-hub', label: '返回设置中心' },
    config: { target: 'settings-hub', label: '返回设置中心' },
    appearance: { target: 'settings-hub', label: '返回设置中心' },
    maintenance: { target: 'settings-hub', label: '返回设置中心' },
    prompts: { target: 'settings-hub', label: '返回设置中心' },
    timeline: { target: 'preview', label: '返回总结' },
});

export function organizeWorkbenchOwnedSections(summaryGenerationMode = 'stage') {
    for (const [sectionName, slotId] of sectionOwnership) {
        const section = document.querySelector(`[data-bakemono-owned-section="${sectionName}"]`);
        const slot = document.getElementById(slotId);
        if (!section || !slot) continue;
        slot.append(section);
        section.classList.toggle('bakemono-memory-owned-primary', ['config', 'generation', 'archive'].includes(sectionName));
        if (['config', 'generation', 'archive'].includes(sectionName)) section.open = true;
        if (sectionName === 'batch') section.hidden = summaryGenerationMode !== 'batch';
    }
}

export function installWorkbenchParentNavigation(root = document.getElementById('bakemono-workbench-root')) {
    if (!root) return;
    for (const [panelName, parent] of Object.entries(workbenchParentNavigation)) {
        const panel = root.querySelector(`[data-bakemono-panel="${panelName}"]`);
        if (!panel || panel.querySelector('.bakemono-memory-parent-link')) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bakemono-memory-parent-link';
        button.dataset.bakemonoNav = parent.target;
        button.setAttribute('aria-label', parent.label);
        button.innerHTML = `<i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>${parent.label}</span>`;
        panel.prepend(button);
    }
}
