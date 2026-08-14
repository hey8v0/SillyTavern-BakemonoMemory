export function createSummaryPreviewRenderer({
    documentRef,
    getState,
    blockTypes,
    defaultPreviewLayouts,
    getMultiSummaryLabel,
    getBlockTitle,
    getBlockPlainText,
    stripHtml,
    findSavedSummaryByHash,
    canRemoveScannedSummaryBlock,
}) {
    function getBracketMetaLine(text) {
        return text.split('\n').map(line => line.trim()).find(line => /^【[\s\S]+】$/.test(line)) || '';
    }

    function parsePreviewMeta(block) {
        const summary = getBlockTitle(block.content, block.title);
        const text = getBlockPlainText(block.content);
        const metaLine = getBracketMetaLine(text);
        const fallbackTitle = summary.replace(/[📋【】]/g, '').trim() || block.title;
        const meta = {
            sticker: summary || (block.type === blockTypes.EPIC ? getMultiSummaryLabel(block) : block.type === blockTypes.STAGE ? '阶段总结' : '剧情摘要手账'),
            label: block.messageId === Number.MAX_SAFE_INTEGER ? '生成内容' : `第 ${block.messageId} 楼`,
            title: fallbackTitle,
            meta: metaLine || summary,
            submeta: '',
        };

        if (block.type === blockTypes.STORY) {
            const storyMatch = metaLine.match(/第\s*([^章：:]+)\s*章\s*[：:]\s*([^』★]+).*?★\s*([^★]+)\s*★\s*([^☆]+)\s*☆/);
            if (storyMatch) {
                meta.label = `第 ${storyMatch[1].trim()} 章`;
                meta.title = storyMatch[2].trim();
                meta.meta = storyMatch[3].trim();
                meta.submeta = storyMatch[4].trim();
            } else {
                const looseChapter = text.match(/第\s*([0-9一二三四五六七八九十百千]+)\s*章\s*[：:]\s*([^\n★】]+)/);
                if (looseChapter) {
                    meta.label = `第 ${looseChapter[1].trim()} 章`;
                    meta.title = looseChapter[2].trim();
                }
            }
        } else if (block.type === blockTypes.STAGE) {
            const stageMatch = metaLine.match(/『([^』]+)』.*?跨度[：:]\s*([^★]+).*?(当前时间点|时间跨度)[：:]\s*([^☆]+)\s*☆/);
            if (stageMatch) {
                meta.label = stageMatch[2].trim();
                meta.title = stageMatch[1].trim();
                meta.meta = `${stageMatch[3].trim()}：${stageMatch[4].trim()}`;
            }
        } else if (block.type === blockTypes.EPIC) {
            const epicMatch = metaLine.match(/『([^』]+)』.*?总跨度[：:]\s*([^★]+).*?(当前时间点|时间跨度)[：:]\s*([^☆]+)\s*☆/);
            if (epicMatch) {
                meta.label = epicMatch[2].trim();
                meta.title = epicMatch[1].trim();
                meta.meta = `${epicMatch[3].trim()}：${epicMatch[4].trim()}`;
            }
        }

        return meta;
    }

    function getPreferredSummaryTitle(block) {
        const genericTitles = new Set(['剧情摘要', '📋 剧情摘要', '剧集终了·点击回看', '多次总结·长期总览', '纪元回溯·史诗简史']);
        const manualTitle = String(block?.metadata?.userTitle || '').trim();
        if (manualTitle) {
            return manualTitle;
        }
        const title = String(block?.title || '').replace(/[【】]/g, '').trim();
        if (block?.isGeneratedSummary && title && !genericTitles.has(title)) {
            return title;
        }
        return '';
    }

    function getPreviewSummaryText(block) {
        const prefix = block.type === blockTypes.EPIC ? '多次' : block.type === blockTypes.STAGE ? '阶段' : '摘要';
        const preferredTitle = getPreferredSummaryTitle(block);
        if (preferredTitle) {
            return preferredTitle.startsWith(`${prefix} ·`) ? preferredTitle : `${prefix} · ${preferredTitle}`;
        }
        const meta = parsePreviewMeta(block);
        const pieces = [meta.label, meta.title].filter(Boolean);
        return `${prefix} · ${pieces.join(' · ') || meta.sticker || block.title}`;
    }

    function parsePreviewLayout(value) {
        return String(value || '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const [label = '片段', section = label, style = 'normal'] = line.split('|').map(part => part.trim());
                const modifier = style === 'bubble' ? 'bk-bubble' : style === 'tag' ? 'bk-tag-line' : '';
                return [label, section, modifier];
            });
    }

    function getPreviewTabs(type) {
        const state = getState();
        const layoutKey = type === blockTypes.EPIC ? 'epic' : type === blockTypes.STAGE ? 'stage' : 'story';
        return parsePreviewLayout(state.previewLayouts[layoutKey] || defaultPreviewLayouts[layoutKey]);
    }

    function extractSectionText(text, label) {
        const labels = String(label || '').split(/[，,]/).map(item => item.trim()).filter(Boolean);
        const target = labels.find(item => text.includes(`【${item}】`) || text.includes(item));
        if (!target) {
            return '';
        }

        const marker = text.includes(`【${target}】`) ? `【${target}】` : target;
        const index = text.indexOf(marker);
        if (index < 0) {
            return '';
        }

        const lineEnd = text.indexOf('\n', index);
        const start = lineEnd >= 0 ? lineEnd + 1 : index + marker.length;
        const next = text.slice(start).search(/\n\s*➤\s*/);
        const end = next >= 0 ? start + next : text.length;
        return text.slice(start, end).replace(/<\/?[^>]+>/g, '').trim();
    }

    function createTextNodeElement(tagName, className, text) {
        const element = documentRef.createElement(tagName);
        if (className) {
            element.className = className;
        }
        element.textContent = text;
        return element;
    }

    function createSavedSummaryControls(block) {
        const saved = findSavedSummaryByHash(block.hash);
        if (!saved) {
            if (!canRemoveScannedSummaryBlock?.(block)) return documentRef.createDocumentFragment();
            const sourceTools = documentRef.createElement('div');
            sourceTools.className = 'bakemono-memory-summary-tools bakemono-memory-source-summary-tools';
            sourceTools.dataset.summaryHash = block.hash;
            sourceTools.innerHTML = `
                <p class="bakemono-memory-source-summary-note"><i class="fa-solid fa-link"></i><span>来自第 ${Number(block.messageId)} 楼正文标签；不是插件元数据里的正式摘要。</span></p>
                <button class="menu_button danger_button" data-bakemono-summary-action="delete-source"><i class="fa-solid fa-trash"></i><span>从原正文移除</span></button>
            `;
            return sourceTools;
        }
        const wrapper = documentRef.createElement('div');
        wrapper.className = 'bakemono-memory-summary-tools';
        wrapper.dataset.summaryHash = block.hash;
        wrapper.innerHTML = `
            <div class="bakemono-memory-inline-actions">
                <button class="menu_button" data-bakemono-summary-action="edit"><i class="fa-solid fa-pen"></i><span>编辑摘要</span></button>
                <button class="menu_button" data-bakemono-summary-action="more"><i class="fa-solid fa-ellipsis"></i><span>更多</span></button>
            </div>
            <div class="bakemono-memory-summary-editor" hidden>
                <label class="bakemono-memory-field"><span>标题</span><input class="text_pole bakemono-summary-title" type="text"></label>
                <label class="bakemono-memory-editor"><span>正文</span><textarea class="text_pole textarea_compact bakemono-summary-content" rows="8" spellcheck="false"></textarea></label>
                <div class="bakemono-memory-inline-actions">
                    <button class="menu_button" data-bakemono-summary-action="save"><i class="fa-solid fa-check"></i><span>保存修改</span></button>
                    <button class="menu_button" data-bakemono-summary-action="cancel"><i class="fa-solid fa-xmark"></i><span>取消</span></button>
                </div>
            </div>
            <details class="bakemono-memory-danger-zone">
                <summary>危险操作</summary>
                <button class="menu_button danger_button" data-bakemono-summary-action="delete"><i class="fa-solid fa-trash"></i><span>删除摘要</span></button>
            </details>
        `;
        wrapper.querySelector('.bakemono-summary-title').value = saved.summary.title || '';
        wrapper.querySelector('.bakemono-summary-content').value = saved.summary.content || '';
        wrapper.querySelector('.bakemono-memory-danger-zone').hidden = true;
        return wrapper;
    }

    function createFallbackPreview(block) {
        const details = documentRef.createElement('details');
        details.className = 'bakemono-memory-card';

        const summary = documentRef.createElement('summary');
        summary.textContent = getPreviewSummaryText(block);

        const body = documentRef.createElement('div');
        body.className = 'bakemono-memory-card-body';
        body.textContent = stripHtml(block.content).trim();

        details.append(summary, body, createSavedSummaryControls(block));
        return details;
    }

    function createBakemonoNotebook(block, index) {
        const text = getBlockPlainText(block.content);
        const meta = parsePreviewMeta(block);
        const tabs = getPreviewTabs(block.type).map(([label, section, modifier]) => ({
            label,
            modifier,
            content: extractSectionText(text, section),
        }));
        const hasSectionContent = tabs.some(tab => tab.content);
        if (!hasSectionContent) {
            return createFallbackPreview(block);
        }

        const outer = documentRef.createElement('details');
        outer.className = 'bk-notebook-outer bakemono-memory-notebook';

        const summary = documentRef.createElement('summary');
        summary.textContent = getPreviewSummaryText(block);

        const container = documentRef.createElement('div');
        container.className = 'bk-notebook-container';

        const header = documentRef.createElement('div');
        header.className = 'nh-wrap';
        header.append(
            createTextNodeElement('div', 'nh-chap-label', meta.label),
            createTextNodeElement('div', 'nh-title', meta.title),
            createTextNodeElement('div', 'nh-divider', ''),
            createTextNodeElement('div', 'nh-meta', [meta.meta, meta.submeta].filter(Boolean).join('\n')),
        );

        const layout = documentRef.createElement('div');
        layout.className = 'bk-tabs-layout';

        const nav = documentRef.createElement('nav');
        nav.className = 'bk-tabs-nav';
        nav.setAttribute('aria-label', '摘要分段');

        const content = documentRef.createElement('div');
        content.className = 'bk-tabs-content-wrapper';

        tabs.forEach((tab, tabIndex) => {
            const panelId = `bk-panel-${block.hash}-${index}-${tabIndex}`;
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = `bk-tab-label${tabIndex === 0 ? ' is-active' : ''}`;
            button.dataset.bakemonoPanel = panelId;
            button.textContent = tab.label;

            const panel = documentRef.createElement('div');
            panel.className = `bk-tab-panel${tabIndex === 0 ? ' is-active' : ''}`;
            panel.dataset.bakemonoPanel = panelId;

            const innerClass = ['bk-inner-text', tab.modifier].filter(Boolean).join(' ');
            panel.append(createTextNodeElement('div', innerClass, tab.content || '本段暂无内容。'));

            nav.append(button);
            content.append(panel);
        });

        layout.append(nav, content);
        container.append(header, layout, createSavedSummaryControls(block));
        outer.append(summary, container);
        return outer;
    }

    return {
        createBakemonoNotebook,
        createFallbackPreview,
        createSavedSummaryControls,
        extractSectionText,
        getBracketMetaLine,
        getPreferredSummaryTitle,
        getPreviewSummaryText,
        getPreviewTabs,
        parsePreviewLayout,
        parsePreviewMeta,
    };
}
