import { defaultKeepRecent, planSkippedFloors } from '../memory/send-trim.js';

// What one request sends of the chat. The host hands the generation interceptor a copy of the visible messages made
// for this request (each a copy that carries its position). Floors a summary covers leave that copy, and the covered
// floors that stay (the latest few) lose the summary blocks the summary already tells. A floor no summary covers keeps
// its block: with the summaries written in the replies, that block is the only way its summary reaches the model.
// The chat, its hidden flags and what is saved are not touched; with the switches off, or when the copy does not line
// up with the chat, everything goes as it is.
const blockExamples = 2;
const trimTypes = new Set(['normal', 'regenerate', 'swipe', 'continue', 'impersonate', '']);

export function createSendTrim({ ensureState, getChat, resolveSummaryGraph, summarySourceFloors, blockTypes, parseList, stripConfiguredTags, extractConfiguredTagBlocks }) {
    const settingsOf = state => {
        const own = state.sendTrim || {};
        return { skip: own.skipCovered === true, strip: own.stripBlocks === true, keepRecent: Math.max(2, Math.min(200, Math.round(Number(own.keepRecent)) || defaultKeepRecent)) };
    };
    // A covered floor, or its block, may go only when its summary reaches the model.
    const summariesSent = state => state.injection?.enabled !== false && (!state.injection?.template || String(state.injection.template).includes('{{memory}}'));
    // In 全文 mode the whole reply is the material; there is no block to cut.
    const summaryTags = state => state.scanRules?.mode === 'full' ? [] : parseList(state.scanRules?.includeTags ?? 'bakemono');

    const coverage = new WeakMap();
    function coveredFloors(state, chat) {
        const graph = resolveSummaryGraph(state);
        const key = `${graph.signature}|${chat.length}`;
        if (coverage.get(state)?.key === key) return coverage.get(state).floors;
        const stories = [...(state.storySummaries || []), ...(state.blocks || []).filter(block => block.type === blockTypes.STORY)];
        const floors = new Set(stories.filter(story => graph.coveredStoryHashes.has(story.hash)).flatMap(story => summarySourceFloors(state, story, graph)));
        coverage.set(state, { key, floors });
        return floors;
    }
    function skippedIds(state = ensureState(), chat = getChat() || []) {
        const settings = settingsOf(state);
        return settings.skip && summariesSent(state) ? planSkippedFloors(chat, coveredFloors(state, chat), settings) : new Set();
    }

    // Of the replies that still go, the covered ones lose their summary blocks; the latest few keep them, to show the
    // model the format it is asked to write. Works on `items` in place (copies), returns the characters cut.
    function stripBlocks(items, tags, covered) {
        if (!tags.length) return 0;
        let examples = 0, cut = 0;
        for (let index = items.length - 1; index >= 0; index--) {
            const item = items[index], source = String(item?.mes || '');
            if (!item || item.is_user || !extractConfiguredTagBlocks(source, tags).length) continue;
            if (examples < blockExamples) { examples++; continue; }
            if (!covered(item)) continue;
            const stripped = stripConfiguredTags(source, tags).replace(/\n{3,}/g, '\n\n').trim();
            // A reply that was nothing but its summary keeps it: an empty reply is worse than a long one.
            if (!stripped) continue;
            cut += source.length - stripped.length;
            items[index] = { ...item, mes: stripped };
        }
        return cut;
    }

    function trim(coreChat, type = 'normal') {
        const result = { skipped: 0, skippedChars: 0, strippedChars: 0 };
        if (!Array.isArray(coreChat) || !trimTypes.has(type ?? '')) return result;
        const state = ensureState(), chat = getChat() || [];
        const settings = settingsOf(state);
        if (!settings.skip && !settings.strip) return result;
        // The copy follows the visible messages in order; each item says where it was. Anything else (another extension
        // reshaped it, a tool message the host left out) stops this round's trim.
        const visible = chat.map((message, id) => ({ message, id })).filter(({ message }) => message && (!message.is_system || Array.isArray(message.extra?.tool_invocations))).map(({ id }) => id);
        const idOf = item => visible[item?.index];
        const linedUp = coreChat.every(item => {
            const real = Number.isInteger(item?.index) ? chat[idOf(item)] : null;
            return !!real && real.send_date === item.send_date && !!real.is_user === !!item.is_user && real.name === item.name;
        });
        if (!linedUp) return result;
        const skip = skippedIds(state, chat);
        for (let index = coreChat.length - 1; index >= 0; index--) {
            if (!skip.has(idOf(coreChat[index]))) continue;
            result.skippedChars += String(coreChat[index].mes || '').length;
            coreChat.splice(index, 1);
            result.skipped++;
        }
        if (settings.strip && summariesSent(state)) {
            const covered = coveredFloors(state, chat);
            result.strippedChars = stripBlocks(coreChat, summaryTags(state), item => covered.has(idOf(item)));
        }
        return result;
    }

    // What this round sends of the chat and what it leaves out, in characters of the saved text; and what turning both
    // switches on would leave out on top.
    const estimates = new WeakMap();
    function estimate(state = ensureState(), chat = getChat() || []) {
        const settings = settingsOf(state);
        const key = JSON.stringify([chat.length, String(chat.at(-1)?.mes || '').length, settings, summariesSent(state), state.scanRules?.mode, state.scanRules?.includeTags, resolveSummaryGraph(state).signature]);
        if (estimates.get(state)?.key === key) return estimates.get(state).value;
        const sent = summariesSent(state), covered = coveredFloors(state, chat);
        const measure = (skipOn, stripOn) => {
            const skip = skipOn && sent ? planSkippedFloors(chat, covered, settings) : new Set();
            const items = chat.map((message, id) => ({ message, id })).filter(({ message, id }) => message && !message.is_system && !skip.has(id))
                .map(({ message, id }) => ({ id, is_user: !!message.is_user, mes: String(message.mes || '') }));
            const total = items.reduce((sum, item) => sum + item.mes.length, 0);
            const strippedChars = stripOn && sent ? stripBlocks(items, summaryTags(state), item => covered.has(item.id)) : 0;
            return { skippedFloors: skip.size, skippedChars: [...skip].reduce((sum, id) => sum + String(chat[id]?.mes || '').length, 0), strippedChars, sentFloors: items.length, sentChars: total - strippedChars };
        };
        const now = measure(settings.skip, settings.strip), both = measure(true, true);
        const value = { active: settings.skip || settings.strip, summariesSent: sent, ...now,
            possible: Math.max(0, both.skippedChars + both.strippedChars - now.skippedChars - now.strippedChars) };
        estimates.set(state, { key, value });
        return value;
    }

    // The line on the home page. `sources`: the injected sources, for what the summaries take in exchange (left out
    // where there are none, as on the archive page).
    function summary(sources = {}, state = ensureState()) {
        const numbers = estimate(state);
        const count = value => Number(value || 0).toLocaleString('en-US');
        const memory = sources ? `；总结和剧情事实约 ${count(String(sources.summary || '').length + String(sources.facts || '').length)} 字` : '';
        if (numbers.active) {
            if (!numbers.summariesSent) return { text: '发送精简开着，但注入关着或模板里没有记忆，已总结的楼层照常全发。', canEnable: false };
            if (!numbers.skippedFloors && !numbers.strippedChars) {
                return { text: numbers.sentFloors ? `发送精简开着：还没有被阶段总结覆盖的旧楼层，这一轮聊天正文照常全发（${numbers.sentFloors} 楼约 ${count(numbers.sentChars)} 字）。` : '', canEnable: false };
            }
            const saved = [
                numbers.skippedFloors ? `跳过已总结的 ${numbers.skippedFloors} 楼约 ${count(numbers.skippedChars)} 字` : '',
                numbers.strippedChars ? `已总结楼层的摘要块省下约 ${count(numbers.strippedChars)} 字` : '',
            ].filter(Boolean).join('，');
            return { text: `这一轮发出聊天正文 ${numbers.sentFloors} 楼约 ${count(numbers.sentChars)} 字，${saved}${memory}。`, canEnable: false };
        }
        if (!numbers.possible) return { text: '', canEnable: false };
        return { text: `打开“发送时精简旧楼层”，这一轮可以少发约 ${count(numbers.possible)} 字，省下的都是已经总结过的楼层。聊天记录不会改动。`, canEnable: true };
    }

    return { trim, skippedIds, estimate, summary, settingsOf };
}
