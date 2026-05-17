import { chat, chat_metadata, extension_prompt_roles, extension_prompt_types, eventSource, event_types, generateRaw, saveChatConditional, saveSettingsDebounced, setExtensionPrompt } from '../../../../script.js';
import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { hideChatMessageRange } from '../../../chats.js';

const EXT_ID = 'BakemonoMemory';
const STORAGE_KEY = 'bakemonoMemory';
const INJECTION_KEY = 'bakemono_memory';

const extensionFolderPath = (() => {
    const fallback = `scripts/extensions/third-party/${EXT_ID}`;

    try {
        if (typeof import.meta !== 'undefined' && import.meta.url) {
            const url = new URL('.', import.meta.url);
            const pathname = decodeURIComponent(url.pathname);
            const match = pathname.match(/(scripts\/extensions\/third-party\/[^/]+)/);
            if (match) return match[1];
        }
    } catch (error) {
        // ignore
    }

    if (typeof document !== 'undefined') {
        const script = document.currentScript;
        if (script?.src) {
            try {
                const url = new URL(script.src, window.location.href);
                const pathname = decodeURIComponent(url.pathname);
                const match = pathname.match(/(scripts\/extensions\/third-party\/[^/]+)/);
                if (match) return match[1];
            } catch (error) {
                // ignore
            }
        }
    }

    return fallback;
})();

const blockTypes = {
    STORY: 'story',
    STAGE: 'stage',
    EPIC: 'epic',
};

const defaultInjectionTemplate = `【剧情剪辑台：长期剧情记忆】
以下内容是已经压缩整理过的剧情记忆。请把它当作已发生事实与长期线索参考，不要复述给用户，也不要替代当前回合正文。

{{memory}}`;

const defaultScanRules = {
    mode: 'tag',
    includeTags: 'bakemono',
    excludeTags: 'thinking, think, reasoning',
    fullTextMinLength: 20,
};

const defaultClassificationRules = {
    story: '📋 剧情摘要, 场记打板, 高光收音',
    stage: '剧集终了, 点击回看, 剧情长焦, 角色进化录',
    epic: '纪元回溯, 史诗简史, 事件断代史, 命运锚点',
};

const defaultPreviewLayouts = {
    story: `🎬 场记|场记打板|normal
🎙️ 收音|高光收音|normal
🌍 监视|副镜监视器|normal
🪢 暗线|剧本暗线|tag
💡 墙外|第四面墙|bubble`,
    stage: `🎞️ 长焦|剧情长焦|normal
🎭 进化|角色进化录|normal
🏆 金句|金句名人堂|bubble
🗃️ 谜题|未解之谜|tag
👾 墙外|第四面墙·终极笔记|bubble`,
    epic: `📜 断代|事件断代史|normal
🔗 锚点|命运锚点|tag
🦋 蝶变|灵魂蝶变|normal
👾 观测|第四面墙·高维观测|bubble`,
};

const defaultStageGenerationPrompt = `# 👾总结模式！
- 编辑大人开启这一模式后，说明不需要输出正文和那些无聊的规则！前面的几个模块均不需要遵守！
- 接下来是编辑大人要求的大总结，我需要把之前**除了**\`【剧集终了·点击回看】\`的\`<bakemono/>\`们进行总结啦！
- 👾总结时是不需要输出正文的，只用输出总结内容！
- 之前总结的\`【剧集终了·点击回看】\`不需要再总结一次哦，只需要总结新增的\`<bakemono/>\`们！

# 📖 全剧大纲·里程碑回顾：
当前篇章已告一段落。👾要站在“总编剧”的角度，生成一个全局摘要。

## 格式要求：
<bakemono>
<details>
<summary>【剧集终了·点击回看】</summary>
【👑『第x卷：自定义名称』★ 跨度：从x章至x章 ★ 当前时间点：XXX ☆】

➤ 🎞️ 【剧情长焦】（详细提炼本阶段的“起、承、转、合”。概括每章节内容，让后续可清晰了解之前章节具体发生过什么）

➤ 🎭 【角色进化录】（记录核心角色在本篇章后的心态/关系转变）
- [角色A]：从最初的[状态]转变为了[现状]，关键转折点是[事件]。
- [角色B]：目前对[角色A]的看法是[心理描述]。

➤ 🏆 【金句名人堂】（从整篇剧情中挑选出最具代表性、最能定义本卷灵魂的三句台词）
1. > “台词1”——【角色名】
2. > “台词2”——【角色名】
3. > “台词3”——【角色名】

➤ 🗃️ 【未解之谜】（记录目前埋下但尚未回收的伏笔、未交待的秘密）
* 伏笔A：...
* 伏笔B：...

➤ 👾 【第四面墙·终极笔记】（以👾视角，整合之前的第四面墙内容）
*嘿嘿，这里是整合*
</details>
</bakemono>

只输出一个完整的 <bakemono> 块，不要输出正文、解释、寒暄或 Markdown 代码围栏。

以下是需要汇总的新增 <bakemono> 剧情摘要：
{{blocks}}`;

const defaultEpicGenerationPrompt = `# 👾总结大总结模式！
- 编辑大人开启这一模式后，说明总结也已经太多了，需要把总结进行总结了！不需要输出正文和那些无聊的规则！前面的几个模块均不需要遵守！
- 接下来是编辑大人要求的总结大总结，我需要把之前的\`<bakemono/>\`们进行总结啦！包括所有的\`【剧集终了·点击回看】\`！
- 👾总结时是不需要输出正文的，只用输出总结内容！

# 📚 世界线收束·全剧编年史回顾：
检测到剧情已跨越多个宏大篇章。👾化身“世界观测者”，对过往的所有剧情进行终极提炼，生成一份关于总结的大总结。

## 终极排版与格式要求（必须严格遵守以下版式）：
<bakemono>
<details>
<summary>【纪元回溯·史诗简史】</summary>
【🪐『事件史诗：自定义名称』★ 总跨度：第x卷至第x卷 ★ 当前时间点：XXX ☆】

➤ 📜 【事件断代史】（将每卷剧情划分为多个核心事件，详细概括每个事件的内容）
- [事件一名称]：……
- [事件二名称]：……

➤ 🔗 【命运锚点】（纵观全剧，挑出最具决定性、彻底改变世界走向或两人关系的 1 到 2 个绝对高光时刻）
* 锚点A：[时刻] —— 它带来的深远影响是……

➤ 🦋 【灵魂蝶变】（跨越漫长时间线后，核心角色的终极蜕变。对比他们“最初的模样”与“现在的完全体”）
* [角色名]：核心驱动力已从最初的[旧执念]，彻底蜕变为[新信仰/新感情]。

➤ 👾 【第四面墙·高维观测】（以👾视角，进行所有伏笔和第四面墙的总结）
*回望来时的路……*
</details>
</bakemono>

只输出一个完整的 <bakemono> 块，不要输出正文、解释、寒暄或 Markdown 代码围栏。

以下是需要进行“总结大总结”的 <bakemono> 内容：
{{blocks}}`;

const defaultStoryGenerationPrompt = `# 👾旧正文补课摘要模式！
- 你现在不是继续写正文，也不是扮演角色。
- 你是“剧情剪辑台”的归档员，只负责把已经发生过的聊天正文压缩成剧情摘要。
- 禁止续写剧情，禁止补写新台词，禁止加入正文里没有发生的新事件。
- 只允许根据下面提供的历史聊天内容做总结。
- 本次补课编号、覆盖楼层和推荐标题由插件提供，必须原样使用，不要自行推断章节号。

# 摘要目标
把以下旧聊天正文整理成一个可继续用于“阶段总结 / 史诗简史”的剧情摘要块。请尽量保留：
- 本批次实际发生的事件过程；
- 关键对话、心理活动和关系变化；
- 当前时间、地点、在场角色、状态变化；
- 已出现但尚未解决的伏笔、秘密、任务或悬念；
- 角色不知道但读者/系统已经知道的隐藏信息。

## 输出格式要求
<bakemono>
<details>
<summary>📋 剧情摘要</summary>
【☆『{{suggestedTitle}}』★{{sourceRange}}★从旧正文补课中可判断的地点/状态|本批出现角色☆】

➤ 🎬 【场记打板】（流水账形式记录本批次已经发生的全部事件，每个事件要有清楚的起因、过程和结果；不得升华主题，不得续写）
- 此处为剧情摘要

➤ 🎙️ 【高光收音】（抓取本批次最关键、最能体现角色性格或关系变化的对话/心理活动；只能引用或概括原文中已有内容）
> “此处填入台词或内心戏” —— [角色名]

➤ 🌍 【副镜监视器】（如果本批次有平行事件就记录；没有就写“无”）
[地点A | 角色B]：ta此刻的行动/心理。

➤ 🪢 【剧本暗线】（只记录正文里已经出现的伏笔、秘密、未解决事项；不得新增伏笔）
[未回收伏笔 1]：……
[✅ 本批次回收]：如果没有就写“无”

➤ 💡 【第四面墙】（用👾视角记录角色不知道、但读者/系统知道的隐藏信息；不是吐槽；不得新增设定）
*偷偷记一笔*
</details>
</bakemono>

只输出一个完整的 <bakemono> 块，不要输出正文、解释、寒暄或 Markdown 代码围栏。

## 本批补课元数据
- 批次：{{batchIndex}} / {{batchTotal}}
- 覆盖楼层：{{sourceRange}}
- 推荐标题：{{suggestedTitle}}
- 如果正文无法判断日期、地点或天气，写“未知”，不要编造。

以下是需要补课压缩的旧聊天正文：
{{blocks}}`;

const defaultGenericStoryGenerationPrompt = `# 通用旧正文补课摘要
你是“剧情剪辑台”的归档员。请把下面已经发生过的聊天正文压缩成一份可长期保存、可继续用于后续总结的普通摘要。

严格要求：
- 只总结已经发生的内容，不续写，不扮演角色，不新增事件。
- 批次编号、楼层范围、标题必须使用插件给出的元数据，不要自行推断章节号。
- 可以不用 <bakemono> 标签，也不用 HTML；用清晰的 Markdown 输出即可。
- 如果某项信息无法从原文判断，写“未知”或“无”，不要编造。

建议标题：{{suggestedTitle}}
批次：{{batchIndex}} / {{batchTotal}}
覆盖楼层：{{sourceRange}}

请按以下结构输出：
# {{suggestedTitle}}

## 范围
- 批次：{{batchIndex}} / {{batchTotal}}
- 楼层：{{sourceRange}}

## 事件经过
- 按时间顺序整理本批发生的关键事件，保留起因、过程、结果。

## 角色与关系
- 记录本批涉及角色的状态、动机、关系变化。

## 关键话语 / 心理
- 摘录或概括重要台词、心理活动，不要新增原文没有的内容。

## 伏笔与未解事项
- 记录仍未解决的任务、秘密、危险、承诺、线索。

以下是需要补课压缩的旧聊天正文：
{{blocks}}`;

const defaultGenericStageGenerationPrompt = `# 通用阶段总结
请把以下摘要片段合并为一份阶段总结。只总结输入内容，不续写，不新增事件。

输出 Markdown，不需要 <bakemono> 标签。

# 阶段总结：自定义标题

## 覆盖范围
- 说明本阶段大致覆盖哪些批次 / 楼层 / 时间段。

## 剧情脉络
- 按时间顺序概括本阶段的起、承、转、合。

## 角色变化
- 记录核心角色的心态、立场、关系变化。

## 关键场面
- 挑出最关键的 3 到 5 个场面或对话。

## 未解事项
- 汇总仍未解决的伏笔、任务、秘密和风险。

需要合并的摘要片段：
{{blocks}}`;

const defaultGenericEpicGenerationPrompt = `# 通用全局总结
请把以下阶段总结或摘要片段整理成一份全局回顾。只总结输入内容，不续写，不新增事件。

输出 Markdown，不需要 <bakemono> 标签。

# 全局回顾：自定义标题

## 时间线总览
- 按阶段顺序整理到目前为止发生过的主要事件。

## 决定性转折
- 选出 1 到 3 个真正改变走向的关键时刻，并说明影响。

## 核心角色弧光
- 对比核心角色最初状态与当前状态。

## 长期线索
- 汇总仍然重要的伏笔、秘密、目标、危险和关系张力。

需要整理的内容：
{{blocks}}`;

const defaultPromptPreset = {
    id: 'default-bakemono',
    name: '默认 Bakemono 手账',
    story: defaultStoryGenerationPrompt,
    stage: defaultStageGenerationPrompt,
    epic: defaultEpicGenerationPrompt,
    scanRules: structuredClone(defaultScanRules),
    classificationRules: structuredClone(defaultClassificationRules),
    previewLayouts: structuredClone(defaultPreviewLayouts),
    automation: null,
    outputMode: 'bakemono',
    createdAt: 'default',
    updatedAt: 'default',
};

const defaultGenericPromptPreset = {
    id: 'default-generic',
    name: '通用正文压缩',
    story: defaultGenericStoryGenerationPrompt,
    stage: defaultGenericStageGenerationPrompt,
    epic: defaultGenericEpicGenerationPrompt,
    scanRules: {
        mode: 'full',
        includeTags: '',
        excludeTags: 'thinking, think, reasoning',
        fullTextMinLength: 40,
    },
    classificationRules: {
        story: '通用旧正文补课摘要, 事件经过, 角色与关系, 伏笔与未解事项',
        stage: '通用阶段总结, 阶段总结, 剧情脉络, 角色变化',
        epic: '通用全局总结, 全局回顾, 时间线总览, 决定性转折',
    },
    previewLayouts: {
        story: `🧭 事件|事件经过|normal
👥 角色|角色与关系|normal
💬 话语|关键话语,心理|bubble
🧩 线索|伏笔与未解事项|tag`,
        stage: `🧭 脉络|剧情脉络|normal
👥 变化|角色变化|normal
🎞️ 场面|关键场面|bubble
🧩 未解|未解事项|tag`,
        epic: `🕰️ 时间线|时间线总览|normal
🔀 转折|决定性转折|tag
👥 弧光|核心角色弧光|normal
🧩 线索|长期线索|bubble`,
    },
    automation: {
        enabled: false,
        mode: 'remind',
        triggerType: 'floors',
        floorInterval: 10,
        charInterval: 12000,
        summaryKind: 'stage',
        backfillBatchSize: 50,
        apiProvider: 'tavern',
        customApi: {
            baseUrl: '',
            apiKey: '',
            model: '',
            temperature: 0.7,
            maxTokens: 3000,
        },
        lastSignature: '',
        lastAutoAt: null,
    },
    outputMode: 'plain',
    createdAt: 'default',
    updatedAt: 'default',
};

const defaultAutomation = {
    enabled: false,
    mode: 'remind',
    triggerType: 'floors',
    floorInterval: 10,
    charInterval: 12000,
    summaryKind: 'stage',
    backfillBatchSize: 10,
    apiProvider: 'tavern',
    customApi: {
        baseUrl: '',
        apiKey: '',
        model: '',
        temperature: 0.7,
        maxTokens: 3000,
    },
    lastSignature: '',
    lastAutoAt: null,
};

const defaultState = {
    version: 1,
    blocks: [],
    storySummaries: [],
    stageSummaries: [],
    epicSummaries: [],
    drafts: [],
    history: [],
    taskQueue: [],
    generatedMemory: '',
    coveredBlockHashes: [],
    coveredStageHashes: [],
    hiddenMessageIds: [],
    injection: {
        enabled: true,
        depth: 4,
        role: extension_prompt_roles.SYSTEM,
        template: defaultInjectionTemplate,
        content: '',
    },
    generationPrompts: {
        story: defaultStoryGenerationPrompt,
        stage: defaultStageGenerationPrompt,
        epic: defaultEpicGenerationPrompt,
    },
    automation: defaultAutomation,
    scanRules: defaultScanRules,
    classificationRules: defaultClassificationRules,
    previewLayouts: defaultPreviewLayouts,
    scanPreview: [],
    lastScanAt: null,
};

let isBusy = false;
let isQueueRunning = false;
const previewPageSize = 8;
const historyPageSize = 10;
const previewState = {
    activeType: 'story',
    pages: {
        story: 0,
        stage: 0,
        epic: 0,
    },
};
const historyState = {
    page: 0,
};

function cloneDefaultState() {
    return structuredClone(defaultState);
}

function ensureGlobalSettings() {
    if (!extension_settings[STORAGE_KEY]) {
        extension_settings[STORAGE_KEY] = {};
    }
    if (!Array.isArray(extension_settings[STORAGE_KEY].promptPresets)) {
        extension_settings[STORAGE_KEY].promptPresets = [structuredClone(defaultPromptPreset), structuredClone(defaultGenericPromptPreset)];
    }
    if (!extension_settings[STORAGE_KEY].promptPresets.some(preset => preset.id === defaultPromptPreset.id)) {
        extension_settings[STORAGE_KEY].promptPresets.unshift(structuredClone(defaultPromptPreset));
    }
    if (!extension_settings[STORAGE_KEY].promptPresets.some(preset => preset.id === defaultGenericPromptPreset.id)) {
        extension_settings[STORAGE_KEY].promptPresets.push(structuredClone(defaultGenericPromptPreset));
    }
    for (const preset of extension_settings[STORAGE_KEY].promptPresets) {
        if (preset.story === undefined) {
            preset.story = defaultStoryGenerationPrompt;
        }
        if (preset.id === defaultGenericPromptPreset.id) {
            preset.story = defaultGenericStoryGenerationPrompt;
            preset.stage = defaultGenericStageGenerationPrompt;
            preset.epic = defaultGenericEpicGenerationPrompt;
            preset.scanRules = structuredClone(defaultGenericPromptPreset.scanRules);
            preset.classificationRules = structuredClone(defaultGenericPromptPreset.classificationRules);
            preset.previewLayouts = structuredClone(defaultGenericPromptPreset.previewLayouts);
            preset.automation = structuredClone(defaultGenericPromptPreset.automation);
            preset.outputMode = defaultGenericPromptPreset.outputMode;
        }
    }
    if (!extension_settings[STORAGE_KEY].selectedPromptPresetId) {
        extension_settings[STORAGE_KEY].selectedPromptPresetId = defaultPromptPreset.id;
    }
}

function ensureState() {
    if (!chat_metadata[STORAGE_KEY]) {
        chat_metadata[STORAGE_KEY] = cloneDefaultState();
    }

    const state = chat_metadata[STORAGE_KEY];
    for (const [key, value] of Object.entries(defaultState)) {
        if (state[key] === undefined) {
            state[key] = structuredClone(value);
        }
    }
    for (const [key, value] of Object.entries(defaultState.injection)) {
        if (state.injection[key] === undefined) {
            state.injection[key] = structuredClone(value);
        }
    }
    if (!state.generationPrompts) {
        state.generationPrompts = structuredClone(defaultState.generationPrompts);
    }
    for (const [key, value] of Object.entries(defaultState.generationPrompts)) {
        if (state.generationPrompts[key] === undefined) {
            state.generationPrompts[key] = structuredClone(value);
        }
    }
    if (String(state.generationPrompts.story || '').includes('请把以下聊天正文压缩成一个可继续用于后续阶段总结的剧情摘要')) {
        state.generationPrompts.story = defaultStoryGenerationPrompt;
    }
    if (
        String(state.generationPrompts.story || '').includes('旧正文补课摘要模式')
        && String(state.generationPrompts.story || '').includes('第x章：旧正文补课')
        && !String(state.generationPrompts.story || '').includes('{{suggestedTitle}}')
    ) {
        state.generationPrompts.story = defaultStoryGenerationPrompt;
    }
    for (const key of ['scanRules', 'classificationRules', 'previewLayouts']) {
        if (!state[key]) {
            state[key] = structuredClone(defaultState[key]);
        }
        for (const [nestedKey, value] of Object.entries(defaultState[key])) {
            if (state[key][nestedKey] === undefined) {
                state[key][nestedKey] = structuredClone(value);
            }
        }
    }

    state.blocks = Array.isArray(state.blocks) ? state.blocks : [];
    state.storySummaries = Array.isArray(state.storySummaries) ? state.storySummaries : [];
    state.stageSummaries = Array.isArray(state.stageSummaries) ? state.stageSummaries : [];
    state.epicSummaries = Array.isArray(state.epicSummaries) ? state.epicSummaries : [];
    sortSummariesBySource(state.storySummaries);
    sortSummariesBySource(state.stageSummaries);
    sortSummariesBySource(state.epicSummaries);
    state.drafts = Array.isArray(state.drafts) ? state.drafts : [];
    state.history = Array.isArray(state.history) ? state.history : [];
    state.taskQueue = Array.isArray(state.taskQueue) ? state.taskQueue : [];
    state.scanPreview = Array.isArray(state.scanPreview) ? state.scanPreview : [];
    state.generatedMemory = String(state.generatedMemory || state.injection?.content || '');
    state.coveredBlockHashes = Array.isArray(state.coveredBlockHashes) ? state.coveredBlockHashes : [];
    state.coveredStageHashes = Array.isArray(state.coveredStageHashes) ? state.coveredStageHashes : [];
    state.hiddenMessageIds = Array.isArray(state.hiddenMessageIds) ? state.hiddenMessageIds : [];
    state.automation = state.automation && typeof state.automation === 'object' ? state.automation : structuredClone(defaultAutomation);
    for (const [key, value] of Object.entries(defaultAutomation)) {
        if (state.automation[key] === undefined) {
            state.automation[key] = structuredClone(value);
        }
    }
    state.automation.customApi = state.automation.customApi && typeof state.automation.customApi === 'object'
        ? state.automation.customApi
        : structuredClone(defaultAutomation.customApi);
    for (const [key, value] of Object.entries(defaultAutomation.customApi)) {
        if (state.automation.customApi[key] === undefined) {
            state.automation.customApi[key] = structuredClone(value);
        }
    }

    return state;
}

function saveState() {
    saveMetadataDebounced();
}

function saveGlobalSettings() {
    saveSettingsDebounced();
}

function getPromptPresets() {
    ensureGlobalSettings();
    return extension_settings[STORAGE_KEY].promptPresets;
}

function getSelectedPromptPresetId() {
    ensureGlobalSettings();
    return extension_settings[STORAGE_KEY].selectedPromptPresetId || defaultPromptPreset.id;
}

function setSelectedPromptPresetId(id) {
    ensureGlobalSettings();
    extension_settings[STORAGE_KEY].selectedPromptPresetId = id;
    saveGlobalSettings();
}

function makePresetId(name) {
    return `preset-${getHash(`${Date.now()}|${name || 'prompt'}`)}`;
}

function getHash(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function parseList(value) {
    return String(value || '')
        .split(/[,，\n]/)
        .map(item => item.trim())
        .filter(Boolean);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripConfiguredTags(text, tags) {
    let result = String(text || '');
    for (const tag of tags) {
        const pattern = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>[\\s\\S]*?<\\/${escapeRegExp(tag)}>`, 'gi');
        result = result.replace(pattern, '');
    }
    return result;
}

function extractConfiguredTagBlocks(text, tags) {
    const source = String(text || '');
    const blocks = [];
    tags.forEach(tag => {
        const pattern = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>[\\s\\S]*?<\\/${escapeRegExp(tag)}>`, 'gi');
        const matches = source.match(pattern) || [];
        matches.forEach(content => {
            blocks.push({ content: content.trim(), matchedTag: tag });
        });
    });
    return blocks.filter(block => block.content);
}

function extractConfiguredSegments(text, rules = ensureState().scanRules) {
    if (!text) {
        return [];
    }

    const includeTags = parseList(rules.includeTags);
    const excludeTags = parseList(rules.excludeTags);
    const stripped = stripConfiguredTags(text, excludeTags);
    const mode = rules.mode === 'full' ? 'full' : 'tag';

    if (mode === 'tag') {
        return extractConfiguredTagBlocks(stripped, includeTags.length ? includeTags : ['bakemono'])
            .map(segment => ({ ...segment, mode }));
    }

    if (includeTags.length) {
        const tagSegments = extractConfiguredTagBlocks(stripped, includeTags);
        if (tagSegments.length) {
            return tagSegments.map(segment => ({ ...segment, mode }));
        }
    }

    const minLength = Math.max(0, Number(rules.fullTextMinLength || 0));
    const content = stripped.trim();
    return content.length >= minLength ? [{ content, matchedTag: '全文', mode }] : [];
}

function extractBakemonoBlocks(text) {
    if (!text) {
        return [];
    }

    const matches = String(text).match(/<bakemono\b[^>]*>[\s\S]*?<\/bakemono>/gi);
    return matches ? matches.map(block => block.trim()).filter(Boolean) : [];
}

function classifyBlock(block) {
    const state = ensureState();
    const text = stripHtml(block);
    if (matchesAnyKeyword(text, parseList(state.classificationRules.epic))) {
        return blockTypes.EPIC;
    }
    if (matchesAnyKeyword(text, parseList(state.classificationRules.stage))) {
        return blockTypes.STAGE;
    }
    return blockTypes.STORY;
}

function matchesAnyKeyword(text, keywords) {
    const source = String(text || '').toLowerCase();
    return keywords.some(keyword => source.includes(String(keyword).toLowerCase()));
}

function getBlockTitle(block, fallback) {
    const summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    if (summaryMatch?.[1]) {
        return stripHtml(summaryMatch[1]).trim() || fallback;
    }

    const titleMatch = block.match(/【([^】]+)】/);
    if (titleMatch?.[1]) {
        return titleMatch[1].trim();
    }

    return fallback;
}

function stripHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = value;
    return template.content.textContent || '';
}

function toPlainPreview(value, maxLength = 420) {
    const text = stripHtml(value).replace(/\n{3,}/g, '\n\n').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeSearchText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[：:：]/g, ':')
        .trim();
}

function getBlockPlainText(block) {
    return stripHtml(String(block || '')
        .replace(/<\/?(bakemono|details)[^>]*>/gi, '')
        .replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, ''))
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function getBracketMetaLine(text) {
    return text.split('\n').map(line => line.trim()).find(line => /^【[\s\S]+】$/.test(line)) || '';
}

function parsePreviewMeta(block) {
    const summary = getBlockTitle(block.content, block.title);
    const text = getBlockPlainText(block.content);
    const metaLine = getBracketMetaLine(text);
    const fallbackTitle = summary.replace(/[📋【】]/g, '').trim() || block.title;
    const meta = {
        sticker: summary || (block.type === blockTypes.EPIC ? '史诗简史' : block.type === blockTypes.STAGE ? '阶段总结' : '剧情摘要手账'),
        label: block.messageId === Number.MAX_SAFE_INTEGER ? '生成内容' : `第 ${block.messageId} 楼`,
        title: fallbackTitle,
        meta: metaLine || summary,
        submeta: '',
    };

    if (block.type === blockTypes.STORY) {
        const storyMatch = metaLine.match(/第\s*([^章：:]+)\s*章\s*[：:]\s*([^』★]+).*?★\s*([^★]+)\s*★\s*([^☆]+)\s*☆/);
        if (storyMatch) {
            meta.label = `第 ${storyMatch[1].trim()} 章`;
            meta.title = storyMatch[2].trim();
            meta.meta = storyMatch[3].trim();
            meta.submeta = storyMatch[4].trim();
        } else {
            const looseChapter = text.match(/第\s*([0-9一二三四五六七八九十百千]+)\s*章\s*[：:]\s*([^\n★】]+)/);
            if (looseChapter) {
                meta.label = `第 ${looseChapter[1].trim()} 章`;
                meta.title = looseChapter[2].trim();
            }
        }
    } else if (block.type === blockTypes.STAGE) {
        const stageMatch = metaLine.match(/『([^』]+)』.*?跨度[：:]\s*([^★]+).*?当前时间点[：:]\s*([^☆]+)\s*☆/);
        if (stageMatch) {
            meta.label = stageMatch[2].trim();
            meta.title = stageMatch[1].trim();
            meta.meta = `当前时间点：${stageMatch[3].trim()}`;
        }
    } else if (block.type === blockTypes.EPIC) {
        const epicMatch = metaLine.match(/『([^』]+)』.*?总跨度[：:]\s*([^★]+).*?当前时间点[：:]\s*([^☆]+)\s*☆/);
        if (epicMatch) {
            meta.label = epicMatch[2].trim();
            meta.title = epicMatch[1].trim();
            meta.meta = `当前时间点：${epicMatch[3].trim()}`;
        }
    }

    return meta;
}

function getPreviewSummaryText(block) {
    const meta = parsePreviewMeta(block);
    const pieces = [meta.label, meta.title].filter(Boolean);
    const prefix = block.type === blockTypes.EPIC ? '🕰️' : block.type === blockTypes.STAGE ? '🎞️' : '📋';
    return `${prefix} ${pieces.join(' · ') || meta.sticker || block.title}`;
}

function getPreviewTabs(type) {
    const state = ensureState();
    const layoutKey = type === blockTypes.EPIC ? 'epic' : type === blockTypes.STAGE ? 'stage' : 'story';
    return parsePreviewLayout(state.previewLayouts[layoutKey] || defaultPreviewLayouts[layoutKey]);
}

function parsePreviewLayout(value) {
    return String(value || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [label = '片段', section = label, style = 'normal'] = line.split('|').map(part => part.trim());
            const modifier = style === 'bubble' ? 'bk-bubble' : style === 'tag' ? 'bk-tag-line' : '';
            return [label, section, modifier];
        });
}

function extractSectionText(text, label) {
    const labels = String(label || '').split(/[，,]/).map(item => item.trim()).filter(Boolean);
    const target = labels.find(item => text.includes(`【${item}】`) || text.includes(item));
    if (!target) {
        return '';
    }

    const marker = text.includes(`【${target}】`) ? `【${target}】` : target;
    const index = text.indexOf(marker);
    if (index < 0) {
        return '';
    }

    const lineEnd = text.indexOf('\n', index);
    const start = lineEnd >= 0 ? lineEnd + 1 : index + marker.length;
    const next = text.slice(start).search(/\n\s*➤\s*/);
    const end = next >= 0 ? start + next : text.length;
    return text.slice(start, end).replace(/<\/?[^>]+>/g, '').trim();
}

function createTextNodeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    element.textContent = text;
    return element;
}

function createBakemonoNotebook(block, index) {
    const text = getBlockPlainText(block.content);
    const meta = parsePreviewMeta(block);
    const tabs = getPreviewTabs(block.type).map(([label, section, modifier]) => ({
        label,
        modifier,
        content: extractSectionText(text, section),
    }));
    const hasSectionContent = tabs.some(tab => tab.content);
    if (!hasSectionContent) {
        return createFallbackPreview(block);
    }

    const outer = document.createElement('details');
    outer.className = 'bk-notebook-outer bakemono-memory-notebook';

    const summary = document.createElement('summary');
    summary.textContent = getPreviewSummaryText(block);

    const container = document.createElement('div');
    container.className = 'bk-notebook-container';

    const header = document.createElement('div');
    header.className = 'nh-wrap';
    header.append(
        createTextNodeElement('div', 'nh-chap-label', meta.label),
        createTextNodeElement('div', 'nh-title', meta.title),
        createTextNodeElement('div', 'nh-divider', ''),
        createTextNodeElement('div', 'nh-meta', [meta.meta, meta.submeta].filter(Boolean).join('\n')),
    );

    const layout = document.createElement('div');
    layout.className = 'bk-tabs-layout';

    const nav = document.createElement('nav');
    nav.className = 'bk-tabs-nav';
    nav.setAttribute('aria-label', '摘要分段');

    const content = document.createElement('div');
    content.className = 'bk-tabs-content-wrapper';

    tabs.forEach((tab, tabIndex) => {
        const panelId = `bk-panel-${block.hash}-${index}-${tabIndex}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `bk-tab-label${tabIndex === 0 ? ' is-active' : ''}`;
        button.dataset.bakemonoPanel = panelId;
        button.textContent = tab.label;

        const panel = document.createElement('div');
        panel.className = `bk-tab-panel${tabIndex === 0 ? ' is-active' : ''}`;
        panel.dataset.bakemonoPanel = panelId;

        const innerClass = ['bk-inner-text', tab.modifier].filter(Boolean).join(' ');
        panel.append(createTextNodeElement('div', innerClass, tab.content || '本段暂无内容。'));

        nav.append(button);
        content.append(panel);
    });

    layout.append(nav, content);
    container.append(header, layout);
    outer.append(summary, container);
    return outer;
}

function createFallbackPreview(block) {
    const details = document.createElement('details');
    details.className = 'bakemono-memory-card';

    const summary = document.createElement('summary');
    summary.textContent = getPreviewSummaryText(block);

    const body = document.createElement('div');
    body.className = 'bakemono-memory-card-body';
    body.textContent = stripHtml(block.content).trim();

    details.append(summary, body);
    return details;
}

function scanBakemonoBlocks({ persist = true } = {}) {
    const state = ensureState();
    const scanned = [];
    const preview = [];
    const previousBlocks = state.blocks;
    const context = getContext();
    const sourceChat = context.chat || chat || [];
    const rules = state.scanRules;

    sourceChat.forEach((message, messageId) => {
        extractConfiguredSegments(message?.mes, rules).forEach((segment, blockIndex) => {
            const content = segment.content;
            const hash = getHash(`${segment.mode}|${segment.matchedTag}|${content}`);
            const type = classifyBlock(content);
            const block = {
                hash,
                type,
                messageId,
                blockIndex,
                title: getBlockTitle(content, `#${messageId}.${blockIndex + 1}`),
                content,
                matchedTag: segment.matchedTag,
                scanMode: segment.mode,
                isHidden: !!message?.is_system,
            };
            scanned.push(block);
            preview.push({
                hash,
                type,
                messageId,
                blockIndex,
                matchedTag: segment.matchedTag,
                scanMode: segment.mode,
                title: block.title,
                preview: toPlainPreview(content, 180),
            });
        });
    });

    state.blocks = mergeBlocks(state.blocks, scanned);
    for (const block of scanned) {
        const previous = previousBlocks.find(item => item.content === block.content && item.hash !== block.hash);
        if (previous?.hash && state.coveredBlockHashes.includes(previous.hash)) {
            state.coveredBlockHashes = unique([...state.coveredBlockHashes, block.hash]);
        }
        if (previous?.hash && state.coveredStageHashes.includes(previous.hash)) {
            state.coveredStageHashes = unique([...state.coveredStageHashes, block.hash]);
        }
    }
    state.scanPreview = preview;
    state.lastScanAt = new Date().toISOString();

    if (persist) {
        saveState();
    }

    syncInjection();
    renderAll(`扫描完成：找到 ${scanned.length} 个可总结片段。`);
    return state.blocks;
}

function getFiniteMessageIds(ids = []) {
    return (ids || [])
        .map(id => Number(id))
        .filter(id => Number.isFinite(id) && id < Number.MAX_SAFE_INTEGER);
}

function getSourceStart(ids = []) {
    const finite = getFiniteMessageIds(ids);
    return finite.length ? Math.min(...finite) : Number.MAX_SAFE_INTEGER;
}

function getSourceEnd(ids = []) {
    const finite = getFiniteMessageIds(ids);
    return finite.length ? Math.max(...finite) : Number.MAX_SAFE_INTEGER;
}

function formatSourceRange(ids = []) {
    const start = getSourceStart(ids);
    const end = getSourceEnd(ids);
    if (!Number.isFinite(start) || start >= Number.MAX_SAFE_INTEGER) {
        return '来源楼层未知';
    }
    return start === end ? `楼层 ${start}` : `楼层 ${start}-${end}`;
}

function getBlockSortKey(block) {
    const direct = Number(block?.messageId);
    if (Number.isFinite(direct) && direct < Number.MAX_SAFE_INTEGER) {
        return direct;
    }
    const sourceStart = getSourceStart(block?.sourceMessageIds || []);
    return Number.isFinite(sourceStart) ? sourceStart : Number.MAX_SAFE_INTEGER;
}

function getSummarySortKey(summary) {
    const explicit = Number(summary?.sourceSortKey);
    if (Number.isFinite(explicit)) {
        return explicit;
    }
    return getBlockSortKey(summary);
}

function sortSummariesBySource(summaries = []) {
    return summaries.sort((a, b) => (
        getSummarySortKey(a) - getSummarySortKey(b)
        || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
        || String(a.hash || '').localeCompare(String(b.hash || ''))
    ));
}

function mergeBlocks(existing, scanned) {
    const scannedByHash = new Map(scanned.map(block => [block.hash, block]));
    const scannedByLegacyContent = new Map(scanned.map(block => [block.content, block]));
    const merged = [];
    const seen = new Set();

    for (const block of existing) {
        const fresh = scannedByHash.get(block.hash) || (!block.matchedTag ? scannedByLegacyContent.get(block.content) : null);
        if (fresh) {
            merged.push({ ...block, ...fresh });
            seen.add(block.hash);
            seen.add(fresh.hash);
        } else {
            merged.push(block);
            seen.add(block.hash);
        }
    }

    for (const block of scanned) {
        if (!seen.has(block.hash)) {
            merged.push(block);
        }
    }

    return merged.sort((a, b) => (getBlockSortKey(a) - getBlockSortKey(b)) || (a.blockIndex - b.blockIndex));
}

function getBlocksByType(type) {
    return ensureState().blocks.filter(block => block.type === type);
}

function getStoryBlocks() {
    const state = ensureState();
    return dedupeByHash([
        ...getBlocksByType(blockTypes.STORY),
        ...state.storySummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.STORY })),
    ]);
}

function getUnsummarizedStoryBlocks() {
    const state = ensureState();
    const covered = new Set(state.coveredBlockHashes);
    return getStoryBlocks().filter(block => !covered.has(block.hash));
}

function getUnsummarizedStageBlocks() {
    const state = ensureState();
    const covered = new Set(state.coveredStageHashes);
    return dedupeByHash([
        ...getBlocksByType(blockTypes.STAGE),
        ...state.stageSummaries.map(summaryToBlock),
    ]).filter(block => !covered.has(block.hash));
}

function summaryToBlock(summary) {
    const sourceSortKey = getSummarySortKey(summary);
    return {
        hash: summary.hash,
        type: summary.type || blockTypes.STAGE,
        messageId: summary.messageId ?? (sourceSortKey < Number.MAX_SAFE_INTEGER ? sourceSortKey : Number.MAX_SAFE_INTEGER),
        blockIndex: 0,
        title: summary.title,
        content: summary.content,
        sourceHashes: summary.sourceHashes || [],
        sourceStageHashes: summary.sourceStageHashes || [],
        sourceMessageIds: summary.sourceMessageIds || [],
        sourceStart: summary.sourceStart,
        sourceEnd: summary.sourceEnd,
        sourceSortKey,
        metadata: summary.metadata || {},
        isGeneratedSummary: true,
        createdAt: summary.createdAt,
        isHidden: false,
    };
}

async function generateStageSummary() {
    if (isBusy) {
        return;
    }

    scanBakemonoBlocks({ persist: false });
    const state = ensureState();
    const targets = getUnsummarizedStoryBlocks();
    if (!targets.length) {
        renderAll('没有新的剧情摘要需要生成阶段总结。');
        toastr.info('没有新的剧情摘要需要生成阶段总结。');
        return;
    }

    await runGeneration('正在生成阶段总结...', async () => {
        const result = normalizeGeneratedBakemono(await generateRaw({
            prompt: buildStageUserPrompt(targets),
            systemPrompt: buildStageSystemPrompt(),
        }));

        const hash = getHash(result);
        state.stageSummaries.push({
            hash,
            type: blockTypes.STAGE,
            title: getBlockTitle(result, `剧集终了 ${state.stageSummaries.length + 1}`),
            content: result,
            sourceHashes: targets.map(block => block.hash),
            createdAt: new Date().toISOString(),
        });
        state.coveredBlockHashes = unique([...state.coveredBlockHashes, ...targets.map(block => block.hash)]);
        state.blocks = mergeBlocks(state.blocks, [{
            hash,
            type: blockTypes.STAGE,
            messageId: Number.MAX_SAFE_INTEGER,
            blockIndex: state.stageSummaries.length,
            title: getBlockTitle(result, `剧集终了 ${state.stageSummaries.length}`),
            content: result,
            isHidden: false,
        }]);
        updateInjectionFromSummaries();
        saveState();
        renderAll('阶段总结已生成并写入注入内容。');
        toastr.success('阶段总结已生成。');
    });
}

async function generateEpicSummary() {
    if (isBusy) {
        return;
    }

    scanBakemonoBlocks({ persist: false });
    const state = ensureState();
    const stageTargets = getUnsummarizedStageBlocks();
    const storyFallback = getBlocksByType(blockTypes.STORY).filter(block => !state.coveredBlockHashes.includes(block.hash));
    const targets = stageTargets.length ? stageTargets : storyFallback;

    if (!targets.length) {
        renderAll('没有可用于生成史诗简史的总结内容。');
        toastr.info('没有可用于生成史诗简史的总结内容。');
        return;
    }

    const latestEpicAt = state.epicSummaries.at(-1)?.createdAt;
    const confirmed = window.confirm([
        '即将生成【史诗简史】。',
        '',
        `阶段总结来源：${stageTargets.length} 个`,
        `普通摘要 fallback：${storyFallback.length} 个`,
        `上次史诗生成：${latestEpicAt ? new Date(latestEpicAt).toLocaleString() : '尚未生成'}`,
        '',
        '这个操作会把更高层级总结写入长期记忆。确认继续吗？',
    ].join('\n'));
    if (!confirmed) {
        renderAll('已取消史诗简史生成。');
        return;
    }

    await runGeneration('正在生成史诗简史...', async () => {
        const result = normalizeGeneratedBakemono(await generateRaw({
            prompt: buildEpicUserPrompt(targets),
            systemPrompt: buildEpicSystemPrompt(),
        }));

        const hash = getHash(result);
        state.epicSummaries.push({
            hash,
            type: blockTypes.EPIC,
            title: getBlockTitle(result, `纪元回溯 ${state.epicSummaries.length + 1}`),
            content: result,
            sourceHashes: targets.map(block => block.hash),
            createdAt: new Date().toISOString(),
        });
        state.coveredStageHashes = unique([...state.coveredStageHashes, ...stageTargets.map(block => block.hash)]);
        state.blocks = mergeBlocks(state.blocks, [{
            hash,
            type: blockTypes.EPIC,
            messageId: Number.MAX_SAFE_INTEGER,
            blockIndex: state.epicSummaries.length,
            title: getBlockTitle(result, `纪元回溯 ${state.epicSummaries.length}`),
            content: result,
            isHidden: false,
        }]);
        updateInjectionFromSummaries();
        saveState();
        renderAll('史诗简史已生成并写入注入内容。');
        toastr.success('史诗简史已生成。');
    });
}

function enqueueSummaryTask({ kind, prompt, systemPrompt, sourceHashes = [], sourceStageHashes = [], sourceMessageIds = [], trigger = 'manual', label = '', metadata = {} }) {
    const state = ensureState();
    const task = {
        id: `task-${getHash(`${kind}|${Date.now()}|${prompt}`)}`,
        kind,
        label: label || getKindLabel(kind),
        prompt,
        systemPrompt,
        sourceHashes,
        sourceStageHashes,
        sourceMessageIds,
        trigger,
        metadata,
        status: 'queued',
        error: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    state.taskQueue.push(task);
    saveState();
    renderAll('任务已加入队列。');
    processTaskQueue();
    return task;
}

async function processTaskQueue() {
    const state = ensureState();
    if (isQueueRunning || isBusy || !state.taskQueue.some(task => task.status === 'queued')) {
        return;
    }

    isQueueRunning = true;
    setBusy(true);
    const toast = toastr.info('正在处理总结任务队列...', '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
    try {
        while (true) {
            const task = state.taskQueue.find(item => item.status === 'queued');
            if (!task) {
                break;
            }

            task.status = 'running';
            task.updatedAt = new Date().toISOString();
            saveState();
            renderAll(`正在处理任务：${task.label}`);

            try {
                const result = normalizeGeneratedBakemono(await callGenerationModel({
                    prompt: task.prompt,
                    systemPrompt: task.systemPrompt,
                }));
                createDraft({
                    kind: task.kind,
                    content: result,
                    sourceHashes: task.sourceHashes || [],
                    sourceStageHashes: task.sourceStageHashes || [],
                    sourceMessageIds: task.sourceMessageIds || [],
                    prompt: task.prompt,
                    trigger: task.trigger || 'manual',
                    metadata: task.metadata || {},
                });
                task.status = 'done';
                task.error = '';
                task.updatedAt = new Date().toISOString();
                if (task.trigger === 'auto') {
                    state.automation.lastAutoAt = new Date().toISOString();
                }
            } catch (error) {
                task.status = 'failed';
                task.error = error?.message || String(error);
                task.updatedAt = new Date().toISOString();
                toastr.error(task.error, '任务失败');
            }
            saveState();
            renderAll();
        }
        switchWorkbenchTab('drafts');
        renderAll('任务队列处理完成，生成结果已进入草稿箱。');
    } finally {
        toastr.clear(toast);
        isQueueRunning = false;
        setBusy(false);
        renderAll();
    }
}

function retryQueueTask(taskId) {
    const state = ensureState();
    const task = state.taskQueue.find(item => item.id === taskId);
    if (!task) {
        return;
    }
    task.status = 'queued';
    task.error = '';
    task.updatedAt = new Date().toISOString();
    saveState();
    renderAll('失败任务已重新排队。');
    processTaskQueue();
}

function removeQueueTask(taskId) {
    const state = ensureState();
    state.taskQueue = state.taskQueue.filter(task => task.id !== taskId);
    saveState();
    renderAll('任务已从队列移除。');
}

function clearFinishedQueueTasks() {
    const state = ensureState();
    state.taskQueue = state.taskQueue.filter(task => !['done', 'failed'].includes(task.status));
    saveState();
    renderAll('已清理完成/失败的队列记录。');
}

function clearHistoryRecords() {
    const state = ensureState();
    if (!state.history.length) {
        toastr.info('暂无保存记录可清理。');
        return;
    }
    const confirmed = window.confirm('只清理保存记录列表，不删除已保存的总结和注入记忆。确定继续吗？');
    if (!confirmed) {
        return;
    }
    state.history = [];
    historyState.page = 0;
    saveState();
    renderAll('保存记录已清理。');
    toastr.success('保存记录已清理。');
}

async function generateStageDraft(options = {}) {
    if (isBusy) {
        return;
    }

    scanBakemonoBlocks({ persist: false });
    const targets = getUnsummarizedStoryBlocks();
    if (!targets.length) {
        renderAll('没有新的剧情摘要需要生成阶段总结。');
        toastr.info('没有新的剧情摘要需要生成阶段总结。');
        return;
    }

    const prompt = buildStageUserPrompt(targets);
    enqueueSummaryTask({
        kind: blockTypes.STAGE,
        label: `阶段总结 · ${targets.length} 个片段`,
        prompt,
        systemPrompt: buildStageSystemPrompt(),
        sourceHashes: targets.map(block => block.hash),
        sourceMessageIds: unique(targets.map(block => block.messageId).filter(Number.isFinite)),
        trigger: options.automatic ? 'auto' : 'manual',
        metadata: {
            sourceRange: formatSourceRange(targets.map(block => block.messageId)),
            sourceStart: getSourceStart(targets.map(block => block.messageId)),
            sourceEnd: getSourceEnd(targets.map(block => block.messageId)),
            sourceSortKey: getSourceStart(targets.map(block => block.messageId)),
        },
    });
    return;
    await runGeneration(options.automatic ? '正在自动生成阶段总结草稿...' : '正在生成阶段总结草稿...', async () => {
        const result = normalizeGeneratedBakemono(await callGenerationModel({
            prompt,
            systemPrompt: buildStageSystemPrompt(),
        }));

        createDraft({
            kind: blockTypes.STAGE,
            content: result,
            sourceHashes: targets.map(block => block.hash),
            sourceMessageIds: unique(targets.map(block => block.messageId).filter(Number.isFinite)),
            prompt,
            trigger: options.automatic ? 'auto' : 'manual',
        });
        ensureState().automation.lastAutoAt = options.automatic ? new Date().toISOString() : ensureState().automation.lastAutoAt;
        saveState();
        switchWorkbenchTab('drafts');
        renderAll('阶段总结草稿已生成，确认后才会写入长期记忆。');
        toastr.success('阶段总结草稿已生成，请到草稿箱确认。');
    });
}

async function generateEpicDraft(options = {}) {
    if (isBusy) {
        return;
    }

    scanBakemonoBlocks({ persist: false });
    const state = ensureState();
    const stageTargets = getUnsummarizedStageBlocks();
    const storyFallback = getStoryBlocks().filter(block => !state.coveredBlockHashes.includes(block.hash));
    const targets = stageTargets.length ? stageTargets : storyFallback;

    if (!targets.length) {
        renderAll('没有可用于生成史诗简史的总结内容。');
        toastr.info('没有可用于生成史诗简史的总结内容。');
        return;
    }

    if (!options.automatic) {
        const latestEpicAt = state.epicSummaries.at(-1)?.createdAt;
        const confirmed = window.confirm([
            '即将生成【史诗简史】草稿。',
            '',
            `阶段总结来源：${stageTargets.length} 个`,
            `普通摘要 fallback：${storyFallback.length} 个`,
            `上次史诗生成：${latestEpicAt ? new Date(latestEpicAt).toLocaleString() : '尚未生成'}`,
            '',
            '这只会生成待确认草稿，确认保存后才会写入长期记忆。继续吗？',
        ].join('\n'));
        if (!confirmed) {
            renderAll('已取消史诗简史生成。');
            return;
        }
    }

    const prompt = buildEpicUserPrompt(targets);
    enqueueSummaryTask({
        kind: blockTypes.EPIC,
        label: `史诗简史 · ${targets.length} 个片段`,
        prompt,
        systemPrompt: buildEpicSystemPrompt(),
        sourceHashes: targets.map(block => block.hash),
        sourceStageHashes: stageTargets.map(block => block.hash),
        sourceMessageIds: unique(targets.map(block => block.messageId).filter(Number.isFinite)),
        trigger: options.automatic ? 'auto' : 'manual',
        metadata: {
            sourceRange: formatSourceRange(targets.map(block => block.messageId)),
            sourceStart: getSourceStart(targets.map(block => block.messageId)),
            sourceEnd: getSourceEnd(targets.map(block => block.messageId)),
            sourceSortKey: getSourceStart(targets.map(block => block.messageId)),
        },
    });
    return;
    await runGeneration(options.automatic ? '正在自动生成史诗简史草稿...' : '正在生成史诗简史草稿...', async () => {
        const result = normalizeGeneratedBakemono(await callGenerationModel({
            prompt,
            systemPrompt: buildEpicSystemPrompt(),
        }));

        createDraft({
            kind: blockTypes.EPIC,
            content: result,
            sourceHashes: targets.map(block => block.hash),
            sourceStageHashes: stageTargets.map(block => block.hash),
            sourceMessageIds: unique(targets.map(block => block.messageId).filter(Number.isFinite)),
            prompt,
            trigger: options.automatic ? 'auto' : 'manual',
        });
        ensureState().automation.lastAutoAt = options.automatic ? new Date().toISOString() : ensureState().automation.lastAutoAt;
        saveState();
        switchWorkbenchTab('drafts');
        renderAll('史诗简史草稿已生成，确认后才会写入长期记忆。');
        toastr.success('史诗简史草稿已生成，请到草稿箱确认。');
    });
}

async function generateBackfillDrafts() {
    if (isBusy) {
        return;
    }

    const batches = buildBackfillBatches();
    if (!batches.length) {
        renderAll('没有找到可补课的旧正文。');
        toastr.info('没有找到可补课的旧正文。');
        return;
    }

    const confirmed = window.confirm([
        `将按 ${batches.length} 批生成旧正文摘要草稿。`,
        '这些草稿不会自动保存，需要你逐条确认。',
        '继续吗？',
    ].join('\n'));
    if (!confirmed) {
        return;
    }

    await runGeneration('正在分批生成旧正文摘要草稿...', async () => {
        for (const batch of batches) {
            const prompt = buildStoryUserPrompt(batch.blocks, batch.metadata);
            const result = normalizeGeneratedBakemono(await callGenerationModel({
                prompt,
                systemPrompt: buildStageSystemPrompt(),
            }));
            createDraft({
                kind: blockTypes.STORY,
                content: result,
                sourceHashes: batch.blocks.map(block => block.hash),
                sourceMessageIds: batch.blocks.map(block => block.messageId),
                prompt,
                trigger: 'backfill',
                metadata: batch.metadata,
            });
        }
        saveState();
        switchWorkbenchTab('drafts');
        renderAll(`已生成 ${batches.length} 个旧正文摘要草稿。`);
        toastr.success(`已生成 ${batches.length} 个旧正文摘要草稿。`);
    });
}

function buildBackfillBatches() {
    const state = ensureState();
    const sourceChat = getContext().chat || chat || [];
    const excludeTags = parseList(state.scanRules.excludeTags);
    const batchSize = Math.max(1, Number(state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize));
    const covered = new Set([
        ...state.coveredBlockHashes,
        ...state.storySummaries.flatMap(summary => summary.sourceHashes || []),
    ]);
    const rawBlocks = [];

    sourceChat.forEach((message, messageId) => {
        if (!message?.mes || message.is_system) {
            return;
        }
        const text = stripConfiguredTags(message.mes, excludeTags).trim();
        if (!text) {
            return;
        }
        const hash = getHash(`backfill|${messageId}|${text}`);
        if (covered.has(hash)) {
            return;
        }
        rawBlocks.push({
            hash,
            type: blockTypes.STORY,
            messageId,
            blockIndex: 0,
            title: message.is_user ? `User #${messageId}` : `Assistant #${messageId}`,
            content: text,
        });
    });

    const batches = [];
    for (let index = 0; index < rawBlocks.length; index += batchSize) {
        batches.push({ blocks: rawBlocks.slice(index, index + batchSize) });
    }
    const total = batches.length;
    batches.forEach((batch, index) => {
        batch.metadata = makeBackfillBatchMetadata(batch.blocks, index, total);
    });
    return batches;
}

function makeBackfillBatchMetadata(blocks, index, total) {
    const sourceMessageIds = blocks.map(block => block.messageId).filter(Number.isFinite);
    const batchIndex = index + 1;
    const sourceRange = formatSourceRange(sourceMessageIds);
    return {
        batchIndex,
        batchTotal: total,
        sourceRange,
        sourceStart: getSourceStart(sourceMessageIds),
        sourceEnd: getSourceEnd(sourceMessageIds),
        sourceSortKey: getSourceStart(sourceMessageIds),
        suggestedTitle: `旧正文补课 第${batchIndex}批（${sourceRange}）`,
        lockTitle: true,
    };
}

async function generateBackfillQueue() {
    if (isBusy) {
        return;
    }

    const batches = buildBackfillBatches();
    if (!batches.length) {
        renderAll('没有找到可补课的旧正文。');
        toastr.info('没有找到可补课的旧正文。');
        return;
    }

    const confirmed = window.confirm([
        `将按 ${batches.length} 批加入旧正文摘要任务。`,
        '队列会逐个生成草稿，生成后仍需要你确认保存。',
        '继续吗？',
    ].join('\n'));
    if (!confirmed) {
        return;
    }

    for (const [index, batch] of batches.entries()) {
        const prompt = buildStoryUserPrompt(batch.blocks, batch.metadata);
        enqueueSummaryTask({
            kind: blockTypes.STORY,
            label: `旧正文补课 ${index + 1}/${batches.length}`,
            prompt,
            systemPrompt: buildStageSystemPrompt(),
            sourceHashes: batch.blocks.map(block => block.hash),
            sourceMessageIds: batch.blocks.map(block => block.messageId),
            trigger: 'backfill',
            metadata: batch.metadata,
        });
    }
    renderAll(`已加入 ${batches.length} 个旧正文补课任务。`);
}

async function maybeRunAutoSummary() {
    const state = ensureState();
    if (!state.automation.enabled || isBusy) {
        return;
    }

    scanBakemonoBlocks({ persist: false });
    const targets = getUnsummarizedStoryBlocks();
    if (!targets.length) {
        return;
    }

    const signature = getHash(targets.map(block => block.hash).join('|'));
    if (signature === state.automation.lastSignature) {
        return;
    }

    const shouldTrigger = isAutoThresholdReached(targets);
    if (!shouldTrigger) {
        return;
    }

    state.automation.lastSignature = signature;
    saveState();
    if (state.automation.mode === 'draft') {
        await generateStageDraft({ automatic: true });
    } else {
        renderAll(`自动总结提醒：已有 ${targets.length} 个未总结片段。`);
        toastr.info('已达到自动总结条件，可以生成阶段总结草稿。', '剧情剪辑台');
    }
}

function isAutoThresholdReached(targets) {
    const state = ensureState();
    if (state.automation.triggerType === 'chars') {
        const totalLength = targets.reduce((sum, block) => sum + String(block.content || '').length, 0);
        return totalLength >= Number(state.automation.charInterval || defaultAutomation.charInterval);
    }
    return targets.length >= Number(state.automation.floorInterval || defaultAutomation.floorInterval);
}

async function runGeneration(message, action) {
    const toast = toastr.info(message, '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
    renderAll(message);
    setBusy(true);
    try {
        await action();
    } catch (error) {
        console.error('[BakemonoMemory] generation failed', error);
        toastr.error(error?.message || String(error), '剧情剪辑台');
        renderAll(`生成失败：${error?.message || error}`);
    } finally {
        setBusy(false);
        toastr.clear(toast);
    }
}

function setBusy(value) {
    isBusy = value;
    $('#bakemono-memory-generate-stage, #bakemono-memory-generate-epic, #bakemono-memory-backfill, [data-bakemono-action="generate-stage"], [data-bakemono-action="generate-epic"], [data-bakemono-action="backfill"], [data-bakemono-draft-action], [data-bakemono-task-action]').prop('disabled', value);
}

async function callGenerationModel({ prompt, systemPrompt }) {
    const state = ensureState();
    if (state.automation.apiProvider !== 'custom') {
        return await generateRaw({ prompt, systemPrompt });
    }

    const config = state.automation.customApi || {};
    const baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
    const model = String(config.model || '').trim();
    const apiKey = String(config.apiKey || '').trim();
    if (!baseUrl || !model) {
        throw new Error('自定义 API 需要填写 Base URL 和 Model。');
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
            model,
            messages: [
                ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                { role: 'user', content: prompt },
            ],
            temperature: Number(config.temperature ?? defaultAutomation.customApi.temperature),
            max_tokens: Number(config.maxTokens ?? defaultAutomation.customApi.maxTokens),
        }),
    });
    if (!response.ok) {
        throw new Error(`自定义 API 请求失败：${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
    if (!content) {
        throw new Error('自定义 API 没有返回可用内容。');
    }
    return content;
}

function createDraft({ kind, content, sourceHashes = [], sourceStageHashes = [], sourceMessageIds = [], prompt = '', trigger = 'manual', metadata = {} }) {
    const state = ensureState();
    const createdAt = new Date().toISOString();
    const id = `draft-${getHash(`${kind}|${createdAt}|${content}`)}`;
    const fallbackTitle = metadata?.suggestedTitle || getDefaultDraftTitle(kind, state);
    const draft = {
        id,
        kind,
        title: metadata?.lockTitle ? fallbackTitle : getBlockTitle(content, fallbackTitle),
        content,
        sourceHashes,
        sourceStageHashes,
        sourceMessageIds,
        prompt,
        trigger,
        metadata,
        createdAt,
        provider: state.automation.apiProvider || 'tavern',
    };
    state.drafts.unshift(draft);
    return draft;
}

function getDefaultDraftTitle(kind, state = ensureState()) {
    if (kind === blockTypes.STORY) {
        return `剧情摘要草稿 ${state.storySummaries.length + 1}`;
    }
    if (kind === blockTypes.EPIC) {
        return `纪元回溯草稿 ${state.epicSummaries.length + 1}`;
    }
    return `剧集终了草稿 ${state.stageSummaries.length + 1}`;
}

function commitDraft(draftId, editedContent = null) {
    const state = ensureState();
    const draftIndex = state.drafts.findIndex(draft => draft.id === draftId);
    if (draftIndex < 0) {
        toastr.warning('没有找到这个草稿。');
        return;
    }

    const draft = state.drafts[draftIndex];
    const content = normalizeGeneratedBakemono(editedContent ?? draft.content);
    const titleText = String(draft.title || getDefaultDraftTitle(draft.kind, state)).trim();
    const hash = getHash(content);
    const sourceStart = getSourceStart(draft.sourceMessageIds || []);
    const sourceEnd = getSourceEnd(draft.sourceMessageIds || []);
    const sourceSortKey = Number.isFinite(Number(draft.metadata?.sourceSortKey))
        ? Number(draft.metadata.sourceSortKey)
        : sourceStart;
    const summary = {
        hash,
        type: draft.kind,
        title: titleText || getBlockTitle(content, getDefaultDraftTitle(draft.kind, state)),
        content,
        sourceHashes: draft.sourceHashes || [],
        sourceStageHashes: draft.sourceStageHashes || [],
        sourceMessageIds: draft.sourceMessageIds || [],
        sourceStart,
        sourceEnd,
        sourceSortKey,
        metadata: draft.metadata || {},
        createdAt: new Date().toISOString(),
        draftId: draft.id,
    };

    const block = {
        hash,
        type: draft.kind,
        messageId: Number.isFinite(sourceSortKey) && sourceSortKey < Number.MAX_SAFE_INTEGER ? sourceSortKey : Number.MAX_SAFE_INTEGER,
        blockIndex: getSummaryIndexForKind(draft.kind, state) + 1,
        title: summary.title,
        content,
        sourceHashes: summary.sourceHashes,
        sourceStageHashes: summary.sourceStageHashes,
        sourceMessageIds: summary.sourceMessageIds,
        sourceSortKey,
        isGeneratedSummary: true,
        isHidden: false,
    };

    if (draft.kind === blockTypes.STORY) {
        state.storySummaries.push(summary);
        sortSummariesBySource(state.storySummaries);
    } else if (draft.kind === blockTypes.EPIC) {
        state.epicSummaries.push(summary);
        sortSummariesBySource(state.epicSummaries);
        state.coveredStageHashes = unique([...state.coveredStageHashes, ...(draft.sourceStageHashes || [])]);
    } else {
        state.stageSummaries.push(summary);
        sortSummariesBySource(state.stageSummaries);
        state.coveredBlockHashes = unique([...state.coveredBlockHashes, ...(draft.sourceHashes || [])]);
    }

    state.blocks = mergeBlocks(state.blocks, [block]);
    state.drafts.splice(draftIndex, 1);
    state.history.unshift({
        id: `commit-${getHash(`${draft.id}|${summary.createdAt}`)}`,
        kind: draft.kind,
        summaryHash: hash,
        draft,
        summary,
        coveredBlockHashes: draft.kind === blockTypes.STAGE ? (draft.sourceHashes || []) : [],
        coveredStageHashes: draft.kind === blockTypes.EPIC ? (draft.sourceStageHashes || []) : [],
        createdAt: summary.createdAt,
    });
    updateInjectionFromSummaries();
    saveState();
    renderAll('草稿已确认保存。');
    toastr.success('草稿已保存进长期记忆。');
}

function getSummaryIndexForKind(kind, state = ensureState()) {
    if (kind === blockTypes.STORY) {
        return state.storySummaries.length;
    }
    if (kind === blockTypes.EPIC) {
        return state.epicSummaries.length;
    }
    return state.stageSummaries.length;
}

function discardDraft(draftId) {
    const state = ensureState();
    const before = state.drafts.length;
    state.drafts = state.drafts.filter(draft => draft.id !== draftId);
    if (state.drafts.length !== before) {
        saveState();
        renderAll('草稿已丢弃。');
    }
}

async function regenerateDraft(draftId) {
    const state = ensureState();
    const draft = state.drafts.find(item => item.id === draftId);
    if (!draft) {
        toastr.warning('没有找到这个草稿。');
        return;
    }
    renderAll('正在重新总结草稿，请稍等...');
    await runGeneration('正在重新生成草稿...', async () => {
        const result = normalizeGeneratedBakemono(await callGenerationModel({
            prompt: draft.prompt,
            systemPrompt: draft.kind === blockTypes.EPIC ? buildEpicSystemPrompt() : buildStageSystemPrompt(),
        }));
        draft.content = result;
        draft.title = draft.metadata?.lockTitle ? (draft.title || draft.metadata?.suggestedTitle || getDefaultDraftTitle(draft.kind, state)) : getBlockTitle(result, draft.title);
        draft.createdAt = new Date().toISOString();
        saveState();
        renderAll('草稿已重新生成。');
        toastr.success('草稿已重新生成。');
    });
}

function undoLastCommit() {
    const state = ensureState();
    const commit = state.history.shift();
    if (!commit) {
        toastr.info('暂无可撤回的保存记录。');
        return;
    }

    removeSummaryByHash(commit.kind, commit.summaryHash);
    state.blocks = state.blocks.filter(block => block.hash !== commit.summaryHash);
    state.coveredBlockHashes = state.coveredBlockHashes.filter(hash => !(commit.coveredBlockHashes || []).includes(hash));
    state.coveredStageHashes = state.coveredStageHashes.filter(hash => !(commit.coveredStageHashes || []).includes(hash));
    state.drafts.unshift(commit.draft);
    updateInjectionFromSummaries();
    saveState();
    renderAll('已撤回上次保存，原草稿已放回草稿箱。');
    toastr.success('已撤回上次保存。');
}

function removeSummaryByHash(kind, hash) {
    const state = ensureState();
    if (kind === blockTypes.STORY) {
        state.storySummaries = state.storySummaries.filter(summary => summary.hash !== hash);
    } else if (kind === blockTypes.EPIC) {
        state.epicSummaries = state.epicSummaries.filter(summary => summary.hash !== hash);
    } else {
        state.stageSummaries = state.stageSummaries.filter(summary => summary.hash !== hash);
    }
}

function normalizeGeneratedBakemono(result) {
    const state = ensureState();
    const includeTags = unique([...parseList(state.scanRules.includeTags), 'bakemono']).join(',');
    const blocks = extractConfiguredSegments(result, {
        ...state.scanRules,
        mode: 'tag',
        includeTags,
        excludeTags: '',
    });
    if (blocks.length) {
        return blocks[0].content;
    }
    return `<bakemono>\n${String(result || '').trim()}\n</bakemono>`;
}

function buildStageSystemPrompt() {
    return '你是剧情剪辑台的总结器。严格遵守用户提供的总结模板；只总结输入材料，不续写剧情，不扮演角色，不新增事件；不要输出寒暄、解释或 Markdown 代码围栏。';
}

function buildEpicSystemPrompt() {
    return buildStageSystemPrompt();
}

function buildStageUserPrompt(blocks) {
    return renderGenerationPrompt(ensureState().generationPrompts.stage, blocks);
}

function buildEpicUserPrompt(blocks) {
    return renderGenerationPrompt(ensureState().generationPrompts.epic, blocks);
}

function buildStoryUserPrompt(blocks, context = {}) {
    return renderGenerationPrompt(ensureState().generationPrompts.story || defaultStoryGenerationPrompt, blocks, context);
}

function renderGenerationPrompt(template, blocks, context = {}) {
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

function formatBlocksForPrompt(blocks, context = {}) {
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

function updateInjectionFromSummaries() {
    const state = ensureState();
    const latestEpic = state.epicSummaries.at(-1)?.content || '';
    const stageContents = state.stageSummaries.map(item => item.content);

    state.generatedMemory = [
        latestEpic ? '## 纪元回溯\n' + latestEpic : '',
        stageContents.length ? '## 剧集终了\n' + stageContents.join('\n\n') : '',
    ].filter(Boolean).join('\n\n').trim();
    syncInjection();
}

function syncInjection() {
    const state = ensureState();
    const content = renderInjectionContent(state);
    state.injection.content = content;
    const value = state.injection.enabled ? content : '';
    setExtensionPrompt(
        INJECTION_KEY,
        value,
        extension_prompt_types.IN_CHAT,
        Number(state.injection.depth ?? defaultState.injection.depth),
        false,
        Number(state.injection.role ?? extension_prompt_roles.SYSTEM),
    );
}

function renderInjectionContent(state = ensureState()) {
    const memory = String(state.generatedMemory || '').trim();
    const template = String(state.injection.template || defaultInjectionTemplate);
    if (!memory) {
        return '';
    }
    return template.includes('{{memory}}') ? template.replaceAll('{{memory}}', memory).trim() : `${template.trim()}\n\n${memory}`.trim();
}

async function hideCoveredMessages() {
    scanBakemonoBlocks({ persist: false });
    const state = ensureState();
    const covered = new Set(state.coveredBlockHashes);
    const summaryMessageIds = unique(state.blocks
        .filter(block => block.type === blockTypes.STORY && covered.has(block.hash) && Number.isFinite(block.messageId))
        .map(block => block.messageId));
    const messageIds = collectHideMessageIds(summaryMessageIds);

    if (!messageIds.length) {
        renderAll('没有可隐藏的已总结楼层。');
        toastr.info('没有可隐藏的已总结楼层。');
        return;
    }

    for (const messageId of messageIds) {
        await hideChatMessageRange(messageId, messageId, false);
    }

    state.hiddenMessageIds = unique([...state.hiddenMessageIds, ...messageIds]);
    saveState();
    scanBakemonoBlocks({ persist: false });
    renderAll(`已隐藏 ${messageIds.length} 个已总结楼层。`);
    toastr.success(`已隐藏 ${messageIds.length} 个楼层。`);
}

function collectHideMessageIds(summaryMessageIds) {
    const ids = new Set();
    for (const messageId of summaryMessageIds) {
        if (!chat[messageId]) {
            continue;
        }

        ids.add(messageId);
        const pairedUserId = findPairedUserMessageId(messageId);
        if (pairedUserId !== null) {
            ids.add(pairedUserId);
        }
    }

    return [...ids].sort((a, b) => a - b);
}

function findPairedUserMessageId(messageId) {
    for (let index = messageId - 1; index >= 0; index--) {
        const message = chat[index];
        if (!message) {
            continue;
        }
        if (message.is_user) {
            return index;
        }
        if (!message.is_system) {
            return null;
        }
    }
    return null;
}

async function restoreHiddenMessages() {
    const state = ensureState();
    const messageIds = unique(state.hiddenMessageIds).filter(messageId => chat[messageId]);

    if (!messageIds.length) {
        state.hiddenMessageIds = [];
        saveState();
        renderAll('没有可恢复的隐藏楼层。');
        toastr.info('没有可恢复的隐藏楼层。');
        return;
    }

    for (const messageId of messageIds) {
        await hideChatMessageRange(messageId, messageId, true);
    }

    state.hiddenMessageIds = [];
    await saveChatConditional();
    saveState();
    scanBakemonoBlocks({ persist: false });
    renderAll(`已恢复 ${messageIds.length} 个楼层。`);
    toastr.success(`已恢复 ${messageIds.length} 个楼层。`);
}

function unique(values) {
    return [...new Set(values)];
}

function renderAll(statusText = '') {
    const state = ensureState();
    const storyBlocks = getStoryBlocks();
    const stageBlocks = [
        ...getBlocksByType(blockTypes.STAGE),
        ...state.stageSummaries.map(summaryToBlock),
    ];
    const epicBlocks = [
        ...getBlocksByType(blockTypes.EPIC),
        ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
    ];
    const dedupedStageBlocks = dedupeByHash(stageBlocks);
    const dedupedEpicBlocks = dedupeByHash(epicBlocks);

    $('#bakemono-memory-count-story').text(storyBlocks.length);
    $('#bakemono-memory-count-stage').text(dedupedStageBlocks.length);
    $('#bakemono-memory-count-epic').text(dedupedEpicBlocks.length);
    $('#bakemono-memory-count-drafts').text(state.drafts.length);
    $('#bakemono-memory-tab-count-story').text(storyBlocks.length);
    $('#bakemono-memory-tab-count-stage').text(dedupedStageBlocks.length);
    $('#bakemono-memory-tab-count-epic').text(dedupedEpicBlocks.length);
    $('#bakemono-memory-count-hidden').text(state.hiddenMessageIds.length);
    $('#bakemono-memory-injection-enabled').prop('checked', !!state.injection.enabled);
    $('#bakemono-memory-depth').val(state.injection.depth);
    $('#bakemono-memory-role').val(String(state.injection.role));
    $('#bakemono-memory-source-content').val(state.generatedMemory || '');
    $('#bakemono-memory-injection-template').val(state.injection.template || defaultInjectionTemplate);
    $('#bakemono-memory-injection-content').val(renderInjectionContent(state));
    $('#bakemono-memory-story-prompt').val(state.generationPrompts.story || defaultStoryGenerationPrompt);
    $('#bakemono-memory-stage-prompt').val(state.generationPrompts.stage || defaultStageGenerationPrompt);
    $('#bakemono-memory-epic-prompt').val(state.generationPrompts.epic || defaultEpicGenerationPrompt);
    $('#bakemono-memory-scan-mode').val(state.scanRules.mode || defaultScanRules.mode);
    $('#bakemono-memory-include-tags').val(state.scanRules.includeTags || defaultScanRules.includeTags);
    $('#bakemono-memory-exclude-tags').val(state.scanRules.excludeTags || defaultScanRules.excludeTags);
    $('#bakemono-memory-full-min-length').val(state.scanRules.fullTextMinLength ?? defaultScanRules.fullTextMinLength);
    $('#bakemono-memory-class-story').val(state.classificationRules.story || defaultClassificationRules.story);
    $('#bakemono-memory-class-stage').val(state.classificationRules.stage || defaultClassificationRules.stage);
    $('#bakemono-memory-class-epic').val(state.classificationRules.epic || defaultClassificationRules.epic);
    $('#bakemono-memory-layout-story').val(state.previewLayouts.story || defaultPreviewLayouts.story);
    $('#bakemono-memory-layout-stage').val(state.previewLayouts.stage || defaultPreviewLayouts.stage);
    $('#bakemono-memory-layout-epic').val(state.previewLayouts.epic || defaultPreviewLayouts.epic);
    $('#bakemono-memory-auto-enabled').prop('checked', !!state.automation.enabled);
    $('#bakemono-memory-auto-mode').val(state.automation.mode || defaultAutomation.mode);
    $('#bakemono-memory-auto-trigger').val(state.automation.triggerType || defaultAutomation.triggerType);
    $('#bakemono-memory-auto-floor-interval').val(state.automation.floorInterval ?? defaultAutomation.floorInterval);
    $('#bakemono-memory-auto-char-interval').val(state.automation.charInterval ?? defaultAutomation.charInterval);
    $('#bakemono-memory-backfill-batch-size').val(state.automation.backfillBatchSize ?? defaultAutomation.backfillBatchSize);
    $('#bakemono-memory-api-provider').val(state.automation.apiProvider || defaultAutomation.apiProvider);
    $('#bakemono-memory-custom-base-url').val(state.automation.customApi?.baseUrl || '');
    $('#bakemono-memory-custom-api-key').val(state.automation.customApi?.apiKey || '');
    $('#bakemono-memory-custom-model').val(state.automation.customApi?.model || '');
    $('#bakemono-memory-custom-temperature').val(state.automation.customApi?.temperature ?? defaultAutomation.customApi.temperature);
    $('#bakemono-memory-custom-max-tokens').val(state.automation.customApi?.maxTokens ?? defaultAutomation.customApi.maxTokens);
    renderPromptPresetControls();

    renderPreviewSections(storyBlocks, dedupedStageBlocks, dedupedEpicBlocks);
    renderScanPreview();
    renderDrafts();
    renderHistory();
    renderTaskQueue();
    renderTimeline();

    const injected = state.injection.enabled && renderInjectionContent(state) ? '注入开启' : '注入为空或关闭';
    $('#bakemono-memory-status-line').text(statusText || `${injected}。上次扫描：${state.lastScanAt ? new Date(state.lastScanAt).toLocaleString() : '尚未扫描'}。`);
    $('#bakemono-memory-injection-badge').text(statusText || injected);
}

function renderPreviewSections(storyBlocks = getStoryBlocks(), stageBlocks = null, epicBlocks = null) {
    const state = ensureState();
    const dedupedStageBlocks = stageBlocks || dedupeByHash([
        ...getBlocksByType(blockTypes.STAGE),
        ...state.stageSummaries.map(summaryToBlock),
    ]);
    const dedupedEpicBlocks = epicBlocks || dedupeByHash([
        ...getBlocksByType(blockTypes.EPIC),
        ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
    ]);

    syncPreviewTypeUi();
    renderList('#bakemono-memory-preview-story', preparePreviewBlocks(storyBlocks), 'story');
    renderList('#bakemono-memory-preview-stage', preparePreviewBlocks(dedupedStageBlocks), 'stage');
    renderList('#bakemono-memory-preview-epic', preparePreviewBlocks(dedupedEpicBlocks), 'epic');
}

function preparePreviewBlocks(blocks) {
    const query = normalizeSearchText($('#bakemono-memory-preview-filter').val() || '');
    const order = String($('#bakemono-memory-preview-order').val() || 'desc');
    const filtered = query
        ? blocks.filter(block => normalizeSearchText(`${getPreviewSummaryText(block)}\n${block.title}\n${parsePreviewMeta(block).meta}\n${parsePreviewMeta(block).submeta}\n${stripHtml(block.content)}`).includes(query))
        : [...blocks];
    filtered.sort((a, b) => (getBlockSortKey(a) - getBlockSortKey(b)) || (a.blockIndex - b.blockIndex));
    if (order === 'desc') {
        filtered.reverse();
    }
    return filtered;
}

function syncPreviewTypeUi() {
    document.querySelectorAll('.bakemono-preview-type-button').forEach(button => {
        button.classList.toggle('is-active', button.dataset.bakemonoPreviewType === previewState.activeType);
    });
    const grid = document.querySelector('.bakemono-memory-preview-grid');
    grid?.setAttribute('data-bakemono-active-preview', previewState.activeType);
    document.querySelectorAll('.bakemono-memory-preview-column').forEach(column => {
        column.classList.toggle('is-active', column.dataset.bakemonoPreviewColumn === previewState.activeType);
    });
}

function renderScanPreview() {
    const state = ensureState();
    const container = document.querySelector('#bakemono-memory-scan-preview');
    if (!container) {
        return;
    }

    container.innerHTML = '';
    if (!state.scanPreview.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无扫描预览。点击“扫描预览”后会显示命中的片段。';
        container.append(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    state.scanPreview.forEach(item => {
        const wrapper = document.createElement('div');
        wrapper.className = 'bakemono-memory-debug-item';

        const meta = document.createElement('div');
        meta.className = 'bakemono-memory-debug-meta';
        meta.textContent = `#${item.messageId}.${item.blockIndex + 1} · ${item.scanMode} · <${item.matchedTag}> · ${item.type}`;

        const text = document.createElement('div');
        text.className = 'bakemono-memory-debug-text';
        text.textContent = item.preview;

        wrapper.append(meta, text);
        fragment.append(wrapper);
    });
    container.append(fragment);
}

function renderDrafts() {
    const state = ensureState();
    const container = document.querySelector('#bakemono-memory-draft-list');
    if (!container) {
        return;
    }

    container.innerHTML = '';
    if (!state.drafts.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无待确认草稿。自动总结和手动生成都会先放在这里。';
        container.append(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    state.drafts.forEach(draft => {
        const card = document.createElement('section');
        card.className = 'bakemono-memory-draft-card';
        card.dataset.draftId = draft.id;

        const header = document.createElement('div');
        header.className = 'bakemono-memory-draft-header';
        const titleWrap = document.createElement('label');
        titleWrap.className = 'bakemono-memory-draft-title-field';
        const titleLabel = document.createElement('span');
        titleLabel.textContent = getKindLabel(draft.kind);
        const titleInput = document.createElement('input');
        titleInput.className = 'text_pole bakemono-memory-draft-title';
        titleInput.type = 'text';
        titleInput.value = draft.title || '';
        titleInput.placeholder = '草稿标题';
        titleWrap.append(titleLabel, titleInput);
        const meta = document.createElement('span');
        const draftMeta = draft.metadata?.sourceRange
            ? `${draft.metadata.sourceRange}${draft.metadata.batchIndex ? ` · 第 ${draft.metadata.batchIndex}/${draft.metadata.batchTotal || '?'} 批` : ''}`
            : '';
        meta.textContent = [draft.trigger || 'manual', draftMeta, draft.createdAt ? new Date(draft.createdAt).toLocaleString() : ''].filter(Boolean).join(' · ');
        header.append(titleWrap, meta);

        const textarea = document.createElement('textarea');
        textarea.className = 'text_pole textarea_compact bakemono-memory-draft-editor';
        textarea.rows = 9;
        textarea.spellcheck = false;
        textarea.value = draft.content || '';

        const actions = document.createElement('div');
        actions.className = 'bakemono-memory-inline-actions bakemono-memory-draft-actions';
        actions.innerHTML = `
            <button class="menu_button" data-bakemono-draft-action="commit"><i class="fa-solid fa-check"></i><span>确认保存</span></button>
            <button class="menu_button" data-bakemono-draft-action="regenerate"><i class="fa-solid fa-rotate"></i><span>重新总结</span></button>
            <button class="menu_button danger_button" data-bakemono-draft-action="discard"><i class="fa-solid fa-trash"></i><span>丢弃草稿</span></button>
        `;

        card.append(header, textarea, actions);
        fragment.append(card);
    });
    container.append(fragment);
}

function renderHistory() {
    const state = ensureState();
    const container = document.querySelector('#bakemono-memory-history-list');
    if (!container) {
        return;
    }

    container.innerHTML = '';
    if (!state.history.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无保存记录。';
        container.append(empty);
        return;
    }

    const pageCount = Math.max(1, Math.ceil(state.history.length / historyPageSize));
    historyState.page = Math.min(Math.max(0, historyState.page || 0), pageCount - 1);
    const start = historyState.page * historyPageSize;
    const visibleHistory = state.history.slice(start, start + historyPageSize);

    const controls = document.createElement('div');
    controls.className = 'bakemono-memory-preview-pager bakemono-memory-history-pager';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'menu_button bakemono-preview-page-button';
    prev.dataset.bakemonoHistoryPage = 'prev';
    prev.disabled = historyState.page <= 0;
    prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i><span>上一页</span>';

    const info = document.createElement('span');
    info.className = 'bakemono-memory-preview-page-info';
    info.textContent = `${start + 1}-${Math.min(start + historyPageSize, state.history.length)} / ${state.history.length}`;

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'menu_button bakemono-preview-page-button';
    next.dataset.bakemonoHistoryPage = 'next';
    next.disabled = historyState.page >= pageCount - 1;
    next.innerHTML = '<span>下一页</span><i class="fa-solid fa-chevron-right"></i>';

    controls.append(prev, info, next);
    container.append(controls);

    const fragment = document.createDocumentFragment();
    visibleHistory.forEach(item => {
        const row = document.createElement('div');
        row.className = 'bakemono-memory-history-item';
        const kind = document.createElement('strong');
        kind.textContent = getKindLabel(item.kind);
        const title = document.createElement('span');
        title.textContent = item.summary?.title || item.draft?.title || item.summaryHash;
        const time = document.createElement('time');
        time.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
        row.append(kind, title, time);
        fragment.append(row);
    });
    container.append(fragment);
}

function renderTaskQueue() {
    const state = ensureState();
    const container = document.querySelector('#bakemono-memory-task-list');
    if (!container) {
        return;
    }

    container.innerHTML = '';
    if (!state.taskQueue.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无任务。生成阶段总结、史诗简史或旧正文补课时，会先进入这里排队。';
        container.append(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    state.taskQueue.slice().reverse().forEach(task => {
        const row = document.createElement('div');
        row.className = `bakemono-memory-task-item is-${task.status || 'queued'}`;
        row.dataset.taskId = task.id;

        const main = document.createElement('div');
        main.className = 'bakemono-memory-task-main';
        const title = document.createElement('strong');
        title.textContent = task.label || getKindLabel(task.kind);
        const meta = document.createElement('span');
        meta.textContent = `${getTaskStatusLabel(task.status)} · ${task.createdAt ? new Date(task.createdAt).toLocaleString() : ''}`;
        main.append(title, meta);
        if (task.error) {
            const error = document.createElement('em');
            error.textContent = task.error;
            main.append(error);
        }

        const actions = document.createElement('div');
        actions.className = 'bakemono-memory-task-actions';
        if (task.status === 'failed') {
            actions.innerHTML = '<button class="menu_button" data-bakemono-task-action="retry"><i class="fa-solid fa-rotate"></i><span>重试</span></button>';
        }
        if (task.status !== 'running') {
            actions.insertAdjacentHTML('beforeend', '<button class="menu_button" data-bakemono-task-action="remove"><i class="fa-solid fa-xmark"></i><span>移除</span></button>');
        }
        row.append(main, actions);
        fragment.append(row);
    });
    container.append(fragment);
}

function getTaskStatusLabel(status) {
    return {
        queued: '等待中',
        running: '生成中',
        done: '已完成',
        failed: '失败',
    }[status] || '等待中';
}

function renderTimeline() {
    const container = document.querySelector('#bakemono-memory-timeline');
    if (!container) {
        return;
    }

    const state = ensureState();
    const storyBlocks = getStoryBlocks();
    const stageBlocks = dedupeByHash([
        ...getBlocksByType(blockTypes.STAGE),
        ...state.stageSummaries.map(summaryToBlock),
    ]);
    const epicBlocks = dedupeByHash([
        ...getBlocksByType(blockTypes.EPIC),
        ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
    ]);
    const byHash = new Map([...storyBlocks, ...stageBlocks, ...epicBlocks].map(block => [block.hash, block]));

    container.innerHTML = '';
    if (!storyBlocks.length && !stageBlocks.length && !epicBlocks.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无摘要树。扫描或保存草稿后会显示覆盖关系。';
        container.append(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const epic of state.epicSummaries) {
        fragment.append(createTimelineNode(epic, 'epic', state.stageSummaries
            .filter(stage => (epic.sourceStageHashes || epic.sourceHashes || []).includes(stage.hash))
            .map(stage => createTimelineNode(stage, 'stage', (stage.sourceHashes || []).map(hash => byHash.get(hash)).filter(Boolean).map(story => createTimelineNode(story, 'story'))))));
    }

    const epicCoveredStage = new Set(state.epicSummaries.flatMap(summary => summary.sourceStageHashes || summary.sourceHashes || []));
    for (const stage of state.stageSummaries.filter(summary => !epicCoveredStage.has(summary.hash))) {
        fragment.append(createTimelineNode(stage, 'stage', (stage.sourceHashes || []).map(hash => byHash.get(hash)).filter(Boolean).map(story => createTimelineNode(story, 'story'))));
    }

    const coveredStory = new Set(state.stageSummaries.flatMap(summary => summary.sourceHashes || []));
    for (const story of storyBlocks.filter(block => !coveredStory.has(block.hash))) {
        fragment.append(createTimelineNode(story, 'story'));
    }

    container.append(fragment);
}

function createTimelineNode(item, kind, children = []) {
    const details = document.createElement('details');
    details.className = `bakemono-memory-timeline-node is-${kind}`;
    if (kind !== 'story') {
        details.open = true;
    }

    const summary = document.createElement('summary');
    const label = document.createElement('strong');
    label.textContent = `${getKindLabel(kind)} · ${item.title || getBlockTitle(item.content, '未命名')}`;
    const meta = document.createElement('span');
    const sourceCount = Array.isArray(item.sourceHashes) ? item.sourceHashes.length : 0;
    meta.textContent = getTimelineMetaText(item, sourceCount);
    summary.append(label, meta);
    details.append(summary);

    if (children.length) {
        const childWrap = document.createElement('div');
        childWrap.className = 'bakemono-memory-timeline-children';
        children.forEach(child => childWrap.append(child));
        details.append(childWrap);
    }
    return details;
}

function getTimelineMetaText(item, sourceCount = 0) {
    if (sourceCount) {
        const sourceRange = formatMessageIdRange(item.sourceMessageIds || []);
        return sourceRange ? `覆盖 ${sourceCount} 个片段 · 来源${sourceRange}` : `覆盖 ${sourceCount} 个片段`;
    }
    if (item.sourceMessageIds?.length) {
        return `来源${formatMessageIdRange(item.sourceMessageIds)}`;
    }
    if (isVirtualMessageId(item.messageId)) {
        return item.createdAt ? `记忆摘要 · ${new Date(item.createdAt).toLocaleString()}` : '记忆摘要';
    }
    return `楼层 ${item.messageId}`;
}

function isVirtualMessageId(messageId) {
    return !Number.isFinite(messageId) || messageId >= Number.MAX_SAFE_INTEGER;
}

function formatMessageIdRange(messageIds = []) {
    const ids = unique(messageIds.filter(id => Number.isFinite(id) && !isVirtualMessageId(id)).map(Number)).sort((a, b) => a - b);
    if (!ids.length) {
        return '';
    }
    if (ids.length === 1) {
        return `楼层 ${ids[0]}`;
    }
    return `楼层 ${ids[0]}-${ids.at(-1)}`;
}

function getKindLabel(kind) {
    if (kind === blockTypes.STORY) {
        return '剧情摘要';
    }
    if (kind === blockTypes.EPIC) {
        return '史诗简史';
    }
    return '阶段总结';
}

function renderPromptPresetControls() {
    const select = document.querySelector('#bakemono-memory-preset-select');
    if (!select) {
        return;
    }

    const selectedId = getSelectedPromptPresetId();
    select.innerHTML = '';
    for (const preset of getPromptPresets()) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name || '未命名预设';
        select.append(option);
    }
    select.value = selectedId;

    const selected = getPromptPresets().find(preset => preset.id === select.value);
    $('#bakemono-memory-preset-name').val(selected?.name || '');
}

function getCurrentPromptPresetPayload(name = '') {
    const state = ensureState();
    return {
        id: makePresetId(name),
        name: name || '未命名预设',
        story: String($('#bakemono-memory-story-prompt').val() || defaultStoryGenerationPrompt),
        stage: String($('#bakemono-memory-stage-prompt').val() || defaultStageGenerationPrompt),
        epic: String($('#bakemono-memory-epic-prompt').val() || defaultEpicGenerationPrompt),
        scanRules: structuredClone(state.scanRules),
        classificationRules: structuredClone(state.classificationRules),
        previewLayouts: structuredClone(state.previewLayouts),
        automation: {
            ...structuredClone(state.automation),
            lastSignature: '',
            lastAutoAt: null,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

function normalizeImportedPreset(value) {
    const parsed = JSON.parse(value);
    const preset = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!preset || typeof preset !== 'object') {
        throw new Error('导入内容不是有效的预设对象。');
    }
    if (!preset.stage || !preset.epic) {
        throw new Error('预设需要包含 stage 和 epic 两段提示词。');
    }
    const name = String(preset.name || '导入预设');
    return {
        id: makePresetId(name),
        name,
        story: String(preset.story || defaultStoryGenerationPrompt),
        stage: String(preset.stage),
        epic: String(preset.epic),
        scanRules: preset.scanRules && typeof preset.scanRules === 'object' ? preset.scanRules : null,
        classificationRules: preset.classificationRules && typeof preset.classificationRules === 'object' ? preset.classificationRules : null,
        previewLayouts: preset.previewLayouts && typeof preset.previewLayouts === 'object' ? preset.previewLayouts : null,
        automation: preset.automation && typeof preset.automation === 'object' ? preset.automation : null,
        createdAt: preset.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

function dedupeByHash(blocks) {
    return [...new Map(blocks.map(block => [block.hash, block])).values()];
}

function renderList(selector, blocks, type = 'story') {
    const container = document.querySelector(selector);
    if (!container) {
        return;
    }

    container.innerHTML = '';
    if (!blocks.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无内容';
        container.append(empty);
        return;
    }

    const pageCount = Math.max(1, Math.ceil(blocks.length / previewPageSize));
    previewState.pages[type] = Math.min(Math.max(0, previewState.pages[type] || 0), pageCount - 1);
    const page = previewState.pages[type];
    const start = page * previewPageSize;
    const visibleBlocks = blocks.slice(start, start + previewPageSize);

    const controls = document.createElement('div');
    controls.className = 'bakemono-memory-preview-pager';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'menu_button bakemono-preview-page-button';
    prev.dataset.bakemonoPreviewPage = 'prev';
    prev.dataset.bakemonoPreviewType = type;
    prev.disabled = page <= 0;
    prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i><span>上一组</span>';

    const info = document.createElement('span');
    info.className = 'bakemono-memory-preview-page-info';
    info.textContent = `${start + 1}-${Math.min(start + previewPageSize, blocks.length)} / ${blocks.length}`;

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'menu_button bakemono-preview-page-button';
    next.dataset.bakemonoPreviewPage = 'next';
    next.dataset.bakemonoPreviewType = type;
    next.disabled = page >= pageCount - 1;
    next.innerHTML = '<span>下一组</span><i class="fa-solid fa-chevron-right"></i>';

    controls.append(prev, info, next);
    container.append(controls);

    const fragment = document.createDocumentFragment();
    visibleBlocks.forEach((block, index) => {
        fragment.append(createBakemonoNotebook(block, start + index));
    });

    container.append(fragment);
}

function switchWorkbenchTab(tabName) {
    const root = document.getElementById('bakemono-workbench-root');
    if (!root) {
        return;
    }
    root.querySelectorAll('.bakemono-workbench-tab').forEach(tab => {
        tab.classList.toggle('is-active', tab.dataset.bakemonoTab === tabName);
    });
    root.querySelectorAll('.bakemono-workbench-panel').forEach(panel => {
        panel.classList.toggle('is-active', panel.dataset.bakemonoPanel === tabName);
    });
}

async function runWorkbenchAction(action) {
    if (action === 'scan') {
        scanBakemonoBlocks();
    } else if (action === 'generate-stage') {
        await generateStageDraft();
    } else if (action === 'generate-epic') {
        await generateEpicDraft();
    } else if (action === 'backfill') {
        await generateBackfillQueue();
    } else if (action === 'undo') {
        undoLastCommit();
    } else if (action === 'clear-queue') {
        clearFinishedQueueTasks();
    } else if (action === 'clear-history') {
        clearHistoryRecords();
    } else if (action === 'hide') {
        await hideCoveredMessages();
    } else if (action === 'restore') {
        await restoreHiddenMessages();
    }
}

function bindSettingsEvents() {
    $('#bakemono-memory-close, [data-bakemono-close]').off('click').on('click', () => closeWorkbench());
    $('.bakemono-workbench-tab').off('click').on('click', function () {
        switchWorkbenchTab(this.dataset.bakemonoTab);
    });
    $('#bakemono-workbench-root').off('click.bakemonoNav').on('click.bakemonoNav', '[data-bakemono-nav]', function () {
        switchWorkbenchTab(this.dataset.bakemonoNav);
    });
    $('#bakemono-workbench-root').off('click.bakemonoAction').on('click.bakemonoAction', '[data-bakemono-action]', async function () {
        await runWorkbenchAction(this.dataset.bakemonoAction);
    });
    $('#bakemono-workbench-root').off('click.bakemonoDraftAction').on('click.bakemonoDraftAction', '[data-bakemono-draft-action]', async function () {
        if (isBusy) {
            toastr.info('已有总结任务正在进行，请稍等。');
            return;
        }
        const card = this.closest('.bakemono-memory-draft-card');
        const draftId = card?.dataset.draftId;
        if (!draftId) {
            return;
        }
        const action = this.dataset.bakemonoDraftAction;
        const draft = ensureState().drafts.find(item => item.id === draftId);
        if (draft) {
            draft.title = String(card.querySelector('.bakemono-memory-draft-title')?.value || draft.title || '').trim();
        }
        if (action === 'commit') {
            renderAll('正在保存草稿...');
            commitDraft(draftId, card.querySelector('.bakemono-memory-draft-editor')?.value || '');
        } else if (action === 'regenerate') {
            this.disabled = true;
            renderAll('正在重新总结草稿，请稍等...');
            await regenerateDraft(draftId);
        } else if (action === 'discard') {
            renderAll('正在丢弃草稿...');
            discardDraft(draftId);
        }
    });
    $('#bakemono-workbench-root').off('input.bakemonoDraftTitle').on('input.bakemonoDraftTitle', '.bakemono-memory-draft-title', function () {
        const draftId = this.closest('.bakemono-memory-draft-card')?.dataset.draftId;
        const draft = ensureState().drafts.find(item => item.id === draftId);
        if (!draft) {
            return;
        }
        draft.title = String(this.value || '').trim();
        saveState();
    });
    $('#bakemono-workbench-root').off('click.bakemonoTaskAction').on('click.bakemonoTaskAction', '[data-bakemono-task-action]', function () {
        const row = this.closest('.bakemono-memory-task-item');
        const taskId = row?.dataset.taskId;
        if (!taskId) {
            return;
        }
        if (this.dataset.bakemonoTaskAction === 'retry') {
            retryQueueTask(taskId);
        } else if (this.dataset.bakemonoTaskAction === 'remove') {
            removeQueueTask(taskId);
        }
    });
    $('#bakemono-workbench-root').off('click.bakemonoPreviewType').on('click.bakemonoPreviewType', '[data-bakemono-preview-type]', function () {
        previewState.activeType = this.dataset.bakemonoPreviewType || 'story';
        renderPreviewSections();
    });
    $('#bakemono-workbench-root').off('click.bakemonoPreviewPage').on('click.bakemonoPreviewPage', '[data-bakemono-preview-page]', function () {
        const type = this.dataset.bakemonoPreviewType || previewState.activeType;
        const direction = this.dataset.bakemonoPreviewPage === 'next' ? 1 : -1;
        previewState.pages[type] = Math.max(0, (previewState.pages[type] || 0) + direction);
        previewState.activeType = type;
        renderPreviewSections();
    });
    $('#bakemono-workbench-root').off('click.bakemonoHistoryPage').on('click.bakemonoHistoryPage', '[data-bakemono-history-page]', function () {
        const direction = this.dataset.bakemonoHistoryPage === 'next' ? 1 : -1;
        historyState.page = Math.max(0, (historyState.page || 0) + direction);
        renderHistory();
    });
    $('#bakemono-workbench-root').off('click.bakemonoNotebook').on('click.bakemonoNotebook', '.bk-tab-label', function () {
        const layout = this.closest('.bk-tabs-layout');
        if (!layout) {
            return;
        }
        const panelId = this.dataset.bakemonoPanel;
        layout.querySelectorAll('.bk-tab-label').forEach(tab => tab.classList.toggle('is-active', tab === this));
        layout.querySelectorAll('.bk-tab-panel').forEach(panel => panel.classList.toggle('is-active', panel.dataset.bakemonoPanel === panelId));
    });
    $('#bakemono-memory-apply-injection').off('click').on('click', () => {
        const state = ensureState();
        state.generatedMemory = String($('#bakemono-memory-source-content').val() || '').trim();
        state.injection.template = String($('#bakemono-memory-injection-template').val() || defaultInjectionTemplate);
        syncInjection();
        saveState();
        renderAll('注入内容已应用。');
        toastr.success('注入内容已应用。');
    });
    $('#bakemono-memory-copy-injection').off('click').on('click', async () => {
        syncInjection();
        const content = String($('#bakemono-memory-injection-content').val() || '');
        await navigator.clipboard.writeText(content);
        toastr.success('注入内容已复制。');
    });
    $('#bakemono-memory-reset-template').off('click').on('click', () => {
        const state = ensureState();
        state.injection.template = defaultInjectionTemplate;
        syncInjection();
        saveState();
        renderAll('注入模板已恢复默认。');
    });
    $('#bakemono-memory-clear-injection').off('click').on('click', () => {
        const state = ensureState();
        state.generatedMemory = '';
        syncInjection();
        saveState();
        renderAll('注入内容已清空。');
    });
    $('#bakemono-memory-apply-prompts').off('click').on('click', () => {
        const state = ensureState();
        state.generationPrompts.story = String($('#bakemono-memory-story-prompt').val() || defaultStoryGenerationPrompt);
        state.generationPrompts.stage = String($('#bakemono-memory-stage-prompt').val() || defaultStageGenerationPrompt);
        state.generationPrompts.epic = String($('#bakemono-memory-epic-prompt').val() || defaultEpicGenerationPrompt);
        saveState();
        renderAll('生成提示词已应用。');
        toastr.success('生成提示词已应用。');
    });
    $('#bakemono-memory-reset-stage-prompt').off('click').on('click', () => {
        const state = ensureState();
        state.generationPrompts.stage = defaultStageGenerationPrompt;
        saveState();
        renderAll('阶段总结提示词已恢复默认。');
    });
    $('#bakemono-memory-reset-epic-prompt').off('click').on('click', () => {
        const state = ensureState();
        state.generationPrompts.epic = defaultEpicGenerationPrompt;
        saveState();
        renderAll('史诗简史提示词已恢复默认。');
    });
    $('#bakemono-memory-reset-story-prompt').off('click').on('click', () => {
        const state = ensureState();
        state.generationPrompts.story = defaultStoryGenerationPrompt;
        saveState();
        renderAll('旧正文摘要提示词已恢复默认。');
    });
    $('#bakemono-memory-apply-automation').off('click').on('click', () => {
        const state = ensureState();
        state.automation = {
            ...state.automation,
            enabled: $('#bakemono-memory-auto-enabled').prop('checked'),
            mode: String($('#bakemono-memory-auto-mode').val() || defaultAutomation.mode),
            triggerType: String($('#bakemono-memory-auto-trigger').val() || defaultAutomation.triggerType),
            floorInterval: Math.max(1, Number($('#bakemono-memory-auto-floor-interval').val() || defaultAutomation.floorInterval)),
            charInterval: Math.max(100, Number($('#bakemono-memory-auto-char-interval').val() || defaultAutomation.charInterval)),
            backfillBatchSize: Math.max(1, Number($('#bakemono-memory-backfill-batch-size').val() || defaultAutomation.backfillBatchSize)),
            apiProvider: String($('#bakemono-memory-api-provider').val() || defaultAutomation.apiProvider),
            customApi: {
                baseUrl: String($('#bakemono-memory-custom-base-url').val() || '').trim(),
                apiKey: String($('#bakemono-memory-custom-api-key').val() || '').trim(),
                model: String($('#bakemono-memory-custom-model').val() || '').trim(),
                temperature: Number($('#bakemono-memory-custom-temperature').val() || defaultAutomation.customApi.temperature),
                maxTokens: Number($('#bakemono-memory-custom-max-tokens').val() || defaultAutomation.customApi.maxTokens),
            },
        };
        saveState();
        renderAll('自动总结设置已应用。');
        toastr.success('自动总结设置已应用。');
    });
    $('#bakemono-memory-preview-filter').off('input').on('input', () => {
        previewState.pages = { story: 0, stage: 0, epic: 0 };
        renderPreviewSections();
    });
    $('#bakemono-memory-preview-order').off('change').on('change', () => {
        previewState.pages = { story: 0, stage: 0, epic: 0 };
        renderPreviewSections();
    });
    $('#bakemono-memory-clear-preview-filter').off('click').on('click', () => {
        $('#bakemono-memory-preview-filter').val('');
        previewState.pages = { story: 0, stage: 0, epic: 0 };
        renderPreviewSections();
    });
    $('#bakemono-memory-preset-select').off('change').on('change', function () {
        setSelectedPromptPresetId(String(this.value || defaultPromptPreset.id));
        renderPromptPresetControls();
    });
    $('#bakemono-memory-load-preset').off('click').on('click', () => {
        const preset = getPromptPresets().find(item => item.id === getSelectedPromptPresetId());
        if (!preset) {
            toastr.warning('没有找到选中的预设。');
            return;
        }
        const state = ensureState();
        state.generationPrompts.story = preset.story || defaultStoryGenerationPrompt;
        state.generationPrompts.stage = preset.stage;
        state.generationPrompts.epic = preset.epic;
        if (preset.scanRules) {
            state.scanRules = { ...structuredClone(defaultScanRules), ...structuredClone(preset.scanRules) };
        }
        if (preset.classificationRules) {
            state.classificationRules = { ...structuredClone(defaultClassificationRules), ...structuredClone(preset.classificationRules) };
        }
        if (preset.previewLayouts) {
            state.previewLayouts = { ...structuredClone(defaultPreviewLayouts), ...structuredClone(preset.previewLayouts) };
        }
        if (preset.automation) {
            state.automation = {
                ...structuredClone(defaultAutomation),
                ...structuredClone(preset.automation),
                lastSignature: state.automation.lastSignature || '',
                lastAutoAt: state.automation.lastAutoAt || null,
            };
        }
        saveState();
        renderAll(`已载入预设：${preset.name}`);
        toastr.success('提示词预设已载入。');
    });
    $('#bakemono-memory-save-preset').off('click').on('click', () => {
        const name = String($('#bakemono-memory-preset-name').val() || '').trim();
        if (!name) {
            toastr.warning('请先填写预设名称。');
            return;
        }
        const presets = getPromptPresets();
        const preset = getCurrentPromptPresetPayload(name);
        presets.push(preset);
        setSelectedPromptPresetId(preset.id);
        saveGlobalSettings();
        renderAll(`已保存预设：${preset.name}`);
        toastr.success('提示词预设已保存。');
    });
    $('#bakemono-memory-delete-preset').off('click').on('click', () => {
        const selectedId = getSelectedPromptPresetId();
        if (selectedId === defaultPromptPreset.id) {
            toastr.warning('默认预设不能删除。');
            return;
        }
        extension_settings[STORAGE_KEY].promptPresets = getPromptPresets().filter(preset => preset.id !== selectedId);
        setSelectedPromptPresetId(defaultPromptPreset.id);
        saveGlobalSettings();
        renderAll('预设已删除。');
    });
    $('#bakemono-memory-export-preset').off('click').on('click', () => {
        const selected = getPromptPresets().find(item => item.id === getSelectedPromptPresetId());
        const preset = getCurrentPromptPresetPayload($('#bakemono-memory-preset-name').val() || selected?.name || '当前工作流');
        $('#bakemono-memory-preset-json').val(JSON.stringify(preset, null, 2));
        toastr.success('预设 JSON 已写入导出框。');
    });
    $('#bakemono-memory-copy-preset').off('click').on('click', async () => {
        let value = String($('#bakemono-memory-preset-json').val() || '');
        if (!value) {
            const selected = getPromptPresets().find(item => item.id === getSelectedPromptPresetId());
            const preset = getCurrentPromptPresetPayload($('#bakemono-memory-preset-name').val() || selected?.name || '当前工作流');
            value = JSON.stringify(preset, null, 2);
            $('#bakemono-memory-preset-json').val(value);
        }
        await navigator.clipboard.writeText(value);
        toastr.success('预设 JSON 已复制。');
    });
    $('#bakemono-memory-import-preset').off('click').on('click', () => {
        try {
            const preset = normalizeImportedPreset(String($('#bakemono-memory-preset-json').val() || ''));
            getPromptPresets().push(preset);
            setSelectedPromptPresetId(preset.id);
            saveGlobalSettings();
            renderAll(`已导入预设：${preset.name}`);
            toastr.success('提示词预设已导入。');
        } catch (error) {
            toastr.error(error?.message || String(error), '导入失败');
        }
    });
    $('#bakemono-memory-apply-rules').off('click').on('click', () => {
        const state = ensureState();
        state.scanRules = {
            mode: String($('#bakemono-memory-scan-mode').val() || defaultScanRules.mode),
            includeTags: String($('#bakemono-memory-include-tags').val() || ''),
            excludeTags: String($('#bakemono-memory-exclude-tags').val() || ''),
            fullTextMinLength: Math.max(0, Number($('#bakemono-memory-full-min-length').val() || defaultScanRules.fullTextMinLength)),
        };
        state.classificationRules = {
            story: String($('#bakemono-memory-class-story').val() || defaultClassificationRules.story),
            stage: String($('#bakemono-memory-class-stage').val() || defaultClassificationRules.stage),
            epic: String($('#bakemono-memory-class-epic').val() || defaultClassificationRules.epic),
        };
        state.previewLayouts = {
            story: String($('#bakemono-memory-layout-story').val() || defaultPreviewLayouts.story),
            stage: String($('#bakemono-memory-layout-stage').val() || defaultPreviewLayouts.stage),
            epic: String($('#bakemono-memory-layout-epic').val() || defaultPreviewLayouts.epic),
        };
        scanBakemonoBlocks({ persist: false });
        saveState();
        renderAll('扫描规则已应用，并已刷新扫描预览。');
        toastr.success('扫描规则已应用。');
    });
    $('#bakemono-memory-reset-rules').off('click').on('click', () => {
        const state = ensureState();
        state.scanRules = structuredClone(defaultScanRules);
        state.classificationRules = structuredClone(defaultClassificationRules);
        state.previewLayouts = structuredClone(defaultPreviewLayouts);
        scanBakemonoBlocks({ persist: false });
        saveState();
        renderAll('扫描规则已恢复默认。');
    });
    $('#bakemono-memory-injection-enabled').off('change').on('change', function () {
        const state = ensureState();
        state.injection.enabled = !!this.checked;
        syncInjection();
        saveState();
        renderAll();
    });
    $('#bakemono-memory-depth').off('input').on('input', function () {
        const state = ensureState();
        state.injection.depth = Math.max(0, Number(this.value || defaultState.injection.depth));
        syncInjection();
        saveState();
    });
    $('#bakemono-memory-role').off('change').on('change', function () {
        const state = ensureState();
        state.injection.role = Number(this.value || extension_prompt_roles.SYSTEM);
        syncInjection();
        saveState();
    });
    $('#bakemono-memory-source-content, #bakemono-memory-injection-template').off('input').on('input', () => {
        const state = ensureState();
        const previewState = {
            ...state,
            generatedMemory: String($('#bakemono-memory-source-content').val() || ''),
            injection: {
                ...state.injection,
                template: String($('#bakemono-memory-injection-template').val() || ''),
            },
        };
        $('#bakemono-memory-injection-content').val(renderInjectionContent(previewState));
    });
}

async function initWorkbench() {
    const response = await fetch(`${extensionFolderPath}/settings.html`);
    if (!response.ok) {
        throw new Error(`Failed to load settings.html: ${response.status} ${response.statusText}`);
    }

    document.getElementById('bakemono-workbench-root')?.remove();
    $('body').append(await response.text());
    await addWandButton();
    bindSettingsEvents();
    renderAll();
}

async function addWandButton() {
    const menu = await waitForElement('#extensionsMenu');
    if (document.getElementById('bakemono-memory-wand-button')) {
        return;
    }

    const button = document.createElement('div');
    button.id = 'bakemono-memory-wand-button';
    button.classList.add('list-group-item', 'flex-container', 'flexGap5');

    const icon = document.createElement('div');
    icon.classList.add('fa-solid', 'fa-clapperboard', 'extensionsMenuExtensionButton');

    const text = document.createElement('span');
    text.textContent = '剧情剪辑台';

    button.append(icon, text);
    button.addEventListener('click', () => openWorkbench());
    menu.append(button);
}

function openWorkbench() {
    scanBakemonoBlocks({ persist: false });
    const root = document.getElementById('bakemono-workbench-root');
    root?.classList.remove('bakemono-workbench-hidden');
    root?.setAttribute('aria-hidden', 'false');
    renderAll();
}

function closeWorkbench() {
    const root = document.getElementById('bakemono-workbench-root');
    root?.classList.add('bakemono-workbench-hidden');
    root?.setAttribute('aria-hidden', 'true');
}

function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(selector);
        if (existing) {
            resolve(existing);
            return;
        }

        const startTime = Date.now();
        const timer = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(timer);
                resolve(element);
                return;
            }

            if (Date.now() - startTime > timeout) {
                clearInterval(timer);
                reject(new Error(`Timed out waiting for ${selector}`));
            }
        }, 100);
    });
}

async function init() {
    ensureGlobalSettings();
    ensureState();
    await initWorkbench();
    syncInjection();

    eventSource.on(event_types.CHAT_CHANGED, () => {
        ensureState();
        syncInjection();
        renderAll();
    });
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        await maybeRunAutoSummary();
        renderAll();
    });
    for (const event of [event_types.MESSAGE_UPDATED, event_types.MESSAGE_DELETED, event_types.MESSAGE_SWIPED]) {
        eventSource.on(event, () => renderAll());
    }
}

jQuery(async () => {
    try {
        await init();
    } catch (error) {
        console.error('[BakemonoMemory] initialization failed', error);
        globalThis.toastr?.error?.(`剧情剪辑台初始化失败：${error?.message || error}`);
    }
});
