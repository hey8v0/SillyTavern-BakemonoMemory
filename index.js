import { chat, chat_metadata, extension_prompt_roles, extension_prompt_types, eventSource, event_types, generateRaw, itemizedParams, itemizedPrompts, saveChatConditional, saveSettingsDebounced, setExtensionPrompt } from '../../../../script.js';
import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { hideChatMessageRange } from '../../../chats.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { runChatSwitchFlow } from './src/core/chat-switch.js';
import { createSharedInlineGenerationConfig, createSharedVectorConfig, markActiveConfigApplied, mergeSharedInlineGenerationConfig, mergeSharedVectorConfig, readActiveConfig, sharedConfigVersion, shouldBootstrapSharedConfig, shouldSyncActiveConfig } from './src/core/config-sync.js';
import { persistChatState, persistGlobalSettings } from './src/core/persistence.js';
import { migrateGenerationPrompts, migrateInlineSummaryPrompt, migratePromptPresetTimelines, migrateTurnSummaryPrompt, migrateVectorQueryRewritePrompt } from './src/core/prompt-migrations.js';
import { ensureObjectField, fillMissingDefaults, normalizeArrayFields } from './src/core/state-shape.js';
import { memoryStrategies, normalizeWorkflowState, stageSourceModes, workflowModes } from './src/core/workflow-mode.js';
import { migrateBuiltInInjectionDefaults, normalizeInjectionMemoryBody, normalizeLineEndings, renderInjectionTemplate } from './src/shared/injection-template.js';
import { unique } from './src/shared/collections.js';
import { formatBlocksForPrompt, getPromptStructureExcerpt, migrateBuiltInStructuredPrompt, migrateEpicPromptTimeSpan, migrateStagePromptTimeSpan, renderGenerationPrompt, stripPostProcessNoise } from './src/shared/prompt-utils.js';
import { countKeywordHits, extractAllTaggedBlocks, extractConfiguredTagBlocks, extractTaggedContent, getHash, matchesAnyKeyword, normalizeSearchText, parseList, stripConfiguredTags, stripTableEditTags } from './src/shared/text.js';
import { parseMissingSummaryBatchResult } from './src/summary/draft-parser.js';
import { getMultiSummaryLabel, getNextMultiSummaryLevel, getSummaryLevel } from './src/summary/levels.js';
import { buildFloorMemoryIndex, createMemoryOrchestrationPlan } from './src/memory/floor-memory-index.js';
import { formatSourceRange, getBlockSortKey, getFiniteMessageIds, getSourceEnd, getSourceMessageIdsFromBlocks, getSourceStart, getSummarySortKey, sortSummariesBySource } from './src/summary/source-metadata.js';
import { parseTableEditOperations } from './src/tables/operation-parser.js';
import { buildTableRollbackPlan } from './src/tables/rollback-plan.js';
import { baseStoryLedgerPreset, createBaseStoryLedgerTables } from './src/tables/builtin-presets.js';
import { findMatchingTable, mergeTableSchemaWithRows, normalizeImportedTablesFromJson, normalizeTableSchemas, normalizeTableText, toTableSchema } from './src/tables/schema-utils.js';
import { defaultGenerationTargets, getSortedTargetBlocks, parseLooseNumberRange, partitionGenerationTargets, selectGenerationTargets, targetSelectionModes } from './src/summary/target-selection.js';
import { cosineSimilarity, createLocalEmbedding } from './src/vector/math.js';
import { computeHybridRerankScore, selectHybridCandidates } from './src/vector/hybrid-retrieval.js';
import { extractCustomModelIds, getCustomChatCompletionsUrl, getCustomEmbeddingsUrl, getCustomModelsUrl, normalizeCustomApiBaseUrl } from './src/vector/provider-config.js';
import { extractChatCompletionText, parseVectorQueryRewritePayload } from './src/vector/query-parser.js';
import { compactEmbedding, getClippedVectorText, slimVectorMemoryForSave } from './src/vector/storage.js';
import { createPromptInspector } from './src/features/prompt-inspector.js';
import { createHelpGuide } from './src/features/help-guide.js';
import { createSummaryMemoryModel } from './src/features/summary-memory-model.js';
import { createSummarySelectors } from './src/features/summary-selectors.js';
import { createSummaryTargetController } from './src/features/summary-target-controller.js';
import { createSummaryTaskQueue } from './src/features/summary-task-queue.js';
import { createTableStateService } from './src/features/table-state-service.js';
import { createTableMemoryModel } from './src/features/table-memory-model.js';
import { createTableWorkflowController } from './src/features/table-workflow-controller.js';
import { createTableWorkbenchUi } from './src/features/table-workbench-ui.js';
import { createVectorMemoryService } from './src/features/vector-memory-service.js';
import { createVectorSettingsModel } from './src/features/vector-settings-model.js';
import { createVectorWorkbenchUi } from './src/features/vector-workbench-ui.js';
import { createVectorActionsController } from './src/features/vector-actions-controller.js';
import { createThemeSchema } from './src/theme/theme-schema.js';
import { createThemeController } from './src/features/theme-controller.js';
import { createPresetRegistry } from './src/features/preset-registry.js';
import { createInjectionService } from './src/features/injection-service.js';
import { createArchiveController } from './src/features/archive-controller.js';
import { createMemoryOrchestrator } from './src/features/memory-orchestrator.js';
import { createTurnProcessingController } from './src/features/turn-processing-controller.js';
import { createGenerationClient } from './src/features/generation-client.js';
import { createSummaryDraftService } from './src/features/summary-draft-service.js';
import { createContentBlockService } from './src/features/content-block-service.js';
import { createScanController } from './src/features/scan-controller.js';
import { createSummaryPreviewRenderer } from './src/features/summary-preview-renderer.js';
import { createSummaryGenerationController } from './src/features/summary-generation-controller.js';
import { createSummaryBackfillController } from './src/features/summary-backfill-controller.js';
import { createConfigurationService } from './src/features/configuration-service.js';
import { createConfigurationController } from './src/features/configuration-controller.js';
import { createMemoryRecordsUi } from './src/features/memory-records-ui.js';
import { createOverviewTokenManifest } from './src/features/overview-token-manifest.js';
import { createWorkflowOverviewModel } from './src/features/workflow-overview-model.js';
import { createOverviewWorkbenchUi } from './src/features/overview-workbench-ui.js';
import { createSummaryGenerationUi } from './src/features/summary-generation-ui.js';
import { createTurnSummaryUi } from './src/features/turn-summary-ui.js';
import { createHubAutomationUi } from './src/features/hub-automation-ui.js';
import { createGlobalSettingsService } from './src/core/global-settings-service.js';
import { createChatStateService } from './src/core/chat-state-service.js';
import { createHelpPopover } from './src/ui/help-popover.js';
import { createOperationFeedback } from './src/ui/operation-feedback.js';
import { installWorkbenchParentNavigation, organizeWorkbenchOwnedSections } from './src/ui/workbench-layout.js';
import { createWorkbenchNavigation } from './src/ui/workbench-navigation.js';

const EXT_ID = 'BakemonoMemory';
const STORAGE_KEY = 'bakemonoMemory';
const INJECTION_KEY = 'bakemono_memory';

const themeSchema = createThemeSchema({ getHash });
const {
    CUSTOM_THEME_LIBRARY_SCHEMA,
    CUSTOM_THEME_SCHEMA,
    builtInCustomThemeDefinitions,
    builtInCustomThemePresetIds,
    defaultCustomTheme,
    makeCustomThemePresetId,
    normalizeCustomThemePreset,
    sanitizeCustomTheme,
} = themeSchema;

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

const legacyInjectionTemplate = `【剧情剪辑台：长期剧情记忆】
以下内容是已经压缩整理过的剧情记忆。请把它当作已发生事实与长期线索参考，不要复述给用户，也不要替代当前回合正文。

{{memory}}`;

const defaultInjectionTemplate = `【剧情剪辑台：长期剧情记忆】
以下内容是已经压缩整理过的剧情记忆。请把它当作已发生事实与长期线索参考，不要复述给用户，也不要替代当前回合正文。

{{memory}}
【剧情剪辑台：长期剧情记忆结束】`;

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
        depth: 999,
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
let scheduledRenderHandle = null;
let scheduledRenderStatus = '';
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
let promptPreviewType = 'stage';
let reviewPanelView = 'drafts';
const historyState = {
    page: 0,
};
const timelineState = {
    page: 0,
};
const tableUiState = {
    openTableIndex: '',
    focusCell: null,
    openSection: '',
    focusField: null,
};
function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
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
    persistChatState(chat_metadata?.[STORAGE_KEY] || null, {
        prepare: state => slimVectorMemoryForSave(state?.vectorMemory, defaultVectorMemory),
        save: saveMetadataDebounced,
    });
}

function saveGlobalSettings() {
    persistGlobalSettings(saveSettingsDebounced);
}

function setBusy(value) {
    isBusy = value;
    $('#bakemono-memory-generate-stage, #bakemono-memory-generate-epic, #bakemono-memory-backfill, [data-bakemono-action="generate-stage"], [data-bakemono-action="generate-stage-batch"], [data-bakemono-action="generate-epic"], [data-bakemono-action="generate-epic-batch"], [data-bakemono-action="backfill"], [data-bakemono-action="batch-summary"], [data-bakemono-action="commit-missing-all"], [data-bakemono-action="remove-missing-all"], [data-bakemono-action="process-latest-turn"], [data-bakemono-action="process-latest-table"], [data-bakemono-action="vector-index"], [data-bakemono-action="vector-test"], [data-bakemono-action="vector-fetch-models"], [data-bakemono-action="vector-fetch-query-models"], [data-bakemono-draft-action], [data-bakemono-task-action], [data-bakemono-auto-tx-action], [data-bakemono-table-draft-action]').prop('disabled', value);
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


function renderTaskQueueProgress(statusText = '') {
    renderWorkbenchScope(workbenchRenderScopes.DRAFTS, statusText, { feedback: false, refreshDataHub: false });
}


function renderActivePresetControls(tabName) {
    if (tabName === 'config') {
        renderPresetControlPair('#bakemono-memory-preset-select', '#bakemono-memory-preset-name');
    } else if (tabName === 'scan') {
        renderAreaPresetControl(areaPresetScopes.SCAN, '#bakemono-memory-scan-preset-select', '#bakemono-memory-scan-preset-name');
    } else if (tabName === 'automation') {
        renderAreaPresetControl(areaPresetScopes.AUTOMATION, '#bakemono-memory-automation-preset-select', '#bakemono-memory-automation-preset-name');
    } else if (tabName === 'generation') {
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
    } else if (tabName === 'prompt-inspector') {
        void promptInspector.render();
    } else if (tabName === 'data-hub') {
        renderWorkbenchHubPanels(state);
        renderMemoryDatabaseSummary(state);
    } else if (tabName === 'settings-hub') {
        renderWorkbenchHubPanels(state);
    } else if (tabName === 'settings') {
        renderWorkflowGuide(state);
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
    } else if (tabName === 'generation') {
        renderCustomModelOptions(state.automation.customApi?.models || []);
    } else if (tabName === 'appearance') {
        renderAppearanceSettings();
    } else if (tabName === 'maintenance') {
        renderAutoHideRecentPanel(state);
        renderMaintenanceOverview(state);
    } else if (tabName === 'help') {
        helpGuide.render();
    }
}

function buildWorkbenchBlockBundle(state = ensureState()) {
    const story = getStoryBlocks();
    const stage = dedupeByHash([
        ...getBlocksByType(blockTypes.STAGE),
        ...state.stageSummaries.map(summaryToBlock),
    ]);
    const epic = dedupeByHash([
        ...getBlocksByType(blockTypes.EPIC),
        ...state.epicSummaries.map(summary => ({ ...summaryToBlock(summary), type: blockTypes.EPIC })),
    ]);
    return { story, stage, epic };
}

function syncActiveWorkbenchFormFields(activeTab, state = ensureState()) {
    if (activeTab === 'settings') {
        $('#bakemono-memory-memory-strategy').val(state.memoryStrategy || memoryStrategies.BAKEMONO);
        $('#bakemono-memory-workflow-mode').val(state.workflowMode || workflowModes.BAKEMONO);
        $('#bakemono-memory-stage-source-mode').val(getStageSourceMode(state));
        $('#bakemono-memory-output-mode').val(state.outputMode || 'bakemono');
        $('#bakemono-memory-strategy-label').text(getMemoryStrategyLabel(state.memoryStrategy));
        $('#bakemono-memory-workflow-label').text(`${getWorkflowModeLabel(state.workflowMode)} / ${getStageSourceModeLabel(getStageSourceMode(state))}`);
        const injectionParts = getInjectionMemoryParts(state);
        const uncoveredStory = state.storySummaries.filter(item => !(state.coveredBlockHashes || []).includes(item.hash)).length;
        $('#bakemono-memory-injection-stats').text(`注入：多次 ${injectionParts.stats.epic} / 阶段 ${injectionParts.stats.stage} / 普通 ${injectionParts.stats.story} / 表格 ${injectionParts.stats.table || 0} / 向量 ${injectionParts.stats.vector || 0}`);
        $('#bakemono-memory-memory-warning').text(getWorkflowStatusText(state, injectionParts.stats, uncoveredStory));
    } else if (activeTab === 'injection') {
        $('#bakemono-memory-injection-enabled').prop('checked', !!state.injection.enabled);
        $('#bakemono-memory-depth').val(state.injection.depth);
        $('#bakemono-memory-role').val(String(state.injection.role));
        $('#bakemono-memory-source-content').val(state.generatedMemory || '');
        $('#bakemono-memory-injection-template').val(state.injection.template || defaultInjectionTemplate);
        $('#bakemono-memory-injection-content').val(renderInjectionContent(state));
    } else if (activeTab === 'prompts') {
        $('#bakemono-memory-story-prompt').val(state.generationPrompts.story || defaultStoryGenerationPrompt);
        $('#bakemono-memory-missing-prompt').val(state.generationPrompts.missing || defaultMissingSummaryPrompt);
        $('#bakemono-memory-stage-prompt').val(state.generationPrompts.stage || defaultStageGenerationPrompt);
        $('#bakemono-memory-epic-prompt').val(state.generationPrompts.epic || defaultEpicGenerationPrompt);
    } else if (activeTab === 'scan') {
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
    } else if (activeTab === 'automation') {
        $('#bakemono-memory-auto-enabled').prop('checked', !!state.automation.enabled);
        $('#bakemono-memory-auto-mode').val(state.automation.mode || defaultAutomation.mode);
        $('#bakemono-memory-auto-trigger').val(state.automation.triggerType || defaultAutomation.triggerType);
        $('#bakemono-memory-auto-floor-interval').val(state.automation.floorInterval ?? defaultAutomation.floorInterval);
        $('#bakemono-memory-auto-char-interval').val(state.automation.charInterval ?? defaultAutomation.charInterval);
        $('#bakemono-memory-auto-hide-preserve-recent').val(state.automation.autoHidePreserveRecent ?? defaultAutomation.autoHidePreserveRecent);
    } else if (activeTab === 'preview') {
        $('#bakemono-memory-batch-summary-size').val(state.automation.backfillBatchSize ?? defaultAutomation.backfillBatchSize);
        $('#bakemono-memory-stage-target-mode').val(state.generationTargets.stage.mode || defaultGenerationTargets.stage.mode);
        $('#bakemono-memory-stage-target-count').val(state.generationTargets.stage.count ?? defaultGenerationTargets.stage.count);
        $('#bakemono-memory-stage-target-range').val(state.generationTargets.stage.range || '');
        $('#bakemono-memory-epic-target-mode').val(state.generationTargets.epic.mode || defaultGenerationTargets.epic.mode);
        $('#bakemono-memory-epic-target-count').val(state.generationTargets.epic.count ?? defaultGenerationTargets.epic.count);
        $('#bakemono-memory-epic-target-range').val(state.generationTargets.epic.range || '');
    } else if (activeTab === 'generation') {
        $('#bakemono-memory-api-provider').val(state.automation.apiProvider || defaultAutomation.apiProvider);
        $('#bakemono-memory-custom-base-url').val(state.automation.customApi?.baseUrl || '');
        $('#bakemono-memory-custom-api-key').val(state.automation.customApi?.apiKey || '');
        $('#bakemono-memory-custom-model').val(state.automation.customApi?.model || '');
        $('#bakemono-memory-custom-temperature').val(state.automation.customApi?.temperature ?? defaultAutomation.customApi.temperature);
        $('#bakemono-memory-custom-max-tokens').val(state.automation.customApi?.maxTokens ?? defaultAutomation.customApi.maxTokens);
        $('#bakemono-memory-custom-stream').val(String(!!state.automation.customApi?.stream));
    }
}

const workbenchRenderScopes = Object.freeze({
    VECTOR: 'vector',
    DRAFTS: 'drafts',
    TABLES: 'tables',
    SUMMARY: 'summary',
    SCAN: 'scan',
    ARCHIVE: 'archive',
    INJECTION: 'injection',
    AUTOMATION: 'automation',
    PROMPTS: 'prompts',
    GENERATION: 'generation',
    CONFIG: 'config',
    SETTINGS: 'settings',
});

const operationFeedback = createOperationFeedback({
    escapeHtml,
    setBusy,
    renderScope: (...args) => renderWorkbenchScope(...args),
    getDefaultRenderScope: () => workbenchRenderScopes.SUMMARY,
    logError: (...args) => console.error(...args),
});
const { runGeneration, runVisible: runVisibleOperation } = operationFeedback;
const helpPopover = createHelpPopover();
const helpGuide = createHelpGuide({ escapeHtml });

const globalSettingsService = createGlobalSettingsService({
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    sanitizeCustomTheme,
    normalizeCustomThemePreset,
    builtInCustomThemeDefinitions,
    defaultPromptPreset,
    defaultGenericPromptPreset,
    migrateBuiltInInjectionDefaults,
    legacyInjectionTemplate,
    defaultInjectionTemplate,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    migratePromptPresetTimelines,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    migrateStagePromptTimeSpan,
    migrateEpicPromptTimeSpan,
    defaultGenericStoryGenerationPrompt,
    defaultGenericStageGenerationPrompt,
    defaultGenericEpicGenerationPrompt,
    createSharedVectorConfig,
    createSharedInlineGenerationConfig,
    areaPresetScopes,
    tableSchemaScopes,
    createTableProfile: (...args) => tableStateService.createTableProfile(...args),
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
});
const { ensureGlobalSettings } = globalSettingsService;

const presetRegistry = createPresetRegistry({
    ensureGlobalSettings,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    saveGlobalSettings,
    defaultPromptPreset,
    defaultGenericPromptPreset,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    getHash,
    readActiveConfig,
    createSharedVectorConfig,
    createSharedInlineGenerationConfig,
    sharedConfigVersion,
    markActiveConfigApplied,
    shouldSyncActiveConfig,
    applyPromptPresetToState: (...args) => configurationController.applyPromptPresetToState(...args),
    saveState,
});
const {
    applyGlobalActiveConfigToState,
    getActiveGlobalConfig,
    getAreaPresets,
    getInlinePromptPresets,
    getPromptPresets,
    getSelectedAreaPresetId,
    getSelectedInlinePromptPresetId,
    getSelectedPromptPresetId,
    getSelectedTablePromptPresetId,
    getTablePromptPresets,
    isBuiltInPresetId,
    makeAreaPresetId,
    makeInlinePromptPreset,
    makePresetId,
    makeTablePromptPreset,
    setActiveGlobalConfig,
    setSelectedAreaPresetId,
    setSelectedInlinePromptPresetId,
    setSelectedPromptPresetId,
    setSelectedTablePromptPresetId,
    syncGlobalActiveConfigToState,
} = presetRegistry;

const chatStateService = createChatStateService({
    defaultState,
    chatMetadata: chat_metadata,
    storageKey: STORAGE_KEY,
    extensionSettings: extension_settings,
    getContext,
    getFallbackChat: () => chat,
    applyGlobalActiveConfigToState,
    fillMissingDefaults,
    migrateBuiltInInjectionDefaults,
    legacyInjectionTemplate,
    defaultInjectionTemplate,
    migrateGenerationPrompts,
    defaultStoryGenerationPrompt,
    defaultGenericStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultGenericStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultGenericEpicGenerationPrompt,
    migrateBuiltInStructuredPrompt,
    migrateStagePromptTimeSpan,
    migrateEpicPromptTimeSpan,
    normalizeArrayFields,
    getSummaryLevel,
    blockTypes,
    sortSummariesBySource,
    normalizeInjectionMemoryBody,
    renderInjectionContent: (...args) => renderInjectionContent(...args),
    saveState,
    getFiniteMessageIds,
    ensureObjectField,
    normalizeWorkflowState,
    defaultAutomation,
    defaultGenerationTargets,
    migrateTurnSummaryPrompt,
    defaultTurnSummaryPrompt,
    tableSchemaScopes,
    ensureGlobalSettings,
    ensureTableProfileForScope: (...args) => tableStateService.ensureTableProfileForScope(...args),
    mergeScopedTableSchemasIntoState: (...args) => tableStateService.mergeScopedTableSchemasIntoState(...args),
    migrateInlineSummaryPrompt,
    defaultInlineSummaryPrompt,
    defaultVectorMemory,
    migrateVectorQueryRewritePrompt,
    unique,
    getActiveCoveredStageHashes,
    getInjectionMemoryParts: (...args) => getInjectionMemoryParts(...args),
});
const { ensureState, maxStoredScanPreviewItems, sanitizeCurrentChatState } = chatStateService;

const contentBlockService = createContentBlockService({
    documentRef: document,
    getState: ensureState,
    parseList,
    stripConfiguredTags,
    extractConfiguredTagBlocks,
    matchesAnyKeyword,
    blockTypes,
    workflowModes,
    stageSourceModes,
    getBlockSortKey,
});
const {
    classifyBlock,
    extractConfiguredSegments,
    getBlockPlainText,
    getBlocksByType,
    getBlockTitle,
    getMessageVariantKey,
    getSegmentSourceKind,
    mergeBlocks,
    shouldPersistScannedBlock,
    stripHtml,
    toPlainPreview,
} = contentBlockService;

const scanController = createScanController({
    getState: ensureState,
    getContext,
    getFallbackChat: () => chat,
    extractConfiguredSegments,
    getSegmentSourceKind,
    getMessageVariantKey,
    getHash,
    classifyBlock,
    getBlockTitle,
    shouldPersistScannedBlock,
    toPlainPreview,
    mergeBlocks,
    unique,
    maxStoredScanPreviewItems,
    saveState,
    syncInjection: (...args) => syncInjection(...args),
    renderWorkbenchScope,
    workbenchRenderScopes,
});
const { scanBakemonoBlocks } = scanController;

const summaryPreviewRenderer = createSummaryPreviewRenderer({
    documentRef: document,
    getState: ensureState,
    blockTypes,
    defaultPreviewLayouts,
    getMultiSummaryLabel,
    getBlockTitle,
    getBlockPlainText,
    stripHtml,
    findSavedSummaryByHash: (...args) => findSavedSummaryByHash(...args),
});
const {
    createBakemonoNotebook,
    getPreviewSummaryText,
    parsePreviewMeta,
} = summaryPreviewRenderer;

const summaryMemoryModel = createSummaryMemoryModel({
    blockTypes,
    memoryStrategies,
    memoryRecordStatuses,
    dedupeByHash,
    getSummarySortKey,
    getSummaryLevel,
    getFiniteMessageIds,
    unique,
    getBlockTitle,
    formatSourceRange,
    getBlockSortKey,
    getKindLabel,
    getDefaultDraftTitle: (...args) => summaryDraftService.getDefaultDraftTitle(...args),
    getSourceStart,
});
const {
    buildMemoryRecords,
    getActiveCoveredStageHashes,
    getActiveEpicMemoryBlocks,
    getCoveredStageHashesFromEpic,
    getEpicMemoryBlocks,
    getStageMemoryBlocks,
    summaryToBlock,
} = summaryMemoryModel;
const summarySelectors = createSummarySelectors({
    getState: ensureState,
    getBlocksByType,
    blockTypes,
    stageSourceModes,
    workflowModes,
    defaultAutomation,
    dedupeByHash,
    summaryToBlock,
    getSortedTargetBlocks,
});
const {
    getAutoStageTargets,
    getStageSourceMode,
    getStoryBlocks,
    getStoryMaterialBlocks,
    getUnsummarizedMultiSummaryBlocks,
    getUnsummarizedStageBlocks,
    getUnsummarizedStoryBlocks,
    isBackfillSummary,
    isRawSourceBlock,
} = summarySelectors;
const summaryGenerationController = createSummaryGenerationController({
    getIsBusy: () => isBusy,
    scanBlocks: options => scanBakemonoBlocks(options),
    getState: ensureState,
    getUnsummarizedStoryBlocks,
    getAutoStageTargets,
    getUnsummarizedStageBlocks,
    getUnsummarizedMultiSummaryBlocks,
    getStoryMaterialBlocks,
    readGenerationTargetSettings: (...args) => summaryTargetController.readGenerationTargetSettings(...args),
    promptGenerationTargetSelection: (...args) => summaryTargetController.promptGenerationTargetSelection(...args),
    selectGenerationTargets,
    partitionGenerationTargets,
    confirmGenerationTargets: (...args) => summaryTargetController.confirmGenerationTargets(...args),
    getTargetSelectionLabel: (...args) => summaryTargetController.getTargetSelectionLabel(...args),
    getStageSourceMode,
    renderGenerationPrompt,
    defaultStoryGenerationPrompt,
    getSourceMessageIdsFromBlocks,
    enqueueSummaryTask: (...args) => summaryTaskQueue.enqueueSummaryTask(...args),
    processTaskQueue: (...args) => summaryTaskQueue.processTaskQueue(...args),
    blockTypes,
    defaultGenerationTargets,
    getSourceStart,
    getSourceEnd,
    formatSourceRange,
    getNextMultiSummaryLevel,
    getMultiSummaryLabel,
    unique,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    confirm: message => window.confirm(message),
});
const {
    buildEpicSystemPrompt,
    buildStageSystemPrompt,
    buildStoryUserPrompt,
    generateEpicBatchTasks,
    generateEpicDraft,
    generateStageBatchTasks,
    generateStageDraft,
} = summaryGenerationController;
const summaryBackfillController = createSummaryBackfillController({
    query: $,
    getIsBusy: () => isBusy,
    getState: ensureState,
    getContext,
    getFallbackChat: () => chat,
    parseList,
    stripConfiguredTags,
    extractConfiguredTagBlocks,
    stripPostProcessNoise,
    unique,
    getHash,
    getMessageVariantKey,
    getFiniteMessageIds,
    formatSourceRange,
    getSourceStart,
    getSourceEnd,
    blockTypes,
    defaultAutomation,
    defaultMissingSummaryPrompt,
    buildStoryUserPrompt,
    buildStageSystemPrompt,
    buildTurnReferenceSystemPrompt: (...args) => turnProcessingController.buildTurnReferenceSystemPrompt(...args),
    createDraft: (...args) => summaryDraftService.createDraft(...args),
    enqueueSummaryTask: (...args) => summaryTaskQueue.enqueueSummaryTask(...args),
    parseMessageRangeInput: (...args) => archiveController.parseMessageRangeInput(...args),
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    confirm: message => window.confirm(message),
});
const {
    createMissingSummaryDraftFromBatchItem,
    generateBackfillQueue,
    generateBatchSummaryQueue,
    generateMissingSummaryQueue,
    messageHasConfiguredSummary,
} = summaryBackfillController;
const workbenchNavigation = createWorkbenchNavigation({
    getPanelTitle: tabName => getWorkbenchPanelTitle(tabName),
    renderHeaderContext: tabName => renderWorkbenchHeaderContext(tabName),
    renderAll: (...args) => renderAll(...args),
    scanBlocks: options => scanBakemonoBlocks(options),
    closeHelp: () => helpPopover.close(),
    clearFeedback: () => operationFeedback.clear(),
});
const {
    close: closeWorkbench,
    getActiveTab: getActiveWorkbenchTab,
    isOpen: isWorkbenchOpen,
    open: openWorkbench,
    setMenuOpen: setWorkbenchMenuOpen,
    stabilizeMobilePreviewScroll,
    stabilizeMobileScroll: stabilizeMobileWorkbenchScroll,
    switchTab: switchWorkbenchTab,
    syncMobileCollapsibles,
} = workbenchNavigation;

const themeController = createThemeController({
    query: $,
    documentRef: document,
    BlobCtor: Blob,
    urlApi: URL,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    ensureGlobalSettings,
    saveGlobalSettings,
    sanitizeCustomTheme,
    defaultCustomTheme,
    builtInCustomThemePresetIds,
    normalizeCustomThemePreset,
    makeCustomThemePresetId,
    customThemeSchema: CUSTOM_THEME_SCHEMA,
    customThemeLibrarySchema: CUSTOM_THEME_LIBRARY_SCHEMA,
    confirmDanger,
    toastr,
});
const {
    applyAppearanceTheme,
    deleteSelectedCustomThemePreset,
    downloadCustomThemeJson,
    downloadCustomThemeLibraryJson,
    getAppearanceSettings,
    getSelectedCustomThemePreset,
    importCustomThemeJson,
    parseCustomThemeJson,
    previewCustomThemeFromUi,
    readCustomThemeFromUi,
    renderAppearanceSettings,
    saveCustomTheme,
    saveCustomThemePreset,
    selectCustomThemePreset,
    setCustomThemeJson,
} = themeController;

const tableStateService = createTableStateService({
    tableSchemaScopes,
    getContext,
    ensureGlobalSettings,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    getChatState: () => chat_metadata[STORAGE_KEY],
    getHash,
    normalizeTableSchemas,
    getState: ensureState,
    saveGlobalSettings,
    findMatchingTable,
    mergeTableSchemaWithRows,
    updateInjectionFromSummaries,
    saveState,
    getFiniteMessageIds,
    toastr,
    confirmDanger,
    renderWorkbenchScope,
    workbenchRenderScopes,
    buildTableRollbackPlan,
    scheduleRenderAll,
    baseStoryLedgerPreset,
    createBaseStoryLedgerTables,
});
const {
    collectMessageIdsFromEventArgs,
    createBaseStoryLedgerProfile,
    createTableProfile,
    createTableProfileForCurrentScope,
    deleteActiveTableProfile,
    ensureChatTableProfiles,
    ensureTableProfileForScope,
    getActiveTableProfile,
    getActiveTableProfileKey,
    getAppliedTableHistoriesForMessage,
    getCurrentCharacterSchemaKey,
    getCurrentCharacterSchemaLabel,
    getScopedTableSchemas,
    getTableProfileLibrary,
    getTableProfileScopeLabel,
    getTableProfilesForScope,
    getTableSchemaLibrary,
    getTableSchemaScopeLabel,
    hasAppliedTableEditForMessage,
    loadActiveTableProfileRows,
    mergeScopedTableSchemasIntoState,
    persistCurrentTableDatabase,
    pushTableUndoSnapshot,
    redoLastTableOperation,
    rollbackLatestTableOperationForChangedMessages,
    rollbackLatestTableOperationForDeletedMessages,
    rollbackTableOperationsForMessages,
    saveCurrentTableProfileRows,
    saveScopedTableSchemas,
    setTableSchemaScope,
    switchTableProfile,
    syncCurrentTableSchemas,
    undoLastTableOperation,
} = tableStateService;

const tableMemoryModel = createTableMemoryModel({
    getState: ensureState,
    formatBlocksForPrompt,
    formatSourceRange,
    getSourceMessageIdsFromBlocks,
    defaultTableEditPrompt,
    getHash,
    parseTableEditOperations,
    getFiniteMessageIds,
    pushTableUndoSnapshot,
    normalizeTableText,
    saveCurrentTableProfileRows,
    updateInjectionFromSummaries,
});
const {
    applyTableOperations,
    buildTableEditPrompt,
    createTableEditDraft,
    formatSpecificTablesForPrompt,
    formatTableDataForPrompt,
    formatTableGuideForPrompt,
    getNextTableIndex,
    getReadonlyTables,
    getTableSchemasForPreset,
    getWritableTables,
    renderInjectedTablesSection,
} = tableMemoryModel;

const tableWorkflowController = createTableWorkflowController({
    getState: ensureState,
    findLatestAssistantTurn,
    toastr,
    buildLatestTurnBlocks,
    runGeneration,
    callGenerationModel,
    buildTableEditPrompt,
    buildTurnReferenceSystemPrompt,
    createTableEditDraft,
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    applyTableOperations,
    formatSourceRange,
    switchWorkbenchTab,
});
const { processLatestTableEdit } = tableWorkflowController;

const tableWorkbenchUi = createTableWorkbenchUi({
    query: $,
    document,
    requestFrame: callback => (
        typeof globalThis.requestAnimationFrame === 'function'
            ? globalThis.requestAnimationFrame(callback)
            : globalThis.setTimeout(callback, 16)
    ),
    getState: ensureState,
    getTableProfilesForScope,
    tableSchemaScopes,
    getActiveTableProfile,
    getTablePromptPresets,
    getSelectedTablePromptPresetId,
    escapeHtml,
    formatSourceRange,
    toastr,
    persistCurrentTableDatabase,
    renderWorkbenchScope,
    workbenchRenderScopes,
    normalizeImportedTablesFromJson,
    confirmDanger,
    syncCurrentTableSchemas,
    updateInjectionFromSummaries,
    parseList,
    getHash,
    getNextTableIndex,
});
const {
    createCustomTableFromUi,
    importTablesFromText,
    renderTableEditDrafts,
    renderTableList,
    renderTablePreviewMarkup,
    renderTableProfileControls,
    renderTablePromptPresetControls,
    saveEditedTableFromElement,
    uiState: tableUiState,
} = tableWorkbenchUi;

const vectorSettingsModel = createVectorSettingsModel({
    query: $,
    defaultVectorMemory,
    getState: ensureState,
    persistSharedConfigurationFromState: (...args) => configurationService.persistSharedConfigurationFromState(...args),
});
const {
    persistVectorMemoryFieldsFromUi,
    readVectorMemoryFieldsFromUi,
} = vectorSettingsModel;

const configurationService = createConfigurationService({
    query: $,
    getState: ensureState,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
    defaultAutomation,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    defaultInjectionTemplate,
    defaultGenerationTargets,
    defaultVectorMemory,
    defaultState,
    turnProcessingModes,
    tableSchemaScopes,
    extensionPromptRoles: extension_prompt_roles,
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    makePresetId,
    getStageSourceMode,
    setTableSchemaScope,
    readVectorMemoryFieldsFromUi,
    createSharedInlineGenerationConfig,
    createSharedVectorConfig,
    getTableSchemasForPreset,
    getActiveGlobalConfig,
    setActiveGlobalConfig,
    markActiveConfigApplied,
    saveState,
    ensureGlobalSettings,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    getContext,
    shouldBootstrapSharedConfig,
});
const {
    bootstrapSharedConfigurationFromCurrentChat,
    getConfigPayloadFromState,
    getCurrentPromptPresetPayload,
    normalizeImportedPreset,
    persistSharedConfigurationFromState,
    readAutomationFieldsFromUi,
    readConfigFieldsFromUi,
    readCustomApiFieldsFromUi,
    readInjectionFieldsFromUi,
    readPromptFieldsFromUi,
    readRuleFieldsFromUi,
    readTurnSummaryFieldsFromUi,
} = configurationService;

const configurationController = createConfigurationController({
    getState: ensureState,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
    defaultPromptPreset,
    defaultGenericPromptPreset,
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    defaultGenerationTargets,
    defaultInjectionTemplate,
    defaultAutomation,
    defaultState,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    turnProcessingModes,
    mergeSharedInlineGenerationConfig,
    mergeSharedVectorConfig,
    defaultVectorMemory,
    tableSchemaScopes,
    normalizeImportedTablesFromJson,
    setTableSchemaScope,
    syncInlineGenerationPrompts: (...args) => injectionService.syncInlineGenerationPrompts(...args),
    scheduleVectorAutoIndex: (...args) => vectorMemoryService.scheduleVectorAutoIndex(...args),
    scanBlocks: options => scanBakemonoBlocks(options),
    updateInjectionFromSummaries: (...args) => injectionService.updateInjectionFromSummaries(...args),
    syncInjection: (...args) => injectionService.syncInjection(...args),
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    getPromptPresets,
    getCurrentPromptPresetPayload,
    setSelectedPromptPresetId,
    saveGlobalSettings,
    setActiveGlobalConfig,
    markActiveConfigApplied,
    areaPresetScopes,
    makeAreaPresetId,
    readRuleFieldsFromUi,
    readAutomationFieldsFromUi,
    readCustomApiFieldsFromUi,
    readPromptFieldsFromUi,
    readTurnSummaryFieldsFromUi,
    readInjectionFieldsFromUi,
    readVectorMemoryFieldsFromUi,
    createSharedInlineGenerationConfig,
    createSharedVectorConfig,
    persistSharedConfigurationFromState,
    getAreaPresets,
    setSelectedAreaPresetId,
});
const {
    applyAreaPresetToState,
    applyPromptPresetToState,
    getAreaPresetPayload,
    renderAreaPresetChange,
    saveAreaPreset,
    saveCurrentConfigPreset,
    usePromptPresetAsGlobalDefault,
} = configurationController;

const memoryRecordsUi = createMemoryRecordsUi({
    query: $,
    documentRef: document,
    getState: ensureState,
    memoryRecordStatuses,
    blockTypes,
    normalizeSearchText,
    getKindLabel,
    pageSize: 18,
});
const {
    pageState: memoryRecordState,
    renderMemoryDatabaseSummary,
    renderMemoryRecordList,
} = memoryRecordsUi;

const vectorMemoryService = createVectorMemoryService({
    defaultVectorMemory,
    getState: ensureState,
    normalizeLineEndings,
    stripHtml,
    parseList,
    extractConfiguredTagBlocks,
    stripConfiguredTags,
    unique,
    getContext,
    getFallbackChat: () => chat,
    toPlainPreview,
    normalizeCustomApiBaseUrl,
    getCustomChatCompletionsUrl,
    extractChatCompletionText,
    rewriteWithTavern: generateRaw,
    parseVectorQueryRewritePayload,
    getClippedVectorText,
    computeHybridRerankScore,
    getMessageVariantKey,
    getHash,
    getActiveCoveredStageHashes,
    memoryStrategies,
    getActiveEpicMemoryBlocks,
    getFiniteMessageIds,
    getSourceStart,
    getSourceEnd,
    getBlockTitle,
    getKindLabel,
    getBlockPlainText,
    blockTypes,
    saveState,
    compactEmbedding,
    createLocalEmbedding,
    getCustomEmbeddingsUrl,
    readVectorMemoryFieldsFromUi,
    syncInjection,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    cosineSimilarity,
    countKeywordHits,
    selectHybridCandidates,
    fetchImpl: globalThis.fetch.bind(globalThis),
});
const {
    buildVectorMemoryIndex,
    getVectorQueryText,
    getVectorSourceSignature,
    markVectorIndexDirty,
    renderVectorMemorySection,
    retrieveVectorMemoryHits,
    scheduleVectorAutoIndex,
} = vectorMemoryService;

const vectorWorkbenchUi = createVectorWorkbenchUi({
    query: $,
    document,
    getState: ensureState,
    defaultVectorMemory,
    unique,
    getVectorQueryText,
    escapeHtml,
    formatSourceRange,
});
const {
    renderVectorHitList,
    renderVectorMemoryPanel,
    renderVectorModelOptions,
    renderVectorQueryModelOptions,
    renderVectorRecallDetails,
    renderVectorRecordList,
    renderVectorResultList,
} = vectorWorkbenchUi;

const vectorActionsController = createVectorActionsController({
    query: $,
    getState: ensureState,
    readVectorMemoryFieldsFromUi,
    persistSharedConfigurationFromState,
    normalizeCustomApiBaseUrl,
    getCustomModelsUrl,
    extractCustomModelIds,
    renderVectorModelOptions,
    renderVectorQueryModelOptions,
    toastr,
    getVectorSourceSignature,
    markVectorIndexDirty,
    retrieveVectorMemoryHits,
    syncInjection,
    renderWorkbenchScope,
    workbenchRenderScopes,
    saveState,
    confirmDanger,
    fetchImpl: globalThis.fetch.bind(globalThis),
});
const {
    applyVectorMemorySettings,
    clearVectorMemoryIndex,
    fetchVectorEmbeddingModels,
    fetchVectorQueryModels,
    testVectorMemoryRetrieval,
} = vectorActionsController;

const archiveController = createArchiveController({
    query: $,
    getChat: () => chat,
    getContext,
    scanBakemonoBlocks,
    ensureState,
    blockTypes,
    getFiniteMessageIds,
    unique,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    hideChatMessageRange,
    saveChatConditional,
    saveState,
    defaultState,
    memoryStrategies,
    confirm: message => window.confirm(message),
});
const {
    applyAutoHideRecentBalance,
    applyAutoHideRecentSettings,
    getActualHiddenMessageIds,
    getAutoHideRecentPlan,
    getAutoHideRecentPreviewText,
    getSummaryCoveredMessageIds,
    hideBeforeRecentMessages,
    hideCoveredMessages,
    parseMessageRangeInput,
    previewMessageRange,
    previewPreserveRecentMessages,
    readAutoHideRecentFieldsFromUi,
    renderAutoHideRecentPanel,
    restoreAutoHiddenMessages,
    restoreHiddenMessages,
    scheduleAutoHideRecent,
    setMessageRangeHidden,
} = archiveController;

const injectionService = createInjectionService({
    ensureState,
    getActiveEpicMemoryBlocks,
    getMultiSummaryLabel,
    getActiveCoveredStageHashes,
    getStageMemoryBlocks,
    memoryStrategies,
    renderInjectedTablesSection,
    renderVectorMemorySection,
    setExtensionPrompt,
    injectionKey: INJECTION_KEY,
    extensionPromptTypes: extension_prompt_types,
    extensionPromptRoles: extension_prompt_roles,
    defaultState,
    formatTableDataForPrompt,
    formatTableGuideForPrompt,
    formatSpecificTablesForPrompt,
    getReadonlyTables,
    getWritableTables,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    inlinePromptKeys,
    defaultInjectionTemplate,
    renderInjectionTemplate,
});
const {
    getInjectionMemoryParts,
    renderInjectionContent,
    renderInlinePrompt,
    syncInjection,
    syncInlineGenerationPrompts,
    updateInjectionFromSummaries,
} = injectionService;

const promptInspector = createPromptInspector({
    getChat: () => chat,
    getItemizedPrompts: () => itemizedPrompts,
    getItemizedParams: (...args) => itemizedParams(...args),
    countTokens: value => overviewTokenManifest.getOverviewTokenCount(value),
    getActiveTab: () => getActiveWorkbenchTab(),
    notifySuccess: message => toastr.success(message),
    notifyError: message => toastr.error(message),
    logWarning: (...args) => console.warn(...args),
});

const overviewTokenManifest = createOverviewTokenManifest({
    query: $,
    getState: ensureState,
    getHash,
    countTokens: value => getTokenCountAsync(value, 0),
    getInjectionMemoryParts,
    renderInjectionContent,
    renderInlinePrompt,
    defaultInjectionTemplate,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    getLastPromptUsage: () => promptInspector.getLastCompletePromptUsage(),
    getActiveTab: () => getActiveWorkbenchTab(),
    logWarning: (...args) => console.warn(...args),
});
const { renderOverviewTokenManifest } = overviewTokenManifest;

const workflowOverviewModel = createWorkflowOverviewModel({
    getState: ensureState,
    getChat: () => chat,
    getContext,
    buildFloorMemoryIndex,
    createMemoryOrchestrationPlan,
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    getStageSourceMode,
    getIsBusy: () => isBusy,
    isTaskQueueRunning: () => summaryTaskQueue.isRunning(),
    scanBlocks: options => scanBakemonoBlocks(options),
    updateInjection: () => updateInjectionFromSummaries(),
    saveState,
    renderSettings: status => renderWorkbenchScope(workbenchRenderScopes.SETTINGS, status),
    logWarning: (...args) => console.warn(...args),
});
const {
    applyWorkflowPreset,
    getCurrentFloorMemoryIndex,
    getMemoryOrchestrationPlan,
    getMemoryStrategyLabel,
    getOverviewHealth,
    getOverviewRecommendation,
    getStageSourceModeLabel,
    getWorkflowModeLabel,
    getWorkflowStatusText,
} = workflowOverviewModel;

const overviewWorkbenchUi = createOverviewWorkbenchUi({
    query: $,
    getState: ensureState,
    getActiveGlobalConfig,
    defaultAutomation,
    defaultScanRules,
    defaultState,
    getWorkflowModeLabel,
    getCurrentFloorMemoryIndex,
    getOverviewHealth,
    getActiveTab: () => getActiveWorkbenchTab(),
    renderTokenManifest: state => renderOverviewTokenManifest(state),
});
const { renderOverviewConfigManifest, renderWorkflowGuide } = overviewWorkbenchUi;

const summaryGenerationUi = createSummaryGenerationUi({
    documentRef: document,
    query: $,
    getState: ensureState,
});
const {
    getMode: getSummaryGenerationMode,
    render: renderSummaryGenerationPanel,
    setMode: setSummaryGenerationMode,
} = summaryGenerationUi;

const turnSummaryUi = createTurnSummaryUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    defaultState,
    turnProcessingModes,
    tableSchemaScopes,
    getTableSchemaScopeLabel,
    getCurrentCharacterSchemaLabel,
    renderTableProfileControls,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    renderInlinePromptPresetControls,
    renderTableList,
    renderTableEditDrafts,
});
const { render: renderTurnSummaryPanel } = turnSummaryUi;

const hubAutomationUi = createHubAutomationUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    getCurrentFloorMemoryIndex,
    getInjectionHeaderStatus: state => getWorkbenchInjectionHeaderStatus(state),
    getAppearanceSettings,
    getActiveGlobalConfig,
    getPromptPresets,
    getSelectedPromptPresetId,
    getWorkflowModeLabel,
    getUnsummarizedStoryBlocks,
    defaultAutomation,
    defaultScanRules,
});
const {
    renderAutomationOverview,
    renderHubPanels: renderWorkbenchHubPanels,
} = hubAutomationUi;

const generationClient = createGenerationClient({
    query: $,
    ensureState,
    generateRaw,
    normalizeCustomApiBaseUrl,
    getCustomChatCompletionsUrl,
    defaultAutomation,
    fetchImpl: (...args) => fetch(...args),
    readCustomApiFieldsFromUi,
    persistSharedConfigurationFromState,
    toastr,
    getCustomModelsUrl,
    extractCustomModelIds,
    renderCustomModelOptions,
});
const { callGenerationModel, fetchCustomApiModels, readOpenAIStream } = generationClient;

const summaryDraftService = createSummaryDraftService({
    getChat: () => chat,
    ensureState,
    getHash,
    getBlockTitle,
    blockTypes,
    messageHasConfiguredSummary,
    toastr,
    saveChatConditional,
    scanBakemonoBlocks,
    updateInjectionFromSummaries,
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    confirmDanger,
    getSummaryTaskQueue: () => summaryTaskQueue,
    setBusy,
    processTaskQueue: (...args) => summaryTaskQueue.processTaskQueue(...args),
    getSourceStart,
    getSourceEnd,
    getSummaryLevel,
    sortSummariesBySource,
    unique,
    mergeBlocks,
    getKindLabel,
    runGeneration: (...args) => operationFeedback.runGeneration(...args),
    callGenerationModel,
    buildEpicSystemPrompt: (...args) => buildEpicSystemPrompt(...args),
    buildStageSystemPrompt: (...args) => buildStageSystemPrompt(...args),
    persistSharedConfigurationFromState,
    getFiniteMessageIds,
    formatSourceRange,
    hideChatMessageRange,
    markVectorIndexDirty,
    parseList,
    extractConfiguredSegments,
    confirm: message => window.confirm(message),
});
const {
    clearStuckMissingSummaryTasks,
    clearStuckQueueTasks,
    commitAllMissingSummaryDrafts,
    commitDraft,
    commitMissingSummaryDraft,
    createDraft,
    deleteSavedSummary,
    discardDraft,
    findSavedSummaryByHash,
    getDefaultDraftTitle,
    getMissingSummaryDraftConflict,
    getSummaryDependents,
    getSummaryIndexForKind,
    isMissingSummaryTask,
    markAffectedAutoSummaryTransactions,
    normalizeGeneratedBakemono,
    recomputeCoveredHashes,
    recordAutoSummaryTransaction,
    regenerateDraft,
    removeMissingSummaryDraftsAndTasks,
    removeSummaryByHash,
    rollbackAutoSummaryTransaction,
    saveEditedSummary,
    transactionTouchesMessage,
    undoLastCommit,
    updateChatMessageText,
} = summaryDraftService;

const turnProcessingController = createTurnProcessingController({
    getContext,
    getChat: () => chat,
    chatMetadata: chat_metadata,
    ensureState,
    getHash,
    blockTypes,
    stripPostProcessNoise,
    extractAllTaggedBlocks,
    normalizeGeneratedBakemono,
    createDraft,
    defaultInlineSummaryPrompt,
    commitDraft,
    getAppliedTableHistoriesForMessage,
    saveState,
    rollbackLatestTableOperationForChangedMessages,
    createTableEditDraft,
    applyTableOperations,
    formatSourceRange,
    toastr,
    stripTableEditTags,
    updateInjectionFromSummaries,
    saveChatConditional,
    scheduleRenderAll,
    syncInjection,
    renderWorkbenchScope,
    workbenchRenderScopes,
    getSourceMessageIdsFromBlocks,
    renderGenerationPrompt,
    defaultTurnSummaryPrompt,
    getSourceStart,
    stripHtml,
    turnProcessingModes,
    processLatestTableEdit,
    hasAppliedTableEditForMessage,
    runGeneration: (...args) => operationFeedback.runGeneration(...args),
    callGenerationModel,
    extractTaggedContent,
    buildTableEditPrompt,
});
const {
    buildLatestTurnBlocks,
    buildTurnReferenceSystemPrompt,
    buildTurnSummaryPrompt,
    buildWorldInfoScanMessages,
    captureInlineGenerationFromLatestMessage,
    findLatestAssistantTurn,
    getCharacterReferenceContext,
    getCurrentCharacterForReference,
    getWorldInfoGlobalScanData,
    getWorldInfoReferenceContext,
    processLatestTurnSummary,
    scheduleInlineGenerationCapture,
} = turnProcessingController;

const memoryOrchestrator = createMemoryOrchestrator({
    ensureState,
    isBusy: () => isBusy,
    scanBakemonoBlocks,
    getUnsummarizedStoryBlocks,
    getHash,
    saveState,
    defaultAutomation,
    toastr,
    renderWorkbenchScope,
    workbenchRenderScopes,
    generateStageDraft,
    turnProcessingModes,
    processLatestTableEdit,
    processLatestTurnSummary,
    getCurrentFloorMemoryIndex,
    getMemoryOrchestrationPlan,
    captureInlineGenerationFromLatestMessage,
    scheduleInlineGenerationCapture,
    scheduleAutoHideRecent,
    markVectorIndexDirty,
    scheduleVectorAutoIndex,
    syncInjection,
    scheduleRenderAll,
});
const {
    isAutoThresholdReached,
    maybeRunAutoSummary,
    maybeRunTurnSummary,
    runMemoryOrchestrator,
} = memoryOrchestrator;

const summaryTargetController = createSummaryTargetController({
    query: $,
    getState: ensureState,
    defaultGenerationTargets,
    targetSelectionModes,
    persistSharedConfigurationFromState,
    parseLooseNumberRange,
    toastr,
    saveState,
    getIsBusy: () => isBusy,
    generateStageDraft,
    generateStageBatchTasks,
    generateEpicDraft,
    generateEpicBatchTasks,
    confirmDanger,
    getSourceMessageIdsFromBlocks,
    formatSourceRange,
    renderWorkbenchScope,
    workbenchRenderScopes,
});
const {
    chooseEpicGenerationMode,
    chooseStageGenerationMode,
    confirmGenerationTargets,
    getTargetSelectionLabel,
    parseGenerationTargetInput,
    promptGenerationModeSelection,
    promptGenerationTargetSelection,
    readGenerationTargetSettings,
} = summaryTargetController;

const summaryTaskQueue = createSummaryTaskQueue({
    getState: ensureState,
    getHash,
    getKindLabel,
    saveState,
    renderWorkbenchScope,
    renderTaskQueueProgress,
    workbenchRenderScopes,
    getIsBusy: () => isBusy,
    setBusy,
    toastr,
    callGenerationModel,
    parseMissingSummaryBatchResult,
    normalizeGeneratedBakemono,
    createMissingSummaryDraftFromBatchItem,
    createDraft,
    commitDraft,
    blockTypes,
    defaultAutomation,
    hideCoveredMessages,
    recordAutoSummaryTransaction,
    switchWorkbenchTab,
    confirmDanger,
    historyState,
});
const {
    clearFinishedQueueTasks,
    clearHistoryRecords,
    enqueueSummaryTask,
    processTaskQueue,
    removeQueueTask,
    retryQueueTask,
} = summaryTaskQueue;

function renderWorkbenchSharedChrome(activeTab, state, statusText = '', options = {}) {
    $('#bakemono-memory-count-drafts').text(state.drafts.length);
    $('#bakemono-memory-menu-draft-count').text(state.drafts.length.toLocaleString());
    if (statusText) {
        $('#bakemono-memory-status-line').text(statusText);
    }
    renderWorkbenchHeaderContext(activeTab, state);
    if (statusText && options.feedback !== false) {
        operationFeedback.captureFromStatus(statusText);
    }
}

function renderWorkbenchDataHubMemory(state) {
    const blocks = buildWorkbenchBlockBundle(state);
    state.memoryRecords = buildMemoryRecords(state);
    $('#bakemono-memory-count-story').text(blocks.story.length);
    $('#bakemono-memory-count-stage').text(blocks.stage.length);
    $('#bakemono-memory-count-epic').text(blocks.epic.length);
    renderWorkbenchHubPanels(state);
    renderMemoryDatabaseSummary(state);
}

function renderWorkbenchOverviewMemory(state) {
    state.memoryRecords = buildMemoryRecords(state);
    renderWorkflowGuide(state);
    renderMemoryDatabaseSummary(state);
}

function renderWorkbenchSummarySurface(activeTab, state) {
    if (activeTab === 'preview') {
        const blocks = buildWorkbenchBlockBundle(state);
        $('#bakemono-memory-tab-count-story').text(blocks.story.length);
        $('#bakemono-memory-tab-count-stage').text(blocks.stage.length);
        $('#bakemono-memory-tab-count-epic').text(blocks.epic.length);
        renderSummaryGenerationPanel(state, blocks);
        renderPreviewSections(blocks.story, blocks.stage, blocks.epic);
    } else if (activeTab === 'overview') {
        renderWorkbenchOverviewMemory(state);
    } else if (activeTab === 'data-hub') {
        renderWorkbenchDataHubMemory(state);
    } else if (activeTab === 'records') {
        state.memoryRecords = buildMemoryRecords(state);
        renderMemoryRecordList();
    } else if (activeTab === 'timeline') {
        renderTimeline();
    } else if (activeTab === 'drafts') {
        renderDrafts();
        renderHistory();
        renderTaskQueue();
    } else if (activeTab === 'maintenance') {
        renderMaintenanceOverview(state);
    } else if (activeTab === 'turn-summary' || activeTab === 'tables') {
        renderActivePresetControls(activeTab);
        renderTurnSummaryPanel(state);
    }
}

function renderWorkbenchScope(scope, statusText = '', options = {}) {
    if (!isWorkbenchOpen()) {
        return false;
    }
    const state = ensureState();
    const activeTab = getActiveWorkbenchTab();

    if (scope === workbenchRenderScopes.VECTOR) {
        if (activeTab === 'vector') {
            renderActivePresetControls(activeTab);
            renderVectorMemoryPanel(state);
        } else if (activeTab === 'data-hub') {
            renderWorkbenchHubPanels(state);
        }
    } else if (scope === workbenchRenderScopes.DRAFTS) {
        if (activeTab === 'drafts') {
            renderDrafts();
            renderHistory();
            renderTaskQueue();
        } else if (activeTab === 'maintenance') {
            renderMaintenanceOverview(state);
        } else if (activeTab === 'data-hub') {
            if (options.refreshDataHub !== false) {
                renderWorkbenchDataHubMemory(state);
            }
        }
    } else if (scope === workbenchRenderScopes.TABLES) {
        if (activeTab === 'turn-summary' || activeTab === 'tables') {
            renderActivePresetControls(activeTab);
            renderTurnSummaryPanel(state);
        } else if (activeTab === 'data-hub') {
            renderWorkbenchDataHubMemory(state);
        }
    } else if (scope === workbenchRenderScopes.SUMMARY) {
        renderWorkbenchSummarySurface(activeTab, state);
    } else if (scope === workbenchRenderScopes.SCAN) {
        if (activeTab === 'scan') {
            syncActiveWorkbenchFormFields(activeTab, state);
            renderActivePresetControls(activeTab);
            renderScanOverview(state);
            renderScanPreview();
        } else {
            renderWorkbenchSummarySurface(activeTab, state);
        }
    } else if (scope === workbenchRenderScopes.ARCHIVE) {
        if (activeTab === 'maintenance') {
            renderAutoHideRecentPanel(state);
            renderMaintenanceOverview(state);
        } else if (activeTab === 'overview') {
            renderWorkbenchOverviewMemory(state);
        } else if (activeTab === 'data-hub') {
            renderWorkbenchDataHubMemory(state);
        } else if (activeTab === 'records') {
            state.memoryRecords = buildMemoryRecords(state);
            renderMemoryRecordList();
        } else if (activeTab === 'vector') {
            renderVectorMemoryPanel(state);
        }
    } else if (scope === workbenchRenderScopes.INJECTION) {
        if (activeTab === 'injection') {
            syncActiveWorkbenchFormFields(activeTab, state);
            renderActivePresetControls(activeTab);
            renderInjectionOverview(state);
        } else if (activeTab === 'settings') {
            syncActiveWorkbenchFormFields(activeTab, state);
            renderWorkflowGuide(state);
        } else if (activeTab === 'settings-hub' || activeTab === 'data-hub') {
            renderWorkbenchHubPanels(state);
        }
    } else if (scope === workbenchRenderScopes.AUTOMATION) {
        if (activeTab === 'automation') {
            syncActiveWorkbenchFormFields(activeTab, state);
            renderActivePresetControls(activeTab);
            renderAutomationOverview(state);
        } else if (activeTab === 'data-hub' || activeTab === 'settings-hub') {
            renderWorkbenchHubPanels(state);
        } else if (activeTab === 'overview') {
            renderWorkflowGuide(state);
        } else if (activeTab === 'maintenance') {
            renderMaintenanceOverview(state);
        }
    } else if (scope === workbenchRenderScopes.PROMPTS) {
        if (activeTab === 'prompts') {
            syncActiveWorkbenchFormFields(activeTab, state);
            renderActivePresetControls(activeTab);
            renderPromptOverview(state);
            syncPromptHintButtons();
        }
    } else if (scope === workbenchRenderScopes.GENERATION) {
        if (activeTab === 'generation') {
            syncActiveWorkbenchFormFields(activeTab, state);
            renderActivePresetControls(activeTab);
            renderCustomModelOptions(state.automation.customApi?.models || []);
        } else if (activeTab === 'settings-hub') {
            renderWorkbenchHubPanels(state);
        }
    } else if (scope === workbenchRenderScopes.CONFIG) {
        if (activeTab === 'config') {
            renderActivePresetControls(activeTab);
        } else if (activeTab === 'settings-hub' || activeTab === 'data-hub') {
            renderWorkbenchHubPanels(state);
        }
    } else if (scope === workbenchRenderScopes.SETTINGS) {
        if (activeTab === 'settings') {
            syncActiveWorkbenchFormFields(activeTab, state);
            renderWorkflowGuide(state);
        } else if (activeTab === 'overview') {
            renderWorkflowGuide(state);
        } else if (activeTab === 'settings-hub' || activeTab === 'data-hub') {
            renderWorkbenchHubPanels(state);
        }
    } else {
        return false;
    }

    renderWorkbenchSharedChrome(activeTab, state, statusText, options);
    return true;
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
    if (activeTab === 'overview' || activeTab === 'records' || activeTab === 'data-hub') {
        state.memoryRecords = buildMemoryRecords(state);
    }
    const blocks = activeTab === 'preview' || activeTab === 'data-hub'
        ? buildWorkbenchBlockBundle(state)
        : null;
    $('#bakemono-memory-count-drafts').text(state.drafts.length);
    $('#bakemono-memory-menu-draft-count').text(state.drafts.length.toLocaleString());
    if (activeTab === 'data-hub' && blocks) {
        $('#bakemono-memory-count-story').text(blocks.story.length);
        $('#bakemono-memory-count-stage').text(blocks.stage.length);
        $('#bakemono-memory-count-epic').text(blocks.epic.length);
    } else if (activeTab === 'preview' && blocks) {
        $('#bakemono-memory-tab-count-story').text(blocks.story.length);
        $('#bakemono-memory-tab-count-stage').text(blocks.stage.length);
        $('#bakemono-memory-tab-count-epic').text(blocks.epic.length);
    }
    syncActiveWorkbenchFormFields(activeTab, state);
    if (activeTab === 'automation') {
        renderAutomationOverview(state);
    }
    renderActiveWorkbenchPanel(activeTab, state, blocks);

    const injected = state.injection.enabled && renderInjectionContent(state) ? '注入开启' : '注入为空或关闭';
    $('#bakemono-memory-status-line').text(statusText || `${injected}。上次扫描：${state.lastScanAt ? new Date(state.lastScanAt).toLocaleString() : '尚未扫描'}。`);
    renderWorkbenchHeaderContext(activeTab, state);
    syncPromptHintButtons();
    operationFeedback.captureFromStatus(statusText);
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
        `当前共用设置：${active?.name || '未设置'}。所有角色卡在打开或切换时自动同步；剧情摘要、草稿、表格行和向量索引仍按聊天单独保存。`,
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
            ['会立即应用这个区域，并作为所有角色卡共用的设置。'],
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
            ['只覆盖当前区域的设置，并同步到所有角色卡；其他区域保持不变。'],
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
        renderAreaPresetChange(scope, '配置已删除。');
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
        overview: '剪辑台',
        'prompt-inspector': '提示词清单',
        'data-hub': '自动与数据',
        'settings-hub': '设置中心',
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
        generation: '默认生成模型',
        prompts: '生成提示词',
        archive: '楼层收纳',
        config: '整套配置',
        appearance: '自定义主题',
        maintenance: '撤回与事务',
        help: '使用说明',
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
        'prompt-inspector': '上一轮实测 · 提示词清单',
        'data-hub': '后台工作 · 4 个工具',
        'settings-hub': '偏好与规则 · 当前聊天',
        settings: `工作方式 · ${getMemoryStrategyLabel(state.memoryStrategy)}`,
        preview: `剧情回看 · ${(state.storySummaries?.length || 0).toLocaleString()} 条摘要`,
        records: `长期记忆 · ${recordCount.toLocaleString()} 条记录`,
        tables: `结构化记忆 · ${tableCount.toLocaleString()} 个表格`,
        'turn-summary': `正文后处理 · 第 ${currentFloor.toLocaleString()} 楼`,
        drafts: `人工确认 · ${(state.drafts?.length || 0).toLocaleString()} 个待办`,
        timeline: `章节结构 · ${(state.stageSummaries?.length || 0).toLocaleString()} 个阶段`,
        automation: `后台规则 · ${state.automation?.enabled ? '运行中' : '尚未开启'}`,
        scan: `扫描识别 · ${(state.scanPreview?.length || 0).toLocaleString()} 条结果`,
        vector: `混合召回 · ${vectorCount.toLocaleString()} 个片段`,
        injection: `上下文注入 · ${renderInjectionContent(state).length.toLocaleString()} 字符`,
        generation: `默认模型 · ${(state.automation?.apiProvider || defaultAutomation.apiProvider) === 'custom' ? '自定义接口' : '酒馆主模型'}`,
        prompts: '生成风格 · 四类提示词',
        archive: `聊天收纳 · ${(state.hiddenMessageIds?.length || 0).toLocaleString()} 层已隐藏`,
        config: '配置预设 · 跨聊天复用',
        appearance: `外观主题 · ${getAppearanceSettings().themeMode === 'custom' ? '自定义' : '跟随酒馆'}`,
        maintenance: `安全维护 · ${(state.autoSummaryTransactions?.length || 0).toLocaleString()} 条事务`,
        help: '帮助中心 · 随时可查',
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
        'prompt-inspector': '上一轮实测',
        'data-hub': '后台工作 · 4个工具',
        'settings-hub': '偏好与规则',
        settings: '工作方式',
        preview: `剧情回看 · ${(state.storySummaries?.length || 0).toLocaleString()}条`,
        records: `长期记忆 · ${recordCount.toLocaleString()}条`,
        tables: `表格 · ${tableCount.toLocaleString()}个`,
        'turn-summary': `正文处理 · ${currentFloor.toLocaleString()}楼`,
        drafts: `人工确认 · ${(state.drafts?.length || 0).toLocaleString()}个`,
        timeline: `章节结构 · ${(state.stageSummaries?.length || 0).toLocaleString()}个`,
        automation: state.automation?.enabled ? '自动总结 · 运行中' : '自动总结 · 未开启',
        scan: `扫描识别 · ${(state.scanPreview?.length || 0).toLocaleString()}条`,
        vector: `混合召回 · ${vectorCount.toLocaleString()}个`,
        injection: `上下文 · ${renderInjectionContent(state).length.toLocaleString()}字`,
        generation: (state.automation?.apiProvider || defaultAutomation.apiProvider) === 'custom' ? '默认模型 · 自定义' : '默认模型 · 酒馆',
        prompts: '生成风格',
        archive: `楼层收纳 · ${(state.hiddenMessageIds?.length || 0).toLocaleString()}层`,
        config: '整套配置',
        appearance: '外观主题',
        maintenance: `安全维护 · ${(state.autoSummaryTransactions?.length || 0).toLocaleString()}条`,
        help: '帮助中心',
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






function renderInlinePromptPresetChange(statusText) {
    renderWorkbenchScope(workbenchRenderScopes.TABLES, statusText);
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
        persistSharedConfigurationFromState(state);
        renderInlinePromptPresetChange(`已使用并同步到所有角色卡的${label}：${preset.name}`);
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
        persistSharedConfigurationFromState(state);
        renderInlinePromptPresetChange(`已载入并同步到所有角色卡的${label}：${preset.name}`);
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
        renderInlinePromptPresetChange(`已保存${label}：${preset.name}`);
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
        renderInlinePromptPresetChange(`已覆盖${label}：${preset.name}`);
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
        renderInlinePromptPresetChange(`${label}预设已删除。`);
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
        persistVectorMemoryFieldsFromUi();
        await runVisibleOperation('正在拉取嵌入向量模型...', () => fetchVectorEmbeddingModels(), '嵌入模型列表已更新');
    } else if (action === 'vector-fetch-query-models') {
        persistVectorMemoryFieldsFromUi();
        await runVisibleOperation('正在拉取查询改写模型...', () => fetchVectorQueryModels(), '查询模型列表已更新');
    } else if (action === 'vector-clear') {
        clearVectorMemoryIndex();
    }
}

function getWorkbenchActionRenderScope(action) {
    if (String(action || '').startsWith('vector-')) {
        return workbenchRenderScopes.VECTOR;
    }
    if (action === 'scan') {
        return workbenchRenderScopes.SCAN;
    }
    if ([
        'generate-stage',
        'generate-stage-batch',
        'generate-epic',
        'generate-epic-batch',
        'backfill',
        'batch-summary',
    ].includes(action)) {
        return workbenchRenderScopes.SUMMARY;
    }
    if ([
        'commit-missing-all',
        'remove-missing-all',
        'clear-stuck-tasks',
        'clear-stuck-missing',
        'undo',
        'clear-queue',
        'clear-history',
    ].includes(action)) {
        return workbenchRenderScopes.DRAFTS;
    }
    if (action === 'process-latest-turn' || action === 'process-latest-table') {
        return workbenchRenderScopes.TABLES;
    }
    if ([
        'hide',
        'restore',
        'preview-range',
        'hide-range',
        'restore-range',
        'preview-preserve-recent',
        'hide-before-recent',
        'apply-auto-hide-recent',
        'restore-auto-hidden',
    ].includes(action)) {
        return workbenchRenderScopes.ARCHIVE;
    }
    return workbenchRenderScopes.SETTINGS;
}

function bindSettingsEvents() {
    window.removeEventListener('resize', syncMobileCollapsibles);
    window.addEventListener('resize', syncMobileCollapsibles);
    const rootElement = document.getElementById('bakemono-workbench-root');
    operationFeedback.bindCapture(rootElement);
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
        themeController.setThemeMode(this.dataset.bakemonoThemeMode);
    });
    $('#bakemono-memory-theme-preset-select').off('change').on('change', function () {
        selectCustomThemePreset(String(this.value || ''));
    });
    $('#bakemono-workbench-root').off('click.bakemonoThemeSection').on('click.bakemonoThemeSection', '[data-bakemono-theme-section]', function () {
        themeController.setEditorSection(this.dataset.bakemonoThemeSection);
    });
    $('#bakemono-workbench-root').off('input.bakemonoThemePreview').on('input.bakemonoThemePreview', '[data-bakemono-theme-color], [data-bakemono-theme-effect], #bakemono-memory-theme-name, #bakemono-memory-theme-appearance', previewCustomThemeFromUi);
    $('#bakemono-memory-theme-apply-preset').off('click').on('click', () => saveCustomTheme(readCustomThemeFromUi(), '主题配置已应用。'));
    $('#bakemono-memory-theme-save').off('click').on('click', () => saveCustomThemePreset());
    $('#bakemono-memory-theme-save-as').off('click').on('click', () => saveCustomThemePreset({ saveAs: true }));
    $('#bakemono-memory-theme-delete').off('click').on('click', deleteSelectedCustomThemePreset);
    $('#bakemono-memory-theme-reset').off('click').on('click', themeController.resetDraft);
    $('#bakemono-memory-theme-copy-json').off('click').on('click', async () => {
        const theme = readCustomThemeFromUi();
        setCustomThemeJson(theme);
        await navigator.clipboard.writeText(JSON.stringify(theme, null, 2));
        toastr.success('主题 JSON 已复制。');
    });
    $('#bakemono-memory-theme-download-json').off('click').on('click', downloadCustomThemeJson);
    $('#bakemono-memory-theme-download-library').off('click').on('click', downloadCustomThemeLibraryJson);
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
    promptInspector.bindEvents(document.getElementById('bakemono-workbench-root'));
    helpGuide.bind(rootElement);
    helpPopover.bind(rootElement);
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
        helpPopover.close();
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
            operationFeedback.set('error', failure, 2600);
            renderWorkbenchScope(getWorkbenchActionRenderScope(this.dataset.bakemonoAction), failure);
        } finally {
            operationFeedback.resetCapture();
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
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '正在保存草稿...');
            await commitDraft(draftId, card.querySelector('.bakemono-memory-draft-editor')?.value || '');
        } else if (action === 'regenerate') {
            this.disabled = true;
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '正在重新总结草稿，请稍等...');
            await regenerateDraft(draftId);
        } else if (action === 'discard') {
            renderWorkbenchScope(workbenchRenderScopes.DRAFTS, '正在丢弃草稿...');
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
        setSummaryGenerationMode(nextMode);
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
            renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格草稿已丢弃。');
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
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已重新解析：${draft.operations.length} 项操作。`);
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
                renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格修改已应用。');
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
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已新增一行：${table.name}`);
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
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已新增字段：${table.name}`);
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
                renderWorkbenchScope(workbenchRenderScopes.TABLES);
                return;
            }
            pushTableUndoSnapshot(`删除字段：${table.name || table.tableIndex} / ${colName}`, state);
            table.columns.splice(colIndex, 1);
            table.columnPrompts = Array.isArray(table.columnPrompts) ? table.columnPrompts : [];
            table.columnPrompts.splice(colIndex, 1);
            table.rows = (table.rows || []).map(row => row.filter((_, index) => index !== colIndex));
            tableUiState.focusField = { tableIndex: String(table.tableIndex), colIndex: String(Math.max(0, colIndex - 1)) };
            persistCurrentTableDatabase(state);
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已删除字段：${colName}`);
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
                    renderWorkbenchScope(workbenchRenderScopes.TABLES);
                    return;
                }
                pushTableUndoSnapshot(`删除数据行：${table.name || table.tableIndex} #${rowIndex + 1}`, state);
                table.rows.splice(rowIndex, 1);
                tableUiState.openTableIndex = String(table.tableIndex);
                tableUiState.openSection = 'rows';
                persistCurrentTableDatabase(state);
                renderWorkbenchScope(workbenchRenderScopes.TABLES, `已删除数据行：${table.name || table.tableIndex}`);
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
            renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格已删除。');
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
    $('#bakemono-memory-create-base-ledger').off('click').on('click', () => {
        const profile = createBaseStoryLedgerProfile(ensureState());
        if (!profile) return;
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已创建并启用：${profile.name}`);
        toastr.success('基础表格已创建。');
    });
    $('#bakemono-memory-table-schema-scope').off('change').on('change', function () {
        const state = ensureState();
        const nextScope = String(this.value || tableSchemaScopes.CHAT);
        const confirmed = confirmDanger(
            `切换到${getTableProfileScopeLabel(nextScope)}表格作用域？`,
            ['当前表格行数据会先保存到原表格组，再载入目标作用域的当前表格组。'],
        );
        if (!confirmed) {
            renderWorkbenchScope(workbenchRenderScopes.TABLES);
            return;
        }
        setTableSchemaScope(nextScope, state);
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `表格框架已切换：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
        toastr.success(`已切换表格框架：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
    });
    $('#bakemono-memory-switch-table-profile').off('click').on('click', () => {
        const state = ensureState();
        const scope = state.tableDatabase.schemaScope || tableSchemaScopes.CHAT;
        const profileId = String($('#bakemono-memory-table-profile-select').val() || '');
        if (switchTableProfile(scope, profileId, state)) {
            renderWorkbenchScope(workbenchRenderScopes.TABLES, `已切换表格组：${getActiveTableProfile(state)?.name || ''}`);
        }
    });
    $('#bakemono-memory-new-table-profile').off('click').on('click', () => {
        const state = ensureState();
        const name = String($('#bakemono-memory-table-profile-name').val() || '').trim() || `表格组 ${new Date().toLocaleString()}`;
        const profile = createTableProfileForCurrentScope(name, state);
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已新建表格组：${profile.name}`);
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
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已保存表格组：${profile?.name || ''}`);
        toastr.success('表格组已保存。');
    });
    $('#bakemono-memory-delete-table-profile').off('click').on('click', () => {
        const state = ensureState();
        if (deleteActiveTableProfile(state)) {
            renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格组已删除。');
            toastr.success('表格组已删除。');
        }
    });
    $('#bakemono-memory-save-table-schema').off('click').on('click', () => {
        const state = ensureState();
        syncCurrentTableSchemas(state);
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `表格框架已保存：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
        toastr.success(`已保存表格框架：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
    });
    $('#bakemono-memory-load-table-schema').off('click').on('click', () => {
        const state = ensureState();
        saveCurrentTableProfileRows(state);
        loadActiveTableProfileRows(state);
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `表格框架已拉取：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
        toastr.success(`已拉取表格框架：${getTableSchemaScopeLabel(state.tableDatabase.schemaScope)}`);
    });
    $('#bakemono-memory-apply-injection').off('click').on('click', () => {
        const state = ensureState();
        state.injection.template = String($('#bakemono-memory-injection-template').val() || defaultInjectionTemplate);
        state.generatedMemory = normalizeInjectionMemoryBody($('#bakemono-memory-source-content').val() || '', state.injection.template, defaultInjectionTemplate);
        syncInjection();
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.INJECTION, '注入内容已应用，注入设置已同步到所有角色卡。');
        toastr.success('注入内容已应用，设置已全局保存。');
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.INJECTION, '注入模板已恢复默认。');
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
        renderWorkbenchScope(workbenchRenderScopes.INJECTION, '注入内容已清空。');
    });
    $('#bakemono-memory-apply-prompts').off('click').on('click', () => {
        const state = ensureState();
        readPromptFieldsFromUi(state);
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.PROMPTS, '生成提示词已应用，并同步到所有角色卡。');
        toastr.success('生成提示词已全局保存。');
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.PROMPTS, '阶段总结提示词已恢复默认。');
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.PROMPTS, '多次总结提示词已恢复默认。');
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.PROMPTS, '旧正文摘要提示词已恢复默认。');
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.PROMPTS, '补写缺失摘要提示词已恢复默认。');
    });
    $('#bakemono-memory-apply-turn-settings').off('click').on('click', () => {
        const state = ensureState();
        readTurnSummaryFieldsFromUi(state);
        syncInlineGenerationPrompts(state);
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.TABLES, '正文摘要设置已应用，并同步到所有角色卡。');
        toastr.success('正文摘要设置已全局保存。');
    });
    $('#bakemono-memory-table-inject-memory').off('change.bakemonoTableInjection').on('change.bakemonoTableInjection', function () {
        const state = ensureState();
        state.tableDatabase.injectMemory = !!this.checked;
        updateInjectionFromSummaries();
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.TABLES);
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.TABLES, '正文摘要提示词已恢复默认。');
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格修改提示词已恢复默认。');
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已使用并同步到所有角色卡的表格提示词：${preset.name}`);
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已载入并同步到所有角色卡的表格提示词：${preset.name}`);
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
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已保存表格提示词：${preset.name}`);
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
        renderWorkbenchScope(workbenchRenderScopes.TABLES, `已覆盖表格提示词：${preset.name}`);
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
        renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格提示词预设已删除。');
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
        renderWorkbenchScope(workbenchRenderScopes.TABLES, '表格数据库已清空。');
    });
    $('#bakemono-memory-apply-automation').off('click').on('click', () => {
        const state = ensureState();
        readAutomationFieldsFromUi(state);
        readGenerationTargetSettings();
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.AUTOMATION, '自动总结与生成 API 已同步到所有角色卡。');
        toastr.success('自动总结与生成 API 已全局保存。');
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
            ['会覆盖工作流、扫描、自动、提示词、注入和向量等设置，并同步到所有角色卡。', '摘要、草稿、表格行与向量索引不会跨聊天复制。'],
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
            ['会覆盖当前设置，并让所有角色卡在打开或切换时自动使用这套配置。'],
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
            ? saveCurrentConfigPreset(name, { skipRender: true })
            : saveCurrentConfigPreset(name, { replaceId: selectedId, skipRender: true });
        const config = setActiveGlobalConfig(preset);
        markActiveConfigApplied(ensureState(), config);
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.CONFIG, isBuiltInPresetId(selectedId) || !selected ? `已另存并设为全局默认：${preset.name}` : `已覆盖并设为全局默认：${preset.name}`);
    });
    $('#bakemono-memory-save-as-preset').off('click').on('click', () => {
        const name = String($('#bakemono-memory-preset-name').val() || '').trim();
        if (!name) {
            toastr.warning('请先填写预设名称。');
            return;
        }
        const preset = saveCurrentConfigPreset(name, { skipRender: true });
        const config = setActiveGlobalConfig(preset);
        markActiveConfigApplied(ensureState(), config);
        saveState();
        renderWorkbenchScope(workbenchRenderScopes.CONFIG, `已另存并设为全局默认：${preset.name}`);
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
            markActiveConfigApplied(ensureState(), config);
            saveState();
        }
        setSelectedPromptPresetId(defaultPromptPreset.id);
        saveGlobalSettings();
        renderWorkbenchScope(workbenchRenderScopes.CONFIG, '预设已删除。');
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
            renderWorkbenchScope(workbenchRenderScopes.CONFIG, `已导入预设：${preset.name}`);
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.SCAN, '扫描规则已应用、刷新预览并同步到所有角色卡。');
        toastr.success('扫描规则已全局保存。');
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.SCAN, '扫描规则已恢复默认。');
    });
    $('#bakemono-memory-injection-enabled').off('change').on('change', function () {
        const state = ensureState();
        state.injection.enabled = !!this.checked;
        syncInjection();
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.INJECTION);
    });
    $('#bakemono-memory-memory-strategy').off('change').on('change', function () {
        const state = ensureState();
        state.memoryStrategy = Object.values(memoryStrategies).includes(this.value) ? this.value : memoryStrategies.BAKEMONO;
        updateInjectionFromSummaries();
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.SETTINGS, '记忆策略已切换。');
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
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.SETTINGS, '工作流模式已切换，已有扫描和自动总结配置已保留。');
    });
    $('#bakemono-memory-stage-source-mode').off('change').on('change', function () {
        const state = ensureState();
        state.stageSourceMode = Object.values(stageSourceModes).includes(this.value) ? this.value : stageSourceModes.SUMMARIES;
        scanBakemonoBlocks({ persist: false });
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.SETTINGS, '阶段总结材料已切换。');
    });
    $('#bakemono-memory-output-mode').off('change').on('change', function () {
        const state = ensureState();
        state.outputMode = ['bakemono', 'plain', 'custom'].includes(this.value) ? this.value : 'bakemono';
        persistSharedConfigurationFromState(state);
        renderWorkbenchScope(workbenchRenderScopes.SETTINGS, '输出风格已切换。');
    });
    $('#bakemono-memory-depth').off('input').on('input', function () {
        const state = ensureState();
        state.injection.depth = Math.max(0, Number(this.value || defaultState.injection.depth));
        syncInjection();
        persistSharedConfigurationFromState(state);
    });
    $('#bakemono-memory-role').off('change').on('change', function () {
        const state = ensureState();
        state.injection.role = Number(this.value || extension_prompt_roles.SYSTEM);
        syncInjection();
        persistSharedConfigurationFromState(state);
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
    organizeWorkbenchOwnedSections(getSummaryGenerationMode());
    installWorkbenchParentNavigation();
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
    const initialState = ensureState();
    bootstrapSharedConfigurationFromCurrentChat(initialState);
    syncGlobalActiveConfigToState(initialState, { force: true });
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

    eventSource.on(event_types.CHAT_CHANGED, () => runChatSwitchFlow({
        getState: ensureState,
        syncConfig: state => {
            bootstrapSharedConfigurationFromCurrentChat(state);
            return syncGlobalActiveConfigToState(state, { force: true });
        },
        scheduleAutoHide: scheduleAutoHideRecent,
        markVectorDirty: markVectorIndexDirty,
        syncInjection,
        scheduleRender: scheduleRenderAll,
    }));
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        await runMemoryOrchestrator('收到新回复', {
            scheduleInlineCapture: true,
            vectorDirtyReason: '收到新消息',
            render: true,
        });
    });
    if (event_types.ITEMIZED_PROMPTS_LOADED) {
        eventSource.on(event_types.ITEMIZED_PROMPTS_LOADED, () => {
            if (!isWorkbenchOpen()) return;
            if (getActiveWorkbenchTab() === 'overview') {
                renderWorkflowGuide(ensureState());
            } else if (getActiveWorkbenchTab() === 'prompt-inspector') {
                void promptInspector.render();
            }
        });
    }
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
