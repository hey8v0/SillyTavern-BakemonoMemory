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

export function stripConfiguredTags(text, tags) {
    let result = String(text || '');
    for (const tag of tags) {
        const escapedTag = escapeRegExp(tag);
        const pattern = new RegExp(`<${escapedTag}\\b[^>]*>[\\s\\S]*?<\\/${escapedTag}>`, 'gi');
        result = result.replace(pattern, '');
    }
    return result;
}

export function extractConfiguredTagBlocks(text, tags) {
    const source = String(text || '');
    const blocks = [];
    tags.forEach(tag => {
        const escapedTag = escapeRegExp(tag);
        const pattern = new RegExp(`<${escapedTag}\\b[^>]*>[\\s\\S]*?<\\/${escapedTag}>`, 'gi');
        const matches = source.match(pattern) || [];
        matches.forEach(content => {
            blocks.push({ content: content.trim(), matchedTag: tag });
        });
    });
    return blocks.filter(block => block.content);
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
