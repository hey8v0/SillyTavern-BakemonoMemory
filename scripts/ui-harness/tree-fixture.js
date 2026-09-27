// Harness helper: adds three chapters and one volume on top of the ?sum chat; chapter 2 has a changed source.
export async function addTree({ staleChapter = true } = {}) {
    const base = '/scripts/extensions/third-party/BakemonoMemory/src/';
    const { getHash } = await import(base + 'shared/text.js');
    const m = await import('/script.js');
    const st = m.chat_metadata.bakemonoMemory;
    const story = st.blocks.filter(b => b.type === 'story').sort((a, b) => a.messageId - b.messageId);
    const stageText = (n, t, from, to) => `<bakemono>\n【👑『第${n}章：${t}』★ 跨度：第${from}至${to}楼 ★ 时间跨度：10月14日 ☆】\n➤ 🎞️ 【剧情长焦】\n- [事件] (${from}–${to} 楼 | 深夜 | 铁匠铺 | 旅人)\n  - 经过：旅人和格伦谈价钱。\n</bakemono>`;
    const mk = (n, t, list) => ({ id: 'stage-' + n, hash: 'stagehash' + n, type: 'stage', title: '剧集终了·点击回看', content: stageText(n, t, list[0].messageId, list.at(-1).messageId), sourceHashes: list.map(b => b.hash), sourceMessageIds: list.map(b => b.messageId), createdAt: new Date().toISOString(), metadata: {} });
    st.stageSummaries = [mk(1, '雾港镇的雨夜', story.slice(0, 8)), mk(2, '钟楼下的交易', story.slice(8, 14)), mk(3, '矿坑前夜', story.slice(14, 18))];
    st.epicSummaries = [{ id: 'epic-1', hash: 'epichash1', type: 'epic', title: '多次总结·长期总览', content: '<bakemono>\n【🪐『长期总览：第一卷 · 雾港镇』★ 总跨度：第3至35楼 ★ 时间跨度：10月14日 ☆】\n➤ 📜 【时间线总览】\n- 旅人到了雾港镇。\n</bakemono>', sourceStageHashes: ['stagehash1', 'stagehash2'], sourceHashes: [], createdAt: new Date().toISOString(), metadata: {} }];
    st.chronicle ||= { sources: [], links: {} };
    st.chronicle.links ||= {};
    for (const s of st.stageSummaries) st.chronicle.links[s.hash] = { refs: [], children: s.sourceHashes.map(h => ({ hash: h, revision: getHash(st.blocks.find(b => b.hash === h).content || '') })) };
    st.chronicle.links.epichash1 = { refs: [], children: ['stagehash1', 'stagehash2'].map(h => ({ hash: h, revision: getHash(st.stageSummaries.find(s => s.hash === h).content) })) };
    if (staleChapter) st.chronicle.links.stagehash2.children[0].revision = 'changed';
    return st;
}
