import { formatSourceRange, getSourceEnd, getSourceStart } from '../summary/source-metadata.js';

export function migrateStagePromptTimeSpan(prompt, fallback = '') {
    const migrated = String(prompt || fallback)
        .replace('★ 当前时间点：XXX ☆', '★ 时间跨度：XXX-XXX ☆')
        .replace('概括每章节内容，让后续可清晰了解之前章节具体发生过什么', '概括每章节内容（包括时间），让后续可清晰了解之前章节具体发生过什么');
    if (
        migrated.includes('详细提炼本阶段的“起、承、转、合”')
        || migrated.includes('最能定义本卷灵魂的三句台词')
    ) {
        return fallback;
    }
    return migrated;
}

export function migrateEpicPromptTimeSpan(prompt, fallback = '') {
    const migrated = String(prompt || fallback)
        .replace('★ 当前时间点：XXX ☆', '★ 时间跨度：XXX-XXX ☆')
        .replace('按时间顺序整理输入材料覆盖的核心事件，保留足够细节，避免只剩空泛主题', '按时间顺序整理输入材料覆盖的核心事件（标注时间），保留足够细节，避免只剩空泛主题');
    if (migrated.includes('[事件一名称]：……') || migrated.includes('[事件二名称]：……')) {
        return fallback;
    }
    return migrated;
}

export function migrateBuiltInStructuredPrompt(prompt, fallback, legacyMarkers) {
    const current = String(prompt || fallback);
    const markers = Array.isArray(legacyMarkers) ? legacyMarkers : [legacyMarkers];
    if (!markers.every(marker => current.includes(marker))) {
        return current;
    }
    const sections = current.split(/(?=^➤)/m).slice(1);
    const hasAllContinuations = sections.every(section => (
        section.split(/\r?\n/, 1)[0].includes('第四面墙') || /^……$/m.test(section)
    ));
    return hasAllContinuations ? current : fallback;
}

export function formatBlocksForPrompt(blocks, context = {}) {
    const header = [
        context.batchIndex ? `批次：${context.batchIndex} / ${context.batchTotal || '?'}` : '',
        context.sourceRange ? `覆盖楼层：${context.sourceRange}` : '',
        context.suggestedTitle ? `推荐标题：${context.suggestedTitle}` : '',
    ].filter(Boolean).join('\n');
    const body = blocks.map((block, index) => {
        const messageLabel = Number.isFinite(block.messageId) ? `message ${block.messageId}` : 'message unknown';
        return `--- #${index + 1} | ${messageLabel} | ${block.title} ---\n${block.content}`;
    }).join('\n\n');
    return [header, body].filter(Boolean).join('\n\n');
}

export function renderGenerationPrompt(template, blocks, context = {}) {
    const blockText = formatBlocksForPrompt(blocks, context);
    const prompt = String(template || '').trim();
    if (!prompt) {
        return blockText;
    }
    const hadBlocksPlaceholder = prompt.includes('{{blocks}}');
    const sourceStart = context.sourceStart ?? getSourceStart(blocks.map(block => block.messageId));
    const sourceEnd = context.sourceEnd ?? getSourceEnd(blocks.map(block => block.messageId));
    const replacements = {
        blocks: blockText,
        batchIndex: context.batchIndex ?? '',
        batchTotal: context.batchTotal ?? '',
        sourceRange: context.sourceRange || formatSourceRange(blocks.map(block => block.messageId)),
        startFloor: Number.isFinite(sourceStart) && sourceStart < Number.MAX_SAFE_INTEGER ? sourceStart : '未知',
        endFloor: Number.isFinite(sourceEnd) && sourceEnd < Number.MAX_SAFE_INTEGER ? sourceEnd : '未知',
        suggestedTitle: context.suggestedTitle || '',
    };
    let rendered = prompt;
    for (const [key, value] of Object.entries(replacements)) {
        rendered = rendered.replaceAll(`{{${key}}}`, String(value));
    }
    return hadBlocksPlaceholder ? rendered.trim() : `${rendered}\n\n${blockText}`.trim();
}

export function stripPostProcessNoise(text) {
    return String(text || '')
        .replace(/<tableThink>[\s\S]*?<\/tableThink>/gi, '')
        .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .trim();
}

export function getPromptStructureExcerpt(prompt = '') {
    const lines = String(prompt || '')
        .replaceAll('{{blocks}}', '')
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(line => line.trim());
    const structural = lines.filter(line => /^(?:➤|[-*]\s|\d+[.)]\s|#{1,3}\s|<summary>|【|……|\.\.\.)/.test(line.trim())
        || /(?:经过：|关键点：|角色进化录|时间线总览|剧情长焦)/.test(line));
    const selected = structural.length >= 4 ? structural : lines;
    return selected.slice(0, 14).join('\n') || '当前提示词没有可预览的结构。';
}
