export function inspectSummaryMaterials(blocks = []) {
    const invalid = [];
    let textLength = 0;
    for (const [index, block] of blocks.entries()) {
        const raw = String(block?.content || '');
        let text = raw.replace(/<(script|style|thinking|think|reasoning|analysis)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
        if (/<details\b/i.test(text)) text = text.replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi, '');
        text = text.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160|#xA0);/gi, ' ').trim();
        const meaningful = text.replace(/[\s\p{P}\p{S}]/gu, '');
        if (!meaningful || /^(?:剧情摘要|摘要|阶段总结|总结|剧集终了点击回看|输出推理过程|推理过程|思考过程|thinking|analysis|reasoning)$/i.test(meaningful)) {
            const floor = Number.isFinite(block?.messageId) && block.messageId < Number.MAX_SAFE_INTEGER ? '第 ' + block.messageId + ' 楼' : '第 ' + (index + 1) + ' 条材料';
            invalid.push(floor + (block.matchedTag ? ' <' + block.matchedTag + '>' : ''));
        } else textLength += text.length;
    }
    return { count: blocks.length, textLength, invalid };
}
