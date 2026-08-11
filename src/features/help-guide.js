import { helpGuideArticles, helpGuideCategories } from './help-guide-content.js';

export function createHelpGuide({ escapeHtml } = {}) {
    let activeCategory = 'start';
    let activeArticle = '';
    let boundRoot = null;

    function getArticleOrder() {
        return ['quick-start', ...Object.values(helpGuideCategories).flat()];
    }

    function renderArticle(articleId) {
        const article = helpGuideArticles[articleId];
        if (!article) return;
        document.getElementById('bakemono-memory-help-article-number').textContent = `${article.number} / ${article.category}`;
        document.getElementById('bakemono-memory-help-article-title').textContent = article.title;
        document.getElementById('bakemono-memory-help-article-meta').innerHTML = `<span>${escapeHtml(article.audience)}</span><span>${escapeHtml(article.duration)}</span>`;
        document.getElementById('bakemono-memory-help-article-lead').textContent = article.lead;
        document.getElementById('bakemono-memory-help-article-steps').innerHTML = article.steps.map(([title, copy], index) => `
            <li><span>${String(index + 1).padStart(2, '0')}</span><div><h5>${escapeHtml(title)}</h5><p>${escapeHtml(copy)}</p></div></li>
        `).join('');

        const note = document.getElementById('bakemono-memory-help-article-note');
        if (note) {
            note.hidden = !article.note;
            if (article.note) note.querySelector('p').innerHTML = `<strong>${escapeHtml(article.note[0])}</strong>${escapeHtml(article.note[1])}`;
        }

        const order = getArticleOrder();
        const nextId = order[order.indexOf(articleId) + 1];
        const nextButton = document.getElementById('bakemono-memory-help-next');
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
        const hub = document.querySelector('[data-bakemono-help-view="hub"]');
        const reader = document.querySelector('[data-bakemono-help-view="article"]');
        const article = helpGuideArticles[activeArticle];
        const panel = document.querySelector('.bakemono-memory-help-panel');
        if (hub) hub.hidden = !!article;
        if (reader) reader.hidden = !article;
        panel?.classList.toggle('is-reading', !!article);

        if (document.getElementById('bakemono-workbench-root')?.dataset.activeTab === 'help') {
            const title = document.getElementById('bakemono-workbench-title');
            const kicker = document.getElementById('bakemono-workbench-section-title');
            const shortKicker = document.getElementById('bakemono-workbench-section-title-short');
            if (title) title.textContent = article?.title || '使用说明';
            if (kicker) kicker.textContent = article ? `使用说明 · ${article.number} / ${article.category}` : '帮助中心 · 随时可查';
            if (shortKicker) shortKicker.textContent = article ? `说明 · ${article.number}` : '帮助中心';
        }

        document.querySelectorAll('[data-bakemono-help-category]').forEach(button => {
            const isActive = button.dataset.bakemonoHelpCategory === category;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });

        const list = document.getElementById('bakemono-memory-help-list');
        if (list) {
            list.innerHTML = helpGuideCategories[category].map(articleId => {
                const item = helpGuideArticles[articleId];
                return `<button type="button" data-bakemono-help-article="${articleId}">
                    <span>${escapeHtml(item.number)}</span><strong>${escapeHtml(item.title)}</strong><em>${escapeHtml(item.tag)}</em><i class="fa-solid fa-arrow-right"></i>
                </button>`;
            }).join('');
        }
        if (article) renderArticle(activeArticle);
    }

    function scrollToTop() {
        document.querySelector('.bakemono-workbench-main')?.scrollTo({ top: 0, behavior: 'auto' });
    }

    function openArticle(articleId) {
        if (!helpGuideArticles[articleId]) return;
        activeArticle = articleId;
        render();
        scrollToTop();
    }

    function closeArticle() {
        activeArticle = '';
        render();
        scrollToTop();
    }

    function handleClick(event) {
        const categoryButton = event.target?.closest?.('[data-bakemono-help-category]');
        if (categoryButton && boundRoot?.contains(categoryButton)) {
            activeCategory = helpGuideCategories[categoryButton.dataset.bakemonoHelpCategory]
                ? categoryButton.dataset.bakemonoHelpCategory
                : 'start';
            activeArticle = '';
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

    function bind(root) {
        if (boundRoot === root) return;
        boundRoot?.removeEventListener('click', handleClick);
        boundRoot = root || null;
        boundRoot?.addEventListener('click', handleClick);
    }

    return { bind, closeArticle, openArticle, render };
}
