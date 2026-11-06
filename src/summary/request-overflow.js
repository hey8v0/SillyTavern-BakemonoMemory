// A request longer than the model can read: each provider words the refusal its own way. These are the wordings seen
// from the APIs people use for summaries; a message that matches none goes on as it was.
const overflowPatterns = [
    /maximum context length/i, // OpenAI, DeepSeek, vLLM, OpenRouter, Ollama
    /context[ _-]?length/i, // context_length_exceeded
    /context (?:size|window)/i, // llama.cpp
    /prompt is too long/i, // Anthropic
    /input token count.{0,40}exceeds/i, // Gemini
    /too (?:large|long) for (?:the )?model/i, // Mistral
    /exceeded model token limit/i, // Kimi
    /range of input length/i, // DashScope (Qwen)
    /上下文.{0,8}(?:超|过长|限制|上限|不足|不够)/,
    /(?:超出|超过).{0,8}(?:上下文|最大长度|长度限制)/,
];

export function isContextOverflow(message) {
    const text = String(message || '');
    return overflowPatterns.some(pattern => pattern.test(text));
}

// What to change, by what the request was for: the panels' own words, so the user finds the switch.
const advice = {
    epic: '多次总结的材料太长，超过了模型一次能读的长度（上下文）。请在“总结”页重新点“生成多次总结”，在“生成几条”里选“分批”，每批少放几段阶段总结；也可以换一个上下文更长的模型。',
    stage: '阶段总结的材料太长，超过了模型一次能读的长度（上下文）。请在“总结”页重新点“生成阶段总结”，在“生成几章”里选“分批”，每批少放几条；也可以换一个上下文更长的模型。',
    story: '补写时一次发的楼层太长，超过了模型一次能读的长度（上下文）。请重新补写，把每批的楼层数调小；也可以换一个上下文更长的模型。',
};
const otherAdvice = '这次发给模型的内容太长，超过了模型一次能读的长度（上下文）。请减少一次处理的内容，或者换一个上下文更长的模型。';

// The failure as the user reads it: what to change, then what the provider said. A custom API failure carries the
// provider's words after its own advice (formatApiFailure), and only those are quoted, since that advice was generic.
export function explainContextOverflow(message, kind) {
    const text = String(message || '');
    if (!isContextOverflow(text)) return text;
    const marker = '接口原话：';
    const quoted = text.includes(marker) ? text.slice(text.lastIndexOf(marker) + marker.length) : text;
    const said = quoted.replace(/\s+/g, ' ').trim();
    return `${advice[kind] || otherAdvice}${text.includes(marker) ? marker : '原来的报错：'}${said.length > 240 ? `${said.slice(0, 240)}…` : said}`;
}
