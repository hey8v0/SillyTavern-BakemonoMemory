const labels = {
    rewrite: '查询改写', story: '单独摘要／补写', stage: '阶段总结', epic: '多次总结',
    facts: '整理事实', embedding: 'Embedding',
};

export function createRequestCounts() {
    const chats = new WeakMap();
    function counts(state) {
        if (!chats.has(state)) chats.set(state, { total: 0, round: null, before: {} });
        return chats.get(state);
    }
    function begin(state, type = 'normal') {
        if (['normal', 'regenerate', 'swipe', 'continue', 'impersonate', ''].includes(type)) counts(state).round = {};
    }
    function record(state, kind) {
        const chat = counts(state);
        const group = chat.round ?? chat.before;
        group[kind] = (group[kind] || 0) + 1;
        chat.total++;
    }
    function describe(state) {
        const chat = counts(state);
        const items = Object.entries(chat.round ?? chat.before).map(([kind, n]) => (labels[kind] || '其他生成') + ' ' + n + ' 次');
        const period = chat.round ? '自本轮发送起' : '首次发送前';
        return '剪辑台额外请求 · ' + period + '：' + (items.join('、') || '0 次') + '。当前聊天本页累计 ' + chat.total + ' 次（含重试）。';
    }
    return { begin, record, describe };
}
