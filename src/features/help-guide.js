import { helpGuideArticles, helpGuideCategories } from './help-guide-content.js';

const searchableHelp = Object.entries(helpGuideArticles).map(([id, article]) => ({
    id,
    title: article.title.toLocaleLowerCase(),
    text: [article.title, article.category, article.tag, article.lead, ...article.steps.flat(), ...(article.note || [])].join(' ').toLocaleLowerCase(),
}));

export function searchHelpArticles(query = '') {
    const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return searchableHelp.filter(article => terms.every(term => article.text.includes(term)))
        .sort((a, b) => terms.filter(term => b.title.includes(term)).length - terms.filter(term => a.title.includes(term)).length)
        .map(article => article.id);
}

export function createHelpGuide({ escapeHtml, documentRef = globalThis.document } = {}) {
    let activeCategory = 'start';
    let activeArticle = '';
    let boundRoot = null;
    let searchQuery = '';

    function getArticleOrder() {
        if (activeCategory === 'manual') return helpGuideCategories.manual;
        return ['quick-start', ...Object.entries(helpGuideCategories).filter(([category]) => category !== 'manual').flatMap(([, articles]) => articles)];
    }

    function renderArticle(articleId) {
        const article = helpGuideArticles[articleId];
        if (!article) return;
        documentRef.getElementById('bakemono-memory-help-article-number').textContent = `${article.number} / ${article.category}`;
        documentRef.getElementById('bakemono-memory-help-article-title').textContent = article.title;
        documentRef.getElementById('bakemono-memory-help-article-meta').innerHTML = `<span>${escapeHtml(article.audience)}</span><span>${escapeHtml(article.duration)}</span>`;
        documentRef.getElementById('bakemono-memory-help-article-lead').textContent = article.lead;
        documentRef.getElementById('bakemono-memory-help-article-steps').innerHTML = article.steps.map(([title, copy], index) => `
            <li><span>${String(index + 1).padStart(2, '0')}</span><div><h5>${escapeHtml(title)}</h5><p>${escapeHtml(copy)}</p></div></li>
        `).join('');

        const note = documentRef.getElementById('bakemono-memory-help-article-note');
        if (note) {
            note.hidden = !article.note;
            if (article.note) note.querySelector('p').innerHTML = `<strong>${escapeHtml(article.note[0])}</strong>${escapeHtml(article.note[1])}`;
        }

        const order = getArticleOrder();
        const nextId = order[order.indexOf(articleId) + 1];
        const nextButton = documentRef.getElementById('bakemono-memory-help-next');
        if (nextButton) {
            nextButton.hidden = !nextId;
            if (nextId) {
                nextButton.dataset.bakemonoHelpArticle = nextId;
                nextButton.querySelector('strong').textContent = helpGuideArticles[nextId].title;
            }
        }
    }

    function render() {
        const category = helpGuideCategories[activeCategory] ? activeCategory : 'start';
        const hub = documentRef.querySelector('[data-bakemono-help-view="hub"]');
        const reader = documentRef.querySelector('[data-bakemono-help-view="article"]');
        const article = helpGuideArticles[activeArticle];
        const panel = documentRef.querySelector('.bakemono-memory-help-panel');
        if (hub) hub.hidden = !!article;
        if (reader) reader.hidden = !article;
        panel?.classList.toggle('is-reading', !!article);

        if (documentRef.getElementById('bakemono-workbench-root')?.dataset.activeTab === 'help') {
            const title = documentRef.getElementById('bakemono-workbench-title');
            const kicker = documentRef.getElementById('bakemono-workbench-section-title');
            const shortKicker = documentRef.getElementById('bakemono-workbench-section-title-short');
            if (title) title.textContent = article?.title || '使用说明';
            if (kicker) kicker.textContent = article ? `使用说明 · ${article.number} / ${article.category}` : '帮助中心 · 随时可查';
            if (shortKicker) shortKicker.textContent = article ? `说明 · ${article.number}` : '帮助中心';
        }

        documentRef.querySelectorAll('[data-bakemono-help-category]').forEach(button => {
            const isActive = button.dataset.bakemonoHelpCategory === category;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });

        const searching = !!searchQuery.trim();
        const articleIds = searching ? searchHelpArticles(searchQuery) : helpGuideCategories[category];
        const searchStatus = documentRef.getElementById('bakemono-memory-help-search-status');
        if (searchStatus) searchStatus.textContent = searching
            ? (articleIds.length ? `找到 ${articleIds.length} 篇说明 · 搜索全部分类` : '没有找到相关说明，试试“标签”“保存”或“向量”。')
            : '可以搜索问题、功能名或错误代码';
        const clearButton = documentRef.getElementById('bakemono-memory-help-search-clear');
        if (clearButton) clearButton.hidden = !searching;
        const cover = documentRef.querySelector('.bakemono-memory-help-cover');
        if (cover) cover.hidden = searching;
        const list = documentRef.getElementById('bakemono-memory-help-list');
        if (list) {
            list.innerHTML = articleIds.map(articleId => {
                const item = helpGuideArticles[articleId];
                return `<button type="button" data-bakemono-help-article="${articleId}">
                    <span>${escapeHtml(item.number)}</span><strong>${escapeHtml(item.title)}</strong><em>${escapeHtml(searching ? item.category : item.tag)}</em><i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                </button>`;
            }).join('');
        }
        if (article) renderArticle(activeArticle);
    }

    function scrollToTop() {
        documentRef.querySelector('.bakemono-workbench-main')?.scrollTo({ top: 0, behavior: 'auto' });
    }

    function openArticle(articleId) {
        if (!helpGuideArticles[articleId]) return;
        activeCategory = Object.keys(helpGuideCategories).find(category => helpGuideCategories[category].includes(articleId)) || 'start';
        activeArticle = articleId;
        render();
        scrollToTop();
        const title = documentRef.getElementById('bakemono-memory-help-article-title');
        title?.setAttribute('tabindex', '-1');
        title?.focus?.({ preventScroll: true });
    }

    function closeArticle() {
        activeArticle = '';
        render();
        scrollToTop();
        documentRef.querySelector(`[data-bakemono-help-category="${activeCategory}"]`)?.focus?.({ preventScroll: true });
    }

    function handleClick(event) {
        const clearButton = event.target?.closest?.('#bakemono-memory-help-search-clear');
        if (clearButton && boundRoot?.contains(clearButton)) {
            searchQuery = '';
            const input = documentRef.getElementById('bakemono-memory-help-search');
            if (input) input.value = '';
            render();
            input?.focus?.({ preventScroll: true });
            return;
        }
        const categoryButton = event.target?.closest?.('[data-bakemono-help-category]');
        if (categoryButton && boundRoot?.contains(categoryButton)) {
            activeCategory = helpGuideCategories[categoryButton.dataset.bakemonoHelpCategory]
                ? categoryButton.dataset.bakemonoHelpCategory
                : 'start';
            activeArticle = '';
            searchQuery = '';
            const input = documentRef.getElementById('bakemono-memory-help-search');
            if (input) input.value = '';
            render();
            return;
        }
        const articleButton = event.target?.closest?.('[data-bakemono-help-article]');
        if (articleButton && boundRoot?.contains(articleButton)) {
            openArticle(articleButton.dataset.bakemonoHelpArticle);
            return;
        }
        const backButton = event.target?.closest?.('[data-bakemono-help-back]');
        if (backButton && boundRoot?.contains(backButton)) closeArticle();
    }

    function handleInput(event) {
        if (event.target?.id !== 'bakemono-memory-help-search' || !boundRoot?.contains(event.target) || event.isComposing) return;
        searchQuery = event.target.value;
        render();
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
