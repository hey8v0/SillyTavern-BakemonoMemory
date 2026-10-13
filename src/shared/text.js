/**
 * Shared text helpers.
 *
 * Keep this module free of DOM, SillyTavern state, persistence and UI side
 * effects so the same transformations can be reused and verified in isolation.
 */

export function getHash(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function parseList(value) {
    return String(value || '')
        .split(/[,，\n]/)
        .map(item => item.trim())
        .filter(Boolean);
}

export function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeTagName(value) {
    const source = String(value || '').trim();
    const bracketed = source.match(/^<\/?\s*([^\s/>]+)/);
    if (bracketed?.[1]) {
        return bracketed[1].trim();
    }
    return source.replace(/^\/?/, '').replace(/\/?\s*>$/, '').trim();
}

// A tag rule may name a title after a colon: `details:章节摘要` is a <details> block whose own <summary> contains
// 章节摘要. Replies often hold several blocks of one tag (summary, options, feedback) that differ only in title.
export function parseTagRule(value) {
    const source = String(value || '').trim();
    const split = source.match(/^([^:：]+?)\s*[:：]\s*(.+)$/);
    const name = normalizeTagName(split ? split[1] : source);
    const title = split ? split[2].trim() : '';
    return { name, title, key: name && title ? `${name}:${title}` : name };
}

// The block's own title: the first <summary> inside it, without markup.
export function readBlockTitle(block) {
    const match = String(block || '').match(/<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i);
    return match ? match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
}

function titleMatches(block, title) {
    return !title || readBlockTitle(block).toLowerCase().includes(title.toLowerCase());
}

// `unpaired` also drops a leftover opening or closing tag, such as an HTML <img src="…"> that has no end tag.
export function stripConfiguredTags(text, tags, { unpaired = false } = {}) {
    let result = String(text || '');
    for (const tag of tags) {
        const { name: tagName, title } = parseTagRule(tag);
        if (!tagName) continue;
        const escapedTag = escapeRegExp(tagName);
        const paired = new RegExp(`<${escapedTag}(?=\\s|>)[^>]*>[\\s\\S]*?<\\/${escapedTag}\\s*>`, 'gi');
        // A titled rule removes only the blocks with that title; the other blocks of the tag stay whole.
        if (title) {
            result = result.replace(paired, block => titleMatches(block, title) ? '' : block);
            continue;
        }
        const selfClosing = new RegExp(`<${escapedTag}(?=\\s|/?>)[^>]*\\/\\s*>`, 'gi');
        result = result.replace(paired, '').replace(selfClosing, '');
        if (unpaired) result = result.replace(new RegExp(`<\\/?${escapedTag}(?=\\s|/?>)[^>]*>`, 'gi'), '');
    }
    return result;
}

export function extractConfiguredTagBlocks(text, tags) {
    const source = String(text || '');
    const blocks = [];
    tags.forEach(tag => {
        const { name: tagName, title, key } = parseTagRule(tag);
        if (!tagName) return;
        const escapedTag = escapeRegExp(tagName);
        const pattern = new RegExp(`<${escapedTag}(?=\\s|>)[^>]*>[\\s\\S]*?<\\/${escapedTag}\\s*>`, 'gi');
        const matches = (source.match(pattern) || []).filter(content => titleMatches(content, title));
        matches.forEach(content => {
            // The rule itself, so a later re-read (source checks) finds the same blocks in the same order.
            blocks.push({ content: content.trim(), matchedTag: key });
        });
    });
    return blocks.filter(block => block.content);
}

export function filterTextByConfiguredTags(text, options = {}) {
    const excludeTags = Array.isArray(options.excludeTags) ? options.excludeTags : [];
    const includeTags = Array.isArray(options.includeTags) ? options.includeTags : [];
    const stripped = stripConfiguredTags(text, excludeTags);
    if (!includeTags.length) {
        return stripped.trim();
    }
    return extractConfiguredTagBlocks(stripped, includeTags)
        .map(block => block.content)
        .filter(Boolean)
        .join('\n\n')
        .trim();
}

export function extractTaggedContent(text, tagName) {
    const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = String(text || '').match(pattern);
    return match ? match[1].trim() : '';
}

export function extractAllTaggedBlocks(text, tagName) {
    const pattern = new RegExp(`<${tagName}[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi');
    return String(text || '').match(pattern) || [];
}

export function removeExactTextBlock(text, block) {
    const source = String(text || '');
    const target = String(block || '');
    const index = source.indexOf(target);
    if (!target || index < 0) return null;
    const before = source.slice(0, index);
    let after = source.slice(index + target.length);
    if (/\r?\n$/.test(before) && /^\r?\n/.test(after)) after = after.replace(/^\r?\n/, '');
    return `${before}${after}`
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function stripTableEditTags(text) {
    return String(text || '')
        .replace(/<tableThink>[\s\S]*?<\/tableThink>/gi, '')
        .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
        .trim();
}

export function matchesAnyKeyword(text, keywords) {
    const source = String(text || '').toLowerCase();
    return keywords.some(keyword => source.includes(String(keyword).toLowerCase()));
}

export function normalizeSearchText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[：:：]/g, ':')
        .trim();
}

export function countKeywordHits(text, keywords = []) {
    const source = String(text || '').toLowerCase();
    return keywords.reduce((count, keyword) => {
        const needle = String(keyword || '').trim().toLowerCase();
        return needle && source.includes(needle) ? count + 1 : count;
    }, 0);
}
