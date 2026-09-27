import {getSummaryStatus, resolveSummaryGraph, summarySourceFloors} from '../memory/summary-provenance.js';

const sectionLine = /^\s*➤.*?【([^】]+)】/;
const genericTitles = new Set(['剧情摘要', '📋 剧情摘要', '正文摘要', '剧集终了·点击回看', '多次总结·长期总览', '纪元回溯·史诗简史']);

// Split a summary the way the prompts ask the model to write it: a 【…】 header line, then “➤ … 【段名】” sections.
export function splitSummarySections(text) {
    const intro = [], sections = [];
    for (const line of String(text || '').split('\n')) {
        const match = line.match(sectionLine);
        if (match) { sections.push({ name: match[1].trim(), lines: [] }); continue; }
        if (!line.trim()) continue;
        (sections.length ? sections.at(-1).lines : intro).push(line);
    }
    return { intro, sections };
}

// 【☆『第4章：北境地图』★时间：深夜★铁匠铺|旅人、格伦☆】 → { title: '第4章：北境地图', bits: ['时间：深夜', '铁匠铺|旅人、格伦'] }
export function parseSummaryHeader(line) {
    const text = String(line || '').trim();
    const title = (text.match(/『([^』]+)』/) || [, ''])[1].trim();
    const rest = text.replace(/^【[^『]*『[^』]*』/, '').replace(/^【/, '').replace(/[☆】\s]+$/, '');
    return { title, bits: rest.split('★').map(bit => bit.replace(/^[☆\s]+|[☆\s]+$/g, '')).filter(Boolean) };
}

// What a section is about, from its name, so each kind can be laid out and coloured its own way.
export function summarySectionKind(name) {
    const text = String(name || '');
    if (/收音|对话|台词|语录|原话/.test(text)) return 'voice';
    if (/副镜|监视器|平行|别处|其他地点/.test(text)) return 'elsewhere';
    if (/暗线|伏笔|未解|线索|谜|悬念/.test(text)) return 'threads';
    if (/第四面墙|隐藏|笔记|读者/.test(text)) return 'wall';
    if (/角色|人物|进化|关系/.test(text)) return 'people';
    if (/场记|长焦|锚点|事件|经过|概要|剧情|发生/.test(text)) return 'events';
    return 'plain';
}

const looseMetaKeys = /^(时间|时间跨度|地点|场景|位置|人物|角色|出场人物|出场角色|在场人物|在场)$/;
const cleanMarkdown = text => String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').trim();

// Summaries written in another format (other tags, other prompts): read the common shapes instead of one block.
// 【…】 / # heading / a bold line → title or section; 时间/地点/人物：… → the header; “名称：内容” → a labelled line
// (or its own section when the name says what it is, like 对话 or 伏笔); a quoted line → a quote.
export function readLooseSummary(text) {
    const header = { title: '', bits: [] }, meta = {}, intro = [], sections = [];
    const push = line => (sections.length ? sections.at(-1).lines : intro).push(line);
    for (const raw of String(text || '').split('\n')) {
        const line = raw.trim();
        if (!line || /^[-=*_]{3,}$/.test(line) || /^[📋\s]*(剧情摘要|正文摘要|摘要)$/.test(line)) continue;
        let match;
        const heading = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^\*\*([^*]{1,40})\*\*[：:]?$/) || line.match(/^【([^】]{1,40})】$/);
        if (heading) {
            const name = cleanMarkdown(heading[1]).replace(/^[📋\s]+/, '');
            if (!header.title && !sections.length && !intro.length && !/^(剧情摘要|正文摘要|摘要)$/.test(name)) header.title = name;
            else if (!/^(剧情摘要|正文摘要|摘要)$/.test(name)) sections.push({ name, lines: [] });
            continue;
        }
        if ((match = cleanMarkdown(line.replace(/^[-*•]\s+/, '')).match(/^([^：:，,。“”"\s]{1,8})[：:]\s*(.*)$/))) {
            const [, key, value] = match;
            if (looseMetaKeys.test(key) && value) { meta[key] = value; continue; }
            if (!value) { sections.push({ name: key, lines: [] }); continue; }
            if (summarySectionKind(key) !== 'plain' && summarySectionKind(key) !== 'events') {
                sections.push({ name: key, lines: [] });
                push(/^[“"「]/.test(value) ? `> ${value}` : value);
                continue;
            }
            push(`[${key}]：${value}`);
            continue;
        }
        if ((match = line.match(/^([“"「].+[”"」])\s*(?:[—-]{1,2}\s*(.+))?$/))) {
            push(match[2] ? `> ${match[1]} —— [${match[2].replace(/^[\[【]|[\]】]$/g, '')}]` : `> ${match[1]}`);
            continue;
        }
        push(cleanMarkdown(line));
    }
    const time = meta['时间'] || meta['时间跨度'];
    const place = meta['地点'] || meta['场景'] || meta['位置'];
    const people = meta['人物'] || meta['角色'] || meta['出场人物'] || meta['出场角色'] || meta['在场人物'] || meta['在场'];
    if (time) header.bits.push(`时间：${time}`);
    if (place || people) header.bits.push(`${place || ''}${people ? `|${people}` : ''}`);
    return { header, intro, sections };
}

// One line of summary text → the kind of line it is. Leading marks decide: “-” list, “>” quote, “[名]：” label, “*…*” aside.
export function classifySummaryLine(raw, inEvent = false) {
    const text = String(raw || '').trim();
    let match;
    if ((match = text.match(/^(?:\d+[.、]\s*)?>\s*(.+?)\s*(?:——|--|—)\s*[[【](.+?)[\]】]$/))) return { kind: 'quote', text: match[1], who: match[2] };
    if ((match = text.match(/^(?:\d+[.、]\s*)?>\s*(.+)$/))) return { kind: 'quote', text: match[1], who: '' };
    if ((match = text.match(/^[-*•]\s*\[([^\]]+)\]\s*[(（]([^)）]+)[)）]$/))) return { kind: 'event', text: match[1], meta: match[2] };
    if (inEvent && /^\s{2,}[-*•]/.test(raw) && (match = text.match(/^[-*•]\s*([^：:]{1,6})[：:]\s*(.+)$/))) return { kind: 'detail', key: match[1], text: match[2] };
    if ((match = text.match(/^[-*•]?\s*\[([^\]]+)\][：:]\s*(.+)$/)) || (match = text.match(/^[*•]\s*([^：:*]{1,8})[：:]\s*(.+)$/))) return { kind: 'label', key: match[1], text: match[2] };
    if ((match = text.match(/^\*(.+)\*$/))) return { kind: 'aside', text: match[1] };
    if ((match = text.match(/^(?:[-*•]|\d+[.、])\s*(.+)$/))) return { kind: 'item', text: match[1] };
    return { kind: 'text', text };
}

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
        return parsePreviewLayout(state.previewLayouts?.[layoutKey] || defaultPreviewLayouts[layoutKey]);
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

    const element = (tagName, className, text) => {
        const node = documentRef.createElement(tagName);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const plain = text => stripHtml(String(text || '')).trim();

    // The short name of a section comes from the 预览分段 setting (label|section|style), else the section's own name.
    function shortSectionName(type, name) {
        const tab = getPreviewTabs(type).find(([, section]) => section.split(/[，,]/).map(item => item.trim()).filter(Boolean).some(item => name.includes(item)));
        return tab ? tab[0] : name;
    }

    function summaryParts(block) {
        const text = getBlockPlainText(block.content);
        const { intro, sections } = splitSummarySections(text);
        const header = parseSummaryHeader(getBracketMetaLine(text));
        if (!sections.length && !header.title) {
            const loose = readLooseSummary(text);
            return { text, header: loose.header, sections: loose.sections, introLines: loose.intro, loose: true };
        }
        const introLines = intro.filter(line => !/^【[\s\S]+】$/.test(line.trim()));
        return { text, header, sections, introLines };
    }

    // “第4章：北境地图” → “第 4 章 · 北境地图”
    const chapterTitle = title => String(title || '').replace(/^第\s*([^章卷：:]+?)\s*([章卷])\s*[：:]\s*/, '第 $1 $2 · ').trim();

    function displayTitle(block, parts = summaryParts(block)) {
        const preferred = getPreferredSummaryTitle(block);
        if (preferred) return preferred;
        const headerTitle = parts.header.title.replace(/^(长期总览|正文摘要)\s*[：:]\s*/, '');
        if (headerTitle && !genericTitles.has(headerTitle)) return block.type === blockTypes.STORY ? headerTitle.replace(/^第\s*[^章：:]+章\s*[：:]\s*/, '') : chapterTitle(headerTitle);
        const title = String(block.title || '').replace(/[📋【】]/g, '').trim();
        // A scanned block's own title can be just its position (“#3.1”); that is not a name.
        return title && !genericTitles.has(title) && !/^#?\d+(\.\d+)?$/.test(title) ? title : '';
    }

    function firstBeat(parts) {
        const lines = parts.sections[0]?.lines || parts.introLines;
        const detail = lines.map(line => classifySummaryLine(line, true)).find(line => line.kind === 'detail');
        const first = detail || lines.map(line => classifySummaryLine(line)).find(line => line.text && !/^无[。.]?$/.test(line.text));
        return plain(first?.text || parts.text.split('\n').find(line => line.trim() && !/^【/.test(line.trim())) || '');
    }

    function floorRange(block) {
        const floors = summarySourceFloors(getState(), block);
        if (!floors.length) {
            const own = Number(block.messageId);
            return Number.isFinite(own) && own < Number.MAX_SAFE_INTEGER ? { first: own, text: `第 ${own} 楼` } : { first: null, text: '' };
        }
        const [first, last] = [floors[0], floors.at(-1)];
        return { first, text: first === last ? `第 ${first} 楼` : `第 ${first}–${last} 楼` };
    }

    // Which upper summaries include this one, by their readable names.
    function coverage(block) {
        const state = getState();
        const graph = resolveSummaryGraph(state);
        const status = getSummaryStatus(state, block, graph);
        const parents = status.coveredBy.map(key => graph.byKey.get(key)).filter(Boolean);
        return { status, parents: parents.map(node => ({ key: node.key, name: displayTitle(node) || (node.type === 'epic' ? '多次总结' : '阶段总结') })) };
    }

    function getSummaryGroup(block) {
        const parent = coverage(block).parents[0];
        return parent ? { key: parent.key, name: parent.name, pending: false } : { key: 'pending', name: '待整理', pending: true };
    }

    function renderLines(type, lines, kind = 'plain') {
        const body = element('div', 'bk-sum-sec-body');
        if (lines.length === 1 && /^无[。.]?$/.test(lines[0].trim())) {
            body.append(element('p', 'bk-sum-none', '无'));
            return body;
        }
        let list = null, event = null;
        for (const raw of lines) {
            const line = classifySummaryLine(raw, !!event);
            if (line.kind === 'detail' && event) {
                const row = element('p', 'bk-sum-kv');
                row.append(element('span', 'bk-sum-k', line.key), plain(line.text));
                event.append(row);
                continue;
            }
            if (line.kind !== 'item') list = null;
            if (line.kind !== 'detail') event = null;
            if (line.kind === 'item') {
                // Events read as numbered beats; other lists keep their dashes.
                if (!list) body.append(list = element(kind === 'events' ? 'ol' : 'ul'));
                list.append(element('li', '', plain(line.text)));
            } else if (line.kind === 'quote') {
                const quote = element('blockquote', 'bk-sum-quote', plain(line.text));
                if (line.who) quote.append(element('cite', '', line.who));
                body.append(quote);
            } else if (line.kind === 'event') {
                event = element('div', 'bk-sum-event');
                const head = element('div', 'bk-sum-event-h', plain(line.text));
                head.append(element('small', '', line.meta));
                event.append(head);
                body.append(event);
            } else if (line.kind === 'label' && kind === 'threads') {
                // A thread: ○ still open, ● resolved; the label becomes a small caption under it. “无” rows say nothing.
                if (/^无[。.]?$/.test(line.text.trim())) continue;
                const key = line.key.replace(/^✅\s*/, '');
                const done = key !== line.key || (!/^未/.test(key) && /回收|解决|揭晓/.test(key));
                const row = element('p', `bk-sum-thread${done ? ' is-done' : ''}`);
                const text = element('span', '', plain(line.text));
                text.append(element('small', '', key));
                row.append(element('i', '', done ? '●' : '○'), text);
                body.append(row);
            } else if (line.kind === 'label') {
                const row = element('p', 'bk-sum-kv');
                const key = line.key.replace(/^✅\s*/, '');
                row.append(element('span', `bk-sum-k${key !== line.key || /^(本回合|已)回收/.test(key) ? ' is-done' : ''}`, key), plain(line.text));
                body.append(row);
            } else if (line.kind === 'aside') {
                body.append(element('p', 'bk-sum-aside', plain(line.text)));
            } else if (kind === 'threads' && line.text && !/^无[。.]?$/.test(line.text)) {
                const row = element('p', 'bk-sum-thread');
                row.append(element('i', '', '○'), element('span', '', plain(line.text)));
                body.append(row);
            } else {
                body.append(element('p', '', plain(line.text)));
            }
        }
        return body;
    }

    function renderDocument(block, parts) {
        const doc = element('div', 'bk-sum-doc');
        const sections = parts.sections.length ? parts.sections : [{ name: '', lines: parts.introLines.length ? parts.introLines : parts.text.split('\n').filter(Boolean) }];
        if (parts.sections.length && parts.introLines.length) sections.unshift({ name: '', lines: parts.introLines });
        for (const section of sections) {
            const kind = section.name ? summarySectionKind(section.name) : 'plain';
            const row = element('div', `bk-sum-sec is-${kind}`);
            row.append(element('span', 'bk-sum-sec-label', section.name ? shortSectionName(block.type, section.name) : ''), renderLines(block.type, section.lines, kind));
            doc.append(row);
        }
        return doc;
    }

    // The editor is only offered for summaries the plugin saved; tags in chat text are edited in the chat itself.
    function createEditor(block) {
        const saved = findSavedSummaryByHash(block.hash);
        if (!saved) return null;
        const tools = element('div', 'bakemono-memory-summary-tools bk-sum-editor');
        tools.dataset.summaryHash = block.hash;
        tools.hidden = true;
        tools.innerHTML = `
            <label class="bk-sum-field"><span>标题</span><input class="text_pole bakemono-summary-title" type="text"></label>
            <label class="bk-sum-field"><span>原文</span><textarea class="text_pole bakemono-summary-content" rows="14" spellcheck="false"></textarea></label>
            <div class="bk-sum-editor-actions">
                <button type="button" class="menu_button bk-sum-primary" data-bakemono-summary-action="save">保存</button>
                <button type="button" class="bk-sum-link" data-bakemono-summary-action="cancel">取消</button>
            </div>`;
        tools.querySelector('.bakemono-summary-title').value = saved.summary.title || '';
        tools.querySelector('.bakemono-summary-content').value = saved.summary.content || '';
        return tools;
    }

    function toggleButton(label, className = 'bk-sum-link') {
        const button = element('button', className, label);
        button.type = 'button';
        button.dataset.bakemonoSummaryToggle = '';
        return button;
    }

    function menuButton(name) {
        const button = element('button', 'bk-sum-dots', '⋯');
        button.type = 'button';
        button.dataset.bakemonoSummaryMenu = '';
        button.setAttribute('aria-label', `${name} 的操作`);
        return button;
    }

    function createBakemonoNotebook(block, index, open = false) {
        const parts = summaryParts(block);
        const isStory = block.type === blockTypes.STORY || !block.type;
        const range = floorRange(block);
        const { status, parents } = coverage(block);
        const title = displayTitle(block, parts) || (isStory ? firstBeat(parts).slice(0, 24) : getPreviewSummaryText(block));
        const name = isStory ? `第 ${range.first ?? '?'} 楼的剧情摘要` : title;

        const item = element(isStory ? 'div' : 'section', isStory ? 'bk-sum-story' : 'bk-sum-chapter');
        Object.assign(item.dataset, { summaryHash: block.hash || '', summaryType: block.type || 'story', summaryName: name, summaryRange: range.text, summaryFloor: range.first ?? '' });
        if (!status.valid) item.classList.add('is-stale');

        const head = element('div', isStory ? 'bk-sum-story-h' : 'bk-sum-chapter-h');
        const tap = toggleButton('', isStory ? 'bk-sum-story-tap' : 'bk-sum-head');
        tap.textContent = '';
        if (isStory) {
            const line1 = element('span', 'bk-sum-line1');
            // Time and place in the quiet colour, the people after “|” in the people colour.
            const where = element('span', 'bk-sum-where');
            parts.header.bits
                .map(bit => bit.replace(/^(时间跨度|时间|跨度|楼层|来源)[：:]\s*/, '').trim())
                .filter(bit => bit && !/^(未知|楼层\s*\d|第\s*\d+)/.test(bit))
                .forEach(bit => {
                    const [place, people] = bit.split('|');
                    if (where.childElementCount) where.append(' · ');
                    if (place?.trim()) where.append(element('span', '', place.trim()));
                    if (people?.trim()) {
                        if (place?.trim()) where.append(' · ');
                        where.append(element('span', 'bk-sum-people', people.trim()));
                    }
                });
            const tag = !status.valid ? ['需重建', ' is-alert'] : parents.length ? ['已收入', ''] : ['待整理', ' is-new'];
            line1.append(element('span', 'bk-sum-no', range.first !== null ? `#${range.first}` : '#?'), where, element('span', `bk-sum-tag${tag[1]}`, tag[0]));
            if (!status.valid) line1.lastChild.title = status.reason;
            tap.append(line1, element('span', 'bk-sum-ttl', title), element('span', 'bk-sum-lead', firstBeat(parts)));
        } else {
            const meta = element('span', 'bk-sum-meta');
            const time = parts.header.bits.map(bit => bit.match(/^(?:时间跨度|当前时间点)[：:]\s*(.+)$/)?.[1]).find(Boolean);
            const count = block.type === blockTypes.EPIC
                ? (block.sourceStageHashes?.length ? `收录 ${block.sourceStageHashes.length} 章` : '')
                : (block.sourceHashes?.length ? `收录 ${block.sourceHashes.length} 条摘要` : '');
            [range.text, count, time].filter(Boolean).forEach(text => meta.append(element('span', '', text)));
            if (parents.length) {
                const into = element('span', '', '已收进 ');
                into.append(element('b', '', parents.map(parent => parent.name).join('、')));
                meta.append(into);
            }
            if (!status.valid) meta.append(element('span', 'is-alert', '需重建：' + status.reason));
            tap.append(element('h4', '', title), meta);
        }
        head.append(tap, menuButton(name));

        const preview = element('div', 'bk-sum-preview');
        if (!isStory) preview.append(element('p', 'bk-sum-clamp', firstBeat(parts)), toggleButton('展开全文 ›'));
        const full = element('div', 'bk-sum-full');
        full.append(renderDocument(block, parts), toggleButton('收起 ↑', 'bk-sum-link bk-sum-fold'));
        const editor = createEditor(block);

        item.append(head, preview, full);
        if (editor) item.append(editor);
        setSummaryOpen(item, open);
        return item;
    }

    // For pages that show summary text outside the summary list (待确认): a readable title, the first beat, the document.
    function describeSummary(block) {
        const parts = summaryParts(block);
        return { title: displayTitle(block, parts), lead: firstBeat(parts) };
    }

    function createSummaryDocument(block) {
        return renderDocument(block, summaryParts(block));
    }

    function setSummaryOpen(item, open) {
        item.classList.toggle('is-open', !!open);
        item.querySelectorAll(':scope > .bk-sum-story-h [data-bakemono-summary-toggle], :scope > .bk-sum-chapter-h [data-bakemono-summary-toggle]')
            .forEach(button => button.setAttribute('aria-expanded', String(!!open)));
        const menu = item.querySelector(':scope > * > [data-bakemono-summary-menu]');
        if (menu) menu.hidden = !open;
        const preview = item.querySelector(':scope > .bk-sum-preview');
        if (preview) preview.hidden = !!open || !preview.childElementCount;
        const full = item.querySelector(':scope > .bk-sum-full');
        if (full) full.hidden = !open;
        if (!open) {
            item.classList.remove('is-editing');
            const editor = item.querySelector(':scope > .bk-sum-editor');
            if (editor) editor.hidden = true;
        }
    }

    return {
        createBakemonoNotebook,
        createSummaryDocument,
        describeSummary,
        extractSectionText,
        getBracketMetaLine,
        getPreferredSummaryTitle,
        getPreviewSummaryText,
        getPreviewTabs,
        getSummaryGroup,
        parsePreviewLayout,
        parsePreviewMeta,
        setSummaryOpen,
    };
}
