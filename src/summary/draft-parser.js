import { extractTaggedContent } from '../shared/text.js';

export function parseMissingSummaryBatchResult(result, task, normalizeContent = value => value) {
    const text = String(result || '')
        .replace(/<think(?:ing)?[\s>][\s\S]*?<\/think(?:ing)?>/gi, '')
        .trim();
    const segments = text.split(/={2,}\s*(?:楼层|消息|message|floor)\s*#?\s*(\d+)\s*={2,}/gi);
    const parsed = [];
    const expected = new Map((task.metadata?.missingTargets || []).map(target => [Number(target.messageId), target]));

    if (segments.length > 1) {
        for (let index = 1; index < segments.length; index += 2) {
            const messageId = Number(segments[index]);
            const target = expected.get(messageId);
            const rawContent = String(segments[index + 1] || '').trim();
            if (!target || !rawContent) {
                continue;
            }
            const legacyContent = extractTaggedContent(rawContent, 'summaryDraft');
            parsed.push({ target, content: normalizeContent(legacyContent || rawContent) });
        }
    }

    if (!parsed.length && expected.size === 1 && text) {
        const [target] = expected.values();
        const legacyContent = extractTaggedContent(text, 'summaryDraft');
        parsed.push({ target, content: normalizeContent(legacyContent || text) });
    }

    return parsed;
}
