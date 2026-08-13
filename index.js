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
import { createTableEditorEvents } from './src/features/table-editor-events.js';
import { createTableManagementEvents } from './src/features/table-management-events.js';
import { createContentConfigurationEvents } from './src/features/content-configuration-events.js';
import { createAutomationConfigurationEvents } from './src/features/automation-configuration-events.js';
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
import { createSummaryBrowserUi } from './src/features/summary-browser-ui.js';
import { createSummaryBrowserEvents } from './src/features/summary-browser-events.js';
import { createWorkbenchPageOverviews } from './src/features/workbench-page-overviews.js';
import { createReviewQueueUi } from './src/features/review-queue-ui.js';
import { createReviewQueueEvents } from './src/features/review-queue-events.js';
import { createMaintenanceUi } from './src/features/maintenance-ui.js';
import { createSummaryTimelineUi } from './src/features/summary-timeline-ui.js';
import { createPresetControlsUi } from './src/features/preset-controls-ui.js';
import { createWorkbenchHeaderUi } from './src/features/workbench-header-ui.js';
import { createWorkbenchRenderer, workbenchRenderScopes } from './src/features/workbench-renderer.js';
import { createWorkbenchActionController } from './src/features/workbench-action-controller.js';
import { createPresetEventsController } from './src/features/preset-events-controller.js';
import { createGlobalSettingsService } from './src/core/global-settings-service.js';
import { createChatStateService } from './src/core/chat-state-service.js';
import { createHelpPopover } from './src/ui/help-popover.js';
import { createOperationFeedback } from './src/ui/operation-feedback.js';
import { installWorkbenchParentNavigation, organizeWorkbenchOwnedSections } from './src/ui/workbench-layout.js';
import { createWorkbenchNavigation } from './src/ui/workbench-navigation.js';
import { createWorkbenchShellEvents } from './src/ui/workbench-shell-events.js';

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

let workbenchRenderer = null;
function renderAll(...args) {
    return workbenchRenderer?.renderAll(...args);
}
function scheduleRenderAll(...args) {
    return workbenchRenderer?.scheduleRenderAll(...args);
}
function renderWorkbenchScope(...args) {
    return workbenchRenderer?.renderScope(...args) ?? false;
}
function renderTaskQueueProgress(...args) {
    return workbenchRenderer?.renderTaskQueueProgress(...args);
}
function renderActivePresetControls(...args) {
    return workbenchRenderer?.renderActivePresetControls(...args);
}

let presetEventsController = null;
let tableManagementEvents = null;
let contentConfigurationEvents = null;
let automationConfigurationEvents = null;
function renderInlinePromptPresetControls(...args) {
    return presetEventsController?.renderInlinePromptPresetControls(...args);
}









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

const presetControlsUi = createPresetControlsUi({
    documentRef: document,
    query: $,
    areaPresetScopes,
    getSelectedPromptPresetId,
    getPromptPresets,
    getActiveGlobalConfig,
    getSelectedAreaPresetId,
    getAreaPresets,
    unique,
});
const {
    renderAll: renderPromptPresetControls,
    renderAreaPresetControl,
    renderCustomModelOptions,
    renderPresetControlPair,
} = presetControlsUi;

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
    navigatorRef: navigator,
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
    bindEvents: bindThemeEvents,
    getAppearanceSettings,
    getSelectedCustomThemePreset,
    parseCustomThemeJson,
    renderAppearanceSettings,
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

const tableEditorEvents = createTableEditorEvents({
    query: $,
    getState: ensureState,
    toastr,
    confirmDanger,
    parseTableEditOperations,
    saveState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    applyTableOperations,
    formatSourceRange,
    saveEditedTableFromElement,
    tableUiState,
    pushTableUndoSnapshot,
    persistCurrentTableDatabase,
    undoLastTableOperation,
    redoLastTableOperation,
    createCustomTableFromUi,
    createBaseStoryLedgerProfile,
});

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

presetEventsController = createPresetEventsController({
    query: $,
    documentRef: document,
    toastr,
    confirmDanger,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    getAreaPresets,
    getSelectedAreaPresetId,
    setSelectedAreaPresetId,
    renderPromptPresetControls,
    applyAreaPresetToState,
    saveAreaPreset,
    saveGlobalSettings,
    renderAreaPresetChange,
    getInlinePromptPresets,
    getSelectedInlinePromptPresetId,
    setSelectedInlinePromptPresetId,
    defaultInlineSummaryPrompt,
    defaultInlineTablePrompt,
    getState: ensureState,
    syncInlineGenerationPrompts,
    persistSharedConfigurationFromState,
    makeInlinePromptPreset,
    renderWorkbenchScope,
    workbenchRenderScopes,
    navigatorRef: navigator,
    defaultPromptPreset,
    getSelectedPromptPresetId,
    setSelectedPromptPresetId,
    getPromptPresets,
    usePromptPresetAsGlobalDefault,
    isBuiltInPresetId,
    saveCurrentConfigPreset,
    setActiveGlobalConfig,
    markActiveConfigApplied,
    saveState,
    getActiveGlobalConfig,
    applyGlobalActiveConfigToState,
    getCurrentPromptPresetPayload,
    normalizeImportedPreset,
    areaPresetScopes,
});
const {
    bind: bindPresetEvents,
} = presetEventsController;

tableManagementEvents = createTableManagementEvents({
    query: $,
    getState: ensureState,
    tableSchemaScopes,
    getTableProfileScopeLabel,
    confirmDanger,
    renderWorkbenchScope,
    workbenchRenderScopes,
    setTableSchemaScope,
    saveState,
    getTableSchemaScopeLabel,
    toastr,
    switchTableProfile,
    getActiveTableProfile,
    createTableProfileForCurrentScope,
    syncCurrentTableSchemas,
    saveGlobalSettings,
    deleteActiveTableProfile,
    saveCurrentTableProfileRows,
    loadActiveTableProfileRows,
    readTurnSummaryFieldsFromUi,
    syncInlineGenerationPrompts,
    persistSharedConfigurationFromState,
    updateInjectionFromSummaries,
    defaultTurnSummaryPrompt,
    defaultTableEditPrompt,
    getSelectedTablePromptPresetId,
    setSelectedTablePromptPresetId,
    getTablePromptPresets,
    renderPromptPresetControls,
    makeTablePromptPreset,
    importTablesFromText,
    getScopedTableSchemas,
});

contentConfigurationEvents = createContentConfigurationEvents({
    query: $,
    navigatorRef: navigator,
    getState: ensureState,
    defaultInjectionTemplate,
    normalizeInjectionMemoryBody,
    syncInjection,
    persistSharedConfigurationFromState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    confirmDanger,
    saveState,
    readPromptFieldsFromUi,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    memoryStrategies,
    updateInjectionFromSummaries,
    workflowModes,
    stageSourceModes,
    scanBlocks: options => scanBakemonoBlocks(options),
    defaultState,
    extensionPromptRoles: extension_prompt_roles,
    renderInjectionContent,
});

automationConfigurationEvents = createAutomationConfigurationEvents({
    query: $,
    documentRef: document,
    getState: ensureState,
    readAutomationFieldsFromUi,
    readGenerationTargetSettings: (...args) => summaryTargetController.readGenerationTargetSettings(...args),
    persistSharedConfigurationFromState,
    renderWorkbenchScope,
    workbenchRenderScopes,
    toastr,
    defaultAutomation,
    fetchCustomApiModels: (...args) => generationClient.fetchCustomApiModels(...args),
});

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

const workbenchHeaderUi = createWorkbenchHeaderUi({
    documentRef: document,
    getState: ensureState,
    getChat: () => chat,
    getMemoryStrategyLabel,
    renderInjectionContent,
    defaultAutomation,
    getAppearanceSettings,
});
const {
    getInjectionStatus: getWorkbenchInjectionHeaderStatus,
    getPanelKicker: getWorkbenchPanelKicker,
    getPanelShortKicker: getWorkbenchPanelShortKicker,
    getPanelTitle: getWorkbenchPanelTitle,
    render: renderWorkbenchHeaderContext,
} = workbenchHeaderUi;

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
    bindEvents: bindSummaryGenerationEvents,
    getMode: getSummaryGenerationMode,
    render: renderSummaryGenerationPanel,
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

const summaryBrowserUi = createSummaryBrowserUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    getStoryBlocks,
    getBlocksByType,
    blockTypes,
    dedupeByHash,
    summaryToBlock,
    normalizeSearchText,
    getPreviewSummaryText,
    parsePreviewMeta,
    stripHtml,
    getBlockSortKey,
    createNotebook: createBakemonoNotebook,
});
const {
    changePage: changeSummaryBrowserPage,
    getActiveType: getSummaryBrowserActiveType,
    renderSections: renderPreviewSections,
    resetPages: resetSummaryBrowserPages,
    setActiveType: setSummaryBrowserActiveType,
} = summaryBrowserUi;

const workbenchPageOverviews = createWorkbenchPageOverviews({
    documentRef: document,
    windowRef: window,
    navigatorRef: navigator,
    query: $,
    getState: ensureState,
    blockTypes,
    defaultScanRules,
    parseList,
    getPromptStructureExcerpt,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    getInjectionMemoryParts,
    renderInjectionContent,
    toastr,
});
const {
    bindPromptEvents,
    renderInjectionOverview,
    renderPromptOverview,
    renderScanOverview,
    renderScanPreview,
} = workbenchPageOverviews;

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

const reviewQueueUi = createReviewQueueUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    isMissingSummaryTask,
    getKindLabel,
    blockTypes,
});
const {
    changeHistoryPage,
    historyState,
    renderDrafts,
    renderHistory,
    renderTabs: renderReviewPanelTabs,
    renderTaskQueue,
    setActiveView: setReviewPanelView,
} = reviewQueueUi;

const maintenanceUi = createMaintenanceUi({
    documentRef: document,
    query: $,
    getState: ensureState,
    getActualHiddenMessageIds,
    getFiniteMessageIds,
    formatSourceRange,
    getKindLabel,
    unique,
    escapeHtml,
    BlobCtor: Blob,
    urlApi: URL,
    notifySuccess: message => toastr.success(message),
});
const {
    bindEvents: bindMaintenanceEvents,
    renderAutoSummaryTransactions,
    renderOverview: renderMaintenanceOverview,
} = maintenanceUi;

const summaryTimelineUi = createSummaryTimelineUi({
    documentRef: document,
    getState: ensureState,
    getStoryBlocks,
    getBlocksByType,
    blockTypes,
    dedupeByHash,
    summaryToBlock,
    unique,
    getMultiSummaryLabel,
    getKindLabel,
    getBlockTitle,
});
const {
    changePage: changeTimelinePage,
    render: renderTimeline,
} = summaryTimelineUi;

const summaryBrowserEvents = createSummaryBrowserEvents({
    query: $,
    getSummaryBrowserActiveType,
    setSummaryBrowserActiveType,
    changeSummaryBrowserPage,
    renderPreviewSections,
    resetSummaryBrowserPages,
    stabilizeMobilePreviewScroll,
    changeTimelinePage,
    renderTimeline,
    memoryRecordState,
    memoryRecordStatuses,
    renderMemoryRecordList,
    saveEditedSummary,
    deleteSavedSummary,
});

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

const reviewQueueEvents = createReviewQueueEvents({
    query: $,
    globalRef: globalThis,
    getIsBusy: () => isBusy,
    toastr,
    getState: ensureState,
    saveState,
    setReviewPanelView,
    renderReviewPanelTabs,
    stabilizeMobileWorkbenchScroll,
    renderWorkbenchScope,
    workbenchRenderScopes,
    commitDraft,
    regenerateDraft,
    discardDraft,
    retryQueueTask,
    removeQueueTask,
    rollbackAutoSummaryTransaction,
    changeHistoryPage,
    renderHistory,
});

workbenchRenderer = createWorkbenchRenderer({
    documentRef: document,
    globalRef: globalThis,
    query: $,
    getState: ensureState,
    isWorkbenchOpen,
    getActiveTab: getActiveWorkbenchTab,
    areaPresetScopes,
    renderPresetControlPair,
    renderAreaPresetControl,
    renderWorkflowGuide,
    renderMemoryDatabaseSummary,
    renderPromptInspector: () => promptInspector.render(),
    renderHubPanels: renderWorkbenchHubPanels,
    renderSummaryGenerationPanel,
    renderPreviewSections,
    renderMemoryRecordList,
    renderTimeline,
    renderDrafts,
    renderHistory,
    renderTaskQueue,
    renderTurnSummaryPanel,
    renderInjectionOverview,
    renderPromptOverview,
    renderAutomationOverview,
    renderVectorMemoryPanel,
    renderScanOverview,
    renderScanPreview,
    renderCustomModelOptions,
    renderAppearanceSettings,
    renderAutoHideRecentPanel,
    renderMaintenanceOverview,
    renderHelp: () => helpGuide.render(),
    getStoryBlocks,
    getBlocksByType,
    blockTypes,
    dedupeByHash,
    summaryToBlock,
    memoryStrategies,
    workflowModes,
    getStageSourceMode,
    getMemoryStrategyLabel,
    getWorkflowModeLabel,
    getStageSourceModeLabel,
    getInjectionMemoryParts,
    getWorkflowStatusText,
    defaultInjectionTemplate,
    renderInjectionContent,
    defaultStoryGenerationPrompt,
    defaultMissingSummaryPrompt,
    defaultStageGenerationPrompt,
    defaultEpicGenerationPrompt,
    defaultScanRules,
    defaultClassificationRules,
    defaultPreviewLayouts,
    defaultAutomation,
    defaultGenerationTargets,
    buildMemoryRecords,
    renderHeaderContext: renderWorkbenchHeaderContext,
    captureFeedback: status => operationFeedback.captureFromStatus(status),
});

const workbenchActionController = createWorkbenchActionController({
    workbenchRenderScopes,
    scanBakemonoBlocks,
    chooseStageGenerationMode,
    generateStageBatchTasks,
    chooseEpicGenerationMode,
    generateEpicBatchTasks,
    generateBackfillQueue,
    generateBatchSummaryQueue,
    commitAllMissingSummaryDrafts,
    removeMissingSummaryDraftsAndTasks,
    clearStuckQueueTasks,
    clearStuckMissingSummaryTasks,
    readTurnSummaryFieldsFromUi,
    processLatestTurnSummary,
    processLatestTableEdit,
    undoLastCommit,
    clearFinishedQueueTasks,
    clearHistoryRecords,
    hideCoveredMessages,
    restoreHiddenMessages,
    previewMessageRange,
    setMessageRangeHidden,
    previewPreserveRecentMessages,
    hideBeforeRecentMessages,
    applyAutoHideRecentSettings,
    restoreAutoHiddenMessages,
    applyVectorMemorySettings,
    buildVectorMemoryIndex,
    testVectorMemoryRetrieval,
    persistVectorMemoryFieldsFromUi,
    fetchVectorEmbeddingModels,
    fetchVectorQueryModels,
    clearVectorMemoryIndex,
    runVisibleOperation,
});
const { getRenderScope: getWorkbenchActionRenderScope, run: runWorkbenchAction } = workbenchActionController;

const workbenchShellEvents = createWorkbenchShellEvents({
    query: $,
    documentRef: document,
    windowRef: window,
    extensionSettings: extension_settings,
    storageKey: STORAGE_KEY,
    saveSettingsDebounced,
    renderExtensionEntrySettings,
    syncTopNavButton,
    syncMobileCollapsibles,
    openWorkbench,
    closeWorkbench,
    setWorkbenchMenuOpen,
    switchWorkbenchTab,
    stabilizeMobileWorkbenchScroll,
    operationFeedback,
    bindThemeEvents,
    promptInspector,
    helpGuide,
    helpPopover,
    runWorkbenchAction,
    getWorkbenchActionRenderScope,
    renderWorkbenchScope,
});

function getKindLabel(kind) {
    if (kind === blockTypes.STORY) {
        return '剧情摘要';
    }
    if (kind === blockTypes.EPIC) {
        return '多次总结';
    }
    return '阶段总结';
}

function dedupeByHash(blocks) {
    return [...new Map(blocks.map(block => [block.hash, block])).values()];
}

function bindSettingsEvents() {
    workbenchShellEvents.bind();
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
    reviewQueueEvents.bind();
    summaryBrowserEvents.bind();
    bindSummaryGenerationEvents();
    bindPromptEvents();
    bindMaintenanceEvents();
    tableEditorEvents.bind();
    tableManagementEvents.bind();
    contentConfigurationEvents.bind();
    automationConfigurationEvents.bind();
    bindPresetEvents();
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
