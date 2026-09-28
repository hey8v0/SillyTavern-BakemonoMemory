import { helpGuideArticles, helpGuideSections, helpPageTargets } from './help-guide-content.js';

const articleOrder = helpGuideSections.flatMap(section => section.articles);
const sectionOf = id => helpGuideSections.find(section => section.articles.includes(id));
const plainText = article => [article.label || '', article.title, article.keys || '', (article.codes || []).join(' '), article.lead,
    ...article.steps.flat(), ...(article.note || [])].join(' ');
const searchableHelp = articleOrder.map(id => ({ id, title: [helpGuideArticles[id].label || '', helpGuideArticles[id].title].join(' ').toLocaleLowerCase(),
    text: plainText(helpGuideArticles[id]).toLocaleLowerCase() }));

export function searchHelpArticles(query = '') {
    const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return searchableHelp.filter(article => terms.every(term => article.text.includes(term)))
        .sort((a, b) => terms.filter(term => b.title.includes(term)).length - terms.filter(term => a.title.includes(term)).length)
        .map(article => article.id);
}

// “页面” and “页面 → 部分” lead to that page; other quoted names (buttons, fields) stay quoted text.
function pageTarget(name) {
    return helpPageTargets[name] || (name.includes(' → ') ? helpPageTargets[name.split(' → ')[0]] : '');
}

export function createHelpGuide({ escapeHtml, documentRef = globalThis.document } = {}) {
    let activeArticle = '';
    let boundRoot = null;
    let searchQuery = '';

    const withLinks = text => escapeHtml(text).replace(/“([^”]{1,30})”/g, (quoted, name) => {
        const target = pageTarget(name.replaceAll('&gt;', '>'));
        return target ? `<button type="button" class="bk-help-ref" data-bakemono-nav="${target}">${name}</button>` : quoted;
    });

    // A short piece of the text around the first hit, so a search result shows why it matched.
    function snippet(text, term) {
        const at = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
        if (at < 0) return '';
        const start = Math.max(0, at - 16), end = Math.min(text.length, at + term.length + 28);
        return (start ? '…' : '') + escapeHtml(text.slice(start, at)) + '<mark>' + escapeHtml(text.slice(at, at + term.length)) + '</mark>'
            + escapeHtml(text.slice(at + term.length, end)) + (end < text.length ? '…' : '');
    }

    function row(id, index, section, term) {
        const article = helpGuideArticles[id];
        const name = article.label || article.title;
        const numbered = section.numbered && !term;
        let under = article.codes ? `<span class="bk-help-codes">${article.codes.map(escapeHtml).join('<i>·</i>')}</span>`
            : article.keys ? `<span class="bk-help-keys">${escapeHtml(article.keys)}</span>` : '';
        // A hit in the name, keywords or codes already shows; otherwise show where the body matched.
        const lower = value => String(value || '').toLocaleLowerCase(), needle = lower(term);
        if (term && ![name, article.keys, (article.codes || []).join(' ')].some(value => lower(value).includes(needle))) {
            const body = [article.lead, ...article.steps.flat(), ...(article.note || [])].join(' ').replace(/\s+/g, ' ');
            const hit = snippet(body, term);
            if (hit) under = `<span class="bk-help-keys">${hit}</span>`;
        }
        return `<button type="button" class="bk-help-row${numbered ? ' is-numbered' : ''}" data-bakemono-help-article="${id}">`
            + (numbered ? `<span class="bk-help-num">${String(index + 1).padStart(2, '0')}</span>` : '')
            + `<strong>${escapeHtml(name)}</strong>`
            + (numbered ? `<span class="bk-help-min">${article.minutes} 分钟</span>` : '<span class="bk-help-chev" aria-hidden="true">›</span>')
            + under + '</button>';
    }

    function renderIndex() {
        const term = searchQuery.trim();
        const found = term ? new Set(searchHelpArticles(term)) : null;
        const firstTerm = term.split(/\s+/)[0] || '';
        const groups = helpGuideSections.map(section => {
            const ids = section.articles.filter(id => !found || found.has(id));
            if (!ids.length) return '';
            return `<section class="bk-help-group" aria-label="${escapeHtml(section.title)}"><div class="bk-help-group-h"><h3>${escapeHtml(section.title)}</h3>`
                + `<span>${term ? ids.length + ' 篇' : escapeHtml(section.code)}</span></div>`
                + ids.map((id, index) => row(id, index, section, firstTerm)).join('') + '</section>';
        }).join('');
        const list = documentRef.getElementById('bakemono-memory-help-list');
        if (list) list.innerHTML = groups || `<p class="bk-sum-empty">没有找到“${escapeHtml(term)}”。换个功能名、角色名或报错代码试试。</p>`;
        const clearButton = documentRef.getElementById('bakemono-memory-help-search-clear');
        if (clearButton) clearButton.hidden = !term;
    }

    function renderArticle(articleId) {
        const article = helpGuideArticles[articleId];
        if (!article) return;
        const section = sectionOf(articleId);
        const text = (id, value) => { const node = documentRef.getElementById(id); if (node) node.textContent = value; return node; };
        text('bakemono-memory-help-article-kicker', `${section?.title || ''} · 约 ${article.minutes} 分钟`);
        text('bakemono-memory-help-article-title', article.title);
        const lead = documentRef.getElementById('bakemono-memory-help-article-lead');
        if (lead) lead.innerHTML = withLinks(article.lead);
        const goto = documentRef.getElementById('bakemono-memory-help-article-goto');
        if (goto) {
            const target = article.goto ? pageTarget(article.goto) : '';
            goto.hidden = !target;
            if (target) {
                goto.dataset.bakemonoNav = target;
                goto.textContent = `去${article.goto} ›`;
            }
        }
        const note = article.note ? `<li class="bk-help-note"><strong>${escapeHtml(article.note[0])}</strong><p>${withLinks(article.note[1])}</p></li>` : '';
        const after = article.noteAfter ?? article.steps.length;
        const steps = documentRef.getElementById('bakemono-memory-help-article-steps');
        if (steps) steps.innerHTML = article.steps.map(([title, copy], index) => `<li><span class="bk-help-n">${index + 1}</span>`
            + `<div><h4>${escapeHtml(title)}</h4><p>${withLinks(copy)}</p></div></li>${index + 1 === after ? note : ''}`).join('');

        const index = articleOrder.indexOf(articleId);
        const pager = documentRef.getElementById('bakemono-memory-help-pager');
        const link = (id, label) => {
            const item = helpGuideArticles[id];
            return id ? `<button type="button" data-bakemono-help-article="${id}"><small>${label}</small><strong>${escapeHtml(item.label || item.title)}</strong></button>` : '';
        };
        if (pager) pager.innerHTML = link(articleOrder[index - 1], '上一篇') + link(articleOrder[index + 1], '下一篇');
    }

    function render() {
        const hub = documentRef.querySelector('[data-bakemono-help-view="hub"]');
        const reader = documentRef.querySelector('[data-bakemono-help-view="article"]');
        const article = helpGuideArticles[activeArticle];
        if (hub) hub.hidden = !!article;
        if (reader) reader.hidden = !article;
        if (documentRef.getElementById('bakemono-workbench-root')?.dataset.activeTab === 'help') {
            const kicker = documentRef.getElementById('bakemono-workbench-section-title');
            const shortKicker = documentRef.getElementById('bakemono-workbench-section-title-short');
            const where = article ? `使用说明 · ${sectionOf(activeArticle)?.title}` : `使用说明 · ${articleOrder.length} 篇`;
            if (kicker) kicker.textContent = where;
            if (shortKicker) shortKicker.textContent = where;
        }
        renderIndex();
        if (article) renderArticle(activeArticle);
    }

    function scrollToTop() {
        documentRef.querySelector('.bakemono-workbench-main')?.scrollTo({ top: 0, behavior: 'auto' });
    }

    function openArticle(articleId) {
        if (!helpGuideArticles[articleId]) return;
        activeArticle = articleId;
        render();
        scrollToTop();
        const title = documentRef.getElementById('bakemono-memory-help-article-title');
        title?.setAttribute('tabindex', '-1');
        title?.focus?.({ preventScroll: true });
    }

    function closeArticle() {
        const previous = activeArticle;
        activeArticle = '';
        render();
        scrollToTop();
        documentRef.querySelector(`[data-bakemono-help-view="hub"] [data-bakemono-help-article="${previous}"]`)?.focus?.({ preventScroll: true });
    }

    function handleClick(event) {
        const within = selector => { const node = event.target?.closest?.(selector); return node && boundRoot?.contains(node) ? node : null; };
        if (within('#bakemono-memory-help-search-clear')) {
            searchQuery = '';
            const input = documentRef.getElementById('bakemono-memory-help-search');
            if (input) input.value = '';
            render();
            input?.focus?.({ preventScroll: true });
            return;
        }
        const articleButton = within('[data-bakemono-help-article]');
        if (articleButton) { openArticle(articleButton.dataset.bakemonoHelpArticle); return; }
        if (within('[data-bakemono-help-back]')) closeArticle();
    }

    function handleInput(event) {
        if (event.target?.id !== 'bakemono-memory-help-search' || !boundRoot?.contains(event.target) || event.isComposing) return;
        searchQuery = event.target.value;
        renderIndex();
    }

    function bind(root) {
        if (boundRoot === root) return;
        boundRoot?.removeEventListener('click', handleClick);
        boundRoot?.removeEventListener('input', handleInput);
        boundRoot?.removeEventListener('compositionend', handleInput);
        boundRoot = root || null;
        boundRoot?.addEventListener('click', handleClick);
        boundRoot?.addEventListener('input', handleInput);
        boundRoot?.addEventListener('compositionend', handleInput);
    }

    return { bind, closeArticle, openArticle, render };
}
