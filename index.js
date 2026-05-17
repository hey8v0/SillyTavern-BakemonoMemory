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

const memoryStrategies = {
    BAKEMONO: 'bakemono',
    GENERIC: 'generic',
};

const workflowModes = {
    BAKEMONO: 'bakemono',
    GENERIC: 'generic',
    MIXED: 'mixed',
};

const stageSourceModes = {
    SUMMARIES: 'summaries',
    BACKFILL: 'backfill',
    RAW: 'raw',
    MIXED: 'mixed',
    AUTO: 'auto',
};

const targetSelectionModes = {
    ALL: 'all',
    OLDEST: 'oldest',
    RANGE: 'range',
};

const defaultInjectionTemplate = `【剧情剪辑台：长期剧情记忆】
以下内容是已经压缩整理过的剧情记忆。请把它当作已发生事实与长期线索参考，不要复述给用户，也不要替代当前回合正文。

{{memory}}`;

const defaultScanRules = {
    mode: 'tag',
    includeTags: 'bakemono',
    excludeTags: 'thinking, think, reasoning',
    fullTextMinLength: 20,
    includeHidden: true,
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
【☆『{{suggestedTitle}}』★时间/时间跨度：从正文可判断的时间，未知则写未知★{{sourceRange}}★地点/状态|本批出现角色☆】

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
- 如果正文无法判断时间、日期、地点或天气，写“未知”，不要编造。

以下是需要补课压缩的旧聊天正文：
{{blocks}}`;

const defaultGenericStoryGenerationPrompt = `# 通用旧正文补课摘要
你是“剧情剪辑台”的归档员。请把下面已经发生过的聊天正文压缩成一份可长期保存、可继续用于后续总结的普通摘要。

严格要求：
- 只总结已经发生的内容，不续写，不扮演角色，不新增事件。
- 批次编号、楼层范围、标题必须使用插件给出的元数据，不要自行推断章节号。
- 用清晰的结构化 Markdown 输出。
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
- 不要只写一句总括；重要动作、选择、冲突、转场、后果都要落到具体描述。

## 角色与关系
- 记录本批涉及角色的状态、动机、关系变化。

## 关键话语 / 心理
- 摘录或概括重要台词、心理活动，不要新增原文没有的内容。

## 伏笔与未解事项
- 记录仍未解决的任务、秘密、危险、承诺、线索。

以下是需要补课压缩的旧聊天正文：
{{blocks}}`;

const defaultGenericStageGenerationPrompt = `# 通用阶段总结
请把以下摘要片段合并为一份可长期使用的阶段总结。只总结输入内容，不续写，不新增事件，不替角色做新的决定。

要求：
- 输出清晰的结构化 Markdown。
- 按原始时间顺序整理，不要因为后文更醒目就打乱前后因果。
- 细节保留优先级：影响后续剧情的事件 > 角色关系变化 > 任务/承诺/约定 > 伏笔和未解事项 > 代表性台词。
- 不要过度压缩成抽象主题；需要让未来模型仅凭这份总结就能接上剧情。

# 阶段总结：自定义标题

## 覆盖范围
- 说明本阶段大致覆盖哪些批次 / 楼层 / 时间段。

## 分段剧情脉络
- 按输入片段顺序分段概括，每段写清楚“发生了什么、为什么发生、造成什么变化”。
- 如果某个片段信息量很大，可以拆成多个小点，不要为了简短而丢掉关键细节。

## 角色状态与关系变化
- 逐个记录核心角色的目标、情绪、立场、身体/能力/身份状态变化。
- 记录角色之间的信任、误会、亲密、敌意、交易、承诺等变化。

## 关键场面与话语
- 挑出最关键的场面、对话或心理活动，说明它为什么会影响后续。

## 任务、伏笔与未解事项
- 汇总仍未解决的任务、秘密、风险、承诺、道具、地点线索和关系张力。

## 后续接续提示
- 用简短条目写出下一阶段继续创作时最不能忘的事实。

需要合并的摘要片段：
{{blocks}}`;

const defaultGenericEpicGenerationPrompt = `# 通用全局总结
请把以下阶段总结或摘要片段整理成一份全局回顾。只总结输入内容，不续写，不新增事件，不替角色做新的决定。

要求：
- 输出清晰的结构化 Markdown。
- 先按阶段还原时间线，再提炼转折和长期线索。
- 不要只写宏观评价；必须保留足够多的事件细节、角色关系细节、未解线索，供后续继续剧情使用。
- 信息冲突时，以输入中较新的阶段总结为准，并在相关条目里标注“此前/后来”的变化。

# 全局回顾：自定义标题

## 分阶段时间线
- 按阶段顺序整理到目前为止发生过的主要事件。
- 每个阶段都写清关键事件链、直接后果，以及它如何影响下一阶段。

## 决定性转折
- 选出真正改变剧情走向、角色关系或世界状态的关键时刻，并说明影响。

## 核心角色弧光与关系网
- 对比核心角色最初状态、重要转折点和当前状态。
- 汇总重要关系的变化：信任、隐瞒、依赖、对立、亏欠、承诺。

## 长期线索
- 汇总仍然重要的伏笔、秘密、目标、危险和关系张力。

## 当前局面
- 总结当前时间点的地点、阵营/关系状态、正在进行的目标、迫近风险。

## 后续创作备忘
- 列出未来回复最应遵守的连续性事实，避免遗忘或前后矛盾。

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
    memoryStrategy: memoryStrategies.BAKEMONO,
    workflowMode: workflowModes.BAKEMONO,
    stageSourceMode: stageSourceModes.SUMMARIES,
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
        includeHidden: true,
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
    memoryStrategy: memoryStrategies.GENERIC,
    workflowMode: workflowModes.GENERIC,
    stageSourceMode: stageSourceModes.BACKFILL,
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
    autoHidePreserveRecent: 2,
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

const defaultGenerationTargets = {
    stage: {
        mode: targetSelectionModes.ALL,
        count: 20,
        range: '',
    },
    epic: {
        mode: targetSelectionModes.ALL,
        count: 5,
        range: '',
    },
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
    customHiddenMessageIds: [],
    memoryStrategy: memoryStrategies.BAKEMONO,
    workflowMode: workflowModes.BAKEMONO,
    stageSourceMode: stageSourceModes.SUMMARIES,
    outputMode: 'bakemono',
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
    generationTargets: defaultGenerationTargets,
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
const timelinePageSize = 25;
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
const timelineState = {
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
            preset.memoryStrategy = defaultGenericPromptPreset.memoryStrategy;
            preset.workflowMode = defaultGenericPromptPreset.workflowMode;
            preset.stageSourceMode = defaultGenericPromptPreset.stageSourceMode;
        }
        if (preset.id === defaultPromptPreset.id) {
            preset.memoryStrategy = defaultPromptPreset.memoryStrategy;
            preset.scanRules = structuredClone(defaultPromptPreset.scanRules);
            preset.outputMode = defaultPromptPreset.outputMode;
            preset.workflowMode = defaultPromptPreset.workflowMode;
            preset.stageSourceMode = defaultPromptPreset.stageSourceMode;
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
    if (String(state.generationPrompts.story || '').includes('可以不用 <bakemono> 标签，也不用 HTML')) {
        state.generationPrompts.story = defaultGenericStoryGenerationPrompt;
        state.generationPrompts.stage = defaultGenericStageGenerationPrompt;
        state.generationPrompts.epic = defaultGenericEpicGenerationPrompt;
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
    const rawGeneratedMemory = String(state.generatedMemory || state.injection?.content || '');
    state.generatedMemory = normalizeInjectionMemoryBody(rawGeneratedMemory, state.injection?.template);
    if (rawGeneratedMemory.trim() && rawGeneratedMemory.trim() !== state.generatedMemory) {
        state.injection.content = renderInjectionContent(state);
        saveState();
    }
    state.coveredBlockHashes = Array.isArray(state.coveredBlockHashes) ? state.coveredBlockHashes : [];
    state.coveredStageHashes = Array.isArray(state.coveredStageHashes) ? state.coveredStageHashes : [];
    state.hiddenMessageIds = Array.isArray(state.hiddenMessageIds) ? state.hiddenMessageIds : [];
    state.customHiddenMessageIds = Array.isArray(state.customHiddenMessageIds) ? state.customHiddenMessageIds : [];
    if (!Object.values(memoryStrategies).includes(state.memoryStrategy)) {
        state.memoryStrategy = memoryStrategies.BAKEMONO;
    }
    if (!Object.values(workflowModes).includes(state.workflowMode)) {
        state.workflowMode = state.memoryStrategy === memoryStrategies.GENERIC ? workflowModes.GENERIC : workflowModes.BAKEMONO;
    }
    if (!Object.values(stageSourceModes).includes(state.stageSourceMode)) {
        state.stageSourceMode = state.workflowMode === workflowModes.GENERIC ? stageSourceModes.BACKFILL : stageSourceModes.SUMMARIES;
    }
    if (!['bakemono', 'plain', 'custom'].includes(state.outputMode)) {
        state.outputMode = state.workflowMode === workflowModes.GENERIC ? 'plain' : 'bakemono';
    }
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
    state.generationTargets = state.generationTargets && typeof state.generationTargets === 'object'
        ? state.generationTargets
        : structuredClone(defaultGenerationTargets);
    for (const [kind, defaults] of Object.entries(defaultGenerationTargets)) {
        state.generationTargets[kind] = state.generationTargets[kind] && typeof state.generationTargets[kind] === 'object'
            ? state.generationTargets[kind]
            : structuredClone(defaults);
        for (const [key, value] of Object.entries(defaults)) {
            if (state.generationTargets[kind][key] === undefined) {
                state.generationTargets[kind][key] = structuredClone(value);
            }
        }
    }

    return state;
}

function normalizeLineEndings(value) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripLeadingText(value, prefix) {
    let text = normalizeLineEndings(value).trim();
    const normalizedPrefix = normalizeLineEndings(prefix).trim();
    if (!normalizedPrefix) {
        return text;
    }

    while (text.startsWith(normalizedPrefix)) {
        text = text.slice(normalizedPrefix.length).trim();
    }
    return text;
}

function stripTrailingText(value, suffix) {
    let text = normalizeLineEndings(value).trim();
    const normalizedSuffix = normalizeLineEndings(suffix).trim();
    if (!normalizedSuffix) {
        return text;
    }

    while (text.endsWith(normalizedSuffix)) {
        text = text.slice(0, -normalizedSuffix.length).trim();
    }
    return text;
}

function normalizeInjectionMemoryBody(value, template = defaultInjectionTemplate) {
    let text = normalizeLineEndings(value).trim();
    if (!text) {
        return '';
    }

    const templates = unique([template, defaultInjectionTemplate].map(item => normalizeLineEndings(item || '')).filter(Boolean));
    for (const currentTemplate of templates) {
        if (currentTemplate.includes('{{memory}}')) {
            const [prefix, ...rest] = currentTemplate.split('{{memory}}');
            text = stripLeadingText(text, prefix);
            text = stripTrailingText(text, rest.join('{{memory}}'));
        } else {
            text = stripLeadingText(text, currentTemplate);
        }
    }

    return text.trim();
}

function confirmDanger(title, lines = [], confirmText = '确认继续吗？') {
    return window.confirm([
        title,
        ...lines.filter(Boolean),
        '',
        confirmText,
    ].join('\n'));
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
    container.append(header, layout, createSavedSummaryControls(block));
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

    details.append(summary, body, createSavedSummaryControls(block));
    return details;
}

function createSavedSummaryControls(block) {
    const saved = findSavedSummaryByHash(block.hash);
    if (!saved) {
        return document.createDocumentFragment();
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'bakemono-memory-summary-tools';
    wrapper.dataset.summaryHash = block.hash;
    wrapper.innerHTML = `
        <div class="bakemono-memory-inline-actions">
            <button class="menu_button" data-bakemono-summary-action="edit"><i class="fa-solid fa-pen"></i><span>编辑摘要</span></button>
            <button class="menu_button" data-bakemono-summary-action="more"><i class="fa-solid fa-ellipsis"></i><span>更多</span></button>
        </div>
        <div class="bakemono-memory-summary-editor" hidden>
            <label class="bakemono-memory-field"><span>标题</span><input class="text_pole bakemono-summary-title" type="text"></label>
            <label class="bakemono-memory-editor"><span>正文</span><textarea class="text_pole textarea_compact bakemono-summary-content" rows="8" spellcheck="false"></textarea></label>
            <div class="bakemono-memory-inline-actions">
                <button class="menu_button" data-bakemono-summary-action="save"><i class="fa-solid fa-check"></i><span>保存修改</span></button>
                <button class="menu_button" data-bakemono-summary-action="cancel"><i class="fa-solid fa-xmark"></i><span>取消</span></button>
            </div>
        </div>
        <details class="bakemono-memory-danger-zone">
            <summary>危险操作</summary>
            <button class="menu_button danger_button" data-bakemono-summary-action="delete"><i class="fa-solid fa-trash"></i><span>删除摘要</span></button>
        </details>
    `;
    wrapper.querySelector('.bakemono-summary-title').value = saved.summary.title || '';
    wrapper.querySelector('.bakemono-summary-content').value = saved.summary.content || '';
    wrapper.querySelector('.bakemono-memory-danger-zone').hidden = true;
    return wrapper;
}

function getMessageVariantKey(message) {
    if (!message || typeof message !== 'object') {
        return '';
    }
    if (message.swipe_id !== undefined) {
        return `swipe:${message.swipe_id}`;
    }
    if (message.swipeId !== undefined) {
        return `swipe:${message.swipeId}`;
    }
    if (Array.isArray(message.swipes) && message.mes) {
        const index = message.swipes.indexOf(message.mes);
        if (index >= 0) {
            return `swipe:${index}`;
        }
    }
    return '';
}

function getSegmentSourceKind(segment) {
    if (segment?.mode !== 'full') {
        return 'tag';
    }
    const includeTags = parseList(ensureState().scanRules.includeTags).map(tag => tag.toLowerCase());
    const matchedTag = String(segment.matchedTag || '').toLowerCase();
    return includeTags.includes(matchedTag) ? 'tag' : 'raw';
}

function shouldPersistScannedBlock(block, state = ensureState()) {
    if (block.sourceKind !== 'raw') {
        return true;
    }
    return state.workflowMode !== workflowModes.GENERIC
        || [stageSourceModes.RAW, stageSourceModes.MIXED, stageSourceModes.AUTO].includes(state.stageSourceMode);
}

function scanBakemonoBlocks({ persist = true } = {}) {
    const state = ensureState();
    const scanned = [];
    const scannedForBlocks = [];
    const preview = [];
    const previousBlocks = state.blocks;
    const context = getContext();
    const sourceChat = context.chat || chat || [];
    const rules = state.scanRules;
    const includeHidden = rules.includeHidden !== false;

    sourceChat.forEach((message, messageId) => {
        if (!message?.mes || (message.is_system && !includeHidden)) {
            return;
        }
        extractConfiguredSegments(message?.mes, rules).forEach((segment, blockIndex) => {
            const content = segment.content;
            const sourceKind = getSegmentSourceKind(segment);
            const variantKey = getMessageVariantKey(message);
            const hash = getHash(`${segment.mode}|${segment.matchedTag}|${sourceKind}|${messageId}|${variantKey}|${blockIndex}|${content}`);
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
                sourceKind,
                sourceIdentity: `${messageId}:${variantKey}:${segment.mode}:${segment.matchedTag}:${blockIndex}`,
                isHidden: !!message?.is_system,
            };
            scanned.push(block);
            if (shouldPersistScannedBlock(block, state)) {
                scannedForBlocks.push(block);
            }
            preview.push({
                hash,
                type,
                messageId,
                blockIndex,
                matchedTag: segment.matchedTag,
                scanMode: segment.mode,
                sourceKind,
                title: block.title,
                isHidden: !!message?.is_system,
                preview: toPlainPreview(content, 180),
            });
        });
    });

    state.blocks = mergeBlocks(state.blocks, scannedForBlocks, state, { replaceScanned: true });
    for (const block of scannedForBlocks) {
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

function getSourceMessageIdsFromBlocks(blocks = []) {
    return unique(blocks.flatMap(block => getFiniteMessageIds([block?.messageId, ...(block?.sourceMessageIds || [])])));
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

function isPersistentMemoryBlock(block, state = ensureState()) {
    const summaryHashes = new Set([
        ...state.storySummaries,
        ...state.stageSummaries,
        ...state.epicSummaries,
    ].map(summary => summary.hash));
    return !!block?.isGeneratedSummary
        || summaryHashes.has(block?.hash)
        || (Number(block?.messageId) >= Number.MAX_SAFE_INTEGER && ((block?.sourceHashes || []).length || (block?.sourceStageHashes || []).length));
}

function mergeBlocks(existing, scanned, state = ensureState(), options = {}) {
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
        } else if (!options.replaceScanned || isPersistentMemoryBlock(block, state)) {
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

function getStageSourceMode(state = ensureState()) {
    if (Object.values(stageSourceModes).includes(state.stageSourceMode)) {
        return state.stageSourceMode;
    }
    return state.workflowMode === workflowModes.GENERIC ? stageSourceModes.BACKFILL : stageSourceModes.SUMMARIES;
}

function isRawSourceBlock(block) {
    return block?.sourceKind === 'raw' || (block?.scanMode === 'full' && !block?.isGeneratedSummary && !block?.matchedTag);
}

function isBackfillSummary(block) {
    return !!block?.isGeneratedSummary && (block?.metadata?.sourceKind === 'backfill' || block?.metadata?.trigger === 'backfill' || block?.trigger === 'backfill');
}

function getStoryMaterialBlocks(mode = getStageSourceMode()) {
    const state = ensureState();
    const scanned = getBlocksByType(blockTypes.STORY);
    const saved = state.storySummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.STORY }));
    const summaryLikeScanned = scanned.filter(block => !isRawSourceBlock(block));
    const rawScanned = scanned.filter(isRawSourceBlock);

    if (mode === stageSourceModes.BACKFILL) {
        return dedupeByHash(saved);
    }
    if (mode === stageSourceModes.RAW) {
        return dedupeByHash(rawScanned);
    }
    if (mode === stageSourceModes.MIXED) {
        return dedupeByHash([...summaryLikeScanned, ...saved, ...rawScanned]);
    }
    if (mode === stageSourceModes.AUTO) {
        const summaryBlocks = dedupeByHash([...summaryLikeScanned, ...saved]);
        return summaryBlocks.length ? summaryBlocks : dedupeByHash(rawScanned);
    }
    return dedupeByHash([...summaryLikeScanned, ...saved]);
}

function getUnsummarizedStoryBlocks() {
    const state = ensureState();
    const covered = new Set(state.coveredBlockHashes);
    return getStoryMaterialBlocks().filter(block => !covered.has(block.hash));
}

function getUnsummarizedStageBlocks() {
    const state = ensureState();
    const covered = new Set(state.coveredStageHashes);
    return dedupeByHash([
        ...getBlocksByType(blockTypes.STAGE),
        ...state.stageSummaries.map(summaryToBlock),
    ]).filter(block => !covered.has(block.hash));
}

function getSortedTargetBlocks(blocks = []) {
    return [...blocks].sort((a, b) => (getBlockSortKey(a) - getBlockSortKey(b)) || (a.blockIndex - b.blockIndex));
}

function parseLooseNumberRange(value) {
    const ids = new Set();
    const invalid = [];
    for (const rawPart of String(value || '').split(/[,，\s]+/).map(item => item.trim()).filter(Boolean)) {
        const match = rawPart.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!match) {
            invalid.push(rawPart);
            continue;
        }
        let start = Number(match[1]);
        let end = Number(match[2] || match[1]);
        if (start > end) {
            [start, end] = [end, start];
        }
        for (let id = Math.max(0, start); id <= end; id++) {
            ids.add(id);
        }
    }
    return { ids, invalid };
}

function blockTouchesRange(block, ids) {
    const sourceIds = getFiniteMessageIds([block?.messageId, ...(block?.sourceMessageIds || [])]);
    return sourceIds.some(id => ids.has(id));
}

function selectGenerationTargets(blocks = [], config = {}) {
    const sorted = getSortedTargetBlocks(blocks);
    const mode = Object.values(targetSelectionModes).includes(config.mode) ? config.mode : targetSelectionModes.ALL;
    if (mode === targetSelectionModes.OLDEST) {
        const count = Math.max(1, Number(config.count || 1));
        return sorted.slice(0, count);
    }
    if (mode === targetSelectionModes.RANGE) {
        const { ids } = parseLooseNumberRange(config.range || '');
        if (!ids.size) {
            return sorted;
        }
        return sorted.filter(block => blockTouchesRange(block, ids));
    }
    return sorted;
}

function getAutoStageTargets(targets = []) {
    const state = ensureState();
    const sorted = getSortedTargetBlocks(targets);
    if (state.automation.triggerType === 'chars') {
        const limit = Math.max(100, Number(state.automation.charInterval || defaultAutomation.charInterval));
        const selected = [];
        let totalLength = 0;
        for (const block of sorted) {
            selected.push(block);
            totalLength += String(block.content || '').length;
            if (totalLength >= limit) {
                break;
            }
        }
        return selected.length ? selected : sorted.slice(0, 1);
    }
    const count = Math.max(1, Number(state.automation.floorInterval || defaultAutomation.floorInterval));
    return sorted.slice(0, count);
}

function readGenerationTargetSettings() {
    const state = ensureState();
    const readKind = kind => ({
        mode: String($(`#bakemono-memory-${kind}-target-mode`).val() || state.generationTargets[kind]?.mode || defaultGenerationTargets[kind].mode),
        count: Math.max(1, Number($(`#bakemono-memory-${kind}-target-count`).val() || state.generationTargets[kind]?.count || defaultGenerationTargets[kind].count)),
        range: String($(`#bakemono-memory-${kind}-target-range`).val() || '').trim(),
    });
    state.generationTargets = {
        stage: readKind('stage'),
        epic: readKind('epic'),
    };
    saveState();
    return state.generationTargets;
}

function getTargetSelectionLabel(kind, selectedLength, totalLength) {
    const state = ensureState();
    const config = state.generationTargets?.[kind] || defaultGenerationTargets[kind];
    const modeLabels = {
        [targetSelectionModes.ALL]: '全部',
        [targetSelectionModes.OLDEST]: `最早 ${config.count || defaultGenerationTargets[kind].count} 个`,
        [targetSelectionModes.RANGE]: `楼层 ${config.range || '未填写'}`,
    };
    return `${modeLabels[config.mode] || '全部'}：${selectedLength}/${totalLength} 个`;
}

function inferNextRange(range) {
    const match = String(range || '').trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) {
        return '';
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return '';
    }
    const left = Math.min(start, end);
    const right = Math.max(start, end);
    const nextStart = right + 1;
    const nextEnd = right + Math.max(1, right - left);
    return `${nextStart}-${nextEnd}`;
}

function parseGenerationTargetInput(input, fallbackConfig = {}) {
    const text = String(input || '').trim();
    if (!text) {
        return null;
    }
    if (/^(all|全部)$/i.test(text)) {
        return {
            ...fallbackConfig,
            mode: targetSelectionModes.ALL,
        };
    }
    const oldest = text.match(/^(?:oldest|前|最早|n)\s*[:：]?\s*(\d+)$/i);
    if (oldest) {
        return {
            ...fallbackConfig,
            mode: targetSelectionModes.OLDEST,
            count: Math.max(1, Number(oldest[1])),
        };
    }
    const range = text.match(/^(?:range|楼层|范围)?\s*[:：]?\s*(\d+(?:\s*-\s*\d+)?(?:[,\s，]+\d+(?:\s*-\s*\d+)?)*)$/i);
    if (range) {
        return {
            ...fallbackConfig,
            mode: targetSelectionModes.RANGE,
            range: range[1].trim(),
        };
    }
    return null;
}

function promptGenerationTargetSelection(kind, totalLength) {
    const state = ensureState();
    const defaults = defaultGenerationTargets[kind] || defaultGenerationTargets.stage;
    const current = {
        ...defaults,
        ...(state.generationTargets?.[kind] || {}),
    };
    const kindLabel = kind === 'epic' ? '史诗简史' : '阶段总结';
    const suggestedRange = current.mode === targetSelectionModes.RANGE
        ? (inferNextRange(current.range) || current.range || defaults.range)
        : (current.range || defaults.range);
    return new Promise(resolve => {
        document.querySelector('.bakemono-memory-target-dialog')?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'bakemono-memory-target-dialog';
        overlay.innerHTML = `
            <section class="bakemono-memory-target-box" role="dialog" aria-modal="true">
                <header>
                    <div>
                        <span>生成范围</span>
                        <h3>${kindLabel}</h3>
                    </div>
                    <button type="button" class="menu_button" data-bakemono-target-cancel><i class="fa-solid fa-xmark"></i></button>
                </header>
                <div class="bakemono-memory-target-body">
                    <p>本次可用材料：${totalLength} 个。你可以只合并一部分，避免一次压得太简洁。</p>
                    <label class="bakemono-memory-field">
                        <span>读取范围</span>
                        <select class="text_pole" data-bakemono-target-mode>
                            <option value="all">全部未总结内容</option>
                            <option value="oldest">最早 N 个</option>
                            <option value="range">指定来源楼层</option>
                        </select>
                    </label>
                    <div class="bakemono-memory-editor-grid bakemono-memory-mini-grid">
                        <label class="bakemono-memory-field">
                            <span>N 个</span>
                            <input class="text_pole" data-bakemono-target-count type="number" min="1" step="1">
                        </label>
                        <label class="bakemono-memory-field">
                            <span>来源楼层</span>
                            <input class="text_pole" data-bakemono-target-range type="text" placeholder="例如 0-20, 80-120">
                        </label>
                    </div>
                    <div class="bakemono-memory-prompt-hint" data-bakemono-target-hint></div>
                </div>
                <footer class="bakemono-memory-inline-actions">
                    <button type="button" class="menu_button" data-bakemono-target-cancel><i class="fa-solid fa-ban"></i><span>取消</span></button>
                    <button type="button" class="menu_button" data-bakemono-target-confirm><i class="fa-solid fa-check"></i><span>使用这个范围</span></button>
                </footer>
            </section>
        `;

        const modeInput = overlay.querySelector('[data-bakemono-target-mode]');
        const countInput = overlay.querySelector('[data-bakemono-target-count]');
        const rangeInput = overlay.querySelector('[data-bakemono-target-range]');
        const hint = overlay.querySelector('[data-bakemono-target-hint]');

        modeInput.value = current.mode || targetSelectionModes.ALL;
        countInput.value = current.count || defaults.count;
        rangeInput.value = current.mode === targetSelectionModes.RANGE
            ? (suggestedRange || current.range || '0-20')
            : (current.range || '');

        const close = value => {
            overlay.remove();
            resolve(value);
        };
        const syncHint = () => {
            const mode = modeInput.value;
            countInput.disabled = mode !== targetSelectionModes.OLDEST;
            rangeInput.disabled = mode !== targetSelectionModes.RANGE;
            if (mode === targetSelectionModes.RANGE && !rangeInput.value.trim()) {
                rangeInput.value = suggestedRange || '0-20';
            }
            hint.textContent = mode === targetSelectionModes.RANGE && current.range
                ? `上次范围：${current.range}。已为你推导到：${rangeInput.value || suggestedRange}，可以直接修改。`
                : mode === targetSelectionModes.OLDEST
                    ? '会按来源楼层从早到晚取前 N 个。'
                    : '会合并当前所有尚未进入上层总结的内容。';
        };

        overlay.querySelectorAll('[data-bakemono-target-cancel]').forEach(button => {
            button.addEventListener('click', () => close(null));
        });
        overlay.querySelector('[data-bakemono-target-confirm]').addEventListener('click', () => {
            const parsed = {
                ...current,
                mode: Object.values(targetSelectionModes).includes(modeInput.value) ? modeInput.value : targetSelectionModes.ALL,
                count: Math.max(1, Number(countInput.value || current.count || defaults.count)),
                range: String(rangeInput.value || '').trim(),
            };
            if (parsed.mode === targetSelectionModes.RANGE && !parseLooseNumberRange(parsed.range).ids.size) {
                toastr.warning('请填写可识别的楼层范围，例如 0-20 或 0-20, 35-50。');
                return;
            }
            state.generationTargets[kind] = parsed;
            $(`#bakemono-memory-${kind}-target-mode`).val(parsed.mode);
            $(`#bakemono-memory-${kind}-target-count`).val(parsed.count);
            $(`#bakemono-memory-${kind}-target-range`).val(parsed.range);
            saveState();
            close(parsed);
        });
        modeInput.addEventListener('change', syncHint);
        syncHint();

        const host = document.getElementById('bakemono-workbench-root') || document.body;
        host.append(overlay);
        modeInput.focus();
    });
}

function confirmGenerationTargets(kind, targets, totalLength) {
    const state = ensureState();
    const kindLabel = kind === 'epic' ? '史诗简史' : '阶段总结';
    const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
    const confirmed = confirmDanger(
        `生成【${kindLabel}】草稿？`,
        [
            `本次范围：${getTargetSelectionLabel(kind, targets.length, totalLength)}`,
            `来源：${formatSourceRange(sourceMessageIds)}`,
            '生成结果会先进入草稿箱，确认保存后才会写入长期记忆。',
        ],
        '确认生成吗？',
    );
    if (!confirmed) {
        renderAll(`已取消${kindLabel}生成。`);
    }
    return confirmed;
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
        sourceKind: summary.sourceKind || summary.metadata?.sourceKind || summary.metadata?.trigger || 'summary',
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
        const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
        const sourceSortKey = getSourceStart(sourceMessageIds);
        state.stageSummaries.push({
            hash,
            type: blockTypes.STAGE,
            title: getBlockTitle(result, `剧集终了 ${state.stageSummaries.length + 1}`),
            content: result,
            sourceHashes: targets.map(block => block.hash),
            sourceMessageIds,
            sourceStart: getSourceStart(sourceMessageIds),
            sourceEnd: getSourceEnd(sourceMessageIds),
            sourceSortKey,
            sourceKind: 'stage',
            createdAt: new Date().toISOString(),
        });
        state.coveredBlockHashes = unique([...state.coveredBlockHashes, ...targets.map(block => block.hash)]);
        state.blocks = mergeBlocks(state.blocks, [{
            hash,
            type: blockTypes.STAGE,
            messageId: Number.isFinite(sourceSortKey) && sourceSortKey < Number.MAX_SAFE_INTEGER ? sourceSortKey : Number.MAX_SAFE_INTEGER,
            blockIndex: state.stageSummaries.length,
            title: getBlockTitle(result, `剧集终了 ${state.stageSummaries.length}`),
            content: result,
            sourceHashes: targets.map(block => block.hash),
            sourceMessageIds,
            sourceSortKey,
            sourceKind: 'stage',
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
    const storyFallback = getStoryMaterialBlocks().filter(block => !state.coveredBlockHashes.includes(block.hash));
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
    let createdDrafts = 0;
    let autoCommitted = 0;
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
                const draft = createDraft({
                    kind: task.kind,
                    content: result,
                    sourceHashes: task.sourceHashes || [],
                    sourceStageHashes: task.sourceStageHashes || [],
                    sourceMessageIds: task.sourceMessageIds || [],
                    prompt: task.prompt,
                    trigger: task.trigger || 'manual',
                    metadata: task.metadata || {},
                });
                if (task.trigger === 'auto' && state.automation.mode === 'commit_hide' && task.kind === blockTypes.STAGE) {
                    commitDraft(draft.id, draft.content, { silent: true });
                    autoCommitted += 1;
                    const preserveRecent = Math.max(0, Number(state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent));
                    task.metadata = {
                        ...(task.metadata || {}),
                        autoCommitted: true,
                        autoHiddenPreserveRecent: preserveRecent,
                    };
                    await hideCoveredMessages({ confirm: false, preserveRecent, silent: true });
                    toastr.info(`自动阶段总结已保存进长期记忆，并已隐藏被覆盖楼层（保留最近 ${preserveRecent} 楼）。`, '剧情剪辑台');
                } else {
                    createdDrafts += 1;
                }
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
        if (createdDrafts) {
            switchWorkbenchTab('drafts');
        }
        const message = autoCommitted && !createdDrafts
            ? `任务队列处理完成，已自动保存 ${autoCommitted} 个阶段总结并收纳旧楼层。`
            : autoCommitted
                ? `任务队列处理完成，已自动保存 ${autoCommitted} 个阶段总结，另有 ${createdDrafts} 个草稿待确认。`
                : '任务队列处理完成，生成结果已进入草稿箱。';
        renderAll(message);
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
    const task = state.taskQueue.find(item => item.id === taskId);
    const confirmed = confirmDanger(
        `移除任务「${task?.label || '未命名任务'}」？`,
        ['任务移除后不会删除已保存摘要，但这个队列项无法从队列中恢复。'],
    );
    if (!confirmed) {
        return;
    }
    state.taskQueue = state.taskQueue.filter(task => task.id !== taskId);
    saveState();
    renderAll('任务已从队列移除。');
}

function clearFinishedQueueTasks() {
    const state = ensureState();
    const count = state.taskQueue.filter(task => ['done', 'failed'].includes(task.status)).length;
    if (!count) {
        toastr.info('没有可清理的完成/失败队列记录。');
        return;
    }
    const confirmed = confirmDanger(
        `清理 ${count} 条完成/失败队列记录？`,
        ['只会清理队列记录，不会删除已保存摘要。'],
    );
    if (!confirmed) {
        return;
    }
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
    const state = ensureState();
    const allTargets = getUnsummarizedStoryBlocks();
    if (!allTargets.length) {
        renderAll('没有新的剧情摘要需要生成阶段总结。');
        toastr.info('没有新的剧情摘要需要生成阶段总结。');
        return;
    }
    let targetConfig = state.generationTargets.stage;
    if (!options.automatic) {
        readGenerationTargetSettings();
        targetConfig = await promptGenerationTargetSelection('stage', allTargets.length);
        if (!targetConfig) {
            renderAll('已取消阶段总结生成。');
            return;
        }
    }
    const targets = options.automatic
        ? getAutoStageTargets(allTargets)
        : selectGenerationTargets(allTargets, targetConfig);
    if (!targets.length) {
        renderAll('当前生成范围没有匹配到可总结摘要。');
        toastr.warning('当前生成范围没有匹配到可总结摘要。');
        return;
    }
    if (!options.automatic && !confirmGenerationTargets('stage', targets, allTargets.length)) {
        return;
    }

    const prompt = buildStageUserPrompt(targets);
    const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
    enqueueSummaryTask({
        kind: blockTypes.STAGE,
        label: `阶段总结 · ${targets.length} 个片段`,
        prompt,
        systemPrompt: buildStageSystemPrompt(),
        sourceHashes: targets.map(block => block.hash),
        sourceMessageIds,
        trigger: options.automatic ? 'auto' : 'manual',
        metadata: {
            sourceRange: formatSourceRange(sourceMessageIds),
            sourceStart: getSourceStart(sourceMessageIds),
            sourceEnd: getSourceEnd(sourceMessageIds),
            sourceSortKey: getSourceStart(sourceMessageIds),
            sourceMode: getStageSourceMode(),
            selectionLabel: options.automatic
                ? `自动取最早一批：${targets.length}/${allTargets.length} 个`
                : getTargetSelectionLabel('stage', targets.length, allTargets.length),
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
    const allStageTargets = getUnsummarizedStageBlocks();
    const allStoryFallback = getStoryMaterialBlocks().filter(block => !state.coveredBlockHashes.includes(block.hash));
    if (!allStageTargets.length && !allStoryFallback.length) {
        renderAll('没有可用于生成史诗简史的总结内容。');
        toastr.info('没有可用于生成史诗简史的总结内容。');
        return;
    }
    let targetConfig = state.generationTargets.epic;
    if (!options.automatic) {
        readGenerationTargetSettings();
        targetConfig = await promptGenerationTargetSelection('epic', allStageTargets.length || allStoryFallback.length);
        if (!targetConfig) {
            renderAll('已取消史诗简史生成。');
            return;
        }
    }
    const stageTargets = selectGenerationTargets(allStageTargets, targetConfig);
    const storyFallback = selectGenerationTargets(allStoryFallback, targetConfig);
    const targets = stageTargets.length ? stageTargets : storyFallback;

    if (!targets.length) {
        renderAll('当前生成范围没有匹配到可用于史诗简史的内容。');
        toastr.warning('当前生成范围没有匹配到可用于史诗简史的内容。');
        return;
    }

    if (!options.automatic) {
        const latestEpicAt = state.epicSummaries.at(-1)?.createdAt;
        const confirmed = window.confirm([
            '即将生成【史诗简史】草稿。',
            '',
            `阶段总结来源：${stageTargets.length}/${allStageTargets.length} 个`,
            `普通摘要 fallback：${storyFallback.length}/${allStoryFallback.length} 个`,
            `当前范围：${getTargetSelectionLabel('epic', targets.length, stageTargets.length ? allStageTargets.length : allStoryFallback.length)}`,
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
            selectionLabel: getTargetSelectionLabel('epic', targets.length, stageTargets.length ? allStageTargets.length : allStoryFallback.length),
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
    const includeHidden = state.scanRules.includeHidden !== false;
    const batchSize = Math.max(1, Number(state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize));
    const covered = new Set([
        ...state.coveredBlockHashes,
        ...state.storySummaries.flatMap(summary => summary.sourceHashes || []),
    ]);
    const coveredMessageIds = new Set(state.storySummaries.flatMap(summary => getFiniteMessageIds(summary.sourceMessageIds || [])));
    const rawBlocks = [];

    sourceChat.forEach((message, messageId) => {
        if (!message?.mes || (message.is_system && !includeHidden)) {
            return;
        }
        const text = stripConfiguredTags(message.mes, excludeTags).trim();
        if (!text) {
            return;
        }
        const hash = getHash(`backfill|${messageId}|${text}`);
        if (covered.has(hash) || coveredMessageIds.has(messageId)) {
            return;
        }
        rawBlocks.push({
            hash,
            type: blockTypes.STORY,
            messageId,
            blockIndex: 0,
            title: message.is_user ? `User #${messageId}` : `Assistant #${messageId}`,
            content: text,
            sourceKind: 'raw',
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
        sourceKind: 'backfill',
        trigger: 'backfill',
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
    if (state.automation.mode === 'draft' || state.automation.mode === 'commit_hide') {
        const modeLabel = state.automation.mode === 'commit_hide'
            ? `自动总结：正在生成草稿，完成后会自动保存长期记忆并隐藏已覆盖楼层，保留最近 ${state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent} 楼。`
            : '自动总结：正在生成阶段总结草稿。';
        toastr.info(modeLabel, '剧情剪辑台');
        renderAll(modeLabel);
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

function commitDraft(draftId, editedContent = null, options = {}) {
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
        sourceKind: draft.metadata?.sourceKind || draft.trigger || 'manual',
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
        sourceKind: summary.sourceKind,
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
    if (!options.silent) {
        renderAll('草稿已确认保存。');
        toastr.success('草稿已保存进长期记忆。');
    }
    return summary;
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
    const draft = state.drafts.find(item => item.id === draftId);
    const confirmed = confirmDanger(
        `丢弃草稿「${draft?.title || getKindLabel(draft?.kind) || '未命名草稿'}」？`,
        ['草稿丢弃后不会写入长期记忆，也不能从草稿箱恢复。'],
    );
    if (!confirmed) {
        return;
    }
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
    const commit = state.history[0];
    if (!commit) {
        toastr.info('暂无可撤回的保存记录。');
        return;
    }
    const confirmed = confirmDanger(
        `撤回上次保存「${commit.summary?.title || getKindLabel(commit.kind)}」？`,
        ['已保存摘要会从长期记忆中移除，原草稿会放回草稿箱。'],
    );
    if (!confirmed) {
        return;
    }
    state.history.shift();

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

function findSavedSummaryByHash(hash) {
    const state = ensureState();
    const groups = [
        [blockTypes.STORY, state.storySummaries],
        [blockTypes.STAGE, state.stageSummaries],
        [blockTypes.EPIC, state.epicSummaries],
    ];
    for (const [kind, list] of groups) {
        const index = list.findIndex(summary => summary.hash === hash);
        if (index >= 0) {
            return { kind, list, index, summary: list[index] };
        }
    }
    return null;
}

function getSummaryDependents(kind, hash) {
    const state = ensureState();
    if (kind === blockTypes.STORY) {
        return state.stageSummaries.filter(summary => (summary.sourceHashes || []).includes(hash));
    }
    if (kind === blockTypes.STAGE) {
        return state.epicSummaries.filter(summary => [...(summary.sourceStageHashes || []), ...(summary.sourceHashes || [])].includes(hash));
    }
    return [];
}

function saveEditedSummary(hash, title, content) {
    const found = findSavedSummaryByHash(hash);
    if (!found) {
        toastr.warning('没有找到这个已保存摘要。');
        return;
    }
    found.summary.title = String(title || found.summary.title || '').trim() || found.summary.title;
    found.summary.content = normalizeGeneratedBakemono(content || found.summary.content || '');
    const block = ensureState().blocks.find(item => item.hash === hash);
    if (block) {
        block.title = found.summary.title;
        block.content = found.summary.content;
    }
    updateInjectionFromSummaries();
    saveState();
    renderAll('摘要已更新。');
    toastr.success('摘要已更新。');
}

function deleteSavedSummary(hash) {
    const found = findSavedSummaryByHash(hash);
    if (!found) {
        toastr.warning('没有找到这个已保存摘要。');
        return;
    }
    const dependents = getSummaryDependents(found.kind, hash);
    if (dependents.length) {
        toastr.warning(`这个摘要已被 ${dependents.length} 个上层总结引用，请先删除上层总结。`);
        return;
    }
    const confirmed = window.confirm([
        `删除已保存的「${found.summary.title || getKindLabel(found.kind)}」？`,
        '这不会删除聊天正文，但会更新摘要树和注入内容。',
        '',
        '确认删除吗？',
    ].join('\n'));
    if (!confirmed) {
        return;
    }

    removeSummaryByHash(found.kind, hash);
    const state = ensureState();
    recomputeCoveredHashes(state);
    state.blocks = state.blocks.filter(block => block.hash !== hash);
    state.history = state.history.filter(item => item.summaryHash !== hash);
    updateInjectionFromSummaries();
    saveState();
    renderAll('摘要已删除。');
    toastr.success('摘要已删除。');
}

function recomputeCoveredHashes(state = ensureState()) {
    state.coveredBlockHashes = unique(state.stageSummaries.flatMap(summary => summary.sourceHashes || []));
    state.coveredStageHashes = unique(state.epicSummaries.flatMap(summary => summary.sourceStageHashes || []));
}

function normalizeGeneratedBakemono(result) {
    const state = ensureState();
    if (state.outputMode === 'plain') {
        return String(result || '').trim();
    }
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
    const { memory } = getInjectionMemoryParts(state);
    state.generatedMemory = memory;
    syncInjection();
}

function getInjectionMemoryParts(state = ensureState()) {
    const latestEpic = state.epicSummaries.at(-1) || null;
    const epicCoveredStageHashes = new Set(state.coveredStageHashes || []);
    const stageContents = state.stageSummaries
        .filter(item => !epicCoveredStageHashes.has(item.hash))
        .map(item => item.content);
    const shouldInjectStory = state.memoryStrategy === memoryStrategies.GENERIC;
    const storyContents = shouldInjectStory
        ? state.storySummaries
            .filter(item => !(state.coveredBlockHashes || []).includes(item.hash))
            .map(item => item.content)
        : [];

    const sections = [
        latestEpic?.content ? '## 纪元回溯\n' + latestEpic.content : '',
        stageContents.length ? '## 阶段总结\n' + stageContents.join('\n\n') : '',
        storyContents.length ? '## 普通剧情摘要\n' + storyContents.join('\n\n') : '',
    ].filter(Boolean);

    return {
        memory: sections.join('\n\n').trim(),
        stats: {
            epic: latestEpic?.content ? 1 : 0,
            stage: stageContents.length,
            story: storyContents.length,
        },
    };
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
    const template = String(state.injection.template || defaultInjectionTemplate);
    const memory = normalizeInjectionMemoryBody(state.generatedMemory || '', template);
    if (!memory) {
        return '';
    }
    return template.includes('{{memory}}') ? template.replaceAll('{{memory}}', memory).trim() : `${template.trim()}\n\n${memory}`.trim();
}

async function hideCoveredMessages(options = {}) {
    scanBakemonoBlocks({ persist: false });
    const state = ensureState();
    const covered = new Set(state.coveredBlockHashes);
    const summaryMessageIds = unique(state.blocks
        .filter(block => block.type === blockTypes.STORY && covered.has(block.hash) && Number.isFinite(block.messageId))
        .flatMap(block => getFiniteMessageIds([block.messageId, ...(block.sourceMessageIds || [])])));
    const preserveRecent = Math.max(0, Number(options.preserveRecent || 0));
    const maxHideId = (chat?.length || 0) - preserveRecent - 1;
    const messageIds = collectHideMessageIds(summaryMessageIds)
        .filter(messageId => preserveRecent <= 0 || messageId <= maxHideId);

    if (!messageIds.length) {
        if (!options.silent) {
            renderAll('没有可隐藏的已总结楼层。');
            toastr.info('没有可隐藏的已总结楼层。');
        }
        return;
    }

    if (options.confirm !== false) {
        const confirmed = confirmDanger(
            `隐藏 ${messageIds.length} 个已总结楼层？`,
            [
                '这些楼层不会被删除，可以用“恢复插件隐藏楼层”找回。',
                '如果阶段总结不完整，隐藏后可能影响后续上下文。',
                preserveRecent ? `本次会保留最近 ${preserveRecent} 楼不隐藏。` : '',
            ],
        );
        if (!confirmed) {
            renderAll('已取消隐藏楼层。');
            return;
        }
    }

    for (const messageId of messageIds) {
        await hideChatMessageRange(messageId, messageId, false);
    }

    state.hiddenMessageIds = unique([...state.hiddenMessageIds, ...messageIds]);
    await saveChatConditional();
    saveState();
    scanBakemonoBlocks({ persist: false });
    if (!options.silent) {
        renderAll(`已隐藏 ${messageIds.length} 个已总结楼层。`);
        toastr.success(`已隐藏 ${messageIds.length} 个楼层。`);
    }
    return messageIds;
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

    const confirmed = confirmDanger(
        `恢复 ${messageIds.length} 个插件隐藏楼层？`,
        ['恢复后这些楼层会重新进入聊天上下文，可能增加 token。'],
    );
    if (!confirmed) {
        renderAll('已取消恢复隐藏楼层。');
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

function parseMessageRangeInput(value) {
    const maxId = Math.max(0, (chat?.length || 1) - 1);
    const ids = new Set();
    const invalid = [];
    for (const rawPart of String(value || '').split(/[,，\s]+/).map(item => item.trim()).filter(Boolean)) {
        const match = rawPart.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!match) {
            invalid.push(rawPart);
            continue;
        }
        let start = Number(match[1]);
        let end = Number(match[2] || match[1]);
        if (start > end) {
            [start, end] = [end, start];
        }
        start = Math.max(0, start);
        end = Math.min(maxId, end);
        for (let id = start; id <= end; id++) {
            if (chat[id]) {
                ids.add(id);
            }
        }
    }
    return { ids: [...ids].sort((a, b) => a - b), invalid };
}

function getSummaryCoveredMessageIds() {
    const state = ensureState();
    const ids = new Set();
    for (const summary of [...state.storySummaries, ...state.stageSummaries, ...state.epicSummaries]) {
        for (const id of getFiniteMessageIds(summary.sourceMessageIds || [])) {
            ids.add(id);
        }
    }
    for (const stage of state.stageSummaries) {
        for (const hash of stage.sourceHashes || []) {
            const story = state.storySummaries.find(item => item.hash === hash);
            for (const id of getFiniteMessageIds(story?.sourceMessageIds || [])) {
                ids.add(id);
            }
        }
    }
    for (const epic of state.epicSummaries) {
        for (const hash of [...(epic.sourceStageHashes || []), ...(epic.sourceHashes || [])]) {
            const stage = state.stageSummaries.find(item => item.hash === hash);
            const story = state.storySummaries.find(item => item.hash === hash);
            for (const id of getFiniteMessageIds([...(stage?.sourceMessageIds || []), ...(story?.sourceMessageIds || [])])) {
                ids.add(id);
            }
        }
    }
    return ids;
}

function getRangePreviewText(ids, invalid = []) {
    if (!ids.length) {
        return invalid.length ? `没有有效楼层。无法识别：${invalid.join(', ')}` : '没有有效楼层。';
    }
    const hidden = ids.filter(id => chat[id]?.is_system).length;
    const coveredIds = getSummaryCoveredMessageIds();
    const covered = ids.filter(id => coveredIds.has(id)).length;
    const parts = [
        `范围内 ${ids.length} 楼`,
        `已隐藏 ${hidden} 楼`,
        `已有摘要覆盖 ${covered} 楼`,
        `未覆盖 ${ids.length - covered} 楼`,
    ];
    if (invalid.length) {
        parts.push(`无法识别：${invalid.join(', ')}`);
    }
    return parts.join(' · ');
}

function previewMessageRange() {
    const { ids, invalid } = parseMessageRangeInput($('#bakemono-memory-range-input').val());
    const text = getRangePreviewText(ids, invalid);
    $('#bakemono-memory-range-preview').text(text);
    renderAll(text);
}

async function setMessageRangeHidden(unhide = false) {
    const state = ensureState();
    const { ids, invalid } = parseMessageRangeInput($('#bakemono-memory-range-input').val());
    if (!ids.length) {
        const text = getRangePreviewText(ids, invalid);
        $('#bakemono-memory-range-preview').text(text);
        toastr.warning(text);
        return;
    }

    const coveredIds = getSummaryCoveredMessageIds();
    const uncovered = ids.filter(id => !coveredIds.has(id));
    const strategyHint = state.memoryStrategy === memoryStrategies.GENERIC
        ? '通用模式：普通补课摘要可以临时承担记忆，但仍建议之后生成阶段总结压缩 token。'
        : 'Bakemono 模式：普通摘要通常不注入，建议只隐藏已经被阶段总结覆盖的楼层。';
    const warning = uncovered.length
        ? `其中 ${uncovered.length} 楼没有任何已保存摘要覆盖，隐藏后可能导致模型遗忘。`
        : '这些楼层已有摘要覆盖。';
    const confirmed = window.confirm([
        `${unhide ? '恢复' : '隐藏'} ${ids.length} 个楼层？`,
        getRangePreviewText(ids, invalid),
        warning,
        strategyHint,
        '',
        '确认继续吗？',
    ].join('\n'));
    if (!confirmed) {
        return;
    }

    for (const id of ids) {
        await hideChatMessageRange(id, id, unhide);
    }
    if (unhide) {
        state.hiddenMessageIds = state.hiddenMessageIds.filter(id => !ids.includes(id));
        state.customHiddenMessageIds = state.customHiddenMessageIds.filter(id => !ids.includes(id));
    } else {
        state.hiddenMessageIds = unique([...state.hiddenMessageIds, ...ids]);
        state.customHiddenMessageIds = unique([...state.customHiddenMessageIds, ...ids]);
    }
    await saveChatConditional();
    saveState();
    scanBakemonoBlocks({ persist: false });
    const text = `${unhide ? '已恢复' : '已隐藏'} ${ids.length} 个楼层。`;
    $('#bakemono-memory-range-preview').text(text);
    renderAll(text);
    toastr.success(text);
}

function getMemoryStrategyLabelLegacy(strategy = ensureState().memoryStrategy) {
    return strategy === memoryStrategies.GENERIC ? '通用全文补课模式' : 'Bakemono 摘要块模式';
}

function getWorkflowModeLabelLegacy(mode = ensureState().workflowMode) {
    if (mode === workflowModes.GENERIC) {
        return '通用插件补课';
    }
    if (mode === workflowModes.MIXED) {
        return '混合工作流';
    }
    return 'Bakemono 摘要块';
}

function getStageSourceModeLabelLegacy(mode = getStageSourceMode()) {
    const labels = {
        [stageSourceModes.SUMMARIES]: '摘要总结模式',
        [stageSourceModes.BACKFILL]: '插件补课摘要',
        [stageSourceModes.RAW]: '普通正文总结',
        [stageSourceModes.MIXED]: '混合材料',
        [stageSourceModes.AUTO]: '自动选择',
    };
    return labels[mode] || labels[stageSourceModes.SUMMARIES];
}

function getMemoryStrategyLabel(strategy = ensureState().memoryStrategy) {
    return strategy === memoryStrategies.GENERIC ? '补课摘要会临时注入' : '普通摘要不重复注入';
}

function getWorkflowModeLabel(mode = ensureState().workflowMode) {
    if (mode === workflowModes.GENERIC) {
        return '补课旧聊天';
    }
    if (mode === workflowModes.MIXED) {
        return '高级自定义';
    }
    return '已有摘要';
}

function getStageSourceModeLabel(mode = getStageSourceMode()) {
    const labels = {
        [stageSourceModes.SUMMARIES]: '读取已有摘要',
        [stageSourceModes.BACKFILL]: '读取补课摘要',
        [stageSourceModes.RAW]: '直接读取正文',
        [stageSourceModes.MIXED]: '摘要和正文都读',
        [stageSourceModes.AUTO]: '自动选择',
    };
    return labels[mode] || labels[stageSourceModes.SUMMARIES];
}

function getWorkflowInfo(state = ensureState()) {
    const mode = state.workflowMode || workflowModes.BAKEMONO;
    if (mode === workflowModes.GENERIC) {
        return {
            title: '补课旧聊天',
            description: '适合以前没有写摘要的聊天。插件会先把旧楼层分批压缩成补课摘要，再继续做阶段总结。',
            steps: ['设置“旧正文每批楼数”', '点击“分批补课旧正文”', '到草稿箱检查并确认保存', '积累几批后生成阶段总结'],
            actions: ['backfill', 'generate-stage', 'generate-epic', 'undo'],
        };
    }
    if (mode === workflowModes.MIXED) {
        return {
            title: '高级自定义',
            description: '适合想自己控制标签、排除规则、正文来源、输出格式和注入方式的用户。',
            steps: ['打开高级设置或扫描规则', '确认扫描预览没有读错内容', '按你的材料来源生成总结', '必要时再调整提示词预设'],
            actions: ['scan', 'backfill', 'generate-stage', 'generate-epic', 'hide', 'restore', 'undo'],
        };
    }
    return {
        title: '已有摘要',
        description: '适合正文里已经有摘要块的聊天。插件只扫描摘要，普通摘要不重复注入，避免浪费 token。',
        steps: ['点击“扫描摘要”', '确认查看总结里识别正确', '生成阶段总结', '阶段总结确认后再隐藏已覆盖楼层'],
        actions: ['scan', 'generate-stage', 'generate-epic', 'hide', 'restore', 'undo'],
    };
}

function applyWorkflowPreset(mode) {
    const state = ensureState();
    const preset = mode === workflowModes.GENERIC ? defaultGenericPromptPreset : defaultPromptPreset;
    const confirmed = confirmDanger(
        `切换到「${getWorkflowModeLabel(mode)}」工作流？`,
        ['这会覆盖当前聊天的扫描规则、分类规则、预览布局和生成提示词。'],
    );
    if (!confirmed) {
        return;
    }

    if (mode === workflowModes.MIXED) {
        state.workflowMode = workflowModes.MIXED;
        state.stageSourceMode = stageSourceModes.AUTO;
        state.outputMode = 'custom';
    } else {
        state.workflowMode = preset.workflowMode;
        state.memoryStrategy = preset.memoryStrategy;
        state.stageSourceMode = preset.stageSourceMode;
        state.outputMode = preset.outputMode;
        state.generationPrompts.story = preset.story;
        state.generationPrompts.stage = preset.stage;
        state.generationPrompts.epic = preset.epic;
        state.scanRules = { ...structuredClone(defaultScanRules), ...structuredClone(preset.scanRules) };
        state.classificationRules = { ...structuredClone(defaultClassificationRules), ...structuredClone(preset.classificationRules) };
        state.previewLayouts = { ...structuredClone(defaultPreviewLayouts), ...structuredClone(preset.previewLayouts) };
        state.generationTargets = structuredClone(defaultGenerationTargets);
    }

    scanBakemonoBlocks({ persist: false });
    updateInjectionFromSummaries();
    saveState();
    renderAll(`已切换到：${getWorkflowModeLabel(state.workflowMode)}`);
}

function renderWorkflowGuide(state = ensureState()) {
    const info = getWorkflowInfo(state);
    $('#bakemono-memory-workflow-title').text(info.title);
    $('#bakemono-memory-workflow-description').text(info.description);
    const list = document.querySelector('#bakemono-memory-next-steps');
    if (list) {
        list.innerHTML = '';
        for (const step of info.steps) {
            const item = document.createElement('li');
            item.textContent = step;
            list.append(item);
        }
    }
    document.querySelectorAll('[data-bakemono-workflow-preset]').forEach(card => {
        card.classList.toggle('is-active', card.dataset.bakemonoWorkflowPreset === (state.workflowMode || workflowModes.BAKEMONO));
    });
    const visibleActions = new Set(info.actions);
    document.querySelectorAll('.bakemono-memory-control-deck [data-bakemono-action]').forEach(button => {
        button.hidden = !visibleActions.has(button.dataset.bakemonoAction);
    });
}

function getWorkflowStatusText(state = ensureState(), stats = getInjectionMemoryParts(state).stats, uncoveredStory = 0) {
    if (state.workflowMode === workflowModes.GENERIC) {
        return `补课模式：未被阶段总结覆盖的补课摘要会临时注入。当前注入普通摘要 ${stats.story} 个，待压缩摘要 ${uncoveredStory} 个。`;
    }
    if (state.workflowMode === workflowModes.MIXED) {
        return '高级模式：请先确认扫描预览和阶段材料来源，再生成总结。';
    }
    return uncoveredStory
        ? `已有摘要模式：普通摘要不会重复注入。当前有 ${uncoveredStory} 个摘要可用于生成阶段总结。`
        : '已有摘要模式：适合配合正文摘要正则使用，普通摘要不重复占用 token。';
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
    $('#bakemono-memory-memory-strategy').val(state.memoryStrategy || memoryStrategies.BAKEMONO);
    $('#bakemono-memory-workflow-mode').val(state.workflowMode || workflowModes.BAKEMONO);
    $('#bakemono-memory-stage-source-mode').val(getStageSourceMode(state));
    $('#bakemono-memory-output-mode').val(state.outputMode || 'bakemono');
    $('#bakemono-memory-strategy-label').text(getMemoryStrategyLabel(state.memoryStrategy));
    $('#bakemono-memory-workflow-label').text(`${getWorkflowModeLabel(state.workflowMode)} / ${getStageSourceModeLabel(getStageSourceMode(state))}`);
    renderWorkflowGuide(state);
    const injectionParts = getInjectionMemoryParts(state);
    $('#bakemono-memory-injection-stats').text(`注入：史诗 ${injectionParts.stats.epic} / 阶段 ${injectionParts.stats.stage} / 普通 ${injectionParts.stats.story}`);
    const uncoveredStory = state.storySummaries.filter(item => !(state.coveredBlockHashes || []).includes(item.hash)).length;
    $('#bakemono-memory-memory-warning').text(state.memoryStrategy === memoryStrategies.BAKEMONO && uncoveredStory
        ? `Bakemono 模式下普通摘要不注入：当前有 ${uncoveredStory} 个普通摘要仍只是阶段总结材料。`
        : state.memoryStrategy === memoryStrategies.GENERIC
            ? '通用模式下未被阶段总结覆盖的普通补课摘要会进入注入，阶段总结后会自动退出。'
            : 'Bakemono 模式适合配合酒馆正则使用，避免普通摘要和正文摘要重复占 token。');
    $('#bakemono-memory-injection-enabled').prop('checked', !!state.injection.enabled);
    $('#bakemono-memory-memory-warning').text(getWorkflowStatusText(state, injectionParts.stats, uncoveredStory));
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
    $('#bakemono-memory-include-hidden').prop('checked', state.scanRules.includeHidden !== false);
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
    $('#bakemono-memory-auto-hide-preserve-recent').val(state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent);
    $('#bakemono-memory-stage-target-mode').val(state.generationTargets.stage.mode || defaultGenerationTargets.stage.mode);
    $('#bakemono-memory-stage-target-count').val(state.generationTargets.stage.count ?? defaultGenerationTargets.stage.count);
    $('#bakemono-memory-stage-target-range').val(state.generationTargets.stage.range || '');
    $('#bakemono-memory-epic-target-mode').val(state.generationTargets.epic.mode || defaultGenerationTargets.epic.mode);
    $('#bakemono-memory-epic-target-count').val(state.generationTargets.epic.count ?? defaultGenerationTargets.epic.count);
    $('#bakemono-memory-epic-target-range').val(state.generationTargets.epic.range || '');
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
        meta.textContent = `#${item.messageId}.${item.blockIndex + 1} · ${item.isHidden ? '隐藏' : '可见'} · ${item.scanMode} · <${item.matchedTag}> · ${item.type}`;

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

    const roots = [];
    for (const epic of state.epicSummaries) {
        roots.push(createTimelineNode(epic, 'epic', state.stageSummaries
            .filter(stage => (epic.sourceStageHashes || epic.sourceHashes || []).includes(stage.hash))
            .map(stage => createTimelineNode(stage, 'stage', (stage.sourceHashes || []).map(hash => byHash.get(hash)).filter(Boolean).map(story => createTimelineNode(story, 'story'))))));
    }

    const epicCoveredStage = new Set(state.epicSummaries.flatMap(summary => summary.sourceStageHashes || summary.sourceHashes || []));
    for (const stage of state.stageSummaries.filter(summary => !epicCoveredStage.has(summary.hash))) {
        roots.push(createTimelineNode(stage, 'stage', (stage.sourceHashes || []).map(hash => byHash.get(hash)).filter(Boolean).map(story => createTimelineNode(story, 'story'))));
    }

    const coveredStory = new Set(state.stageSummaries.flatMap(summary => summary.sourceHashes || []));
    for (const story of storyBlocks.filter(block => !coveredStory.has(block.hash))) {
        roots.push(createTimelineNode(story, 'story'));
    }

    const pageCount = Math.max(1, Math.ceil(roots.length / timelinePageSize));
    timelineState.page = Math.min(Math.max(0, timelineState.page || 0), pageCount - 1);
    const start = timelineState.page * timelinePageSize;
    const visibleRoots = roots.slice(start, start + timelinePageSize);
    const pager = createTimelinePager(start, roots.length, pageCount);
    container.append(pager.cloneNode(true), ...visibleRoots, pager);
}

function createTimelinePager(start, total, pageCount) {
    const controls = document.createElement('div');
    controls.className = 'bakemono-memory-preview-pager bakemono-memory-timeline-pager';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'menu_button bakemono-preview-page-button';
    prev.dataset.bakemonoTimelinePage = 'prev';
    prev.disabled = timelineState.page <= 0;
    prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i><span>上一页</span>';
    const info = document.createElement('span');
    info.className = 'bakemono-memory-preview-page-info';
    info.textContent = `${total ? start + 1 : 0}-${Math.min(start + timelinePageSize, total)} / ${total}`;
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'menu_button bakemono-preview-page-button';
    next.dataset.bakemonoTimelinePage = 'next';
    next.disabled = timelineState.page >= pageCount - 1;
    next.innerHTML = '<span>下一页</span><i class="fa-solid fa-chevron-right"></i>';
    controls.append(prev, info, next);
    return controls;
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
        memoryStrategy: state.memoryStrategy || memoryStrategies.BAKEMONO,
        workflowMode: state.workflowMode || workflowModes.BAKEMONO,
        stageSourceMode: getStageSourceMode(state),
        outputMode: state.outputMode || 'bakemono',
        generationTargets: structuredClone(state.generationTargets || defaultGenerationTargets),
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
        memoryStrategy: Object.values(memoryStrategies).includes(preset.memoryStrategy) ? preset.memoryStrategy : memoryStrategies.BAKEMONO,
        workflowMode: Object.values(workflowModes).includes(preset.workflowMode) ? preset.workflowMode : workflowModes.BAKEMONO,
        stageSourceMode: Object.values(stageSourceModes).includes(preset.stageSourceMode) ? preset.stageSourceMode : stageSourceModes.SUMMARIES,
        outputMode: ['bakemono', 'plain', 'custom'].includes(preset.outputMode) ? preset.outputMode : 'bakemono',
        generationTargets: preset.generationTargets && typeof preset.generationTargets === 'object' ? preset.generationTargets : null,
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
    root.querySelectorAll('.bakemono-mobile-actions [data-bakemono-nav]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.bakemonoNav === tabName);
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
    } else if (action === 'preview-range') {
        previewMessageRange();
    } else if (action === 'hide-range') {
        await setMessageRangeHidden(false);
    } else if (action === 'restore-range') {
        await setMessageRangeHidden(true);
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
        try {
            await runWorkbenchAction(this.dataset.bakemonoAction);
        } catch (error) {
            console.error('[BakemonoMemory] action failed', error);
            toastr.error(error?.message || String(error), '剧情剪辑台');
            renderAll(`操作失败：${error?.message || error}`);
        }
    });
    $('#bakemono-workbench-root').off('click.bakemonoWorkflow').on('click.bakemonoWorkflow', '[data-bakemono-workflow-preset]', function () {
        applyWorkflowPreset(this.dataset.bakemonoWorkflowPreset);
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
    $('#bakemono-workbench-root').off('click.bakemonoTimelinePage').on('click.bakemonoTimelinePage', '[data-bakemono-timeline-page]', function () {
        const direction = this.dataset.bakemonoTimelinePage === 'next' ? 1 : -1;
        timelineState.page = Math.max(0, (timelineState.page || 0) + direction);
        renderTimeline();
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
    $('#bakemono-workbench-root').off('click.bakemonoSummaryAction').on('click.bakemonoSummaryAction', '[data-bakemono-summary-action]', function () {
        const tools = this.closest('.bakemono-memory-summary-tools');
        const hash = tools?.dataset.summaryHash;
        if (!tools || !hash) {
            return;
        }
        const action = this.dataset.bakemonoSummaryAction;
        const editor = tools.querySelector('.bakemono-memory-summary-editor');
        const danger = tools.querySelector('.bakemono-memory-danger-zone');
        if (action === 'edit') {
            editor.hidden = false;
        } else if (action === 'more') {
            danger.hidden = !danger.hidden;
        } else if (action === 'cancel') {
            editor.hidden = true;
        } else if (action === 'save') {
            saveEditedSummary(
                hash,
                tools.querySelector('.bakemono-summary-title')?.value || '',
                tools.querySelector('.bakemono-summary-content')?.value || '',
            );
        } else if (action === 'delete') {
            deleteSavedSummary(hash);
        }
    });
    $('#bakemono-memory-apply-injection').off('click').on('click', () => {
        const state = ensureState();
        state.injection.template = String($('#bakemono-memory-injection-template').val() || defaultInjectionTemplate);
        state.generatedMemory = normalizeInjectionMemoryBody($('#bakemono-memory-source-content').val() || '', state.injection.template);
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
        const confirmed = confirmDanger(
            '恢复默认注入模板？',
            ['当前注入模板会被默认模板覆盖，记忆正文会保留。'],
        );
        if (!confirmed) {
            return;
        }
        const state = ensureState();
        state.injection.template = defaultInjectionTemplate;
        syncInjection();
        saveState();
        renderAll('注入模板已恢复默认。');
    });
    $('#bakemono-memory-clear-injection').off('click').on('click', () => {
        const confirmed = confirmDanger(
            '清空记忆正文？',
            ['这会清空手动编辑的记忆正文；已保存摘要仍在，但当前自定义正文会消失。'],
        );
        if (!confirmed) {
            return;
        }
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
        const confirmed = confirmDanger(
            '恢复默认阶段总结提示词？',
            ['当前阶段总结提示词会被默认 Bakemono 模板覆盖。'],
        );
        if (!confirmed) {
            return;
        }
        const state = ensureState();
        state.generationPrompts.stage = defaultStageGenerationPrompt;
        saveState();
        renderAll('阶段总结提示词已恢复默认。');
    });
    $('#bakemono-memory-reset-epic-prompt').off('click').on('click', () => {
        const confirmed = confirmDanger(
            '恢复默认史诗简史提示词？',
            ['当前史诗简史提示词会被默认 Bakemono 模板覆盖。'],
        );
        if (!confirmed) {
            return;
        }
        const state = ensureState();
        state.generationPrompts.epic = defaultEpicGenerationPrompt;
        saveState();
        renderAll('史诗简史提示词已恢复默认。');
    });
    $('#bakemono-memory-reset-story-prompt').off('click').on('click', () => {
        const confirmed = confirmDanger(
            '恢复默认旧正文补课提示词？',
            ['当前旧正文补课提示词会被默认 Bakemono 模板覆盖。'],
        );
        if (!confirmed) {
            return;
        }
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
            autoHidePreserveRecent: Math.max(0, Number($('#bakemono-memory-auto-hide-preserve-recent').val() || 0)),
            apiProvider: String($('#bakemono-memory-api-provider').val() || defaultAutomation.apiProvider),
            customApi: {
                baseUrl: String($('#bakemono-memory-custom-base-url').val() || '').trim(),
                apiKey: String($('#bakemono-memory-custom-api-key').val() || '').trim(),
                model: String($('#bakemono-memory-custom-model').val() || '').trim(),
                temperature: Number($('#bakemono-memory-custom-temperature').val() || defaultAutomation.customApi.temperature),
                maxTokens: Number($('#bakemono-memory-custom-max-tokens').val() || defaultAutomation.customApi.maxTokens),
            },
        };
        readGenerationTargetSettings();
        saveState();
        renderAll('自动总结设置已应用。');
        toastr.success('自动总结设置已应用。');
    });
    $('#bakemono-memory-stage-target-mode, #bakemono-memory-stage-target-count, #bakemono-memory-stage-target-range, #bakemono-memory-epic-target-mode, #bakemono-memory-epic-target-count, #bakemono-memory-epic-target-range')
        .off('change input')
        .on('change input', () => {
            readGenerationTargetSettings();
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
        const confirmed = confirmDanger(
            `载入预设「${preset.name || '未命名预设'}」？`,
            ['这会覆盖当前聊天的生成提示词、扫描规则和工作流设置。'],
        );
        if (!confirmed) {
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
        if (Object.values(memoryStrategies).includes(preset.memoryStrategy)) {
            state.memoryStrategy = preset.memoryStrategy;
        } else if (preset.id === defaultGenericPromptPreset.id) {
            state.memoryStrategy = memoryStrategies.GENERIC;
        } else if (preset.id === defaultPromptPreset.id) {
            state.memoryStrategy = memoryStrategies.BAKEMONO;
        }
        if (Object.values(workflowModes).includes(preset.workflowMode)) {
            state.workflowMode = preset.workflowMode;
        } else if (preset.id === defaultGenericPromptPreset.id) {
            state.workflowMode = workflowModes.GENERIC;
        } else if (preset.id === defaultPromptPreset.id) {
            state.workflowMode = workflowModes.BAKEMONO;
        }
        if (Object.values(stageSourceModes).includes(preset.stageSourceMode)) {
            state.stageSourceMode = preset.stageSourceMode;
        } else {
            state.stageSourceMode = state.workflowMode === workflowModes.GENERIC ? stageSourceModes.BACKFILL : stageSourceModes.SUMMARIES;
        }
        state.outputMode = ['bakemono', 'plain', 'custom'].includes(preset.outputMode) ? preset.outputMode : (state.workflowMode === workflowModes.GENERIC ? 'plain' : 'bakemono');
        if (preset.generationTargets) {
            state.generationTargets = {
                ...structuredClone(defaultGenerationTargets),
                ...structuredClone(preset.generationTargets),
            };
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
        const selected = getPromptPresets().find(preset => preset.id === selectedId);
        const confirmed = confirmDanger(
            `删除预设「${selected?.name || '未命名预设'}」？`,
            ['删除后不会影响已保存摘要，但这个预设无法从列表里恢复。'],
        );
        if (!confirmed) {
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
            includeHidden: $('#bakemono-memory-include-hidden').prop('checked'),
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
        const confirmed = confirmDanger(
            '恢复默认扫描与预览规则？',
            ['当前扫描标签、排除标签、分类关键词和手账分段规则会被默认值覆盖。'],
        );
        if (!confirmed) {
            return;
        }
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
    $('#bakemono-memory-memory-strategy').off('change').on('change', function () {
        const state = ensureState();
        state.memoryStrategy = Object.values(memoryStrategies).includes(this.value) ? this.value : memoryStrategies.BAKEMONO;
        updateInjectionFromSummaries();
        saveState();
        renderAll('记忆策略已切换。');
    });
    $('#bakemono-memory-workflow-mode').off('change').on('change', function () {
        const state = ensureState();
        state.workflowMode = Object.values(workflowModes).includes(this.value) ? this.value : workflowModes.BAKEMONO;
        if (state.workflowMode === workflowModes.GENERIC) {
            state.memoryStrategy = memoryStrategies.GENERIC;
            state.stageSourceMode = stageSourceModes.BACKFILL;
            state.outputMode = 'plain';
        } else if (state.workflowMode === workflowModes.BAKEMONO) {
            state.memoryStrategy = memoryStrategies.BAKEMONO;
            state.stageSourceMode = stageSourceModes.SUMMARIES;
            state.outputMode = 'bakemono';
        }
        scanBakemonoBlocks({ persist: false });
        updateInjectionFromSummaries();
        saveState();
        renderAll('工作流模式已切换。');
    });
    $('#bakemono-memory-stage-source-mode').off('change').on('change', function () {
        const state = ensureState();
        state.stageSourceMode = Object.values(stageSourceModes).includes(this.value) ? this.value : stageSourceModes.SUMMARIES;
        scanBakemonoBlocks({ persist: false });
        saveState();
        renderAll('阶段总结材料已切换。');
    });
    $('#bakemono-memory-output-mode').off('change').on('change', function () {
        const state = ensureState();
        state.outputMode = ['bakemono', 'plain', 'custom'].includes(this.value) ? this.value : 'bakemono';
        saveState();
        renderAll('输出风格已切换。');
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
    switchWorkbenchTab('overview');
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
