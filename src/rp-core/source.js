export const NORMALIZATION_VERSION = 1;

export function evidenceHash(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntity(token) {
    const body = token.slice(1, -1);
    if (Object.hasOwn(entities, body)) return entities[body];
    const numeric = /^#(?:x[0-9a-f]+|[0-9]+)$/i.test(body);
    if (!numeric) return token;
    const number = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number) : token;
}

export function normalizeEvidenceText(value, { excludeTags = [], includeTags = [] } = {}) {
    const raw = String(value || '');
    const excluded = new Set(['script', 'style', ...excludeTags].map(tag => String(tag).toLowerCase()));
    const hidden = [];
    const included = new Set(includeTags.map(tag => String(tag).toLowerCase()));
    const inside = [];
    const units = [];
    const formatting = new Set();
    for (const match of raw.matchAll(/(\*\*|__|`)(\S[\s\S]*?\S|\S)\1/g)) {
        for (let i = 0; i < match[1].length; i++) {
            formatting.add(match.index + i);
            formatting.add(match.index + match[0].length - match[1].length + i);
        }
    }
    const tokenPattern = /<\/?[\p{L}][^>]*>|&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);|[\s\S]/gu;
    const append = (text, start, end) => {
        for (const char of text) {
            const normalized = /[“”]/u.test(char) ? '"' : /[‘’]/u.test(char) ? "'" : /\s/u.test(char) ? ' ' : char;
            if (normalized === ' ' && (!units.length || units.at(-1).char === ' ')) continue;
            for (let i = 0; i < normalized.length; i++) units.push({ char: normalized[i], start, end });
        }
    };
    for (const match of raw.matchAll(tokenPattern)) {
        const token = match[0], start = match.index, end = start + token.length;
        if (formatting.has(start)) continue;
        if (token[0] === '<' && /^<\/?[\p{L}]/u.test(token)) {
            const name = /^<\/?([^\s/>]+)/.exec(token)[1].toLowerCase();
            const closing = token.startsWith('</');
            if (included.has(name)) {
                if (closing) {
                    const index = inside.lastIndexOf(name);
                    if (index >= 0) inside.splice(index);
                } else if (!token.endsWith('/>')) inside.push(name);
            }
            if (excluded.has(name)) {
                if (closing) {
                    const index = hidden.lastIndexOf(name);
                    if (index >= 0) hidden.splice(index);
                } else if (!token.endsWith('/>')) hidden.push(name);
                continue;
            }
            if (!hidden.length && (!included.size || inside.length) && /^(p|div|br|li|h[1-6]|tr|section)$/.test(name)) append(' ', start, end);
            continue;
        }
        if (!hidden.length && (!included.size || inside.length)) append(token.startsWith('&') ? decodeEntity(token) : token, start, end);
    }
    while (units.at(-1)?.char === ' ') units.pop();
    return { text: units.map(unit => unit.char).join(''), spans: units.map(({ start, end }) => ({ start, end })) };
}

export function sourceSnapshot(raw, identity, options) {
    if (!identity?.messageId || !identity?.variantId) throw new Error('正文来源缺少稳定身份');
    const normalized = normalizeEvidenceText(raw, options);
    return { messageId: String(identity.messageId), variantId: String(identity.variantId),
        normalizationVersion: NORMALIZATION_VERSION, revision: evidenceHash(normalized.text), ...normalized };
}

export function locateEvidence(source, excerpt, hint = null) {
    if (source.supplements?.length) {
        const sources = [source, ...source.supplements];
        if (hint?.variantId) {
            const target = sources.find(item => item.variantId === hint.variantId && item.messageId === hint.messageId);
            return target ? locateEvidence({ ...target, supplements: null }, excerpt, hint) : { status: 'missing' };
        }
        const matches = sources.map(item => locateEvidence({ ...item, supplements: null }, excerpt));
        if (matches[0].status !== 'missing') return matches[0];
        const located = matches.filter(item => item.status === 'located');
        return located.length === 1 && !matches.some(item => item.status === 'ambiguous') ? located[0]
            : { status: located.length || matches.some(item => item.status === 'ambiguous') ? 'ambiguous' : 'missing' };
    }
    const needle = normalizeEvidenceText(excerpt).text;
    if (!needle) return { status: 'missing' };
    const matches = [];
    let at = source.text.indexOf(needle);
    while (at >= 0) {
        matches.push(at);
        at = source.text.indexOf(needle, at + 1);
    }
    const verifiedHint = Number.isSafeInteger(hint?.start) && hint?.end === hint.start + needle.length && matches.includes(hint.start);
    const start = verifiedHint ? hint.start : matches.length === 1 ? matches[0] : null;
    if (start === null) return { status: matches.length ? 'ambiguous' : 'missing', occurrences: matches.length };
    const end = start + needle.length;
    return { status: 'located', anchor: {
        messageId: source.messageId, variantId: source.variantId, revision: source.revision,
        normalizationVersion: source.normalizationVersion, start, end,
        rawStart: source.spans[start].start, rawEnd: source.spans[end - 1].end,
        spanHash: evidenceHash(needle), excerpt: String(excerpt),
        ...(source.sourceKind ? { sourceKind: source.sourceKind } : {}),
    } };
}

export function evidenceSource(source, anchor) {
    return [source, ...(source?.supplements || [])].find(item => item && item.messageId === anchor?.messageId && item.variantId === anchor?.variantId) || null;
}

export function sourceStamp(source) {
    return source?.supplements?.length ? source.revision + '|' + source.supplements.map(item => item.variantId + ':' + item.revision).join('|') : source?.revision;
}

export function locateEventEvidence(source, event) {
    if (event.source !== 'summary') return locateEvidence(source, event.excerpt, event.span);
    const matches = (source.supplements || []).map(item => locateEvidence(item, event.excerpt, event.span));
    const located = matches.filter(item => item.status === 'located');
    return located.length === 1 && !matches.some(item => item.status === 'ambiguous') ? located[0] : { status: located.length ? 'ambiguous' : 'missing' };
}

// A suggestion expands omissions into the actual contiguous source. It is not
// evidence until the user reviews and confirms that full excerpt.
export function suggestEvidenceRepair(source, excerpt) {
    const text = normalizeEvidenceText(excerpt).text;
    const parts = text.split(/\s*(?:…{2,}|\.{3,})\s*/u);
    if (parts.length < 2 || parts.length > 4 || parts.some(part => part.length < 6)) return null;
    let first = null, end = 0;
    for (const part of parts) {
        const start = source.text.indexOf(part);
        if (start < end || start < 0 || source.text.indexOf(part, start + 1) >= 0
            || (first !== null && start - end > 1000)) return null;
        first ??= start; end = start + part.length;
    }
    const full = source.text.slice(first, end);
    if (full.length > 6000 || locateEvidence(source, full).status !== 'located') return null;
    return { excerpt: full };
}
