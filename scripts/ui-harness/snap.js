// Computed-style snapshot of every workbench page, for before/after CSS diffs.
const props = ['display', 'position', 'visibility', 'opacity', 'color', 'background-color', 'background-image',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-top-color',
    'border-bottom-style', 'border-left-color', 'border-radius', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'font-size', 'font-weight', 'font-family', 'line-height',
    'letter-spacing', 'text-align', 'text-transform', 'white-space', 'gap', 'grid-template-columns', 'flex-direction',
    'justify-content', 'align-items', 'box-shadow', 'overflow-x', 'overflow-y', 'z-index', 'cursor', 'outline-style'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function keyOf(el, stop) {
    const parts = [];
    for (let node = el; node && node !== stop; node = node.parentElement) {
        const index = node.parentElement ? [...node.parentElement.children].indexOf(node) : 0;
        parts.unshift(`${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}:${index}`);
    }
    return parts.join('>');
}

function capture(scope, stop) {
    const out = {};
    for (const el of [scope, ...scope.querySelectorAll('*')]) {
        if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const row = { rect: [r.x, r.y, r.width, r.height].map(v => Math.round(v * 2) / 2).join(',') };
        for (const p of props) row[p] = cs.getPropertyValue(p);
        for (const pseudo of ['::before', '::after']) {
            const ps = getComputedStyle(el, pseudo);
            if (ps.content && ps.content !== 'none') row[pseudo] = [ps.content, ps.display, ps.width, ps.height, ps.backgroundColor, ps.backgroundImage.slice(0, 120), ps.color].join('|');
        }
        out[keyOf(el, stop)] = row;
    }
    return out;
}

export async function run(name) {
    if (!document.getElementById('snap-no-motion')) {
        const style = document.createElement('style'); style.id = 'snap-no-motion';
        style.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
        document.head.append(style);
    }
    const root = document.getElementById('bakemono-workbench-root');
    if (root.classList.contains('bakemono-workbench-hidden')) { document.getElementById('bakemono-memory-wand-button').click(); await wait(400); }
    const main = root.querySelector('.bakemono-workbench-main');
    const panels = [...new Set([...root.querySelectorAll('[data-bakemono-panel]')].map(p => p.dataset.bakemonoPanel))];
    const result = {};
    for (const panel of [...panels, 'tables']) {
        const button = document.createElement('button');
        button.className = 'menu_button'; button.dataset.bakemonoNav = panel;
        root.querySelector('.bakemono-workbench-panel.is-active').append(button); button.click(); button.remove();
        await wait(250);
        const active = root.querySelector(`.bakemono-workbench-panel[data-bakemono-panel="${panel === 'tables' ? 'turn-summary' : panel}"]`);
        active.querySelectorAll('details').forEach(d => { d.open = true; });
        await wait(150);
        main.scrollTop = 0;
        result[panel] = { header: capture(root.querySelector('.bakemono-workbench-header'), root), panel: capture(active, root) };
    }
    // Menu open state.
    document.getElementById('bakemono-memory-menu-toggle').click(); await wait(250);
    result.menu = { nav: capture(root.querySelector('.bakemono-workbench-tabs'), root) };
    document.getElementById('bakemono-memory-menu-toggle').click(); await wait(150);
    const body = JSON.stringify({ viewport: [innerWidth, innerHeight], result });
    await fetch('/save/' + encodeURIComponent(name + '.json'), { method: 'POST', body });
    return { name, panels: Object.keys(result).length, bytes: body.length };
}
