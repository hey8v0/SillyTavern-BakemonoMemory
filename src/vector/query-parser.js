function unique(values) {
    return [...new Set(values)];
}

export function parseVectorQueryRewritePayload(raw) {
    const source = String(raw || '')
        .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
        .replace(/<analysis\b[^>]*>[\s\S]*?<\/analysis>/gi, '')
        .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/```(?:json|text)?/gi, '')
        .replace(/```/g, '')
        .trim();
    if (!source) {
        return { intent: '', queries: [] };
    }
    const linePayload = parseVectorQueryRewriteLines(source);
    if (linePayload.queries.length || linePayload.intent) {
        return linePayload;
    }
    const jsonMatch = source.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    try {
        const parsed = JSON.parse((jsonMatch?.[1] || source).trim());
        if (Array.isArray(parsed)) {
            return { intent: '', queries: normalizeVectorRewriteQueries(parsed) };
        }
        if (Array.isArray(parsed?.queries)) {
            return {
                intent: normalizeVectorRewriteIntent(parsed.intent || parsed.searchIntent || parsed.goal || ''),
                queries: normalizeVectorRewriteQueries(parsed.queries),
            };
        }
        if (Array.isArray(parsed?.query)) {
            return {
                intent: normalizeVectorRewriteIntent(parsed.intent || parsed.searchIntent || parsed.goal || ''),
                queries: normalizeVectorRewriteQueries(parsed.query),
            };
        }
        if (typeof parsed?.query === 'string') {
            return {
                intent: normalizeVectorRewriteIntent(parsed.intent || parsed.searchIntent || parsed.goal || ''),
                queries: normalizeVectorRewriteQueries([parsed.query]),
            };
        }
    } catch {
        // The rewrite prompt allows plain line output; JSON is only a convenience.
    }
    return {
        intent: '',
        queries: normalizeVectorRewriteQueries(source
            .split(/\r?\n/)
            .map(line => line
                .replace(/^\s*(?:[-*]|\d+[.)、]|[（(]?\d+[）)])\s*/, '')
                .replace(/^\s*(?:query|查询|检索句|关键词|线索)\s*[:：]\s*/i, '')
                .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
                .trim())
            .filter(Boolean)),
    };
}

export function parseVectorQueryRewriteLines(source) {
    const lines = String(source || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    let intent = '';
    const queries = [];
    for (const line of lines) {
        const intentMatch = line.match(/^\s*INTENT\s*[:：]\s*(.+)$/i);
        if (intentMatch) {
            intent = normalizeVectorRewriteIntent(intentMatch[1]);
            continue;
        }
        const queryMatch = line.match(/^\s*Q\s*([1-5])\s*[:：]\s*(.+)$/i);
        if (queryMatch) {
            const query = normalizeVectorRewriteQueryItem(queryMatch[2]);
            if (query) {
                queries.push(query);
            }
        }
    }
    return { intent, queries: unique(queries) };
}

export function parseVectorQueryRewriteResult(raw) {
    return parseVectorQueryRewritePayload(raw).queries;
}

export function normalizeVectorRewriteIntent(item) {
    const text = normalizeVectorRewriteQueryItem(item);
    if (!text || isVectorRewriteInstructionLine(text)) {
        return '';
    }
    return text.slice(0, 220);
}

export function normalizeVectorRewriteQueries(items = []) {
    return items
        .map(item => normalizeVectorRewriteQueryItem(item))
        .filter(Boolean)
        .filter(item => !isVectorRewriteInstructionLine(item));
}

export function normalizeVectorRewriteQueryItem(item) {
    let text = String(item || '').trim();
    if (!text) {
        return '';
    }
    text = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !isVectorRewriteInstructionLine(line))
        .join(' ')
        .replace(/^\s*(?:INTENT|Q\s*[1-5])\s*[:：]\s*/i, '')
        .replace(/^\s*(?:Q\s*)?\d+\s*[.)、:：-]\s*/i, '')
        .replace(/^\s*(?:clue|query)\s*\d+\s*(?:\([^)]*\))?\s*[:：*-]?\s*/i, '')
        .replace(/^\s*(?:[-*]|\d+[.)、]|[（(]?\d+[）)])\s*/, '')
        .replace(/^\s*(?:query|查询|检索句|关键词|线索)\s*[:：]\s*/i, '')
        .replace(/^[\s*_`#>]+|[\s*_`#>]+$/g, '')
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
        .trim();
    if (!hasVectorRewriteQueryLanguage(text) || isVectorRewriteInstructionLine(text)) {
        return '';
    }
    return text;
}

export function hasVectorRewriteQueryLanguage(text) {
    const value = String(text || '');
    const cjkCount = (value.match(/[\u3400-\u9fff\u3040-\u30ff]/g) || []).length;
    if (cjkCount < 4) {
        return false;
    }
    const latinCount = (value.match(/[A-Za-z]/g) || []).length;
    if (latinCount && cjkCount / Math.max(1, cjkCount + latinCount) < 0.32) {
        return false;
    }
    return true;
}

export function isVectorRewriteInstructionLine(text) {
    const value = String(text || '').trim();
    if (!value) {
        return true;
    }
    if (value.length < 4) {
        return true;
    }
    return /^(?:thinking\s*process|analy[sz]e\s+the\s+request|role\s*:|task\s*:|constraints?\s*:|requirements?\s*:|output\s*:|only\s+output|do\s+not|system\s*:|assistant\s*:|user\s*:|recent\s+plot|search\s+queries?|queries?\s*:|intent\s*:|intent[`'"]?\s+and\s+[`'"]?queries|keep\s+only\s+facts|one\s+query\s+per\s+line|no\s+explanations?|language\s*:|convert\s+recent\s+plot|clue\s*\d+|query\s*\d+)/i.test(value)
        || /^(?:以下|输出|检索|要求|约束|任务|角色|输入|目标|规则|格式|最近剧情|当前剧情|检索意图)(?:[:：\s]|$)/.test(value)
        || /(?:only\s+return|return\s+json|json\s+array|json\s+object|do\s+not\s+output|must\s+be\s+in\s+chinese|must\s+be\s+specific|specific\s+questions?|searching\s+old\s+plot|focus\s+on\s+what\s+old\s+memories|current\s+context|determine\s+the\s+retrieval|retrieval\s+intent|pain\s+connection|the\s+text\s+mentions|the\s+current\s+scene|old\s+memories\s+need\s+to\s+be\s+recalled|characters,\s*relationships,\s*locations|unresolved\s+foreshadowing|不要解释|不要输出步骤|不要输出分析|每行一条|只返回|只输出|必须使用中文|输出必须|只能包含|不要把最近剧情)/i.test(value)
        || /^\*\*(?:analy[sz]e|role|task|constraints?|output|thinking|goal|input)[\s\S]*\*\*$/i.test(value)
        || /^(?:input|goal|analy[sz]e|chapter\s*\d+|recent\s+plot\s+chapters|current\s+context|determine\s+the\s+retrieval|the\s+current\s+scene)\b/i.test(value);
}

export function extractChatCompletionText(data) {
    const choice = data?.choices?.[0] || {};
    const message = choice.message || {};
    const content = message.content ?? choice.text ?? data?.output_text ?? '';
    if (Array.isArray(content)) {
        return content.map(part => {
            if (typeof part === 'string') {
                return part;
            }
            return part?.text || part?.content || '';
        }).join('\n').trim();
    }
    const text = String(content || '').trim();
    if (text) {
        return text;
    }
    return String(message.reasoning_content || message.reasoning || choice.reasoning_content || '').trim();
}
