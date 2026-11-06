/**
 * How long a 阶段总结 or 多次总结 should come out. Pure. Left to itself a summary keeps every detail the template asks for,
 * and every saved chapter goes out with each message. A share of the material, with a ceiling per kind, because a share
 * of a long chapter is still long; within that the words go by weight: what changed things is told whole, the rest is
 * brief. Appended after the prompt, so a prompt the user wrote gets it too.
 */
export const summaryLengthModes = Object.freeze({
    concise: { label: '精简', ratio: 1 / 5, stage: 800, epic: 1200, big: [60, 120], normal: [20, 40] },
    balanced: { label: '适中', ratio: 1 / 3, stage: 1500, epic: 2500, big: [100, 200], normal: [30, 60] },
    detailed: { label: '详细', ratio: 1 / 2, stage: 3000, epic: 5000, big: [150, 300], normal: [50, 100] },
});
export const defaultSummaryLength = 'balanced';

// Below this there is nothing to shorten.
const minMaterial = 300;

// The target in characters; 0 when no target applies (no such mode, or too little material).
export function summaryLengthChars(kind, materialChars, mode) {
    const spec = summaryLengthModes[mode];
    const material = Math.max(0, Number(materialChars) || 0);
    if (!spec || !spec[kind] || material < minMaterial) return 0;
    return Math.min(spec[kind], Math.max(100, Math.round(material * spec.ratio / 50) * 50));
}

export function summaryLengthNote(kind, materialChars, mode) {
    const chars = summaryLengthChars(kind, materialChars, mode);
    if (!chars) return '';
    const { big, normal } = summaryLengthModes[mode];
    return `【篇幅要求，优先于上面模板里“保留所有细节”一类的说法】
材料约 ${Number(materialChars).toLocaleString('en-US')} 字，这份总结写到 ${chars.toLocaleString('en-US')} 字以内。字数按事情的分量分配：
- 改变局面、关系或留下伏笔的大事：写完整，起因、经过、结果和人物反应，每件 ${big[0]} 到 ${big[1]} 字；
- 一般的事：${normal[0]} 到 ${normal[1]} 字，写清发生了什么和结果；
- 琐事：合并成一句，或者不写。
模板里哪一栏没有内容，就写一句话带过，不要凑字。`;
}

// How much material one summary request can carry, in characters. The model reads the prompt and writes the summary in
// one context window, and Chinese runs about a token a character, more with some tokenizers: the material gets 40% of
// the window. A window the plugin cannot read (a custom API) counts as 32k.
export function summaryMaterialBudget(contextTokens = 0) {
    const tokens = Number(contextTokens) > 0 ? Number(contextTokens) : 32768;
    return Math.max(4000, Math.min(60000, Math.round(tokens * 0.4)));
}
