// In-page cascade analyzer. For every element under the workbench root it finds, per longhand
// property, which declarations can ever win. A declaration is "alive" if it wins, or if every rule
// beating it is *conditional* (state classes, attributes, pseudo-classes, non-width media, @container),
// because in some other state it would win. Output is merged across widths by a Node script.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const conditionalClass = /^(is-|has-)/;

function splitArgs(text) {
    const out = []; let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
        else if (c === ',' && !depth) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out.map(s => s.trim()).filter(Boolean);
}

// Specificity [ids, classes, types] with :is/:not/:has = max of args, :where = 0.
function specificity(sel) {
    let a = 0, b = 0, c = 0, i = 0;
    const add = s => { a += s[0]; b += s[1]; c += s[2]; };
    while (i < sel.length) {
        const ch = sel[i];
        if (ch === '#') { a++; i++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; continue; }
        if (ch === '.') { b++; i++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; continue; }
        if (ch === '[') { b++; let d = 0; while (i < sel.length) { if (sel[i] === '[') d++; if (sel[i] === ']') { d--; if (!d) { i++; break; } } i++; } continue; }
        if (ch === ':') {
            if (sel[i + 1] === ':') { c++; i += 2; while (i < sel.length && /[\w-]/.test(sel[i])) i++; continue; }
            i++; let name = ''; while (i < sel.length && /[\w-]/.test(sel[i])) name += sel[i++];
            if (sel[i] === '(') {
                let d = 0, start = i + 1, j = i;
                for (; j < sel.length; j++) { if (sel[j] === '(') d++; if (sel[j] === ')') { d--; if (!d) break; } }
                const args = sel.slice(start, j); i = j + 1;
                if (name === 'where') continue;
                if (['is', 'not', 'has', 'matches'].includes(name)) {
                    const best = splitArgs(args).map(specificity).sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]).pop() || [0, 0, 0];
                    add(best); continue;
                }
                b++; continue; // :nth-child() etc.
            }
            b++; continue;
        }
        if (/[a-zA-Z*]/.test(ch)) { const start = i; while (i < sel.length && /[\w-]/.test(sel[i])) i++; if (sel.slice(start, i) !== '*' && ch !== '*') c++; else if (ch === '*') i++; continue; }
        i++;
    }
    return [a, b, c];
}
const specScore = s => s[0] * 1e6 + s[1] * 1e3 + s[2];

// Filled from conditional.json: attributes JS sets and classes JS toggles at runtime.
let runtimeAttributes = new Set(), runtimeClasses = new Set();
const structural = new Set(['first-child', 'last-child', 'only-child', 'nth-child', 'nth-last-child', 'first-of-type',
    'last-of-type', 'nth-of-type', 'nth-last-of-type', 'only-of-type', 'root', 'scope']);

// A selector part is conditional if it depends on anything that can change at runtime.
function isConditionalPart(sel) {
    let i = 0;
    while (i < sel.length) {
        const ch = sel[i];
        if (ch === '.') {
            let name = ''; i++; while (i < sel.length && /[\w-]/.test(sel[i])) name += sel[i++];
            if (runtimeClasses.has(name) || conditionalClass.test(name)) return true;
            continue;
        }
        if (ch === '[') {
            let j = i + 1; while (j < sel.length && /[\w-]/.test(sel[j])) j++;
            const attr = sel.slice(i + 1, j).toLowerCase();
            if (runtimeAttributes.has(attr)) return true;
            let d = 0; while (i < sel.length) { if (sel[i] === '[') d++; if (sel[i] === ']') { d--; if (!d) { i++; break; } } i++; }
            continue;
        }
        if (ch === ':') {
            if (sel[i + 1] === ':') { i += 2; while (i < sel.length && /[\w-]/.test(sel[i])) i++; continue; }
            i++; let name = ''; while (i < sel.length && /[\w-]/.test(sel[i])) name += sel[i++];
            let args = null;
            if (sel[i] === '(') {
                let d = 0, j = i;
                for (; j < sel.length; j++) { if (sel[j] === '(') d++; if (sel[j] === ')') { d--; if (!d) break; } }
                args = sel.slice(i + 1, j); i = j + 1;
            }
            if (structural.has(name)) continue;
            if (['not', 'is', 'where', 'matches'].includes(name) && args !== null) {
                if (splitArgs(args).some(isConditionalPart)) return true;
                continue;
            }
            return true; // :has, :hover, :checked, :empty and other state pseudo-classes
        }
        i++;
    }
    return false;
}

function contextState(context) {
    // Returns 'off' (does not apply now), 'on' (definitely applies), or 'conditional'.
    let state = 'on';
    for (const prelude of context) {
        if (prelude.startsWith('@media')) {
            const query = prelude.slice(6).trim();
            if (/prefers-|hover|pointer|orientation|print/.test(query)) { state = 'conditional'; continue; }
            if (!matchMedia(query).matches) return 'off';
        } else state = 'conditional'; // @container, @supports, @layer...
    }
    return state;
}

const probe = document.createElement('div').style;
const longhandCache = new Map();
function longhands(prop, value) {
    const key = prop + '\u0000' + value;
    if (longhandCache.has(key)) return longhandCache.get(key);
    let list = [];
    if (!prop.startsWith('--')) {
        probe.cssText = ''; probe.setProperty(prop, value);
        list = [...probe];
        if (!list.length) { probe.cssText = ''; probe.setProperty(prop, 'initial'); list = [...probe]; }
    }
    longhandCache.set(key, list);
    return list;
}

function analyzeState(rules, root, alive, matched) {
    const perElement = new Map();
    for (const rule of rules) {
        const ctx = contextState(rule.context);
        if (ctx === 'off') continue;
        const skip = rule.parts.some(p => /::|:hover|:focus|:active/.test(p));
        if (skip) { matched.add(rule.i); rule.decls.forEach((_, d) => alive.add(rule.i + ':' + d)); continue; }
        for (const part of rule.parts) {
            let nodes;
            try { nodes = [...root.querySelectorAll(part)]; if (root.matches(part)) nodes.push(root); } catch { nodes = null; }
            if (nodes === null) { rule.decls.forEach((_, d) => alive.add(rule.i + ':' + d)); continue; }
            if (!nodes.length) continue;
            matched.add(rule.i);
            const cand = { rule, score: specScore(specificity(part)), conditional: ctx === 'conditional' || isConditionalPart(part) };
            for (const node of nodes) {
                if (!perElement.has(node)) perElement.set(node, new Map());
                const byRule = perElement.get(node);
                const prev = byRule.get(rule.i);
                // Same rule matched through several parts: keep the strongest, unconditional if any part is.
                if (!prev || cand.score > prev.score || (prev.conditional && !cand.conditional)) {
                    byRule.set(rule.i, prev ? { rule, score: Math.max(prev.score, cand.score), conditional: prev.conditional && cand.conditional } : cand);
                }
            }
        }
    }
    for (const byRule of perElement.values()) {
        const byProp = new Map();
        for (const cand of byRule.values()) {
            cand.rule.decls.forEach((decl, d) => {
                const hands = longhands(decl.prop, decl.value);
                if (!hands.length) { alive.add(cand.rule.i + ':' + d); return; }
                for (const hand of hands) {
                    if (!byProp.has(hand)) byProp.set(hand, []);
                    byProp.get(hand).push({ key: cand.rule.i + ':' + d, important: decl.important, score: cand.score, order: cand.rule.i * 1000 + d, conditional: cand.conditional });
                }
            });
        }
        for (const list of byProp.values()) {
            list.sort((x, y) => (y.important - x.important) || (y.score - x.score) || (y.order - x.order));
            for (const item of list) { alive.add(item.key); if (!item.conditional) break; }
        }
    }
}

export async function analyze(label) {
    const rules = await (await fetch('/.output/rules.json?' + Date.now())).json();
    const conditional = await (await fetch('/.output/conditional.json?' + Date.now())).json();
    runtimeAttributes = new Set(conditional.attributes);
    runtimeClasses = new Set(conditional.classes);
    const root = document.getElementById('bakemono-workbench-root');
    if (root.classList.contains('bakemono-workbench-hidden')) { document.getElementById('bakemono-memory-wand-button').click(); await wait(400); }
    // Visit every page first: several render their content lazily on first open.
    const panels = [...new Set([...root.querySelectorAll('[data-bakemono-panel]')].map(p => p.dataset.bakemonoPanel))];
    for (const panel of [...panels, 'tables', 'overview']) {
        const button = document.createElement('button');
        button.className = 'menu_button'; button.dataset.bakemonoNav = panel;
        root.querySelector('.bakemono-workbench-panel.is-active').append(button); button.click(); button.remove();
        await wait(120);
    }
    const alive = new Set(), matched = new Set();
    for (const [open, menu] of [[true, true], [false, false]]) {
        root.querySelectorAll('details').forEach(d => { d.open = open; });
        root.classList.toggle('is-menu-open', menu);
        await wait(100);
        analyzeState(rules, root, alive, matched);
    }
    root.classList.remove('is-menu-open');
    const body = JSON.stringify({ label, width: innerWidth, alive: [...alive], matched: [...matched] });
    await fetch('/save/' + encodeURIComponent('cascade-' + label + '.json'), { method: 'POST', body });
    return { label, width: innerWidth, alive: alive.size, matched: matched.size };
}
