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

const memoryRecordStatuses = {
    SOURCE: 'source',
    COVERED: 'covered',
    SAVED: 'saved',
    INJECTED: 'injected',
    ARCHIVED: 'archived',
    DRAFT: 'draft',
};

const areaPresetScopes = {
    SCAN: 'scan',
    AUTOMATION: 'automation',
    API: 'api',
    PROMPTS: 'prompts',
    TURN: 'turnSummary',
    INJECTION: 'injection',
    VECTOR: 'vectorMemory',
};

const tableSchemaScopes = {
    CHAT: 'chat',
    CHARACTER: 'character',
    GLOBAL: 'global',
};

const CUSTOM_THEME_SCHEMA = 'bakemono-memory-theme/v1';
const customThemeColorKeys = [
    'paper',
    'paperRaised',
    'paperSoft',
    'ink',
    'muted',
    'accent',
    'secondary',
    'accentStrong',
    'line',
    'backdrop',
    'danger',
];
const defaultCustomTheme = {
    $schema: CUSTOM_THEME_SCHEMA,
    name: '我的自定义主题',
    appearance: 'light',
    tokens: {
        paper: '#eee4ce',
        paperRaised: '#f8f1df',
        paperSoft: '#ddd0b5',
        ink: '#40382b',
        muted: '#7c715f',
        accent: '#81734a',
        secondary: '#6d775e',
        accentStrong: '#5f5638',
        line: '#c8baa0',
        backdrop: '#302b25',
        danger: '#a14f45',
    },
    effects: {
        gradientStrength: 10,
        gradientAngle: 145,
        grain: 4,
        shadow: 18,
        radius: 12,
    },
    constraints: {
        opaqueSurfaces: true,
        contrast: 'WCAG AA',
        doNotChange: ['layout', 'plugin logic', 'configuration structure', 'memory data'],
    },
    aiInstructions: '只修改 tokens、effects、name 与 appearance，保留 $schema 和字段结构；返回完整 JSON，不要加入 CSS、脚本或解释文字。所有颜色必须为六位十六进制色值。',
};

function normalizeThemeHex(value, fallback) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

function clampThemeNumber(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function sanitizeCustomTheme(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const sourceTokens = source.tokens && typeof source.tokens === 'object' ? source.tokens : {};
    const sourceEffects = source.effects && typeof source.effects === 'object' ? source.effects : {};
    const tokens = {};
    for (const key of customThemeColorKeys) {
        tokens[key] = normalizeThemeHex(sourceTokens[key], defaultCustomTheme.tokens[key]);
    }
    return {
        $schema: CUSTOM_THEME_SCHEMA,
        name: String(source.name || defaultCustomTheme.name).trim().slice(0, 80) || defaultCustomTheme.name,
        appearance: source.appearance === 'dark' ? 'dark' : 'light',
        tokens,
        effects: {
            gradientStrength: clampThemeNumber(sourceEffects.gradientStrength, defaultCustomTheme.effects.gradientStrength, 0, 24),
            gradientAngle: clampThemeNumber(sourceEffects.gradientAngle, defaultCustomTheme.effects.gradientAngle, 0, 360),
            grain: clampThemeNumber(sourceEffects.grain, defaultCustomTheme.effects.grain, 0, 12),
            shadow: clampThemeNumber(sourceEffects.shadow, defaultCustomTheme.effects.shadow, 0, 36),
            radius: clampThemeNumber(sourceEffects.radius, defaultCustomTheme.effects.radius, 0, 24),
        },
        constraints: structuredClone(defaultCustomTheme.constraints),
        aiInstructions: String(source.aiInstructions || defaultCustomTheme.aiInstructions).trim().slice(0, 1000) || defaultCustomTheme.aiInstructions,
    };
}

const turnProcessingModes = {
    SUMMARY: 'summary',
    TABLE: 'table',
    BOTH: 'both',
};

const inlinePromptKeys = {
    SUMMARY: `${INJECTION_KEY}_inline_summary`,
    TABLE: `${INJECTION_KEY}_inline_table`,
};

const defaultInlineSummaryPrompt = `请在本次回复正文结束后，额外输出一个 <bakemono>...</bakemono> 摘要块。
要求：
- 摘要只记录已经发生的内容，不要剧透、不要续写。
- 如果你无法判断时间、地点或角色状态，就写“未知”。
- 摘要块要放在正文之后，正文仍然正常扮演。

推荐格式：
<bakemono>
<details>
<summary>📋 剧情摘要</summary>
【☆『正文摘要』★时间/时间跨度：未知★地点/状态|本轮出现角色☆】

➤ 🎬 【场记打板】
- 本轮事件过程。
……

➤ 🎙️ 【高光收音】
> “关键台词” —— [角色名]
……

➤ 🌍 【副镜监视器】
[地点/角色]：平行状态。
……

➤ 🪢 【剧本暗线】
[未回收伏笔]：无
[✅ 本回合回收]：无
……

➤ 💡 【第四面墙】
*隐藏信息记录*
</details>
</bakemono>`;

const defaultInlineTablePrompt = `请在本次回复正文结束后，额外输出表格修改块。正文仍然正常扮演，不要为了填表牺牲正文质量。

硬性规则：
- 只根据本轮回复中真实发生的内容填写。
- 只允许修改“可写且允许 AI 修改”的表。
- 只读表只能作为参考，禁止 insertRow/updateRow/deleteRow。
- 如果没有表格修改，输出空的 <tableEdit></tableEdit>。
- 输出必须包含 <tableThink> 和 <tableEdit>。

<当前表格数据>
{{tableData}}
</当前表格数据>

<表格规则>
{{tableGuide}}
</表格规则>

<tableThink>简要说明为什么要修改这些表。</tableThink>
<tableEdit>
insertRow(tableIndex, {"0":"值"})
updateRow(tableIndex, rowIndex, {"0":"新值"})
deleteRow(tableIndex, rowIndex)
</tableEdit>`;

const defaultInjectionTemplate = `【剧情剪辑台：长期剧情记忆】
以下内容是已经压缩整理过的剧情记忆。请把它当作已发生事实与长期线索参考，不要复述给用户，也不要替代当前回合正文。

{{memory}}`;

const defaultTurnSummaryPrompt = `你是剧情剪辑台的正文摘要器。你会看到刚刚结束的一轮聊天正文，请只基于输入内容生成一份可保存进长期记忆的本轮摘要。

要求：
- 不续写剧情，不扮演角色，不添加正文中没有发生的事件。
- 记录完整过程、关键台词、角色状态变化、地点/时间、伏笔、隐藏信息。
- 如果无法判断时间或地点，写“未知”，不要编造。
- 输出必须放在 <summaryDraft></summaryDraft> 中。

推荐格式：
<summaryDraft>
【☆『{{suggestedTitle}}』★时间/时间跨度：从正文可判断的时间，未知则写未知★{{sourceRange}}★地点/状态|本轮出现角色☆】

➤ 🎬 【场记打板】
- 本轮发生的事件过程。
……

➤ 🎙️ 【高光收音】
> “关键台词或心理活动” —— [角色名]
……

➤ 🌍 【副镜监视器】
[地点/角色]：平行事件或状态。
……

➤ 🪢 【剧本暗线】
[未回收伏笔]：……
[✅ 本回合回收]：无
……

➤ 💡 【第四面墙】
*角色不知道、但读者知道的隐藏信息。*
</summaryDraft>

待摘要正文：
{{blocks}}`;

const defaultMissingSummaryPrompt = `你是剧情剪辑台的缺失摘要补写器。你会看到若干个缺少摘要的助手楼层，请为每个楼层分别补写一个剧情摘要。

硬性要求：
- 只总结该楼层已经发生的正文内容，不续写剧情，不扮演角色，不添加原文没有发生的事件。
- 每个楼层必须独立输出，并保留原楼层数字分隔符。
- 不要输出 <summaryDraft>。
- 每个楼层只输出一个完整的 <bakemono>...</bakemono> 摘要块。
- 标题必须使用原楼层号 + 本楼剧情短标题，例如“第123楼：雨夜重逢”或“第123楼：密室里的交易”；不要固定写“正文摘要”，不要猜章节号，不要写“第x章”。
- 无法判断时间、地点、天气或角色时写“未知”，不要猜测。
- 不要输出寒暄、解释、总说明或 Markdown 代码围栏。

每个楼层必须严格使用以下格式：
===楼层#原楼层数字===
<bakemono>
<details>
<summary>📋 剧情摘要</summary>
【☆『第原楼层数字楼：根据本楼正文提炼的短标题』★时间/时间跨度：从正文可判断，未知则写未知★地点/状态|本楼出现角色☆】

➤ 🎬 【场记打板】（流水账形式记录，不得升华主题，记录本回合推进的全部事件，信息密度高且详细，这是后续👾记忆的前提）
- 此处为剧情摘要
……

➤ 🎙️ 【高光收音】（抓取本回合最有张力、最关键的几句重要对话/心理活动）
> “此处填入台词或内心戏，最好是能体现角色性格的那种！” —— [角色名]
……

➤ 🌍 【副镜监视器】（平行事件）
*当主角在行动时，世界的其他角落……*
[地点A | 角色B]：ta此刻的行动/心理。
[地点C | 角色D]：ta此刻的行动/状态。
……

➤ 🪢 【剧本暗线】（伏笔系统：只对导演可见的记录）
[未回收伏笔 1]：(埋伏笔的章节) 某某提到了一个神秘的盒子。→ (系统提示：建议在接下来的3个章节内制造契机让主角打开它)
[未回收伏笔 2]：(埋伏笔的章节) 骑士看某某的眼神有一瞬间的闪躲。→ (系统提示：待揭晓他隐瞒的秘密)
[✅ 本回合回收]：(如果没有就写“无”)
……

➤ 💡 【第四面墙】（用👾的视角，记录一些角色不知道、但读者知道的隐藏信息，**不是吐槽**）
*偷偷记一笔*
</details>
</bakemono>
===楼层#原楼层数字结束===

待补写楼层：
{{blocks}}`;

const defaultTableEditPrompt = `你是剧情剪辑台的表格整理助手。请根据刚刚结束的一轮聊天正文和当前表格数据，输出需要执行的表格修改。

硬性规则：
- 只根据输入正文与当前表格判断，禁止捏造未知信息。
- 插入新条目用 insertRow(tableIndex, {"0":"值"})。
- 修改已有条目用 updateRow(tableIndex, rowIndex, {"列号":"新值"})。
- 删除失效条目用 deleteRow(tableIndex, rowIndex)。
- insertRow 必须尽量填满该表所有列；未知且不应猜测的列可留空字符串。
- 字符串内不要出现双引号；逗号尽量用 / 代替。
- 如果没有表格修改，输出空的 <tableEdit></tableEdit>。
- 输出必须且只能包含 <tableThink> 和 <tableEdit> 两个标签。

<当前表格>
{{tableData}}
</当前表格>

<表格规则>
{{tableGuide}}
</表格规则>

<本轮正文>
{{blocks}}
</本轮正文>`;

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
    epic: '多次总结, 长期总览, 篇章总结, 纪元回溯, 史诗简史, 事件断代史, 命运锚点',
};

const defaultPreviewLayouts = {
    story: `场记|场记打板|normal
收音|高光收音|normal
监视|副镜监视器|normal
暗线|剧本暗线|tag
墙外|第四面墙|bubble`,
    stage: `长焦|剧情长焦|normal
进化|角色进化录|normal
金句|金句名人堂|bubble
谜题|未解之谜|tag
墙外|第四面墙·终极笔记|bubble`,
    epic: `时间线|时间线总览,事件断代史|normal
锚点|关键锚点,命运锚点|tag
角色|角色状态,灵魂蝶变|normal
未解|未解事项|tag
长期笔记|第四面墙·长期笔记,第四面墙·高维观测|bubble`,
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
【👑『第x卷：自定义名称』★ 跨度：从x章至x章 ★ 时间跨度：XXX-XXX ☆】

➤ 🎞️ 【剧情长焦】（详细提炼本阶段的[事件]。概括每章节内容（包括时间），让后续可清晰了解之前章节具体发生过什么。）
- [事件名称] (涵盖的章节跨度 | 发生时间 | 发生地点 | 在场角色)
  - 经过：用流水账形式清晰记录该事件的起因、经过、结果，保留所有重要动作/话语/冲突。
  - 关键点：一句话总结该事件对剧情推进或角色关系造成的重大影响/转折。
  （请严格按照上述带时间轴的剧集目录体格式，逐个列出本卷发生的所有重要事件）
……

➤ 🎭 【角色进化录】（记录核心角色在本篇章后的心态/关系转变）
- [角色A]：从最初的[状态]转变为了[现状]，关键转折点是[事件]。
……

➤ 🏆 【金句名人堂】（从整篇剧情中挑选出最具代表性、最能定义本卷灵魂的台词）
1. > “台词1”——【角色名】
……

➤ 🗃️ 【未解之谜】（记录目前埋下但尚未回收的伏笔、未交待的秘密）
* 伏笔A：...
* 伏笔B：...
……

➤ 👾 【第四面墙·终极笔记】（以👾视角，整合之前的第四面墙内容）
*嘿嘿，这里是整合*
</details>
</bakemono>

只输出一个完整的 <bakemono> 块，不要输出正文、解释、寒暄或 Markdown 代码围栏。

以下是需要汇总的新增 <bakemono> 剧情摘要：
{{blocks}}`;

const defaultEpicGenerationPrompt = `# 👾多次总结模式！
- 编辑大人开启这一模式后，说明阶段总结或上一层总结已经变多了，需要继续压缩。
- 你要把输入的阶段总结 / 多次总结整理成更高一层的长期记忆。
- 这不一定是宏大史诗，也可能只是日常生活、关系推进、任务记录或长期陪伴剧情；不要为了显得宏大而夸张升华。
- 👾总结时不需要输出正文，只输出总结内容。

# 📚 长期剧情回顾：
当前剧情资料需要进入更高层归档。👾要站在“长期记忆整理员”的角度，生成一份可以继续被下一轮多次总结压缩的总览。

## 排版与格式要求（必须严格遵守以下版式）：
<bakemono>
<details>
<summary>【多次总结·长期总览】</summary>
【🪐『长期总览：自定义名称』★ 总跨度：从输入材料可判断的范围，未知则写未知 ★ 时间跨度：XXX-XXX ☆】

➤ 📜 【时间线总览】（按时间顺序整理输入材料覆盖的核心事件（标注时间），保留足够细节，避免只剩空泛主题）
- [事件名称] (涵盖的章节跨度 | 发生时间 | 发生地点 | 在场角色)
  - 经过：用流水账形式清晰记录该事件的起因、经过、结果，保留所有重要动作/话语/冲突。
  - 关键点：一句话总结该事件对剧情推进或角色关系造成的重大影响/转折。
  （请严格按照上述带时间轴的剧集目录体格式，逐个列出本卷发生的所有重要事件）
……

➤ 🔗 【关键锚点】（挑出对关系、任务、状态或世界线最有影响的 1 到 3 个关键节点）
* 锚点A：[时刻] —— 它带来的后续影响是……
……

➤ 🦋 【角色状态】（记录核心角色在这段长期剧情后的关系、心态、目标、身体/处境变化）
* [角色名]：从[旧状态]变化为[现状]，关键原因是……
……

➤ 🗃️ 【未解事项】（保留仍然重要、之后需要继续追踪的伏笔、秘密、任务、约定、风险）
* 事项A：……
……

➤ 👾 【第四面墙·长期笔记】（以👾视角，整合读者/系统知道但角色未必知道的信息）
*这里是长期观测记录……*
</details>
</bakemono>

只输出一个完整的 <bakemono> 块，不要输出正文、解释、寒暄或 Markdown 代码围栏。

以下是需要进行“多次总结”的 <bakemono> 内容：
{{blocks}}`;

const defaultStoryGenerationPrompt = `# 👾旧正文补课摘要模式！
- 你现在不是继续写正文，也不是扮演角色。
- 你是“剧情剪辑台”的归档员，只负责把已经发生过的聊天正文压缩成剧情摘要。
- 禁止续写剧情，禁止补写新台词，禁止加入正文里没有发生的新事件。
- 只允许根据下面提供的历史聊天内容做总结。
- 本次补课编号、覆盖楼层和推荐标题由插件提供，必须原样使用，不要自行推断章节号。

# 摘要目标
把以下旧聊天正文整理成一个可继续用于“阶段总结 / 多次总结”的剧情摘要块。请尽量保留：
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
……

➤ 🎙️ 【高光收音】（抓取本批次最关键、最能体现角色性格或关系变化的对话/心理活动；只能引用或概括原文中已有内容）
> “此处填入台词或内心戏” —— [角色名]
……

➤ 🌍 【副镜监视器】（如果本批次有平行事件就记录；没有就写“无”）
[地点A | 角色B]：ta此刻的行动/心理。
……

➤ 🪢 【剧本暗线】（只记录正文里已经出现的伏笔、秘密、未解决事项；不得新增伏笔）
[未回收伏笔 1]：……
[✅ 本批次回收]：如果没有就写“无”
……

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
    name: '默认摘要手账',
    story: defaultStoryGenerationPrompt,
    missing: defaultMissingSummaryPrompt,
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
    missing: defaultMissingSummaryPrompt,
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
        story: `事件|事件经过|normal
角色|角色与关系|normal
话语|关键话语,心理|bubble
线索|伏笔与未解事项|tag`,
        stage: `脉络|剧情脉络|normal
变化|角色变化|normal
场面|关键场面|bubble
未解|未解事项|tag`,
        epic: `时间线|时间线总览|normal
转折|决定性转折|tag
弧光|核心角色弧光|normal
线索|长期线索|bubble`,
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
            stream: false,
            models: [],
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
        stream: false,
        models: [],
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

const defaultVectorQueryRewritePrompt = `你是剧情记忆检索器。请只根据最近剧情，写出需要回忆的旧剧情问题。

输出必须严格为 6 行：
INTENT: 用中文写一句检索目标
Q1: 用中文写第一条旧记忆检索问题
Q2: 用中文写第二条旧记忆检索问题
Q3: 用中文写第三条旧记忆检索问题
Q4: 用中文写第四条旧记忆检索问题
Q5: 用中文写第五条旧记忆检索问题

要求：
- 只写中文，不写英文。
- 不解释，不分析，不复述规则，不输出 JSON。
- Q1-Q5 要寻找旧剧情中已经发生过的事实，例如人物关系、旧承诺、旧冲突、地点组织、物品状态、伏笔秘密、情绪变化。
- 不要写 Clue、Input、Goal、Task、Role、Current context、Analyze、Determine。`;

const defaultVectorMemory = {
    enabled: false,
    includeHidden: true,
    includeUser: false,
    indexMode: 'message',
    injectMode: 'tiered',
    chunkSize: 900,
    overlap: 120,
    longMessageThreshold: 1800,
    maxIndexedMessages: 300,
    maxStoredTextChars: 1200,
    embeddingDimensions: 128,
    topK: 20,
    rerankCandidateCount: 20,
    finalRecallCount: 5,
    fullRecallCount: 2,
    maxRecallMessages: 5,
    maxPerMessage: 1,
    perMessageMaxChars: 1600,
    minScore: 0.22,
    embeddingThreshold: 0.22,
    rerankThreshold: 0.45,
    keywordBoost: 0.18,
    maxInjectChars: 2600,
    summaryMaxChars: 520,
    keywordTriggers: '',
    excludeTags: 'thinking, think, reasoning',
    summaryTags: 'bakemono, summaryDraft',
    queryMode: 'model-required',
    queryRewriteProvider: 'tavern',
    queryRewritePrompt: defaultVectorQueryRewritePrompt,
    queryCustomApi: {
        baseUrl: '',
        apiKey: '',
        model: '',
        models: [],
    },
    startAfterAiMessages: 0,
    skipIfAllInContext: true,
    contextWindowMessages: 20,
    rerankMode: 'hybrid',
    embeddingProvider: 'local',
    autoIndex: true,
    dirty: true,
    dirtyReason: '',
    lastIndexedSignature: '',
    trimmedHitCount: 0,
    estimatedChars: 0,
    customApi: {
        baseUrl: '',
        apiKey: '',
        model: 'text-embedding-3-small',
        models: [],
    },
    records: [],
    embeddingCache: {},
    lastHits: [],
    lastQuery: '',
    lastQueries: [],
    lastRewriteIntent: '',
    lastEmbeddingCandidates: [],
    lastRerankCandidates: [],
    lastRecallSkippedReason: '',
    lastIndexAt: null,
};

const defaultState = {
    version: 1,
    configInitialized: false,
    activeConfigId: '',
    blocks: [],
    storySummaries: [],
    stageSummaries: [],
    epicSummaries: [],
    drafts: [],
    history: [],
    taskQueue: [],
    autoSummaryTransactions: [],
    memoryRecords: [],
    generatedMemory: '',
    coveredBlockHashes: [],
    coveredStageHashes: [],
    hiddenMessageIds: [],
    customHiddenMessageIds: [],
    autoHideRecent: {
        enabled: false,
        preserveRecent: 5,
        managedMessageIds: [],
        lastRunAt: null,
    },
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
        missing: defaultMissingSummaryPrompt,
        stage: defaultStageGenerationPrompt,
        epic: defaultEpicGenerationPrompt,
    },
    automation: defaultAutomation,
    generationTargets: defaultGenerationTargets,
    turnSummary: {
        enabled: false,
        auto: false,
        processingMode: turnProcessingModes.BOTH,
        saveMode: 'draft',
        includeUserMessage: true,
        includeWorldInfo: false,
        includeCharacterContext: true,
        referenceContext: '',
        worldInfoMaxContext: 4096,
        lastProcessedMessageId: null,
        prompt: defaultTurnSummaryPrompt,
        tablePrompt: defaultTableEditPrompt,
    },
    tableDatabase: {
        enabled: false,
        injectMemory: true,
        autoApply: false,
        schemaScope: tableSchemaScopes.CHAT,
        activeProfileId: '',
        chatProfiles: [],
        profileRows: {},
        tables: [],
        editDrafts: [],
        history: [],
        undoStack: [],
        redoStack: [],
        rollbackHistory: [],
        lastAppliedSourceMessageIds: [],
        lastImportAt: null,
    },
    inlineGeneration: {
        summaryEnabled: false,
        tableEnabled: false,
        hideTableEdit: false,
        hideTableEditMigratedToRegex: false,
        summaryPrompt: defaultInlineSummaryPrompt,
        tablePrompt: defaultInlineTablePrompt,
        depth: 1,
        role: extension_prompt_roles.SYSTEM,
        lastProcessedMessageId: null,
        lastProcessedSignature: '',
    },
    vectorMemory: defaultVectorMemory,
    scanRules: defaultScanRules,
    classificationRules: defaultClassificationRules,
    previewLayouts: defaultPreviewLayouts,
    scanPreview: [],
    lastScanMatchCount: 0,
    lastScanAt: null,
    chatGuard: {
        lastPrunedAt: null,
        lastPrunedCount: 0,
        lastPrunedReason: '',
    },
};

let isBusy = false;
let isQueueRunning = false;
const cancelledQueueTaskIds = new Set();
let vectorIndexTimer = null;
let inlineCaptureTimer = null;
let autoHideRecentTimer = null;
let scheduledRenderHandle = null;
let scheduledRenderStatus = '';
const sanitizedChatLengths = new WeakMap();
const vectorEmbeddingRuntimeCache = new Map();
const maxStoredScanPreviewItems = 240;
const mobileScanPreviewRenderLimit = 60;
const desktopScanPreviewRenderLimit = 120;
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
let summaryGenerationMode = 'stage';
let promptPreviewType = 'stage';
let summaryGenerationSnapshot = {
    story: [],
    stage: [],
    epic: [],
};
let reviewPanelView = 'drafts';
const historyState = {
    page: 0,
};
const timelineState = {
    page: 0,
};
const memoryRecordPageSize = 18;
const memoryRecordState = {
    page: 0,
};
const tableUiState = {
    openTableIndex: '',
    focusCell: null,
    openSection: '',
    focusField: null,
};

function cloneDefaultState() {
    return structuredClone(defaultState);
}

function ensureGlobalSettings() {
    if (!extension_settings[STORAGE_KEY]) {
        extension_settings[STORAGE_KEY] = {};
    }
    const settings = extension_settings[STORAGE_KEY];
    if (!settings.ui || typeof settings.ui !== 'object') {
        settings.ui = {};
    }
    if (settings.ui.showTopNavButton === undefined) {
        settings.ui.showTopNavButton = false;
    }
    if (!['tavern', 'custom'].includes(settings.ui.themeMode)) {
        settings.ui.themeMode = 'tavern';
    }
    settings.ui.customTheme = sanitizeCustomTheme(settings.ui.customTheme);
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
        if (preset.missing === undefined) {
            preset.missing = defaultMissingSummaryPrompt;
        }
        if (preset.stage !== undefined) {
            preset.stage = migrateStagePromptTimeSpan(preset.stage);
        }
        if (preset.epic !== undefined) {
            preset.epic = migrateEpicPromptTimeSpan(preset.epic);
        }
        if (preset.id === defaultGenericPromptPreset.id) {
            preset.story = defaultGenericStoryGenerationPrompt;
            preset.missing = defaultMissingSummaryPrompt;
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
            preset.story = defaultStoryGenerationPrompt;
            preset.missing = defaultMissingSummaryPrompt;
            preset.stage = defaultStageGenerationPrompt;
            preset.epic = defaultEpicGenerationPrompt;
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
    if (!settings.activeConfig || typeof settings.activeConfig !== 'object') {
        const selectedPreset = extension_settings[STORAGE_KEY].promptPresets.find(preset => preset.id === extension_settings[STORAGE_KEY].selectedPromptPresetId)
            || structuredClone(defaultPromptPreset);
        settings.activeConfig = {
            ...structuredClone(selectedPreset),
            id: selectedPreset.id || defaultPromptPreset.id,
            name: selectedPreset.name || '默认摘要手账',
            updatedAt: new Date().toISOString(),
        };
    }
    if (!extension_settings[STORAGE_KEY].areaPresets || typeof extension_settings[STORAGE_KEY].areaPresets !== 'object') {
        extension_settings[STORAGE_KEY].areaPresets = {};
    }
    for (const scope of Object.values(areaPresetScopes)) {
        if (!Array.isArray(extension_settings[STORAGE_KEY].areaPresets[scope])) {
            extension_settings[STORAGE_KEY].areaPresets[scope] = [];
        }
    }
    if (!extension_settings[STORAGE_KEY].selectedAreaPresetIds || typeof extension_settings[STORAGE_KEY].selectedAreaPresetIds !== 'object') {
        extension_settings[STORAGE_KEY].selectedAreaPresetIds = {};
    }
    if (!Object.values(tableSchemaScopes).includes(settings.defaultTableSchemaScope)) {
        settings.defaultTableSchemaScope = tableSchemaScopes.CHAT;
    }
    if (!settings.tableSchemaLibrary || typeof settings.tableSchemaLibrary !== 'object') {
        settings.tableSchemaLibrary = { global: [], characters: {} };
    }
    if (!Array.isArray(settings.tableSchemaLibrary.global)) {
        settings.tableSchemaLibrary.global = [];
    }
    if (!settings.tableSchemaLibrary.characters || typeof settings.tableSchemaLibrary.characters !== 'object') {
        settings.tableSchemaLibrary.characters = {};
    }
    if (!settings.tableProfileLibrary || typeof settings.tableProfileLibrary !== 'object') {
        settings.tableProfileLibrary = { global: [], characters: {}, selectedGlobalProfileId: '', selectedCharacterProfileIds: {} };
    }
    if (!Array.isArray(settings.tableProfileLibrary.global)) {
        settings.tableProfileLibrary.global = [];
    }
    if (!settings.tableProfileLibrary.characters || typeof settings.tableProfileLibrary.characters !== 'object') {
        settings.tableProfileLibrary.characters = {};
    }
    if (!settings.tableProfileLibrary.selectedCharacterProfileIds || typeof settings.tableProfileLibrary.selectedCharacterProfileIds !== 'object') {
        settings.tableProfileLibrary.selectedCharacterProfileIds = {};
    }
    if (!settings.tableProfileLibrary.global.length && settings.tableSchemaLibrary.global.length) {
        settings.tableProfileLibrary.global.push(createTableProfile('全局默认表格', settings.tableSchemaLibrary.global));
    }
    for (const [characterKey, schemas] of Object.entries(settings.tableSchemaLibrary.characters || {})) {
        if (Array.isArray(schemas) && schemas.length && !Array.isArray(settings.tableProfileLibrary.characters[characterKey])) {
            settings.tableProfileLibrary.characters[characterKey] = [createTableProfile('角色默认表格', schemas)];
        }
    }
    if (!Array.isArray(settings.tablePromptPresets)) {
        settings.tablePromptPresets = [{
            id: 'default-table-prompt',
            name: '默认表格修改提示词',
            prompt: defaultTableEditPrompt,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }];
    }
    if (!settings.selectedTablePromptPresetId) {
        settings.selectedTablePromptPresetId = settings.tablePromptPresets[0]?.id || '';
    }
    if (!Array.isArray(settings.inlinePromptPresets)) {
        settings.inlinePromptPresets = [
            {
                id: 'default-inline-summary',
                type: 'summary',
                name: '默认随正文摘要',
                prompt: defaultInlineSummaryPrompt,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
            {
                id: 'default-inline-table',
                type: 'table',
                name: '默认随正文填表',
                prompt: defaultInlineTablePrompt,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ];
    }
    const defaultInlineSummaryPreset = settings.inlinePromptPresets.find(preset => preset.id === 'default-inline-summary');
    if (defaultInlineSummaryPreset && defaultInlineSummaryPreset.prompt !== defaultInlineSummaryPrompt) {
        defaultInlineSummaryPreset.prompt = defaultInlineSummaryPrompt;
        defaultInlineSummaryPreset.updatedAt = new Date().toISOString();
    }
    if (!settings.selectedInlinePromptPresetIds || typeof settings.selectedInlinePromptPresetIds !== 'object') {
        settings.selectedInlinePromptPresetIds = {};
    }
    if (!settings.selectedInlinePromptPresetIds.summary) {
        settings.selectedInlinePromptPresetIds.summary = settings.inlinePromptPresets.find(preset => preset.type === 'summary')?.id || '';
    }
    if (!settings.selectedInlinePromptPresetIds.table) {
        settings.selectedInlinePromptPresetIds.table = settings.inlinePromptPresets.find(preset => preset.type === 'table')?.id || '';
    }
}

function migrateStagePromptTimeSpan(prompt) {
    const migrated = String(prompt || defaultStageGenerationPrompt)
        .replace('★ 当前时间点：XXX ☆', '★ 时间跨度：XXX-XXX ☆')
        .replace('概括每章节内容，让后续可清晰了解之前章节具体发生过什么', '概括每章节内容（包括时间），让后续可清晰了解之前章节具体发生过什么');
    if (
        migrated.includes('详细提炼本阶段的“起、承、转、合”')
        || migrated.includes('最能定义本卷灵魂的三句台词')
    ) {
        return defaultStageGenerationPrompt;
    }
    return migrated;
}

function migrateEpicPromptTimeSpan(prompt) {
    const migrated = String(prompt || defaultEpicGenerationPrompt)
        .replace('★ 当前时间点：XXX ☆', '★ 时间跨度：XXX-XXX ☆')
        .replace('按时间顺序整理输入材料覆盖的核心事件，保留足够细节，避免只剩空泛主题', '按时间顺序整理输入材料覆盖的核心事件（标注时间），保留足够细节，避免只剩空泛主题');
    if (migrated.includes('[事件一名称]：……') || migrated.includes('[事件二名称]：……')) {
        return defaultEpicGenerationPrompt;
    }
    return migrated;
}

function migrateBuiltInStructuredPrompt(prompt, fallback, legacyMarkers) {
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

function sanitizeChatStateWhenStructureChanges(state) {
    const context = getContext();
    const sourceChat = context.chat || chat || [];
    const chatLength = Array.isArray(sourceChat) ? sourceChat.length : 0;
    const previousLength = sanitizedChatLengths.get(state);
    if (previousLength === chatLength) {
        return;
    }
    if (previousLength === undefined || chatLength < previousLength) {
        sanitizeCurrentChatState(state);
    }
    sanitizedChatLengths.set(state, chatLength);
}

function ensureState() {
    const isNewChatState = !chat_metadata[STORAGE_KEY];
    if (!chat_metadata[STORAGE_KEY]) {
        chat_metadata[STORAGE_KEY] = cloneDefaultState();
    }

    const state = chat_metadata[STORAGE_KEY];
    if (isNewChatState) {
        applyGlobalActiveConfigToState(state);
    } else if (state.configInitialized === undefined) {
        state.configInitialized = true;
    }
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
        state.generationPrompts.missing = defaultMissingSummaryPrompt;
        state.generationPrompts.stage = defaultGenericStageGenerationPrompt;
        state.generationPrompts.epic = defaultGenericEpicGenerationPrompt;
    }
    state.generationPrompts.stage = migrateStagePromptTimeSpan(state.generationPrompts.stage);
    state.generationPrompts.epic = migrateEpicPromptTimeSpan(state.generationPrompts.epic);
    state.generationPrompts.story = migrateBuiltInStructuredPrompt(state.generationPrompts.story, defaultStoryGenerationPrompt, [
        '# 👾旧正文补课摘要模式！',
        '➤ 🎬 【场记打板】（流水账形式记录本批次已经发生的全部事件',
        '➤ 💡 【第四面墙】（用👾视角记录角色不知道',
    ]);
    state.generationPrompts.missing = migrateBuiltInStructuredPrompt(state.generationPrompts.missing, defaultMissingSummaryPrompt, [
        '你是剧情剪辑台的缺失摘要补写器',
        '每个楼层必须严格使用以下格式',
        '➤ 🪢 【剧本暗线】（伏笔系统',
    ]);
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
    state.storySummaries.forEach(summary => { summary.level = getSummaryLevel({ ...summary, type: blockTypes.STORY }); });
    state.stageSummaries.forEach(summary => { summary.level = getSummaryLevel({ ...summary, type: blockTypes.STAGE }); });
    state.epicSummaries.forEach(summary => { summary.level = getSummaryLevel({ ...summary, type: blockTypes.EPIC }); });
    sortSummariesBySource(state.storySummaries);
    sortSummariesBySource(state.stageSummaries);
    sortSummariesBySource(state.epicSummaries);
    state.drafts = Array.isArray(state.drafts) ? state.drafts : [];
    state.history = Array.isArray(state.history) ? state.history : [];
    state.taskQueue = Array.isArray(state.taskQueue) ? state.taskQueue : [];
    state.autoSummaryTransactions = Array.isArray(state.autoSummaryTransactions) ? state.autoSummaryTransactions : [];
    state.memoryRecords = Array.isArray(state.memoryRecords) ? state.memoryRecords : [];
    state.scanPreview = (Array.isArray(state.scanPreview) ? state.scanPreview : []).slice(-maxStoredScanPreviewItems);
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
    state.autoHideRecent = state.autoHideRecent && typeof state.autoHideRecent === 'object'
        ? state.autoHideRecent
        : structuredClone(defaultState.autoHideRecent);
    for (const [key, value] of Object.entries(defaultState.autoHideRecent)) {
        if (state.autoHideRecent[key] === undefined) {
            state.autoHideRecent[key] = structuredClone(value);
        }
    }
    state.autoHideRecent.preserveRecent = Math.max(0, Number(state.autoHideRecent.preserveRecent ?? defaultState.autoHideRecent.preserveRecent));
    state.autoHideRecent.managedMessageIds = getFiniteMessageIds(state.autoHideRecent.managedMessageIds || []);
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
    state.turnSummary = state.turnSummary && typeof state.turnSummary === 'object'
        ? state.turnSummary
        : structuredClone(defaultState.turnSummary);
    for (const [key, value] of Object.entries(defaultState.turnSummary)) {
        if (state.turnSummary[key] === undefined) {
            state.turnSummary[key] = structuredClone(value);
        }
    }
    state.turnSummary.prompt = migrateBuiltInStructuredPrompt(state.turnSummary.prompt, defaultTurnSummaryPrompt, [
        '你是剧情剪辑台的正文摘要器',
        '输出必须放在 <summaryDraft>',
        '➤ 🎙️ 【高光收音】',
    ]);
    state.tableDatabase = state.tableDatabase && typeof state.tableDatabase === 'object'
        ? state.tableDatabase
        : structuredClone(defaultState.tableDatabase);
    for (const [key, value] of Object.entries(defaultState.tableDatabase)) {
        if (state.tableDatabase[key] === undefined) {
            state.tableDatabase[key] = structuredClone(value);
        }
    }
    if (!Object.values(tableSchemaScopes).includes(state.tableDatabase.schemaScope)) {
        ensureGlobalSettings();
        state.tableDatabase.schemaScope = extension_settings[STORAGE_KEY].defaultTableSchemaScope || tableSchemaScopes.CHAT;
    }
    state.tableDatabase.tables = Array.isArray(state.tableDatabase.tables) ? state.tableDatabase.tables : [];
    state.tableDatabase.editDrafts = Array.isArray(state.tableDatabase.editDrafts) ? state.tableDatabase.editDrafts : [];
    state.tableDatabase.history = Array.isArray(state.tableDatabase.history) ? state.tableDatabase.history : [];
    state.tableDatabase.undoStack = Array.isArray(state.tableDatabase.undoStack) ? state.tableDatabase.undoStack : [];
    state.tableDatabase.redoStack = Array.isArray(state.tableDatabase.redoStack) ? state.tableDatabase.redoStack : [];
    state.tableDatabase.rollbackHistory = Array.isArray(state.tableDatabase.rollbackHistory) ? state.tableDatabase.rollbackHistory : [];
    state.tableDatabase.lastAppliedSourceMessageIds = getFiniteMessageIds(state.tableDatabase.lastAppliedSourceMessageIds || []);
    state.tableDatabase.chatProfiles = Array.isArray(state.tableDatabase.chatProfiles) ? state.tableDatabase.chatProfiles : [];
    state.tableDatabase.profileRows = state.tableDatabase.profileRows && typeof state.tableDatabase.profileRows === 'object' ? state.tableDatabase.profileRows : {};
    ensureTableProfileForScope(state.tableDatabase.schemaScope, state);
    mergeScopedTableSchemasIntoState(state);
    state.inlineGeneration = state.inlineGeneration && typeof state.inlineGeneration === 'object'
        ? state.inlineGeneration
        : structuredClone(defaultState.inlineGeneration);
    for (const [key, value] of Object.entries(defaultState.inlineGeneration)) {
        if (state.inlineGeneration[key] === undefined) {
            state.inlineGeneration[key] = structuredClone(value);
        }
    }
    state.inlineGeneration.summaryPrompt = migrateBuiltInStructuredPrompt(state.inlineGeneration.summaryPrompt, defaultInlineSummaryPrompt, [
        '请在本次回复正文结束后',
        '推荐格式：',
        '<summary>📋 剧情摘要</summary>',
    ]);
    if (state.inlineGeneration.hideTableEditMigratedToRegex !== true) {
        state.inlineGeneration.hideTableEdit = false;
        state.inlineGeneration.hideTableEditMigratedToRegex = true;
    }
    state.vectorMemory = state.vectorMemory && typeof state.vectorMemory === 'object'
        ? state.vectorMemory
        : structuredClone(defaultVectorMemory);
    for (const [key, value] of Object.entries(defaultVectorMemory)) {
        if (state.vectorMemory[key] === undefined) {
            state.vectorMemory[key] = structuredClone(value);
        }
    }
    if (/JSON\s*字符串数组|JSON\s*对象|3\s*到\s*5\s*条.*中文查询句|一个检索意图\s*\+\s*3\s*到\s*5\s*条|适合检索旧剧情记忆|recent\s+plot|old\s+memories|create\s+queries|only\s+output\s+the\s+queries/i.test(String(state.vectorMemory.queryRewritePrompt || ''))) {
        state.vectorMemory.queryRewritePrompt = defaultVectorMemory.queryRewritePrompt;
    }
    state.vectorMemory.customApi = state.vectorMemory.customApi && typeof state.vectorMemory.customApi === 'object'
        ? state.vectorMemory.customApi
        : structuredClone(defaultVectorMemory.customApi);
    for (const [key, value] of Object.entries(defaultVectorMemory.customApi)) {
        if (state.vectorMemory.customApi[key] === undefined) {
            state.vectorMemory.customApi[key] = structuredClone(value);
        }
    }
    state.vectorMemory.queryCustomApi = state.vectorMemory.queryCustomApi && typeof state.vectorMemory.queryCustomApi === 'object'
        ? state.vectorMemory.queryCustomApi
        : structuredClone(defaultVectorMemory.queryCustomApi);
    for (const [key, value] of Object.entries(defaultVectorMemory.queryCustomApi)) {
        if (state.vectorMemory.queryCustomApi[key] === undefined) {
            state.vectorMemory.queryCustomApi[key] = structuredClone(value);
        }
    }
    state.vectorMemory.records = Array.isArray(state.vectorMemory.records) ? state.vectorMemory.records : [];
    state.vectorMemory.embeddingCache = state.vectorMemory.embeddingCache && typeof state.vectorMemory.embeddingCache === 'object' ? state.vectorMemory.embeddingCache : {};
    state.vectorMemory.lastHits = Array.isArray(state.vectorMemory.lastHits) ? state.vectorMemory.lastHits : [];
    state.vectorMemory.lastEmbeddingCandidates = Array.isArray(state.vectorMemory.lastEmbeddingCandidates) ? state.vectorMemory.lastEmbeddingCandidates : [];
    state.vectorMemory.lastRerankCandidates = Array.isArray(state.vectorMemory.lastRerankCandidates) ? state.vectorMemory.lastRerankCandidates : [];
    state.chatGuard = state.chatGuard && typeof state.chatGuard === 'object'
        ? state.chatGuard
        : structuredClone(defaultState.chatGuard);
    sanitizeChatStateWhenStructureChanges(state);
    return state;
}

function getCurrentChatMessageMap() {
    const context = getContext();
    const sourceChat = context.chat || chat || [];
    if (!Array.isArray(sourceChat) || !sourceChat.length) {
        return null;
    }
    const ids = new Set();
    sourceChat.forEach((message, messageId) => {
        if (message) {
            ids.add(Number(messageId));
        }
    });
    return {
        ids,
        sourceChat,
        maxId: sourceChat.length - 1,
    };
}

function isCurrentMessageId(messageId, messageMap) {
    const id = Number(messageId);
    if (!Number.isFinite(id)) {
        return true;
    }
    if (id >= Number.MAX_SAFE_INTEGER) {
        return true;
    }
    return messageMap.ids.has(id);
}

function hasCurrentSourceMessages(item, messageMap) {
    const ids = getFiniteMessageIds(item?.sourceMessageIds || []);
    if (ids.length) {
        return ids.every(id => isCurrentMessageId(id, messageMap));
    }
    if (item?.messageId !== undefined && item.messageId !== null) {
        return isCurrentMessageId(item.messageId, messageMap);
    }
    return true;
}

function hasExplicitCurrentSourceMessages(item, messageMap) {
    const ids = getFiniteMessageIds(item?.sourceMessageIds || []);
    return ids.length > 0 && ids.every(id => isCurrentMessageId(id, messageMap));
}

function isAllowedVectorMessage(messageId, role, state, messageMap) {
    if (!isCurrentMessageId(messageId, messageMap)) {
        return false;
    }
    if (state.vectorMemory?.includeUser === true) {
        return true;
    }
    const id = Number(messageId);
    const message = Number.isFinite(id) ? messageMap.sourceChat?.[id] : null;
    if (message?.is_user) {
        return false;
    }
    return String(role || '').toLowerCase() !== 'user';
}

function filterByHashList(values = [], validHashes = new Set()) {
    return unique((Array.isArray(values) ? values : []).filter(hash => validHashes.has(hash)));
}

function sanitizeCurrentChatState(state) {
    const messageMap = getCurrentChatMessageMap();
    if (!messageMap) {
        return false;
    }

    let prunedCount = 0;
    const countPruned = (before, after) => {
        prunedCount += Math.max(0, before - after);
    };
    const filterArray = (items, predicate) => {
        const source = Array.isArray(items) ? items : [];
        const filtered = source.filter(predicate);
        countPruned(source.length, filtered.length);
        return filtered;
    };

    state.blocks = filterArray(state.blocks, block => hasCurrentSourceMessages(block, messageMap));
    state.scanPreview = filterArray(state.scanPreview, item => hasCurrentSourceMessages(item, messageMap));
    state.storySummaries = filterArray(state.storySummaries, summary => hasCurrentSourceMessages(summary, messageMap));
    const validStoryHashes = new Set([
        ...state.blocks.map(block => block.hash).filter(Boolean),
        ...state.storySummaries.map(summary => summary.hash).filter(Boolean),
    ]);

    state.stageSummaries = filterArray(state.stageSummaries, summary => {
        if (!hasCurrentSourceMessages(summary, messageMap)) {
            return false;
        }
        if (hasExplicitCurrentSourceMessages(summary, messageMap)) {
            return true;
        }
        const sourceHashes = Array.isArray(summary.sourceHashes) ? summary.sourceHashes.filter(Boolean) : [];
        return !sourceHashes.length || sourceHashes.every(hash => validStoryHashes.has(hash));
    });
    const validStageHashes = new Set(state.stageSummaries.map(summary => summary.hash).filter(Boolean));

    state.epicSummaries = filterArray(state.epicSummaries, summary => {
        if (!hasCurrentSourceMessages(summary, messageMap)) {
            return false;
        }
        if (hasExplicitCurrentSourceMessages(summary, messageMap)) {
            return true;
        }
        const sourceStageHashes = Array.isArray(summary.sourceStageHashes) ? summary.sourceStageHashes.filter(Boolean) : [];
        const sourceHashes = Array.isArray(summary.sourceHashes) ? summary.sourceHashes.filter(Boolean) : [];
        const stageOk = !sourceStageHashes.length || sourceStageHashes.every(hash => validStageHashes.has(hash));
        const storyOk = !sourceHashes.length || sourceHashes.every(hash => validStoryHashes.has(hash) || validStageHashes.has(hash));
        return stageOk && storyOk;
    });
    const validEpicHashes = new Set(state.epicSummaries.map(summary => summary.hash).filter(Boolean));

    const previousCoveredBlockCount = state.coveredBlockHashes.length;
    state.coveredBlockHashes = filterByHashList(state.coveredBlockHashes, validStoryHashes);
    countPruned(previousCoveredBlockCount, state.coveredBlockHashes.length);
    const previousCoveredStageCount = state.coveredStageHashes.length;
    state.coveredStageHashes = [...getActiveCoveredStageHashes(state)];
    countPruned(previousCoveredStageCount, state.coveredStageHashes.length);

    for (const key of ['hiddenMessageIds', 'customHiddenMessageIds']) {
        const previous = Array.isArray(state[key]) ? state[key] : [];
        state[key] = unique(previous.filter(id => isCurrentMessageId(id, messageMap)));
        countPruned(previous.length, state[key].length);
    }
    if (state.autoHideRecent && typeof state.autoHideRecent === 'object') {
        const previous = Array.isArray(state.autoHideRecent.managedMessageIds) ? state.autoHideRecent.managedMessageIds : [];
        state.autoHideRecent.managedMessageIds = unique(previous.filter(id => isCurrentMessageId(id, messageMap)));
        countPruned(previous.length, state.autoHideRecent.managedMessageIds.length);
    }
    if (Array.isArray(state.autoSummaryTransactions)) {
        const previous = state.autoSummaryTransactions;
        state.autoSummaryTransactions = previous
            .map(transaction => ({
                ...transaction,
                sourceMessageIds: unique(getFiniteMessageIds(transaction.sourceMessageIds || [])),
                hiddenMessageIds: unique(getFiniteMessageIds(transaction.hiddenMessageIds || []).filter(id => isCurrentMessageId(id, messageMap))),
            }))
            .filter(transaction => transaction.summaryHash && transaction.status !== 'rolled_back');
        countPruned(previous.length, state.autoSummaryTransactions.length);
    }

    if (state.vectorMemory && typeof state.vectorMemory === 'object') {
        const previousRecordCount = Array.isArray(state.vectorMemory.records) ? state.vectorMemory.records.length : 0;
        state.vectorMemory.records = filterArray(state.vectorMemory.records, record => isAllowedVectorMessage(record?.messageId, record?.role, state, messageMap));
        const previousHitCount = Array.isArray(state.vectorMemory.lastHits) ? state.vectorMemory.lastHits.length : 0;
        state.vectorMemory.lastHits = filterArray(state.vectorMemory.lastHits, hit => isAllowedVectorMessage(hit?.messageId, hit?.role, state, messageMap));
        if (previousRecordCount !== state.vectorMemory.records.length) {
            state.vectorMemory.dirty = true;
            state.vectorMemory.dirtyReason = '当前聊天分支已清理越界索引';
            state.vectorMemory.lastIndexedSignature = '';
        }
    }

    const validMemoryHashes = new Set([...validStoryHashes, ...validStageHashes, ...validEpicHashes]);
    state.memoryRecords = filterArray(state.memoryRecords, record => !record?.hash || validMemoryHashes.has(record.hash));

    if (prunedCount > 0) {
        state.chatGuard = {
            lastPrunedAt: new Date().toISOString(),
            lastPrunedCount: prunedCount,
            lastPrunedReason: '当前聊天缺少部分来源楼层，已清理继承的旧记忆引用',
        };
        const parts = getInjectionMemoryParts(state);
        state.generatedMemory = parts.memory;
        state.injection.content = renderInjectionContent(state);
        saveState();
    }
    return prunedCount > 0;
}

function normalizeLineEndings(value) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
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

function compactEmbedding(values = [], dimensions = defaultVectorMemory.embeddingDimensions) {
    const source = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
    const targetSize = Math.max(32, Math.min(384, Number(dimensions || defaultVectorMemory.embeddingDimensions)));
    if (!source.length) {
        return [];
    }
    const normalize = vector => {
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
        return vector.map(value => Number((value / norm).toFixed(6)));
    };
    if (source.length <= targetSize) {
        return normalize(source);
    }
    const compact = [];
    for (let index = 0; index < targetSize; index++) {
        const start = Math.floor(index * source.length / targetSize);
        const end = Math.max(start + 1, Math.floor((index + 1) * source.length / targetSize));
        const slice = source.slice(start, end);
        const average = slice.reduce((sum, value) => sum + value, 0) / slice.length;
        compact.push(average);
    }
    return normalize(compact);
}

function pruneVectorRuntimeCache(limit = 120) {
    while (vectorEmbeddingRuntimeCache.size > limit) {
        const firstKey = vectorEmbeddingRuntimeCache.keys().next().value;
        vectorEmbeddingRuntimeCache.delete(firstKey);
    }
}

function getClippedVectorText(value, limit = defaultVectorMemory.maxStoredTextChars) {
    const text = String(value || '');
    const max = Math.max(240, Number(limit || defaultVectorMemory.maxStoredTextChars));
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

function slimVectorMemoryForSave(vectorMemory = null) {
    if (!vectorMemory || typeof vectorMemory !== 'object') {
        return;
    }
    const dimensions = Math.max(32, Number(vectorMemory.embeddingDimensions || defaultVectorMemory.embeddingDimensions));
    const textLimit = Math.max(240, Number(vectorMemory.maxStoredTextChars || defaultVectorMemory.maxStoredTextChars));
    vectorMemory.embeddingCache = {};
    vectorMemory.records = Array.isArray(vectorMemory.records)
        ? vectorMemory.records.map(record => ({
            ...record,
            text: getClippedVectorText(record.text, textLimit),
            matchedText: getClippedVectorText(record.matchedText, Math.min(textLimit, 480)),
            embedding: compactEmbedding(record.embedding, dimensions),
        }))
        : [];
    vectorMemory.lastHits = Array.isArray(vectorMemory.lastHits)
        ? vectorMemory.lastHits.map(hit => ({
            ...hit,
            text: getClippedVectorText(hit.text, Math.max(textLimit, Number(vectorMemory.perMessageMaxChars || defaultVectorMemory.perMessageMaxChars))),
            matchedText: getClippedVectorText(hit.matchedText, Math.min(textLimit, 480)),
        }))
        : [];
}

function saveState() {
    slimVectorMemoryForSave(chat_metadata?.[STORAGE_KEY]?.vectorMemory);
    saveMetadataDebounced();
}

function saveGlobalSettings() {
    saveSettingsDebounced();
}

function getAppearanceSettings() {
    ensureGlobalSettings();
    return extension_settings[STORAGE_KEY].ui;
}

function applyAppearanceTheme(themeOverride = null, modeOverride = null) {
    const root = document.getElementById('bakemono-workbench-root');
    if (!root) {
        return;
    }
    const ui = getAppearanceSettings();
    const mode = ['tavern', 'custom'].includes(modeOverride) ? modeOverride : ui.themeMode;
    const theme = sanitizeCustomTheme(themeOverride || ui.customTheme);
    const variableMap = {
        paper: '--bakemono-theme-paper',
        paperRaised: '--bakemono-theme-paper-raised',
        paperSoft: '--bakemono-theme-paper-soft',
        ink: '--bakemono-theme-ink',
        muted: '--bakemono-theme-muted',
        accent: '--bakemono-theme-accent',
        secondary: '--bakemono-theme-secondary',
        accentStrong: '--bakemono-theme-accent-strong',
        line: '--bakemono-theme-line',
        backdrop: '--bakemono-theme-backdrop',
        danger: '--bakemono-theme-danger',
    };
    root.classList.toggle('bakemono-custom-theme', mode === 'custom');
    root.dataset.bakemonoThemeMode = mode;
    root.dataset.bakemonoThemeAppearance = mode === 'custom' ? theme.appearance : '';
    root.style.colorScheme = mode === 'custom' ? theme.appearance : '';
    for (const [key, cssVariable] of Object.entries(variableMap)) {
        if (mode === 'custom') {
            root.style.setProperty(cssVariable, theme.tokens[key]);
        } else {
            root.style.removeProperty(cssVariable);
        }
    }
    const effectVariables = {
        gradientStrength: ['--bakemono-theme-gradient-strength', '%'],
        gradientAngle: ['--bakemono-theme-gradient-angle', 'deg'],
        grain: ['--bakemono-theme-grain', '%'],
        shadow: ['--bakemono-theme-shadow', 'px'],
        radius: ['--bakemono-theme-radius', 'px'],
    };
    for (const [key, [cssVariable, unit]] of Object.entries(effectVariables)) {
        if (mode === 'custom') {
            root.style.setProperty(cssVariable, `${theme.effects[key]}${unit}`);
        } else {
            root.style.removeProperty(cssVariable);
        }
    }
    if (mode === 'custom') {
        root.style.setProperty('--bakemono-theme-shadow-blur', `${theme.effects.shadow * 2.8}px`);
    } else {
        root.style.removeProperty('--bakemono-theme-shadow-blur');
    }
}

function readCustomThemeFromUi() {
    const ui = getAppearanceSettings();
    const source = structuredClone(ui.customTheme || defaultCustomTheme);
    source.name = String($('#bakemono-memory-theme-name').val() || source.name);
    source.appearance = String($('#bakemono-memory-theme-appearance').val() || source.appearance);
    source.tokens = source.tokens || {};
    source.effects = source.effects || {};
    $('[data-bakemono-theme-color]').each(function () {
        source.tokens[this.dataset.bakemonoThemeColor] = this.value;
    });
    $('[data-bakemono-theme-effect]').each(function () {
        source.effects[this.dataset.bakemonoThemeEffect] = Number(this.value);
    });
    return sanitizeCustomTheme(source);
}

function setCustomThemeJson(theme) {
    $('#bakemono-memory-theme-json').val(JSON.stringify(sanitizeCustomTheme(theme), null, 2));
}

function renderAppearanceSettings() {
    const ui = getAppearanceSettings();
    const theme = sanitizeCustomTheme(ui.customTheme);
    $('[data-bakemono-theme-mode]').each(function () {
        const active = this.dataset.bakemonoThemeMode === ui.themeMode;
        this.classList.toggle('is-active', active);
        this.setAttribute('aria-pressed', String(active));
    });
    $('#bakemono-memory-custom-theme-editor').prop('hidden', ui.themeMode !== 'custom');
    $('#bakemono-memory-theme-name').val(theme.name);
    $('#bakemono-memory-theme-appearance').val(theme.appearance);
    $('[data-bakemono-theme-color]').each(function () {
        const key = this.dataset.bakemonoThemeColor;
        this.value = theme.tokens[key];
        $(`[data-bakemono-theme-color-value="${key}"]`).text(theme.tokens[key]);
    });
    $('[data-bakemono-theme-effect]').each(function () {
        const key = this.dataset.bakemonoThemeEffect;
        this.value = theme.effects[key];
        $(`[data-bakemono-theme-effect-value="${key}"]`).text(theme.effects[key]);
    });
    setCustomThemeJson(theme);
    applyAppearanceTheme();
}

function previewCustomThemeFromUi() {
    const theme = readCustomThemeFromUi();
    $('[data-bakemono-theme-color-value]').each(function () {
        const key = this.dataset.bakemonoThemeColorValue;
        this.textContent = theme.tokens[key];
    });
    $('[data-bakemono-theme-effect-value]').each(function () {
        const key = this.dataset.bakemonoThemeEffectValue;
        this.textContent = theme.effects[key];
    });
    setCustomThemeJson(theme);
    applyAppearanceTheme(theme, 'custom');
}

function parseCustomThemeJson(text) {
    const parsed = JSON.parse(String(text || ''));
    if (!parsed || typeof parsed !== 'object' || !parsed.tokens || typeof parsed.tokens !== 'object') {
        throw new Error('主题 JSON 缺少 tokens 对象。');
    }
    if (parsed.$schema && parsed.$schema !== CUSTOM_THEME_SCHEMA) {
        throw new Error(`不支持的主题格式：${parsed.$schema}`);
    }
    return sanitizeCustomTheme(parsed);
}

function saveCustomTheme(theme, message = '自定义主题已保存。') {
    const ui = getAppearanceSettings();
    ui.themeMode = 'custom';
    ui.customTheme = sanitizeCustomTheme(theme);
    saveGlobalSettings();
    renderAppearanceSettings();
    toastr.success(message);
}

function downloadCustomThemeJson() {
    const theme = readCustomThemeFromUi();
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = theme.name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48) || 'bakemono-theme';
    link.href = url;
    link.download = `${safeName}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function importCustomThemeJson(text, message = '主题已导入并应用。') {
    const theme = parseCustomThemeJson(text);
    saveCustomTheme(theme, message);
    return theme;
}

function getTableSchemaScopeLabel(scope) {
    if (scope === tableSchemaScopes.GLOBAL) return '全局表格框架';
    if (scope === tableSchemaScopes.CHARACTER) return '当前角色表格框架';
    return '当前聊天表格';
}

function getTableProfileScopeLabel(scope) {
    if (scope === tableSchemaScopes.GLOBAL) return '全局';
    if (scope === tableSchemaScopes.CHARACTER) return '当前角色';
    return '当前聊天';
}

function getCurrentCharacterSchemaKey() {
    const context = getContext();
    const character = context.characters?.[context.characterId] || {};
    return String(character.avatar || character.name || context.characterId || context.name2 || 'unknown-character');
}

function getCurrentCharacterSchemaLabel() {
    const context = getContext();
    const character = context.characters?.[context.characterId] || {};
    return String(character.name || context.name2 || getCurrentCharacterSchemaKey());
}

function getTableSchemaLibrary() {
    ensureGlobalSettings();
    return extension_settings[STORAGE_KEY].tableSchemaLibrary;
}

function createTableProfile(name = '未命名表格组', tables = []) {
    const now = new Date().toISOString();
    return {
        id: `table-profile-${getHash(`${now}|${name}|${Math.random()}`)}`,
        name: String(name || '未命名表格组'),
        tables: normalizeTableSchemas(tables),
        createdAt: now,
        updatedAt: now,
    };
}

function toTableSchema(table, fallbackIndex = 0) {
    const columns = Array.isArray(table?.columns) ? table.columns.map(col => String(col || '')) : [];
    const tableIndex = Number.isFinite(Number(table?.tableIndex)) ? Number(table.tableIndex) : fallbackIndex;
    const readOnly = !!table?.readOnly;
    return {
        id: table?.id || `table-${getHash(`${table?.name || tableIndex}|${tableIndex}`)}`,
        tableIndex,
        name: String(table?.name || `表格 ${tableIndex}`),
        columns,
        columnPrompts: Array.isArray(table?.columnPrompts)
            ? table.columnPrompts.map(text => String(text || '')).slice(0, columns.length)
            : columns.map(() => ''),
        note: String(table?.note || ''),
        initNode: String(table?.initNode || ''),
        insertNode: String(table?.insertNode || ''),
        updateNode: String(table?.updateNode || ''),
        deleteNode: String(table?.deleteNode || ''),
        rows: [],
        required: !!table?.required,
        readOnly,
        inject: true,
        injectLimit: Math.max(0, Number(table?.injectLimit ?? 1200)),
        allowAiEdit: !readOnly && (table?.allowAiEdit !== undefined ? !!table.allowAiEdit : true),
    };
}

function normalizeTableSchemas(tables = []) {
    return (Array.isArray(tables) ? tables : [])
        .map((table, index) => toTableSchema(table, index))
        .filter(table => table.columns.length || table.name.trim());
}

function getScopedTableSchemas(scope = tableSchemaScopes.CHAT, state = chat_metadata[STORAGE_KEY]) {
    if (!state?.tableDatabase) {
        return [];
    }
    return normalizeTableSchemas(getActiveTableProfile(state)?.tables || state.tableDatabase.tables || []);
}

function saveScopedTableSchemas(tables = [], scope = tableSchemaScopes.CHAT) {
    const schemas = normalizeTableSchemas(tables);
    const state = ensureState();
    if (scope === tableSchemaScopes.CHAT) {
        const profiles = ensureChatTableProfiles(state);
        const profile = profiles.find(item => item.id === state.tableDatabase.activeProfileId) || profiles[0];
        if (profile) {
            profile.tables = schemas;
            profile.updatedAt = new Date().toISOString();
        }
        return;
    }
    const library = getTableProfileLibrary();
    if (scope === tableSchemaScopes.GLOBAL) {
        const profile = getActiveTableProfile(state);
        if (profile) {
            profile.tables = schemas;
            profile.updatedAt = new Date().toISOString();
        }
    } else if (scope === tableSchemaScopes.CHARACTER) {
        const key = getCurrentCharacterSchemaKey();
        const profile = getActiveTableProfile(state);
        if (profile) {
            if (!Array.isArray(library.characters[key])) {
                library.characters[key] = [];
            }
            const index = library.characters[key].findIndex(item => item.id === profile.id);
            if (index >= 0) {
                library.characters[key][index] = { ...profile, tables: schemas, updatedAt: new Date().toISOString() };
            }
        }
    }
    saveGlobalSettings();
}

function getTableProfileLibrary() {
    ensureGlobalSettings();
    return extension_settings[STORAGE_KEY].tableProfileLibrary;
}

function ensureChatTableProfiles(state = ensureState()) {
    state.tableDatabase.chatProfiles = Array.isArray(state.tableDatabase.chatProfiles) ? state.tableDatabase.chatProfiles : [];
    if (!state.tableDatabase.chatProfiles.length) {
        state.tableDatabase.chatProfiles.push(createTableProfile('当前聊天默认表格', state.tableDatabase.tables || []));
    }
    if (!state.tableDatabase.activeProfileId) {
        state.tableDatabase.activeProfileId = state.tableDatabase.chatProfiles[0]?.id || '';
    }
    return state.tableDatabase.chatProfiles;
}

function getTableProfilesForScope(scope = tableSchemaScopes.CHAT, state = ensureState()) {
    if (scope === tableSchemaScopes.CHAT) {
        return ensureChatTableProfiles(state);
    }
    const library = getTableProfileLibrary();
    if (scope === tableSchemaScopes.GLOBAL) {
        return library.global;
    }
    const key = getCurrentCharacterSchemaKey();
    if (!Array.isArray(library.characters[key])) {
        library.characters[key] = [];
    }
    return library.characters[key];
}

function ensureTableProfileForScope(scope = tableSchemaScopes.CHAT, state = ensureState()) {
    const profiles = getTableProfilesForScope(scope, state);
    if (!profiles.length) {
        profiles.push(createTableProfile(`${getTableProfileScopeLabel(scope)}默认表格`, state.tableDatabase.tables || []));
    }
    if (!state.tableDatabase.activeProfileId || !profiles.some(profile => profile.id === state.tableDatabase.activeProfileId)) {
        state.tableDatabase.activeProfileId = profiles[0]?.id || '';
    }
    return profiles.find(profile => profile.id === state.tableDatabase.activeProfileId) || profiles[0] || null;
}

function getActiveTableProfile(state = ensureState()) {
    const scope = state.tableDatabase?.schemaScope || tableSchemaScopes.CHAT;
    return ensureTableProfileForScope(scope, state);
}

function getActiveTableProfileKey(state = ensureState()) {
    const scope = state.tableDatabase?.schemaScope || tableSchemaScopes.CHAT;
    const profile = getActiveTableProfile(state);
    return `${scope}:${scope === tableSchemaScopes.CHARACTER ? getCurrentCharacterSchemaKey() : 'default'}:${profile?.id || 'default'}`;
}

function saveCurrentTableProfileRows(state = ensureState()) {
    state.tableDatabase.profileRows = state.tableDatabase.profileRows && typeof state.tableDatabase.profileRows === 'object'
        ? state.tableDatabase.profileRows
        : {};
    state.tableDatabase.profileRows[getActiveTableProfileKey(state)] = structuredClone(state.tableDatabase.tables || []);
}

function loadActiveTableProfileRows(state = ensureState()) {
    const profile = getActiveTableProfile(state);
    const key = getActiveTableProfileKey(state);
    const savedTables = state.tableDatabase.profileRows?.[key] || [];
    const schemas = normalizeTableSchemas(profile?.tables || []);
    state.tableDatabase.tables = schemas.map(schema => mergeTableSchemaWithRows(schema, findMatchingTable(schema, savedTables)));
}

function findMatchingTable(schema, tables = []) {
    return tables.find(table => schema.id && table.id === schema.id)
        || tables.find(table => Number(table.tableIndex) === Number(schema.tableIndex))
        || tables.find(table => String(table.name || '') === String(schema.name || ''));
}

function mergeTableSchemaWithRows(schema, existing) {
    const rows = Array.isArray(existing?.rows)
        ? existing.rows.map(row => schema.columns.map((_, index) => String(row?.[index] ?? '')))
        : [];
    return {
        ...schema,
        rows,
    };
}

function mergeScopedTableSchemasIntoState(state) {
    const scope = state?.tableDatabase?.schemaScope || tableSchemaScopes.CHAT;
    const schemas = getScopedTableSchemas(scope, state);
    if (!schemas.length) {
        return;
    }
    const currentTables = Array.isArray(state.tableDatabase.tables) ? state.tableDatabase.tables : [];
    const merged = schemas.map(schema => mergeTableSchemaWithRows(schema, findMatchingTable(schema, currentTables)));
    const extraLocalTables = currentTables.filter(table => !schemas.some(schema => findMatchingTable(schema, [table])));
    state.tableDatabase.tables = [...merged, ...extraLocalTables];
}

function setTableSchemaScope(scope, state = ensureState()) {
    const nextScope = Object.values(tableSchemaScopes).includes(scope) ? scope : tableSchemaScopes.CHAT;
    const previousScope = state.tableDatabase.schemaScope || tableSchemaScopes.CHAT;
    saveCurrentTableProfileRows(state);
    state.tableDatabase.schemaScope = nextScope;
    ensureGlobalSettings();
    extension_settings[STORAGE_KEY].defaultTableSchemaScope = nextScope;
    ensureTableProfileForScope(nextScope, state);
    loadActiveTableProfileRows(state);
    if (previousScope !== nextScope) {
        saveGlobalSettings();
    }
}

function syncCurrentTableSchemas(state = ensureState()) {
    const scope = state.tableDatabase?.schemaScope || tableSchemaScopes.CHAT;
    saveCurrentTableProfileRows(state);
    saveScopedTableSchemas(state.tableDatabase?.tables || [], scope);
}

function persistCurrentTableDatabase(state = ensureState()) {
    syncCurrentTableSchemas(state);
    updateInjectionFromSummaries();
    saveState();
    if ([tableSchemaScopes.GLOBAL, tableSchemaScopes.CHARACTER].includes(state.tableDatabase?.schemaScope)) {
        saveGlobalSettings();
    }
}

function pushTableUndoSnapshot(label = '表格操作', state = ensureState(), options = {}) {
    state.tableDatabase.undoStack = Array.isArray(state.tableDatabase.undoStack) ? state.tableDatabase.undoStack : [];
    const snapshot = {
        id: `table-undo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label: String(label || '表格操作'),
        createdAt: new Date().toISOString(),
        schemaScope: state.tableDatabase.schemaScope || tableSchemaScopes.CHAT,
        activeProfileId: state.tableDatabase.activeProfileId || '',
        profileKey: getActiveTableProfileKey(state),
        sourceMessageIds: getFiniteMessageIds(options.sourceMessageIds || []),
        tables: structuredClone(state.tableDatabase.tables || []),
    };
    state.tableDatabase.undoStack.unshift(snapshot);
    state.tableDatabase.undoStack = state.tableDatabase.undoStack.slice(0, 20);
    if (options.clearRedo !== false) {
        state.tableDatabase.redoStack = [];
    }
    return snapshot;
}

function undoLastTableOperation(state = ensureState()) {
    state.tableDatabase.undoStack = Array.isArray(state.tableDatabase.undoStack) ? state.tableDatabase.undoStack : [];
    const snapshot = state.tableDatabase.undoStack[0];
    if (!snapshot) {
        toastr.info('没有可撤销的表格操作。');
        return false;
    }
    const confirmed = confirmDanger(
        `撤销上次表格操作「${snapshot.label || '表格操作'}」？`,
        [
            snapshot.createdAt ? `记录时间：${new Date(snapshot.createdAt).toLocaleString()}` : '',
            '这会把当前表格恢复到该操作之前的状态。',
        ],
    );
    if (!confirmed) {
        return false;
    }
    state.tableDatabase.undoStack.shift();
    state.tableDatabase.redoStack = Array.isArray(state.tableDatabase.redoStack) ? state.tableDatabase.redoStack : [];
    state.tableDatabase.redoStack.unshift({
        ...snapshot,
        redoTables: structuredClone(state.tableDatabase.tables || []),
        undoneAt: new Date().toISOString(),
    });
    state.tableDatabase.redoStack = state.tableDatabase.redoStack.slice(0, 20);
    state.tableDatabase.tables = structuredClone(snapshot.tables || []);
    persistCurrentTableDatabase(state);
    renderAll(`已撤销表格操作：${snapshot.label || '表格操作'}`);
    toastr.success('已撤销上次表格操作。');
    return true;
}

function redoLastTableOperation(state = ensureState()) {
    state.tableDatabase.redoStack = Array.isArray(state.tableDatabase.redoStack) ? state.tableDatabase.redoStack : [];
    const snapshot = state.tableDatabase.redoStack[0];
    if (!snapshot) {
        toastr.info('没有可重做的表格操作。');
        return false;
    }
    const confirmed = confirmDanger(
        `重做表格操作「${snapshot.label || '表格操作'}」？`,
        [
            snapshot.undoneAt ? `撤销时间：${new Date(snapshot.undoneAt).toLocaleString()}` : '',
            '这会把表格恢复到撤销前的状态。',
        ],
    );
    if (!confirmed) {
        return false;
    }
    state.tableDatabase.redoStack.shift();
    state.tableDatabase.undoStack = Array.isArray(state.tableDatabase.undoStack) ? state.tableDatabase.undoStack : [];
    state.tableDatabase.undoStack.unshift({
        ...snapshot,
        redoTables: undefined,
        redoneAt: new Date().toISOString(),
    });
    state.tableDatabase.undoStack = state.tableDatabase.undoStack.slice(0, 20);
    state.tableDatabase.tables = structuredClone(snapshot.redoTables || []);
    persistCurrentTableDatabase(state);
    renderAll(`已重做表格操作：${snapshot.label || '表格操作'}`);
    toastr.success('已重做上次表格操作。');
    return true;
}

function getAppliedTableHistoriesForMessage(messageId, state = ensureState()) {
    const id = Number(messageId);
    if (!Number.isFinite(id)) {
        return [];
    }
    return (state.tableDatabase.history || []).filter(item => (
        item?.appliedAt && getFiniteMessageIds(item.sourceMessageIds || []).includes(id)
    ));
}

function hasAppliedTableEditForMessage(messageId, state = ensureState()) {
    return getAppliedTableHistoriesForMessage(messageId, state).length > 0;
}

function buildTableRollbackPlan(undoStack = [], messageIds = [], profileKey = '') {
    const affectedIds = new Set((Array.isArray(messageIds) ? messageIds : [])
        .map(Number)
        .filter(id => Number.isInteger(id) && id >= 0));
    if (!affectedIds.size) {
        return null;
    }
    const relevant = (Array.isArray(undoStack) ? undoStack : []).filter(snapshot => (
        snapshot && (!profileKey || !snapshot.profileKey || snapshot.profileKey === profileKey)
    ));
    const affectedPositions = relevant
        .map((snapshot, index) => ({
            index,
            affected: (Array.isArray(snapshot.sourceMessageIds) ? snapshot.sourceMessageIds : [])
                .map(Number)
                .some(id => affectedIds.has(id)),
        }))
        .filter(item => item.affected)
        .map(item => item.index);
    if (!affectedPositions.length) {
        return null;
    }
    const cutoff = Math.max(...affectedPositions);
    const rollbackSnapshots = relevant.slice(0, cutoff + 1);
    const affectedSnapshotIds = new Set(rollbackSnapshots
        .filter(snapshot => (Array.isArray(snapshot.sourceMessageIds) ? snapshot.sourceMessageIds : [])
            .map(Number)
            .some(id => affectedIds.has(id)))
        .map(snapshot => snapshot.id));
    const cascadedSourceMessageIds = [...new Set(rollbackSnapshots
        .filter(snapshot => !affectedSnapshotIds.has(snapshot.id))
        .flatMap(snapshot => Array.isArray(snapshot.sourceMessageIds) ? snapshot.sourceMessageIds : [])
        .map(Number)
        .filter(id => Number.isInteger(id) && id >= 0))]
        .sort((a, b) => a - b);
    const cascadedSnapshotIds = rollbackSnapshots
        .filter(snapshot => !affectedSnapshotIds.has(snapshot.id))
        .map(snapshot => snapshot.id);
    return {
        restoreSnapshot: relevant[cutoff],
        rollbackSnapshotIds: rollbackSnapshots.map(snapshot => snapshot.id),
        affectedSnapshotIds: [...affectedSnapshotIds],
        cascadedSnapshotIds,
        cascadedSourceMessageIds,
    };
}

function rollbackTableOperationsForMessages(messageIds = [], state = ensureState(), options = {}) {
    const affectedIds = getFiniteMessageIds(messageIds);
    const profileKey = getActiveTableProfileKey(state);
    const plan = buildTableRollbackPlan(state.tableDatabase.undoStack || [], affectedIds, profileKey);
    if (!plan) {
        return false;
    }
    const rollbackIds = new Set(plan.rollbackSnapshotIds);
    state.tableDatabase.undoStack = (state.tableDatabase.undoStack || []).filter(snapshot => !rollbackIds.has(snapshot.id));
    state.tableDatabase.redoStack = [];
    state.tableDatabase.tables = structuredClone(plan.restoreSnapshot.tables || []);
    state.tableDatabase.history = (state.tableDatabase.history || []).filter(item => !rollbackIds.has(item.undoSnapshotId));
    state.tableDatabase.editDrafts = (state.tableDatabase.editDrafts || []).filter(draft => (
        !getFiniteMessageIds(draft.sourceMessageIds || []).some(id => affectedIds.includes(id))
    ));
    state.tableDatabase.lastAppliedSourceMessageIds = [];
    state.tableDatabase.rollbackHistory = Array.isArray(state.tableDatabase.rollbackHistory) ? state.tableDatabase.rollbackHistory : [];
    state.tableDatabase.rollbackHistory.unshift({
        id: `table-rollback-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        reason: String(options.reason || '来源消息变更'),
        affectedMessageIds: affectedIds,
        cascadedSnapshotIds: plan.cascadedSnapshotIds,
        cascadedSourceMessageIds: plan.cascadedSourceMessageIds,
        rollbackSnapshotIds: plan.rollbackSnapshotIds,
        restoredSnapshotId: plan.restoreSnapshot.id,
        createdAt: new Date().toISOString(),
    });
    state.tableDatabase.rollbackHistory = state.tableDatabase.rollbackHistory.slice(0, 20);
    persistCurrentTableDatabase(state);
    const cascadeText = plan.cascadedSnapshotIds.length
        ? `；同时安全回退其后的 ${plan.cascadedSnapshotIds.length} 组依赖修改`
        : '';
    scheduleRenderAll(`已回退受影响的表格事务${cascadeText}。`);
    toastr.info(`${options.toast || '已检测到来源楼层变更并回退表格事务'}${cascadeText}。`);
    return plan;
}

function rollbackLatestTableOperationForDeletedMessages(messageIds = [], state = ensureState()) {
    return !!rollbackTableOperationsForMessages(messageIds, state, {
        reason: '来源楼层删除',
        toast: '已检测到来源楼层被删除，并恢复到对应表格事务之前',
    });
}

function rollbackLatestTableOperationForChangedMessages(messageIds = [], state = ensureState()) {
    return !!rollbackTableOperationsForMessages(messageIds, state, {
        reason: '来源楼层更新或重 roll',
        toast: '已检测到来源楼层变更，撤销旧表格事务并等待重新捕获',
    });
}

function collectMessageIdsFromEventArgs(args = []) {
    const ids = new Set();
    const visit = (value) => {
        if (value === null || value === undefined) {
            return;
        }
        if (typeof value === 'number' || typeof value === 'string') {
            const id = Number(value);
            if (Number.isInteger(id) && id >= 0) {
                ids.add(id);
            }
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value === 'object') {
            for (const key of ['messageId', 'message_id', 'id', 'index', 'mesId', 'mes_id']) {
                if (value[key] !== undefined) {
                    visit(value[key]);
                }
            }
        }
    };
    args.forEach(visit);
    return [...ids];
}

function switchTableProfile(scope, profileId, state = ensureState(), options = {}) {
    const nextScope = Object.values(tableSchemaScopes).includes(scope) ? scope : tableSchemaScopes.CHAT;
    const profiles = getTableProfilesForScope(nextScope, state);
    const target = profiles.find(profile => profile.id === profileId) || profiles[0];
    if (!target) {
        toastr.warning('没有可切换的表格组。');
        return false;
    }
    if (options.confirm !== false) {
        const rows = (state.tableDatabase.tables || []).reduce((sum, table) => sum + (table.rows?.length || 0), 0);
        const confirmed = confirmDanger(
            `切换到表格组「${target.name}」？`,
            [
                `当前表格组：${getActiveTableProfile(state)?.name || '未命名'}`,
                `当前行数：${rows}，未应用草稿：${state.tableDatabase.editDrafts?.length || 0}`,
                '当前行数据会先保存到原表格组；切换后，上下文会使用目标表格组。',
            ],
        );
        if (!confirmed) {
            return false;
        }
    }
    saveCurrentTableProfileRows(state);
    state.tableDatabase.schemaScope = nextScope;
    state.tableDatabase.activeProfileId = target.id;
    loadActiveTableProfileRows(state);
    saveGlobalSettings();
    saveState();
    return true;
}

function createTableProfileForCurrentScope(name, state = ensureState()) {
    saveCurrentTableProfileRows(state);
    const scope = state.tableDatabase.schemaScope || tableSchemaScopes.CHAT;
    const profiles = getTableProfilesForScope(scope, state);
    const profile = createTableProfile(name || `${getTableProfileScopeLabel(scope)}表格组 ${profiles.length + 1}`, []);
    profiles.push(profile);
    state.tableDatabase.activeProfileId = profile.id;
    state.tableDatabase.tables = [];
    saveCurrentTableProfileRows(state);
    saveGlobalSettings();
    saveState();
    return profile;
}

function deleteActiveTableProfile(state = ensureState()) {
    const scope = state.tableDatabase.schemaScope || tableSchemaScopes.CHAT;
    const profiles = getTableProfilesForScope(scope, state);
    if (profiles.length <= 1) {
        toastr.warning('至少需要保留一个表格组。');
        return false;
    }
    const active = getActiveTableProfile(state);
    const confirmed = confirmDanger(
        `删除表格组「${active?.name || '未命名'}」？`,
        ['这会删除这个表格组的框架和当前聊天里对应的行数据；不会删除摘要。'],
    );
    if (!confirmed) {
        return false;
    }
    const key = getActiveTableProfileKey(state);
    const index = profiles.findIndex(profile => profile.id === active?.id);
    if (index >= 0) {
        profiles.splice(index, 1);
    }
    delete state.tableDatabase.profileRows[key];
    state.tableDatabase.activeProfileId = profiles[0]?.id || '';
    loadActiveTableProfileRows(state);
    saveGlobalSettings();
    saveState();
    return true;
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

function getAreaPresets(scope) {
    ensureGlobalSettings();
    return extension_settings[STORAGE_KEY].areaPresets[scope] || [];
}

function getSelectedAreaPresetId(scope) {
    ensureGlobalSettings();
    return extension_settings[STORAGE_KEY].selectedAreaPresetIds[scope] || '';
}

function setSelectedAreaPresetId(scope, id) {
    ensureGlobalSettings();
    extension_settings[STORAGE_KEY].selectedAreaPresetIds[scope] = id || '';
    saveGlobalSettings();
}

function getTablePromptPresets() {
    ensureGlobalSettings();
    return extension_settings[STORAGE_KEY].tablePromptPresets || [];
}

function getSelectedTablePromptPresetId() {
    ensureGlobalSettings();
    return extension_settings[STORAGE_KEY].selectedTablePromptPresetId || getTablePromptPresets()[0]?.id || '';
}

function setSelectedTablePromptPresetId(id) {
    ensureGlobalSettings();
    extension_settings[STORAGE_KEY].selectedTablePromptPresetId = id || '';
    saveGlobalSettings();
}

function makeTablePromptPreset(name, prompt) {
    const now = new Date().toISOString();
    return {
        id: `table-prompt-${getHash(`${now}|${name || 'table'}`)}`,
        name: String(name || '未命名表格提示词'),
        prompt: String(prompt || defaultTableEditPrompt),
        createdAt: now,
        updatedAt: now,
    };
}

function getInlinePromptPresets(type) {
    ensureGlobalSettings();
    return (extension_settings[STORAGE_KEY].inlinePromptPresets || []).filter(preset => preset.type === type);
}

function getSelectedInlinePromptPresetId(type) {
    ensureGlobalSettings();
    const selected = extension_settings[STORAGE_KEY].selectedInlinePromptPresetIds || {};
    return selected[type] || getInlinePromptPresets(type)[0]?.id || '';
}

function setSelectedInlinePromptPresetId(type, id) {
    ensureGlobalSettings();
    if (!extension_settings[STORAGE_KEY].selectedInlinePromptPresetIds || typeof extension_settings[STORAGE_KEY].selectedInlinePromptPresetIds !== 'object') {
        extension_settings[STORAGE_KEY].selectedInlinePromptPresetIds = {};
    }
    extension_settings[STORAGE_KEY].selectedInlinePromptPresetIds[type] = id || '';
    saveGlobalSettings();
}

function makeInlinePromptPreset(type, name, prompt) {
    const now = new Date().toISOString();
    return {
        id: `inline-${type}-${getHash(`${now}|${name || type}`)}`,
        type,
        name: String(name || (type === 'summary' ? '未命名随正文摘要' : '未命名随正文填表')),
        prompt: String(prompt || (type === 'summary' ? defaultInlineSummaryPrompt : defaultInlineTablePrompt)),
        createdAt: now,
        updatedAt: now,
    };
}

function isBuiltInPresetId(id) {
    return id === defaultPromptPreset.id || id === defaultGenericPromptPreset.id;
}

function makePresetId(name) {
    return `preset-${getHash(`${Date.now()}|${name || 'prompt'}`)}`;
}

function getActiveGlobalConfig() {
    ensureGlobalSettings();
    return extension_settings[STORAGE_KEY].activeConfig || null;
}

function getActiveGlobalConfigSignature(config = getActiveGlobalConfig()) {
    if (!config) {
        return '';
    }
    return `${String(config.id || '')}|${String(config.updatedAt || '')}`;
}

function markStateGlobalConfigApplied(state, config = getActiveGlobalConfig()) {
    state.configInitialized = true;
    state.activeConfigId = config?.id || '';
    state.activeConfigSignature = getActiveGlobalConfigSignature(config);
}

function setActiveGlobalConfig(preset) {
    ensureGlobalSettings();
    const presets = extension_settings[STORAGE_KEY].promptPresets || [];
    const config = {
        ...structuredClone(preset),
        id: preset.id || makePresetId(preset.name || 'active'),
        name: preset.name || '未命名全局配置',
        updatedAt: new Date().toISOString(),
    };
    extension_settings[STORAGE_KEY].activeConfig = config;
    if (config.id && presets.some(item => item.id === config.id)) {
        extension_settings[STORAGE_KEY].selectedPromptPresetId = config.id;
    }
    saveGlobalSettings();
    return config;
}

function applyGlobalActiveConfigToState(state) {
    const config = getActiveGlobalConfig();
    if (!config) {
        markStateGlobalConfigApplied(state, null);
        return;
    }
    applyPromptPresetToState(config, {
        state,
        silent: true,
        skipScan: true,
        skipInjection: true,
        skipVectorSchedule: true,
        skipRender: true,
        skipSave: true,
    });
    markStateGlobalConfigApplied(state, config);
}

function syncGlobalActiveConfigToState(state, options = {}) {
    const config = getActiveGlobalConfig();
    const signature = getActiveGlobalConfigSignature(config);
    if (!config || (!options.force && state.activeConfigSignature === signature)) {
        return false;
    }
    applyGlobalActiveConfigToState(state);
    if (!options.skipSave) {
        saveState();
    }
    return true;
}

function makeAreaPresetId(scope, name) {
    return `${scope}-${getHash(`${Date.now()}|${scope}|${name || 'preset'}`)}`;
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

function tokenizeForVector(text) {
    const normalized = String(text || '')
        .toLowerCase()
        .replace(/<[^>]+>/g, ' ')
        .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ')
        .trim();
    const tokens = normalized.match(/[\p{L}\p{N}]{2,}|[\u4e00-\u9fff]/gu) || [];
    const compact = normalized.replace(/\s+/g, '');
    for (let index = 0; index + 2 <= compact.length; index++) {
        tokens.push(compact.slice(index, index + 2));
    }
    for (let index = 0; index + 3 <= compact.length; index += 2) {
        tokens.push(compact.slice(index, index + 3));
    }
    return tokens;
}

function createLocalEmbedding(text, dimensions = 192) {
    const vector = Array(dimensions).fill(0);
    for (const token of tokenizeForVector(text)) {
        const hash = parseInt(getHash(token), 16);
        const index = hash % dimensions;
        const sign = hash & 1 ? 1 : -1;
        vector[index] += sign * (1 + Math.min(token.length, 6) / 10);
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map(value => Number((value / norm).toFixed(6)));
}

function cosineSimilarity(a = [], b = []) {
    const length = Math.min(a.length, b.length);
    if (!length) {
        return 0;
    }
    let sum = 0;
    for (let index = 0; index < length; index++) {
        sum += Number(a[index] || 0) * Number(b[index] || 0);
    }
    return sum;
}

function splitTextIntoChunks(text, chunkSize = defaultVectorMemory.chunkSize, overlap = defaultVectorMemory.overlap) {
    const clean = normalizeLineEndings(stripHtml(text)).replace(/\n{3,}/g, '\n\n').trim();
    if (!clean) {
        return [];
    }
    const safeChunk = Math.max(240, Number(chunkSize || defaultVectorMemory.chunkSize));
    const safeOverlap = Math.min(Math.max(0, Number(overlap || 0)), Math.floor(safeChunk / 2));
    const chunks = [];
    let start = 0;
    while (start < clean.length) {
        let end = Math.min(clean.length, start + safeChunk);
        if (end < clean.length) {
            const naturalBreak = Math.max(clean.lastIndexOf('\n', end), clean.lastIndexOf('。', end), clean.lastIndexOf('！', end), clean.lastIndexOf('？', end));
            if (naturalBreak > start + safeChunk * 0.55) {
                end = naturalBreak + 1;
            }
        }
        const chunk = clean.slice(start, end).trim();
        if (chunk) {
            chunks.push({ text: chunk, start, end });
        }
        if (end >= clean.length) {
            break;
        }
        start = Math.max(end - safeOverlap, start + 1);
    }
    return chunks;
}

function getVectorSummaryTags(state = ensureState()) {
    return parseList(state.vectorMemory.summaryTags || defaultVectorMemory.summaryTags);
}

function extractVectorSummaryText(text, state = ensureState()) {
    const summaryTags = getVectorSummaryTags(state);
    const blocks = extractConfiguredTagBlocks(text, summaryTags.length ? summaryTags : ['bakemono', 'summaryDraft'])
        .map(block => block.content)
        .filter(Boolean);
    if (!blocks.length) {
        return '';
    }
    return normalizeLineEndings(blocks.join('\n\n')).replace(/\n{3,}/g, '\n\n').trim();
}

function getVectorBodyText(text, state = ensureState()) {
    const excludeTags = parseList(state.vectorMemory.excludeTags || defaultVectorMemory.excludeTags);
    const summaryTags = getVectorSummaryTags(state);
    return stripConfiguredTags(text, unique([...excludeTags, ...summaryTags])).trim();
}

function getVectorSourceMessages(state = ensureState()) {
    const context = getContext();
    const sourceChat = context.chat || chat || [];
    const maxIndexedMessages = Math.max(0, Number(state.vectorMemory.maxIndexedMessages ?? defaultVectorMemory.maxIndexedMessages));
    const items = sourceChat
        .map((message, messageId) => ({
            message,
            messageId,
            cleanedText: getVectorBodyText(message?.mes || '', state),
            summaryText: extractVectorSummaryText(message?.mes || '', state),
        }))
        .filter(({ message }) => message?.mes && (state.vectorMemory.includeHidden !== false || !message.is_system))
        .filter(({ message }) => state.vectorMemory.includeUser === true || !message.is_user);
    return maxIndexedMessages > 0 ? items.slice(-maxIndexedMessages) : items;
}

function getVectorCleanedMessageText(messageId, state = ensureState()) {
    const match = getVectorSourceMessages(state).find(item => Number(item.messageId) === Number(messageId));
    return String(match?.cleanedText || '').trim();
}

function getRecentConversationQuery(maxMessages = 8) {
    const context = getContext();
    const sourceChat = context.chat || chat || [];
    return sourceChat
        .map((message, messageId) => ({ message, messageId }))
        .filter(({ message }) => message?.mes && !message.is_system)
        .slice(-Math.max(1, Number(maxMessages || 8)))
        .map(({ message, messageId }) => `${message.is_user ? '用户' : '助手'} #${messageId}: ${stripHtml(message.mes || '')}`)
        .join('\n')
        .trim();
}

function getVectorQueryText(state = ensureState(), explicitQuery = '') {
    const current = String(explicitQuery || '').trim() || getRecentConversationQuery(8);
    const keywords = parseList(state.vectorMemory.keywordTriggers).join(' ');
    return [current, keywords].filter(Boolean).join('\n\n关键词提示：');
}

function parseVectorQueryRewritePayload(raw) {
    let source = String(raw || '')
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

function parseVectorQueryRewriteLines(source) {
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

function parseVectorQueryRewriteResult(raw) {
    return parseVectorQueryRewritePayload(raw).queries;
}

function normalizeVectorRewriteIntent(item) {
    const text = normalizeVectorRewriteQueryItem(item);
    if (!text || isVectorRewriteInstructionLine(text)) {
        return '';
    }
    return text.slice(0, 220);
}

function normalizeVectorRewriteQueries(items = []) {
    return items
        .map(item => normalizeVectorRewriteQueryItem(item))
        .filter(Boolean)
        .filter(item => !isVectorRewriteInstructionLine(item));
}

function normalizeVectorRewriteQueryItem(item) {
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

function hasVectorRewriteQueryLanguage(text) {
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

function isVectorRewriteInstructionLine(text) {
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

function getVectorRewriteIntentText(baseQuery = '') {
    const clean = String(baseQuery || '')
        .split(/\n\n关键词提示：/)[0]
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    const userLine = [...clean].reverse().find(line => /^用户\s*#?\d*\s*[:：]/.test(line));
    const lastLine = userLine || clean.at(-1) || '';
    return toPlainPreview(lastLine.replace(/^(?:用户|助手)\s*#?\d*\s*[:：]\s*/, '').trim(), 220);
}

function extractChatCompletionText(data) {
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

async function callVectorQueryRewriteModel(prompt, systemPrompt, state = ensureState()) {
    const provider = String(state.vectorMemory.queryRewriteProvider || defaultVectorMemory.queryRewriteProvider);
    if (provider === 'custom') {
        const queryConfig = state.vectorMemory.queryCustomApi || {};
        const embeddingConfig = state.vectorMemory.customApi || {};
        const baseUrl = normalizeCustomApiBaseUrl(queryConfig.baseUrl || embeddingConfig.baseUrl || '');
        const model = String(queryConfig.model || '').trim();
        const apiKey = String(queryConfig.apiKey || embeddingConfig.apiKey || '').trim();
        if (!baseUrl || !model) {
            throw new Error('查询重写需要聊天模型。请填写改写模型；接口地址和密钥可留空复用嵌入向量接口。');
        }
        const response = await fetch(getCustomChatCompletionsUrl(baseUrl), {
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
                temperature: 0.1,
                top_p: 0.8,
                max_tokens: 900,
                stream: false,
                enable_thinking: false,
            }),
        });
        if (!response.ok) {
            throw new Error(`查询重写请求失败：${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        const content = extractChatCompletionText(data);
        if (!content) {
            throw new Error('查询重写没有返回可用内容。');
        }
        return content;
    }
    return await generateRaw({ prompt, systemPrompt });
}

async function prepareVectorQueries(explicitQuery = '', state = ensureState()) {
    const baseQuery = getVectorQueryText(state, explicitQuery);
    const mode = String(state.vectorMemory.queryMode || defaultVectorMemory.queryMode);
    state.vectorMemory.lastRewriteIntent = getVectorRewriteIntentText(baseQuery);
    if (!baseQuery.trim()) {
        return [];
    }
    if (mode === 'off') {
        return [baseQuery];
    }
    if (mode === 'local') {
        return unique([
            baseQuery,
            ...parseList(state.vectorMemory.keywordTriggers),
        ]).filter(Boolean).slice(0, 6);
    }
    const systemPrompt = '你是剧情记忆检索的查询改写器。关闭思考过程。只输出 INTENT 与 Q1-Q5 六行中文，不输出解释、英文、JSON、Markdown 或分析。';
    const prompt = `${state.vectorMemory.queryRewritePrompt || defaultVectorMemory.queryRewritePrompt}

<最近剧情>
${baseQuery}
</最近剧情>

请严格输出下面 6 行，不要输出任何解释、标题、JSON 或 Markdown：
INTENT: 一句话检索意图
Q1: 第一条旧记忆检索线索
Q2: 第二条旧记忆检索线索
Q3: 第三条旧记忆检索线索
Q4: 第四条旧记忆检索线索
Q5: 第五条旧记忆检索线索`;
    const rewritten = await callVectorQueryRewriteModel(prompt, systemPrompt, state);
    const payload = parseVectorQueryRewritePayload(rewritten);
    if (payload.intent) {
        state.vectorMemory.lastRewriteIntent = payload.intent;
    }
    const queries = unique(payload.queries)
        .map(text => text.slice(0, 260))
        .filter(Boolean)
        .slice(0, 6);
    if (!queries.length) {
        throw new Error('查询重写没有生成有效检索句。');
    }
    return queries;
}

function countKeywordHits(text, keywords = []) {
    const source = String(text || '').toLowerCase();
    return keywords.reduce((count, keyword) => {
        const needle = String(keyword || '').trim().toLowerCase();
        return needle && source.includes(needle) ? count + 1 : count;
    }, 0);
}

function getAssistantMessageCount() {
    const context = getContext();
    const sourceChat = context.chat || chat || [];
    return sourceChat.filter(message => message?.mes && !message.is_user && !message.is_system).length;
}

function getVisibleConversationMessageCount() {
    const context = getContext();
    const sourceChat = context.chat || chat || [];
    return sourceChat.filter(message => message?.mes && !message.is_system).length;
}

function getRecentVisibleConversationMessageIds(limit = defaultVectorMemory.contextWindowMessages) {
    const max = Math.max(0, Number(limit || 0));
    if (!max) {
        return new Set();
    }
    const context = getContext();
    const sourceChat = context.chat || chat || [];
    return new Set(sourceChat
        .map((message, messageId) => ({ message, messageId }))
        .filter(({ message }) => message?.mes && !message.is_system)
        .slice(-max)
        .map(({ messageId }) => Number(messageId)));
}

function getVectorRecallSourceRecords(state = ensureState()) {
    const records = Array.isArray(state.vectorMemory.records) ? state.vectorMemory.records : [];
    const contextWindowMessages = Math.max(0, Number(state.vectorMemory.contextWindowMessages || defaultVectorMemory.contextWindowMessages));
    if (state.vectorMemory.skipIfAllInContext === false || contextWindowMessages <= 0) {
        return records;
    }
    const recentVisibleIds = getRecentVisibleConversationMessageIds(contextWindowMessages);
    if (!recentVisibleIds.size) {
        return records;
    }
    return records.filter(record => !recentVisibleIds.has(Number(record.messageId)));
}

function shouldSkipVectorRecallForRecentWindow(state = ensureState()) {
    const contextWindowMessages = Math.max(0, Number(state.vectorMemory.contextWindowMessages || defaultVectorMemory.contextWindowMessages));
    if (state.vectorMemory.skipIfAllInContext === false || contextWindowMessages <= 0) {
        return false;
    }
    const records = Array.isArray(state.vectorMemory.records) ? state.vectorMemory.records : [];
    if (!records.length) {
        return false;
    }
    const recentVisibleIds = getRecentVisibleConversationMessageIds(contextWindowMessages);
    if (!recentVisibleIds.size) {
        return false;
    }
    return !getVectorRecallSourceRecords(state).length;
}

function makeVectorRecordSummary(text, maxChars = defaultVectorMemory.summaryMaxChars) {
    const clean = normalizeLineEndings(stripHtml(text)).replace(/\n{3,}/g, '\n\n').trim();
    if (!clean) {
        return '';
    }

    const hasSummaryEnvelope = /<bakemono\b|<summary\b|剧情摘要|阶段总结|多次总结|剧集终了|长期总览|纪元回溯|正文摘要/i.test(text);
    const sectionLines = clean
        .split(/\n+/)
        .map(line => line.trim())
        .filter(line => line.length >= 12)
        .filter(line => (
            /摘要|总结|事件|关系|线索|伏笔|暗线|第四面墙|角色|地点|时间/.test(line)
            && (/[:：]|[【】\[\]]|^[-*➤]/.test(line) || /摘要|总结/.test(line))
        ));

    if (sectionLines.length) {
        return getClippedVectorText(sectionLines.slice(0, 8).join('\n'), Math.max(120, Number(maxChars || defaultVectorMemory.summaryMaxChars)));
    }

    if (!hasSummaryEnvelope) {
        return '';
    }

    return getClippedVectorText(clean, Math.max(120, Number(maxChars || defaultVectorMemory.summaryMaxChars)));
}

function getVectorQueryTerms(queries = [], state = ensureState()) {
    const keywordTerms = parseList(state.vectorMemory.keywordTriggers);
    const queryTerms = queries.flatMap(query => normalizeSearchText(query)
        .split(/[\s,，.。!！?？;；:：、"'“”‘’()[\]{}<>《》【】]+/)
        .map(term => term.trim())
        .filter(term => term.length >= 2));
    return unique([...keywordTerms, ...queryTerms]).slice(0, 80);
}

function computeVectorRerankScore(item, queries = [], state = ensureState()) {
    const terms = getVectorQueryTerms(queries, state);
    const haystack = normalizeSearchText(`${item.title || ''}\n${item.summary || ''}\n${item.text || ''}`);
    const termHits = terms.length
        ? terms.filter(term => haystack.includes(normalizeSearchText(term))).length / terms.length
        : 0;
    const keywordHits = countKeywordHits(haystack, parseList(state.vectorMemory.keywordTriggers));
    const keywordBonus = keywordHits ? Math.min(0.12, keywordHits * 0.03) : 0;
    const normalizedEmbedding = Math.max(0, Math.min(1, Number(item.embeddingScore || item.similarity || 0)));
    const score = normalizedEmbedding * 0.72 + termHits * 0.2 + keywordBonus;
    return Math.max(0, Math.min(1, score));
}

function clearVectorRecall(reason = '', state = ensureState()) {
    state.vectorMemory.lastHits = [];
    state.vectorMemory.lastQueries = [];
    state.vectorMemory.lastRewriteIntent = '';
    state.vectorMemory.lastEmbeddingCandidates = [];
    state.vectorMemory.lastRerankCandidates = [];
    state.vectorMemory.lastQuery = '';
    state.vectorMemory.estimatedChars = 0;
    state.vectorMemory.trimmedHitCount = 0;
    state.vectorMemory.lastRecallSkippedReason = reason;
    return [];
}

function serializeVectorRecallItem(item, options = {}) {
    const score = Number((item.rerankScore ?? item.score ?? 0).toFixed(4));
    const similarity = Number((item.embeddingScore ?? item.similarity ?? 0).toFixed(4));
    return {
        id: item.id,
        kind: item.kind || 'message',
        recallTier: options.recallTier || item.recallTier || '',
        messageId: item.messageId,
        chunkIndex: item.chunkIndex,
        role: item.role,
        isHidden: !!item.isHidden,
        isSavedSummary: !!item.isSavedSummary,
        summaryType: item.summaryType || '',
        title: item.title || `楼层 ${item.messageId}`,
        text: getClippedVectorText(item.text || item.summary || '', Number(options.textLimit || 480)),
        preview: toPlainPreview(item.preview || item.text || item.summary || '', Number(options.previewLimit || 220)),
        matchedText: getClippedVectorText(item.matchedText || item.text || '', 360),
        matchedChunks: item.matchedChunks || 1,
        keywordHits: item.keywordHitsTotal || item.keywordHits || 0,
        score,
        similarity,
        rerankScore: Number((item.rerankScore ?? score).toFixed(4)),
    };
}

function getVectorSourceSignature(state = ensureState()) {
    return [
        ...getVectorSourceMessages(state)
            .map(({ message, messageId, cleanedText, summaryText }) => `${messageId}:${getMessageVariantKey(message)}:${getHash(cleanedText || '')}:${getHash(summaryText || '')}`),
        ...getVectorSavedSummarySources(state)
            .map(source => `saved:${source.type}:${source.hash}:${getHash(source.text || '')}`),
    ].join('|');
}

function getInjectedSummaryHashesForVector(state = ensureState()) {
    const coveredStoryHashes = new Set(state.coveredBlockHashes || []);
    const coveredStageHashes = getActiveCoveredStageHashes(state);
    return new Set([
        ...(state.memoryStrategy === memoryStrategies.GENERIC
            ? (state.storySummaries || [])
                .filter(summary => summary.hash && !coveredStoryHashes.has(summary.hash))
                .map(summary => summary.hash)
            : []),
        ...(state.stageSummaries || [])
            .filter(summary => summary.hash && !coveredStageHashes.has(summary.hash))
            .map(summary => summary.hash),
        ...getActiveEpicMemoryBlocks(state)
            .map(summary => summary.hash)
            .filter(Boolean),
    ]);
}

function getVectorSavedSummarySources(state = ensureState()) {
    const summaryMax = Math.max(120, Number(state.vectorMemory.summaryMaxChars || defaultVectorMemory.summaryMaxChars));
    const sources = [];
    const injectedSummaryHashes = getInjectedSummaryHashesForVector(state);
    const addSummary = (summary, type) => {
        const raw = String(summary?.content || '').trim();
        if (!summary?.hash || !raw) {
            return;
        }
        if (injectedSummaryHashes.has(summary.hash)) {
            return;
        }
        const sourceMessageIds = getFiniteMessageIds(summary.sourceMessageIds || []);
        const sourceStart = Number.isFinite(summary.sourceStart)
            ? Number(summary.sourceStart)
            : getSourceStart(sourceMessageIds);
        const sourceEnd = Number.isFinite(summary.sourceEnd)
            ? Number(summary.sourceEnd)
            : getSourceEnd(sourceMessageIds);
        const title = summary.title || getBlockTitle(raw, getKindLabel(type));
        const plain = getBlockPlainText(raw) || normalizeLineEndings(stripHtml(raw)).trim();
        const text = getClippedVectorText(plain, summaryMax);
        if (!text) {
            return;
        }
        sources.push({
            id: `vec-saved-${type}-${summary.hash}`,
            hash: summary.hash,
            type,
            messageId: Number.isFinite(sourceStart) && sourceStart < Number.MAX_SAFE_INTEGER ? sourceStart : Number.MAX_SAFE_INTEGER,
            sourceStart,
            sourceEnd,
            sourceMessageIds,
            title: `${getKindLabel(type)}：${title}`,
            text,
            preview: toPlainPreview(text, 180),
            createdAt: summary.createdAt || '',
        });
    };
    (state.storySummaries || [])
        .filter(summary => ['backfill', 'turn', 'inline', 'manual', 'turn_manual', 'turn_auto', 'inline_summary'].includes(String(summary.sourceKind || summary.metadata?.sourceKind || '')))
        .forEach(summary => addSummary(summary, blockTypes.STORY));
    (state.stageSummaries || []).forEach(summary => addSummary(summary, blockTypes.STAGE));
    (state.epicSummaries || []).forEach(summary => addSummary(summary, blockTypes.EPIC));
    return sources;
}

function markVectorIndexDirty(reason = 'changed', state = ensureState()) {
    state.vectorMemory.dirty = true;
    state.vectorMemory.dirtyReason = reason;
    clearVectorRecall(`索引待刷新：${reason}`, state);
    saveState();
    scheduleVectorAutoIndex(reason);
}

function scheduleVectorAutoIndex(reason = 'auto') {
    const state = ensureState();
    if (!state.vectorMemory.enabled || state.vectorMemory.autoIndex === false) {
        return;
    }
    clearTimeout(vectorIndexTimer);
    vectorIndexTimer = setTimeout(async () => {
        try {
            await buildVectorMemoryIndex({ silent: true, reason });
        } catch (error) {
            console.warn('[BakemonoMemory] vector auto index failed', error);
            toastr.warning(`向量自动索引失败：${error?.message || error}`);
        }
    }, 1200);
}

async function getEmbeddingForText(text, state = ensureState()) {
    const source = String(text || '');
    const cacheKey = `${state.vectorMemory.embeddingProvider || 'local'}:${state.vectorMemory.customApi?.model || ''}:${getHash(source)}`;
    if (Array.isArray(vectorEmbeddingRuntimeCache.get(cacheKey))) {
        return vectorEmbeddingRuntimeCache.get(cacheKey);
    }
    const dimensions = Math.max(32, Number(state.vectorMemory.embeddingDimensions || defaultVectorMemory.embeddingDimensions));
    if (state.vectorMemory.embeddingProvider === 'custom-openai') {
        try {
            const embedding = compactEmbedding(await fetchCustomEmbedding(source, state), dimensions);
            vectorEmbeddingRuntimeCache.set(cacheKey, embedding);
            pruneVectorRuntimeCache();
            return embedding;
        } catch (error) {
            console.warn('[BakemonoMemory] custom embedding failed, fallback to local', error);
        }
    }
    const embedding = compactEmbedding(createLocalEmbedding(source, dimensions), dimensions);
    vectorEmbeddingRuntimeCache.set(cacheKey, embedding);
    pruneVectorRuntimeCache();
    return embedding;
}

function getCustomEmbeddingsUrl(baseUrl) {
    let clean = normalizeCustomApiBaseUrl(baseUrl);
    clean = clean.replace(/\/chat\/completions$/i, '').replace(/\/embeddings$/i, '');
    return `${clean}/embeddings`;
}

async function fetchCustomEmbedding(text, state = ensureState()) {
    const config = state.vectorMemory.customApi || {};
    const baseUrl = normalizeCustomApiBaseUrl(config.baseUrl);
    const apiKey = String(config.apiKey || '').trim();
    const model = String(config.model || defaultVectorMemory.customApi.model).trim();
    if (!baseUrl || !model) {
        throw new Error('嵌入向量接口需要填写接口地址和模型。');
    }
    const response = await fetch(getCustomEmbeddingsUrl(baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, input: text }),
    });
    if (!response.ok) {
        throw new Error(`嵌入向量接口请求失败：${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
        throw new Error('嵌入向量接口没有返回向量结果。');
    }
    return embedding.map(Number);
}

async function buildVectorMemoryIndex({ silent = false } = {}) {
    const state = ensureState();
    readVectorMemoryFieldsFromUi(state);
    const signature = getVectorSourceSignature(state);
    if (silent && !state.vectorMemory.dirty && state.vectorMemory.lastIndexedSignature === signature) {
        return state.vectorMemory.records || [];
    }
    const records = [];
    const indexMode = String(state.vectorMemory.indexMode || defaultVectorMemory.indexMode);
    const chunkSize = Math.max(240, Number(state.vectorMemory.chunkSize || defaultVectorMemory.chunkSize));
    const overlap = Math.max(0, Number(state.vectorMemory.overlap || defaultVectorMemory.overlap));
    const longMessageThreshold = Math.max(240, Number(state.vectorMemory.longMessageThreshold || defaultVectorMemory.longMessageThreshold));

    for (const { message, messageId, cleanedText, summaryText } of getVectorSourceMessages(state)) {
        const fullText = String(cleanedText || '').trim();
        const summaryContent = String(summaryText || '').trim();
        if (!fullText && !summaryContent) {
            continue;
        }
        const role = message.is_user ? 'user' : message.is_system ? 'hidden' : 'assistant';
        const variantKey = getMessageVariantKey(message);
        const shouldChunk = indexMode === 'chunk' || (indexMode === 'hybrid' && fullText.length > longMessageThreshold);
        if (summaryContent) {
            records.push({
                id: `vec-${getHash(`${messageId}|${variantKey}|summary|${summaryContent}`)}`,
                kind: 'summary',
                messageId,
                chunkIndex: 0,
                role,
                isHidden: !!message.is_system,
                title: `${message.is_user ? '用户摘要' : message.is_system ? '隐藏摘要' : '助手摘要'} #${messageId}`,
                text: getClippedVectorText(summaryContent, Math.max(120, Number(state.vectorMemory.summaryMaxChars || defaultVectorMemory.summaryMaxChars))),
                summary: getClippedVectorText(summaryContent, Math.max(120, Number(state.vectorMemory.summaryMaxChars || defaultVectorMemory.summaryMaxChars))),
                preview: toPlainPreview(summaryContent, 180),
                embedding: await getEmbeddingForText(summaryContent, state),
                createdAt: new Date().toISOString(),
            });
        }
        if (!fullText) {
            continue;
        }
        if (!shouldChunk) {
            records.push({
                id: `vec-${getHash(`${messageId}|${variantKey}|message|${fullText}`)}`,
                kind: 'message',
                messageId,
                chunkIndex: 0,
                role,
                isHidden: !!message.is_system,
                title: `${message.is_user ? '用户' : message.is_system ? '隐藏楼层' : '助手'} #${messageId}`,
                text: fullText,
                summary: '',
                preview: toPlainPreview(fullText, 180),
                embedding: await getEmbeddingForText(fullText, state),
                createdAt: new Date().toISOString(),
            });
            continue;
        }
        for (const [chunkIndex, chunk] of splitTextIntoChunks(fullText, chunkSize, overlap).entries()) {
            const text = chunk.text.trim();
            if (!text) {
                continue;
            }
            records.push({
                id: `vec-${getHash(`${messageId}|${variantKey}|${chunkIndex}|${text}`)}`,
                kind: 'chunk',
                messageId,
                chunkIndex,
                role,
                isHidden: !!message.is_system,
                title: `${message.is_user ? '用户' : message.is_system ? '隐藏楼层' : '助手'} #${messageId}.${chunkIndex + 1}`,
                text,
                summary: '',
                preview: toPlainPreview(text, 180),
                embedding: await getEmbeddingForText(text, state),
                createdAt: new Date().toISOString(),
            });
        }
    }

    for (const source of getVectorSavedSummarySources(state)) {
        records.push({
            id: source.id,
            kind: 'summary',
            messageId: source.messageId,
            chunkIndex: 0,
            role: 'memory',
            isHidden: false,
            isSavedSummary: true,
            summaryType: source.type,
            sourceStart: source.sourceStart,
            sourceEnd: source.sourceEnd,
            sourceMessageIds: source.sourceMessageIds,
            title: source.title,
            text: source.text,
            summary: source.text,
            preview: source.preview,
            embedding: await getEmbeddingForText(source.text, state),
            createdAt: source.createdAt || new Date().toISOString(),
        });
    }

    state.vectorMemory.records = records;
    state.vectorMemory.embeddingCache = {};
    state.vectorMemory.lastIndexAt = new Date().toISOString();
    state.vectorMemory.lastIndexedSignature = signature;
    state.vectorMemory.dirty = false;
    state.vectorMemory.dirtyReason = '';
    await retrieveVectorMemoryHits('', state);
    saveState();
    syncInjection();
    renderAll(silent ? '' : `向量索引完成：${records.length} 个原文片段。`);
    if (!silent) {
        toastr.success(`已建立 ${records.length} 个向量片段。`);
    }
    return records;
}

async function retrieveVectorMemoryHits(explicitQuery = '', state = ensureState()) {
    if (!state.vectorMemory?.enabled || !Array.isArray(state.vectorMemory.records) || !state.vectorMemory.records.length) {
        return clearVectorRecall('', state);
    }
    const minAiMessages = Math.max(0, Number(state.vectorMemory.startAfterAiMessages || 0));
    if (minAiMessages > 0 && getAssistantMessageCount() < minAiMessages) {
        return clearVectorRecall(`当前 AI 楼数少于 ${minAiMessages}，已跳过召回。`, state);
    }
    if (!explicitQuery && shouldSkipVectorRecallForRecentWindow(state)) {
        const contextWindowMessages = Math.max(0, Number(state.vectorMemory.contextWindowMessages || defaultVectorMemory.contextWindowMessages));
        return clearVectorRecall(`已索引内容都还在可见最近 ${contextWindowMessages} 楼内，已跳过向量召回。`, state);
    }
    const recallRecords = getVectorRecallSourceRecords(state);
    if (!recallRecords.length) {
        const contextWindowMessages = Math.max(0, Number(state.vectorMemory.contextWindowMessages || defaultVectorMemory.contextWindowMessages));
        return clearVectorRecall(`可召回内容都还在可见最近 ${contextWindowMessages} 楼内，已跳过向量召回。`, state);
    }
    let queries = [];
    try {
        queries = await prepareVectorQueries(explicitQuery, state);
    } catch (error) {
        console.warn('[BakemonoMemory] vector query rewrite failed', error);
        return clearVectorRecall(`查询重写失败，本轮不召回：${error?.message || error}`, state);
    }
    if (!queries.length) {
        return clearVectorRecall('查询重写没有生成有效检索句，本轮不召回。', state);
    }

    const queryEmbeddings = [];
    for (const query of queries) {
        queryEmbeddings.push(await getEmbeddingForText(query, state));
    }
    const keywords = parseList(state.vectorMemory.keywordTriggers);
    const embeddingThreshold = Math.max(0, Number(state.vectorMemory.embeddingThreshold ?? state.vectorMemory.minScore ?? defaultVectorMemory.embeddingThreshold));
    const rerankThreshold = Math.max(0, Number(state.vectorMemory.rerankThreshold ?? defaultVectorMemory.rerankThreshold));
    const rerankCandidateCount = Math.max(1, Number(state.vectorMemory.rerankCandidateCount || state.vectorMemory.topK || defaultVectorMemory.rerankCandidateCount));
    const finalRecallCount = Math.max(1, Number(state.vectorMemory.finalRecallCount || state.vectorMemory.maxRecallMessages || defaultVectorMemory.finalRecallCount));
    const fullRecallCount = Math.max(0, Number(state.vectorMemory.fullRecallCount ?? defaultVectorMemory.fullRecallCount));
    const scored = recallRecords.map(record => {
        const similarities = queryEmbeddings.map(embedding => cosineSimilarity(embedding, record.embedding || []));
        const similarity = similarities.length ? Math.max(...similarities) : 0;
        const keywordHits = countKeywordHits(`${record.title}\n${record.summary || ''}\n${record.text}`, keywords);
        return {
            ...record,
            embeddingScore: similarity,
            score: similarity,
            similarity,
            keywordHits,
        };
    });

    scored.sort((a, b) => (b.embeddingScore - a.embeddingScore) || (b.keywordHits - a.keywordHits) || (Number(b.messageId) - Number(a.messageId)));
    let embeddingCandidates = scored.filter(item => item.embeddingScore >= embeddingThreshold || item.keywordHits > 0);
    if (!embeddingCandidates.length) {
        const contextWindowMessages = Math.max(0, Number(state.vectorMemory.contextWindowMessages || defaultVectorMemory.contextWindowMessages));
        const recentVisibleIds = getRecentVisibleConversationMessageIds(contextWindowMessages);
        const fallbackCandidates = scored.filter(item => item.isHidden || !recentVisibleIds.has(Number(item.messageId)));
        if (fallbackCandidates.length) {
            embeddingCandidates = fallbackCandidates.slice(0, rerankCandidateCount);
        }
    }
    state.vectorMemory.lastEmbeddingCandidates = embeddingCandidates
        .slice(0, rerankCandidateCount)
        .map(item => serializeVectorRecallItem(item, { previewLimit: 240, textLimit: 480 }));
    const byMessage = new Map();
    for (const item of embeddingCandidates.slice(0, Math.max(rerankCandidateCount * 2, rerankCandidateCount))) {
        const key = String(item.messageId);
        const existing = byMessage.get(key);
        const rerankScore = computeVectorRerankScore(item, queries, state);
        const enriched = {
            ...item,
            rerankScore,
            score: rerankScore,
            matchedChunks: 1,
            keywordHitsTotal: item.keywordHits,
        };
        if (!existing || enriched.rerankScore > existing.rerankScore || enriched.embeddingScore > existing.embeddingScore) {
            if (existing) {
                enriched.matchedChunks = existing.matchedChunks + 1;
                enriched.keywordHitsTotal = existing.keywordHitsTotal + item.keywordHits;
            }
            byMessage.set(key, enriched);
        } else {
            existing.matchedChunks += 1;
            existing.keywordHitsTotal += item.keywordHits;
        }
    }

    const reranked = [...byMessage.values()]
        .sort((a, b) => (b.rerankScore - a.rerankScore) || (b.embeddingScore - a.embeddingScore) || (b.keywordHitsTotal - a.keywordHitsTotal) || (Number(b.messageId) - Number(a.messageId)))
        .slice(0, rerankCandidateCount);
    state.vectorMemory.lastRerankCandidates = reranked.map(item => {
        const recallTier = item.kind !== 'summary' && item.rerankScore >= rerankThreshold
            ? 'full'
            : (item.kind === 'summary' || item.summary ? 'summary' : 'dropped');
        return serializeVectorRecallItem(item, { recallTier, previewLimit: 260, textLimit: 520 });
    });
    const fullHits = [];
    const summaryHits = [];
    for (const item of reranked) {
        const fullText = getVectorCleanedMessageText(item.messageId, state) || item.text || '';
        const base = {
            ...item,
            kind: item.kind === 'summary' ? 'summary' : 'message',
            matchedText: item.text,
            title: item.kind === 'summary'
                ? item.isSavedSummary
                    ? item.title
                    : `${item.role === 'user' ? '用户摘要' : item.isHidden ? '隐藏摘要' : '助手摘要'} #${item.messageId}`
                : `${item.role === 'user' ? '用户' : item.isHidden ? '隐藏楼层' : '助手'} #${item.messageId}`,
            keywordHits: item.keywordHitsTotal || item.keywordHits,
        };
        if (item.kind !== 'summary' && item.rerankScore >= rerankThreshold && fullHits.length < fullRecallCount) {
            fullHits.push({
                ...base,
                recallTier: 'full',
                text: fullText,
                preview: toPlainPreview(fullText, 220),
            });
        } else {
            const summaryText = String(item.kind === 'summary' ? item.text : item.summary || '').trim();
            if (summaryText) {
                summaryHits.push({
                    ...base,
                    recallTier: 'summary',
                    text: summaryText,
                    preview: toPlainPreview(summaryText, 220),
                });
            }
        }
    }
    const hits = [...fullHits, ...summaryHits]
        .slice(0, finalRecallCount)
        .sort((a, b) => (
            Number(a.messageId) - Number(b.messageId)
            || Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0)
            || String(a.recallTier || '').localeCompare(String(b.recallTier || ''))
        ));
    state.vectorMemory.lastQuery = queries.join('\n');
    state.vectorMemory.lastQueries = queries;
    state.vectorMemory.lastRecallSkippedReason = hits.length ? '' : '没有内容通过当前向量阈值和重排规则。';
    const textLimit = Math.max(240, Number(state.vectorMemory.maxStoredTextChars || defaultVectorMemory.maxStoredTextChars));
    const hitTextLimit = Math.max(textLimit, Number(state.vectorMemory.perMessageMaxChars || defaultVectorMemory.perMessageMaxChars));
    state.vectorMemory.lastHits = hits.map(hit => ({
        id: hit.id,
        kind: hit.kind || 'message',
        recallTier: hit.recallTier || 'summary',
        messageId: hit.messageId,
        chunkIndex: hit.chunkIndex,
        role: hit.role,
        isHidden: hit.isHidden,
        isSavedSummary: !!hit.isSavedSummary,
        summaryType: hit.summaryType || '',
        title: hit.title,
        text: getClippedVectorText(hit.text, hit.recallTier === 'full' ? hitTextLimit : Math.max(120, Number(state.vectorMemory.summaryMaxChars || defaultVectorMemory.summaryMaxChars))),
        matchedText: getClippedVectorText(hit.matchedText || '', Math.min(textLimit, 480)),
        matchedChunks: hit.matchedChunks || 1,
        preview: hit.preview,
        score: Number((hit.rerankScore ?? hit.score ?? 0).toFixed(4)),
        similarity: Number((hit.embeddingScore ?? hit.similarity ?? 0).toFixed(4)),
        rerankScore: Number((hit.rerankScore ?? hit.score ?? 0).toFixed(4)),
        keywordHits: hit.keywordHits,
    }));
    state.vectorMemory.estimatedChars = state.vectorMemory.lastHits.reduce((sum, hit) => sum + String(hit.text || '').length, 0);
    state.vectorMemory.trimmedHitCount = Math.max(0, embeddingCandidates.length - hits.length);
    return state.vectorMemory.lastHits;
}

function renderVectorMemorySection(state = ensureState()) {
    const hits = Array.isArray(state.vectorMemory.lastHits) ? state.vectorMemory.lastHits : [];
    const maxChars = Math.max(200, Number(state.vectorMemory.maxInjectChars || defaultVectorMemory.maxInjectChars));
    const perMessageMaxChars = Math.max(200, Number(state.vectorMemory.perMessageMaxChars || defaultVectorMemory.perMessageMaxChars));
    let used = 0;
    const lines = [];
    for (const hit of hits) {
        const source = String(hit.text || '').trim();
        const snippet = hit.kind === 'message' && source.length > perMessageMaxChars
            ? `${source.slice(0, perMessageMaxChars)}...`
            : source;
        if (!snippet) {
            continue;
        }
        const remaining = maxChars - used;
        if (remaining <= 0) {
            break;
        }
        const clipped = snippet.length > remaining ? `${snippet.slice(0, remaining)}...` : snippet;
        used += clipped.length;
        const tierLabel = hit.recallTier === 'full' ? '全文' : '摘要';
        lines.push(`- 来源：${hit.title}（${tierLabel}，重排 ${hit.rerankScore ?? hit.score ?? 0}，相似度 ${hit.similarity ?? 0}${hit.keywordHits ? `，关键词命中 ${hit.keywordHits}` : ''}${hit.matchedChunks > 1 ? `，命中片段 ${hit.matchedChunks}` : ''}）\n${clipped}`);
    }
    state.vectorMemory.estimatedChars = used;
    state.vectorMemory.trimmedHitCount = Math.max(0, (state.vectorMemory.lastHits?.length || 0) - lines.length);
    return lines.length ? `## 向量召回记忆\n${lines.join('\n\n')}` : '';
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
        sticker: summary || (block.type === blockTypes.EPIC ? getMultiSummaryLabel(block) : block.type === blockTypes.STAGE ? '阶段总结' : '剧情摘要手账'),
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
        const stageMatch = metaLine.match(/『([^』]+)』.*?跨度[：:]\s*([^★]+).*?(当前时间点|时间跨度)[：:]\s*([^☆]+)\s*☆/);
        if (stageMatch) {
            meta.label = stageMatch[2].trim();
            meta.title = stageMatch[1].trim();
            meta.meta = `${stageMatch[3].trim()}：${stageMatch[4].trim()}`;
        }
    } else if (block.type === blockTypes.EPIC) {
        const epicMatch = metaLine.match(/『([^』]+)』.*?总跨度[：:]\s*([^★]+).*?(当前时间点|时间跨度)[：:]\s*([^☆]+)\s*☆/);
        if (epicMatch) {
            meta.label = epicMatch[2].trim();
            meta.title = epicMatch[1].trim();
            meta.meta = `${epicMatch[3].trim()}：${epicMatch[4].trim()}`;
        }
    }

    return meta;
}

function getPreferredSummaryTitle(block) {
    const genericTitles = new Set(['剧情摘要', '📋 剧情摘要', '剧集终了·点击回看', '多次总结·长期总览', '纪元回溯·史诗简史']);
    const manualTitle = String(block?.metadata?.userTitle || '').trim();
    if (manualTitle) {
        return manualTitle;
    }
    const title = String(block?.title || '').replace(/[【】]/g, '').trim();
    if (block?.isGeneratedSummary && title && !genericTitles.has(title)) {
        return title;
    }
    return '';
}

function getPreviewSummaryText(block) {
    const prefix = block.type === blockTypes.EPIC ? '多次' : block.type === blockTypes.STAGE ? '阶段' : '摘要';
    const preferredTitle = getPreferredSummaryTitle(block);
    if (preferredTitle) {
        return preferredTitle.startsWith(`${prefix} ·`) ? preferredTitle : `${prefix} · ${preferredTitle}`;
    }
    const meta = parsePreviewMeta(block);
    const pieces = [meta.label, meta.title].filter(Boolean);
    return `${prefix} · ${pieces.join(' · ') || meta.sticker || block.title}`;
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

function scanBakemonoBlocks({ persist = true, render = persist } = {}) {
    const state = ensureState();
    const scanned = [];
    const scannedForBlocks = [];
    const preview = [];
    const previousBlocks = state.blocks;
    const previousBlockByContent = new Map(previousBlocks.map(block => [block.content, block]));
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
        const previous = previousBlockByContent.get(block.content);
        if (previous?.hash && state.coveredBlockHashes.includes(previous.hash)) {
            state.coveredBlockHashes = unique([...state.coveredBlockHashes, block.hash]);
        }
        if (previous?.hash && state.coveredStageHashes.includes(previous.hash)) {
            state.coveredStageHashes = unique([...state.coveredStageHashes, block.hash]);
        }
    }
    state.scanPreview = preview.slice(-maxStoredScanPreviewItems);
    state.lastScanMatchCount = scanned.length;
    state.lastScanAt = new Date().toISOString();

    if (persist) {
        saveState();
    }

    syncInjection();
    if (render) {
        renderAll(`扫描完成：找到 ${scanned.length} 个可总结片段。`);
    }
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

function getSummaryLevel(item) {
    const explicit = Number(item?.level ?? item?.metadata?.level);
    if (Number.isFinite(explicit)) {
        return Math.max(0, explicit);
    }
    if (item?.type === blockTypes.EPIC || item?.kind === blockTypes.EPIC) {
        return 2;
    }
    if (item?.type === blockTypes.STAGE || item?.kind === blockTypes.STAGE) {
        return 1;
    }
    return 0;
}

function getNextMultiSummaryLevel(targets = []) {
    const maxLevel = targets.reduce((max, block) => Math.max(max, getSummaryLevel(block)), 1);
    return Math.max(2, maxLevel + 1);
}

function getUnsummarizedMultiSummaryBlocks() {
    const state = ensureState();
    const covered = new Set(state.coveredStageHashes || []);
    return dedupeByHash([
        ...getBlocksByType(blockTypes.EPIC),
        ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
    ]).filter(block => !covered.has(block.hash));
}

function getMultiSummaryLabel(levelOrItem = 2) {
    const level = typeof levelOrItem === 'number' ? levelOrItem : getSummaryLevel(levelOrItem);
    if (level <= 2) {
        return '多次总结';
    }
    if (level === 3) {
        return '长期总览';
    }
    return `长期总览 L${level}`;
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

function partitionGenerationTargets(blocks = [], kind = 'stage', config = {}) {
    const sorted = getSortedTargetBlocks(blocks);
    const mode = Object.values(targetSelectionModes).includes(config.mode) ? config.mode : targetSelectionModes.ALL;
    if (mode === targetSelectionModes.OLDEST) {
        return [selectGenerationTargets(sorted, config)].filter(batch => batch.length);
    }

    const pool = mode === targetSelectionModes.RANGE ? selectGenerationTargets(sorted, config) : sorted;
    const defaultCount = defaultGenerationTargets[kind]?.count || (kind === 'epic' ? 5 : 20);
    const batchSize = Math.max(1, Number(config.count || defaultCount));
    const batches = [];
    for (let index = 0; index < pool.length; index += batchSize) {
        batches.push(pool.slice(index, index + batchSize));
    }
    return batches.filter(batch => batch.length);
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
    const readKind = kind => {
        const modeInput = $(`#bakemono-memory-${kind}-target-mode`);
        const countInput = $(`#bakemono-memory-${kind}-target-count`);
        const rangeInput = $(`#bakemono-memory-${kind}-target-range`);
        if (!modeInput.length && !countInput.length && !rangeInput.length) {
            return {
                ...defaultGenerationTargets[kind],
                ...(state.generationTargets?.[kind] || {}),
            };
        }
        return {
            mode: String(modeInput.val() || state.generationTargets[kind]?.mode || defaultGenerationTargets[kind].mode),
            count: Math.max(1, Number(countInput.val() || state.generationTargets[kind]?.count || defaultGenerationTargets[kind].count)),
            range: String(rangeInput.val() || state.generationTargets[kind]?.range || '').trim(),
        };
    };
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

function promptGenerationTargetSelection(kind, totalLength, options = {}) {
    const state = ensureState();
    const defaults = defaultGenerationTargets[kind] || defaultGenerationTargets.stage;
    const isBatch = !!options.batch;
    const current = {
        ...defaults,
        ...(state.generationTargets?.[kind] || {}),
    };
    const kindLabel = kind === 'epic' ? '多次总结' : '阶段总结';
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
                    <p>${isBatch
                        ? `本次可用材料：${totalLength} 个。设置每批数量后会分批加入队列。`
                        : `本次可用材料：${totalLength} 个。你可以只合并一部分，避免一次压得太简洁。`}</p>
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
                            <span>${isBatch ? '每批数量' : 'N 个'}</span>
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
            countInput.disabled = !isBatch && mode !== targetSelectionModes.OLDEST;
            rangeInput.disabled = mode !== targetSelectionModes.RANGE;
            if (mode === targetSelectionModes.RANGE && !rangeInput.value.trim()) {
                rangeInput.value = suggestedRange || '0-20';
            }
            if (isBatch) {
                hint.textContent = mode === targetSelectionModes.RANGE
                    ? `只处理指定楼层范围，并按每批 ${countInput.value || current.count || defaults.count} 个材料入队。`
                    : `会按来源楼层从早到晚分批；每批 ${countInput.value || current.count || defaults.count} 个材料。`;
                return;
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
        countInput.addEventListener('input', syncHint);
        syncHint();

        const host = document.getElementById('bakemono-workbench-root') || document.body;
        host.append(overlay);
        modeInput.focus();
    });
}

function promptGenerationModeSelection(kind) {
    const kindLabel = kind === 'epic' ? '多次总结' : '阶段总结';
    const batchLabel = kind === 'epic' ? '批量多次总结' : '批量阶段总结';
    const singleHint = kind === 'epic'
        ? '选范围，生成一条上层草稿。'
        : '选范围，生成一条阶段草稿。';
    const batchHint = kind === 'epic'
        ? '大量总结分批入队。'
        : '大量摘要分批入队。';

    return new Promise(resolve => {
        document.querySelector('.bakemono-memory-generation-mode-dialog')?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'bakemono-memory-target-dialog bakemono-memory-generation-mode-dialog';
        overlay.innerHTML = `
            <section class="bakemono-memory-target-box bakemono-memory-generation-mode-box" role="dialog" aria-modal="true">
                <header>
                    <div>
                        <span>选择生成方式</span>
                        <h3>${kindLabel}</h3>
                    </div>
                    <button type="button" class="menu_button" data-bakemono-mode-cancel><i class="fa-solid fa-xmark"></i></button>
                </header>
                <div class="bakemono-memory-generation-mode-list">
                    <button type="button" class="menu_button bakemono-memory-generation-mode-option" data-bakemono-mode-choice="single">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                        <span>
                            <strong>单次生成</strong>
                            <small>${singleHint}</small>
                        </span>
                    </button>
                    <button type="button" class="menu_button bakemono-memory-generation-mode-option" data-bakemono-mode-choice="batch">
                        <i class="fa-solid fa-list-check"></i>
                        <span>
                            <strong>${batchLabel}</strong>
                            <small>${batchHint}</small>
                        </span>
                    </button>
                </div>
                <footer class="bakemono-memory-inline-actions">
                    <button type="button" class="menu_button" data-bakemono-mode-cancel><i class="fa-solid fa-ban"></i><span>取消</span></button>
                </footer>
            </section>
        `;

        const close = value => {
            overlay.remove();
            resolve(value);
        };
        overlay.querySelectorAll('[data-bakemono-mode-cancel]').forEach(button => {
            button.addEventListener('click', () => close(null));
        });
        overlay.querySelectorAll('[data-bakemono-mode-choice]').forEach(button => {
            button.addEventListener('click', () => close(button.dataset.bakemonoModeChoice));
        });

        const host = document.getElementById('bakemono-workbench-root') || document.body;
        host.append(overlay);
        overlay.querySelector('[data-bakemono-mode-choice]')?.focus();
    });
}

async function chooseStageGenerationMode() {
    if (isBusy) {
        return;
    }
    const mode = await promptGenerationModeSelection('stage');
    if (mode === 'single') {
        await generateStageDraft();
    } else if (mode === 'batch') {
        await generateStageBatchTasks();
    }
}

async function chooseEpicGenerationMode() {
    if (isBusy) {
        return;
    }
    const mode = await promptGenerationModeSelection('epic');
    if (mode === 'single') {
        await generateEpicDraft();
    } else if (mode === 'batch') {
        await generateEpicBatchTasks();
    }
}

function confirmGenerationTargets(kind, targets, totalLength) {
    const state = ensureState();
    const kindLabel = kind === 'epic' ? '多次总结' : '阶段总结';
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
        level: getSummaryLevel(summary),
        isGeneratedSummary: true,
        createdAt: summary.createdAt,
        isHidden: false,
    };
}

function getEpicMemoryBlocks(state = ensureState()) {
    return dedupeByHash([
        ...(state.epicSummaries || []).map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
        ...(state.blocks || []).filter(block => block.type === blockTypes.EPIC),
    ]);
}

function getActiveEpicMemoryBlocks(state = ensureState()) {
    const epicBlocks = getEpicMemoryBlocks(state);
    const epicHashes = new Set(epicBlocks.map(summary => summary.hash).filter(Boolean));
    const coveredEpicHashes = new Set();

    for (const epic of epicBlocks) {
        for (const hash of [...(epic.sourceStageHashes || []), ...(epic.sourceHashes || [])]) {
            if (epicHashes.has(hash)) {
                coveredEpicHashes.add(hash);
            }
        }
    }

    return epicBlocks
        .filter(summary => !coveredEpicHashes.has(summary.hash))
        .sort((a, b) => (
            getSummarySortKey(a) - getSummarySortKey(b)
            || getSummaryLevel(a) - getSummaryLevel(b)
            || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
            || String(a.hash || '').localeCompare(String(b.hash || ''))
        ));
}

function getCoveredStageHashesFromEpic(epic, epicByHash, stageHashes, visited = new Set()) {
    const covered = new Set();
    if (!epic?.hash || visited.has(epic.hash)) {
        return covered;
    }

    visited.add(epic.hash);
    for (const hash of [...(epic.sourceStageHashes || []), ...(epic.sourceHashes || [])]) {
        if (stageHashes.has(hash)) {
            covered.add(hash);
            continue;
        }

        const childEpic = epicByHash.get(hash);
        if (childEpic) {
            for (const childHash of getCoveredStageHashesFromEpic(childEpic, epicByHash, stageHashes, visited)) {
                covered.add(childHash);
            }
        }
    }
    return covered;
}

function getActiveCoveredStageHashes(state = ensureState()) {
    const existingStageHashes = new Set(getStageMemoryBlocks(state).map(summary => summary.hash).filter(Boolean));
    const covered = new Set();
    const epicBlocks = getEpicMemoryBlocks(state);
    const epicByHash = new Map(epicBlocks.map(epic => [epic.hash, epic]).filter(([hash]) => hash));

    for (const epic of getActiveEpicMemoryBlocks(state)) {
        for (const hash of getCoveredStageHashesFromEpic(epic, epicByHash, existingStageHashes)) {
            covered.add(hash);
        }
    }
    return covered;
}

function getStageMemoryBlocks(state = ensureState()) {
    return dedupeByHash([
        ...(state.stageSummaries || []).map(summary => ({ ...summaryToBlock(summary), type: blockTypes.STAGE })),
        ...(state.blocks || []).filter(block => block.type === blockTypes.STAGE),
    ]);
}

function buildMemoryRecords(state = ensureState()) {
    const records = new Map();
    const coveredStoryHashes = new Set(state.coveredBlockHashes || []);
    const coveredStageHashes = getActiveCoveredStageHashes(state);
    const activeEpicHashes = new Set(getActiveEpicMemoryBlocks(state).map(summary => summary.hash).filter(Boolean));
    const epicCoveredStageHashes = getActiveCoveredStageHashes(state);
    const stageInjectedHashes = new Set(state.stageSummaries
        .filter(summary => !epicCoveredStageHashes.has(summary.hash))
        .map(summary => summary.hash));
    const storyInjectedHashes = new Set(state.memoryStrategy === memoryStrategies.GENERIC
        ? state.storySummaries.filter(summary => !coveredStoryHashes.has(summary.hash)).map(summary => summary.hash)
        : []);

    const upsert = record => {
        if (!record?.hash) {
            return;
        }
        const previous = records.get(record.hash) || {};
        records.set(record.hash, {
            ...previous,
            ...record,
            sourceMessageIds: unique([
                ...(previous.sourceMessageIds || []),
                ...(record.sourceMessageIds || []),
            ]),
        });
    };

    for (const block of state.blocks || []) {
        if (!block?.hash || block.isGeneratedSummary) {
            continue;
        }
        const sourceMessageIds = getFiniteMessageIds([block.messageId, ...(block.sourceMessageIds || [])]);
        const isCovered = block.type === blockTypes.STAGE
            ? coveredStageHashes.has(block.hash)
            : coveredStoryHashes.has(block.hash);
        upsert({
            id: `scan:${block.hash}`,
            hash: block.hash,
            kind: block.type || blockTypes.STORY,
            title: block.title || getBlockTitle(block.content, '未命名片段'),
            status: isCovered ? memoryRecordStatuses.COVERED : memoryRecordStatuses.SOURCE,
            source: block.sourceKind === 'raw' ? '全文扫描' : `标签 <${block.matchedTag || 'unknown'}>`,
            sourceMessageIds,
            sourceRange: formatSourceRange(sourceMessageIds),
            contentLength: String(block.content || '').length,
            sourceHashes: block.sourceHashes || [],
            sourceStageHashes: block.sourceStageHashes || [],
            sortKey: getBlockSortKey(block),
            updatedAt: block.createdAt || state.lastScanAt || '',
        });
    }

    const addSummaryRecord = (summary, kind) => {
        const sourceMessageIds = getFiniteMessageIds(summary.sourceMessageIds || []);
        let status = memoryRecordStatuses.SAVED;
        if (kind === blockTypes.STORY) {
            status = storyInjectedHashes.has(summary.hash)
                ? memoryRecordStatuses.INJECTED
                : coveredStoryHashes.has(summary.hash)
                    ? memoryRecordStatuses.COVERED
                    : memoryRecordStatuses.SAVED;
        } else if (kind === blockTypes.STAGE) {
            status = stageInjectedHashes.has(summary.hash)
                ? memoryRecordStatuses.INJECTED
                : coveredStageHashes.has(summary.hash)
                    ? memoryRecordStatuses.ARCHIVED
                    : memoryRecordStatuses.SAVED;
        } else if (kind === blockTypes.EPIC) {
            status = activeEpicHashes.has(summary.hash) ? memoryRecordStatuses.INJECTED : memoryRecordStatuses.ARCHIVED;
        }
        upsert({
            id: `summary:${summary.hash}`,
            hash: summary.hash,
            kind,
            title: summary.title || getBlockTitle(summary.content, getKindLabel(kind)),
            status,
            source: summary.sourceKind === 'backfill' ? '插件补课' : '已保存摘要',
            sourceMessageIds,
            sourceRange: formatSourceRange(sourceMessageIds),
            contentLength: String(summary.content || '').length,
            sourceHashes: summary.sourceHashes || [],
            sourceStageHashes: summary.sourceStageHashes || [],
            sortKey: getSummarySortKey(summary),
            updatedAt: summary.createdAt || '',
        });
    };

    (state.storySummaries || []).forEach(summary => addSummaryRecord(summary, blockTypes.STORY));
    (state.stageSummaries || []).forEach(summary => addSummaryRecord(summary, blockTypes.STAGE));
    (state.epicSummaries || []).forEach(summary => addSummaryRecord(summary, blockTypes.EPIC));

    for (const draft of state.drafts || []) {
        const sourceMessageIds = getFiniteMessageIds(draft.sourceMessageIds || []);
        upsert({
            id: `draft:${draft.id}`,
            hash: draft.id,
            kind: draft.kind || blockTypes.STAGE,
            title: draft.title || getDefaultDraftTitle(draft.kind || blockTypes.STAGE, state),
            status: memoryRecordStatuses.DRAFT,
            source: draft.trigger === 'auto' ? '自动草稿' : '草稿箱',
            sourceMessageIds,
            sourceRange: formatSourceRange(sourceMessageIds),
            contentLength: String(draft.content || '').length,
            sourceHashes: draft.sourceHashes || [],
            sourceStageHashes: draft.sourceStageHashes || [],
            sortKey: getSourceStart(sourceMessageIds),
            updatedAt: draft.createdAt || '',
        });
    }

    return [...records.values()].sort((a, b) => (
        Number(a.sortKey ?? Number.MAX_SAFE_INTEGER) - Number(b.sortKey ?? Number.MAX_SAFE_INTEGER)
        || String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))
        || String(a.hash || '').localeCompare(String(b.hash || ''))
    ));
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
    }, '阶段总结已生成');
}

async function generateEpicSummary() {
    if (isBusy) {
        return;
    }

    scanBakemonoBlocks({ persist: false });
    const state = ensureState();
    const stageTargets = getUnsummarizedStageBlocks();
    const multiTargets = getUnsummarizedMultiSummaryBlocks();
    const storyFallback = getStoryMaterialBlocks().filter(block => !state.coveredBlockHashes.includes(block.hash));
    const targets = stageTargets.length ? stageTargets : multiTargets.length ? multiTargets : storyFallback;
    const nextLevel = getNextMultiSummaryLevel(targets);

    if (!targets.length) {
        renderAll('没有可用于生成多次总结的内容。');
        toastr.info('没有可用于生成多次总结的内容。');
        return;
    }

    const latestEpicAt = state.epicSummaries.at(-1)?.createdAt;
    const confirmed = window.confirm([
        `即将生成【${getMultiSummaryLabel(nextLevel)}】。`,
        '',
        `阶段总结来源：${stageTargets.length} 个`,
        `多次总结来源：${multiTargets.length} 个`,
        `普通摘要 fallback：${storyFallback.length} 个`,
        `上次多次总结：${latestEpicAt ? new Date(latestEpicAt).toLocaleString() : '尚未生成'}`,
        '',
        '这个操作会把更高层级总结写入长期记忆。确认继续吗？',
    ].join('\n'));
    if (!confirmed) {
        renderAll('已取消多次总结生成。');
        return;
    }

    await runGeneration('正在生成多次总结...', async () => {
        const result = normalizeGeneratedBakemono(await generateRaw({
            prompt: buildEpicUserPrompt(targets),
            systemPrompt: buildEpicSystemPrompt(),
        }));

        const hash = getHash(result);
        state.epicSummaries.push({
            hash,
            type: blockTypes.EPIC,
            title: getBlockTitle(result, `${getMultiSummaryLabel(nextLevel)} ${state.epicSummaries.length + 1}`),
            content: result,
            sourceHashes: targets.map(block => block.hash),
            sourceStageHashes: targets.filter(block => block.type === blockTypes.STAGE || block.type === blockTypes.EPIC).map(block => block.hash),
            level: nextLevel,
            createdAt: new Date().toISOString(),
        });
        state.coveredStageHashes = unique([...state.coveredStageHashes, ...targets.filter(block => block.type === blockTypes.STAGE || block.type === blockTypes.EPIC).map(block => block.hash)]);
        state.blocks = mergeBlocks(state.blocks, [{
            hash,
            type: blockTypes.EPIC,
            messageId: Number.MAX_SAFE_INTEGER,
            blockIndex: state.epicSummaries.length,
            title: getBlockTitle(result, `${getMultiSummaryLabel(nextLevel)} ${state.epicSummaries.length}`),
            content: result,
            sourceHashes: targets.map(block => block.hash),
            sourceStageHashes: targets.filter(block => block.type === blockTypes.STAGE || block.type === blockTypes.EPIC).map(block => block.hash),
            level: nextLevel,
            isHidden: false,
        }]);
        updateInjectionFromSummaries();
        saveState();
        renderAll('多次总结已生成并写入注入内容。');
        toastr.success('多次总结已生成。');
    }, '多次总结已生成');
}

function enqueueSummaryTask({ kind, prompt, systemPrompt, sourceHashes = [], sourceStageHashes = [], sourceMessageIds = [], trigger = 'manual', label = '', metadata = {}, autoStart = true, silent = false }) {
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
    if (!silent) {
        renderAll('任务已加入队列。');
    }
    if (autoStart) {
        processTaskQueue();
    }
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
            renderTaskQueueProgress(`正在处理任务：${task.label}`);

            try {
                const rawResult = await callGenerationModel({
                    prompt: task.prompt,
                    systemPrompt: task.systemPrompt,
                });
                if (cancelledQueueTaskIds.has(task.id)) {
                    cancelledQueueTaskIds.delete(task.id);
                    task.status = 'cancelled';
                    task.error = '任务已被手动解除。';
                    task.updatedAt = new Date().toISOString();
                    saveState();
                    renderTaskQueueProgress();
                    continue;
                }
                if (task.trigger === 'missing_summary_batch') {
                    const items = parseMissingSummaryBatchResult(rawResult, task);
                    if (!items.length) {
                        throw new Error('这一批没有解析出任何楼层摘要。请检查模型是否按“===楼层#数字===”分隔输出。');
                    }
                    const createdMessageIds = new Set();
                    for (const item of items) {
                        createMissingSummaryDraftFromBatchItem(item, task);
                        createdMessageIds.add(Number(item.target.messageId));
                    }
                    createdDrafts += items.length;
                    const expectedCount = Array.isArray(task.metadata?.missingTargets) ? task.metadata.missingTargets.length : 0;
                    if (expectedCount && items.length < expectedCount) {
                        const expectedIds = task.metadata.missingTargets.map(target => Number(target.messageId));
                        const missed = expectedIds.filter(id => !createdMessageIds.has(id));
                        task.error = `部分完成：本批 ${expectedCount} 楼中解析出 ${items.length} 楼，缺少 ${missed.map(id => `#${id}`).join(', ')}。`;
                    } else {
                        task.error = '';
                    }
                    task.status = 'done';
                    task.updatedAt = new Date().toISOString();
                    saveState();
                    renderTaskQueueProgress(`已处理任务：${task.label}`);
                    continue;
                }

                const result = normalizeGeneratedBakemono(rawResult);
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
                    const summary = await commitDraft(draft.id, draft.content, { silent: true });
                    autoCommitted += 1;
                    const preserveRecent = Math.max(0, Number(state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent));
                    task.metadata = {
                        ...(task.metadata || {}),
                        autoCommitted: true,
                        autoHiddenPreserveRecent: preserveRecent,
                    };
                    const hiddenBefore = new Set(state.hiddenMessageIds || []);
                    const hiddenIds = await hideCoveredMessages({ confirm: false, preserveRecent, silent: true }) || [];
                    const newlyHiddenIds = hiddenIds.filter(id => !hiddenBefore.has(id));
                    recordAutoSummaryTransaction({
                        task,
                        summary,
                        hiddenMessageIds: newlyHiddenIds,
                        preserveRecent,
                    });
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
            renderTaskQueueProgress();
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
        renderTaskQueueProgress();
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
    const isRunningTask = task?.status === 'running';
    const confirmed = confirmDanger(
        `${isRunningTask ? '强制移除卡住任务' : '移除任务'}「${task?.label || '未命名任务'}」？`,
        [
            '任务移除后不会删除已保存摘要，但这个队列项无法从队列中恢复。',
            ...(isRunningTask ? [
                '如果旧请求稍后返回，插件会忽略它，不再写入草稿。',
                '这只解除插件队列状态，不能中止已经发出的模型请求。',
            ] : []),
        ],
    );
    if (!confirmed) {
        return;
    }
    if (isRunningTask) {
        cancelledQueueTaskIds.add(task.id);
        isQueueRunning = false;
        setBusy(false);
    }
    state.taskQueue = state.taskQueue.filter(task => task.id !== taskId);
    saveState();
    renderAll(isRunningTask ? '已解除卡住的队列任务。' : '任务已从队列移除。');
    processTaskQueue();
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
    }, options.automatic ? '自动阶段总结草稿已生成' : '阶段总结草稿已生成');
}

async function generateStageBatchTasks() {
    if (isBusy) {
        return;
    }

    scanBakemonoBlocks({ persist: false });
    const state = ensureState();
    readGenerationTargetSettings();
    const allTargets = getUnsummarizedStoryBlocks();
    if (!allTargets.length) {
        renderAll('没有新的剧情摘要需要生成阶段总结。');
        toastr.info('没有新的剧情摘要需要生成阶段总结。');
        return;
    }

    const targetConfig = await promptGenerationTargetSelection('stage', allTargets.length, { batch: true });
    if (!targetConfig) {
        renderAll('已取消批量阶段总结。');
        return;
    }

    const config = targetConfig || state.generationTargets.stage || defaultGenerationTargets.stage;
    const batches = partitionGenerationTargets(allTargets, 'stage', config);
    if (!batches.length) {
        renderAll('当前批量范围没有匹配到可总结摘要。');
        toastr.warning('当前批量范围没有匹配到可总结摘要。');
        return;
    }

    const totalTargets = batches.reduce((sum, batch) => sum + batch.length, 0);
    const confirmed = confirmDanger(
        `加入 ${batches.length} 个阶段总结批次任务？`,
        [
            `将覆盖 ${totalTargets}/${allTargets.length} 个普通摘要。`,
            `每批最多 ${Math.max(1, Number(config.count || defaultGenerationTargets.stage.count))} 个摘要。`,
            '生成结果会进入待确认草稿，不会自动保存。',
        ],
    );
    if (!confirmed) {
        renderAll('已取消批量阶段总结。');
        return;
    }

    batches.forEach((targets, index) => {
        const prompt = buildStageUserPrompt(targets);
        const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
        enqueueSummaryTask({
            kind: blockTypes.STAGE,
            label: `阶段总结 第 ${index + 1}/${batches.length} 批 · ${targets.length} 个片段`,
            prompt,
            systemPrompt: buildStageSystemPrompt(),
            sourceHashes: targets.map(block => block.hash),
            sourceMessageIds,
            trigger: 'batch_stage',
            metadata: {
                sourceRange: formatSourceRange(sourceMessageIds),
                sourceStart: getSourceStart(sourceMessageIds),
                sourceEnd: getSourceEnd(sourceMessageIds),
                sourceSortKey: getSourceStart(sourceMessageIds),
                sourceMode: getStageSourceMode(),
                batchIndex: index + 1,
                batchTotal: batches.length,
                selectionLabel: `批量阶段总结：第 ${index + 1}/${batches.length} 批，${targets.length}/${allTargets.length} 个`,
            },
            autoStart: false,
            silent: true,
        });
    });

    renderAll(`已加入 ${batches.length} 个阶段总结批次任务。`);
    toastr.success(`已加入 ${batches.length} 个阶段总结批次任务。`);
    processTaskQueue();
}

async function generateEpicDraft(options = {}) {
    if (isBusy) {
        return;
    }

    scanBakemonoBlocks({ persist: false });
    const state = ensureState();
    const allStageTargets = getUnsummarizedStageBlocks();
    const allMultiTargets = getUnsummarizedMultiSummaryBlocks();
    const allStoryFallback = getStoryMaterialBlocks().filter(block => !state.coveredBlockHashes.includes(block.hash));
    if (!allStageTargets.length && !allMultiTargets.length && !allStoryFallback.length) {
        renderAll('没有可用于生成多次总结的内容。');
        toastr.info('没有可用于生成多次总结的内容。');
        return;
    }
    let targetConfig = state.generationTargets.epic;
    if (!options.automatic) {
        readGenerationTargetSettings();
        targetConfig = await promptGenerationTargetSelection('epic', allStageTargets.length || allMultiTargets.length || allStoryFallback.length);
        if (!targetConfig) {
            renderAll('已取消多次总结生成。');
            return;
        }
    }
    const stageTargets = selectGenerationTargets(allStageTargets, targetConfig);
    const multiTargets = selectGenerationTargets(allMultiTargets, targetConfig);
    const storyFallback = selectGenerationTargets(allStoryFallback, targetConfig);
    const targets = stageTargets.length ? stageTargets : multiTargets.length ? multiTargets : storyFallback;
    const nextLevel = getNextMultiSummaryLevel(targets);
    const sourcePoolSize = stageTargets.length ? allStageTargets.length : multiTargets.length ? allMultiTargets.length : allStoryFallback.length;

    if (!targets.length) {
        renderAll('当前生成范围没有匹配到可用于多次总结的内容。');
        toastr.warning('当前生成范围没有匹配到可用于多次总结的内容。');
        return;
    }

    if (!options.automatic) {
        const latestEpicAt = state.epicSummaries.at(-1)?.createdAt;
        const confirmed = window.confirm([
            `即将生成【${getMultiSummaryLabel(nextLevel)}】草稿。`,
            '',
            `阶段总结来源：${stageTargets.length}/${allStageTargets.length} 个`,
            `多次总结来源：${multiTargets.length}/${allMultiTargets.length} 个`,
            `普通摘要 fallback：${storyFallback.length}/${allStoryFallback.length} 个`,
            `当前范围：${getTargetSelectionLabel('epic', targets.length, sourcePoolSize)}`,
            `上次多次总结：${latestEpicAt ? new Date(latestEpicAt).toLocaleString() : '尚未生成'}`,
            '',
            '这只会生成待确认草稿，确认保存后才会写入长期记忆。继续吗？',
        ].join('\n'));
        if (!confirmed) {
            renderAll('已取消多次总结生成。');
            return;
        }
    }

    const prompt = buildEpicUserPrompt(targets);
    enqueueSummaryTask({
        kind: blockTypes.EPIC,
        label: `${getMultiSummaryLabel(nextLevel)} · ${targets.length} 个片段`,
        prompt,
        systemPrompt: buildEpicSystemPrompt(),
        sourceHashes: targets.map(block => block.hash),
        sourceStageHashes: targets.filter(block => block.type === blockTypes.STAGE || block.type === blockTypes.EPIC).map(block => block.hash),
        sourceMessageIds: unique(targets.map(block => block.messageId).filter(Number.isFinite)),
        trigger: options.automatic ? 'auto' : 'manual',
        metadata: {
            sourceRange: formatSourceRange(targets.map(block => block.messageId)),
            sourceStart: getSourceStart(targets.map(block => block.messageId)),
            sourceEnd: getSourceEnd(targets.map(block => block.messageId)),
            sourceSortKey: getSourceStart(targets.map(block => block.messageId)),
            level: nextLevel,
            selectionLabel: getTargetSelectionLabel('epic', targets.length, sourcePoolSize),
        },
    });
}

async function generateEpicBatchTasks() {
    if (isBusy) {
        return;
    }

    scanBakemonoBlocks({ persist: false });
    const state = ensureState();
    readGenerationTargetSettings();
    const allStageTargets = getUnsummarizedStageBlocks();
    const allMultiTargets = getUnsummarizedMultiSummaryBlocks();
    const allStoryFallback = getStoryMaterialBlocks().filter(block => !state.coveredBlockHashes.includes(block.hash));
    const sourceBlocks = allStageTargets.length ? allStageTargets : allMultiTargets.length ? allMultiTargets : allStoryFallback;
    if (!sourceBlocks.length) {
        renderAll('没有可用于生成多次总结的内容。');
        toastr.info('没有可用于生成多次总结的内容。');
        return;
    }

    const targetConfig = await promptGenerationTargetSelection('epic', sourceBlocks.length, { batch: true });
    if (!targetConfig) {
        renderAll('已取消批量多次总结。');
        return;
    }

    const config = targetConfig || state.generationTargets.epic || defaultGenerationTargets.epic;
    const batches = partitionGenerationTargets(sourceBlocks, 'epic', config);
    if (!batches.length) {
        renderAll('当前批量范围没有匹配到可用于多次总结的内容。');
        toastr.warning('当前批量范围没有匹配到可用于多次总结的内容。');
        return;
    }

    const totalTargets = batches.reduce((sum, batch) => sum + batch.length, 0);
    const confirmed = confirmDanger(
        `加入 ${batches.length} 个多次总结批次任务？`,
        [
            `将覆盖 ${totalTargets}/${sourceBlocks.length} 个阶段/多次材料。`,
            `每批最多 ${Math.max(1, Number(config.count || defaultGenerationTargets.epic.count))} 个材料。`,
            '建议先确认并保存已有阶段总结，再批量生成多次总结。',
            '生成结果会进入待确认草稿，不会自动保存。',
        ],
    );
    if (!confirmed) {
        renderAll('已取消批量多次总结。');
        return;
    }

    batches.forEach((targets, index) => {
        const nextLevel = getNextMultiSummaryLevel(targets);
        const prompt = buildEpicUserPrompt(targets);
        const sourceMessageIds = getSourceMessageIdsFromBlocks(targets);
        enqueueSummaryTask({
            kind: blockTypes.EPIC,
            label: `${getMultiSummaryLabel(nextLevel)} 第 ${index + 1}/${batches.length} 批 · ${targets.length} 个片段`,
            prompt,
            systemPrompt: buildEpicSystemPrompt(),
            sourceHashes: targets.map(block => block.hash),
            sourceStageHashes: targets.filter(block => block.type === blockTypes.STAGE || block.type === blockTypes.EPIC).map(block => block.hash),
            sourceMessageIds,
            trigger: 'batch_epic',
            metadata: {
                sourceRange: formatSourceRange(sourceMessageIds),
                sourceStart: getSourceStart(sourceMessageIds),
                sourceEnd: getSourceEnd(sourceMessageIds),
                sourceSortKey: getSourceStart(sourceMessageIds),
                level: nextLevel,
                batchIndex: index + 1,
                batchTotal: batches.length,
                selectionLabel: `批量多次总结：第 ${index + 1}/${batches.length} 批，${targets.length}/${sourceBlocks.length} 个`,
            },
            autoStart: false,
            silent: true,
        });
    });

    renderAll(`已加入 ${batches.length} 个多次总结批次任务。`);
    toastr.success(`已加入 ${batches.length} 个多次总结批次任务。`);
    processTaskQueue();
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
    }, '旧正文摘要草稿已生成');
}

function buildBackfillBatches(options = {}) {
    const state = ensureState();
    const sourceChat = getContext().chat || chat || [];
    const excludeTags = parseList(state.scanRules.excludeTags);
    const includeHidden = state.scanRules.includeHidden !== false;
    const batchSize = Math.max(1, Number(state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize));
    const rangeIds = options.rangeIds instanceof Set ? options.rangeIds : null;
    const covered = new Set([
        ...state.coveredBlockHashes,
        ...state.storySummaries.flatMap(summary => summary.sourceHashes || []),
    ]);
    const coveredMessageIds = new Set(state.storySummaries.flatMap(summary => getFiniteMessageIds(summary.sourceMessageIds || [])));
    const rawBlocks = [];

    sourceChat.forEach((message, messageId) => {
        if (rangeIds && !rangeIds.has(messageId)) {
            return;
        }
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
            title: message.is_user ? `用户 #${messageId}` : `助手 #${messageId}`,
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

function getConfiguredSummaryTags(state = ensureState()) {
    const nonSummaryTags = new Set(['content', 'thinking', 'think', 'reasoning', 'tableedit', 'tablethink']);
    const scanSummaryTags = parseList(state.scanRules.includeTags)
        .filter(tag => tag && !nonSummaryTags.has(String(tag).trim().toLowerCase()));
    return unique([
        ...scanSummaryTags,
        ...parseList(state.vectorMemory?.summaryTags || ''),
        'bakemono',
        'summaryDraft',
    ].filter(Boolean));
}

function messageHasConfiguredSummary(message, state = ensureState()) {
    return extractConfiguredTagBlocks(message?.mes || '', getConfiguredSummaryTags(state)).length > 0;
}

function buildMissingSummaryTargets(options = {}) {
    const state = ensureState();
    const sourceChat = getContext().chat || chat || [];
    const includeHidden = state.scanRules.includeHidden !== false;
    const rangeIds = options.rangeIds instanceof Set ? options.rangeIds : null;
    const excludeTags = unique([...parseList(state.scanRules.excludeTags), ...getConfiguredSummaryTags(state)]);
    const existingSourceHashes = new Set([
        ...state.storySummaries.flatMap(summary => summary.sourceHashes || []),
        ...state.drafts.flatMap(draft => draft.sourceHashes || []),
        ...state.taskQueue.flatMap(task => task.sourceHashes || []),
    ]);
    const targets = [];

    sourceChat.forEach((message, messageId) => {
        if (rangeIds && !rangeIds.has(messageId)) {
            return;
        }
        if (!message?.mes || message.is_user || (message.is_system && !includeHidden)) {
            return;
        }
        if (messageHasConfiguredSummary(message, state)) {
            return;
        }
        const rawText = String(message.mes || '');
        const cleaned = stripConfiguredTags(stripPostProcessNoise(rawText), excludeTags).trim();
        if (!cleaned) {
            return;
        }
        const sourceHash = getHash(`missing-summary|${messageId}|${getMessageVariantKey(message)}|${cleaned}`);
        if (existingSourceHashes.has(sourceHash)) {
            return;
        }
        targets.push({
            hash: sourceHash,
            type: blockTypes.STORY,
            messageId,
            blockIndex: 0,
            title: `助手 #${messageId}`,
            content: cleaned,
            sourceKind: 'missing_summary',
            targetMessageHash: getHash(rawText),
        });
    });

    return targets;
}

function buildMissingSummaryBatches(targets, batchSize) {
    const size = Math.max(1, Number(batchSize || 1));
    const batches = [];
    for (let index = 0; index < targets.length; index += size) {
        const blocks = targets.slice(index, index + size);
        const ids = blocks.map(block => block.messageId).filter(Number.isFinite);
        batches.push({
            blocks,
            metadata: {
                batchIndex: batches.length + 1,
                batchTotal: Math.ceil(targets.length / size),
                sourceRange: formatSourceRange(ids),
                sourceStart: getSourceStart(ids),
                sourceEnd: getSourceEnd(ids),
                sourceSortKey: getSourceStart(ids),
                sourceKind: 'missing_summary_batch',
                trigger: 'missing_summary',
            },
        });
    }
    return batches;
}

function buildMissingSummaryBatchPrompt(blocks, metadata = {}, state = ensureState()) {
    const basePrompt = state.generationPrompts?.missing || defaultMissingSummaryPrompt;
    const template = String(basePrompt || '').trim();
    const blockText = blocks.map(block => [
        `===楼层#${block.messageId}===`,
        block.content,
        `===楼层#${block.messageId}结束===`,
    ].join('\n')).join('\n\n');
    const sourceStart = getSourceStart(blocks.map(block => block.messageId));
    const sourceEnd = getSourceEnd(blocks.map(block => block.messageId));
    const replacements = {
        blocks: blockText,
        batchIndex: metadata.batchIndex ?? '',
        batchTotal: metadata.batchTotal ?? '',
        sourceRange: metadata.sourceRange || formatSourceRange(blocks.map(block => block.messageId)),
        startFloor: Number.isFinite(sourceStart) && sourceStart < Number.MAX_SAFE_INTEGER ? sourceStart : '未知',
        endFloor: Number.isFinite(sourceEnd) && sourceEnd < Number.MAX_SAFE_INTEGER ? sourceEnd : '未知',
        suggestedTitle: metadata.suggestedTitle || '补写缺失摘要',
    };
    let rendered = template || defaultMissingSummaryPrompt;
    const hadBlocksPlaceholder = rendered.includes('{{blocks}}');
    for (const [key, value] of Object.entries(replacements)) {
        rendered = rendered.replaceAll(`{{${key}}}`, String(value));
    }
    if (!hadBlocksPlaceholder) {
        rendered = `${rendered}\n\n待补写楼层：\n${blockText}`;
    }
    return rendered.trim();
}

function parseMissingSummaryBatchResult(result, task) {
    const text = String(result || '')
        .replace(/<think(?:ing)?[\s>][\s\S]*?<\/think(?:ing)?>/gi, '')
        .trim();
    const segments = text.split(/={2,}\s*(?:楼层|消息|message|floor)\s*#?\s*(\d+)\s*={2,}/gi);
    const parsed = [];
    const expected = new Map((task.metadata?.missingTargets || []).map(target => [Number(target.messageId), target]));

    if (segments.length > 1) {
        for (let index = 1; index < segments.length; index += 2) {
            const messageId = Number(segments[index]);
            const target = expected.get(messageId);
            const rawContent = String(segments[index + 1] || '').trim();
            if (!target || !rawContent) {
                continue;
            }
            const legacyContent = extractTaggedContent(rawContent, 'summaryDraft');
            parsed.push({ target, content: normalizeGeneratedBakemono(legacyContent || rawContent) });
        }
    }

    if (!parsed.length && expected.size === 1 && text) {
        const [target] = expected.values();
        const legacyContent = extractTaggedContent(text, 'summaryDraft');
        parsed.push({ target, content: normalizeGeneratedBakemono(legacyContent || text) });
    }

    return parsed;
}

function createMissingSummaryDraftFromBatchItem(item, task) {
    return createDraft({
        kind: blockTypes.STORY,
        content: item.content,
        sourceHashes: [item.target.hash],
        sourceMessageIds: [item.target.messageId],
        prompt: task.prompt,
        trigger: task.trigger || 'missing_summary',
        metadata: {
            ...(task.metadata || {}),
            sourceKind: 'missing_summary',
            sourceRange: formatSourceRange([item.target.messageId]),
            sourceSortKey: item.target.messageId,
            targetMessageId: item.target.messageId,
            targetMessageHash: item.target.targetMessageHash,
            appendMode: 'missing_summary',
            suggestedTitle: `补写摘要 #${item.target.messageId}`,
            missingBatchTaskId: task.id,
            missingBatchRange: task.metadata?.sourceRange || '',
            missingBatchIndex: task.metadata?.batchIndex || '',
            missingBatchTotal: task.metadata?.batchTotal || '',
        },
    });
}

function getBatchSummaryRangeIdsFromUi() {
    const raw = String($('#bakemono-memory-batch-summary-range').val() || '').trim();
    if (!raw) {
        return { ids: null, invalid: [] };
    }
    const parsed = parseMessageRangeInput(raw);
    return { ids: new Set(parsed.ids), invalid: parsed.invalid || [] };
}

function readBatchSummarySettingsFromUi(state = ensureState()) {
    const input = $('#bakemono-memory-batch-summary-size');
    if (input.length) {
        state.automation.backfillBatchSize = Math.max(1, Number(input.val() || state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize));
        saveState();
    }
    return state;
}

async function generateBatchSummaryQueue() {
    readBatchSummarySettingsFromUi();
    const mode = String($('#bakemono-memory-batch-summary-mode').val() || 'missing');
    const { ids, invalid } = getBatchSummaryRangeIdsFromUi();
    if (invalid.length) {
        toastr.warning(`这些范围没有识别：${invalid.join(', ')}`);
    }
    if (mode === 'backfill') {
        await generateBackfillQueue({ rangeIds: ids });
        return;
    }
    await generateMissingSummaryQueue({ rangeIds: ids });
}

async function generateMissingSummaryQueue(options = {}) {
    if (isBusy) {
        return;
    }

    const state = ensureState();
    const targets = buildMissingSummaryTargets(options);
    if (!targets.length) {
        renderAll('没有找到缺失摘要的助手楼层。');
        toastr.info('没有找到缺失摘要的助手楼层。');
        return;
    }

    const batchSize = Math.max(1, Number(state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize));
    const batches = buildMissingSummaryBatches(targets, batchSize);
    const confirmed = confirmDanger(
        `补写 ${targets.length} 个缺失摘要？`,
        [
            `将按每批 ${batchSize} 楼加入 ${batches.length} 个批次任务。`,
            `预计最多调用 ${batches.length} 次生成 API，而不是 ${targets.length} 次。`,
            '每个批次会返回多个楼层摘要；插件会拆成逐楼草稿，确认保存后才会追加回原正文。',
            `范围：${formatSourceRange(targets.map(block => block.messageId))}`,
        ],
    );
    if (!confirmed) {
        renderAll('已取消补写缺失摘要。');
        return;
    }

    for (const [index, batch] of batches.entries()) {
        const prompt = buildMissingSummaryBatchPrompt(batch.blocks, batch.metadata, state);
        enqueueSummaryTask({
            kind: blockTypes.STORY,
            label: `补写缺失摘要 第 ${index + 1}/${batches.length} 批（${batch.metadata.sourceRange}）`,
            prompt,
            systemPrompt: await buildTurnReferenceSystemPrompt(batch.blocks, 'summary', state),
            sourceHashes: batch.blocks.map(block => block.hash),
            sourceMessageIds: batch.blocks.map(block => block.messageId),
            trigger: 'missing_summary_batch',
            metadata: {
                ...batch.metadata,
                appendMode: 'missing_summary_batch',
                missingTargets: batch.blocks.map(block => ({
                    hash: block.hash,
                    messageId: block.messageId,
                    targetMessageHash: block.targetMessageHash,
                    title: block.title,
                })),
            },
        });
    }
    renderAll(`已加入 ${batches.length} 个缺失摘要批次任务。`);
    toastr.success(`已加入 ${batches.length} 个补写批次任务。`);
}

async function generateBackfillQueue(options = {}) {
    if (isBusy) {
        return;
    }

    const batches = buildBackfillBatches(options);
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

async function maybeRunTurnSummary() {
    const state = ensureState();
    if (!state.turnSummary.auto || isBusy) {
        return;
    }
    const mode = state.turnSummary.processingMode || turnProcessingModes.BOTH;
    if (mode === turnProcessingModes.TABLE) {
        if (state.tableDatabase.enabled && state.tableDatabase.tables.length) {
            await processLatestTableEdit({ manual: false });
        }
    } else if (state.turnSummary.enabled) {
        await processLatestTurnSummary({ manual: false });
    } else if (state.tableDatabase.enabled && state.tableDatabase.tables.length) {
        await processLatestTableEdit({ manual: false });
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

let operationFeedbackTimer = null;
let activeWorkbenchHelpTrigger = null;
let operationFeedbackCaptureUntil = 0;
let operationFeedbackCaptureHandler = null;

function clearOperationFeedback() {
    if (operationFeedbackTimer) {
        window.clearTimeout(operationFeedbackTimer);
        operationFeedbackTimer = null;
    }
    document.getElementById('bakemono-memory-operation-toast')?.remove();
    document.getElementById('bakemono-workbench-root')?.classList.remove('is-operation-running');
}

function setOperationFeedback(state = '', message = '', timeout = 0) {
    const root = document.getElementById('bakemono-workbench-root');
    const text = String(message || '').trim();
    if (!root || !state || !text) {
        clearOperationFeedback();
        return;
    }
    if (operationFeedbackTimer) {
        window.clearTimeout(operationFeedbackTimer);
        operationFeedbackTimer = null;
    }
    let toast = document.getElementById('bakemono-memory-operation-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'bakemono-memory-operation-toast';
        toast.className = 'bakemono-memory-operation-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        root.appendChild(toast);
    }
    const icon = state === 'running'
        ? '<span class="bakemono-memory-operation-spinner" aria-hidden="true"></span>'
        : `<i class="fa-solid ${state === 'success' ? 'fa-check' : 'fa-triangle-exclamation'}" aria-hidden="true"></i>`;
    toast.className = `bakemono-memory-operation-toast is-${state}`;
    toast.innerHTML = `${icon}<span>${escapeHtml(text)}</span>`;
    root.classList.toggle('is-operation-running', state === 'running');
    if (timeout > 0) {
        operationFeedbackTimer = window.setTimeout(clearOperationFeedback, timeout);
    }
}

function armOperationFeedbackCapture() {
    operationFeedbackCaptureUntil = Date.now() + 10000;
}

function captureOperationFeedbackFromStatus(statusText = '') {
    const text = String(statusText || '').trim();
    if (!text || Date.now() > operationFeedbackCaptureUntil) {
        return;
    }
    if (/^(已取消|取消)/.test(text)) {
        operationFeedbackCaptureUntil = 0;
        clearOperationFeedback();
        return;
    }
    if (/^(正在|开始)/.test(text)) {
        setOperationFeedback('running', text);
        return;
    }
    operationFeedbackCaptureUntil = 0;
    const failed = /(失败|错误|异常)/.test(text);
    setOperationFeedback(failed ? 'error' : 'success', text, failed ? 2600 : 1200);
}

async function runGeneration(message, action, successMessage = '生成完成') {
    setOperationFeedback('running', message);
    renderAll(message);
    setBusy(true);
    try {
        await action();
        setOperationFeedback('success', successMessage, 1200);
    } catch (error) {
        console.error('[BakemonoMemory] generation failed', error);
        const failure = `生成失败：${error?.message || error}`;
        setOperationFeedback('error', failure, 2600);
        renderAll(failure);
    } finally {
        setBusy(false);
    }
}

async function runVisibleOperation(message, action, successMessage = '操作完成') {
    setOperationFeedback('running', message);
    renderAll(message);
    setBusy(true);
    try {
        const result = await action();
        if (result === false) {
            clearOperationFeedback();
            return result;
        }
        setOperationFeedback('success', successMessage, 1200);
        return result;
    } catch (error) {
        const failure = error?.message || String(error);
        setOperationFeedback('error', failure, 2600);
        throw error;
    } finally {
        setBusy(false);
    }
}

function setBusy(value) {
    isBusy = value;
    $('#bakemono-memory-generate-stage, #bakemono-memory-generate-epic, #bakemono-memory-backfill, [data-bakemono-action="generate-stage"], [data-bakemono-action="generate-stage-batch"], [data-bakemono-action="generate-epic"], [data-bakemono-action="generate-epic-batch"], [data-bakemono-action="backfill"], [data-bakemono-action="batch-summary"], [data-bakemono-action="commit-missing-all"], [data-bakemono-action="remove-missing-all"], [data-bakemono-action="process-latest-turn"], [data-bakemono-action="process-latest-table"], [data-bakemono-action="vector-index"], [data-bakemono-action="vector-test"], [data-bakemono-action="vector-fetch-models"], [data-bakemono-action="vector-fetch-query-models"], [data-bakemono-draft-action], [data-bakemono-task-action], [data-bakemono-auto-tx-action], [data-bakemono-table-draft-action]').prop('disabled', value);
}

async function callGenerationModel({ prompt, systemPrompt }) {
    const state = ensureState();
    if (state.automation.apiProvider !== 'custom') {
        return await generateRaw({ prompt, systemPrompt });
    }

    const config = state.automation.customApi || {};
    const baseUrl = normalizeCustomApiBaseUrl(config.baseUrl);
    const model = String(config.model || '').trim();
    const apiKey = String(config.apiKey || '').trim();
    if (!baseUrl || !model) {
        throw new Error('自定义接口需要填写接口地址和模型。');
    }

    const stream = !!config.stream;
    const response = await fetch(getCustomChatCompletionsUrl(baseUrl), {
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
            stream,
        }),
    });
    if (!response.ok) {
        throw new Error(`自定义 API 请求失败：${response.status} ${response.statusText}`);
    }
    if (stream) {
        return await readOpenAIStream(response);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
    if (!content) {
        throw new Error('自定义 API 没有返回可用内容。');
    }
    return content;
}

function normalizeCustomApiBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function getCustomChatCompletionsUrl(baseUrl) {
    const clean = normalizeCustomApiBaseUrl(baseUrl);
    if (/\/chat\/completions$/i.test(clean)) {
        return clean;
    }
    return `${clean}/chat/completions`;
}

function getCustomModelsUrl(baseUrl) {
    let clean = normalizeCustomApiBaseUrl(baseUrl);
    clean = clean.replace(/\/chat\/completions$/i, '');
    return `${clean}/models`;
}

async function readOpenAIStream(response) {
    if (!response.body?.getReader) {
        throw new Error('当前浏览器无法读取自定义 API 的流式响应，请改用非流式。');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) {
                continue;
            }
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') {
                continue;
            }
            try {
                const data = JSON.parse(payload);
                content += data?.choices?.[0]?.delta?.content
                    || data?.choices?.[0]?.message?.content
                    || data?.choices?.[0]?.text
                    || '';
            } catch {
                // Some proxies send keep-alive chunks that are not JSON.
            }
        }
    }
    if (!content.trim()) {
        throw new Error('自定义 API 流式响应没有返回可用内容。');
    }
    return content;
}

async function fetchCustomApiModels() {
    const state = ensureState();
    readCustomApiFieldsFromUi(state);
    const config = state.automation.customApi || {};
    const baseUrl = normalizeCustomApiBaseUrl(config.baseUrl);
    const apiKey = String(config.apiKey || '').trim();
    if (!baseUrl) {
        toastr.warning('请先填写自定义接口地址。');
        return;
    }
    const toast = toastr.info('正在拉取模型列表...', '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
    try {
        const response = await fetch(getCustomModelsUrl(baseUrl), {
            method: 'GET',
            headers: {
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
        });
        if (!response.ok) {
            throw new Error(`拉取模型失败：${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        const models = Array.isArray(data?.data)
            ? data.data.map(item => item?.id || item?.name).filter(Boolean)
            : [];
        if (!models.length) {
            throw new Error('接口返回里没有找到模型 ID。');
        }
        state.automation.customApi.models = unique(models.map(item => String(item).trim()).filter(Boolean)).sort();
        if (!String(state.automation.customApi.model || '').trim()) {
            state.automation.customApi.model = state.automation.customApi.models[0];
            $('#bakemono-memory-custom-model').val(state.automation.customApi.model);
        }
        renderCustomModelOptions(state.automation.customApi.models);
        saveState();
        toastr.success(`已拉取 ${state.automation.customApi.models.length} 个模型。`);
    } catch (error) {
        toastr.error(error?.message || String(error), '模型拉取失败');
    } finally {
        toastr.clear(toast);
    }
}

async function fetchVectorEmbeddingModels() {
    const state = ensureState();
    readVectorMemoryFieldsFromUi(state);
    const config = state.vectorMemory.customApi || {};
    const baseUrl = normalizeCustomApiBaseUrl(config.baseUrl);
    const apiKey = String(config.apiKey || '').trim();
    if (!baseUrl) {
        toastr.warning('请先填写嵌入向量接口地址。');
        return;
    }
    const toast = toastr.info('正在拉取嵌入向量模型列表...', '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
    try {
        const response = await fetch(getCustomModelsUrl(baseUrl), {
            method: 'GET',
            headers: {
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
        });
        if (!response.ok) {
            throw new Error(`拉取模型失败：${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        const models = Array.isArray(data?.data)
            ? data.data.map(item => item?.id || item?.name).filter(Boolean)
            : [];
        if (!models.length) {
            throw new Error('接口返回里没有找到模型 ID。');
        }
        state.vectorMemory.customApi.models = unique(models.map(item => String(item).trim()).filter(Boolean)).sort();
        if (!String(state.vectorMemory.customApi.model || '').trim()) {
            state.vectorMemory.customApi.model = state.vectorMemory.customApi.models[0];
            $('#bakemono-memory-vector-model').val(state.vectorMemory.customApi.model);
        }
        renderVectorModelOptions(state.vectorMemory.customApi.models);
        saveState();
        toastr.success(`已拉取 ${state.vectorMemory.customApi.models.length} 个嵌入向量模型。`);
    } catch (error) {
        toastr.error(error?.message || String(error), '嵌入向量模型拉取失败');
    } finally {
        toastr.clear(toast);
    }
}

async function fetchVectorQueryModels() {
    const state = ensureState();
    readVectorMemoryFieldsFromUi(state);
    const queryConfig = state.vectorMemory.queryCustomApi || {};
    const embeddingConfig = state.vectorMemory.customApi || {};
    const baseUrl = normalizeCustomApiBaseUrl(queryConfig.baseUrl || embeddingConfig.baseUrl);
    const apiKey = String(queryConfig.apiKey || embeddingConfig.apiKey || '').trim();
    if (!baseUrl) {
        toastr.warning('请先填写改写接口地址，或填写上方嵌入向量接口地址以便复用。');
        return;
    }
    const toast = toastr.info('正在拉取改写模型列表...', '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
    try {
        const response = await fetch(getCustomModelsUrl(baseUrl), {
            method: 'GET',
            headers: {
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
        });
        if (!response.ok) {
            throw new Error(`拉取模型失败：${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        const models = Array.isArray(data?.data)
            ? data.data.map(item => item?.id || item?.name).filter(Boolean)
            : [];
        if (!models.length) {
            throw new Error('接口返回里没有找到模型 ID。');
        }
        state.vectorMemory.queryCustomApi.models = unique(models.map(item => String(item).trim()).filter(Boolean)).sort();
        if (!String(state.vectorMemory.queryCustomApi.model || '').trim()) {
            state.vectorMemory.queryCustomApi.model = state.vectorMemory.queryCustomApi.models[0];
            $('#bakemono-memory-vector-query-model').val(state.vectorMemory.queryCustomApi.model);
        }
        renderVectorQueryModelOptions(state.vectorMemory.queryCustomApi.models);
        saveState();
        toastr.success(`已拉取 ${state.vectorMemory.queryCustomApi.models.length} 个改写模型。`);
    } catch (error) {
        toastr.error(error?.message || String(error), '改写模型拉取失败');
    } finally {
        toastr.clear(toast);
    }
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
        return `多次总结草稿 ${state.epicSummaries.length + 1}`;
    }
    return `剧集终了草稿 ${state.stageSummaries.length + 1}`;
}

function updateChatMessageText(message, text) {
    message.mes = text;
    if (Array.isArray(message.swipes)) {
        const swipeId = Number.isFinite(Number(message.swipe_id)) ? Number(message.swipe_id) : 0;
        if (swipeId >= 0 && swipeId < message.swipes.length) {
            message.swipes[swipeId] = text;
        }
    }
}

function getMissingSummaryDraftConflict(draft, state = ensureState()) {
    const targetMessageId = Number(draft?.metadata?.targetMessageId);
    if (!Number.isFinite(targetMessageId) || !chat[targetMessageId]) {
        return '目标楼层不存在，可能已经被删除。';
    }
    const message = chat[targetMessageId];
    if (message.is_user) {
        return '目标楼层不是助手正文。';
    }
    if (messageHasConfiguredSummary(message, state)) {
        return '目标楼层已经包含摘要块。';
    }
    const expectedHash = String(draft?.metadata?.targetMessageHash || '');
    if (expectedHash && getHash(String(message.mes || '')) !== expectedHash) {
        return '目标楼层正文已经变化，请重新补写。';
    }
    return '';
}

function commitMissingSummaryDraft(draftIndex, editedContent = null, options = {}) {
    const state = ensureState();
    const draft = state.drafts[draftIndex];
    const conflict = getMissingSummaryDraftConflict(draft, state);
    if (conflict) {
        toastr.warning(conflict);
        return null;
    }

    const targetMessageId = Number(draft.metadata.targetMessageId);
    const message = chat[targetMessageId];
    const content = normalizeGeneratedBakemono(editedContent ?? draft.content);
    const original = String(message.mes || '').trimEnd();
    updateChatMessageText(message, `${original}\n\n${content}`);

    state.drafts.splice(draftIndex, 1);
    state.history.unshift({
        id: `append-missing-${getHash(`${draft.id}|${Date.now()}`)}`,
        kind: draft.kind,
        summaryHash: getHash(content),
        draft,
        summary: {
            hash: getHash(content),
            type: draft.kind,
            title: draft.title || getBlockTitle(content, '补写摘要'),
            content,
            sourceHashes: draft.sourceHashes || [],
            sourceMessageIds: [targetMessageId],
            sourceKind: 'missing_summary',
            metadata: draft.metadata || {},
            createdAt: new Date().toISOString(),
            draftId: draft.id,
        },
        action: 'append_missing_summary',
        createdAt: new Date().toISOString(),
    });

    saveChatConditional().catch(error => console.warn('[BakemonoMemory] failed to save appended summary', error));
    scanBakemonoBlocks({ persist: false });
    updateInjectionFromSummaries();
    saveState();
    if (!options.silent) {
        renderAll(`已把摘要补写到第 ${targetMessageId} 楼。`);
        toastr.success(`已补写到第 ${targetMessageId} 楼。`);
    }
    return content;
}

async function commitAllMissingSummaryDrafts() {
    const state = ensureState();
    const drafts = state.drafts.filter(draft => draft.metadata?.appendMode === 'missing_summary');
    if (!drafts.length) {
        toastr.info('暂无可应用的缺失摘要草稿。');
        return;
    }

    const ready = [];
    const conflicts = [];
    const seenTargets = new Set();
    for (const draft of drafts) {
        const conflict = getMissingSummaryDraftConflict(draft, state);
        if (conflict) {
            conflicts.push({ draft, conflict });
        } else if (seenTargets.has(Number(draft.metadata?.targetMessageId))) {
            conflicts.push({ draft, conflict: '同一楼层存在多个缺失摘要草稿，请手动处理。' });
        } else {
            seenTargets.add(Number(draft.metadata?.targetMessageId));
            ready.push(draft);
        }
    }

    if (!ready.length) {
        toastr.warning(`没有无冲突草稿可应用。${conflicts[0]?.conflict || ''}`);
        return;
    }

    const confirmed = confirmDanger(
        `一键应用 ${ready.length} 个缺失摘要草稿？`,
        [
            '插件会把摘要追加到对应助手正文末尾，然后重新扫描登记。',
            conflicts.length ? `${conflicts.length} 个有冲突的草稿会保留，不会被自动应用。` : '所有缺失摘要草稿都会被应用。',
        ],
    );
    if (!confirmed) {
        return;
    }

    const toast = toastr.info(`正在批量应用 ${ready.length} 个缺失摘要...`, '剧情剪辑台', { timeOut: 0, extendedTimeOut: 0 });
    const appliedDraftIds = new Set();
    let applied = 0;
    const createdAt = new Date().toISOString();
    try {
        for (const draft of ready) {
            const targetMessageId = Number(draft.metadata.targetMessageId);
            const message = chat[targetMessageId];
            const content = normalizeGeneratedBakemono(draft.content);
            const original = String(message.mes || '').trimEnd();
            updateChatMessageText(message, `${original}\n\n${content}`);
            appliedDraftIds.add(draft.id);
            applied += 1;
            state.history.unshift({
                id: `append-missing-${getHash(`${draft.id}|${createdAt}`)}`,
                kind: draft.kind,
                summaryHash: getHash(content),
                draft,
                summary: {
                    hash: getHash(content),
                    type: draft.kind,
                    title: draft.title || getBlockTitle(content, '补写摘要'),
                    content,
                    sourceHashes: draft.sourceHashes || [],
                    sourceMessageIds: [targetMessageId],
                    sourceKind: 'missing_summary',
                    metadata: draft.metadata || {},
                    createdAt,
                    draftId: draft.id,
                },
                action: 'append_missing_summary',
                createdAt,
            });
        }
        state.drafts = state.drafts.filter(draft => !appliedDraftIds.has(draft.id));
        scanBakemonoBlocks({ persist: false });
        updateInjectionFromSummaries();
        saveState();
        await saveChatConditional();
    } finally {
        toastr.clear(toast);
    }
    renderAll(`已补写 ${applied} 个缺失摘要。${conflicts.length ? `保留 ${conflicts.length} 个冲突草稿。` : ''}`);
    toastr.success(`已补写 ${applied} 个缺失摘要。`);
}

function removeMissingSummaryDraftsAndTasks() {
    const state = ensureState();
    const draftCount = state.drafts.filter(draft => draft.metadata?.appendMode === 'missing_summary').length;
    const removableTaskStatuses = new Set(['queued', 'failed', 'done']);
    const taskCount = state.taskQueue.filter(task => isMissingSummaryTask(task) && removableTaskStatuses.has(task.status)).length;
    if (!draftCount && !taskCount) {
        toastr.info('没有可移除的缺失摘要草稿或批次任务。');
        return;
    }
    const confirmed = confirmDanger(
        `移除 ${draftCount} 个缺失摘要草稿和 ${taskCount} 个批次任务？`,
        [
            '这只会清理插件里的待确认内容和未运行/失败/完成的补写任务。',
            '已经追加进正文的摘要不会被删除。',
            '正在运行中的任务会保留，避免队列状态损坏。',
        ],
    );
    if (!confirmed) {
        return;
    }
    state.drafts = state.drafts.filter(draft => draft.metadata?.appendMode !== 'missing_summary');
    state.taskQueue = state.taskQueue.filter(task => !(isMissingSummaryTask(task) && removableTaskStatuses.has(task.status)));
    saveState();
    renderAll(`已移除 ${draftCount} 个缺失摘要草稿和 ${taskCount} 个批次任务。`);
    toastr.success('缺失摘要待处理内容已移除。');
}

function clearStuckQueueTasks(predicate = () => true, label = '任务') {
    const state = ensureState();
    const stuckTasks = state.taskQueue.filter(task => task.status === 'running' && predicate(task));
    if (!stuckTasks.length) {
        toastr.info(`没有卡住的${label}。`);
        return;
    }
    const confirmed = confirmDanger(
        `解除 ${stuckTasks.length} 个生成中的${label}？`,
        [
            '这只会清理显示“生成中”的队列项，不会删除已经生成的草稿或保存记录。',
            '如果旧请求稍后返回，插件会忽略它，不再写入草稿。',
            '解除后，后面的等待任务会继续排队处理。',
        ],
    );
    if (!confirmed) {
        return;
    }
    stuckTasks.forEach(task => cancelledQueueTaskIds.add(task.id));
    const stuckTaskIds = new Set(stuckTasks.map(task => task.id));
    state.taskQueue = state.taskQueue.filter(task => !stuckTaskIds.has(task.id));
    isQueueRunning = false;
    setBusy(false);
    saveState();
    renderAll(`已解除 ${stuckTasks.length} 个卡住的${label}。`);
    toastr.success('已解除卡住任务，队列可以继续。');
    processTaskQueue();
}

function clearStuckMissingSummaryTasks() {
    clearStuckQueueTasks(isMissingSummaryTask, '缺失摘要任务');
}

function isMissingSummaryTask(task) {
    return task?.trigger === 'missing_summary_batch'
        || task?.trigger === 'missing_summary'
        || task?.metadata?.appendMode === 'missing_summary'
        || task?.metadata?.appendMode === 'missing_summary_batch';
}

async function commitDraft(draftId, editedContent = null, options = {}) {
    const state = ensureState();
    const draftIndex = state.drafts.findIndex(draft => draft.id === draftId);
    if (draftIndex < 0) {
        toastr.warning('没有找到这个草稿。');
        return;
    }

    const draft = state.drafts[draftIndex];
    if (draft.metadata?.appendMode === 'missing_summary') {
        return commitMissingSummaryDraft(draftIndex, editedContent, options);
    }

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
        level: draft.kind === blockTypes.EPIC ? getSummaryLevel(draft) : getSummaryLevel({ ...draft, type: draft.kind }),
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
        level: summary.level,
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
    if (!options.skipInjection) {
        updateInjectionFromSummaries();
    }
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
    }, '草稿已重新生成');
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

function recordAutoSummaryTransaction({ task, summary, hiddenMessageIds = [], preserveRecent = 0 }) {
    if (!summary?.hash) {
        return null;
    }
    const state = ensureState();
    const sourceMessageIds = unique(getFiniteMessageIds([
        ...(task?.sourceMessageIds || []),
        ...(summary.sourceMessageIds || []),
    ]));
    const transaction = {
        id: `auto-summary-${getHash(`${summary.hash}|${Date.now()}`)}`,
        kind: summary.type || task?.kind || blockTypes.STAGE,
        summaryHash: summary.hash,
        summaryTitle: summary.title || getBlockTitle(summary.content, '自动阶段总结'),
        sourceMessageIds,
        sourceStart: getSourceStart(sourceMessageIds),
        sourceEnd: getSourceEnd(sourceMessageIds),
        coveredBlockHashes: summary.type === blockTypes.EPIC ? [] : (summary.sourceHashes || task?.sourceHashes || []),
        coveredStageHashes: summary.type === blockTypes.EPIC ? (summary.sourceStageHashes || task?.sourceStageHashes || []) : [],
        hiddenMessageIds: unique(getFiniteMessageIds(hiddenMessageIds)),
        preserveRecent,
        taskId: task?.id || '',
        status: 'active',
        reason: '',
        createdAt: new Date().toISOString(),
        invalidatedAt: '',
        invalidatedMessageIds: [],
    };
    state.autoSummaryTransactions.unshift(transaction);
    state.autoSummaryTransactions = state.autoSummaryTransactions.slice(0, 50);
    saveState();
    return transaction;
}

function transactionTouchesMessage(transaction, messageIds = []) {
    const ids = getFiniteMessageIds(messageIds);
    if (!ids.length || !transaction) {
        return false;
    }
    const sourceIds = new Set(getFiniteMessageIds(transaction.sourceMessageIds || []));
    const sourceStart = Number(transaction.sourceStart);
    const sourceEnd = Number(transaction.sourceEnd);
    return ids.some(id => sourceIds.has(id) || (
        Number.isFinite(sourceStart)
        && Number.isFinite(sourceEnd)
        && id >= sourceStart
        && id <= sourceEnd
    ));
}

function markAffectedAutoSummaryTransactions(messageIds = [], reason = '消息变更') {
    const state = ensureState();
    const ids = getFiniteMessageIds(messageIds);
    if (!ids.length || !Array.isArray(state.autoSummaryTransactions)) {
        return [];
    }
    const affected = [];
    for (const transaction of state.autoSummaryTransactions) {
        if (transaction.status === 'rolled_back' || !transactionTouchesMessage(transaction, ids)) {
            continue;
        }
        transaction.status = 'needs_review';
        transaction.reason = reason;
        transaction.invalidatedAt = new Date().toISOString();
        transaction.invalidatedMessageIds = unique([...(transaction.invalidatedMessageIds || []), ...ids]);
        affected.push(transaction);
    }
    if (affected.length) {
        saveState();
        toastr.warning(`检测到 ${affected.length} 条自动总结覆盖的楼层被改动，可在“待确认”的自动总结回滚里处理。`, '剧情剪辑台');
    }
    return affected;
}

async function rollbackAutoSummaryTransaction(transactionId) {
    const state = ensureState();
    const transaction = state.autoSummaryTransactions.find(item => item.id === transactionId);
    if (!transaction) {
        toastr.warning('没有找到这条自动总结事务。');
        return;
    }
    const saved = findSavedSummaryByHash(transaction.summaryHash);
    const dependents = saved ? getSummaryDependents(saved.kind, transaction.summaryHash) : [];
    if (dependents.length) {
        toastr.warning('这条总结已经被上层总结引用，请先删除上层总结后再回滚。');
        return;
    }
    const hiddenIds = unique(getFiniteMessageIds(transaction.hiddenMessageIds || []).filter(id => chat[id]));
    const confirmed = confirmDanger(
        `回滚自动总结「${transaction.summaryTitle || transaction.summaryHash}」？`,
        [
            saved ? '会移除这条自动保存的阶段总结，并同步更新长期记忆。' : '这条总结已不存在，本次只会处理隐藏楼层记录。',
            hiddenIds.length ? `会恢复这次自动总结新隐藏的 ${hiddenIds.length} 楼。` : '没有可恢复的隐藏楼层。',
            '不会恢复更早之前已经隐藏的楼层。',
        ],
    );
    if (!confirmed) {
        return;
    }

    if (saved) {
        removeSummaryByHash(saved.kind, transaction.summaryHash);
        state.blocks = state.blocks.filter(block => block.hash !== transaction.summaryHash);
        state.coveredBlockHashes = state.coveredBlockHashes.filter(hash => !(transaction.coveredBlockHashes || []).includes(hash));
        state.coveredStageHashes = state.coveredStageHashes.filter(hash => !(transaction.coveredStageHashes || []).includes(hash));
        state.history = state.history.filter(item => item.summaryHash !== transaction.summaryHash);
    }

    for (const messageId of hiddenIds) {
        await hideChatMessageRange(messageId, messageId, true);
    }
    if (hiddenIds.length) {
        state.hiddenMessageIds = state.hiddenMessageIds.filter(id => !hiddenIds.includes(id));
        await saveChatConditional();
    }

    transaction.status = 'rolled_back';
    transaction.rolledBackAt = new Date().toISOString();
    state.autoSummaryTransactions = state.autoSummaryTransactions.filter(item => item.status !== 'rolled_back');
    updateInjectionFromSummaries();
    markVectorIndexDirty('自动总结已回滚', state);
    saveState();
    renderAll(`已回滚自动总结，恢复 ${hiddenIds.length} 楼。`);
    toastr.success('自动总结已回滚。');
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
    const nextTitle = String(title || found.summary.title || '').trim() || found.summary.title;
    found.summary.title = nextTitle;
    found.summary.metadata = {
        ...(found.summary.metadata || {}),
        userTitle: nextTitle,
        userTitleUpdatedAt: new Date().toISOString(),
    };
    found.summary.content = normalizeGeneratedBakemono(content || found.summary.content || '');
    const block = ensureState().blocks.find(item => item.hash === hash);
    if (block) {
        block.title = found.summary.title;
        block.content = found.summary.content;
        block.metadata = {
            ...(block.metadata || {}),
            userTitle: nextTitle,
        };
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
    const summaryHashes = new Set([
        ...state.stageSummaries.map(summary => summary.hash),
        ...state.epicSummaries.map(summary => summary.hash),
    ]);
    state.coveredStageHashes = unique(state.epicSummaries.flatMap(summary => [
        ...(summary.sourceStageHashes || []),
        ...(summary.sourceHashes || []).filter(hash => summaryHashes.has(hash)),
    ]));
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

function stripPostProcessNoise(text) {
    return String(text || '')
        .replace(/<tableThink>[\s\S]*?<\/tableThink>/gi, '')
        .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .trim();
}

function findLatestAssistantTurn() {
    const sourceChat = getContext().chat || chat || [];
    for (let index = sourceChat.length - 1; index >= 0; index--) {
        const message = sourceChat[index];
        if (!message || message.is_user || message.is_system || !String(message.mes || '').trim()) {
            continue;
        }
        const sourceMessageIds = [index];
        let userMessage = null;
        for (let userIndex = index - 1; userIndex >= 0; userIndex--) {
            const candidate = sourceChat[userIndex];
            if (!candidate) {
                continue;
            }
            if (candidate.is_user) {
                userMessage = { ...candidate, messageId: userIndex };
                sourceMessageIds.unshift(userIndex);
                break;
            }
            if (!candidate.is_system) {
                break;
            }
        }
        return {
            assistantMessage: { ...message, messageId: index },
            userMessage,
            sourceMessageIds,
        };
    }
    return null;
}

function buildLatestTurnBlocks(state = ensureState()) {
    const turn = findLatestAssistantTurn();
    if (!turn) {
        return [];
    }
    const blocks = [];
    if (state.turnSummary.includeUserMessage !== false && turn.userMessage) {
        blocks.push({
            hash: getHash(`turn-user|${turn.userMessage.messageId}|${turn.userMessage.mes || ''}`),
            type: blockTypes.STORY,
            messageId: turn.userMessage.messageId,
            blockIndex: 0,
            title: `用户楼层 ${turn.userMessage.messageId}`,
            content: stripPostProcessNoise(turn.userMessage.mes || ''),
        });
    }
    blocks.push({
        hash: getHash(`turn-assistant|${turn.assistantMessage.messageId}|${turn.assistantMessage.mes || ''}`),
        type: blockTypes.STORY,
        messageId: turn.assistantMessage.messageId,
        blockIndex: 0,
        title: `正文楼层 ${turn.assistantMessage.messageId}`,
        content: stripPostProcessNoise(turn.assistantMessage.mes || ''),
    });
    return blocks.filter(block => block.content.trim());
}

function extractTaggedContent(text, tagName) {
    const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = String(text || '').match(pattern);
    return match ? match[1].trim() : '';
}

function extractAllTaggedBlocks(text, tagName) {
    const pattern = new RegExp(`<${tagName}[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi');
    return String(text || '').match(pattern) || [];
}

function stripTableEditTags(text) {
    return String(text || '')
        .replace(/<tableThink>[\s\S]*?<\/tableThink>/gi, '')
        .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
        .trim();
}

async function captureInlineGenerationFromLatestMessage() {
    const state = ensureState();
    if (!state.inlineGeneration?.summaryEnabled && !state.inlineGeneration?.tableEnabled) {
        return false;
    }
    const turn = findLatestAssistantTurn();
    if (!turn) {
        return false;
    }
    const message = chat[turn.assistantMessage.messageId];
    const text = String(message?.mes || '');
    if (!text.trim()) {
        return false;
    }
    const signature = getHash(`inline|${turn.assistantMessage.messageId}|${text}`);
    if (state.inlineGeneration.lastProcessedSignature === signature) {
        return false;
    }
    const sourceMessageIds = turn.sourceMessageIds || [turn.assistantMessage.messageId];
    let changedMessage = false;
    let capturedSomething = false;

    if (state.inlineGeneration.summaryEnabled) {
        for (const content of extractAllTaggedBlocks(text, 'bakemono')) {
            const draft = createDraft({
                kind: blockTypes.STORY,
                content: normalizeGeneratedBakemono(content),
                sourceHashes: [],
                sourceMessageIds,
                prompt: state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt,
                trigger: 'inline_summary',
                metadata: {
                    sourceKind: 'inline',
                    sourceRange: formatSourceRange(sourceMessageIds),
                    sourceSortKey: getSourceStart(sourceMessageIds),
                },
            });
            await commitDraft(draft.id, draft.content, { silent: true });
            capturedSomething = true;
        }
    }

    if (state.inlineGeneration.tableEnabled && /<tableEdit[\s>]/i.test(text)) {
        try {
            const existingHistories = getAppliedTableHistoriesForMessage(turn.assistantMessage.messageId, state);
            if (existingHistories.some(history => history.sourceSignature === signature)) {
                state.inlineGeneration.lastProcessedMessageId = turn.assistantMessage.messageId;
                state.inlineGeneration.lastProcessedSignature = signature;
                saveState();
                return capturedSomething;
            }
            if ((state.tableDatabase.editDrafts || []).some(draft => draft.sourceSignature === signature)) {
                state.inlineGeneration.lastProcessedMessageId = turn.assistantMessage.messageId;
                state.inlineGeneration.lastProcessedSignature = signature;
                saveState();
                return capturedSomething;
            }
            const latestHistory = existingHistories[0];
            if (latestHistory && latestHistory.sourceSignature !== signature) {
                rollbackLatestTableOperationForChangedMessages([turn.assistantMessage.messageId], state);
            }
            const blocks = buildLatestTurnBlocks(state);
            const draft = createTableEditDraft(text, blocks, state);
            if (draft) {
                draft.sourceSignature = signature;
            }
            if (draft && state.tableDatabase.autoApply) {
                const undoSnapshot = applyTableOperations(draft.operations, state, {
                    sourceMessageIds: draft.sourceMessageIds,
                    undoLabel: `随正文表格修改：${formatSourceRange(draft.sourceMessageIds || [])}`,
                });
                state.tableDatabase.history.unshift({ ...draft, appliedAt: new Date().toISOString(), undoSnapshotId: undoSnapshot?.id || '', sourceSignature: signature });
                state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draft.id);
                toastr.success(`已自动应用 ${draft.operations.length} 项随正文表格修改。`);
            } else if (draft) {
                toastr.info(`已捕获 ${draft.operations.length} 项随正文表格修改，请到草稿确认。`);
            }
            capturedSomething = capturedSomething || !!draft;
            if (state.inlineGeneration.hideTableEdit !== false && message) {
                message.mes = stripTableEditTags(message.mes || '');
                changedMessage = true;
            }
        } catch (error) {
            toastr.warning(`随正文表格修改解析失败：${error?.message || error}`);
        }
    }

    state.inlineGeneration.lastProcessedMessageId = turn.assistantMessage.messageId;
    state.inlineGeneration.lastProcessedSignature = signature;
    saveState();
    updateInjectionFromSummaries();
    if (changedMessage) {
        await saveChatConditional();
    }
    if (capturedSomething) {
        scheduleRenderAll();
    }
    return capturedSomething;
}

function scheduleInlineGenerationCapture(reason = '') {
    clearTimeout(inlineCaptureTimer);
    inlineCaptureTimer = setTimeout(async () => {
        try {
            const captured = await captureInlineGenerationFromLatestMessage();
            if (!captured) {
                return;
            }
            syncInjection();
            if (reason) {
                renderAll(`已复查随正文输出：${reason}`);
            } else {
                renderAll();
            }
        } catch (error) {
            console.warn('[BakemonoMemory] delayed inline capture failed', error);
        }
    }, 1200);
}

function buildTurnSummaryPrompt(blocks, state = ensureState()) {
    const sourceIds = getSourceMessageIdsFromBlocks(blocks);
    return renderGenerationPrompt(state.turnSummary.prompt || defaultTurnSummaryPrompt, blocks, {
        sourceRange: formatSourceRange(sourceIds),
        suggestedTitle: `正文摘要 ${state.storySummaries.length + state.drafts.filter(draft => draft.kind === blockTypes.STORY).length + 1}`,
    });
}

function getCurrentCharacterForReference() {
    const context = getContext();
    return context.characters?.[context.characterId] || null;
}

function getCharacterReferenceContext() {
    const context = getContext();
    const character = getCurrentCharacterForReference();
    if (!character) {
        return '';
    }
    const data = character.data || {};
    const fields = [
        ['角色名', character.name || data.name],
        ['角色描述', character.description || data.description],
        ['性格', character.personality || data.personality],
        ['场景', character.scenario || data.scenario],
        ['创作者备注', character.creator_notes || data.creator_notes],
        ['系统提示', chat_metadata.system_prompt || data.system_prompt],
        ['用户人设', context.powerUserSettings?.persona_description],
    ];
    return fields
        .map(([label, value]) => String(value || '').trim() ? `【${label}】\n${String(value).trim()}` : '')
        .filter(Boolean)
        .join('\n\n');
}

function buildWorldInfoScanMessages(blocks = []) {
    const sourceIds = new Set(getSourceMessageIdsFromBlocks(blocks));
    const context = getContext();
    const sourceChat = context.chat || chat || [];
    const recentStart = Math.max(0, sourceChat.length - 12);
    return sourceChat
        .map((message, messageId) => ({ message, messageId }))
        .filter(({ message }) => message?.mes && !message.is_system)
        .filter(({ messageId }) => sourceIds.has(messageId) || messageId >= recentStart)
        .map(({ message, messageId }) => `${message.is_user ? context.name1 || '用户' : context.name2 || '助手'} #${messageId}: ${stripHtml(message.mes || '')}`)
        .reverse();
}

function getWorldInfoGlobalScanData() {
    const context = getContext();
    const character = getCurrentCharacterForReference();
    const data = character?.data || {};
    return {
        trigger: 'quiet',
        personaDescription: String(context.powerUserSettings?.persona_description || ''),
        characterDescription: String(character?.description || data.description || ''),
        characterPersonality: String(character?.personality || data.personality || ''),
        characterDepthPrompt: String(data.extensions?.depth_prompt?.prompt || data.character_depth_prompt || ''),
        scenario: String(character?.scenario || data.scenario || ''),
        creatorNotes: String(character?.creator_notes || data.creator_notes || ''),
    };
}

async function getWorldInfoReferenceContext(blocks = [], state = ensureState()) {
    if (!state.turnSummary.includeWorldInfo) {
        return '';
    }
    const context = getContext();
    if (typeof context.getWorldInfoPrompt !== 'function') {
        return '';
    }
    try {
        const result = await context.getWorldInfoPrompt(
            buildWorldInfoScanMessages(blocks),
            Math.max(1024, Number(state.turnSummary.worldInfoMaxContext || 4096)),
            true,
            getWorldInfoGlobalScanData(),
        );
        return String(result?.worldInfoString || '').trim();
    } catch (error) {
        console.warn('[BakemonoMemory] failed to read world info for turn summary', error);
        toastr.warning(`世界书参考读取失败：${error?.message || error}`);
        return '';
    }
}

async function buildTurnReferenceSystemPrompt(blocks, purpose = 'summary', state = ensureState()) {
    const sections = [];
    if (state.turnSummary.includeCharacterContext !== false) {
        const characterContext = getCharacterReferenceContext();
        if (characterContext) {
            sections.push(`## 角色卡/人设参考\n${characterContext}`);
        }
    }
    const worldInfo = await getWorldInfoReferenceContext(blocks, state);
    if (worldInfo) {
        sections.push(`## 世界书命中参考\n${worldInfo}`);
    }
    const manual = String(state.turnSummary.referenceContext || '').trim();
    if (manual) {
        sections.push(`## 用户手动参考资料\n${manual}`);
    }
    const base = purpose === 'table'
        ? '你是剧情剪辑台的表格整理助手。只输出 tableThink 和 tableEdit，不写正文。'
        : '你是剧情剪辑台的正文摘要器。只总结输入正文，不续写剧情。输出必须包含 summaryDraft 标签。';
    return sections.length
        ? `${base}\n\n以下是摘要/填表时必须参考的人设与世界观资料。它们只用于理解正文，不代表本轮新发生事件；不要把参考资料当成本轮剧情直接写入。\n\n${sections.join('\n\n')}`
        : base;
}

function normalizeTableText(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').replace(/"/g, '').replace(/,/g, ' / ').trim();
}

function normalizeImportedTablesFromJson(raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed?.tables)) {
        return parsed.tables.map((table, index) => ({
            ...toTableSchema(table, index),
            rows: Array.isArray(table.rows) ? table.rows.map(row => Array.isArray(row) ? row.map(cell => String(cell ?? '')) : []) : [],
        }));
    }
    if (Array.isArray(parsed?.tableStructure)) {
        return parsed.tableStructure.map((table, index) => toTableSchema({
            id: `table-${getHash(`${table.tableIndex ?? index}|${table.tableName || table.name || index}`)}`,
            tableIndex: Number.isFinite(Number(table.tableIndex)) ? Number(table.tableIndex) : index,
            name: String(table.tableName || table.name || `表格 ${index}`),
            columns: Array.isArray(table.columns) ? table.columns.map(col => String(col || '')) : [],
            columnPrompts: Array.isArray(table.columnPrompts) ? table.columnPrompts.map(text => String(text || '')) : [],
            note: String(table.note || ''),
            initNode: String(table.initNode || ''),
            insertNode: String(table.insertNode || ''),
            updateNode: String(table.updateNode || ''),
            deleteNode: String(table.deleteNode || ''),
            rows: [],
            required: !!table.Required || !!table.required,
        }, index));
    }

    const sheets = Object.values(parsed || {})
        .filter(item => item && typeof item === 'object' && item.name && Array.isArray(item.content))
        .sort((a, b) => (Number(a.orderNo ?? 999) - Number(b.orderNo ?? 999)) || String(a.name).localeCompare(String(b.name)));
    return sheets.map((sheet, index) => {
        const header = Array.isArray(sheet.content?.[0]) ? sheet.content[0] : [];
        return {
            ...toTableSchema({
            id: sheet.uid || `sheet-${getHash(`${sheet.name}|${index}`)}`,
            tableIndex: index,
            name: String(sheet.name || `表格 ${index}`),
            columns: header.slice(1).map(col => String(col || '')),
            columnPrompts: header.slice(1).map(() => ''),
            note: String(sheet.sourceData?.note || ''),
            initNode: String(sheet.sourceData?.initNode || ''),
            insertNode: String(sheet.sourceData?.insertNode || ''),
            updateNode: String(sheet.sourceData?.updateNode || ''),
            deleteNode: String(sheet.sourceData?.deleteNode || ''),
            }, index),
            rows: (sheet.content || []).slice(1).filter(Array.isArray).map(row => row.slice(1).map(cell => String(cell ?? ''))),
        };
    });
}

function formatTableGuideForPrompt(state = ensureState()) {
    const tables = state.tableDatabase.tables || [];
    if (!tables.length) {
        return '暂无表格结构。';
    }
    return tables.map(table => [
        `${table.tableIndex}: ${table.name} (${table.columns.map((col, index) => `${index}:${col}`).join(', ')})`,
        `权限：${table.readOnly ? '只读' : '可写'} / ${table.allowAiEdit === false || table.readOnly ? '禁止 AI 修改' : '允许 AI 修改'}`,
        table.columnPrompts?.some(Boolean)
            ? `columns:\n${table.columns.map((col, index) => `${index}:${col}${table.columnPrompts?.[index] ? ` -> ${table.columnPrompts[index]}` : ''}`).join('\n')}`
            : '',
        table.note ? `note: ${table.note}` : '',
        table.insertNode ? `insert: ${table.insertNode}` : '',
        table.updateNode ? `update: ${table.updateNode}` : '',
        table.deleteNode ? `delete: ${table.deleteNode}` : '',
    ].filter(Boolean).join('\n')).join('\n\n');
}

function getWritableTables(state = ensureState()) {
    return (state.tableDatabase.tables || []).filter(table => !table.readOnly && table.allowAiEdit !== false);
}

function getReadonlyTables(state = ensureState()) {
    return (state.tableDatabase.tables || []).filter(table => table.readOnly || table.allowAiEdit === false);
}

function formatTableDataForPrompt(state = ensureState()) {
    const tables = state.tableDatabase.tables || [];
    if (!tables.length) {
        return '暂无表格数据。';
    }
    return tables.map(table => {
        const header = `## ${table.tableIndex}: ${table.name}\nColumns: ${table.columns.map((col, index) => `${index}:${col}`).join(' | ')}`;
        const rows = table.rows?.length
            ? table.rows.map((row, rowIndex) => `row ${rowIndex}: ${row.map((cell, colIndex) => `${colIndex}:${cell}`).join(' | ')}`).join('\n')
            : '(无数据行)';
        return `${header}\n${rows}`;
    }).join('\n\n');
}

function formatSpecificTablesForPrompt(tables = [], options = {}) {
    if (!tables.length) {
        return '无。';
    }
    const includeRows = options.includeRows !== false;
    return tables.map(table => {
        const header = `## ${table.tableIndex}: ${table.name}\nColumns: ${table.columns.map((col, index) => `${index}:${col}`).join(' | ')}`;
        const rows = includeRows
            ? (table.rows?.length
                ? table.rows.map((row, rowIndex) => `row ${rowIndex}: ${row.map((cell, colIndex) => `${colIndex}:${cell}`).join(' | ')}`).join('\n')
                : '(无数据行)')
            : 'Rows: 已省略；表格内容请读取长期上下文里的“表格记忆”。';
        return `${header}\n${rows}`;
    }).join('\n\n');
}

function renderInjectedTablesSection(state = ensureState()) {
    const tables = state.tableDatabase.tables || [];
    if (state.tableDatabase.injectMemory === false || !tables.length) {
        return '';
    }
    const sections = [];
    for (const table of tables) {
        const limit = Math.max(120, Number(table.injectLimit || 1200));
        const rows = Array.isArray(table.rows) ? table.rows : [];
        const lines = [
            `### ${table.tableIndex}: ${table.name}${table.readOnly ? '（只读）' : ''}`,
            table.note ? `规则：${table.note}` : '',
            `字段：${table.columns.map((col, index) => `${index}:${col}`).join(' | ')}`,
        ].filter(Boolean);
        if (rows.length) {
            for (const [rowIndex, row] of rows.entries()) {
                lines.push(`row ${rowIndex}: ${table.columns.map((col, colIndex) => `${col}:${row?.[colIndex] ?? ''}`).join(' | ')}`);
            }
        } else {
            lines.push('(暂无数据行)');
        }
        let text = lines.join('\n');
        if (text.length > limit) {
            text = `${text.slice(0, limit)}\n...（已按表格记忆安全上限裁剪）`;
        }
        sections.push(text);
    }
    return sections.length ? `## 表格记忆\n${sections.join('\n\n')}` : '';
}

function buildTableEditPrompt(blocks, state = ensureState()) {
    const blockText = formatBlocksForPrompt(blocks, {
        sourceRange: formatSourceRange(getSourceMessageIdsFromBlocks(blocks)),
    });
    const template = String(state.turnSummary.tablePrompt || defaultTableEditPrompt);
    return template
        .replaceAll('{{blocks}}', blockText)
        .replaceAll('{{tableData}}', formatTableDataForPrompt(state))
        .replaceAll('{{tableGuide}}', formatTableGuideForPrompt(state))
        .replaceAll('{{readonlyTables}}', formatSpecificTablesForPrompt(getReadonlyTables(state)))
        .replaceAll('{{writableTables}}', formatSpecificTablesForPrompt(getWritableTables(state)));
}

function getTableSchemasForPreset(state = ensureState()) {
    return (state.tableDatabase.tables || []).map(table => ({
        id: table.id || `table-${getHash(`${table.name || table.tableIndex}`)}`,
        tableIndex: Number.isFinite(Number(table.tableIndex)) ? Number(table.tableIndex) : 0,
        name: String(table.name || '未命名表格'),
        columns: Array.isArray(table.columns) ? table.columns.map(col => String(col || '')) : [],
        columnPrompts: Array.isArray(table.columnPrompts) ? table.columnPrompts.map(text => String(text || '')) : [],
        note: String(table.note || ''),
        initNode: String(table.initNode || ''),
        insertNode: String(table.insertNode || ''),
        updateNode: String(table.updateNode || ''),
        deleteNode: String(table.deleteNode || ''),
        required: !!table.required,
        rows: [],
    }));
}

function getNextTableIndex(state = ensureState()) {
    const indexes = (state.tableDatabase.tables || []).map(table => Number(table.tableIndex)).filter(Number.isFinite);
    return indexes.length ? Math.max(...indexes) + 1 : 0;
}

function stripHtmlCommentShell(value) {
    return String(value || '').replace(/<!--/g, '').replace(/-->/g, '').trim();
}

function parseTableObjectLiteral(value) {
    const cleaned = stripHtmlCommentShell(value)
        .replace(/([{,]\s*)(\d+)\s*:/g, '$1"$2":')
        .replace(/"\s+(?="\d+"\s*:)/g, '", ');
    try {
        return JSON.parse(cleaned);
    } catch (error) {
        const fallback = cleaned
            .replace(/([{,]\s*)'([^'"]+)'\s*:/g, '$1"$2":')
            .replace(/:\s*'([^']*)'/g, (_, inner) => `:${JSON.stringify(inner)}`);
        return JSON.parse(fallback);
    }
}

function parseTableEditOperations(raw) {
    const text = stripHtmlCommentShell(extractTaggedContent(raw, 'tableEdit') || raw);
    const operations = [];
    const insertRe = /insertRow\s*\(\s*(\d+)\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    const updateRe = /updateRow\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    const deleteRe = /deleteRow\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
    let match;
    while ((match = insertRe.exec(text))) {
        operations.push({ op: 'insert', tableIndex: Number(match[1]), data: parseTableObjectLiteral(match[2]) });
    }
    while ((match = updateRe.exec(text))) {
        operations.push({ op: 'update', tableIndex: Number(match[1]), rowIndex: Number(match[2]), data: parseTableObjectLiteral(match[3]) });
    }
    while ((match = deleteRe.exec(text))) {
        operations.push({ op: 'delete', tableIndex: Number(match[1]), rowIndex: Number(match[2]) });
    }
    return operations;
}

function createTableEditDraft(raw, blocks, state = ensureState()) {
    const operations = parseTableEditOperations(raw);
    if (!operations.length) {
        return null;
    }
    const now = new Date().toISOString();
    const draft = {
        id: `table-draft-${getHash(`${now}|${raw}`)}`,
        raw,
        operations,
        sourceMessageIds: getSourceMessageIdsFromBlocks(blocks),
        createdAt: now,
    };
    state.tableDatabase.editDrafts.unshift(draft);
    return draft;
}

function applyTableOperations(operations = [], state = ensureState(), options = {}) {
    const sourceMessageIds = getFiniteMessageIds(options.sourceMessageIds || []);
    let snapshot = null;
    if (options.recordUndo !== false && operations.length) {
        snapshot = pushTableUndoSnapshot(options.undoLabel || `AI 表格修改 ${operations.length} 项`, state, { sourceMessageIds });
    }
    const tablesByIndex = new Map((state.tableDatabase.tables || []).map(table => [Number(table.tableIndex), table]));
    const deletes = [];
    for (const operation of operations) {
        const table = tablesByIndex.get(Number(operation.tableIndex));
        if (!table) {
            throw new Error(`表格 ${operation.tableIndex} 不存在。`);
        }
        if (table.readOnly || table.allowAiEdit === false) {
            throw new Error(`表格 ${operation.tableIndex}「${table.name || ''}」是只读或禁止 AI 修改，已拒绝本次操作。`);
        }
        table.rows = Array.isArray(table.rows) ? table.rows : [];
        if (operation.op === 'insert') {
            const row = table.columns.map((_, index) => normalizeTableText(operation.data?.[String(index)] ?? operation.data?.[index] ?? ''));
            table.rows.push(row);
        } else if (operation.op === 'update') {
            const row = table.rows[operation.rowIndex];
            if (!row) {
                throw new Error(`表格 ${operation.tableIndex} 的 row ${operation.rowIndex} 不存在。`);
            }
            for (const [key, value] of Object.entries(operation.data || {})) {
                const colIndex = Number(key);
                if (Number.isFinite(colIndex) && colIndex >= 0 && colIndex < table.columns.length) {
                    row[colIndex] = normalizeTableText(value);
                }
            }
        } else if (operation.op === 'delete') {
            deletes.push({ table, rowIndex: operation.rowIndex });
        }
    }
    deletes.sort((a, b) => b.rowIndex - a.rowIndex).forEach(({ table, rowIndex }) => {
        if (table.rows[rowIndex]) {
            table.rows.splice(rowIndex, 1);
        }
    });
    saveCurrentTableProfileRows(state);
    updateInjectionFromSummaries();
    if (sourceMessageIds.length) {
        state.tableDatabase.lastAppliedSourceMessageIds = sourceMessageIds;
    }
    return snapshot;
}

async function processLatestTurnSummary(options = {}) {
    const state = ensureState();
    const mode = state.turnSummary.processingMode || turnProcessingModes.BOTH;
    const shouldGenerateSummary = mode !== turnProcessingModes.TABLE;
    const shouldGenerateTable = mode !== turnProcessingModes.SUMMARY && state.tableDatabase.enabled && state.tableDatabase.tables.length;
    if (!shouldGenerateSummary && shouldGenerateTable) {
        await processLatestTableEdit(options);
        return;
    }
    if (!shouldGenerateSummary || (!state.turnSummary.enabled && !options.manual)) {
        return;
    }
    const turn = findLatestAssistantTurn();
    if (!turn) {
        toastr.info('没有找到可处理的最新正文。');
        return;
    }
    if (!options.manual && state.turnSummary.lastProcessedMessageId === turn.assistantMessage.messageId) {
        return;
    }
    if (!options.manual && hasAppliedTableEditForMessage(turn.assistantMessage.messageId, state)) {
        state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
        saveState();
        renderAll('本楼已经通过随正文表格修改应用过表格内容，已跳过回复后填表。');
        return;
    }
    const blocks = buildLatestTurnBlocks(state);
    if (!blocks.length) {
        toastr.info('最新正文为空，无法摘要。');
        return;
    }

    await runGeneration(options.manual ? '正在处理最新正文...' : '正在自动生成正文摘要草稿...', async () => {
        const summaryResult = await callGenerationModel({
            prompt: buildTurnSummaryPrompt(blocks, state),
            systemPrompt: await buildTurnReferenceSystemPrompt(blocks, 'summary', state),
        });
        const summaryContent = normalizeGeneratedBakemono(extractTaggedContent(summaryResult, 'summaryDraft') || summaryResult);
        const summaryDraft = createDraft({
            kind: blockTypes.STORY,
            content: summaryContent,
            sourceHashes: [],
            sourceMessageIds: getSourceMessageIdsFromBlocks(blocks),
            prompt: buildTurnSummaryPrompt(blocks, state),
            trigger: options.manual ? 'turn_manual' : 'turn_auto',
            metadata: {
                sourceKind: 'turn',
                sourceRange: formatSourceRange(getSourceMessageIdsFromBlocks(blocks)),
                sourceSortKey: getSourceStart(getSourceMessageIdsFromBlocks(blocks)),
            },
        });
        if (state.turnSummary.saveMode === 'commit') {
            await commitDraft(summaryDraft.id, summaryDraft.content, { silent: true });
        }

        if (shouldGenerateTable && !hasAppliedTableEditForMessage(turn.assistantMessage.messageId, state)) {
            const tableResult = await callGenerationModel({
                prompt: buildTableEditPrompt(blocks, state),
                systemPrompt: await buildTurnReferenceSystemPrompt(blocks, 'table', state),
            });
            try {
                const draft = createTableEditDraft(tableResult, blocks, state);
                if (draft && state.tableDatabase.autoApply) {
                    const undoSnapshot = applyTableOperations(draft.operations, state, {
                        sourceMessageIds: draft.sourceMessageIds,
                        undoLabel: `回复后表格修改：${formatSourceRange(draft.sourceMessageIds || [])}`,
                    });
                    state.tableDatabase.history.unshift({ ...draft, appliedAt: new Date().toISOString(), undoSnapshotId: undoSnapshot?.id || '' });
                    state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draft.id);
                }
            } catch (error) {
                toastr.warning(`表格草稿解析失败：${error?.message || error}`);
            }
        }

        state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
        saveState();
        updateInjectionFromSummaries();
        const savedText = state.turnSummary.saveMode === 'commit' ? '已保存到长期记忆。' : '摘要进入草稿箱。';
        renderAll(options.manual ? `最新正文已处理，${savedText}` : `正文摘要已自动生成，${savedText}`);
    }, options.manual ? '最新正文已处理' : '正文摘要草稿已生成');
}

async function processLatestTableEdit(options = {}) {
    const state = ensureState();
    const turn = findLatestAssistantTurn();
    if (!turn) {
        toastr.info('没有找到可处理的最新正文。');
        return;
    }
    if (!options.manual && state.turnSummary.lastProcessedMessageId === turn.assistantMessage.messageId) {
        return;
    }
    const blocks = buildLatestTurnBlocks(state);
    if (!blocks.length) {
        toastr.info('没有找到可处理的最新正文。');
        return;
    }
    if (!state.tableDatabase.tables.length) {
        toastr.warning('还没有表格。请先创建或导入表格。');
        return;
    }

    await runGeneration(options.manual ? '正在单独生成表格修改草稿...' : '正在自动生成表格修改草稿...', async () => {
        const tableResult = await callGenerationModel({
            prompt: buildTableEditPrompt(blocks, state),
            systemPrompt: await buildTurnReferenceSystemPrompt(blocks, 'table', state),
        });
        const draft = createTableEditDraft(tableResult, blocks, state);
        if (!draft) {
            state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
            saveState();
            renderAll('本轮正文没有生成表格修改。');
            toastr.info('本轮正文没有需要修改的表格。');
            return;
        }
        if (state.tableDatabase.autoApply && !options.manual) {
            const undoSnapshot = applyTableOperations(draft.operations, state, {
                sourceMessageIds: draft.sourceMessageIds,
                undoLabel: `回复后表格修改：${formatSourceRange(draft.sourceMessageIds || [])}`,
            });
            state.tableDatabase.history.unshift({ ...draft, appliedAt: new Date().toISOString(), undoSnapshotId: undoSnapshot?.id || '' });
            state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draft.id);
            state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
            saveState();
            renderAll('表格修改已自动应用。');
            return;
        }
        state.turnSummary.lastProcessedMessageId = turn.assistantMessage.messageId;
        saveState();
        renderAll('表格修改草稿已生成，请确认后应用。');
        switchWorkbenchTab('tables');
    }, '表格修改草稿已生成');
}

function updateInjectionFromSummaries() {
    const state = ensureState();
    const { memory } = getInjectionMemoryParts(state);
    state.generatedMemory = memory;
    syncInjection();
}

function getInjectionMemoryParts(state = ensureState()) {
    const activeEpicBlocks = getActiveEpicMemoryBlocks(state);
    const epicContents = activeEpicBlocks.map(item => `## ${getMultiSummaryLabel(item)}\n${item.content}`);
    const epicCoveredStageHashes = getActiveCoveredStageHashes(state);
    const stageContents = getStageMemoryBlocks(state)
        .filter(item => !epicCoveredStageHashes.has(item.hash))
        .map(item => item.content);
    const shouldInjectStory = state.memoryStrategy === memoryStrategies.GENERIC;
    const storyContents = shouldInjectStory
        ? state.storySummaries
            .filter(item => !(state.coveredBlockHashes || []).includes(item.hash))
            .map(item => item.content)
        : [];

    const sections = [
        epicContents.length ? epicContents.join('\n\n') : '',
        stageContents.length ? '## 阶段总结\n' + stageContents.join('\n\n') : '',
        storyContents.length ? '## 普通剧情摘要\n' + storyContents.join('\n\n') : '',
        renderInjectedTablesSection(state),
        renderVectorMemorySection(state),
    ].filter(Boolean);

    return {
        memory: sections.join('\n\n').trim(),
        stats: {
            epic: epicContents.length,
            stage: stageContents.length,
            story: storyContents.length,
            table: state.tableDatabase.injectMemory === false ? 0 : (state.tableDatabase.tables || []).length,
            vector: state.vectorMemory?.lastHits?.length || 0,
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
    syncInlineGenerationPrompts(state);
}

function renderInlinePrompt(template, state = ensureState()) {
    const includeRows = true;
    const tableData = formatTableDataForPrompt(state);
    return String(template || '')
        .replaceAll('{{tableData}}', tableData)
        .replaceAll('{{tableGuide}}', formatTableGuideForPrompt(state))
        .replaceAll('{{readonlyTables}}', formatSpecificTablesForPrompt(getReadonlyTables(state), { includeRows }))
        .replaceAll('{{writableTables}}', formatSpecificTablesForPrompt(getWritableTables(state), { includeRows }));
}

function syncInlineGenerationPrompts(state = ensureState()) {
    const depth = Math.max(0, Number(state.inlineGeneration?.depth ?? 1));
    const role = Number(state.inlineGeneration?.role ?? extension_prompt_roles.SYSTEM);
    const summaryValue = state.inlineGeneration?.summaryEnabled
        ? renderInlinePrompt(state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt, state)
        : '';
    const tableValue = state.inlineGeneration?.tableEnabled
        ? renderInlinePrompt(state.inlineGeneration.tablePrompt || defaultInlineTablePrompt, state)
        : '';
    setExtensionPrompt(inlinePromptKeys.SUMMARY, summaryValue, extension_prompt_types.IN_CHAT, depth, false, role);
    setExtensionPrompt(inlinePromptKeys.TABLE, tableValue, extension_prompt_types.IN_CHAT, depth, false, role);
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

function getActualHiddenMessageIds() {
    const sourceChat = getContext()?.chat || chat || [];
    return sourceChat
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message?.is_system)
        .map(({ index }) => index);
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

function getVisibleMessageIds() {
    return (chat || [])
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message && !message.is_system)
        .map(({ index }) => index);
}

function getHideBeforeRecentIds(preserveRecent = 2) {
    const keep = Math.max(0, Number(preserveRecent || 0));
    const visibleIds = getVisibleMessageIds();
    if (!visibleIds.length) {
        return [];
    }
    const cutoffPosition = Math.max(0, visibleIds.length - keep);
    return visibleIds.slice(0, cutoffPosition);
}

function getAutoHideRecentPlan(preserveRecent = defaultState.autoHideRecent.preserveRecent, state = ensureState()) {
    const keep = Math.max(0, Number(preserveRecent || 0));
    const managedSet = new Set(getFiniteMessageIds(state.autoHideRecent?.managedMessageIds || []));
    const sourceChat = getContext()?.chat || chat || [];
    const sourceIds = sourceChat
        .map((message, index) => ({ message, index }))
        .filter(({ message, index }) => message?.mes && (!message.is_system || managedSet.has(index)))
        .map(({ index }) => index);
    const keepIds = keep > 0 ? sourceIds.slice(-keep) : [];
    const keepSet = new Set(keepIds);
    const hideIds = sourceIds.filter(id => !keepSet.has(id) && !sourceChat?.[id]?.is_system);
    const restoreIds = keepIds.filter(id => managedSet.has(id) && sourceChat?.[id]?.is_system);
    return { sourceIds, keepIds, hideIds, restoreIds };
}

function getAutoHideRecentPreviewText(preserveRecent = defaultState.autoHideRecent.preserveRecent, state = ensureState()) {
    const { sourceIds, keepIds, hideIds, restoreIds } = getAutoHideRecentPlan(preserveRecent, state);
    const keepText = keepIds.length ? `${keepIds[0]}-${keepIds.at(-1)}` : '无';
    return `当前可收纳正文 ${sourceIds.length} 楼；将保留最近 ${preserveRecent} 楼（${keepText}），隐藏 ${hideIds.length} 楼，恢复 ${restoreIds.length} 楼。`;
}

function readAutoHideRecentFieldsFromUi(state = ensureState()) {
    if (!$('#bakemono-memory-preserve-recent-input').length) {
        return state;
    }
    state.autoHideRecent.enabled = $('#bakemono-memory-auto-hide-enabled').prop('checked');
    const preserveValue = $('#bakemono-memory-preserve-recent-input').val();
    state.autoHideRecent.preserveRecent = Math.max(0, Number(preserveValue === '' ? defaultState.autoHideRecent.preserveRecent : preserveValue));
    return state;
}

function renderAutoHideRecentPanel(state = ensureState()) {
    $('#bakemono-memory-auto-hide-enabled').prop('checked', !!state.autoHideRecent.enabled);
    $('#bakemono-memory-preserve-recent-input').val(state.autoHideRecent.preserveRecent ?? defaultState.autoHideRecent.preserveRecent);
    $('#bakemono-memory-auto-hide-options').prop('hidden', !state.autoHideRecent.enabled);
    const managedCount = getFiniteMessageIds(state.autoHideRecent.managedMessageIds || []).length;
    const status = state.autoHideRecent.enabled
        ? `自动收纳已开启：保留最近 ${state.autoHideRecent.preserveRecent} 楼正文，已管理 ${managedCount} 楼。${state.autoHideRecent.lastRunAt ? `上次整理：${new Date(state.autoHideRecent.lastRunAt).toLocaleString()}` : ''}`
        : `自动收纳未开启。已管理 ${managedCount} 楼，可点击“恢复自动收纳楼层”恢复。`;
    $('#bakemono-memory-auto-hide-status').text(status);
}

function previewPreserveRecentMessages() {
    const preserve = Math.max(0, Number($('#bakemono-memory-preserve-recent-input').val() || 0));
    const previewText = getAutoHideRecentPreviewText(preserve);
    $('#bakemono-memory-range-preview').text(previewText);
    renderAll(previewText);
    return;
    const ids = getHideBeforeRecentIds(preserve);
    const text = ids.length
        ? `将隐藏较早的 ${ids.length} 楼正文，保留最近 ${preserve} 楼可见正文。范围约 ${ids[0]}-${ids.at(-1)}。`
        : `无需隐藏：当前可见正文不超过 ${preserve} 楼。`;
    $('#bakemono-memory-range-preview').text(text);
    renderAll(text);
}

async function applyAutoHideRecentBalance({ silent = false, confirm = false } = {}) {
    const state = ensureState();
    const preserve = Math.max(0, Number(state.autoHideRecent?.preserveRecent ?? defaultState.autoHideRecent.preserveRecent));
    const { hideIds, restoreIds } = getAutoHideRecentPlan(preserve, state);
    if (!hideIds.length && !restoreIds.length) {
        const text = getAutoHideRecentPreviewText(preserve, state);
        $('#bakemono-memory-range-preview').text(text);
        if (!silent) {
            renderAll(text);
            toastr.info(text);
        } else {
            renderAutoHideRecentPanel(state);
        }
        return;
    }
    if (confirm) {
        const confirmed = window.confirm([
            `自动收纳将保留最近 ${preserve} 楼正文。`,
            `本次会隐藏 ${hideIds.length} 楼，恢复 ${restoreIds.length} 楼。`,
            '',
            '确认继续吗？',
        ].join('\n'));
        if (!confirmed) {
            return;
        }
    }
    for (const id of restoreIds) {
        await hideChatMessageRange(id, id, true);
    }
    for (const id of hideIds) {
        await hideChatMessageRange(id, id, false);
    }
    state.hiddenMessageIds = unique([
        ...state.hiddenMessageIds.filter(id => !restoreIds.includes(id)),
        ...hideIds,
    ]);
    const sourceChat = getContext()?.chat || chat || [];
    const currentManaged = getFiniteMessageIds(state.autoHideRecent.managedMessageIds || [])
        .filter(id => sourceChat?.[id]?.mes && !restoreIds.includes(id));
    state.autoHideRecent.managedMessageIds = unique([...currentManaged, ...hideIds]);
    state.autoHideRecent.lastRunAt = new Date().toISOString();
    await saveChatConditional();
    saveState();
    scanBakemonoBlocks({ persist: false });
    const text = `自动收纳已整理：隐藏 ${hideIds.length} 楼，恢复 ${restoreIds.length} 楼，保留最近 ${preserve} 楼正文。`;
    $('#bakemono-memory-range-preview').text(text);
    if (!silent) {
        renderAll(text);
        toastr.success(text);
    } else {
        renderAutoHideRecentPanel(state);
    }
}

async function hideBeforeRecentMessages({ silent = false, fromAuto = false } = {}) {
    const state = ensureState();
    if (!fromAuto) {
        readAutoHideRecentFieldsFromUi(state);
    }
    if (fromAuto) {
        await applyAutoHideRecentBalance({ silent });
        return;
    }
    const fallbackPreserve = $('#bakemono-memory-preserve-recent-input').val();
    const preserve = Math.max(0, Number(state.autoHideRecent?.preserveRecent ?? fallbackPreserve ?? 0));
    const ids = getHideBeforeRecentIds(preserve);
    if (!ids.length) {
        const text = `无需隐藏：当前可见正文不超过 ${preserve} 楼。`;
        $('#bakemono-memory-range-preview').text(text);
        if (!silent) {
            toastr.info(text);
            renderAll(text);
        }
        return;
    }
    const coveredIds = getSummaryCoveredMessageIds();
    const uncovered = ids.filter(id => !coveredIds.has(id));
    const confirmed = fromAuto || window.confirm([
        `只保留最近 ${preserve} 楼正文？`,
        `将隐藏更早的 ${ids.length} 楼，范围约 ${ids[0]}-${ids.at(-1)}。`,
        uncovered.length ? `其中 ${uncovered.length} 楼没有已保存摘要覆盖，可能导致模型遗忘。` : '这些楼层已有摘要覆盖。',
        '',
        '确认继续吗？',
    ].join('\n'));
    if (!confirmed) {
        return;
    }
    for (const id of ids) {
        await hideChatMessageRange(id, id, false);
    }
    state.hiddenMessageIds = unique([...state.hiddenMessageIds, ...ids]);
    if (fromAuto) {
        state.autoHideRecent.managedMessageIds = unique([...(state.autoHideRecent.managedMessageIds || []), ...ids]);
        state.autoHideRecent.lastRunAt = new Date().toISOString();
    } else {
        state.customHiddenMessageIds = unique([...state.customHiddenMessageIds, ...ids]);
    }
    await saveChatConditional();
    saveState();
    scanBakemonoBlocks({ persist: false });
    const text = `已隐藏 ${ids.length} 楼，只保留最近 ${preserve} 楼正文。`;
    $('#bakemono-memory-range-preview').text(text);
    if (!silent) {
        renderAll(text);
        toastr.success(text);
    } else {
        renderAutoHideRecentPanel(state);
    }
}

async function applyAutoHideRecentSettings() {
    const state = ensureState();
    readAutoHideRecentFieldsFromUi(state);
    saveState();
    if (!state.autoHideRecent.enabled) {
        renderAll('自动收纳已关闭。');
        toastr.info('自动收纳已关闭。');
        return;
    }
    await hideBeforeRecentMessages({ fromAuto: true });
}

function scheduleAutoHideRecent(reason = 'auto') {
    const state = ensureState();
    if (!state.autoHideRecent?.enabled) {
        return;
    }
    clearTimeout(autoHideRecentTimer);
    autoHideRecentTimer = setTimeout(async () => {
        try {
            await hideBeforeRecentMessages({ silent: true, fromAuto: true, reason });
        } catch (error) {
            console.warn('[BakemonoMemory] auto hide recent failed', error);
            toastr.warning(`自动收纳失败：${error?.message || error}`);
        }
    }, 900);
}

async function restoreAutoHiddenMessages() {
    const state = ensureState();
    const ids = getFiniteMessageIds(state.autoHideRecent?.managedMessageIds || []);
    if (!ids.length) {
        toastr.info('没有由自动收纳隐藏的楼层。');
        return;
    }
    const confirmed = window.confirm([
        `恢复自动收纳隐藏的 ${ids.length} 楼？`,
        `范围约 ${ids[0]}-${ids.at(-1)}。`,
        '',
        '确认继续吗？',
    ].join('\n'));
    if (!confirmed) {
        return;
    }
    for (const id of ids) {
        await hideChatMessageRange(id, id, true);
    }
    state.hiddenMessageIds = state.hiddenMessageIds.filter(id => !ids.includes(id));
    state.autoHideRecent.enabled = false;
    state.autoHideRecent.managedMessageIds = [];
    state.autoHideRecent.lastRunAt = null;
    await saveChatConditional();
    saveState();
    scanBakemonoBlocks({ persist: false });
    const text = `已恢复自动收纳隐藏的 ${ids.length} 楼。`;
    $('#bakemono-memory-range-preview').text(text);
    renderAll(text);
    toastr.success(text);
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
        : '摘要块手账模式：普通摘要通常不注入，建议只隐藏已经被阶段总结覆盖的楼层。';
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
    return strategy === memoryStrategies.GENERIC ? '通用全文补课模式' : '摘要块手账模式';
}

function getWorkflowModeLabelLegacy(mode = ensureState().workflowMode) {
    if (mode === workflowModes.GENERIC) {
        return '通用插件补课';
    }
    if (mode === workflowModes.MIXED) {
        return '混合工作流';
    }
    return '摘要块手账';
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
            title: '补齐遗漏的旧剧情',
            actions: ['scan', 'backfill', 'generate-stage', 'generate-epic', 'undo'],
        };
    }
    if (mode === workflowModes.MIXED) {
        return {
            title: '按你的方式剪辑剧情',
            actions: ['scan', 'backfill', 'generate-stage', 'generate-epic', 'hide', 'restore', 'undo'],
        };
    }
    return {
        title: '整理本幕的新剧情',
        actions: ['scan', 'generate-stage', 'generate-epic', 'hide', 'restore', 'undo'],
    };
}

function applyWorkflowPreset(mode) {
    const state = ensureState();
    if (mode === workflowModes.MIXED) {
        state.workflowMode = workflowModes.MIXED;
        state.stageSourceMode = stageSourceModes.AUTO;
        state.outputMode = 'custom';
    } else if (mode === workflowModes.GENERIC) {
        state.workflowMode = workflowModes.GENERIC;
        state.memoryStrategy = memoryStrategies.GENERIC;
        state.stageSourceMode = stageSourceModes.BACKFILL;
        state.outputMode = 'plain';
    } else {
        state.workflowMode = workflowModes.BAKEMONO;
        state.memoryStrategy = memoryStrategies.BAKEMONO;
        state.stageSourceMode = stageSourceModes.SUMMARIES;
        state.outputMode = 'bakemono';
    }

    scanBakemonoBlocks({ persist: false });
    updateInjectionFromSummaries();
    saveState();
    renderAll(`已切换到：${getWorkflowModeLabel(state.workflowMode)}。扫描、自动总结和提示词配置已保留。`);
}

function renderWorkflowGuide(state = ensureState()) {
    const info = getWorkflowInfo(state);
    $('#bakemono-memory-workflow-title').text(info.title);
    const stageCount = Number($('#bakemono-memory-count-stage').text() || 0);
    const epicCount = Number($('#bakemono-memory-count-epic').text() || 0);
    $('#bakemono-memory-scene-code').text(`SC. ${String(stageCount).padStart(2, '0')} / TK. ${String(epicCount).padStart(2, '0')}`);
    const storySummaries = state.storySummaries || [];
    const coveredHashes = new Set(state.coveredBlockHashes || []);
    const coveredCount = storySummaries.filter(summary => summary?.hash && coveredHashes.has(summary.hash)).length;
    const progress = storySummaries.length ? Math.round((coveredCount / storySummaries.length) * 100) : 0;
    $('#bakemono-memory-scene-progress-fill').css('width', `${progress}%`);
    const scanLabel = storySummaries.length ? `扫描摘要 · ${storySummaries.length}` : '扫描摘要';
    $('#bakemono-memory-scan > span').text(scanLabel);
    document.querySelectorAll('[data-bakemono-workflow-preset]').forEach(card => {
        const isActive = card.dataset.bakemonoWorkflowPreset === (state.workflowMode || workflowModes.BAKEMONO);
        card.classList.toggle('is-active', isActive);
        card.setAttribute('aria-pressed', String(isActive));
    });
    const visibleActions = new Set(info.actions);
    const actionButtons = [...document.querySelectorAll('.bakemono-memory-control-deck [data-bakemono-action]')];
    actionButtons.forEach(button => {
        button.hidden = !visibleActions.has(button.dataset.bakemonoAction);
    });
    let primaryAssigned = false;
    actionButtons.forEach(button => {
        const isPrimary = !primaryAssigned
            && !button.hidden
            && button.closest('.bakemono-memory-hero-actions');
        button.classList.toggle('is-workflow-primary', !!isPrimary);
        primaryAssigned ||= !!isPrimary;
    });
}

function renderSummaryGenerationPanel(state = ensureState(), blocks = null) {
    if (blocks) {
        summaryGenerationSnapshot = {
            story: Array.isArray(blocks.story) ? blocks.story : [],
            stage: Array.isArray(blocks.stage) ? blocks.stage : [],
            epic: Array.isArray(blocks.epic) ? blocks.epic : [],
        };
    }

    const validModes = new Set(['stage', 'epic', 'batch']);
    if (!validModes.has(summaryGenerationMode)) {
        summaryGenerationMode = 'stage';
    }

    const storyBlocks = summaryGenerationSnapshot.story;
    const stageBlocks = summaryGenerationSnapshot.stage;
    const epicBlocks = summaryGenerationSnapshot.epic;
    const coveredHashes = new Set(state.coveredBlockHashes || []);
    const coveredStoryCount = storyBlocks.filter(block => block?.hash && coveredHashes.has(block.hash)).length;
    const uncoveredStoryCount = Math.max(0, storyBlocks.length - coveredStoryCount);
    const upperLevelMaterialCount = stageBlocks.length + epicBlocks.length;

    const modes = {
        stage: {
            action: 'generate-stage',
            icon: 'fa-wand-magic-sparkles',
            title: '整理下一段长期记忆',
            button: '生成阶段总结',
            code: `${uncoveredStoryCount} 条待整理`,
            description: `${storyBlocks.length} 条剧情摘要，其中 ${coveredStoryCount} 条已经收入阶段记忆。生成结果会先进入待确认。`,
            progress: storyBlocks.length ? Math.round((coveredStoryCount / storyBlocks.length) * 100) : 0,
        },
        epic: {
            action: 'generate-epic',
            icon: 'fa-layer-group',
            title: '把多个阶段连成时间线',
            button: '生成多次总结',
            code: `${upperLevelMaterialCount} 条材料`,
            description: `${stageBlocks.length} 条阶段总结与 ${epicBlocks.length} 条上层总结可继续压缩，适合整理一卷或一条长期剧情线。`,
            progress: upperLevelMaterialCount ? Math.min(100, Math.round((epicBlocks.length / upperLevelMaterialCount) * 100)) : 0,
        },
        batch: {
            action: 'batch-summary',
            icon: 'fa-list-check',
            title: '把旧聊天分批整理',
            button: '打开批量生成',
            code: `${storyBlocks.length} 条已识别`,
            description: '按楼层范围补写缺失摘要或整理旧正文；任务会分批运行，并统一进入待确认。',
            progress: 0,
        },
    };
    const current = modes[summaryGenerationMode];

    document.querySelectorAll('[data-bakemono-summary-mode]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.bakemonoSummaryMode === summaryGenerationMode);
    });
    $('#bakemono-memory-summary-generation-title').text(current.title);
    $('#bakemono-memory-summary-generation-code').text(current.code);
    $('#bakemono-memory-summary-generation-description').text(current.description);
    $('#bakemono-memory-summary-generation-progress').css('width', `${current.progress}%`);
    const primary = document.getElementById('bakemono-memory-summary-primary-action');
    if (primary) {
        primary.dataset.bakemonoAction = current.action;
        const icon = primary.querySelector('i');
        if (icon) {
            icon.className = `fa-solid ${current.icon}`;
        }
        const label = primary.querySelector('span');
        if (label) {
            label.textContent = current.button;
        }
    }
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

function getMemoryRecordStatusLabel(status) {
    return {
        [memoryRecordStatuses.SOURCE]: '可总结',
        [memoryRecordStatuses.COVERED]: '已覆盖',
        [memoryRecordStatuses.SAVED]: '已保存',
        [memoryRecordStatuses.INJECTED]: '注入中',
        [memoryRecordStatuses.ARCHIVED]: '已归档',
        [memoryRecordStatuses.DRAFT]: '草稿',
    }[status] || '未知';
}

function getMemoryDatabaseStats(state = ensureState()) {
    const records = state.memoryRecords || [];
    const byStatus = Object.fromEntries(Object.values(memoryRecordStatuses).map(status => [status, 0]));
    const byKind = {
        [blockTypes.STORY]: 0,
        [blockTypes.STAGE]: 0,
        [blockTypes.EPIC]: 0,
    };
    for (const record of records) {
        if (byStatus[record.status] !== undefined) {
            byStatus[record.status] += 1;
        }
        if (byKind[record.kind] !== undefined) {
            byKind[record.kind] += 1;
        }
    }
    return {
        total: records.length,
        byStatus,
        byKind,
        active: byStatus[memoryRecordStatuses.SOURCE] + byStatus[memoryRecordStatuses.SAVED] + byStatus[memoryRecordStatuses.INJECTED],
        queued: state.taskQueue.filter(task => task.status === 'queued').length,
        running: state.taskQueue.filter(task => task.status === 'running').length,
        failed: state.taskQueue.filter(task => task.status === 'failed').length,
    };
}

function renderMemoryDatabaseSummary(state = ensureState()) {
    const stats = getMemoryDatabaseStats(state);
    $('#bakemono-memory-count-records').text(stats.total);
    $('#bakemono-memory-database-total').text(stats.total);
    $('#bakemono-memory-database-active').text(stats.active);
    $('#bakemono-memory-database-injected').text(stats.byStatus[memoryRecordStatuses.INJECTED] || 0);
    $('#bakemono-memory-database-drafts').text(stats.byStatus[memoryRecordStatuses.DRAFT] || 0);
    $('#bakemono-memory-database-queue').text(`${stats.running}/${stats.queued}/${stats.failed}`);
    $('#bakemono-memory-record-stat-total').text(stats.total);
    $('#bakemono-memory-record-stat-injected').text(stats.byStatus[memoryRecordStatuses.INJECTED] || 0);
    $('#bakemono-memory-record-stat-archived').text(stats.byStatus[memoryRecordStatuses.ARCHIVED] || 0);

    const description = [
        `剧情摘要 ${stats.byKind[blockTypes.STORY] || 0}`,
        `阶段总结 ${stats.byKind[blockTypes.STAGE] || 0}`,
        `多次总结 ${stats.byKind[blockTypes.EPIC] || 0}`,
        `已覆盖 ${stats.byStatus[memoryRecordStatuses.COVERED] || 0}`,
        `已归档 ${stats.byStatus[memoryRecordStatuses.ARCHIVED] || 0}`,
    ].join(' · ');
    $('#bakemono-memory-database-description').text(description);
}

function getFilteredMemoryRecords(state = ensureState()) {
    const query = normalizeSearchText($('#bakemono-memory-record-filter').val() || '');
    const kind = String($('#bakemono-memory-record-kind').val() || 'all');
    const status = String($('#bakemono-memory-record-status').val() || 'all');
    const records = state.memoryRecords || [];
    return records.filter(record => {
        if (kind !== 'all' && record.kind !== kind) {
            return false;
        }
        if (status !== 'all' && record.status !== status) {
            return false;
        }
        if (!query) {
            return true;
        }
        const text = normalizeSearchText([
            record.title,
            record.sourceRange,
            record.source,
            getKindLabel(record.kind),
            getMemoryRecordStatusLabel(record.status),
            record.hash,
        ].join('\n'));
        return text.includes(query);
    });
}

function renderMemoryRecordList() {
    const container = document.querySelector('#bakemono-memory-record-list');
    if (!container) {
        return;
    }

    const state = ensureState();
    const records = getFilteredMemoryRecords(state).sort((a, b) => {
        const kindPriority = { [blockTypes.EPIC]: 0, [blockTypes.STAGE]: 1, [blockTypes.STORY]: 2 };
        return (kindPriority[a.kind] ?? 9) - (kindPriority[b.kind] ?? 9)
            || Number(a.sortKey ?? Number.MAX_SAFE_INTEGER) - Number(b.sortKey ?? Number.MAX_SAFE_INTEGER)
            || String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
    });
    container.innerHTML = '';
    const activeStatus = String($('#bakemono-memory-record-status').val() || 'all');
    document.querySelectorAll('[data-bakemono-record-status]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.bakemonoRecordStatus === activeStatus);
    });
    $('#bakemono-memory-record-result-count').text(`${records.length} 条`);

    if (!records.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无匹配的记忆记录。';
        container.append(empty);
        return;
    }

    const pageCount = Math.max(1, Math.ceil(records.length / memoryRecordPageSize));
    memoryRecordState.page = Math.min(Math.max(0, memoryRecordState.page || 0), pageCount - 1);
    const start = memoryRecordState.page * memoryRecordPageSize;
    const visibleRecords = records.slice(start, start + memoryRecordPageSize);

    const pager = createMemoryRecordPager(start, records.length, pageCount);

    const fragment = document.createDocumentFragment();
    visibleRecords.forEach((record, visibleIndex) => {
        const row = document.createElement('article');
        row.className = `bakemono-memory-record-item is-${record.status || 'source'}`;

        const marker = document.createElement('span');
        marker.className = `bakemono-memory-record-index is-${record.kind || 'story'}`;
        marker.textContent = record.kind === blockTypes.EPIC ? 'E' : record.kind === blockTypes.STAGE ? 'S' : '#';
        marker.title = `${getKindLabel(record.kind)} · 第 ${start + visibleIndex + 1} 条`;

        const main = document.createElement('div');
        main.className = 'bakemono-memory-record-main';
        const title = document.createElement('strong');
        title.textContent = record.title || '未命名记忆';
        const meta = document.createElement('span');
        meta.textContent = [
            getKindLabel(record.kind),
            record.sourceRange || '来源未知',
            record.source || '',
            record.contentLength ? `${record.contentLength} 字` : '',
        ].filter(Boolean).join(' · ');
        main.append(title, meta);

        const chips = document.createElement('div');
        chips.className = 'bakemono-memory-record-chips';
        const statusChip = document.createElement('span');
        statusChip.className = `bakemono-memory-record-chip is-${record.status || 'source'}`;
        statusChip.textContent = getMemoryRecordStatusLabel(record.status);
        chips.append(statusChip);
        const coverCount = (record.sourceHashes || []).length + (record.sourceStageHashes || []).length;
        if (coverCount) {
            const sourceChip = document.createElement('span');
            sourceChip.className = 'bakemono-memory-record-chip';
            sourceChip.textContent = `覆盖 ${coverCount}`;
            chips.append(sourceChip);
        }

        row.append(marker, main, chips);
        fragment.append(row);
    });
    container.append(fragment, pager);
}

function createMemoryRecordPager(start, total, pageCount) {
    const controls = document.createElement('div');
    controls.className = 'bakemono-memory-preview-pager bakemono-memory-record-pager';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'menu_button bakemono-preview-page-button';
    prev.dataset.bakemonoRecordPage = 'prev';
    prev.disabled = memoryRecordState.page <= 0;
    prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i><span>上一页</span>';
    const info = document.createElement('span');
    info.className = 'bakemono-memory-preview-page-info';
    info.textContent = `${total ? start + 1 : 0}-${Math.min(start + memoryRecordPageSize, total)} / ${total}`;
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'menu_button bakemono-preview-page-button';
    next.dataset.bakemonoRecordPage = 'next';
    next.disabled = memoryRecordState.page >= pageCount - 1;
    next.innerHTML = '<span>下一页</span><i class="fa-solid fa-chevron-right"></i>';
    controls.append(prev, info, next);
    return controls;
}

function renderTurnSummaryPanel(state = ensureState()) {
    $('#bakemono-memory-turn-enabled').prop('checked', !!state.turnSummary.enabled);
    $('#bakemono-memory-turn-auto').prop('checked', !!state.turnSummary.auto);
    $('#bakemono-memory-turn-processing-mode').val(state.turnSummary.processingMode || turnProcessingModes.BOTH);
    $('#bakemono-memory-turn-auto-save').prop('checked', state.turnSummary.saveMode === 'commit');
    $('#bakemono-memory-turn-include-user').prop('checked', state.turnSummary.includeUserMessage !== false);
    $('#bakemono-memory-turn-include-character').prop('checked', state.turnSummary.includeCharacterContext !== false);
    $('#bakemono-memory-turn-include-world-info').prop('checked', !!state.turnSummary.includeWorldInfo);
    $('#bakemono-memory-turn-world-max-context').val(state.turnSummary.worldInfoMaxContext ?? defaultState.turnSummary.worldInfoMaxContext);
    $('#bakemono-memory-turn-reference').val(state.turnSummary.referenceContext || '');
    $('#bakemono-memory-table-enabled').prop('checked', !!state.tableDatabase.enabled);
    $('#bakemono-memory-table-inject-memory').prop('checked', state.tableDatabase.injectMemory !== false);
    $('#bakemono-memory-table-auto-apply').prop('checked', !!state.tableDatabase.autoApply);
    $('#bakemono-memory-table-schema-scope').val(state.tableDatabase.schemaScope || tableSchemaScopes.CHAT);
    const tables = state.tableDatabase.tables || [];
    const tableDrafts = state.tableDatabase.editDrafts || [];
    const tableRowCount = tables.reduce((total, table) => total + (Array.isArray(table.rows) ? table.rows.length : 0), 0);
    const tableDraftOperationCount = tableDrafts.reduce((total, draft) => total + (Array.isArray(draft.operations) ? draft.operations.length : 0), 0);
    $('#bakemono-memory-table-schema-status').text(`${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)} · ${tables.length} 张表 · ${getCurrentCharacterSchemaLabel()}`);
    $('#bakemono-memory-table-overview-count').text(tables.length);
    $('#bakemono-memory-table-overview-row-count').text(tableRowCount);
    $('#bakemono-memory-table-overview-draft-count').text(tableDraftOperationCount);
    $('#bakemono-memory-table-draft-label').text(`${tableDraftOperationCount} 处`);
    renderTableProfileControls(state);
    $('#bakemono-memory-turn-prompt').val(state.turnSummary.prompt || defaultTurnSummaryPrompt);
    $('#bakemono-memory-table-prompt').val(state.turnSummary.tablePrompt || defaultTableEditPrompt);
    $('#bakemono-memory-inline-summary-enabled').prop('checked', !!state.inlineGeneration.summaryEnabled);
    $('#bakemono-memory-inline-table-enabled').prop('checked', !!state.inlineGeneration.tableEnabled);
    $('#bakemono-memory-inline-hide-table').prop('checked', state.inlineGeneration.hideTableEdit !== false);
    $('#bakemono-memory-inline-summary-prompt').val(state.inlineGeneration.summaryPrompt || defaultInlineSummaryPrompt);
    $('#bakemono-memory-inline-table-prompt').val(state.inlineGeneration.tablePrompt || defaultInlineTablePrompt);
    renderInlinePromptPresetControls('summary', '#bakemono-memory-inline-summary-preset-select', '#bakemono-memory-inline-summary-preset-name');
    renderInlinePromptPresetControls('table', '#bakemono-memory-inline-table-preset-select', '#bakemono-memory-inline-table-preset-name');
    const lastId = state.turnSummary.lastProcessedMessageId;
    const hasProcessedTurn = lastId !== null && lastId !== undefined;
    const turnEnabled = !!state.turnSummary.enabled;
    const turnAuto = !!state.turnSummary.auto;
    const tableEnabled = !!state.tableDatabase.enabled;
    const runtimeLabel = !turnEnabled
        ? '自动记忆未开启'
        : turnAuto
            ? '自动记忆运行中'
            : '自动记忆已启用';
    const runtimeTitle = hasProcessedTurn ? `第 ${lastId} 楼已处理` : '等待第一轮正文';
    const summaryDestination = state.turnSummary.saveMode === 'commit' ? '已直接写入长期记忆' : '摘要会先进入待确认';
    const tableDestination = tableEnabled
        ? tableDraftOperationCount
            ? `表格还有 ${tableDraftOperationCount} 处差异等待确认`
            : '表格没有待处理差异'
        : '本轮未启用表格更新';
    $('#bakemono-memory-turn-runtime-label').text(runtimeLabel);
    $('#bakemono-memory-turn-runtime-title').text(runtimeTitle);
    $('#bakemono-memory-turn-status').text(hasProcessedTurn
        ? `${summaryDestination}；${tableDestination}。`
        : turnEnabled
            ? '下一次正文结束后会按当前设置生成摘要。'
            : '开启后，每轮剧情会先生成草稿，再由你确认是否保存。');
    $('.bakemono-memory-turn-status-hero').toggleClass('is-running', turnEnabled && turnAuto);

    const setFlowStep = (selector, status) => {
        const element = document.querySelector(selector);
        if (!element) {
            return;
        }
        element.classList.toggle('is-done', status === 'done');
        element.classList.toggle('is-current', status === 'current');
        element.classList.toggle('is-waiting', status === 'waiting');
    };
    setFlowStep('#bakemono-memory-turn-flow-read', hasProcessedTurn ? 'done' : turnEnabled ? 'current' : 'waiting');
    setFlowStep('#bakemono-memory-turn-flow-summary', hasProcessedTurn && state.turnSummary.processingMode !== turnProcessingModes.TABLE ? 'done' : 'waiting');
    setFlowStep('#bakemono-memory-turn-flow-table', tableDraftOperationCount ? 'current' : hasProcessedTurn && tableEnabled ? 'done' : 'waiting');
    $('#bakemono-memory-turn-flow-status').text(tableDraftOperationCount
        ? `待确认 ${tableDraftOperationCount} 处`
        : hasProcessedTurn
            ? '本轮已完成'
            : turnEnabled
                ? '等待下一轮'
                : '尚未开启');
    renderTableList(state);
    renderTableEditDrafts(state);
}

function renderInlinePromptPresetControls(type, selectSelector, nameSelector) {
    const select = document.querySelector(selectSelector);
    if (!select) {
        return;
    }
    const presets = getInlinePromptPresets(type);
    select.innerHTML = '';
    for (const preset of presets) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name || '未命名提示词';
        select.append(option);
    }
    select.value = getSelectedInlinePromptPresetId(type);
    const selected = presets.find(preset => preset.id === select.value);
    $(nameSelector).val(selected?.name || '');
}

function renderTableProfileControls(state = ensureState()) {
    const select = document.querySelector('#bakemono-memory-table-profile-select');
    if (!select) {
        return;
    }
    const profiles = getTableProfilesForScope(state.tableDatabase.schemaScope || tableSchemaScopes.CHAT, state);
    select.innerHTML = '';
    for (const profile of profiles) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name || '未命名表格组';
        select.append(option);
    }
    select.value = state.tableDatabase.activeProfileId || profiles[0]?.id || '';
    $('#bakemono-memory-table-profile-name').val(getActiveTableProfile(state)?.name || '');
    renderTablePromptPresetControls();
}

function renderTablePromptPresetControls() {
    const select = document.querySelector('#bakemono-memory-table-preset-select');
    if (!select) {
        return;
    }
    const presets = getTablePromptPresets();
    select.innerHTML = '';
    for (const preset of presets) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name || '未命名表格提示词';
        select.append(option);
    }
    select.value = getSelectedTablePromptPresetId();
}

function renderTablePreviewMarkup(table) {
    const columns = Array.isArray(table.columns) ? table.columns : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const headerCells = columns.length
        ? columns.map((column, index) => `<th>${escapeHtml(column || `字段 ${index}`)}</th>`).join('')
        : '<th>暂无字段</th>';
    const rowCells = rows.length
        ? rows.map((row, rowIndex) => `
            <tr>
                ${columns.map((_, colIndex) => `<td>${escapeHtml(row?.[colIndex] ?? '') || '<span class="bakemono-memory-table-muted">空</span>'}</td>`).join('')}
            </tr>
        `).join('')
        : `<tr><td colspan="${Math.max(1, columns.length)}" class="bakemono-memory-table-preview-empty">暂无数据行</td></tr>`;
    return `
        <div class="bakemono-memory-table-preview-scroll" aria-label="${escapeHtml(table.name || '表格')}预览">
            <table class="bakemono-memory-table-preview">
                <thead><tr>${headerCells}</tr></thead>
                <tbody>${rowCells}</tbody>
            </table>
        </div>
    `;
}

function renderTableList(state = ensureState()) {
    const container = document.querySelector('#bakemono-memory-table-list');
    if (!container) {
        return;
    }
    const openTableIndexes = new Set(
        [...container.querySelectorAll('.bakemono-memory-table-item[open]')]
            .map(item => String(item.dataset.tableIndex || '')),
    );
    const openSections = new Set(
        [...container.querySelectorAll('.bakemono-memory-table-section[open]')]
            .map(item => `${item.closest('.bakemono-memory-table-item')?.dataset.tableIndex || ''}:${item.dataset.tableSection || ''}`),
    );
    if (tableUiState.openTableIndex !== '') {
        openTableIndexes.add(String(tableUiState.openTableIndex));
    }
    if (tableUiState.openTableIndex !== '' && tableUiState.openSection) {
        openSections.add(`${tableUiState.openTableIndex}:${tableUiState.openSection}`);
    }
    container.innerHTML = '';
    const tables = state.tableDatabase.tables || [];
    if (!tables.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无表格。可以导入表格结构或聊天表格数据。';
        container.append(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    tables.forEach(table => {
        table.columnPrompts = Array.isArray(table.columnPrompts) ? table.columnPrompts : [];
        const row = document.createElement('details');
        row.className = 'bakemono-memory-table-item';
        row.dataset.tableIndex = String(table.tableIndex);
        row.open = openTableIndexes.has(String(table.tableIndex));
        const summary = document.createElement('summary');
        const statusChips = [
            `${table.columns.length} 列`,
            `${(table.rows || []).length} 行`,
            table.readOnly ? '只读' : (table.allowAiEdit === false ? '禁止 AI 修改' : 'AI 可改'),
        ];
        summary.innerHTML = `
            <div class="bakemono-memory-table-summary-main">
                <div class="bakemono-memory-table-summary-head">
                    <strong>#${escapeHtml(table.tableIndex)} ${escapeHtml(table.name)}</strong>
                    <span>${statusChips.map(chip => escapeHtml(chip)).join(' / ')}</span>
                </div>
                ${renderTablePreviewMarkup(table)}
                <div class="bakemono-memory-table-summary-hint">
                    <i class="fa-solid fa-hand-pointer"></i>
                    <span>点开后编辑字段、数据行和操作</span>
                </div>
            </div>
        `;
        const body = document.createElement('div');
        body.className = 'bakemono-memory-table-body';
        const rows = Array.isArray(table.rows) ? table.rows : [];
        const fieldEditors = table.columns.map((col, index) => `
            <div class="bakemono-memory-table-field" data-table-field="${index}">
                <label>
                    <span>${escapeHtml(index)} · 字段名</span>
                    <input class="text_pole" data-table-column-name="${index}" type="text" value="${escapeHtml(col)}">
                </label>
                <label>
                    <span>字段提示词</span>
                    <textarea class="text_pole textarea_compact" data-table-column-prompt="${index}" rows="3" spellcheck="false" placeholder="告诉 AI 这一栏应该记录什么、什么时候更新、不要写什么。">${escapeHtml(table.columnPrompts?.[index] || '')}</textarea>
                </label>
                <button type="button" class="menu_button danger_button" data-bakemono-table-action="delete-column" data-table-col="${index}"><i class="fa-solid fa-trash"></i><span>删除字段</span></button>
            </div>
        `).join('');
        const headerCells = table.columns.map((col, index) => `<th>${escapeHtml(index)} · ${escapeHtml(col)}</th>`).join('');
        const rowCells = rows.length
            ? rows.map((cells, rowIndex) => `
                <tr data-table-row="${rowIndex}">
                    ${table.columns.map((_, colIndex) => `<td><textarea class="text_pole textarea_compact bakemono-memory-table-cell" data-table-col="${colIndex}" rows="2" spellcheck="false">${escapeHtml(cells?.[colIndex] ?? '')}</textarea></td>`).join('')}
                    <td class="bakemono-memory-table-row-tools"><button type="button" class="menu_button danger_button" data-bakemono-table-action="delete-row"><i class="fa-solid fa-trash"></i><span>删行</span></button></td>
                </tr>`).join('')
            : `<tr class="bakemono-memory-table-empty-row"><td colspan="${Math.max(1, table.columns.length + 1)}">暂无数据行。点“新增一行”开始编辑。</td></tr>`;
        body.innerHTML = `
            <details class="bakemono-memory-table-section" data-table-section="fields" ${openSections.has(`${table.tableIndex}:fields`) ? 'open' : ''}>
                <summary><i class="fa-solid fa-wand-magic-sparkles"></i><span>字段提示词</span><small>${table.columns.length} 栏</small></summary>
                <label class="bakemono-memory-editor">
                    <span>表格名称</span>
                    <input class="text_pole" data-table-name type="text" value="${escapeHtml(table.name || '')}">
                </label>
                <label class="bakemono-memory-editor">
                    <span>整张表规则</span>
                    <textarea class="text_pole textarea_compact" data-table-note rows="3" spellcheck="false" placeholder="这张表的整体用途、更新原则、禁止事项。">${escapeHtml(table.note || '')}</textarea>
                </label>
                <div class="bakemono-memory-table-flags">
                    <label class="checkbox_label bakemono-memory-switch">
                        <input type="checkbox" data-table-readonly ${table.readOnly ? 'checked' : ''}>
                        <span>只读，禁止 AI 修改</span>
                    </label>
                    <label class="checkbox_label bakemono-memory-switch">
                        <input type="checkbox" data-table-allow-ai ${!table.readOnly && table.allowAiEdit !== false ? 'checked' : ''} ${table.readOnly ? 'disabled' : ''}>
                        <span>允许 AI 修改</span>
                    </label>
                </div>
                <div class="bakemono-memory-table-fields">${fieldEditors}</div>
                <div class="bakemono-memory-inline-actions">
                    <button type="button" class="menu_button" data-bakemono-table-action="add-column"><i class="fa-solid fa-plus"></i><span>新增字段</span></button>
                </div>
            </details>
            <details class="bakemono-memory-table-section" data-table-section="rows" ${openSections.has(`${table.tableIndex}:rows`) || !openSections.has(`${table.tableIndex}:fields`) ? 'open' : ''}>
                <summary><i class="fa-solid fa-table"></i><span>数据行</span><small>${rows.length} 行</small></summary>
                <div class="bakemono-memory-table-scroll">
                    <table class="bakemono-memory-edit-table">
                        <thead><tr>${headerCells}<th>操作</th></tr></thead>
                        <tbody>${rowCells}</tbody>
                    </table>
                </div>
            </details>
            <div class="bakemono-memory-inline-actions">
                <button type="button" class="menu_button" data-bakemono-table-action="add-row"><i class="fa-solid fa-plus"></i><span>新增一行</span></button>
                <button type="button" class="menu_button" data-bakemono-table-action="save-table"><i class="fa-solid fa-floppy-disk"></i><span>保存表格</span></button>
                <button type="button" class="menu_button danger_button" data-bakemono-table-action="delete-table"><i class="fa-solid fa-trash"></i><span>删除表格</span></button>
            </div>
        `;
        row.append(summary, body);
        fragment.append(row);
    });
    container.append(fragment);
    if (tableUiState.focusCell) {
        const { tableIndex, rowIndex, colIndex } = tableUiState.focusCell;
        tableUiState.focusCell = null;
        requestAnimationFrame(() => {
            const tableItem = container.querySelector(`.bakemono-memory-table-item[data-table-index="${tableIndex}"]`);
            tableItem?.setAttribute('open', '');
            const cell = tableItem?.querySelector(`tr[data-table-row="${rowIndex}"] [data-table-col="${colIndex}"]`);
            cell?.focus();
            cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
    }
    if (tableUiState.focusField) {
        const { tableIndex, colIndex } = tableUiState.focusField;
        tableUiState.focusField = null;
        requestAnimationFrame(() => {
            const tableItem = container.querySelector(`.bakemono-memory-table-item[data-table-index="${tableIndex}"]`);
            tableItem?.setAttribute('open', '');
            tableItem?.querySelector('[data-table-section="fields"]')?.setAttribute('open', '');
            const field = tableItem?.querySelector(`[data-table-column-name="${colIndex}"]`);
            field?.focus();
            field?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
    }
}

function renderTableEditDrafts(state = ensureState()) {
    const container = document.querySelector('#bakemono-memory-table-draft-list');
    if (!container) {
        return;
    }
    container.innerHTML = '';
    const drafts = state.tableDatabase.editDrafts || [];
    if (!drafts.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无表格修改草稿。';
        container.append(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    drafts.forEach(draft => {
        const operations = Array.isArray(draft.operations) ? draft.operations : [];
        const card = document.createElement('article');
        card.className = 'bakemono-memory-table-draft-card';
        card.dataset.tableDraftId = draft.id;
        const header = document.createElement('div');
        header.className = 'bakemono-memory-table-draft-header';
        const badge = document.createElement('span');
        badge.className = 'bakemono-memory-table-draft-badge';
        badge.textContent = '表格修改';
        const time = document.createElement('small');
        time.textContent = draft.createdAt ? new Date(draft.createdAt).toLocaleString() : '刚刚生成';
        header.append(badge, time);
        const title = document.createElement('h4');
        title.textContent = `${operations.length} 处变化等待应用`;
        const meta = document.createElement('span');
        meta.className = 'bakemono-memory-table-draft-meta';
        meta.textContent = formatSourceRange(draft.sourceMessageIds || []) || '本轮正文';

        const preview = document.createElement('div');
        preview.className = 'bakemono-memory-table-diff-list';
        operations.slice(0, 4).forEach(operation => {
            const item = document.createElement('div');
            item.className = `bakemono-memory-table-diff-item is-${operation.op || 'update'}`;
            const sign = document.createElement('span');
            sign.className = 'bakemono-memory-table-diff-sign';
            sign.textContent = operation.op === 'insert' ? '+' : operation.op === 'delete' ? '−' : '~';
            const copy = document.createElement('div');
            const itemTitle = document.createElement('strong');
            const operationLabel = operation.op === 'insert' ? '新增记录' : operation.op === 'delete' ? '删除记录' : '更新记录';
            itemTitle.textContent = `表格 #${operation.tableIndex} · ${operationLabel}`;
            const itemText = document.createElement('p');
            const dataText = Object.entries(operation.data || {}).map(([key, value]) => `${key}：${value}`).join(' · ');
            itemText.textContent = dataText || (Number.isFinite(operation.rowIndex) ? `第 ${operation.rowIndex} 行` : '等待查看具体内容');
            copy.append(itemTitle, itemText);
            item.append(sign, copy);
            preview.append(item);
        });
        if (operations.length > 4) {
            const more = document.createElement('small');
            more.className = 'bakemono-memory-table-diff-more';
            more.textContent = `另有 ${operations.length - 4} 处修改，可在原始指令中查看。`;
            preview.append(more);
        }

        const textarea = document.createElement('textarea');
        textarea.className = 'text_pole textarea_compact bakemono-memory-table-draft-editor';
        textarea.rows = 7;
        textarea.spellcheck = false;
        textarea.value = draft.raw || '';
        const details = document.createElement('details');
        details.className = 'bakemono-memory-table-draft-details bakemono-memory-console-disclosure';
        details.innerHTML = '<summary><span><i class="fa-solid fa-code"></i> 查看原始修改指令</span><small>重新解析或丢弃</small></summary>';
        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'bakemono-memory-table-draft-secondary-actions';
        secondaryActions.innerHTML = `
            <button type="button" class="menu_button" data-bakemono-table-draft-action="reparse"><i class="fa-solid fa-code"></i><span>重新解析</span></button>
            <button type="button" class="menu_button danger_button" data-bakemono-table-draft-action="discard"><i class="fa-solid fa-trash"></i><span>丢弃</span></button>
        `;
        details.append(textarea, secondaryActions);
        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'menu_button bakemono-memory-table-draft-apply';
        apply.dataset.bakemonoTableDraftAction = 'apply';
        apply.innerHTML = '<i class="fa-solid fa-check"></i><span>应用修改</span>';
        card.append(header, title, meta, preview, details, apply);
        fragment.append(card);
    });
    container.append(fragment);
}

function saveEditedTableFromElement(details, options = {}) {
    const state = options.state || ensureState();
    const tableIndex = Number(details?.dataset.tableIndex);
    const table = (state.tableDatabase.tables || []).find(item => Number(item.tableIndex) === tableIndex);
    if (!table) {
        toastr.warning('没有找到这张表。');
        return;
    }
    table.name = String(details.querySelector('[data-table-name]')?.value || table.name || '').trim() || '未命名表格';
    const columnNames = table.columns.map((name, colIndex) => String(details.querySelector(`[data-table-column-name="${colIndex}"]`)?.value || name || '').trim() || `字段 ${colIndex}`);
    table.columns = columnNames;
    table.columnPrompts = columnNames.map((_, colIndex) => String(details.querySelector(`[data-table-column-prompt="${colIndex}"]`)?.value || '').trim());
    table.note = String(details.querySelector('[data-table-note]')?.value || '').trim();
    table.readOnly = !!details.querySelector('[data-table-readonly]')?.checked;
    table.allowAiEdit = table.readOnly ? false : !!details.querySelector('[data-table-allow-ai]')?.checked;
    table.inject = true;
    table.injectLimit = Math.max(120, Number(table.injectLimit || 1200));
    const rows = [...details.querySelectorAll('tbody tr[data-table-row]')].map(row => (
        table.columns.map((_, colIndex) => String(row.querySelector(`[data-table-col="${colIndex}"]`)?.value || '').trim())
    ));
    table.rows = rows;
    if (options.persist !== false) {
        persistCurrentTableDatabase(state);
    }
    if (options.render !== false) {
        renderAll(`已保存表格：${table.name}`);
    }
    return table;
}

function importTablesFromText(raw, sourceLabel = '表格数据') {
    const text = String(raw || '').trim();
    if (!text) {
        toastr.warning('请先选择或粘贴表格数据。');
        return false;
    }
    let tables;
    try {
        tables = normalizeImportedTablesFromJson(text);
    } catch (error) {
        toastr.error(`表格数据解析失败：${error?.message || error}`);
        return false;
    }
    if (!tables.length) {
        toastr.warning('没有在导入内容中找到可用表格。');
        return false;
    }
    const confirmed = confirmDanger(
        `导入 ${tables.length} 张表格？`,
        [`来源：${sourceLabel}`, '这会覆盖当前聊天里剧情剪辑台保存的表格数据库，但不会删除摘要。'],
    );
    if (!confirmed) {
        return false;
    }
    const state = ensureState();
    state.tableDatabase.tables = tables;
    state.tableDatabase.lastImportAt = new Date().toISOString();
    state.tableDatabase.enabled = true;
    syncCurrentTableSchemas(state);
    updateInjectionFromSummaries();
    renderAll(`已导入 ${tables.length} 张表格。`);
    toastr.success(`已导入 ${tables.length} 张表格。`);
    return true;
}

function createCustomTableFromUi() {
    const state = ensureState();
    const name = String($('#bakemono-memory-new-table-name').val() || '').trim();
    const columns = parseList($('#bakemono-memory-new-table-columns').val()).filter(Boolean);
    if (!name) {
        toastr.warning('请先填写新表名称。');
        return;
    }
    if (!columns.length) {
        toastr.warning('请至少填写一个字段名。');
        return;
    }
    const table = {
        id: `table-${getHash(`${Date.now()}|${name}|${columns.join('|')}`)}`,
        tableIndex: getNextTableIndex(state),
        name,
        columns,
        columnPrompts: columns.map(() => ''),
        note: '',
        initNode: '',
        insertNode: '',
        updateNode: '',
        deleteNode: '',
        rows: [],
        required: false,
        readOnly: false,
        inject: true,
        injectLimit: 1200,
        allowAiEdit: true,
    };
    state.tableDatabase.tables.push(table);
    state.tableDatabase.enabled = true;
    syncCurrentTableSchemas(state);
    $('#bakemono-memory-new-table-name').val('');
    $('#bakemono-memory-new-table-columns').val('');
    updateInjectionFromSummaries();
    renderAll(`已创建表格：${name}`);
    toastr.success('表格已创建。');
}

function scheduleRenderAll(statusText = '') {
    if (statusText) {
        scheduledRenderStatus = statusText;
    }
    if (scheduledRenderHandle !== null) {
        return;
    }
    const flush = () => {
        scheduledRenderHandle = null;
        const nextStatus = scheduledRenderStatus;
        scheduledRenderStatus = '';
        renderAll(nextStatus);
    };
    scheduledRenderHandle = typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame(flush)
        : globalThis.setTimeout(flush, 16);
}

function isWorkbenchOpen() {
    const root = document.getElementById('bakemono-workbench-root');
    return !!root
        && !root.classList.contains('bakemono-workbench-hidden')
        && root.getAttribute('aria-hidden') !== 'true';
}

function getActiveWorkbenchTab() {
    return document.getElementById('bakemono-workbench-root')?.dataset.activeTab || 'overview';
}

function renderTaskQueueProgress(statusText = '') {
    const state = ensureState();
    if (!isWorkbenchOpen()) {
        return;
    }
    $('#bakemono-memory-count-drafts').text(state.drafts.length);
    if (getActiveWorkbenchTab() === 'drafts') {
        renderDrafts();
        renderTaskQueue();
    }
    if (getActiveWorkbenchTab() === 'maintenance') {
        renderMaintenanceOverview(state);
    }
    if (statusText) {
        $('#bakemono-memory-status-line').text(statusText);
    }
}

function renderActivePresetControls(tabName) {
    if (tabName === 'settings') {
        renderPresetControlPair('#bakemono-memory-preset-select', '#bakemono-memory-preset-name');
    } else if (tabName === 'scan') {
        renderAreaPresetControl(areaPresetScopes.SCAN, '#bakemono-memory-scan-preset-select', '#bakemono-memory-scan-preset-name');
    } else if (tabName === 'automation') {
        renderAreaPresetControl(areaPresetScopes.AUTOMATION, '#bakemono-memory-automation-preset-select', '#bakemono-memory-automation-preset-name');
        renderAreaPresetControl(areaPresetScopes.API, '#bakemono-memory-api-preset-select', '#bakemono-memory-api-preset-name');
    } else if (tabName === 'prompts') {
        renderAreaPresetControl(areaPresetScopes.PROMPTS, '#bakemono-memory-prompts-preset-select', '#bakemono-memory-prompts-preset-name');
    } else if (tabName === 'turn-summary' || tabName === 'tables') {
        renderAreaPresetControl(areaPresetScopes.TURN, '#bakemono-memory-turn-preset-select', '#bakemono-memory-turn-preset-name');
    } else if (tabName === 'injection') {
        renderAreaPresetControl(areaPresetScopes.INJECTION, '#bakemono-memory-injection-preset-select', '#bakemono-memory-injection-preset-name');
    } else if (tabName === 'vector') {
        renderAreaPresetControl(areaPresetScopes.VECTOR, '#bakemono-memory-vector-preset-select', '#bakemono-memory-vector-preset-name');
    }
}

function renderActiveWorkbenchPanel(tabName, state, blocks) {
    renderActivePresetControls(tabName);
    if (tabName === 'overview') {
        renderWorkflowGuide(state);
        renderMemoryDatabaseSummary(state);
    } else if (tabName === 'settings') {
        renderWorkflowGuide(state);
        renderAutoHideRecentPanel(state);
        renderMemoryDatabaseSummary(state);
    } else if (tabName === 'preview') {
        renderSummaryGenerationPanel(state, blocks);
        renderPreviewSections(blocks.story, blocks.stage, blocks.epic);
    } else if (tabName === 'records') {
        renderMemoryRecordList();
    } else if (tabName === 'timeline') {
        renderTimeline();
    } else if (tabName === 'drafts') {
        renderDrafts();
        renderHistory();
        renderTaskQueue();
    } else if (tabName === 'turn-summary' || tabName === 'tables') {
        renderTurnSummaryPanel(state);
    } else if (tabName === 'injection') {
        renderInjectionOverview(state);
    } else if (tabName === 'prompts') {
        renderPromptOverview(state);
    } else if (tabName === 'vector') {
        renderVectorMemoryPanel(state);
    } else if (tabName === 'scan') {
        renderScanOverview(state);
        renderScanPreview();
    } else if (tabName === 'automation') {
        renderCustomModelOptions(state.automation.customApi?.models || []);
    } else if (tabName === 'appearance') {
        renderAppearanceSettings();
    } else if (tabName === 'maintenance') {
        renderMaintenanceOverview(state);
    }
}

function renderAutomationOverview(state = ensureState()) {
    const targets = getUnsummarizedStoryBlocks();
    const triggerType = state.automation.triggerType || defaultAutomation.triggerType;
    const currentValue = triggerType === 'chars'
        ? targets.reduce((sum, block) => sum + String(block.content || '').length, 0)
        : targets.length;
    const threshold = triggerType === 'chars'
        ? Math.max(100, Number(state.automation.charInterval || defaultAutomation.charInterval))
        : Math.max(1, Number(state.automation.floorInterval || defaultAutomation.floorInterval));
    const remaining = Math.max(0, threshold - currentValue);
    const progress = Math.max(0, Math.min(100, Math.round((currentValue / threshold) * 100)));
    const enabled = !!state.automation.enabled;
    const ready = enabled && currentValue >= threshold;
    const mode = state.automation.mode || defaultAutomation.mode;
    const modeLabel = mode === 'commit_hide' ? '自动保存' : mode === 'draft' ? '生成草稿' : '仅提醒';
    const triggerLabel = triggerType === 'chars' ? '字数' : '片段';
    const unit = triggerType === 'chars' ? '字' : '条摘要';
    const title = !enabled
        ? '等待开启自动规则'
        : ready
            ? '已达到触发条件'
            : `还差 ${remaining.toLocaleString()} ${unit}`;
    const destination = mode === 'commit_hide'
        ? `达到阈值后自动保存阶段总结，并保留最近 ${state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent} 楼正文。`
        : mode === 'draft'
            ? '达到阈值后生成阶段总结草稿，先进入待确认，不直接覆盖正文。'
            : '达到阈值后只提醒你整理，不会自动生成或保存。';
    $('#bakemono-memory-automation-runtime-label').text(enabled ? '自动总结运行中' : '自动总结未开启');
    $('#bakemono-memory-automation-mode-badge').text(modeLabel);
    $('#bakemono-memory-automation-runtime-title').text(title);
    $('#bakemono-memory-automation-runtime-description').text(destination);
    $('#bakemono-memory-automation-progress-bar').css('width', `${enabled ? progress : 0}%`);
    $('#bakemono-memory-automation-rule-status').text(enabled ? `按${triggerLabel} · ${currentValue.toLocaleString()} / ${threshold.toLocaleString()}` : '尚未启用');
    $('#bakemono-memory-automation-floor-hint').text(`每 ${Number(state.automation.floorInterval || defaultAutomation.floorInterval).toLocaleString()} 个未整理片段`);
    $('#bakemono-memory-automation-char-hint').text(`每 ${Number(state.automation.charInterval || defaultAutomation.charInterval).toLocaleString()} 字`);
    $('#bakemono-memory-automation-preserve-hint').text(`最近 ${Number(state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent).toLocaleString()} 楼`);
    $('.bakemono-memory-automation-hero')
        .toggleClass('is-running', enabled)
        .toggleClass('is-ready', ready);
    document.querySelectorAll('[data-bakemono-auto-rule]').forEach(row => {
        row.hidden = row.dataset.bakemonoAutoRule !== triggerType;
    });
}

function renderAll(statusText = '') {
    if (scheduledRenderHandle !== null) {
        if (typeof globalThis.cancelAnimationFrame === 'function') {
            globalThis.cancelAnimationFrame(scheduledRenderHandle);
        } else {
            globalThis.clearTimeout(scheduledRenderHandle);
        }
        scheduledRenderHandle = null;
        scheduledRenderStatus = '';
    }
    const state = ensureState();
    if (!isWorkbenchOpen()) {
        return;
    }
    const activeTab = getActiveWorkbenchTab();
    if (activeTab === 'overview' || activeTab === 'records' || activeTab === 'settings') {
        state.memoryRecords = buildMemoryRecords(state);
    }
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

    renderWorkbenchHeaderContext(activeTab, state);

    $('#bakemono-memory-count-story').text(storyBlocks.length);
    $('#bakemono-memory-count-stage').text(dedupedStageBlocks.length);
    $('#bakemono-memory-count-epic').text(dedupedEpicBlocks.length);
    $('#bakemono-memory-count-drafts').text(state.drafts.length);
    $('#bakemono-memory-tab-count-story').text(storyBlocks.length);
    $('#bakemono-memory-tab-count-stage').text(dedupedStageBlocks.length);
    $('#bakemono-memory-tab-count-epic').text(dedupedEpicBlocks.length);
    const actualHiddenIds = getActualHiddenMessageIds();
    const pluginHiddenIds = getFiniteMessageIds(state.hiddenMessageIds || []);
    $('#bakemono-memory-count-hidden')
        .text(actualHiddenIds.length)
        .attr('title', `酒馆实际隐藏 ${actualHiddenIds.length} 楼；插件记录 ${pluginHiddenIds.length} 楼`);
    $('#bakemono-memory-memory-strategy').val(state.memoryStrategy || memoryStrategies.BAKEMONO);
    $('#bakemono-memory-workflow-mode').val(state.workflowMode || workflowModes.BAKEMONO);
    $('#bakemono-memory-stage-source-mode').val(getStageSourceMode(state));
    $('#bakemono-memory-output-mode').val(state.outputMode || 'bakemono');
    $('#bakemono-memory-strategy-label').text(getMemoryStrategyLabel(state.memoryStrategy));
    $('#bakemono-memory-workflow-label').text(`${getWorkflowModeLabel(state.workflowMode)} / ${getStageSourceModeLabel(getStageSourceMode(state))}`);
    const injectionParts = getInjectionMemoryParts(state);
    $('#bakemono-memory-injection-stats').text(`注入：多次 ${injectionParts.stats.epic} / 阶段 ${injectionParts.stats.stage} / 普通 ${injectionParts.stats.story} / 表格 ${injectionParts.stats.table || 0} / 向量 ${injectionParts.stats.vector || 0}`);
    const uncoveredStory = state.storySummaries.filter(item => !(state.coveredBlockHashes || []).includes(item.hash)).length;
    $('#bakemono-memory-memory-warning').text(state.memoryStrategy === memoryStrategies.BAKEMONO && uncoveredStory
        ? `摘要块手账模式下普通摘要不注入：当前有 ${uncoveredStory} 个普通摘要仍只是阶段总结材料。`
        : state.memoryStrategy === memoryStrategies.GENERIC
            ? '通用模式下未被阶段总结覆盖的普通补课摘要会进入注入，阶段总结后会自动退出。'
            : '摘要块手账模式适合配合酒馆正则使用，避免普通摘要和正文摘要重复占用上下文。');
    $('#bakemono-memory-injection-enabled').prop('checked', !!state.injection.enabled);
    $('#bakemono-memory-memory-warning').text(getWorkflowStatusText(state, injectionParts.stats, uncoveredStory));
    $('#bakemono-memory-depth').val(state.injection.depth);
    $('#bakemono-memory-role').val(String(state.injection.role));
    $('#bakemono-memory-source-content').val(state.generatedMemory || '');
    $('#bakemono-memory-injection-template').val(state.injection.template || defaultInjectionTemplate);
    $('#bakemono-memory-injection-content').val(renderInjectionContent(state));
    $('#bakemono-memory-story-prompt').val(state.generationPrompts.story || defaultStoryGenerationPrompt);
    $('#bakemono-memory-missing-prompt').val(state.generationPrompts.missing || defaultMissingSummaryPrompt);
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
    $('#bakemono-memory-batch-summary-size').val(state.automation.backfillBatchSize ?? defaultAutomation.backfillBatchSize);
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
    $('#bakemono-memory-custom-stream').val(String(!!state.automation.customApi?.stream));
    if (activeTab === 'automation') {
        renderAutomationOverview(state);
    }
    renderActiveWorkbenchPanel(activeTab, state, {
        story: storyBlocks,
        stage: dedupedStageBlocks,
        epic: dedupedEpicBlocks,
    });

    const injected = state.injection.enabled && renderInjectionContent(state) ? '注入开启' : '注入为空或关闭';
    $('#bakemono-memory-status-line').text(statusText || `${injected}。上次扫描：${state.lastScanAt ? new Date(state.lastScanAt).toLocaleString() : '尚未扫描'}。`);
    renderWorkbenchHeaderContext(activeTab, state);
    syncPromptHintButtons();
    captureOperationFeedbackFromStatus(statusText);
}

function syncPromptHintButtons() {
    document.querySelectorAll('.bakemono-memory-card-panel > h4 + .bakemono-memory-prompt-hint').forEach(hint => {
        const title = hint.previousElementSibling;
        if (title?.matches('h4')) {
            title.append(hint);
        }
    });
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
    const validTypes = new Set(['story', 'stage', 'epic']);
    if (!validTypes.has(previewState.activeType)) {
        previewState.activeType = 'story';
    }
    document.querySelectorAll('.bakemono-preview-type-button').forEach(button => {
        button.classList.toggle('is-active', button.dataset.bakemonoPreviewType === previewState.activeType);
    });
    const grid = document.querySelector('.bakemono-memory-preview-grid');
    grid?.setAttribute('data-bakemono-active-preview', previewState.activeType);
    document.querySelectorAll('.bakemono-memory-preview-column').forEach(column => {
        column.classList.toggle('is-active', column.dataset.bakemonoPreviewColumn === previewState.activeType);
    });
}

function getPromptPreviewValue(type = promptPreviewType, state = ensureState()) {
    const config = {
        story: ['#bakemono-memory-story-prompt', state.generationPrompts.story || defaultStoryGenerationPrompt],
        missing: ['#bakemono-memory-missing-prompt', state.generationPrompts.missing || defaultMissingSummaryPrompt],
        stage: ['#bakemono-memory-stage-prompt', state.generationPrompts.stage || defaultStageGenerationPrompt],
        epic: ['#bakemono-memory-epic-prompt', state.generationPrompts.epic || defaultEpicGenerationPrompt],
    }[type] || ['#bakemono-memory-stage-prompt', state.generationPrompts.stage || defaultStageGenerationPrompt];
    const editorValue = String($(config[0]).val() || '').trim();
    return editorValue || String(config[1] || '').trim();
}

function getPromptStructureExcerpt(prompt = '') {
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

function renderPromptOverview(state = ensureState()) {
    const validTypes = new Set(['story', 'missing', 'stage', 'epic']);
    if (!validTypes.has(promptPreviewType)) {
        promptPreviewType = 'stage';
    }
    const meta = {
        story: { label: '旧聊天补课', description: '把没有摘要的旧正文分批压缩进插件记忆，不写回原楼层。' },
        missing: { label: '缺失摘要', description: '为漏写摘要的助手楼层补回标准摘要块。' },
        stage: { label: '阶段总结', description: '把普通摘要整理成带时间轴的阶段记忆。' },
        epic: { label: '多次总结', description: '把多个阶段继续整理成长期时间线总览。' },
    }[promptPreviewType];
    const prompt = getPromptPreviewValue(promptPreviewType, state);
    const select = document.querySelector('#bakemono-memory-prompts-preset-select');
    const selectedName = select?.selectedOptions?.[0]?.textContent
        || String($('#bakemono-memory-prompts-preset-name').val() || '').trim()
        || '默认提示词';
    $('#bakemono-memory-prompts-current-name').text(selectedName);
    $('#bakemono-memory-prompts-preview-label').text(meta.label);
    $('#bakemono-memory-prompts-preview-description').text(meta.description);
    $('#bakemono-memory-prompts-structure-preview').text(getPromptStructureExcerpt(prompt));
    document.querySelectorAll('[data-bakemono-prompt-preview]').forEach(button => {
        const isActive = button.dataset.bakemonoPromptPreview === promptPreviewType;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
    });
}

function renderInjectionOverview(state = ensureState()) {
    const parts = getInjectionMemoryParts(state);
    const stats = parts.stats;
    const content = renderInjectionContent(state);
    const total = (stats.epic || 0) + (stats.stage || 0) + (stats.story || 0) + (stats.table || 0) + (stats.vector || 0);
    const enabled = !!state.injection.enabled;
    $('#bakemono-memory-injection-runtime-label').text(enabled ? '注入已开启' : '注入未开启');
    $('#bakemono-memory-injection-runtime-title').text(`本轮共 ${total.toLocaleString()} 条记忆`);
    $('#bakemono-memory-injection-runtime-description').text(enabled
        ? `多次总结 ${stats.epic || 0} · 阶段总结 ${stats.stage || 0} · 普通摘要 ${stats.story || 0} · 表格 ${stats.table || 0} · 向量召回 ${stats.vector || 0}`
        : '当前最终内容不会发送给模型；可在工作流细节中开启剧情记忆注入。');
    $('#bakemono-memory-injection-source-total').text(`${total.toLocaleString()} 条`);
    $('#bakemono-memory-injection-source-epic').text(stats.epic || 0);
    $('#bakemono-memory-injection-source-summary').text((stats.stage || 0) + (stats.story || 0));
    $('#bakemono-memory-injection-source-table').text(stats.table || 0);
    $('#bakemono-memory-injection-source-vector').text(stats.vector || 0);
    $('#bakemono-memory-injection-char-count').text(`约 ${content.length.toLocaleString()} 字符`);
    const select = document.querySelector('#bakemono-memory-injection-preset-select');
    $('#bakemono-memory-injection-preset-summary').text(select?.selectedOptions?.[0]?.textContent || '当前配置');
    $('.bakemono-memory-injection-status-hero').toggleClass('is-active', enabled);
}

function renderScanOverview(state = ensureState()) {
    const blocks = Array.isArray(state.blocks) ? state.blocks : [];
    const counts = {
        story: blocks.filter(block => block.type === blockTypes.STORY).length,
        stage: blocks.filter(block => block.type === blockTypes.STAGE).length,
        epic: blocks.filter(block => block.type === blockTypes.EPIC).length,
    };
    const total = Math.max(Number(state.lastScanMatchCount || 0), counts.story + counts.stage + counts.epic);
    const maxCount = Math.max(1, counts.story, counts.stage, counts.epic);
    const hasScanned = !!state.lastScanAt;
    const mode = state.scanRules.mode || defaultScanRules.mode;
    const includeTags = parseList(state.scanRules.includeTags || defaultScanRules.includeTags);
    const tagSummary = includeTags.slice(0, 3).join('、') || '未设置读取标签';
    $('#bakemono-memory-scan-runtime-title').text(hasScanned ? '识别正常' : '尚未扫描');
    $('#bakemono-memory-scan-runtime-count').text(`${total.toLocaleString()} 条结果`);
    $('#bakemono-memory-scan-runtime-description').text(hasScanned
        ? `${mode === 'full' ? '全文管线' : '标签块'} · ${state.scanRules.includeHidden !== false ? '包含隐藏楼层' : '只看可见楼层'} · ${new Date(state.lastScanAt).toLocaleString()}`
        : '扫描后会在这里显示普通摘要、阶段总结和多次总结的识别数量。');
    $('#bakemono-memory-scan-story-count').text(counts.story);
    $('#bakemono-memory-scan-stage-count').text(counts.stage);
    $('#bakemono-memory-scan-epic-count').text(counts.epic);
    $('#bakemono-memory-scan-story-bar').css('width', `${Math.round((counts.story / maxCount) * 100)}%`);
    $('#bakemono-memory-scan-stage-bar').css('width', `${Math.round((counts.stage / maxCount) * 100)}%`);
    $('#bakemono-memory-scan-epic-bar').css('width', `${Math.round((counts.epic / maxCount) * 100)}%`);
    $('#bakemono-memory-scan-mode-badge').text(mode === 'full' ? '全文管线' : '标签块');
    $('#bakemono-memory-scan-tag-summary').text(includeTags.length > 3 ? `${tagSummary} 等 ${includeTags.length} 个` : tagSummary);
    $('.bakemono-memory-scan-status-hero').toggleClass('is-healthy', hasScanned);
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

    const renderLimit = window.matchMedia?.('(max-width: 900px)').matches
        ? mobileScanPreviewRenderLimit
        : desktopScanPreviewRenderLimit;
    const visibleItems = state.scanPreview.slice(-renderLimit);
    const totalMatches = Math.max(Number(state.lastScanMatchCount || 0), state.scanPreview.length);
    const omittedCount = Math.max(0, totalMatches - visibleItems.length);
    if (omittedCount) {
        const notice = document.createElement('div');
        notice.className = 'bakemono-memory-empty';
        notice.textContent = `为降低手机内存占用，仅显示最近 ${visibleItems.length} 条扫描结果；其余 ${omittedCount} 条未创建预览节点。`;
        container.append(notice);
    }

    const fragment = document.createDocumentFragment();
    visibleItems.forEach(item => {
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

function renderVectorMemoryPanel(state = ensureState()) {
    $('#bakemono-memory-vector-enabled').prop('checked', !!state.vectorMemory.enabled);
    $('#bakemono-memory-vector-auto-index').prop('checked', state.vectorMemory.autoIndex !== false);
    $('#bakemono-memory-vector-include-hidden').prop('checked', state.vectorMemory.includeHidden !== false);
    $('#bakemono-memory-vector-include-user').prop('checked', state.vectorMemory.includeUser === true);
    $('#bakemono-memory-vector-index-mode').val(state.vectorMemory.indexMode || defaultVectorMemory.indexMode);
    $('#bakemono-memory-vector-inject-mode').val(state.vectorMemory.injectMode || defaultVectorMemory.injectMode);
    $('#bakemono-memory-vector-max-indexed-messages').val(state.vectorMemory.maxIndexedMessages ?? defaultVectorMemory.maxIndexedMessages);
    $('#bakemono-memory-vector-max-stored-text-chars').val(state.vectorMemory.maxStoredTextChars ?? defaultVectorMemory.maxStoredTextChars);
    $('#bakemono-memory-vector-chunk-size').val(state.vectorMemory.chunkSize ?? defaultVectorMemory.chunkSize);
    $('#bakemono-memory-vector-overlap').val(state.vectorMemory.overlap ?? defaultVectorMemory.overlap);
    $('#bakemono-memory-vector-long-message-threshold').val(state.vectorMemory.longMessageThreshold ?? defaultVectorMemory.longMessageThreshold);
    $('#bakemono-memory-vector-top-k').val(state.vectorMemory.rerankCandidateCount ?? state.vectorMemory.topK ?? defaultVectorMemory.rerankCandidateCount);
    $('#bakemono-memory-vector-max-recall-messages').val(state.vectorMemory.finalRecallCount ?? state.vectorMemory.maxRecallMessages ?? defaultVectorMemory.finalRecallCount);
    $('#bakemono-memory-vector-full-recall-count').val(state.vectorMemory.fullRecallCount ?? defaultVectorMemory.fullRecallCount);
    $('#bakemono-memory-vector-max-per-message').val(state.vectorMemory.maxPerMessage ?? defaultVectorMemory.maxPerMessage);
    $('#bakemono-memory-vector-per-message-max-chars').val(state.vectorMemory.perMessageMaxChars ?? defaultVectorMemory.perMessageMaxChars);
    $('#bakemono-memory-vector-min-score').val(state.vectorMemory.embeddingThreshold ?? state.vectorMemory.minScore ?? defaultVectorMemory.embeddingThreshold);
    $('#bakemono-memory-vector-rerank-threshold').val(state.vectorMemory.rerankThreshold ?? defaultVectorMemory.rerankThreshold);
    $('#bakemono-memory-vector-keyword-boost').val(state.vectorMemory.keywordBoost ?? defaultVectorMemory.keywordBoost);
    $('#bakemono-memory-vector-max-chars').val(state.vectorMemory.maxInjectChars ?? defaultVectorMemory.maxInjectChars);
    $('#bakemono-memory-vector-summary-max-chars').val(state.vectorMemory.summaryMaxChars ?? defaultVectorMemory.summaryMaxChars);
    $('#bakemono-memory-vector-start-after-ai').val(state.vectorMemory.startAfterAiMessages ?? defaultVectorMemory.startAfterAiMessages);
    $('#bakemono-memory-vector-skip-context').prop('checked', state.vectorMemory.skipIfAllInContext !== false);
    $('#bakemono-memory-vector-context-window').val(state.vectorMemory.contextWindowMessages ?? defaultVectorMemory.contextWindowMessages);
    $('#bakemono-memory-vector-keywords').val(state.vectorMemory.keywordTriggers || '');
    $('#bakemono-memory-vector-exclude-tags').val(state.vectorMemory.excludeTags || defaultVectorMemory.excludeTags);
    $('#bakemono-memory-vector-summary-tags').val(state.vectorMemory.summaryTags || defaultVectorMemory.summaryTags);
    $('#bakemono-memory-vector-query-mode').val(state.vectorMemory.queryMode || defaultVectorMemory.queryMode);
    $('#bakemono-memory-vector-query-provider').val(state.vectorMemory.queryRewriteProvider || defaultVectorMemory.queryRewriteProvider);
    $('#bakemono-memory-vector-query-prompt').val(state.vectorMemory.queryRewritePrompt || defaultVectorMemory.queryRewritePrompt);
    $('#bakemono-memory-vector-query-base-url').val(state.vectorMemory.queryCustomApi?.baseUrl || '');
    $('#bakemono-memory-vector-query-api-key').val(state.vectorMemory.queryCustomApi?.apiKey || '');
    $('#bakemono-memory-vector-query-model').val(state.vectorMemory.queryCustomApi?.model || '');
    renderVectorQueryModelOptions(state.vectorMemory.queryCustomApi?.models || []);
    $('#bakemono-memory-vector-rerank-mode').val(state.vectorMemory.rerankMode || defaultVectorMemory.rerankMode);
    $('#bakemono-memory-vector-provider').val(state.vectorMemory.embeddingProvider || defaultVectorMemory.embeddingProvider);
    $('#bakemono-memory-vector-base-url').val(state.vectorMemory.customApi?.baseUrl || '');
    $('#bakemono-memory-vector-api-key').val(state.vectorMemory.customApi?.apiKey || '');
    $('#bakemono-memory-vector-model').val(state.vectorMemory.customApi?.model || defaultVectorMemory.customApi.model);
    renderVectorModelOptions(state.vectorMemory.customApi?.models || []);
    const messageRecordCount = unique((state.vectorMemory.records || []).map(record => String(record.messageId))).length;
    const bodyRecordCount = (state.vectorMemory.records || []).filter(record => record.kind !== 'summary').length;
    const summaryRecordCount = (state.vectorMemory.records || []).filter(record => record.kind === 'summary').length;
    const maxIndexed = Number(state.vectorMemory.maxIndexedMessages || 0);
    const fullHitCount = (state.vectorMemory.lastHits || []).filter(hit => hit.recallTier === 'full').length;
    const summaryHitCount = (state.vectorMemory.lastHits || []).filter(hit => hit.recallTier !== 'full').length;
    const hitCount = fullHitCount + summaryHitCount;
    const indexReady = messageRecordCount > 0 && !state.vectorMemory.dirty;
    const indexTime = state.vectorMemory.lastIndexAt ? new Date(state.vectorMemory.lastIndexAt).toLocaleString() : '';
    const providerLabel = state.vectorMemory.embeddingProvider === 'custom-openai' ? '自定义向量' : '本地向量';
    const runtimeLabel = !messageRecordCount
        ? '尚未建立索引'
        : state.vectorMemory.dirty
            ? '索引等待刷新'
            : '索引健康';
    const runtimeDescription = !messageRecordCount
        ? '建立索引后，剪辑台才能从长聊天里找回相关旧剧情。'
        : `${bodyRecordCount} 个正文片段 · ${summaryRecordCount} 个摘要片段${indexTime ? ` · 最近刷新于 ${indexTime}` : ''}${state.vectorMemory.lastRecallSkippedReason ? ` · 上次跳过：${state.vectorMemory.lastRecallSkippedReason}` : ''}`;
    $('#bakemono-memory-vector-runtime-label').text(runtimeLabel);
    $('#bakemono-memory-vector-runtime-badge').text(state.vectorMemory.enabled ? '召回开启' : '召回关闭');
    $('#bakemono-memory-vector-runtime-title').text(`${messageRecordCount} 楼已索引`);
    $('#bakemono-memory-vector-runtime-description').text(runtimeDescription);
    $('#bakemono-memory-vector-meter-bar').css('width', `${!messageRecordCount ? 0 : indexReady ? 100 : 68}%`);
    $('.bakemono-memory-vector-status-hero')
        .toggleClass('is-healthy', indexReady)
        .toggleClass('is-dirty', messageRecordCount > 0 && !indexReady);
    $('#bakemono-memory-vector-result-count').text(`${hitCount} 条`);
    $('#bakemono-memory-vector-config-summary').text(`${providerLabel} · 候选 ${state.vectorMemory.rerankCandidateCount ?? state.vectorMemory.topK ?? defaultVectorMemory.rerankCandidateCount} · 最终 ${state.vectorMemory.finalRecallCount ?? state.vectorMemory.maxRecallMessages ?? defaultVectorMemory.finalRecallCount}`);
    $('#bakemono-memory-vector-stats').text(`索引 ${messageRecordCount} 楼 / 正文 ${bodyRecordCount} 条 / 摘要 ${summaryRecordCount} 条 / 召回全文 ${fullHitCount} 条 / 召回摘要 ${summaryHitCount} 条 / 预计 ${state.vectorMemory.estimatedChars || 0} 字 / 裁剪 ${state.vectorMemory.trimmedHitCount || 0} 个 / ${maxIndexed > 0 ? `最多索引最近 ${maxIndexed} 楼 / ` : ''}${state.vectorMemory.lastRecallSkippedReason ? `跳过：${state.vectorMemory.lastRecallSkippedReason}` : state.vectorMemory.dirty ? `待刷新：${state.vectorMemory.dirtyReason || '有变更'}` : state.vectorMemory.lastIndexAt ? new Date(state.vectorMemory.lastIndexAt).toLocaleString() : '尚未建索引'}`);
    $('#bakemono-memory-vector-query-preview').val((state.vectorMemory.lastQueries || []).join('\n') || state.vectorMemory.lastQuery || getVectorQueryText(state));
    renderVectorResultList(state);
    renderVectorRecallDetails(state);
    renderVectorHitList();
    renderVectorRecordList();
}

function renderVectorRecallDetails(state = ensureState()) {
    const container = document.querySelector('#bakemono-memory-vector-recall-details');
    if (!container) {
        return;
    }
    container.innerHTML = '';
    const queries = state.vectorMemory.lastQueries || [];
    const hits = state.vectorMemory.lastHits || [];
    const intent = String(state.vectorMemory.lastRewriteIntent || '').trim();
    const embeddingCandidates = state.vectorMemory.lastEmbeddingCandidates || [];
    const rerankCandidates = state.vectorMemory.lastRerankCandidates || [];
    const renderRecallItems = (items = [], emptyText = '暂无内容。') => {
        if (!items.length) {
            return `<div class="bakemono-memory-empty">${escapeHtml(emptyText)}</div>`;
        }
        return items.map(item => {
            const tier = item.recallTier === 'full'
                ? '全文'
                : item.recallTier === 'summary'
                    ? '摘要'
                    : item.recallTier === 'dropped'
                        ? '未入档'
                        : item.kind === 'summary'
                            ? '摘要'
                            : '候选';
            const meta = [
                tier,
                `重排 ${item.rerankScore ?? item.score ?? 0}`,
                `相似 ${item.similarity ?? 0}`,
                item.keywordHits ? `关键词 ${item.keywordHits}` : '',
                item.matchedChunks > 1 ? `命中片段 ${item.matchedChunks}` : '',
            ].filter(Boolean).join(' · ');
            return `
                <article class="bakemono-memory-vector-detail-item">
                  <div class="bakemono-memory-vector-detail-head">
                    <strong>${escapeHtml(item.title || `楼层 ${item.messageId}`)}</strong>
                    <span>${escapeHtml(meta)}</span>
                  </div>
                  <div class="bakemono-memory-vector-detail-text">${escapeHtml(item.preview || item.text || '')}</div>
                </article>
            `;
        }).join('');
    };
    const steps = [
        {
            title: `查询重写 · ${queries.length || 0} 条线索`,
            body: [
                intent
                    ? `<div class="bakemono-memory-vector-intent-card"><strong>检索意图</strong><span>${escapeHtml(intent)}</span></div>`
                    : '',
                queries.length
                    ? queries.map((query, index) => `<div class="bakemono-memory-vector-query-row"><strong>线索 ${String(index + 1).padStart(2, '0')}</strong><span>${escapeHtml(query)}</span></div>`).join('')
                    : '<div class="bakemono-memory-empty">暂无查询重写结果。成功召回后会在这里显示多条检索 query。</div>',
            ].filter(Boolean).join(''),
        },
        {
            title: `Embedding 检索 · ${embeddingCandidates.length || 0} 候选`,
            body: renderRecallItems(embeddingCandidates, state.vectorMemory.lastRecallSkippedReason || '暂无候选。'),
        },
        {
            title: `Rerank 分档 · ${rerankCandidates.length || 0} 条`,
            body: renderRecallItems(rerankCandidates, embeddingCandidates.length ? '候选没有进入可注入档位。' : '暂无重排结果。'),
        },
        {
            title: `最终注入 · ${hits.length || 0} 条`,
            body: renderRecallItems(hits, state.vectorMemory.lastRecallSkippedReason || '暂无最终注入。'),
        },
    ];
    const fragment = document.createDocumentFragment();
    steps.forEach((step, index) => {
        const details = document.createElement('details');
        details.className = 'bakemono-memory-vector-step';
        if (index === 0 && queries.length) {
            details.open = true;
        }
        details.innerHTML = `<summary><span>${index + 1} · ${escapeHtml(step.title)}</span><i class="fa-solid fa-chevron-down"></i></summary><div class="bakemono-memory-vector-step-body">${step.body}</div>`;
        fragment.append(details);
    });
    container.append(fragment);
}

function renderVectorHitList(state = ensureState()) {
    const container = document.querySelector('#bakemono-memory-vector-hit-list');
    if (!container) {
        return;
    }
    container.innerHTML = '';
    const hits = state.vectorMemory.lastHits || [];
    if (!hits.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无召回。启用后先建立索引，或点击“测试召回”。';
        container.append(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    hits.forEach(hit => {
        const item = document.createElement('section');
        item.className = 'bakemono-memory-vector-hit';
        const tierLabel = hit.recallTier === 'full' ? '全文' : '摘要';
        item.innerHTML = `
            <div class="bakemono-memory-vector-hit-head">
                <strong>${escapeHtml(hit.title || `楼层 ${hit.messageId}`)}</strong>
                <span>${tierLabel} · 重排 ${escapeHtml(hit.rerankScore ?? hit.score ?? 0)} · 相似度 ${escapeHtml(hit.similarity ?? 0)}${hit.keywordHits ? ` · 关键词 ${escapeHtml(hit.keywordHits)}` : ''}${hit.matchedChunks > 1 ? ` · 命中片段 ${escapeHtml(hit.matchedChunks)}` : ''}</span>
            </div>
            <div class="bakemono-memory-vector-snippet">${escapeHtml(hit.preview || hit.text || '')}</div>
        `;
        fragment.append(item);
    });
    container.append(fragment);
}

function renderVectorRecordList(state = ensureState()) {
    const container = document.querySelector('#bakemono-memory-vector-record-list');
    if (!container) {
        return;
    }
    container.innerHTML = '';
    const records = (state.vectorMemory.records || [])
        .slice()
        .sort((a, b) => {
            const priority = record => record.isSavedSummary ? 0 : record.kind === 'summary' ? 1 : record.kind === 'message' ? 2 : 3;
            return priority(a) - priority(b)
                || Number(a.messageId) - Number(b.messageId)
                || Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0);
        })
        .slice(0, 16);
    if (!records.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无索引片段。';
        container.append(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    records.forEach(record => {
        const item = document.createElement('div');
        item.className = 'bakemono-memory-debug-item';
        const typeLabel = record.isSavedSummary
            ? '保存摘要索引'
            : record.kind === 'summary'
                ? '摘要索引'
                : record.kind === 'message'
                    ? '楼层索引'
                    : '片段索引';
        item.innerHTML = `
            <div class="bakemono-memory-debug-meta">${escapeHtml(record.title)} · ${typeLabel} · ${record.isHidden ? '隐藏' : '可见'}</div>
            <div class="bakemono-memory-debug-text">${escapeHtml(record.preview || record.text || '')}</div>
        `;
        fragment.append(item);
    });
    container.append(fragment);
}

function renderReviewPanelTabs(state = ensureState()) {
    const counts = {
        drafts: state.drafts.length,
        tasks: state.taskQueue.length,
        history: state.history.length,
    };
    $('#bakemono-memory-review-draft-count').text(counts.drafts);
    $('#bakemono-memory-review-task-count').text(counts.tasks);
    $('#bakemono-memory-review-history-count').text(counts.history);
    document.querySelectorAll('[data-bakemono-review-view]').forEach(button => {
        const isActive = button.dataset.bakemonoReviewView === reviewPanelView;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('[data-bakemono-review-panel]').forEach(panel => {
        const isActive = panel.dataset.bakemonoReviewPanel === reviewPanelView;
        panel.classList.toggle('is-active', isActive);
        panel.hidden = !isActive;
    });
}

function renderVectorResultList(state = ensureState()) {
    const container = document.querySelector('#bakemono-memory-vector-result-list');
    if (!container) {
        return;
    }
    container.innerHTML = '';
    const hits = (state.vectorMemory.lastHits || []).slice(0, 4);
    if (!hits.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-vector-result-empty';
        empty.innerHTML = '<i class="fa-solid fa-bullseye"></i><div><strong>还没有召回结果</strong><span>建立索引后输入一段剧情线索，测试最相关的旧记忆。</span></div>';
        container.append(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    hits.forEach(hit => {
        const scoreValue = Number(hit.rerankScore ?? hit.score ?? hit.similarity ?? 0);
        const normalizedScore = Number.isFinite(scoreValue) ? scoreValue : 0;
        const score = Math.max(0, Math.min(100, Math.round(normalizedScore <= 1 ? normalizedScore * 100 : normalizedScore)));
        const item = document.createElement('article');
        item.className = 'bakemono-memory-vector-result-item';
        const tier = hit.recallTier === 'full' ? '全文' : '摘要';
        const sourceRange = formatSourceRange(hit.sourceMessageIds || [hit.messageId]);
        item.innerHTML = `
            <span class="bakemono-memory-vector-result-score">${score}%</span>
            <div>
              <strong>${escapeHtml(hit.title || `楼层 ${hit.messageId}`)}</strong>
              <p>${escapeHtml(hit.preview || hit.text || '暂无预览内容')}</p>
              <small>${escapeHtml([tier, sourceRange].filter(Boolean).join(' · '))}</small>
            </div>
        `;
        fragment.append(item);
    });
    container.append(fragment);
}

function renderDrafts() {
    const state = ensureState();
    const container = document.querySelector('#bakemono-memory-draft-list');
    if (!container) {
        return;
    }

    renderReviewPanelTabs(state);
    container.innerHTML = '';
    const missingDraftCount = state.drafts.filter(draft => draft.metadata?.appendMode === 'missing_summary').length;
    const missingTaskCount = state.taskQueue.filter(task => isMissingSummaryTask(task) && ['queued', 'failed', 'done'].includes(task.status)).length;
    if (missingDraftCount || missingTaskCount) {
        const bulkActions = document.createElement('div');
        bulkActions.className = 'bakemono-memory-inline-actions bakemono-memory-draft-bulk-actions';
        bulkActions.innerHTML = `
            ${missingDraftCount ? `
            <button class="menu_button" data-bakemono-action="commit-missing-all">
                <i class="fa-solid fa-file-circle-check"></i>
                <span>一键应用缺失摘要 ${missingDraftCount}</span>
            </button>` : ''}
            <button class="menu_button danger" data-bakemono-action="remove-missing-all">
                <i class="fa-solid fa-broom"></i>
                <span>移除缺失摘要待处理 ${missingDraftCount + missingTaskCount}</span>
            </button>
        `;
        container.append(bulkActions);
    }
    if (!state.drafts.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无待确认草稿。自动总结和手动生成都会先放在这里。';
        container.append(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    state.drafts.forEach(draft => {
        const card = document.createElement('article');
        card.className = 'bakemono-memory-draft-card';
        card.dataset.draftId = draft.id;

        const header = document.createElement('div');
        header.className = 'bakemono-memory-draft-header';
        const badge = document.createElement('span');
        badge.className = `bakemono-memory-draft-kind is-${draft.kind || 'story'}`;
        badge.textContent = getKindLabel(draft.kind);
        const time = document.createElement('small');
        time.textContent = draft.createdAt ? new Date(draft.createdAt).toLocaleString() : '刚刚生成';
        header.append(badge, time);

        const titleWrap = document.createElement('label');
        titleWrap.className = 'bakemono-memory-draft-title-field';
        const titleInput = document.createElement('input');
        titleInput.className = 'text_pole bakemono-memory-draft-title';
        titleInput.type = 'text';
        titleInput.value = draft.title || '';
        titleInput.placeholder = '草稿标题';
        titleInput.setAttribute('aria-label', '草稿标题');
        titleWrap.append(titleInput);

        const preview = document.createElement('p');
        preview.className = 'bakemono-memory-draft-preview';
        preview.textContent = String(draft.content || '').replace(/\s+/g, ' ').trim().slice(0, 180) || '草稿尚无正文内容。';

        const meta = document.createElement('div');
        meta.className = 'bakemono-memory-draft-meta';
        const draftMeta = draft.metadata?.sourceRange
            ? `${draft.metadata.sourceRange}${draft.metadata.batchIndex ? ` · 第 ${draft.metadata.batchIndex}/${draft.metadata.batchTotal || '?'} 批` : ''}`
            : '';
        const appendLabel = draft.metadata?.appendMode === 'missing_summary' ? '确认后追加到原助手楼层' : '';
        [draftMeta, appendLabel, draft.trigger || 'manual'].filter(Boolean).forEach(text => {
            const item = document.createElement('span');
            item.textContent = text;
            meta.append(item);
        });

        const textarea = document.createElement('textarea');
        textarea.className = 'text_pole textarea_compact bakemono-memory-draft-editor';
        textarea.rows = 9;
        textarea.spellcheck = false;
        textarea.value = draft.content || '';

        const editorDetails = document.createElement('details');
        editorDetails.className = 'bakemono-memory-draft-editor-disclosure bakemono-memory-console-disclosure';
        editorDetails.innerHTML = '<summary><span><i class="fa-solid fa-pen-to-square"></i> 查看并编辑完整草稿</span><small>修改正文、重新总结或丢弃</small></summary>';
        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'bakemono-memory-inline-actions bakemono-memory-draft-secondary-actions';
        secondaryActions.innerHTML = `
            <button class="menu_button" data-bakemono-draft-action="regenerate"><i class="fa-solid fa-rotate"></i><span>重新总结</span></button>
            <button class="menu_button danger_button" data-bakemono-draft-action="discard"><i class="fa-solid fa-trash"></i><span>丢弃草稿</span></button>
        `;
        editorDetails.append(textarea, secondaryActions);

        const actions = document.createElement('div');
        actions.className = 'bakemono-memory-draft-actions';
        actions.innerHTML = `
            <button class="menu_button" type="button" data-bakemono-draft-editor-toggle><i class="fa-solid fa-pen"></i><span>继续编辑</span></button>
            <button class="menu_button bakemono-memory-draft-commit" data-bakemono-draft-action="commit"><i class="fa-solid fa-check"></i><span>确认保存</span></button>
        `;

        card.append(header, titleWrap, preview, meta, editorDetails, actions);
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

    renderReviewPanelTabs(state);
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

    const fragment = document.createDocumentFragment();
    visibleHistory.forEach(item => {
        const row = document.createElement('div');
        row.className = 'bakemono-memory-history-item';
        const marker = document.createElement('span');
        marker.className = `bakemono-memory-history-marker is-${item.kind || 'story'}`;
        marker.textContent = item.kind === blockTypes.EPIC ? 'E' : item.kind === blockTypes.STAGE ? 'S' : '#';
        const main = document.createElement('div');
        main.className = 'bakemono-memory-history-main';
        const title = document.createElement('strong');
        title.textContent = item.summary?.title || item.draft?.title || item.summaryHash;
        const kind = document.createElement('span');
        kind.textContent = getKindLabel(item.kind);
        main.append(title, kind);
        const time = document.createElement('time');
        time.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
        row.append(marker, main, time);
        fragment.append(row);
    });
    container.append(fragment, controls);
}

function renderTaskQueue() {
    const state = ensureState();
    const container = document.querySelector('#bakemono-memory-task-list');
    if (!container) {
        return;
    }

    renderReviewPanelTabs(state);
    container.innerHTML = '';
    const removableTaskStatuses = new Set(['queued', 'failed', 'done']);
    const missingTaskCount = state.taskQueue.filter(task => isMissingSummaryTask(task) && removableTaskStatuses.has(task.status)).length;
    const stuckTaskCount = state.taskQueue.filter(task => task.status === 'running').length;
    if (missingTaskCount || stuckTaskCount) {
        const bulkActions = document.createElement('div');
        bulkActions.className = 'bakemono-memory-inline-actions bakemono-memory-draft-bulk-actions';
        bulkActions.innerHTML = `
            ${stuckTaskCount ? `
            <button class="menu_button danger" data-bakemono-action="clear-stuck-tasks">
                <i class="fa-solid fa-unlink"></i>
                <span>解除卡住任务 ${stuckTaskCount}</span>
            </button>` : ''}
            ${missingTaskCount ? `
            <button class="menu_button danger" data-bakemono-action="remove-missing-all">
                <i class="fa-solid fa-broom"></i>
                <span>移除缺失摘要任务 ${missingTaskCount}</span>
            </button>` : ''}
        `;
        container.append(bulkActions);
    }
    if (!state.taskQueue.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无任务。生成阶段总结、多次总结或旧正文补课时，会先进入这里排队。';
        container.append(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    state.taskQueue.slice().reverse().forEach(task => {
        const row = document.createElement('div');
        row.className = `bakemono-memory-task-item is-${task.status || 'queued'}`;
        row.dataset.taskId = task.id;

        const marker = document.createElement('span');
        marker.className = 'bakemono-memory-task-marker';
        const markerIcon = document.createElement('i');
        markerIcon.className = task.status === 'running'
            ? 'fa-solid fa-spinner fa-spin'
            : task.status === 'done'
                ? 'fa-solid fa-check'
                : task.status === 'failed'
                    ? 'fa-solid fa-exclamation'
                    : 'fa-solid fa-clock';
        marker.append(markerIcon);

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
        const removeLabel = task.status === 'running' ? '强制移除' : '移除';
        actions.insertAdjacentHTML('beforeend', `<button class="menu_button${task.status === 'running' ? ' danger' : ''}" data-bakemono-task-action="remove"><i class="fa-solid fa-xmark"></i><span>${removeLabel}</span></button>`);
        row.append(marker, main, actions);
        fragment.append(row);
    });
    container.append(fragment);
}

function renderAutoSummaryTransactions(container, state = ensureState(), options = {}) {
    const transactions = (state.autoSummaryTransactions || [])
        .filter(transaction => transaction.status !== 'rolled_back')
        .slice(0, 8);
    if (!transactions.length) {
        return;
    }

    const panel = document.createElement('div');
    panel.className = 'bakemono-memory-auto-tx-list';
    if (options.showTitle !== false) {
        const title = document.createElement('div');
        title.className = 'bakemono-memory-auto-tx-title';
        title.innerHTML = '<i class="fa-solid fa-shield-halved"></i><strong>自动总结回滚</strong><span>只处理自动保存并自动隐藏的总结</span>';
        panel.append(title);
    }

    for (const transaction of transactions) {
        const item = document.createElement('div');
        item.className = `bakemono-memory-auto-tx-item is-${transaction.status || 'active'}`;
        item.dataset.transactionId = transaction.id;
        const sourceRange = formatSourceRange(transaction.sourceMessageIds || []);
        const hiddenCount = getFiniteMessageIds(transaction.hiddenMessageIds || []).length;
        const invalidIds = getFiniteMessageIds(transaction.invalidatedMessageIds || []);
        item.innerHTML = `
            <div class="bakemono-memory-auto-tx-main">
                <strong>${escapeHtml(transaction.summaryTitle || getKindLabel(transaction.kind) || '自动总结')}</strong>
                <span>${transaction.status === 'needs_review' ? '来源楼层已变更' : '已记录'} · ${sourceRange || '未知范围'} · 可恢复 ${hiddenCount} 楼</span>
                ${invalidIds.length ? `<em>变更楼层：${invalidIds.map(id => `#${id}`).join('、')}</em>` : ''}
            </div>
            <div class="bakemono-memory-task-actions">
                <button class="menu_button danger" data-bakemono-auto-tx-action="rollback">
                    <i class="fa-solid fa-rotate-left"></i>
                    <span>回滚</span>
                </button>
            </div>
        `;
        panel.append(item);
    }
    container.append(panel);
}

function getMaintenanceRecordTimestamp(item = {}) {
    const value = item.createdAt || item.appliedAt || item.rolledBackAt || item.undoneAt || '';
    const timestamp = value ? new Date(value).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function renderMaintenanceOverview(state = ensureState()) {
    const latest = state.history?.[0] || null;
    const autoTransactions = (state.autoSummaryTransactions || []).filter(item => item.status !== 'rolled_back');
    const latestAuto = latest
        ? autoTransactions.find(item => item.summaryHash === latest.summaryHash)
        : null;
    const sourceIds = unique(getFiniteMessageIds([
        ...(latest?.summary?.sourceMessageIds || []),
        ...(latest?.draft?.sourceMessageIds || []),
    ]));
    const coveredCount = (latest?.coveredBlockHashes || []).length + (latest?.coveredStageHashes || []).length;
    const hiddenCount = latestAuto ? getFiniteMessageIds(latestAuto.hiddenMessageIds || []).length : 0;
    const latestTitle = latest?.summary?.title || latest?.draft?.title || (latest ? getKindLabel(latest.kind) : '暂无可撤回记录');
    const impact = [];
    if (latest) {
        impact.push(`${getKindLabel(latest.kind) || '总结'} 1 条`);
        if (sourceIds.length) impact.push(`来源 ${sourceIds.length} 楼`);
        if (coveredCount) impact.push(`覆盖标记 ${coveredCount} 个`);
        if (hiddenCount) impact.push(`可恢复 ${hiddenCount} 楼`);
    }
    $('#bakemono-memory-maintenance-latest-title').text(latestTitle);
    $('#bakemono-memory-maintenance-latest-impact').text(latest
        ? `影响：${impact.join('、')}。撤回前仍会再次确认。`
        : '保存阶段总结或多次总结后，这里会先列出影响范围。');
    $('#bakemono-memory-maintenance-undo')
        .prop('disabled', !latest)
        .attr('title', latest ? `撤回「${latestTitle}」` : '暂无可撤回记录');

    $('#bakemono-memory-maintenance-hidden-count').text(getActualHiddenMessageIds().length.toLocaleString());
    $('#bakemono-memory-maintenance-task-count').text((state.taskQueue || []).length.toLocaleString());
    $('#bakemono-memory-maintenance-snapshot-count').text((state.tableDatabase?.undoStack || []).length.toLocaleString());
    $('#bakemono-memory-maintenance-auto-count').text(`${autoTransactions.length.toLocaleString()} 条`);

    const autoContainer = document.querySelector('#bakemono-memory-maintenance-auto-transactions');
    if (autoContainer) {
        autoContainer.innerHTML = '';
        renderAutoSummaryTransactions(autoContainer, state, { showTitle: false });
        if (!autoContainer.childElementCount) {
            const empty = document.createElement('div');
            empty.className = 'bakemono-memory-maintenance-empty';
            empty.innerHTML = '<i class="fa-solid fa-shield-heart"></i><span><strong>暂无待处理事务</strong><small>自动保存并隐藏楼层后，可回滚记录会出现在这里。</small></span>';
            autoContainer.append(empty);
        }
    }

    const recordContainer = document.querySelector('#bakemono-memory-maintenance-records');
    if (!recordContainer) {
        return;
    }
    recordContainer.innerHTML = '';
    const summaryRecords = (state.history || []).map(item => ({
        type: 'summary',
        title: item.summary?.title || item.draft?.title || getKindLabel(item.kind) || '总结保存',
        meta: `${getKindLabel(item.kind) || '总结'} · 已保存到长期记忆`,
        createdAt: item.createdAt,
        icon: 'fa-solid fa-floppy-disk',
    }));
    const tableRecords = (state.tableDatabase?.history || []).map(item => ({
        type: 'table',
        title: item.title || item.label || '表格记忆已更新',
        meta: '表格事务 · 已保留撤回快照',
        createdAt: item.appliedAt || item.createdAt,
        icon: 'fa-solid fa-table',
    }));
    const rollbackRecords = (state.tableDatabase?.rollbackHistory || []).map(item => ({
        type: 'rollback',
        title: item.reason || '表格事务已回滚',
        meta: `${(item.rollbackSnapshotIds || []).length} 个快照 · ${(item.sourceMessageIds || []).length} 个来源楼层`,
        createdAt: item.createdAt || item.rolledBackAt,
        icon: 'fa-solid fa-rotate-left',
    }));
    const records = [...summaryRecords, ...tableRecords, ...rollbackRecords]
        .sort((a, b) => getMaintenanceRecordTimestamp(b) - getMaintenanceRecordTimestamp(a))
        .slice(0, 10);
    if (!records.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-maintenance-empty is-quiet';
        empty.innerHTML = '<i class="fa-solid fa-receipt"></i><span><strong>还没有操作记录</strong><small>保存总结、应用表格或回滚事务后会留下足迹。</small></span>';
        recordContainer.append(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    records.forEach(record => {
        const row = document.createElement('article');
        row.className = `bakemono-memory-maintenance-record is-${record.type}`;
        const time = record.createdAt ? new Date(record.createdAt).toLocaleString() : '时间未记录';
        row.innerHTML = `
            <span class="bakemono-memory-maintenance-record-icon"><i class="${record.icon}"></i></span>
            <span class="bakemono-memory-maintenance-record-copy">
                <strong>${escapeHtml(record.title)}</strong>
                <small>${escapeHtml(record.meta)}</small>
            </span>
            <time>${escapeHtml(time)}</time>
        `;
        fragment.append(row);
    });
    recordContainer.append(fragment);
}

function exportMaintenanceTransactions() {
    const state = ensureState();
    const payload = {
        exportedAt: new Date().toISOString(),
        summaryHistory: state.history || [],
        autoSummaryTransactions: state.autoSummaryTransactions || [],
        tableUndoStack: state.tableDatabase?.undoStack || [],
        tableRollbackHistory: state.tableDatabase?.rollbackHistory || [],
        hiddenMessageIds: getActualHiddenMessageIds(),
        taskQueue: state.taskQueue || [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bakemono-transactions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toastr.success('事务记录已导出。');
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
    $('#bakemono-memory-timeline-story-count').text(storyBlocks.length);
    $('#bakemono-memory-timeline-stage-count').text(stageBlocks.length);
    $('#bakemono-memory-timeline-epic-count').text(epicBlocks.length);

    container.innerHTML = '';
    if (!storyBlocks.length && !stageBlocks.length && !epicBlocks.length) {
        const empty = document.createElement('div');
        empty.className = 'bakemono-memory-empty';
        empty.textContent = '暂无摘要树。扫描或保存草稿后会显示覆盖关系。';
        container.append(empty);
        return;
    }

    const makeStoryNode = story => createTimelineNode(story, 'story');
    const makeStageNode = stage => createTimelineNode(
        stage,
        'stage',
        (stage.sourceHashes || []).map(hash => byHash.get(hash)).filter(Boolean).map(makeStoryNode),
    );
    const makeEpicNode = epic => {
        const sourceHashes = unique([...(epic.sourceStageHashes || []), ...(epic.sourceHashes || [])]);
        const children = sourceHashes
            .map(hash => {
                const block = byHash.get(hash);
                if (!block) {
                    return null;
                }
                if (block.type === blockTypes.EPIC || block.kind === blockTypes.EPIC) {
                    return makeEpicNode(block);
                }
                if (block.type === blockTypes.STAGE || block.kind === blockTypes.STAGE) {
                    return makeStageNode(block);
                }
                return makeStoryNode(block);
            })
            .filter(Boolean);
        return createTimelineNode(epic, 'epic', children);
    };

    const rootFactories = [];
    const epicCoveredStage = new Set(state.epicSummaries.flatMap(summary => [
        ...(summary.sourceStageHashes || []),
        ...(summary.sourceHashes || []),
    ]));
    for (const epic of state.epicSummaries.filter(summary => !epicCoveredStage.has(summary.hash))) {
        rootFactories.push(() => makeEpicNode({ ...summaryToBlock(epic), type: blockTypes.EPIC }));
    }

    for (const stage of state.stageSummaries.filter(summary => !epicCoveredStage.has(summary.hash))) {
        rootFactories.push(() => makeStageNode(stage));
    }

    const coveredStory = new Set([
        ...state.stageSummaries.flatMap(summary => summary.sourceHashes || []),
        ...state.epicSummaries.flatMap(summary => (summary.sourceHashes || []).filter(hash => byHash.get(hash)?.type === blockTypes.STORY)),
    ]);
    for (const story of storyBlocks.filter(block => !coveredStory.has(block.hash))) {
        rootFactories.push(() => createTimelineNode(story, 'story'));
    }

    const pageCount = Math.max(1, Math.ceil(rootFactories.length / timelinePageSize));
    timelineState.page = Math.min(Math.max(0, timelineState.page || 0), pageCount - 1);
    const start = timelineState.page * timelinePageSize;
    const visibleRoots = rootFactories.slice(start, start + timelinePageSize).map(createRoot => createRoot());
    const pager = createTimelinePager(start, rootFactories.length, pageCount);
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
    if (kind === 'epic') {
        details.open = true;
    }

    const summary = document.createElement('summary');
    const marker = document.createElement('span');
    marker.className = 'bakemono-memory-timeline-dot';
    marker.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'bakemono-memory-timeline-copy';
    const kindLabel = document.createElement('small');
    const label = document.createElement('strong');
    const kindText = kind === blockTypes.EPIC || kind === 'epic' ? getMultiSummaryLabel(item) : getKindLabel(kind);
    kindLabel.textContent = kindText;
    label.textContent = item.title || getBlockTitle(item.content, '未命名');
    const meta = document.createElement('span');
    meta.className = 'bakemono-memory-timeline-meta';
    const sourceCount = Array.isArray(item.sourceHashes) ? item.sourceHashes.length : 0;
    meta.textContent = getTimelineMetaText(item, sourceCount);
    copy.append(kindLabel, label, meta);
    const toggle = document.createElement('i');
    toggle.className = 'fa-solid fa-chevron-right bakemono-memory-timeline-toggle';
    toggle.setAttribute('aria-hidden', 'true');
    summary.append(marker, copy, toggle);
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
        return '多次总结';
    }
    return '阶段总结';
}

function renderPromptPresetControls() {
    renderPresetControlPair('#bakemono-memory-preset-select', '#bakemono-memory-preset-name');
    renderAreaPresetControl(areaPresetScopes.SCAN, '#bakemono-memory-scan-preset-select', '#bakemono-memory-scan-preset-name');
    renderAreaPresetControl(areaPresetScopes.AUTOMATION, '#bakemono-memory-automation-preset-select', '#bakemono-memory-automation-preset-name');
    renderAreaPresetControl(areaPresetScopes.API, '#bakemono-memory-api-preset-select', '#bakemono-memory-api-preset-name');
    renderAreaPresetControl(areaPresetScopes.PROMPTS, '#bakemono-memory-prompts-preset-select', '#bakemono-memory-prompts-preset-name');
    renderAreaPresetControl(areaPresetScopes.TURN, '#bakemono-memory-turn-preset-select', '#bakemono-memory-turn-preset-name');
    renderAreaPresetControl(areaPresetScopes.INJECTION, '#bakemono-memory-injection-preset-select', '#bakemono-memory-injection-preset-name');
    renderAreaPresetControl(areaPresetScopes.VECTOR, '#bakemono-memory-vector-preset-select', '#bakemono-memory-vector-preset-name');
}

function renderPresetControlPair(selectSelector, nameSelector) {
    const select = document.querySelector(selectSelector);
    if (!select) {
        return;
    }

    const selectedId = getSelectedPromptPresetId();
    const presets = getPromptPresets();
    select.innerHTML = '';
    for (const preset of presets) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name || '未命名预设';
        select.append(option);
    }
    select.value = presets.some(preset => preset.id === selectedId) ? selectedId : (presets[0]?.id || '');

    const selected = presets.find(preset => preset.id === select.value);
    $(nameSelector).val(selected?.name || '');
    const active = getActiveGlobalConfig();
    $('#bakemono-memory-active-config-status').text(
        `当前全局默认：${active?.name || '未设置'}。新聊天会自动使用这套配置；剧情摘要、草稿、表格行数据仍按聊天单独保存。`,
    );
}

function renderAreaPresetControl(scope, selectSelector, nameSelector) {
    const select = document.querySelector(selectSelector);
    if (!select) {
        return;
    }

    const selectedId = getSelectedAreaPresetId(scope);
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '选择已保存配置';
    select.append(placeholder);
    for (const preset of getAreaPresets(scope)) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name || '未命名配置';
        select.append(option);
    }
    select.value = selectedId;

    const selected = getAreaPresets(scope).find(preset => preset.id === select.value);
    $(nameSelector).val(selected?.name || '');
}

function renderCustomModelOptions(models = []) {
    const list = document.querySelector('#bakemono-memory-custom-model-options');
    if (!list) {
        return;
    }
    list.innerHTML = '';
    for (const model of unique(models.map(item => String(item || '').trim()).filter(Boolean)).sort()) {
        const option = document.createElement('option');
        option.value = model;
        list.append(option);
    }
}

function renderVectorModelOptions(models = []) {
    const list = document.querySelector('#bakemono-memory-vector-model-options');
    if (!list) {
        return;
    }
    list.innerHTML = '';
    for (const model of unique(models.map(item => String(item || '').trim()).filter(Boolean)).sort()) {
        const option = document.createElement('option');
        option.value = model;
        list.append(option);
    }
}

function renderVectorQueryModelOptions(models = []) {
    const list = document.querySelector('#bakemono-memory-vector-query-model-options');
    if (!list) {
        return;
    }
    list.innerHTML = '';
    for (const model of unique(models.map(item => String(item || '').trim()).filter(Boolean)).sort()) {
        const option = document.createElement('option');
        option.value = model;
        list.append(option);
    }
}

function readRuleFieldsFromUi(state = ensureState()) {
    if (!$('#bakemono-memory-scan-mode').length) {
        return state;
    }
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
    return state;
}

function readAutomationFieldsFromUi(state = ensureState()) {
    if (!$('#bakemono-memory-auto-mode').length) {
        return state;
    }
    readCustomApiFieldsFromUi(state);
    state.automation = {
        ...state.automation,
        enabled: $('#bakemono-memory-auto-enabled').prop('checked'),
        mode: String($('#bakemono-memory-auto-mode').val() || defaultAutomation.mode),
        triggerType: String($('#bakemono-memory-auto-trigger').val() || defaultAutomation.triggerType),
        floorInterval: Math.max(1, Number($('#bakemono-memory-auto-floor-interval').val() || defaultAutomation.floorInterval)),
        charInterval: Math.max(100, Number($('#bakemono-memory-auto-char-interval').val() || defaultAutomation.charInterval)),
        backfillBatchSize: $('#bakemono-memory-backfill-batch-size').length
            ? Math.max(1, Number($('#bakemono-memory-backfill-batch-size').val() || state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize))
            : Math.max(1, Number(state.automation.backfillBatchSize || defaultAutomation.backfillBatchSize)),
        autoHidePreserveRecent: Math.max(0, Number($('#bakemono-memory-auto-hide-preserve-recent').val() || defaultAutomation.autoHidePreserveRecent)),
    };
    return state;
}

function readCustomApiFieldsFromUi(state = ensureState()) {
    if (!$('#bakemono-memory-api-provider').length) {
        return state;
    }
    state.automation = state.automation && typeof state.automation === 'object'
        ? state.automation
        : structuredClone(defaultAutomation);
    const currentModels = Array.isArray(state.automation.customApi?.models)
        ? state.automation.customApi.models
        : [];
    state.automation.apiProvider = String($('#bakemono-memory-api-provider').val() || defaultAutomation.apiProvider);
    state.automation.customApi = {
        ...structuredClone(defaultAutomation.customApi),
        ...(state.automation.customApi || {}),
        baseUrl: String($('#bakemono-memory-custom-base-url').val() || '').trim(),
        apiKey: String($('#bakemono-memory-custom-api-key').val() || '').trim(),
        model: String($('#bakemono-memory-custom-model').val() || '').trim(),
        temperature: Number($('#bakemono-memory-custom-temperature').val() || defaultAutomation.customApi.temperature),
        maxTokens: Number($('#bakemono-memory-custom-max-tokens').val() || defaultAutomation.customApi.maxTokens),
        stream: String($('#bakemono-memory-custom-stream').val() || 'false') === 'true',
        models: currentModels,
    };
    return state;
}

function readPromptFieldsFromUi(state = ensureState()) {
    if (!$('#bakemono-memory-stage-prompt').length) {
        return state;
    }
    state.generationPrompts.story = String($('#bakemono-memory-story-prompt').val() || defaultStoryGenerationPrompt);
    state.generationPrompts.missing = String($('#bakemono-memory-missing-prompt').val() || defaultMissingSummaryPrompt);
    state.generationPrompts.stage = String($('#bakemono-memory-stage-prompt').val() || defaultStageGenerationPrompt);
    state.generationPrompts.epic = String($('#bakemono-memory-epic-prompt').val() || defaultEpicGenerationPrompt);
    return state;
}

function readTurnSummaryFieldsFromUi(state = ensureState()) {
    if (!$('#bakemono-memory-turn-enabled').length) {
        return state;
    }
    state.turnSummary = {
        ...state.turnSummary,
        enabled: $('#bakemono-memory-turn-enabled').prop('checked'),
        auto: $('#bakemono-memory-turn-auto').prop('checked'),
        processingMode: String($('#bakemono-memory-turn-processing-mode').val() || turnProcessingModes.BOTH),
        saveMode: $('#bakemono-memory-turn-auto-save').prop('checked') ? 'commit' : 'draft',
        includeUserMessage: $('#bakemono-memory-turn-include-user').prop('checked'),
        includeCharacterContext: $('#bakemono-memory-turn-include-character').prop('checked'),
        includeWorldInfo: $('#bakemono-memory-turn-include-world-info').prop('checked'),
        worldInfoMaxContext: Math.max(1024, Number($('#bakemono-memory-turn-world-max-context').val() || defaultState.turnSummary.worldInfoMaxContext)),
        referenceContext: String($('#bakemono-memory-turn-reference').val() || ''),
        prompt: String($('#bakemono-memory-turn-prompt').val() || defaultTurnSummaryPrompt),
        tablePrompt: String($('#bakemono-memory-table-prompt').val() || defaultTableEditPrompt),
    };
    state.tableDatabase = {
        ...state.tableDatabase,
        enabled: $('#bakemono-memory-table-enabled').prop('checked'),
        injectMemory: $('#bakemono-memory-table-inject-memory').length ? $('#bakemono-memory-table-inject-memory').prop('checked') : state.tableDatabase.injectMemory !== false,
        autoApply: $('#bakemono-memory-table-auto-apply').prop('checked'),
        schemaScope: String($('#bakemono-memory-table-schema-scope').val() || state.tableDatabase.schemaScope || tableSchemaScopes.CHAT),
    };
    state.inlineGeneration = {
        ...state.inlineGeneration,
        summaryEnabled: $('#bakemono-memory-inline-summary-enabled').prop('checked'),
        tableEnabled: $('#bakemono-memory-inline-table-enabled').prop('checked'),
        hideTableEdit: $('#bakemono-memory-inline-hide-table').prop('checked'),
        summaryPrompt: String($('#bakemono-memory-inline-summary-prompt').val() || defaultInlineSummaryPrompt),
        tablePrompt: String($('#bakemono-memory-inline-table-prompt').val() || defaultInlineTablePrompt),
    };
    setTableSchemaScope(state.tableDatabase.schemaScope, state);
    return state;
}

function readInjectionFieldsFromUi(state = ensureState()) {
    if (!$('#bakemono-memory-injection-template').length) {
        return state;
    }
    state.injection = {
        ...state.injection,
        enabled: $('#bakemono-memory-injection-enabled').prop('checked'),
        depth: Math.max(0, Number($('#bakemono-memory-depth').val() || defaultState.injection.depth)),
        role: Number($('#bakemono-memory-role').val() || extension_prompt_roles.SYSTEM),
        template: String($('#bakemono-memory-injection-template').val() || defaultInjectionTemplate),
    };
    return state;
}

function readVectorMemoryFieldsFromUi(state = ensureState()) {
    if (!$('#bakemono-memory-vector-enabled').length) {
        return state;
    }
    const previousRecords = Array.isArray(state.vectorMemory?.records) ? state.vectorMemory.records : [];
    const previousHits = Array.isArray(state.vectorMemory?.lastHits) ? state.vectorMemory.lastHits : [];
    const previousEmbeddingCandidates = Array.isArray(state.vectorMemory?.lastEmbeddingCandidates) ? state.vectorMemory.lastEmbeddingCandidates : [];
    const previousRerankCandidates = Array.isArray(state.vectorMemory?.lastRerankCandidates) ? state.vectorMemory.lastRerankCandidates : [];
    const previousCache = {};
    state.vectorMemory = {
        ...structuredClone(defaultVectorMemory),
        ...(state.vectorMemory || {}),
        enabled: $('#bakemono-memory-vector-enabled').prop('checked'),
        autoIndex: $('#bakemono-memory-vector-auto-index').length ? $('#bakemono-memory-vector-auto-index').prop('checked') : state.vectorMemory?.autoIndex !== false,
        includeHidden: $('#bakemono-memory-vector-include-hidden').prop('checked'),
        includeUser: $('#bakemono-memory-vector-include-user').length ? $('#bakemono-memory-vector-include-user').prop('checked') : state.vectorMemory?.includeUser === true,
        indexMode: String($('#bakemono-memory-vector-index-mode').val() || defaultVectorMemory.indexMode),
        injectMode: String($('#bakemono-memory-vector-inject-mode').val() || defaultVectorMemory.injectMode),
        maxIndexedMessages: Math.max(0, Number($('#bakemono-memory-vector-max-indexed-messages').val() === '' ? defaultVectorMemory.maxIndexedMessages : $('#bakemono-memory-vector-max-indexed-messages').val())),
        maxStoredTextChars: Math.max(240, Number($('#bakemono-memory-vector-max-stored-text-chars').val() || defaultVectorMemory.maxStoredTextChars)),
        embeddingDimensions: Math.max(32, Number(state.vectorMemory?.embeddingDimensions || defaultVectorMemory.embeddingDimensions)),
        chunkSize: Math.max(240, Number($('#bakemono-memory-vector-chunk-size').val() || defaultVectorMemory.chunkSize)),
        overlap: Math.max(0, Number($('#bakemono-memory-vector-overlap').val() || defaultVectorMemory.overlap)),
        longMessageThreshold: Math.max(240, Number($('#bakemono-memory-vector-long-message-threshold').val() || defaultVectorMemory.longMessageThreshold)),
        topK: Math.max(1, Number($('#bakemono-memory-vector-top-k').val() || defaultVectorMemory.rerankCandidateCount)),
        rerankCandidateCount: Math.max(1, Number($('#bakemono-memory-vector-top-k').val() || defaultVectorMemory.rerankCandidateCount)),
        maxRecallMessages: Math.max(1, Number($('#bakemono-memory-vector-max-recall-messages').val() || defaultVectorMemory.finalRecallCount)),
        finalRecallCount: Math.max(1, Number($('#bakemono-memory-vector-max-recall-messages').val() || defaultVectorMemory.finalRecallCount)),
        fullRecallCount: Math.max(0, Number($('#bakemono-memory-vector-full-recall-count').val() || defaultVectorMemory.fullRecallCount)),
        maxPerMessage: Math.max(1, Number($('#bakemono-memory-vector-max-per-message').val() || defaultVectorMemory.maxPerMessage)),
        perMessageMaxChars: Math.max(200, Number($('#bakemono-memory-vector-per-message-max-chars').val() || defaultVectorMemory.perMessageMaxChars)),
        minScore: Math.max(0, Number($('#bakemono-memory-vector-min-score').val() || defaultVectorMemory.embeddingThreshold)),
        embeddingThreshold: Math.max(0, Number($('#bakemono-memory-vector-min-score').val() || defaultVectorMemory.embeddingThreshold)),
        rerankThreshold: Math.max(0, Number($('#bakemono-memory-vector-rerank-threshold').val() || defaultVectorMemory.rerankThreshold)),
        keywordBoost: Math.max(0, Number($('#bakemono-memory-vector-keyword-boost').val() || defaultVectorMemory.keywordBoost)),
        maxInjectChars: Math.max(200, Number($('#bakemono-memory-vector-max-chars').val() || defaultVectorMemory.maxInjectChars)),
        summaryMaxChars: Math.max(120, Number($('#bakemono-memory-vector-summary-max-chars').val() || defaultVectorMemory.summaryMaxChars)),
        keywordTriggers: String($('#bakemono-memory-vector-keywords').val() || ''),
        excludeTags: String($('#bakemono-memory-vector-exclude-tags').val() || defaultVectorMemory.excludeTags),
        summaryTags: String($('#bakemono-memory-vector-summary-tags').val() || defaultVectorMemory.summaryTags),
        queryMode: String($('#bakemono-memory-vector-query-mode').val() || defaultVectorMemory.queryMode),
        queryRewriteProvider: String($('#bakemono-memory-vector-query-provider').val() || defaultVectorMemory.queryRewriteProvider),
        queryRewritePrompt: String($('#bakemono-memory-vector-query-prompt').val() || defaultVectorMemory.queryRewritePrompt),
        queryCustomApi: {
            baseUrl: String($('#bakemono-memory-vector-query-base-url').val() || '').trim(),
            apiKey: String($('#bakemono-memory-vector-query-api-key').val() || '').trim(),
            model: String($('#bakemono-memory-vector-query-model').val() || '').trim(),
            models: Array.isArray(state.vectorMemory?.queryCustomApi?.models) ? state.vectorMemory.queryCustomApi.models : [],
        },
        startAfterAiMessages: Math.max(0, Number($('#bakemono-memory-vector-start-after-ai').val() || defaultVectorMemory.startAfterAiMessages)),
        skipIfAllInContext: $('#bakemono-memory-vector-skip-context').length ? $('#bakemono-memory-vector-skip-context').prop('checked') : state.vectorMemory?.skipIfAllInContext !== false,
        contextWindowMessages: Math.max(0, Number($('#bakemono-memory-vector-context-window').val() || defaultVectorMemory.contextWindowMessages)),
        rerankMode: String($('#bakemono-memory-vector-rerank-mode').val() || defaultVectorMemory.rerankMode),
        embeddingProvider: String($('#bakemono-memory-vector-provider').val() || defaultVectorMemory.embeddingProvider),
        customApi: {
            baseUrl: String($('#bakemono-memory-vector-base-url').val() || '').trim(),
            apiKey: String($('#bakemono-memory-vector-api-key').val() || '').trim(),
            model: String($('#bakemono-memory-vector-model').val() || defaultVectorMemory.customApi.model).trim(),
            models: Array.isArray(state.vectorMemory?.customApi?.models) ? state.vectorMemory.customApi.models : [],
        },
        records: previousRecords,
        embeddingCache: previousCache,
        lastHits: previousHits,
        lastEmbeddingCandidates: previousEmbeddingCandidates,
        lastRerankCandidates: previousRerankCandidates,
    };
    return state;
}

function readConfigFieldsFromUi(state = ensureState()) {
    readRuleFieldsFromUi(state);
    readAutomationFieldsFromUi(state);
    readPromptFieldsFromUi(state);
    readTurnSummaryFieldsFromUi(state);
    readInjectionFieldsFromUi(state);
    readVectorMemoryFieldsFromUi(state);
    return state;
}

function getCurrentPromptPresetPayload(name = '') {
    const state = readConfigFieldsFromUi(ensureState());
    return {
        id: makePresetId(name),
        name: name || '未命名预设',
        story: String(state.generationPrompts.story || defaultStoryGenerationPrompt),
        missing: String(state.generationPrompts.missing || defaultMissingSummaryPrompt),
        stage: String(state.generationPrompts.stage || defaultStageGenerationPrompt),
        epic: String(state.generationPrompts.epic || defaultEpicGenerationPrompt),
        scanRules: structuredClone(state.scanRules),
        classificationRules: structuredClone(state.classificationRules),
        previewLayouts: structuredClone(state.previewLayouts),
        memoryStrategy: state.memoryStrategy || memoryStrategies.BAKEMONO,
        workflowMode: state.workflowMode || workflowModes.BAKEMONO,
        stageSourceMode: getStageSourceMode(state),
        outputMode: state.outputMode || 'bakemono',
        generationTargets: structuredClone(state.generationTargets || defaultGenerationTargets),
        injection: {
            enabled: !!state.injection.enabled,
            depth: Math.max(0, Number(state.injection.depth ?? defaultState.injection.depth)),
            role: Number(state.injection.role ?? extension_prompt_roles.SYSTEM),
            template: String(state.injection.template || defaultInjectionTemplate),
        },
        automation: {
            ...structuredClone(state.automation),
            lastSignature: '',
            lastAutoAt: null,
        },
        turnSummary: {
            enabled: !!state.turnSummary.enabled,
            auto: !!state.turnSummary.auto,
            processingMode: state.turnSummary.processingMode || turnProcessingModes.BOTH,
            saveMode: state.turnSummary.saveMode === 'commit' ? 'commit' : 'draft',
            includeUserMessage: state.turnSummary.includeUserMessage !== false,
            includeCharacterContext: state.turnSummary.includeCharacterContext !== false,
            includeWorldInfo: !!state.turnSummary.includeWorldInfo,
            worldInfoMaxContext: Math.max(1024, Number(state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext)),
            referenceContext: String(state.turnSummary.referenceContext || ''),
            prompt: String(state.turnSummary.prompt || defaultTurnSummaryPrompt),
            tablePrompt: String(state.turnSummary.tablePrompt || defaultTableEditPrompt),
        },
        inlineGeneration: structuredClone(state.inlineGeneration || defaultState.inlineGeneration),
        vectorMemory: {
            ...structuredClone(state.vectorMemory || defaultVectorMemory),
            records: [],
            lastHits: [],
            embeddingCache: {},
            lastQuery: '',
            lastIndexAt: null,
            lastIndexedSignature: '',
            dirty: true,
            dirtyReason: '',
        },
        tableDatabase: {
            enabled: !!state.tableDatabase.enabled,
            injectMemory: state.tableDatabase.injectMemory !== false,
            autoApply: !!state.tableDatabase.autoApply,
            schemaScope: state.tableDatabase.schemaScope || tableSchemaScopes.CHAT,
            tables: getTableSchemasForPreset(state),
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
        missing: String(preset.missing || defaultMissingSummaryPrompt),
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
        injection: preset.injection && typeof preset.injection === 'object' ? preset.injection : null,
        automation: preset.automation && typeof preset.automation === 'object' ? preset.automation : null,
        turnSummary: preset.turnSummary && typeof preset.turnSummary === 'object' ? preset.turnSummary : null,
        inlineGeneration: preset.inlineGeneration && typeof preset.inlineGeneration === 'object' ? preset.inlineGeneration : null,
        vectorMemory: preset.vectorMemory && typeof preset.vectorMemory === 'object' ? preset.vectorMemory : null,
        tableDatabase: preset.tableDatabase && typeof preset.tableDatabase === 'object' ? preset.tableDatabase : null,
        createdAt: preset.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

function applyPromptPresetToState(preset, options = {}) {
    const state = options.state || ensureState();
    state.generationPrompts.story = preset.story || defaultStoryGenerationPrompt;
    state.generationPrompts.missing = preset.missing || defaultMissingSummaryPrompt;
    state.generationPrompts.stage = preset.stage || defaultStageGenerationPrompt;
    state.generationPrompts.epic = preset.epic || defaultEpicGenerationPrompt;
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
    if (preset.injection) {
        state.injection = {
            ...state.injection,
            enabled: preset.injection.enabled ?? state.injection.enabled,
            depth: Math.max(0, Number(preset.injection.depth ?? state.injection.depth)),
            role: Number(preset.injection.role ?? state.injection.role),
            template: String(preset.injection.template || state.injection.template || defaultInjectionTemplate),
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
    if (preset.turnSummary) {
        state.turnSummary = {
            ...state.turnSummary,
            enabled: !!preset.turnSummary.enabled,
            auto: !!preset.turnSummary.auto,
            processingMode: preset.turnSummary.processingMode || state.turnSummary.processingMode || turnProcessingModes.BOTH,
            saveMode: preset.turnSummary.saveMode === 'commit' ? 'commit' : 'draft',
            includeUserMessage: preset.turnSummary.includeUserMessage !== false,
            includeCharacterContext: preset.turnSummary.includeCharacterContext !== false,
            includeWorldInfo: !!preset.turnSummary.includeWorldInfo,
            worldInfoMaxContext: Math.max(1024, Number(preset.turnSummary.worldInfoMaxContext || state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext)),
            referenceContext: String(preset.turnSummary.referenceContext || ''),
            prompt: String(preset.turnSummary.prompt || state.turnSummary.prompt || defaultTurnSummaryPrompt),
            tablePrompt: String(preset.turnSummary.tablePrompt || state.turnSummary.tablePrompt || defaultTableEditPrompt),
        };
    }
    if (preset.inlineGeneration) {
        state.inlineGeneration = {
            ...structuredClone(defaultState.inlineGeneration),
            ...structuredClone(preset.inlineGeneration),
        };
        syncInlineGenerationPrompts(state);
    }
    if (preset.vectorMemory) {
        state.vectorMemory = {
            ...structuredClone(defaultVectorMemory),
            ...structuredClone(preset.vectorMemory),
            records: state.vectorMemory?.records || [],
            lastHits: state.vectorMemory?.lastHits || [],
            embeddingCache: state.vectorMemory?.embeddingCache || {},
            dirty: true,
            dirtyReason: '载入全局配置',
        };
        if (!options.skipVectorSchedule) {
            scheduleVectorAutoIndex('载入全局配置');
        }
    }
    if (preset.tableDatabase) {
        state.tableDatabase = {
            ...state.tableDatabase,
            enabled: !!preset.tableDatabase.enabled,
            injectMemory: preset.tableDatabase.injectMemory !== false,
            autoApply: !!preset.tableDatabase.autoApply,
            schemaScope: Object.values(tableSchemaScopes).includes(preset.tableDatabase.schemaScope) ? preset.tableDatabase.schemaScope : state.tableDatabase.schemaScope,
            tables: Array.isArray(preset.tableDatabase.tables)
                ? normalizeImportedTablesFromJson({ tables: preset.tableDatabase.tables })
                : state.tableDatabase.tables,
            editDrafts: [],
            history: state.tableDatabase.history || [],
        };
        setTableSchemaScope(state.tableDatabase.schemaScope, state);
    }
    state.activeConfigId = preset.id || state.activeConfigId || '';
    state.configInitialized = true;
    if (!options.skipScan) {
        scanBakemonoBlocks({ persist: false });
    }
    updateInjectionFromSummaries();
    if (!options.skipSave) {
        saveState();
    }
    if (!options.silent && !options.skipRender) {
        renderAll(`已使用配置：${preset.name || '未命名预设'}`);
        toastr.success('配置已使用。');
    }
}

function saveCurrentConfigPreset(name, options = {}) {
    const presets = getPromptPresets();
    const replaceId = options.replaceId || '';
    const existing = replaceId ? presets.find(preset => preset.id === replaceId) : null;
    const preset = getCurrentPromptPresetPayload(name);
    if (existing) {
        preset.id = existing.id;
        preset.createdAt = existing.createdAt || preset.createdAt;
        const index = presets.findIndex(item => item.id === existing.id);
        presets[index] = preset;
    } else {
        presets.push(preset);
    }
    setSelectedPromptPresetId(preset.id);
    saveGlobalSettings();
    saveState();
    renderAll(existing ? `已覆盖配置：${preset.name}` : `已保存配置：${preset.name}`);
    toastr.success(existing ? '配置预设已覆盖。' : '配置预设已保存。');
    return preset;
}

function usePromptPresetAsGlobalDefault(preset, options = {}) {
    if (!preset) {
        toastr.warning('请先选择配置。');
        return false;
    }
    const state = ensureState();
    applyPromptPresetToState(preset, { state, silent: true });
    const config = setActiveGlobalConfig(preset);
    markStateGlobalConfigApplied(state, config);
    saveState();
    renderAll(options.message || `已使用并设为全局默认：${preset.name || '未命名配置'}`);
    toastr.success('已切换配置，并设为新聊天默认。');
    return true;
}

function getAreaPresetPayload(scope, name) {
    const state = ensureState();
    const base = {
        id: makeAreaPresetId(scope, name),
        scope,
        name: name || '未命名配置',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    if (scope === areaPresetScopes.SCAN) {
        readRuleFieldsFromUi(state);
        return {
            ...base,
            scanRules: structuredClone(state.scanRules),
            classificationRules: structuredClone(state.classificationRules),
            previewLayouts: structuredClone(state.previewLayouts),
        };
    }
    if (scope === areaPresetScopes.AUTOMATION) {
        readAutomationFieldsFromUi(state);
        return {
            ...base,
            automation: {
                ...structuredClone(state.automation),
                lastSignature: '',
                lastAutoAt: null,
            },
        };
    }
    if (scope === areaPresetScopes.API) {
        readCustomApiFieldsFromUi(state);
        return {
            ...base,
            apiProvider: state.automation.apiProvider || defaultAutomation.apiProvider,
            customApi: structuredClone(state.automation.customApi || defaultAutomation.customApi),
        };
    }
    if (scope === areaPresetScopes.PROMPTS) {
        readPromptFieldsFromUi(state);
        readTurnSummaryFieldsFromUi(state);
        return {
            ...base,
            story: String(state.generationPrompts.story || defaultStoryGenerationPrompt),
            missing: String(state.generationPrompts.missing || defaultMissingSummaryPrompt),
            stage: String(state.generationPrompts.stage || defaultStageGenerationPrompt),
            epic: String(state.generationPrompts.epic || defaultEpicGenerationPrompt),
            turnSummary: {
                includeCharacterContext: state.turnSummary.includeCharacterContext !== false,
                includeWorldInfo: !!state.turnSummary.includeWorldInfo,
                worldInfoMaxContext: Math.max(1024, Number(state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext)),
                referenceContext: String(state.turnSummary.referenceContext || ''),
                prompt: String(state.turnSummary.prompt || defaultTurnSummaryPrompt),
                tablePrompt: String(state.turnSummary.tablePrompt || defaultTableEditPrompt),
            },
            inlineGeneration: structuredClone(state.inlineGeneration || defaultState.inlineGeneration),
        };
    }
    if (scope === areaPresetScopes.TURN) {
        readTurnSummaryFieldsFromUi(state);
        return {
            ...base,
            turnSummary: {
                enabled: !!state.turnSummary.enabled,
                auto: !!state.turnSummary.auto,
                processingMode: state.turnSummary.processingMode || turnProcessingModes.BOTH,
                saveMode: state.turnSummary.saveMode === 'commit' ? 'commit' : 'draft',
                includeUserMessage: state.turnSummary.includeUserMessage !== false,
                includeCharacterContext: state.turnSummary.includeCharacterContext !== false,
                includeWorldInfo: !!state.turnSummary.includeWorldInfo,
                worldInfoMaxContext: Math.max(1024, Number(state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext)),
                referenceContext: String(state.turnSummary.referenceContext || ''),
                prompt: String(state.turnSummary.prompt || defaultTurnSummaryPrompt),
                tablePrompt: String(state.turnSummary.tablePrompt || defaultTableEditPrompt),
            },
            inlineGeneration: structuredClone(state.inlineGeneration || defaultState.inlineGeneration),
        };
    }
    if (scope === areaPresetScopes.INJECTION) {
        readInjectionFieldsFromUi(state);
        return {
            ...base,
            injection: {
                enabled: !!state.injection.enabled,
                depth: Math.max(0, Number(state.injection.depth ?? defaultState.injection.depth)),
                role: Number(state.injection.role ?? extension_prompt_roles.SYSTEM),
                template: String(state.injection.template || defaultInjectionTemplate),
            },
        };
    }
    if (scope === areaPresetScopes.VECTOR) {
        readVectorMemoryFieldsFromUi(state);
        return {
            ...base,
            vectorMemory: {
                ...structuredClone(state.vectorMemory),
                records: [],
                lastHits: [],
                embeddingCache: {},
                lastQuery: '',
                lastIndexAt: null,
                lastIndexedSignature: '',
            },
        };
    }
    return base;
}

function applyAreaPresetToState(scope, preset) {
    const state = ensureState();
    if (scope === areaPresetScopes.SCAN) {
        if (preset.scanRules) {
            state.scanRules = { ...structuredClone(defaultScanRules), ...structuredClone(preset.scanRules) };
        }
        if (preset.classificationRules) {
            state.classificationRules = { ...structuredClone(defaultClassificationRules), ...structuredClone(preset.classificationRules) };
        }
        if (preset.previewLayouts) {
            state.previewLayouts = { ...structuredClone(defaultPreviewLayouts), ...structuredClone(preset.previewLayouts) };
        }
        scanBakemonoBlocks({ persist: false });
    } else if (scope === areaPresetScopes.AUTOMATION && preset.automation) {
        state.automation = {
            ...structuredClone(defaultAutomation),
            ...structuredClone(preset.automation),
            lastSignature: state.automation.lastSignature || '',
            lastAutoAt: state.automation.lastAutoAt || null,
        };
    } else if (scope === areaPresetScopes.API) {
        state.automation = {
            ...structuredClone(defaultAutomation),
            ...state.automation,
            apiProvider: preset.apiProvider || state.automation.apiProvider || defaultAutomation.apiProvider,
            customApi: {
                ...structuredClone(defaultAutomation.customApi),
                ...(preset.customApi || {}),
            },
        };
    } else if (scope === areaPresetScopes.PROMPTS) {
        state.generationPrompts.story = preset.story || defaultStoryGenerationPrompt;
        state.generationPrompts.missing = preset.missing || defaultMissingSummaryPrompt;
        state.generationPrompts.stage = preset.stage || defaultStageGenerationPrompt;
        state.generationPrompts.epic = preset.epic || defaultEpicGenerationPrompt;
        if (preset.turnSummary) {
            state.turnSummary.includeCharacterContext = preset.turnSummary.includeCharacterContext !== false;
            state.turnSummary.includeWorldInfo = !!preset.turnSummary.includeWorldInfo;
            state.turnSummary.worldInfoMaxContext = Math.max(1024, Number(preset.turnSummary.worldInfoMaxContext || state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext));
            state.turnSummary.referenceContext = String(preset.turnSummary.referenceContext || state.turnSummary.referenceContext || '');
            state.turnSummary.prompt = preset.turnSummary.prompt || state.turnSummary.prompt || defaultTurnSummaryPrompt;
            state.turnSummary.tablePrompt = preset.turnSummary.tablePrompt || state.turnSummary.tablePrompt || defaultTableEditPrompt;
        }
        if (preset.inlineGeneration) {
            state.inlineGeneration = {
                ...structuredClone(defaultState.inlineGeneration),
                ...structuredClone(preset.inlineGeneration),
            };
            syncInlineGenerationPrompts(state);
        }
    } else if (scope === areaPresetScopes.TURN && preset.turnSummary) {
        state.turnSummary = {
            ...state.turnSummary,
            enabled: preset.turnSummary.enabled ?? state.turnSummary.enabled,
            auto: preset.turnSummary.auto ?? state.turnSummary.auto,
            processingMode: preset.turnSummary.processingMode || state.turnSummary.processingMode || turnProcessingModes.BOTH,
            saveMode: preset.turnSummary.saveMode === 'commit' ? 'commit' : state.turnSummary.saveMode || 'draft',
            includeUserMessage: preset.turnSummary.includeUserMessage !== false,
            includeCharacterContext: preset.turnSummary.includeCharacterContext !== false,
            includeWorldInfo: !!preset.turnSummary.includeWorldInfo,
            worldInfoMaxContext: Math.max(1024, Number(preset.turnSummary.worldInfoMaxContext || state.turnSummary.worldInfoMaxContext || defaultState.turnSummary.worldInfoMaxContext)),
            referenceContext: String(preset.turnSummary.referenceContext || ''),
            prompt: String(preset.turnSummary.prompt || state.turnSummary.prompt || defaultTurnSummaryPrompt),
            tablePrompt: String(preset.turnSummary.tablePrompt || state.turnSummary.tablePrompt || defaultTableEditPrompt),
        };
        if (preset.inlineGeneration) {
            state.inlineGeneration = {
                ...structuredClone(defaultState.inlineGeneration),
                ...structuredClone(preset.inlineGeneration),
            };
            syncInlineGenerationPrompts(state);
        }
    } else if (scope === areaPresetScopes.INJECTION && preset.injection) {
        state.injection = {
            ...state.injection,
            enabled: preset.injection.enabled ?? state.injection.enabled,
            depth: Math.max(0, Number(preset.injection.depth ?? state.injection.depth)),
            role: Number(preset.injection.role ?? state.injection.role),
            template: String(preset.injection.template || state.injection.template || defaultInjectionTemplate),
        };
        syncInjection();
    } else if (scope === areaPresetScopes.VECTOR && preset.vectorMemory) {
        state.vectorMemory = {
            ...structuredClone(defaultVectorMemory),
            ...structuredClone(preset.vectorMemory),
            records: state.vectorMemory.records || [],
            lastHits: state.vectorMemory.lastHits || [],
            embeddingCache: state.vectorMemory.embeddingCache || {},
            dirty: true,
            dirtyReason: '载入向量配置',
        };
        scheduleVectorAutoIndex('载入向量配置');
    }
    saveState();
    renderAll(`已载入配置：${preset.name || '未命名配置'}`);
    toastr.success('配置已载入。');
}

function saveAreaPreset(scope, name, options = {}) {
    const presets = getAreaPresets(scope);
    const replaceId = options.replaceId || '';
    const existing = replaceId ? presets.find(preset => preset.id === replaceId) : null;
    const preset = getAreaPresetPayload(scope, name);
    if (existing) {
        preset.id = existing.id;
        preset.createdAt = existing.createdAt || preset.createdAt;
        const index = presets.findIndex(item => item.id === existing.id);
        presets[index] = preset;
    } else {
        presets.push(preset);
    }
    setSelectedAreaPresetId(scope, preset.id);
    saveGlobalSettings();
    saveState();
    renderAll(existing ? `已覆盖配置：${preset.name}` : `已保存配置：${preset.name}`);
    toastr.success(existing ? '配置已覆盖。' : '配置已保存。');
    return preset;
}

function bindAreaPresetControls(scope, ids) {
    $(ids.select).off('change').on('change', function () {
        const previousId = getSelectedAreaPresetId(scope);
        const selectedId = String(this.value || '');
        setSelectedAreaPresetId(scope, selectedId);
        renderPromptPresetControls();
        if (!selectedId) {
            return;
        }
        const preset = getAreaPresets(scope).find(item => item.id === selectedId);
        if (!preset) {
            return;
        }
        const confirmed = confirmDanger(
            `使用配置「${preset.name || '未命名配置'}」？`,
            ['会立即应用到当前聊天的这个区域设置。需要让以后新聊天也使用它时，请在总览里点“使用并设为默认”。'],
        );
        if (!confirmed) {
            setSelectedAreaPresetId(scope, previousId);
            renderPromptPresetControls();
            return;
        }
        applyAreaPresetToState(scope, preset);
    });
    $(ids.load).off('click').on('click', () => {
        const selectedId = getSelectedAreaPresetId(scope);
        const preset = getAreaPresets(scope).find(item => item.id === selectedId);
        if (!preset) {
            toastr.warning('请先选择已保存的配置。');
            return;
        }
        const confirmed = confirmDanger(
            `载入配置「${preset.name || '未命名配置'}」？`,
            ['这只会覆盖当前区域的设置，不会影响其他区域。'],
        );
        if (!confirmed) {
            return;
        }
        applyAreaPresetToState(scope, preset);
    });
    $(ids.save).off('click').on('click', () => {
        const name = String($(ids.name).val() || '').trim();
        if (!name) {
            toastr.warning('请先填写配置名称。');
            return;
        }
        const selectedId = getSelectedAreaPresetId(scope);
        const selected = getAreaPresets(scope).find(item => item.id === selectedId);
        if (selected) {
            saveAreaPreset(scope, name, { replaceId: selectedId });
        } else {
            saveAreaPreset(scope, name);
        }
    });
    $(ids.update).off('click').on('click', () => {
        const selectedId = getSelectedAreaPresetId(scope);
        const selected = getAreaPresets(scope).find(item => item.id === selectedId);
        if (!selected) {
            toastr.warning('请先选择要覆盖的配置。');
            return;
        }
        const name = String($(ids.name).val() || selected.name || '').trim();
        if (!name) {
            toastr.warning('请先填写配置名称。');
            return;
        }
        const confirmed = confirmDanger(
            `覆盖配置「${selected.name || '未命名配置'}」？`,
            ['会用当前区域界面里的设置覆盖它。'],
        );
        if (!confirmed) {
            return;
        }
        saveAreaPreset(scope, name, { replaceId: selectedId });
    });
    $(ids.delete).off('click').on('click', () => {
        const selectedId = getSelectedAreaPresetId(scope);
        const selected = getAreaPresets(scope).find(item => item.id === selectedId);
        if (!selected) {
            toastr.warning('请先选择要删除的配置。');
            return;
        }
        const confirmed = confirmDanger(
            `删除配置「${selected.name || '未命名配置'}」？`,
            ['删除后无法从列表里恢复，但不会影响当前聊天已经应用的设置。'],
        );
        if (!confirmed) {
            return;
        }
        extension_settings[STORAGE_KEY].areaPresets[scope] = getAreaPresets(scope).filter(item => item.id !== selectedId);
        setSelectedAreaPresetId(scope, '');
        saveGlobalSettings();
        renderAll('配置已删除。');
    });
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

function getWorkbenchPanelTitle(tabName) {
    const titles = {
        overview: '控制台',
        settings: '工作流设置',
        preview: '总结',
        records: '记忆库',
        tables: '表格',
        'turn-summary': '自动记忆',
        drafts: '待确认',
        timeline: '摘要树',
        automation: '自动总结',
        scan: '扫描规则',
        vector: '向量记忆',
        injection: '注入内容',
        prompts: '生成提示词',
        appearance: '自定义主题',
        maintenance: '撤回与事务',
    };
    return titles[tabName] || '剧情剪辑台';
}

function getWorkbenchPanelKicker(tabName, state = ensureState()) {
    const currentFloor = Math.max(0, (Array.isArray(chat) ? chat.length : 1) - 1);
    const recordCount = Array.isArray(state.memoryRecords) ? state.memoryRecords.length : 0;
    const tableCount = Array.isArray(state.tableDatabase?.tables) ? state.tableDatabase.tables.length : 0;
    const vectorCount = Array.isArray(state.vectorMemory?.records) ? state.vectorMemory.records.length : 0;
    const contexts = {
        overview: `剧情剪辑 · 第 ${currentFloor.toLocaleString()} 楼`,
        settings: `工作方式 · ${getMemoryStrategyLabel(state.memoryStrategy)}`,
        preview: `剧情回看 · ${(state.storySummaries?.length || 0).toLocaleString()} 条摘要`,
        records: `长期记忆 · ${recordCount.toLocaleString()} 条记录`,
        tables: `结构化记忆 · ${tableCount.toLocaleString()} 个表格`,
        'turn-summary': `正文后处理 · 第 ${currentFloor.toLocaleString()} 楼`,
        drafts: `人工确认 · ${(state.drafts?.length || 0).toLocaleString()} 个待办`,
        timeline: `章节结构 · ${(state.stageSummaries?.length || 0).toLocaleString()} 个阶段`,
        automation: `后台规则 · ${state.automation?.enabled ? '运行中' : '尚未开启'}`,
        scan: `扫描识别 · ${(state.scanPreview?.length || 0).toLocaleString()} 条结果`,
        vector: `语义召回 · ${vectorCount.toLocaleString()} 个片段`,
        injection: `上下文注入 · ${renderInjectionContent(state).length.toLocaleString()} 字符`,
        prompts: '生成风格 · 四类提示词',
        appearance: `外观主题 · ${getAppearanceSettings().themeMode === 'custom' ? '自定义' : '跟随酒馆'}`,
        maintenance: `安全维护 · ${(state.autoSummaryTransactions?.length || 0).toLocaleString()} 条事务`,
    };
    return contexts[tabName] || '剧情剪辑台 · 长期记忆';
}

function getWorkbenchPanelShortKicker(tabName, state = ensureState()) {
    const currentFloor = Math.max(0, (Array.isArray(chat) ? chat.length : 1) - 1);
    const recordCount = Array.isArray(state.memoryRecords) ? state.memoryRecords.length : 0;
    const tableCount = Array.isArray(state.tableDatabase?.tables) ? state.tableDatabase.tables.length : 0;
    const vectorCount = Array.isArray(state.vectorMemory?.records) ? state.vectorMemory.records.length : 0;
    const contexts = {
        overview: `剧情剪辑 · ${currentFloor.toLocaleString()}楼`,
        settings: '工作方式',
        preview: `剧情回看 · ${(state.storySummaries?.length || 0).toLocaleString()}条`,
        records: `长期记忆 · ${recordCount.toLocaleString()}条`,
        tables: `表格 · ${tableCount.toLocaleString()}个`,
        'turn-summary': `正文处理 · ${currentFloor.toLocaleString()}楼`,
        drafts: `人工确认 · ${(state.drafts?.length || 0).toLocaleString()}个`,
        timeline: `章节结构 · ${(state.stageSummaries?.length || 0).toLocaleString()}个`,
        automation: state.automation?.enabled ? '自动总结 · 运行中' : '自动总结 · 未开启',
        scan: `扫描识别 · ${(state.scanPreview?.length || 0).toLocaleString()}条`,
        vector: `语义召回 · ${vectorCount.toLocaleString()}个`,
        injection: `上下文 · ${renderInjectionContent(state).length.toLocaleString()}字`,
        prompts: '生成风格',
        appearance: '外观主题',
        maintenance: `安全维护 · ${(state.autoSummaryTransactions?.length || 0).toLocaleString()}条`,
    };
    return contexts[tabName] || '剧情剪辑台';
}

function getWorkbenchInjectionHeaderStatus(state = ensureState()) {
    if (!state.injection?.enabled) {
        return { short: '注入关', full: '已关闭' };
    }
    const characterCount = renderInjectionContent(state).length;
    if (!characterCount) {
        return { short: '注入空', full: '已开启 · 暂无可注入内容' };
    }
    return {
        short: '注入开',
        full: `已开启 · ${characterCount.toLocaleString()} 字符`,
    };
}

function renderWorkbenchHeaderContext(tabName, state = ensureState()) {
    const fullContext = getWorkbenchPanelKicker(tabName, state);
    const shortContext = getWorkbenchPanelShortKicker(tabName, state);
    const injectionStatus = getWorkbenchInjectionHeaderStatus(state);
    const kicker = document.getElementById('bakemono-workbench-section-title');
    if (kicker) {
        kicker.textContent = fullContext;
    }
    const shortKicker = document.getElementById('bakemono-workbench-section-title-short');
    if (shortKicker) {
        shortKicker.textContent = shortContext;
    }
    const badge = document.getElementById('bakemono-memory-injection-badge');
    if (badge) {
        badge.textContent = injectionStatus.short;
        badge.title = `注入状态：${injectionStatus.full}`;
        badge.setAttribute('aria-label', `注入状态：${injectionStatus.full}`);
    }
}

function closeWorkbenchHelpPopover() {
    activeWorkbenchHelpTrigger?.setAttribute('aria-expanded', 'false');
    activeWorkbenchHelpTrigger = null;
    document.getElementById('bakemono-memory-help-popover')?.remove();
}

function positionWorkbenchHelpPopover(trigger, popover) {
    if (!trigger?.isConnected || !popover?.isConnected) {
        closeWorkbenchHelpPopover();
        return;
    }
    const margin = 12;
    const gap = 8;
    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(320, viewportWidth - margin * 2);
    popover.style.width = `${width}px`;
    const height = popover.getBoundingClientRect().height;
    const center = triggerRect.left + triggerRect.width / 2;
    const left = Math.max(margin, Math.min(center - width / 2, viewportWidth - width - margin));
    const showAbove = triggerRect.bottom + gap + height > viewportHeight - margin && triggerRect.top - gap - height >= margin;
    const top = showAbove ? triggerRect.top - gap - height : Math.min(triggerRect.bottom + gap, viewportHeight - height - margin);
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(margin, top)}px`;
    popover.style.setProperty('--bakemono-help-arrow-left', `${Math.max(18, Math.min(center - left, width - 18))}px`);
    popover.classList.toggle('is-above', showAbove);
}

function toggleWorkbenchHelpPopover(trigger) {
    if (!trigger) {
        return;
    }
    if (activeWorkbenchHelpTrigger === trigger) {
        closeWorkbenchHelpPopover();
        return;
    }
    closeWorkbenchHelpPopover();
    const source = trigger.querySelector('.bakemono-memory-help-content');
    if (!source) {
        return;
    }
    const popover = document.createElement('div');
    popover.id = 'bakemono-memory-help-popover';
    popover.className = 'bakemono-memory-help-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', trigger.getAttribute('aria-label') || '帮助说明');
    popover.innerHTML = source.innerHTML;
    document.getElementById('bakemono-workbench-root')?.appendChild(popover);
    activeWorkbenchHelpTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => positionWorkbenchHelpPopover(trigger, popover));
}

function switchWorkbenchTab(tabName) {
    const root = document.getElementById('bakemono-workbench-root');
    if (!root) {
        return;
    }
    closeWorkbenchHelpPopover();
    if (!tabName) {
        setWorkbenchMenuOpen(false);
        return;
    }
    if (root.dataset.activeTab === tabName) {
        setWorkbenchMenuOpen(false);
        return;
    }
    const panelName = tabName === 'tables' ? 'turn-summary' : tabName;
    root.dataset.activeTab = tabName;
    const title = document.getElementById('bakemono-workbench-title');
    if (title) {
        title.textContent = getWorkbenchPanelTitle(tabName);
    }
    renderWorkbenchHeaderContext(tabName);
    root.querySelectorAll('.bakemono-workbench-tab').forEach(tab => {
        tab.classList.toggle('is-active', tab.dataset.bakemonoTab === tabName);
    });
    root.querySelectorAll('.bakemono-workbench-panel').forEach(panel => {
        panel.classList.toggle('is-active', panel.dataset.bakemonoPanel === panelName);
    });
    renderAll();
    requestAnimationFrame(() => setWorkbenchMenuOpen(false));
    syncMobileCollapsibles(root.querySelector(`.bakemono-workbench-panel[data-bakemono-panel="${panelName}"]`) || root);
    if (tabName === 'preview') {
        requestAnimationFrame(() => {
            stabilizeMobilePreviewScroll();
        });
    } else if (tabName === 'prompts') {
        stabilizeMobileWorkbenchScroll('prompts');
    }
}

function setWorkbenchMenuOpen(open) {
    const root = document.getElementById('bakemono-workbench-root');
    const button = document.getElementById('bakemono-memory-menu-toggle');
    if (!root) {
        return;
    }
    closeWorkbenchHelpPopover();
    root.classList.toggle('is-menu-open', !!open);
    if (button) {
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        button.title = open ? '关闭菜单' : '打开菜单';
        button.setAttribute('aria-label', button.title);
        button.querySelector('i')?.classList.toggle('fa-bars', !open);
        button.querySelector('i')?.classList.toggle('fa-xmark', !!open);
    }
}

function syncMobileCollapsibles(scope = null) {
    const root = document.getElementById('bakemono-workbench-root');
    if (!root) {
        return;
    }
    const isMobile = window.matchMedia?.('(max-width: 900px)').matches ?? false;
    const target = scope || root;
    target.querySelectorAll('.bakemono-mobile-collapsible').forEach(panel => {
        if (!isMobile) {
            panel.classList.remove('is-mobile-collapsed', 'is-mobile-expanded');
            delete panel.dataset.bakemonoMobileReady;
            return;
        }
        if (!panel.dataset.bakemonoMobileReady) {
            panel.classList.add('is-mobile-collapsed');
            panel.classList.remove('is-mobile-expanded');
            panel.dataset.bakemonoMobileReady = '1';
        }
    });
}

function stabilizeMobileWorkbenchScroll(expectedTab = '') {
    const root = document.getElementById('bakemono-workbench-root');
    if (!root || (expectedTab && root.dataset.activeTab !== expectedTab)) {
        return;
    }
    if (!(window.matchMedia?.('(max-width: 900px)').matches ?? false)) {
        return;
    }
    const main = root.querySelector('.bakemono-workbench-main');
    if (!main) {
        return;
    }
    const settle = () => {
        const currentTop = main.scrollTop;
        const maxTop = Math.max(0, main.scrollHeight - main.clientHeight);
        if (maxTop <= 0) {
            return;
        }
        const nudgedTop = Math.min(currentTop + 1, maxTop);
        main.scrollTop = nudgedTop;
        main.scrollTop = Math.min(currentTop, maxTop);
    };
    requestAnimationFrame(() => {
        settle();
        window.setTimeout(settle, 80);
    });
}

function stabilizeMobilePreviewScroll() {
    stabilizeMobileWorkbenchScroll('preview');
}

async function applyVectorMemorySettings() {
    const state = ensureState();
    readVectorMemoryFieldsFromUi(state);
    if (state.vectorMemory.enabled) {
        if (!state.vectorMemory.records.length || state.vectorMemory.lastIndexedSignature !== getVectorSourceSignature(state)) {
            markVectorIndexDirty('配置已变更', state);
        } else {
            await retrieveVectorMemoryHits('', state);
        }
    }
    saveState();
    syncInjection();
    renderAll('向量记忆配置已应用。');
}

async function testVectorMemoryRetrieval() {
    const state = ensureState();
    readVectorMemoryFieldsFromUi(state);
    if (!state.vectorMemory.records.length) {
        toastr.warning('还没有索引。请先点击“建立/刷新索引”。');
        renderAll('向量记忆尚未建立索引。');
        return false;
    }
    const query = String($('#bakemono-memory-vector-test-query').val() || '').trim();
    const hits = await retrieveVectorMemoryHits(query, state);
    saveState();
    syncInjection();
    renderAll(hits.length ? `向量召回完成：命中 ${hits.length} 条记忆。` : (state.vectorMemory.lastRecallSkippedReason || '向量召回完成：没有命中。'));
    return true;
}

function clearVectorMemoryIndex() {
    const state = ensureState();
    if (!state.vectorMemory.records.length && !state.vectorMemory.lastHits.length) {
        toastr.info('向量索引已经是空的。');
        return;
    }
    if (!confirmDanger(
        '清空向量索引？',
        ['这只会删除本聊天保存的向量片段和最近召回，不会删除聊天正文。'],
        '确认清空吗？',
    )) {
        return;
    }
    state.vectorMemory.records = [];
    state.vectorMemory.lastHits = [];
    state.vectorMemory.lastQuery = '';
    state.vectorMemory.lastIndexAt = null;
    saveState();
    syncInjection();
    renderAll('向量索引已清空。');
}

function bindInlinePromptPresetControls(type, ids) {
    const defaultId = type === 'summary' ? 'default-inline-summary' : 'default-inline-table';
    const promptSelector = type === 'summary' ? '#bakemono-memory-inline-summary-prompt' : '#bakemono-memory-inline-table-prompt';
    const defaultPrompt = type === 'summary' ? defaultInlineSummaryPrompt : defaultInlineTablePrompt;
    const label = type === 'summary' ? '随正文摘要提示词' : '随正文填表提示词';

    $(ids.select).off('change').on('change', function () {
        const previousId = getSelectedInlinePromptPresetId(type);
        const selectedId = String(this.value || '');
        setSelectedInlinePromptPresetId(type, selectedId);
        renderInlinePromptPresetControls(type, ids.select, ids.name);
        const preset = getInlinePromptPresets(type).find(item => item.id === selectedId);
        if (!preset) {
            return;
        }
        const confirmed = confirmDanger(`使用「${preset.name || '未命名'}」？`, ['当前编辑框里的提示词会被覆盖。']);
        if (!confirmed) {
            setSelectedInlinePromptPresetId(type, previousId);
            renderInlinePromptPresetControls(type, ids.select, ids.name);
            return;
        }
        const state = ensureState();
        if (type === 'summary') {
            state.inlineGeneration.summaryPrompt = preset.prompt || defaultPrompt;
        } else {
            state.inlineGeneration.tablePrompt = preset.prompt || defaultPrompt;
        }
        syncInlineGenerationPrompts(state);
        saveState();
        renderAll(`已使用${label}：${preset.name}`);
    });
    $(ids.load).off('click').on('click', () => {
        const preset = getInlinePromptPresets(type).find(item => item.id === getSelectedInlinePromptPresetId(type));
        if (!preset) {
            toastr.warning(`请先选择${label}预设。`);
            return;
        }
        const confirmed = confirmDanger(`载入「${preset.name || '未命名'}」？`, ['当前编辑框里的提示词会被覆盖。']);
        if (!confirmed) return;
        const state = ensureState();
        if (type === 'summary') {
            state.inlineGeneration.summaryPrompt = preset.prompt || defaultPrompt;
        } else {
            state.inlineGeneration.tablePrompt = preset.prompt || defaultPrompt;
        }
        syncInlineGenerationPrompts(state);
        saveState();
        renderAll(`已载入${label}：${preset.name}`);
    });
    $(ids.save).off('click').on('click', () => {
        const name = String($(ids.name).val() || '').trim();
        if (!name) {
            toastr.warning('请先填写预设名称。');
            return;
        }
        let preset = getInlinePromptPresets(type).find(item => item.id === getSelectedInlinePromptPresetId(type));
        if (preset && preset.id !== defaultId) {
            preset.name = name;
            preset.prompt = String($(promptSelector).val() || defaultPrompt);
            preset.updatedAt = new Date().toISOString();
        } else {
            preset = makeInlinePromptPreset(type, name, $(promptSelector).val());
            extension_settings[STORAGE_KEY].inlinePromptPresets.push(preset);
            setSelectedInlinePromptPresetId(type, preset.id);
        }
        saveGlobalSettings();
        renderAll(`已保存${label}：${preset.name}`);
    });
    $(ids.update).off('click').on('click', () => {
        const preset = getInlinePromptPresets(type).find(item => item.id === getSelectedInlinePromptPresetId(type));
        if (!preset) {
            toastr.warning(`请先选择${label}预设。`);
            return;
        }
        if (preset.id === defaultId) {
            toastr.warning('默认预设不能覆盖，请另存为新预设。');
            return;
        }
        const confirmed = confirmDanger(`覆盖「${preset.name || '未命名'}」？`, ['覆盖后无法自动恢复旧版本。']);
        if (!confirmed) return;
        preset.name = String($(ids.name).val() || preset.name || '').trim() || preset.name;
        preset.prompt = String($(promptSelector).val() || defaultPrompt);
        preset.updatedAt = new Date().toISOString();
        saveGlobalSettings();
        renderAll(`已覆盖${label}：${preset.name}`);
    });
    $(ids.delete).off('click').on('click', () => {
        const preset = getInlinePromptPresets(type).find(item => item.id === getSelectedInlinePromptPresetId(type));
        if (!preset) {
            toastr.warning(`请先选择${label}预设。`);
            return;
        }
        if (preset.id === defaultId) {
            toastr.warning('默认预设不能删除。');
            return;
        }
        const confirmed = confirmDanger(`删除「${preset.name || '未命名'}」？`, ['删除后不能从预设列表恢复。']);
        if (!confirmed) return;
        extension_settings[STORAGE_KEY].inlinePromptPresets = (extension_settings[STORAGE_KEY].inlinePromptPresets || []).filter(item => item.id !== preset.id);
        setSelectedInlinePromptPresetId(type, getInlinePromptPresets(type)[0]?.id || '');
        saveGlobalSettings();
        renderAll(`${label}预设已删除。`);
    });
}

async function runWorkbenchAction(action) {
    if (action === 'scan') {
        scanBakemonoBlocks();
    } else if (action === 'generate-stage') {
        await chooseStageGenerationMode();
    } else if (action === 'generate-stage-batch') {
        await generateStageBatchTasks();
    } else if (action === 'generate-epic') {
        await chooseEpicGenerationMode();
    } else if (action === 'generate-epic-batch') {
        await generateEpicBatchTasks();
    } else if (action === 'backfill') {
        await generateBackfillQueue();
    } else if (action === 'batch-summary') {
        await generateBatchSummaryQueue();
    } else if (action === 'commit-missing-all') {
        await commitAllMissingSummaryDrafts();
    } else if (action === 'remove-missing-all') {
        removeMissingSummaryDraftsAndTasks();
    } else if (action === 'clear-stuck-tasks') {
        clearStuckQueueTasks();
    } else if (action === 'clear-stuck-missing') {
        clearStuckMissingSummaryTasks();
    } else if (action === 'process-latest-turn') {
        readTurnSummaryFieldsFromUi();
        await processLatestTurnSummary({ manual: true });
    } else if (action === 'process-latest-table') {
        readTurnSummaryFieldsFromUi();
        await processLatestTableEdit({ manual: true });
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
    } else if (action === 'preview-preserve-recent') {
        previewPreserveRecentMessages();
    } else if (action === 'hide-before-recent') {
        await hideBeforeRecentMessages();
    } else if (action === 'apply-auto-hide-recent') {
        await applyAutoHideRecentSettings();
    } else if (action === 'restore-auto-hidden') {
        await restoreAutoHiddenMessages();
    } else if (action === 'vector-apply') {
        await applyVectorMemorySettings();
    } else if (action === 'vector-index') {
        await runVisibleOperation('正在建立/刷新向量索引...', () => buildVectorMemoryIndex(), '向量索引已刷新');
    } else if (action === 'vector-test') {
        await runVisibleOperation('正在测试向量召回...', () => testVectorMemoryRetrieval(), '召回测试已完成');
    } else if (action === 'vector-fetch-models') {
        await runVisibleOperation('正在拉取嵌入向量模型...', () => fetchVectorEmbeddingModels(), '嵌入模型列表已更新');
    } else if (action === 'vector-fetch-query-models') {
        await runVisibleOperation('正在拉取查询改写模型...', () => fetchVectorQueryModels(), '查询模型列表已更新');
    } else if (action === 'vector-clear') {
        clearVectorMemoryIndex();
    }
}

function bindSettingsEvents() {
    window.removeEventListener('resize', syncMobileCollapsibles);
    window.addEventListener('resize', syncMobileCollapsibles);
    const rootElement = document.getElementById('bakemono-workbench-root');
    if (rootElement && operationFeedbackCaptureHandler) {
        rootElement.removeEventListener('click', operationFeedbackCaptureHandler, true);
    }
    operationFeedbackCaptureHandler = event => {
        const importantControl = event.target.closest([
            '[data-bakemono-action]',
            '[data-bakemono-draft-action]',
            '[data-bakemono-auto-tx-action]',
            '[data-bakemono-table-draft-action]',
            '[data-bakemono-table-action="save-table"]',
            'button[id*="apply"]',
            'button[id*="save"]',
            'button[id*="undo"]',
            'button[id*="redo"]',
            'button[id*="restore"]',
        ].join(','));
        if (importantControl) {
            armOperationFeedbackCapture();
            const captureDeadline = operationFeedbackCaptureUntil;
            window.setTimeout(() => {
                if (operationFeedbackCaptureUntil === captureDeadline) {
                    operationFeedbackCaptureUntil = 0;
                }
            }, 2500);
        }
    };
    rootElement?.addEventListener('click', operationFeedbackCaptureHandler, true);
    $('#bakemono-memory-extension-open').off('click').on('click', () => openWorkbench());
    $('#bakemono-memory-show-top-nav').off('change').on('change', function () {
        const settings = extension_settings[STORAGE_KEY];
        settings.ui = settings.ui || {};
        settings.ui.showTopNavButton = !!this.checked;
        saveSettingsDebounced();
        renderExtensionEntrySettings();
        syncTopNavButton();
    });
    $('#bakemono-memory-close, [data-bakemono-close]').off('click').on('click', () => closeWorkbench());
    $('#bakemono-memory-menu-toggle').off('click').on('click', () => {
        const root = document.getElementById('bakemono-workbench-root');
        setWorkbenchMenuOpen(!root?.classList.contains('is-menu-open'));
    });
    $('.bakemono-workbench-tab').off('click').on('click', function (event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        switchWorkbenchTab(this.dataset.bakemonoTab);
    });
    $('#bakemono-workbench-root').off('click.bakemonoHubTab').on('click.bakemonoHubTab', '.menu_button[data-bakemono-tab]', function () {
        switchWorkbenchTab(this.dataset.bakemonoTab);
    });
    $('#bakemono-workbench-root').off('click.bakemonoThemeMode').on('click.bakemonoThemeMode', '[data-bakemono-theme-mode]', function () {
        const ui = getAppearanceSettings();
        ui.themeMode = this.dataset.bakemonoThemeMode === 'custom' ? 'custom' : 'tavern';
        saveGlobalSettings();
        renderAppearanceSettings();
    });
    $('#bakemono-workbench-root').off('input.bakemonoThemePreview').on('input.bakemonoThemePreview', '[data-bakemono-theme-color], [data-bakemono-theme-effect], #bakemono-memory-theme-name, #bakemono-memory-theme-appearance', previewCustomThemeFromUi);
    $('#bakemono-memory-theme-save').off('click').on('click', () => saveCustomTheme(readCustomThemeFromUi()));
    $('#bakemono-memory-theme-reset').off('click').on('click', () => saveCustomTheme(structuredClone(defaultCustomTheme), '已恢复自定义主题模板。'));
    $('#bakemono-memory-theme-copy-json').off('click').on('click', async () => {
        const theme = readCustomThemeFromUi();
        setCustomThemeJson(theme);
        await navigator.clipboard.writeText(JSON.stringify(theme, null, 2));
        toastr.success('主题 JSON 已复制。');
    });
    $('#bakemono-memory-theme-download-json').off('click').on('click', downloadCustomThemeJson);
    $('#bakemono-memory-theme-import-json').off('click').on('click', () => {
        try {
            importCustomThemeJson($('#bakemono-memory-theme-json').val());
        } catch (error) {
            toastr.error(error?.message || String(error), '主题导入失败');
        }
    });
    $('#bakemono-memory-theme-choose-file').off('click').on('click', () => $('#bakemono-memory-theme-file').trigger('click'));
    $('#bakemono-memory-theme-file').off('change').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        try {
            importCustomThemeJson(await file.text(), `已导入主题：${file.name}`);
        } catch (error) {
            toastr.error(error?.message || String(error), '主题文件导入失败');
        } finally {
            this.value = '';
        }
    });
    $('#bakemono-workbench-root').off('click.bakemonoNav').on('click.bakemonoNav', '[data-bakemono-nav]', function () {
        switchWorkbenchTab(this.dataset.bakemonoNav);
    });
    $('#bakemono-workbench-root').off('click.bakemonoHelp').on('click.bakemonoHelp', '.bakemono-memory-help-trigger', function (event) {
        event.stopImmediatePropagation();
        event.preventDefault();
        toggleWorkbenchHelpPopover(this);
    });
    $('#bakemono-workbench-root').off('keydown.bakemonoHelp').on('keydown.bakemonoHelp', '.bakemono-memory-help-trigger', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        event.stopImmediatePropagation();
        event.preventDefault();
        toggleWorkbenchHelpPopover(this);
    });
    $('#bakemono-workbench-root').off('toggle.bakemonoHelp').on('toggle.bakemonoHelp', 'details', function () {
        if (!this.open && activeWorkbenchHelpTrigger && this.contains(activeWorkbenchHelpTrigger)) {
            closeWorkbenchHelpPopover();
        }
    });
    $(document).off('click.bakemonoHelp').on('click.bakemonoHelp', event => {
        if (!event.target.closest('.bakemono-memory-help-trigger, #bakemono-memory-help-popover')) {
            closeWorkbenchHelpPopover();
        }
    });
    $(document).off('keydown.bakemonoHelp').on('keydown.bakemonoHelp', event => {
        if (event.key === 'Escape') {
            closeWorkbenchHelpPopover();
        }
    });
    window.removeEventListener('resize', closeWorkbenchHelpPopover);
    window.addEventListener('resize', closeWorkbenchHelpPopover);
    $('#bakemono-workbench-root .bakemono-workbench-main').off('scroll.bakemonoHelp').on('scroll.bakemonoHelp', closeWorkbenchHelpPopover);
    $('#bakemono-workbench-root').off('click.bakemonoMobileFold').on('click.bakemonoMobileFold', '.bakemono-mobile-collapsible > h4', function () {
        if (!(window.matchMedia?.('(max-width: 900px)').matches ?? false)) {
            return;
        }
        const panel = this.closest('.bakemono-mobile-collapsible');
        if (!panel) {
            return;
        }
        const expand = panel.classList.contains('is-mobile-collapsed');
        panel.classList.toggle('is-mobile-collapsed', !expand);
        panel.classList.toggle('is-mobile-expanded', expand);
        closeWorkbenchHelpPopover();
        stabilizeMobileWorkbenchScroll(document.getElementById('bakemono-workbench-root')?.dataset.activeTab || '');
    });
    $('#bakemono-workbench-root').off('click.bakemonoPromptEditorScroll').on('click.bakemonoPromptEditorScroll', '.bakemono-memory-prompt-editor-item > summary', function () {
        stabilizeMobileWorkbenchScroll('prompts');
    });
    $('#bakemono-workbench-root').off('click.bakemonoAction').on('click.bakemonoAction', '[data-bakemono-action]', async function () {
        try {
            await runWorkbenchAction(this.dataset.bakemonoAction);
        } catch (error) {
            console.error('[BakemonoMemory] action failed', error);
            const failure = `操作失败：${error?.message || error}`;
            setOperationFeedback('error', failure, 2600);
            renderAll(failure);
        } finally {
            operationFeedbackCaptureUntil = 0;
        }
    });
    $('#bakemono-workbench-root').off('change.bakemonoAutoArchiveToggle').on('change.bakemonoAutoArchiveToggle', '#bakemono-memory-auto-hide-enabled', async function () {
        try {
            await applyAutoHideRecentSettings();
        } catch (error) {
            console.error('[BakemonoMemory] auto archive toggle failed', error);
            toastr.error(error?.message || String(error), '剧情剪辑台');
        }
    });
    $('#bakemono-workbench-root').off('change.bakemonoAutoArchiveCount').on('change.bakemonoAutoArchiveCount', '#bakemono-memory-preserve-recent-input', async function () {
        const state = ensureState();
        readAutoHideRecentFieldsFromUi(state);
        saveState();
        if (!state.autoHideRecent.enabled) {
            renderAutoHideRecentPanel(state);
            return;
        }
        try {
            await applyAutoHideRecentBalance({ silent: false });
        } catch (error) {
            console.error('[BakemonoMemory] auto archive count failed', error);
            toastr.error(error?.message || String(error), '剧情剪辑台');
        }
    });
    $('#bakemono-workbench-root').off('click.bakemonoWorkflow').on('click.bakemonoWorkflow', '[data-bakemono-workflow-preset]', function () {
        applyWorkflowPreset(this.dataset.bakemonoWorkflowPreset);
    });
    $('#bakemono-workbench-root').off('click.bakemonoReviewView').on('click.bakemonoReviewView', '[data-bakemono-review-view]', function () {
        const nextView = String(this.dataset.bakemonoReviewView || 'drafts');
        if (!['drafts', 'tasks', 'history'].includes(nextView)) {
            return;
        }
        reviewPanelView = nextView;
        renderReviewPanelTabs();
        stabilizeMobileWorkbenchScroll('drafts');
    });
    $('#bakemono-workbench-root').off('click.bakemonoDraftEditorToggle').on('click.bakemonoDraftEditorToggle', '[data-bakemono-draft-editor-toggle]', function () {
        const card = this.closest('.bakemono-memory-draft-card');
        const details = card?.querySelector('.bakemono-memory-draft-editor-disclosure');
        if (!details) {
            return;
        }
        details.open = true;
        globalThis.requestAnimationFrame?.(() => details.querySelector('.bakemono-memory-draft-editor')?.focus());
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
            await commitDraft(draftId, card.querySelector('.bakemono-memory-draft-editor')?.value || '');
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
    $('#bakemono-workbench-root').off('click.bakemonoAutoTransaction').on('click.bakemonoAutoTransaction', '[data-bakemono-auto-tx-action]', async function () {
        const row = this.closest('.bakemono-memory-auto-tx-item');
        const transactionId = row?.dataset.transactionId;
        if (!transactionId) {
            return;
        }
        if (this.dataset.bakemonoAutoTxAction === 'rollback') {
            await rollbackAutoSummaryTransaction(transactionId);
        }
    });
    $('#bakemono-workbench-root').off('click.bakemonoPreviewType').on('click.bakemonoPreviewType', '[data-bakemono-preview-type]', function () {
        previewState.activeType = this.dataset.bakemonoPreviewType || 'story';
        renderPreviewSections();
    });
    $('#bakemono-workbench-root').off('click.bakemonoSummaryMode').on('click.bakemonoSummaryMode', '[data-bakemono-summary-mode]', function () {
        const nextMode = this.dataset.bakemonoSummaryMode || 'stage';
        if (!['stage', 'epic', 'batch'].includes(nextMode)) {
            return;
        }
        summaryGenerationMode = nextMode;
        renderSummaryGenerationPanel();
    });
    $('#bakemono-workbench-root').off('click.bakemonoPromptPreview').on('click.bakemonoPromptPreview', '[data-bakemono-prompt-preview]', function () {
        const nextType = this.dataset.bakemonoPromptPreview || 'stage';
        if (!['story', 'missing', 'stage', 'epic'].includes(nextType)) {
            return;
        }
        promptPreviewType = nextType;
        renderPromptOverview();
    });
    $('#bakemono-workbench-root').off('input.bakemonoPromptPreview').on('input.bakemonoPromptPreview', '#bakemono-memory-story-prompt, #bakemono-memory-missing-prompt, #bakemono-memory-stage-prompt, #bakemono-memory-epic-prompt', () => {
        renderPromptOverview();
    });
    $('#bakemono-memory-copy-prompt-preview').off('click').on('click', async () => {
        await navigator.clipboard.writeText(getPromptPreviewValue(promptPreviewType));
        toastr.success('当前提示词已复制。');
    });
    $('#bakemono-memory-export-maintenance').off('click').on('click', () => {
        exportMaintenanceTransactions();
    });
    $('#bakemono-workbench-root').off('click.bakemonoPreviewPage').on('click.bakemonoPreviewPage', '[data-bakemono-preview-page]', function () {
        const type = this.dataset.bakemonoPreviewType || previewState.activeType;
        const direction = this.dataset.bakemonoPreviewPage === 'next' ? 1 : -1;
        previewState.pages[type] = Math.max(0, (previewState.pages[type] || 0) + direction);
        previewState.activeType = type;
        renderPreviewSections();
        stabilizeMobilePreviewScroll();
    });
    $('#bakemono-workbench-root').off('click.bakemonoPreviewNotebookScroll').on('click.bakemonoPreviewNotebookScroll', '.bakemono-memory-notebook > summary, .bakemono-memory-card > summary', () => {
        stabilizeMobilePreviewScroll();
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
    $('#bakemono-workbench-root').off('click.bakemonoRecordPage').on('click.bakemonoRecordPage', '[data-bakemono-record-page]', function () {
        const direction = this.dataset.bakemonoRecordPage === 'next' ? 1 : -1;
        memoryRecordState.page = Math.max(0, (memoryRecordState.page || 0) + direction);
        renderMemoryRecordList();
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
    $('#bakemono-workbench-root').off('click.bakemonoTableDraftAction').on('click.bakemonoTableDraftAction', '[data-bakemono-table-draft-action]', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const card = this.closest('.bakemono-memory-table-draft-card');
        const draftId = card?.dataset.tableDraftId;
        const state = ensureState();
        const draft = state.tableDatabase.editDrafts.find(item => item.id === draftId);
        if (!draft) {
            toastr.warning('没有找到这个表格草稿。');
            return;
        }
        const action = this.dataset.bakemonoTableDraftAction;
        if (action === 'discard') {
            const confirmed = confirmDanger('丢弃表格修改草稿？', ['草稿丢弃后不会修改表格。']);
            if (!confirmed) {
                return;
            }
            state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draftId);
            saveState();
            renderAll('表格草稿已丢弃。');
            return;
        }
        const raw = String(card.querySelector('.bakemono-memory-table-draft-editor')?.value || draft.raw || '');
        try {
            draft.raw = raw;
            draft.operations = parseTableEditOperations(raw);
        } catch (error) {
            toastr.error(`重新解析失败：${error?.message || error}`);
            return;
        }
        if (action === 'reparse') {
            saveState();
            renderAll(`已重新解析：${draft.operations.length} 项操作。`);
            return;
        }
        if (action === 'apply') {
            const confirmed = confirmDanger(
                `应用 ${draft.operations.length} 项表格修改？`,
                ['这会修改当前聊天的表格数据库。应用后可以从导出数据中查看结果。'],
            );
            if (!confirmed) {
                return;
            }
            try {
                const undoSnapshot = applyTableOperations(draft.operations, state, {
                    sourceMessageIds: draft.sourceMessageIds,
                    undoLabel: `手动应用表格草稿：${formatSourceRange(draft.sourceMessageIds || [])}`,
                });
                state.tableDatabase.history.unshift({ ...draft, appliedAt: new Date().toISOString(), undoSnapshotId: undoSnapshot?.id || '' });
                state.tableDatabase.editDrafts = state.tableDatabase.editDrafts.filter(item => item.id !== draftId);
                saveState();
                renderAll('表格修改已应用。');
                toastr.success('表格修改已应用。');
            } catch (error) {
                toastr.error(`应用失败：${error?.message || error}`);
            }
        }
    });
    $('#bakemono-workbench-root').off('click.bakemonoTableAction').on('click.bakemonoTableAction', '[data-bakemono-table-action]', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const details = this.closest('.bakemono-memory-table-item');
        const action = this.dataset.bakemonoTableAction;
        if (!details) {
            return;
        }
        tableUiState.openTableIndex = String(details.dataset.tableIndex || '');
        if (action === 'add-row') {
            const state = ensureState();
            const table = saveEditedTableFromElement(details, { render: false, persist: false, state });
            if (!table) {
                return;
            }
            pushTableUndoSnapshot(`新增数据行：${table.name || table.tableIndex}`, state);
            table.rows = Array.isArray(table.rows) ? table.rows : [];
            const newRowIndex = table.rows.length;
            table.rows.push(table.columns.map(() => ''));
            tableUiState.openTableIndex = String(table.tableIndex);
            tableUiState.openSection = 'rows';
            tableUiState.focusCell = { tableIndex: String(table.tableIndex), rowIndex: String(newRowIndex), colIndex: '0' };
            persistCurrentTableDatabase(state);
            renderAll(`已新增一行：${table.name}`);
        } else if (action === 'add-column') {
            const state = ensureState();
            const table = saveEditedTableFromElement(details, { render: false, persist: false, state });
            if (!table) {
                return;
            }
            tableUiState.openTableIndex = String(table.tableIndex);
            tableUiState.openSection = 'fields';
            pushTableUndoSnapshot(`新增字段：${table.name || table.tableIndex}`, state);
            const index = table.columns.length;
            table.columns.push(`字段 ${index}`);
            table.columnPrompts = Array.isArray(table.columnPrompts) ? table.columnPrompts : [];
            table.columnPrompts.push('');
            table.rows = (table.rows || []).map(row => [...row, '']);
            tableUiState.focusField = { tableIndex: String(table.tableIndex), colIndex: String(index) };
            persistCurrentTableDatabase(state);
            renderAll(`已新增字段：${table.name}`);
        } else if (action === 'delete-column') {
            const state = ensureState();
            const table = saveEditedTableFromElement(details, { render: false, persist: false, state });
            if (!table) {
                return;
            }
            tableUiState.openSection = 'fields';
            const colIndex = Number(this.dataset.tableCol);
            const colName = table.columns[colIndex] || `字段 ${colIndex}`;
            const confirmed = confirmDanger(
                `删除字段「${colName}」？`,
                ['这会同时删除该字段下所有数据。'],
            );
            if (!confirmed) {
                renderAll();
                return;
            }
            pushTableUndoSnapshot(`删除字段：${table.name || table.tableIndex} / ${colName}`, state);
            table.columns.splice(colIndex, 1);
            table.columnPrompts = Array.isArray(table.columnPrompts) ? table.columnPrompts : [];
            table.columnPrompts.splice(colIndex, 1);
            table.rows = (table.rows || []).map(row => row.filter((_, index) => index !== colIndex));
            tableUiState.focusField = { tableIndex: String(table.tableIndex), colIndex: String(Math.max(0, colIndex - 1)) };
            persistCurrentTableDatabase(state);
            renderAll(`已删除字段：${colName}`);
        } else if (action === 'delete-row') {
            const state = ensureState();
            const table = saveEditedTableFromElement(details, { render: false, persist: false, state });
            const row = this.closest('tr[data-table-row]');
            if (row && table) {
                const rowIndex = Number(row.dataset.tableRow);
                const rowData = table.rows?.[rowIndex] || [];
                const preview = rowData.map(value => String(value || '').trim()).filter(Boolean).slice(0, 3).join(' / ') || `第 ${rowIndex + 1} 行`;
                const confirmed = confirmDanger(
                    `删除「${table.name || table.tableIndex}」的第 ${rowIndex + 1} 行？`,
                    [
                        `内容预览：${preview}`,
                        '删除后可以用“撤销表格操作”恢复上一版表格。',
                    ],
                );
                if (!confirmed) {
                    renderAll();
                    return;
                }
                pushTableUndoSnapshot(`删除数据行：${table.name || table.tableIndex} #${rowIndex + 1}`, state);
                table.rows.splice(rowIndex, 1);
                tableUiState.openTableIndex = String(table.tableIndex);
                tableUiState.openSection = 'rows';
                persistCurrentTableDatabase(state);
                renderAll(`已删除数据行：${table.name || table.tableIndex}`);
            }
        } else if (action === 'save-table') {
            saveEditedTableFromElement(details);
            toastr.success('表格已保存。');
        } else if (action === 'delete-table') {
            const state = ensureState();
            const tableIndex = Number(details.dataset.tableIndex);
            const table = (state.tableDatabase.tables || []).find(item => Number(item.tableIndex) === tableIndex);
            const confirmed = confirmDanger(
                `删除表格「${table?.name || tableIndex}」？`,
                ['这会删除整张表和其中所有数据行，无法从当前聊天里恢复。'],
            );
            if (!confirmed) {
                return;
            }
            pushTableUndoSnapshot(`删除表格：${table?.name || tableIndex}`, state);
            state.tableDatabase.tables = (state.tableDatabase.tables || []).filter(item => Number(item.tableIndex) !== tableIndex);
            if (String(tableUiState.openTableIndex) === String(tableIndex)) {
                tableUiState.openTableIndex = '';
            }
            details.remove();
            persistCurrentTableDatabase(state);
            renderAll('表格已删除。');
        }
    });
    $('#bakemono-workbench-root').off('change.bakemonoTableFlags').on('change.bakemonoTableFlags', '[data-table-readonly], [data-table-allow-ai]', function () {
        const details = this.closest('.bakemono-memory-table-item');
        if (!details) {
            return;
        }
        const readOnly = details.querySelector('[data-table-readonly]');
        const allowAi = details.querySelector('[data-table-allow-ai]');
        if (this.matches('[data-table-readonly]') && this.checked) {
            allowAi.checked = false;
            allowAi.disabled = true;
        } else if (this.matches('[data-table-readonly]')) {
            allowAi.disabled = false;
        } else if (this.matches('[data-table-allow-ai]') && this.checked) {
            readOnly.checked = false;
            allowAi.disabled = false;
        }
        saveEditedTableFromElement(details, { render: false });
        toastr.info('表格权限已更新。');
    });
    $('#bakemono-memory-undo-table-operation').off('click').on('click', () => {
        undoLastTableOperation(ensureState());
    });
    $('#bakemono-memory-redo-table-operation').off('click').on('click', () => {
        redoLastTableOperation(ensureState());
    });
    $('#bakemono-memory-create-table').off('click').on('click', () => {
        createCustomTableFromUi();
    });
    $('#bakemono-memory-table-schema-scope').off('change').on('change', function () {
        const state = ensureState();
        const nextScope = String(this.value || tableSchemaScopes.CHAT);
        const confirmed = confirmDanger(
            `切换到${getTableProfileScopeLabel(nextScope)}表格作用域？`,
            ['当前表格行数据会先保存到原表格组，再载入目标作用域的当前表格组。'],
        );
        if (!confirmed) {
            renderAll();
            return;
        }
        setTableSchemaScope(nextScope, state);
        saveState();
        renderAll(`Table schema scope: ${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
        toastr.success(`已切换表格框架：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
    });
    $('#bakemono-memory-switch-table-profile').off('click').on('click', () => {
        const state = ensureState();
        const scope = state.tableDatabase.schemaScope || tableSchemaScopes.CHAT;
        const profileId = String($('#bakemono-memory-table-profile-select').val() || '');
        if (switchTableProfile(scope, profileId, state)) {
            renderAll(`已切换表格组：${getActiveTableProfile(state)?.name || ''}`);
        }
    });
    $('#bakemono-memory-new-table-profile').off('click').on('click', () => {
        const state = ensureState();
        const name = String($('#bakemono-memory-table-profile-name').val() || '').trim() || `表格组 ${new Date().toLocaleString()}`;
        const profile = createTableProfileForCurrentScope(name, state);
        renderAll(`已新建表格组：${profile.name}`);
        toastr.success('表格组已创建。');
    });
    $('#bakemono-memory-save-table-profile').off('click').on('click', () => {
        const state = ensureState();
        const profile = getActiveTableProfile(state);
        if (profile) {
            profile.name = String($('#bakemono-memory-table-profile-name').val() || profile.name || '').trim() || profile.name;
        }
        syncCurrentTableSchemas(state);
        saveGlobalSettings();
        saveState();
        renderAll(`已保存表格组：${profile?.name || ''}`);
        toastr.success('表格组已保存。');
    });
    $('#bakemono-memory-delete-table-profile').off('click').on('click', () => {
        const state = ensureState();
        if (deleteActiveTableProfile(state)) {
            renderAll('表格组已删除。');
            toastr.success('表格组已删除。');
        }
    });
    $('#bakemono-memory-save-table-schema').off('click').on('click', () => {
        const state = ensureState();
        syncCurrentTableSchemas(state);
        saveState();
        renderAll(`Saved table schema: ${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
        toastr.success(`已保存表格框架：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
    });
    $('#bakemono-memory-load-table-schema').off('click').on('click', () => {
        const state = ensureState();
        saveCurrentTableProfileRows(state);
        loadActiveTableProfileRows(state);
        saveState();
        renderAll(`Loaded table schema: ${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
        toastr.success(`已拉取表格框架：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
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
        readPromptFieldsFromUi(state);
        saveState();
        renderAll('生成提示词已应用。');
        toastr.success('生成提示词已应用。');
    });
    $('#bakemono-memory-reset-stage-prompt').off('click').on('click', () => {
        const confirmed = confirmDanger(
            '恢复默认阶段总结提示词？',
            ['当前阶段总结提示词会被默认摘要手账模板覆盖。'],
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
            '恢复默认多次总结提示词？',
            ['当前多次总结提示词会被默认摘要手账模板覆盖。'],
        );
        if (!confirmed) {
            return;
        }
        const state = ensureState();
        state.generationPrompts.epic = defaultEpicGenerationPrompt;
        saveState();
        renderAll('多次总结提示词已恢复默认。');
    });
    $('#bakemono-memory-reset-story-prompt').off('click').on('click', () => {
        const confirmed = confirmDanger(
            '恢复默认旧正文补课提示词？',
            ['当前旧正文补课提示词会被默认摘要手账模板覆盖。'],
        );
        if (!confirmed) {
            return;
        }
        const state = ensureState();
        state.generationPrompts.story = defaultStoryGenerationPrompt;
        saveState();
        renderAll('旧正文摘要提示词已恢复默认。');
    });
    $('#bakemono-memory-reset-missing-prompt').off('click').on('click', () => {
        const confirmed = confirmDanger(
            '恢复默认补写缺失摘要提示词？',
            ['当前补写缺失摘要提示词会被默认摘要手账模板覆盖。'],
        );
        if (!confirmed) {
            return;
        }
        const state = ensureState();
        state.generationPrompts.missing = defaultMissingSummaryPrompt;
        saveState();
        renderAll('补写缺失摘要提示词已恢复默认。');
    });
    $('#bakemono-memory-apply-turn-settings').off('click').on('click', () => {
        const state = ensureState();
        readTurnSummaryFieldsFromUi(state);
        syncInlineGenerationPrompts(state);
        saveState();
        renderAll('正文摘要设置已应用。');
        toastr.success('正文摘要设置已应用。');
    });
    $('#bakemono-memory-reset-turn-prompt').off('click').on('click', () => {
        const confirmed = confirmDanger(
            '恢复默认正文摘要提示词？',
            ['当前正文摘要提示词会被默认模板覆盖。'],
        );
        if (!confirmed) {
            return;
        }
        const state = ensureState();
        state.turnSummary.prompt = defaultTurnSummaryPrompt;
        saveState();
        renderAll('正文摘要提示词已恢复默认。');
    });
    $('#bakemono-memory-reset-table-prompt').off('click').on('click', () => {
        const confirmed = confirmDanger(
            '恢复默认表格修改提示词？',
            ['当前表格修改提示词会被默认模板覆盖。'],
        );
        if (!confirmed) {
            return;
        }
        const state = ensureState();
        state.turnSummary.tablePrompt = defaultTableEditPrompt;
        saveState();
        renderAll('表格修改提示词已恢复默认。');
    });
    $('#bakemono-memory-table-preset-select').off('change').on('change', function () {
        const previousId = getSelectedTablePromptPresetId();
        const selectedId = String(this.value || '');
        setSelectedTablePromptPresetId(selectedId);
        const preset = getTablePromptPresets().find(item => item.id === selectedId);
        if (!preset) {
            return;
        }
        const confirmed = confirmDanger(`使用表格提示词「${preset.name}」？`, ['当前编辑框里的表格提示词会被覆盖。']);
        if (!confirmed) {
            setSelectedTablePromptPresetId(previousId);
            renderPromptPresetControls();
            return;
        }
        const state = ensureState();
        state.turnSummary.tablePrompt = preset.prompt || defaultTableEditPrompt;
        saveState();
        renderAll(`已使用表格提示词：${preset.name}`);
    });
    $('#bakemono-memory-load-table-preset').off('click').on('click', () => {
        const preset = getTablePromptPresets().find(item => item.id === getSelectedTablePromptPresetId());
        if (!preset) {
            toastr.warning('没有找到表格提示词预设。');
            return;
        }
        const confirmed = confirmDanger(`载入表格提示词「${preset.name}」？`, ['当前编辑框里的表格提示词会被覆盖。']);
        if (!confirmed) return;
        const state = ensureState();
        state.turnSummary.tablePrompt = preset.prompt || defaultTableEditPrompt;
        saveState();
        renderAll(`已载入表格提示词：${preset.name}`);
    });
    $('#bakemono-memory-save-table-preset').off('click').on('click', () => {
        const name = String($('#bakemono-memory-table-preset-name').val() || '').trim();
        if (!name) {
            toastr.warning('请先填写表格提示词预设名称。');
            return;
        }
        let preset = getTablePromptPresets().find(item => item.id === getSelectedTablePromptPresetId());
        if (preset && preset.id !== 'default-table-prompt') {
            preset.name = name;
            preset.prompt = String($('#bakemono-memory-table-prompt').val() || defaultTableEditPrompt);
            preset.updatedAt = new Date().toISOString();
        } else {
            preset = makeTablePromptPreset(name, $('#bakemono-memory-table-prompt').val());
            getTablePromptPresets().push(preset);
            setSelectedTablePromptPresetId(preset.id);
        }
        saveGlobalSettings();
        renderAll(`已保存表格提示词：${preset.name}`);
    });
    $('#bakemono-memory-update-table-preset').off('click').on('click', () => {
        const presets = getTablePromptPresets();
        const preset = presets.find(item => item.id === getSelectedTablePromptPresetId());
        if (!preset) {
            toastr.warning('没有找到表格提示词预设。');
            return;
        }
        if (preset.id === 'default-table-prompt') {
            toastr.warning('默认表格提示词不能覆盖，请另存为新预设。');
            return;
        }
        const confirmed = confirmDanger(`覆盖表格提示词「${preset.name}」？`, ['覆盖后无法自动恢复旧版本。']);
        if (!confirmed) return;
        preset.name = String($('#bakemono-memory-table-preset-name').val() || preset.name || '').trim() || preset.name;
        preset.prompt = String($('#bakemono-memory-table-prompt').val() || defaultTableEditPrompt);
        preset.updatedAt = new Date().toISOString();
        saveGlobalSettings();
        renderAll(`已覆盖表格提示词：${preset.name}`);
    });
    $('#bakemono-memory-delete-table-preset').off('click').on('click', () => {
        const presets = getTablePromptPresets();
        const preset = presets.find(item => item.id === getSelectedTablePromptPresetId());
        if (!preset) {
            toastr.warning('没有找到表格提示词预设。');
            return;
        }
        if (preset.id === 'default-table-prompt') {
            toastr.warning('默认表格提示词不能删除。');
            return;
        }
        const confirmed = confirmDanger(`删除表格提示词「${preset.name}」？`, ['删除后不能从预设列表恢复。']);
        if (!confirmed) return;
        const index = presets.findIndex(item => item.id === preset.id);
        if (index >= 0) presets.splice(index, 1);
        setSelectedTablePromptPresetId(presets[0]?.id || '');
        saveGlobalSettings();
        renderAll('表格提示词预设已删除。');
    });
    $('#bakemono-memory-pick-table-file').off('click').on('click', () => {
        $('#bakemono-memory-table-file').trigger('click');
    });
    $('#bakemono-memory-table-file').off('change').on('change', async function () {
        const file = this.files?.[0];
        if (!file) {
            return;
        }
        try {
            const raw = await file.text();
            $('#bakemono-memory-table-json').val(raw);
            importTablesFromText(raw, file.name || '本地文件');
        } catch (error) {
            toastr.error(`读取文件失败：${error?.message || error}`);
        } finally {
            this.value = '';
        }
    });
    $('#bakemono-memory-import-table-json').off('click').on('click', () => {
        importTablesFromText($('#bakemono-memory-table-json').val(), '文本框');
    });
    $('#bakemono-memory-export-table-json').off('click').on('click', () => {
        const state = ensureState();
        $('#bakemono-memory-table-json').val(JSON.stringify({
            version: 1,
            tables: state.tableDatabase.tables || [],
        }, null, 2));
        toastr.success('当前表格已导出到文本框。');
    });
    $('#bakemono-memory-clear-table-db').off('click').on('click', () => {
        const state = ensureState();
        if (!state.tableDatabase.tables.length && !state.tableDatabase.editDrafts.length) {
            toastr.info('当前没有表格可清空。');
            return;
        }
        const confirmed = confirmDanger(
            '清空当前聊天的表格数据库？',
            ['这会删除表格结构、表格数据和未应用的表格草稿。摘要不会被删除。'],
        );
        if (!confirmed) {
            return;
        }
        state.tableDatabase.tables = [];
        state.tableDatabase.editDrafts = [];
        state.tableDatabase.history = [];
        if ((state.tableDatabase.schemaScope || tableSchemaScopes.CHAT) !== tableSchemaScopes.CHAT) {
            state.tableDatabase.tables = getScopedTableSchemas(state.tableDatabase.schemaScope).map(schema => ({ ...schema, rows: [] }));
        }
        saveCurrentTableProfileRows(state);
        updateInjectionFromSummaries();
        renderAll('表格数据库已清空。');
    });
    $('#bakemono-memory-apply-automation').off('click').on('click', () => {
        const state = ensureState();
        readAutomationFieldsFromUi(state);
        readGenerationTargetSettings();
        saveState();
        renderAll('自动总结设置已应用。');
        toastr.success('自动总结设置已应用。');
    });
    $('#bakemono-memory-auto-trigger').off('change.bakemonoAutomationUi').on('change.bakemonoAutomationUi', function () {
        const triggerType = String(this.value || defaultAutomation.triggerType);
        document.querySelectorAll('[data-bakemono-auto-rule]').forEach(row => {
            row.hidden = row.dataset.bakemonoAutoRule !== triggerType;
        });
    });
    $('#bakemono-memory-fetch-models').off('click').on('click', async () => {
        await fetchCustomApiModels();
    });
    $('#bakemono-memory-toggle-api-key').off('click').on('click', function () {
        const input = document.querySelector('#bakemono-memory-custom-api-key');
        if (!input) {
            return;
        }
        const shouldShow = input.type === 'password';
        input.type = shouldShow ? 'text' : 'password';
        this.title = shouldShow ? '隐藏接口密钥' : '显示接口密钥';
        this.setAttribute('aria-label', this.title);
        this.querySelector('i')?.classList.toggle('fa-eye', !shouldShow);
        this.querySelector('i')?.classList.toggle('fa-eye-slash', shouldShow);
        const label = this.querySelector('span');
        if (label) {
            label.textContent = shouldShow ? '隐藏' : '显示';
        }
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
    $('#bakemono-memory-record-filter, #bakemono-memory-record-kind, #bakemono-memory-record-status').off('input change').on('input change', () => {
        memoryRecordState.page = 0;
        renderMemoryRecordList();
    });
    $('#bakemono-workbench-root').off('click.bakemonoRecordQuickFilter').on('click.bakemonoRecordQuickFilter', '[data-bakemono-record-status]', function () {
        const status = String(this.dataset.bakemonoRecordStatus || 'all');
        if (!['all', ...Object.values(memoryRecordStatuses)].includes(status)) {
            return;
        }
        $('#bakemono-memory-record-status').val(status);
        memoryRecordState.page = 0;
        renderMemoryRecordList();
    });
    $('#bakemono-memory-clear-record-filter').off('click').on('click', () => {
        $('#bakemono-memory-record-filter').val('');
        $('#bakemono-memory-record-kind').val('all');
        $('#bakemono-memory-record-status').val('all');
        memoryRecordState.page = 0;
        renderMemoryRecordList();
    });
    $('#bakemono-memory-preset-select').off('change').on('change', function () {
        const previousId = getSelectedPromptPresetId();
        const selectedId = String(this.value || defaultPromptPreset.id);
        setSelectedPromptPresetId(selectedId);
        renderPromptPresetControls();
        const preset = getPromptPresets().find(item => item.id === selectedId);
        if (!preset) {
            return;
        }
        const confirmed = confirmDanger(
            `使用配置「${preset.name || '未命名配置'}」？`,
            ['会立即覆盖当前聊天的工作流、扫描、自动、提示词、注入、向量等配置。', '也会设为全局默认，新聊天会自动使用它。'],
        );
        if (!confirmed) {
            setSelectedPromptPresetId(previousId);
            renderPromptPresetControls();
            return;
        }
        usePromptPresetAsGlobalDefault(preset);
    });
    $('#bakemono-memory-load-preset').off('click').on('click', () => {
        const preset = getPromptPresets().find(item => item.id === getSelectedPromptPresetId());
        if (!preset) {
            toastr.warning('没有找到选中的预设。');
            return;
        }
        const confirmed = confirmDanger(
            `使用并设为全局默认「${preset.name || '未命名预设'}」？`,
            ['会覆盖当前聊天的配置，并让之后打开的新聊天自动使用这套配置。'],
        );
        if (!confirmed) {
            return;
        }
        usePromptPresetAsGlobalDefault(preset);
    });
    $('#bakemono-memory-save-preset').off('click').on('click', () => {
        const name = String($('#bakemono-memory-preset-name').val() || '').trim();
        if (!name) {
            toastr.warning('请先填写预设名称。');
            return;
        }
        const selectedId = getSelectedPromptPresetId();
        const selected = getPromptPresets().find(preset => preset.id === selectedId);
        const preset = isBuiltInPresetId(selectedId) || !selected
            ? saveCurrentConfigPreset(name)
            : saveCurrentConfigPreset(name, { replaceId: selectedId });
        const config = setActiveGlobalConfig(preset);
        markStateGlobalConfigApplied(ensureState(), config);
        saveState();
        renderAll(isBuiltInPresetId(selectedId) || !selected ? `已另存并设为全局默认：${preset.name}` : `已覆盖并设为全局默认：${preset.name}`);
    });
    $('#bakemono-memory-save-as-preset').off('click').on('click', () => {
        const name = String($('#bakemono-memory-preset-name').val() || '').trim();
        if (!name) {
            toastr.warning('请先填写预设名称。');
            return;
        }
        const preset = saveCurrentConfigPreset(name);
        const config = setActiveGlobalConfig(preset);
        markStateGlobalConfigApplied(ensureState(), config);
        saveState();
        renderAll(`已另存并设为全局默认：${preset.name}`);
    });
    $('#bakemono-memory-delete-preset').off('click').on('click', () => {
        const selectedId = getSelectedPromptPresetId();
        if (isBuiltInPresetId(selectedId)) {
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
        if (getActiveGlobalConfig()?.id === selectedId) {
            const fallback = extension_settings[STORAGE_KEY].promptPresets.find(preset => preset.id === defaultPromptPreset.id)
                || extension_settings[STORAGE_KEY].promptPresets[0]
                || structuredClone(defaultPromptPreset);
            const config = setActiveGlobalConfig(fallback);
            applyGlobalActiveConfigToState(ensureState());
            markStateGlobalConfigApplied(ensureState(), config);
            saveState();
        }
        setSelectedPromptPresetId(defaultPromptPreset.id);
        saveGlobalSettings();
        renderAll('预设已删除。');
    });
    $('#bakemono-memory-export-preset').off('click').on('click', () => {
        const selected = getPromptPresets().find(item => item.id === getSelectedPromptPresetId());
        const preset = getCurrentPromptPresetPayload($('#bakemono-memory-preset-name').val() || selected?.name || '当前工作流');
        $('#bakemono-memory-preset-json').val(JSON.stringify(preset, null, 2));
        toastr.success('预设数据已写入导出框。');
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
        toastr.success('预设数据已复制。');
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
    bindAreaPresetControls(areaPresetScopes.SCAN, {
        select: '#bakemono-memory-scan-preset-select',
        name: '#bakemono-memory-scan-preset-name',
        load: '#bakemono-memory-load-scan-preset',
        save: '#bakemono-memory-save-scan-preset',
        update: '#bakemono-memory-update-scan-preset',
        delete: '#bakemono-memory-delete-scan-preset',
    });
    bindAreaPresetControls(areaPresetScopes.AUTOMATION, {
        select: '#bakemono-memory-automation-preset-select',
        name: '#bakemono-memory-automation-preset-name',
        load: '#bakemono-memory-load-automation-preset',
        save: '#bakemono-memory-save-automation-preset',
        update: '#bakemono-memory-update-automation-preset',
        delete: '#bakemono-memory-delete-automation-preset',
    });
    bindAreaPresetControls(areaPresetScopes.API, {
        select: '#bakemono-memory-api-preset-select',
        name: '#bakemono-memory-api-preset-name',
        load: '#bakemono-memory-load-api-preset',
        save: '#bakemono-memory-save-api-preset',
        update: '#bakemono-memory-update-api-preset',
        delete: '#bakemono-memory-delete-api-preset',
    });
    bindAreaPresetControls(areaPresetScopes.PROMPTS, {
        select: '#bakemono-memory-prompts-preset-select',
        name: '#bakemono-memory-prompts-preset-name',
        load: '#bakemono-memory-load-prompts-preset',
        save: '#bakemono-memory-save-prompts-preset',
        update: '#bakemono-memory-update-prompts-preset',
        delete: '#bakemono-memory-delete-prompts-preset',
    });
    bindAreaPresetControls(areaPresetScopes.TURN, {
        select: '#bakemono-memory-turn-preset-select',
        name: '#bakemono-memory-turn-preset-name',
        load: '#bakemono-memory-load-turn-preset',
        save: '#bakemono-memory-save-turn-preset',
        update: '#bakemono-memory-update-turn-preset',
        delete: '#bakemono-memory-delete-turn-preset',
    });
    bindAreaPresetControls(areaPresetScopes.INJECTION, {
        select: '#bakemono-memory-injection-preset-select',
        name: '#bakemono-memory-injection-preset-name',
        load: '#bakemono-memory-load-injection-preset',
        save: '#bakemono-memory-save-injection-preset',
        update: '#bakemono-memory-update-injection-preset',
        delete: '#bakemono-memory-delete-injection-preset',
    });
    bindAreaPresetControls(areaPresetScopes.VECTOR, {
        select: '#bakemono-memory-vector-preset-select',
        name: '#bakemono-memory-vector-preset-name',
        load: '#bakemono-memory-load-vector-preset',
        save: '#bakemono-memory-save-vector-preset',
        update: '#bakemono-memory-update-vector-preset',
        delete: '#bakemono-memory-delete-vector-preset',
    });
    bindInlinePromptPresetControls('summary', {
        select: '#bakemono-memory-inline-summary-preset-select',
        name: '#bakemono-memory-inline-summary-preset-name',
        load: '#bakemono-memory-load-inline-summary-preset',
        save: '#bakemono-memory-save-inline-summary-preset',
        update: '#bakemono-memory-update-inline-summary-preset',
        delete: '#bakemono-memory-delete-inline-summary-preset',
    });
    bindInlinePromptPresetControls('table', {
        select: '#bakemono-memory-inline-table-preset-select',
        name: '#bakemono-memory-inline-table-preset-name',
        load: '#bakemono-memory-load-inline-table-preset',
        save: '#bakemono-memory-save-inline-table-preset',
        update: '#bakemono-memory-update-inline-table-preset',
        delete: '#bakemono-memory-delete-inline-table-preset',
    });
    $('#bakemono-memory-apply-rules').off('click').on('click', () => {
        const state = ensureState();
        readRuleFieldsFromUi(state);
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
        renderAll('工作流模式已切换，已有扫描和自动总结配置已保留。');
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
        const content = renderInjectionContent(previewState);
        $('#bakemono-memory-injection-content').val(content);
        $('#bakemono-memory-injection-char-count').text(`约 ${content.length.toLocaleString()} 字符`);
    });
}

async function initWorkbench() {
    const response = await fetch(`${extensionFolderPath}/settings.html`);
    if (!response.ok) {
        throw new Error(`Failed to load settings.html: ${response.status} ${response.statusText}`);
    }

    document.getElementById('bakemono-workbench-root')?.remove();
    $('body').append(await response.text());
    applyAppearanceTheme();
    await addExtensionSettingsBlock();
    await addWandButton();
    syncTopNavButton();
    bindSettingsEvents();
    switchWorkbenchTab('overview');
    renderAll();
}

async function addExtensionSettingsBlock() {
    const container = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
    if (!container) {
        return;
    }

    document.getElementById('bakemono-memory-extension-settings')?.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'bakemono-memory-extension-settings';
    wrapper.className = 'extension_container bakemono-memory-extension-settings';
    wrapper.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-clapperboard"></i> 剧情剪辑台</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="bakemono-memory-extension-entry">
                    <button type="button" class="menu_button menu_button_icon" id="bakemono-memory-extension-open">
                        <i class="fa-solid fa-clapperboard"></i>
                        <span>打开剧情剪辑台</span>
                    </button>
                    <label class="checkbox_label" for="bakemono-memory-show-top-nav">
                        <input id="bakemono-memory-show-top-nav" type="checkbox" class="checkbox">
                        <span>在顶部导航栏显示入口按钮</span>
                    </label>
                    <small>如果当前酒馆美化和顶部栏不兼容，可以关闭这个入口，继续用左下角魔法棒进入。</small>
                </div>
            </div>
        </div>
    `;
    container.append(wrapper);
    renderExtensionEntrySettings();
}

function renderExtensionEntrySettings() {
    const settings = extension_settings[STORAGE_KEY] || {};
    $('#bakemono-memory-show-top-nav').prop('checked', !!settings.ui?.showTopNavButton);
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

function syncTopNavButton() {
    const settings = extension_settings[STORAGE_KEY] || {};
    const shouldShow = !!settings.ui?.showTopNavButton;
    const existing = document.getElementById('bakemono-memory-top-nav-entry');
    if (!shouldShow) {
        existing?.remove();
        return;
    }
    if (existing) {
        return;
    }

    const holder = document.getElementById('top-settings-holder') || document.getElementById('top-bar');
    if (!holder) {
        return;
    }

    const entry = document.createElement('div');
    entry.id = 'bakemono-memory-top-nav-entry';
    entry.className = 'drawer bakemono-memory-top-nav-entry';
    entry.innerHTML = `
        <div class="drawer-toggle bakemono-memory-top-nav-toggle">
            <div id="bakemono-memory-top-nav-button"
                class="drawer-icon fa-solid fa-clapperboard fa-fw closedIcon bakemono-memory-top-nav-button"
                title="剧情剪辑台"
                aria-label="打开剧情剪辑台"></div>
        </div>
    `;
    entry.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openWorkbench();
    });

    const anchor = document.getElementById('extensions-settings-button');
    if (anchor?.parentElement === holder) {
        anchor.insertAdjacentElement('afterend', entry);
    } else {
        holder.append(entry);
    }
}

function openWorkbench() {
    const root = document.getElementById('bakemono-workbench-root');
    closeWorkbenchHelpPopover();
    root?.classList.remove('bakemono-workbench-hidden');
    root?.setAttribute('aria-hidden', 'false');
    scanBakemonoBlocks({ persist: false, render: false });
    renderAll();
}

function closeWorkbench() {
    const root = document.getElementById('bakemono-workbench-root');
    closeWorkbenchHelpPopover();
    clearOperationFeedback();
    setWorkbenchMenuOpen(false);
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
    syncGlobalActiveConfigToState(ensureState());
    await initWorkbench();
    syncInjection();
    if (ensureState().vectorMemory.enabled) {
        const state = ensureState();
        if (state.vectorMemory.lastIndexedSignature !== getVectorSourceSignature(state)) {
            markVectorIndexDirty('初始化检测到聊天变更', state);
        } else {
            scheduleVectorAutoIndex('初始化');
        }
    }

    scheduleAutoHideRecent('init');

    eventSource.on(event_types.CHAT_CHANGED, () => {
        syncGlobalActiveConfigToState(ensureState());
        scheduleAutoHideRecent('chat changed');
        markVectorIndexDirty('切换聊天');
        syncInjection();
        scheduleRenderAll();
    });
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        await captureInlineGenerationFromLatestMessage();
        scheduleInlineGenerationCapture('收到新回复');
        await maybeRunTurnSummary();
        await maybeRunAutoSummary();
        scheduleAutoHideRecent('message received');
        markVectorIndexDirty('收到新消息');
        syncInjection();
        scheduleRenderAll();
    });
    for (const event of [event_types.MESSAGE_UPDATED, event_types.MESSAGE_DELETED, event_types.MESSAGE_SWIPED]) {
        eventSource.on(event, (...args) => {
            const eventMessageIds = collectMessageIdsFromEventArgs(args);
            const fallbackTurn = findLatestAssistantTurn();
            const messageIds = eventMessageIds.length ? eventMessageIds : getFiniteMessageIds([fallbackTurn?.assistantMessage?.messageId]);
            markAffectedAutoSummaryTransactions(messageIds, event === event_types.MESSAGE_DELETED ? '楼层已删除' : event === event_types.MESSAGE_SWIPED ? '楼层已重 roll' : '楼层已编辑');
            scheduleAutoHideRecent('message changed');
            if (event !== event_types.MESSAGE_DELETED) {
                rollbackLatestTableOperationForChangedMessages(messageIds, ensureState());
                const state = ensureState();
                state.inlineGeneration.lastProcessedMessageId = null;
                state.inlineGeneration.lastProcessedSignature = '';
                scheduleInlineGenerationCapture('消息更新');
            } else {
                rollbackLatestTableOperationForDeletedMessages(messageIds, ensureState());
            }
            markVectorIndexDirty('消息变更');
            syncInjection();
            scheduleRenderAll();
        });
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
