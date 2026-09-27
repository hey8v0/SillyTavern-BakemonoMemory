# 开发交接

给接手开发的人（或新的 AI 窗口）看。用户说明在 [README](../README.md)，版本变化在 [CHANGELOG](../CHANGELOG.md)，模块边界在 [ARCHITECTURE](ARCHITECTURE.md)，剧情状态实际提示词在 [RP_EVENTS_PROMPT](RP_EVENTS_PROMPT.md)。本文只写现状与约定，历史过程查 Git。

## 1. 接手约定

- 当前版本 **1.23.0**，分支 `main`，远端 `hey8v0/SillyTavern-BakemonoMemory`。先看 `git status` / `git log`，不要从旧对话推断现状。
- 源码就在本仓库。任务工作区、酒馆安装目录都不是源码；不要默认同步本机酒馆、调用模型。
- 不覆盖用户未提交的修改，不强推。提交与推送以当次授权为准。
- **用户的测试方式**：用户在手机上的酒馆里更新插件来实测，所以每完成一批改动，经用户同意后发布一个小版本并推送（见第 8 节）。一次一批，便于定位问题。
- 与用户沟通用中文；说明改了什么时写用户能看懂的话，技术细节放在提交信息和本文里。
- Node 24，无打包、无运行时依赖。离线 DOM 测试依赖 linkedom / css-tree，原生浏览器测试依赖 Playwright，均不装进仓库（见第 6 节）。

## 2. 仓库结构

| 路径 | 内容 |
|---|---|
| `manifest.json` | 扩展清单与版本号 |
| `index.js` | 启动、SillyTavern 生命周期适配、模块装配；前向依赖用惰性回调 |
| `settings.html` | 工作台全部页面的静态结构 |
| `style.css` | 全部样式（约 1.2 万行，见第 7 节） |
| `src/` | 按 config / core / features / memory / rp-core / summary / tables / vector / ui / shared / theme 分的模块 |
| `tests/*.test.mjs` | `node --test` 全量回归（约 575 项） |
| `tests/offline/` | 需 linkedom 的离线 DOM 检查 |
| `tests/browser/` | 需 Playwright 的原生浏览器检查 |
| `scripts/ui-harness/` | 模拟酒馆页面 + 样式分析工具（第 6、7 节） |
| `docs/` | 本文、架构、剧情状态提示词 |

## 3. 产品与数据边界

- 摘要、自由表格、剧情状态（RP）三者独立。旧 chronicle 仍服务表格/摘要，不能删除，也不能当 RP 的事实来源。
- 菜单直达“剧情状态”；表格/向量在“自动与数据 → 记忆结构”。RP 总览点对象进详情；全部记录按类型分组，每页 20 项。
- RP 空白启用，从当前楼层开始；不导入旧表、不从摘要头部生成事实。旧 RP 基线保留。
- RP 自动方式只有 inline / independent，默认 inline（无额外请求）；independent 须用户主动选择。手动“用模型重新提取”不改变自动方式；时机、过滤、注入各自独立。
- schema 1、规则 3、协议 2、来源策略 2、规范化 1 分开管理。旧规则/来源保留，迁移留 upgradeSnapshot，未知版本不改写。
- 模型输出局部 events，自动收录，用户事后纠错。省略不清空，状态逐项修订/结束，借还/销毁/恢复/约定重开有明确动作。只有 Facts 改状态。
- 随正文的 rpEvents 只在阅读区隐藏，原文/编辑/导出保留；宿主显示正则与 DOM 补做配合，不覆盖用户正则。
- RP 提示词版本 3、协议 2。只有精确匹配的旧内置默认会自动升级；自定义及预设保留。已应用指令与表单草稿分离，预设跨聊天共享。

## 4. 代码入口

| 职责 | 入口 |
|---|---|
| RP 生命周期/事务 | `src/rp-core/service.js`、`transaction.js`、`policy.js` |
| RP 来源/自动提取 | `chat-sources.js`、`extraction-flow.js`、`extraction.js` |
| RP 身份/分组/规则/重放 | `identity.js`、`groups.js`、`domain.js`、`local-events.js`、`ledger.js` |
| RP 注入/短引用/说法 | `rp-core/context.js`、`model-references.js`、`current-information.js`；`features/injection-service.js` |
| RP 界面/提示词 | `features/rp-state-*.js`；`rp-core/prompt.js`、`prompt-library.js` |
| 全局设置/保存 | `src/core/*settings*`、`global-config-save.js`、`persistence.js` |
| 聊天恢复/备份 | `core/summary-recovery-journal.js`；`rp-core/backup.js`；`memory/backup-package.js` |
| 摘要/表格/召回 | `features/summary-*.js`、`table-*.js`、`vector-*.js`；`src/vector` |
| 填表校验/错误 | `tables/operation-parser.js`、`operation-feedback.js`；`table-memory-model` 预检与应用共用暂存校验；草稿应用须传 raw，失败保留原文 |
| 本轮注入预览 | `features/overview-token-manifest.js`、`injection-preview.js`；只读当前配置；body 顶层 dialog |
| 设置页保存 | `ui/page-settings.js`（保存栏、草稿、离开提醒）；`ui/unsaved-changes-dialog.js` |
| 摘要方式向导 | `features/summary-source-wizard.js`；映射在 `features/turn-trigger-policy.js` 的 `workflowForSummarySource` |
| 总结生成 | `features/summary-generation-ui.js`（卡片）、`summary-target-controller.js`（范围对话框）、`summary-generation-controller.js`（生成） |
| 页面切换 | `ui/workbench-navigation.js`（切页滚回顶部、离开确认） |
| 模型候选/选择 | `vector/provider-config.js`；`ui/model-picker.js` |

## 5. 不能破坏的约定

### 界面与操作（v1.8.8 起）

- **设置页只有一个保存入口**：顶部粘性保存栏。`page-settings.js` 的 `pages` 列出受管页面及字段正则；页面内不要再加“应用”按钮。少数开关即时生效（`immediateFields`）。
- **草稿与离开提醒**：受管页面的修改先存为草稿；切页或关闭时有未保存修改会弹“保存并继续 / 放弃修改 / 留在本页”（Esc = 留在本页）。`switchTab`/`close` 在需要询问时返回 Promise，调用方要 `await` 后再操作目标页（例：`focusSummaryRecord`）。
- 单选组算一项修改；向导自动填入的字段用 `data-bakemono-edit-group` 归入同一项。
- **摘要方式**：向导只填表单，由保存栏应用。来源与工作流、记忆策略、阶段材料、输出风格按 `workflowForSummarySource` 一起保存。插件内保存的摘要（独立/手动）必须配 generic 策略才会注入，“恢复默认搭配”用来修正旧的错误组合。注入开关、深度、角色只在注入页。
- **总结卡片**只有一个生成按钮；“生成一条 / 分批生成”在范围对话框里选，并按类型记住（`generationTargets[kind].batch`）。单条与分批生成函数会根据该选择互相转交。
- 页面名称只在顶部栏显示，页内不再放重复标题（只有帮助页保留简介）。不加装饰性编号和斜纹；例外是新样式里的场记板（见下一小节）。
- 主按钮统一用 `--bk-accent`；`#bakemono-workbench-root [hidden]` 强制隐藏，不要用 display 规则顶掉 `hidden`。
- 所有页面共用一个滚动容器，切页时回到顶部。

### 新样式：电影打板（v1.10.0 起，剧情状态先行）

用户确认的方向与效果图：https://claude.ai/artifact/6vbvJyvPG9x231jWekBs3u 。一次改一个页面，每页发一个小版本。

- **少框**：用户不喜欢卡片套卡片、一排排胶囊按钮。用细线分隔、文字和一条左侧细线表达层级（“变化”时间线是用户点名喜欢的写法）；筛选用一行文字目录（`人物 4 / 关系 2 / …`），不用胶囊。
- **排版**：标题用衬线（`--bk-display`），场次/楼层/时间码/小标签用等宽字体，小标签带英文（`SCENE`、`CAST`…）。空字段不显示。会花钱的操作标价签（`不花钱` / `+1 次请求`），不放在页面底部。
- **颜色只取主题变量**：剧情状态的 `--rp-*` 全部由 `--SmartThemeBodyColor`、`--bk-accent`/`--bakemono-theme-accent-strong`、`--bk-paper` 推出，所以跟随酒馆、夜、日、自定义都能用。剧情状态面板已从三条全局 `!important` 字号规则里排除（`:not([data-bakemono-panel="rp-state"])`），它有自己的字号。
- **主题**：外观页四个选项“跟随酒馆 / 场记板 · 夜 / 白板 · 日 / 自定义”，数据结构不变（夜/日是 `themeMode: 'custom'` + 内置预设 `bakemono-slate-night` / `bakemono-whiteboard-day`）。旧的暖纸预设未改动过的副本会被清掉，改过或正在用的保留为普通配置。**跟随酒馆时背景必须不透明**：`theme-controller.js` 把宿主的 `--SmartThemeBlurTintColor` 按文字明暗叠在实心底色上，写回插件根节点；宿主主题变化由 `watchHostTheme` 跟进：`<html>/<body>` 属性、`<head>` 里样式表的增删改、系统日夜切换（`prefers-color-scheme`，这种切换不改任何 DOM）、回到页面，另加插件打开期间每 2 秒一次的兜底检查；只有三个宿主颜色变量真的变了才重算。注意插件根节点自己也有 `data-bakemono-theme-mode` 属性，查询主题按钮要限定在 `.bakemono-memory-theme-mode` 里。
- **共享变量**（v1.11.0 起）：新样式页面用 `#bakemono-workbench-root` 上的 `--ns-*`（文字、细线、强调、提醒、衬线/等宽字体）。注入来源的六种颜色 `--ns-source-*` 是用 dataviz 校验脚本算过的低饱和配色（深色与浅色两套），根节点的 `data-bakemono-theme-appearance`（跟随酒馆时按文字明暗推断）决定用哪套。新页面优先用这些变量，剧情状态仍用自己的 `--rp-*`（也从 `--ns-ink` 推出）。字色：`--ns-ink` 是正文色，跟随酒馆时把宿主正文色按明暗向白/黑推 18%（很多酒馆主题正文偏灰），次要 88%、更淡 72%；本插件自己的日/夜/自定义主题不推。
- **首页**：一个细线分格的便当网格（状态 / 楼层覆盖 / 本轮注入 / 当前配置），电脑上注入与配置左右并排，两边用同一骨架（固定高度的大字区和 60px 的行）保证逐行对齐。楼层覆盖 = 全程分段条（`buildFloorReel`，按“阶段总结 / 只有摘要 / 未整理”合并成几段，缺口用短竖线，楼层再多也不变密）+ 最近 24 楼胶片。主按钮来自已有的 `getOverviewRecommendation`。
- **总结页**（v1.13.0）：一排三等分层级标签（剧情摘要 / 阶段总结 / 多次总结，`data-bakemono-preview-type`）同时决定上面的“下一步”和下面的列表；`summary-generation-ui.js` 的 `modeByLevel` 把“剧情摘要”对应到原来的补写旧聊天（批量表单仍是 `data-bakemono-owned-section="batch"`，只在这一层显示，并且默认收起：这一层的主按钮带 `data-bakemono-batch-toggle`、不带 `data-bakemono-action`，只负责展开/收起，开始任务用表单自己的按钮；设置中心的“去补写旧聊天”会直接展开）。列表是时间线：阶段/多次总结一章一个吸顶标题，剧情摘要按“收进哪一章 / 待整理”分组（`getSummaryGroup`，来自摘要来源图 `getSummaryStatus().coveredBy`）。每条摘要按提示词的 `➤ …【段名】` 分段显示，段名缩写取自“预览分段”设置；行首符号决定画法（`classifySummaryLine`：`-` 列表、`>` 台词、`[名]：` 标签行、`*…*` 旁白、`- [事件] (…)` + 缩进 `- 经过：` 事件）。操作只有展开后标题旁的 “⋯”（`summary-action-sheet.js`）：编辑（只对插件保存的摘要）、定位原文、删除（在单子里再确认，删除后 toast 可撤回，`restoreDeletedSummary`）。写在聊天正文里的摘要只能定位，不能在这里改。还没有单条“重新生成”。
- **待确认**（v1.14.0）：面板同时带 `bk-sum bk-rev`，直接复用总结页的层级标签、时间线、分段文档和编辑框样式。草稿按来源分组（`draftOrigin`：补写缺失摘要 / 旧正文补课 / 自动总结 / 手动生成），正文用总结页的 `describeSummary` / `createSummaryDocument` 画。草稿外面只有“保存”；编辑、重新总结、定位原文、丢弃在 “⋯” 里（`review-queue-events.js` 的 `openDraftActions`），重新总结和丢弃在单子里再确认，所以调用 `discardDraft(id, { confirmed: true })`。保存和丢弃后的 toast 可撤回（保存的撤回用 `undoLastCommit({ confirmed, expectedCommitId })`，之后又保存过就不撤）。任务和记录页的低频操作（移除任务、清理、撤回上次保存、清理记录）保留原来的确认框；“停止当前任务”新增确认。剧情状态的待确认只显示一行链接到剧情状态页。
- **摘要树**（v1.15.0）：面板带 `bk-sum bk-tree`。卷 > 章 > 剧情摘要三层，卷默认展开、可以收起（`closedVolumes`），章默认收起（`openChapters`），超过 12 条的列表先显示 12 条。一条已经列在某卷/某章里的内容，即使那一层需重建也只在那里出现（`listedInVolume` / `listedInChapter`），不会同时出现在“还没整理”里。顶部色条来自楼层索引：`coverageRuns` 把楼层按“收进卷 / 只收进章 / 只有剧情摘要 / 没有摘要”合并成段，“收进卷”用多次总结的 `summarySourceFloors`。每项的“打开 ›”走已有的 `data-bakemono-summary-focus`，跳转时同时切换总结页的层级；“去补写 ›”带 `data-bakemono-open-batch`，到总结页后直接展开补写表单。模拟页面可在 `?sum` 后于控制台执行 `(await import('/tree-fixture.js')).addTree()` 加三章一卷（其中一章来源已变化），再切到摘要树或总结页。
- **表格**（v1.16.0）：表格页和“自动记忆”共用 `turn-summary` 面板，表格部分是 `.bakemono-table-panel-card.bk-sum.bk-tbl-page`（旧的全局字号规则用 `:not(.bk-tbl-page *)` 排除）。每行默认按条目显示（第一栏当标题，其余每栏“栏名在上、内容在下”，超过 60 字的栏占满一行并折叠到 4 行），可切到横向表格视图；点“编辑”原地改一行（`tableUiState.editRow`），“⋯”里是栏目与规则（`editFields`）、只读、删除表格（单子里确认）。`saveEditedTableFromElement` 只写回屏幕上有输入框的部分（栏目编辑器、正在编辑的行、旧的整表网格），所以只读显示的表不会被清空行或栏目说明。本轮修改用 `describeOperation` 写成 +/~/−，更新会写出旧值 → 新值；应用不再弹确认，提示里可撤销（`undoLastTableOperation`）。设置（表格组、新建导入、填表提示词、撤销导出清空）是页面底部的一列可展开行，ID 与处理函数不变。
- **向量记忆**（v1.17.0）：面板是 `bk-sum bk-vec`，开关和设置行复用表格页的 `bk-tbl-switch` / `bk-tbl-set`（设置组 `<details name="bk-vec-set">` 一次只开一个，`vector-actions-controller.bind` 里补了不支持 `name` 的浏览器）。召回规则在 `src/vector/recall-plan.js`：一楼一组，`maxSummaryRecall` 和 `fullRecallCount` 分开计数，达到 `rerankThreshold` 且正文名额没满才带整段正文，否则带摘要；不再截断，只有 `recallSafetyChars`（默认 12000）一条放不下就整条不带（正文先退回摘要）。索引固定一楼一条（`indexMode`/`injectMode`/切片参数不再生效，保存时写成 message/tiered），楼层摘要和已存总结整条保存，只有嵌入输入按 `summaryMaxChars` 截取。“上次召回”由 `renderVectorRecall` 用 `lastRerankCandidates`（每组的去留和 `decisionReason`）、`lastHits`、`lastQueries`、`lastEmbeddingCandidates` 画出，`lastRecallAt` / `lastRecallQuery` 是运行期字段。
- **自动记忆**（v1.18.0）：`turn-summary` 面板里自动记忆的部分是 `.bakemono-turn-panel-card.bk-sum.bk-auto`（表格页时隐藏；旧的全局字号规则用 `:not(.bk-tbl-page *, .bk-auto *)` 排除）。“摘要 / 表格”两行由 `turn-summary-ui.js` 画出，选项写进两个隐藏的 select：`#bakemono-memory-turn-summary-source`（existing/inline/independent/manual，legacy 只显示）和 `#bakemono-memory-turn-table-mode`（inline/after/manual），所以改动和其他设置一样走底部保存栏。`readTurnSummaryFieldsFromUi` 在来源变化时调用 `applySummarySourceChoice` 并套用 `workflowForSummarySource` 的默认搭配，再用 `applyTableModeChoice`（`turn-trigger-policy.js`）换算成 `inlineGeneration.tableEnabled`、`tableDatabase.enabled`、`turnSummary.auto` / `processingMode`，不会产生旧版“只填表”组合；摘要“只手动”时表格不能选“回复后单独写”。原来的 `table-enabled`、`inline-table-enabled`、`turn-processing-mode` 输入框已删除，读取时缺失就保留原值。顶部和“最近几轮”读楼层索引（`getCurrentFloorMemoryIndex`）。
- **向量关键词**（v1.18.0）：模型改写多要一行 `KEYWORDS:`，`parseVectorQueryRewriteLines` 解析；`prepareVectorQueries` 只留最近对话里原样出现、且不在用户词表里的词（最多 6 个），存在运行期字段 `lastInferredKeywords`，召回时和用户词表合并参与关键词加分与候选。
- **保存栏**（v1.18.1）：`#bakemono-memory-page-savebar` 只在有未保存修改、正在保存或刚有结果时显示；保存成功显示“已保存”，2.5 秒后收起；失败时留着，好再点一次。保存核对（`global-config-save.js`）在约 10 秒内回读 5 次（0 / 0.6 / 1.6 / 3 / 5 秒，总超时 15 秒）；`savePage` 失败时抛出具体原因（设置文件没确认 / 聊天没保存 / 保存时设置又变了），由保存栏的提示显示。
- **颜色按意思分**（v1.19.0）：`#bakemono-workbench-root` 上有六个表示意思的颜色：`--ns-c-event`（发生的事）、`--ns-c-voice`（台词）、`--ns-c-people`（人物、地点、表格内容）、`--ns-c-thread`（没解开的线）、`--ns-c-wall`（第四面墙、插件自己的进度）、`--ns-c-done`（已保存），另有中性的 `--ns-c-plain`。每个都是一个固定色相和 `--ns-ink`（当前文字色）用 oklab 混出来的，所以深色主题上偏浅、浅色主题上偏深，跟随酒馆主题；跟随酒馆时 `--ns-c-voice` 用主题的 `--SmartThemeQuoteColor`。不再一页一个颜色，每页按意思混用；页面之间靠布局区分。
- **摘要排版**（v1.19.0）：`summarySectionKind(段名)` 把段分成 events / voice / elsewhere / threads / wall / people / plain，`.bk-sum-sec.is-<kind>` 决定颜色和排法（场记编号、收音浅底台词、副镜地点标签、暗线 ○/●、第四面墙虚线框）。没有“➤【段名】”也没有【☆『…』】头的摘要改用 `readLooseSummary` 读：【】/# /整行加粗当标题或段名，时间/地点/人物并进头部，“名称：内容”成标签行（名称能看出类型的单独成段），带引号的整行当台词，其余按原来的换行分段。总结、摘要树、待确认共用这一套。
- **自动总结**（v1.20.0）：`automation` 面板是 `bk-sum bk-auto bk-stage`，沿用自动记忆的行、开关和“点开选”的样式。“整理完怎么办”写进隐藏的 `#bakemono-memory-auto-mode`，由 `hub-automation-ui.js` 的 `renderAutomationForm` 画选项、`bindAutomation` 处理点击，所以走底部保存栏；“按条数 / 按字数”和对应的数字框按表单当前值切换。状态句仍来自 `stageAutomationStatus`，只有等待时改写成“再攒 N 条摘要就整理成下一章”。“最近整理”取最近 4 个阶段总结和阶段草稿，已保存的点了用 `data-bakemono-summary-focus` 跳到总结页。生成 API 在 v1.23.0 移成生成模型页自己的内容，本页只留一行链接。
- **入口页**（v1.21.0）：`data-hub` 和 `settings-hub` 面板是 `bk-sum bk-hub`。自动与数据的四格（`[data-hub-frame]`）由 `hub-automation-ui.js` 的 `renderHubPanels` 经 `setFrame` 填写：一句状态、一句次要说明、小进度条宽度和 `data-tone`（ok / wait / alert / off，对应 `--ns-c-done`、`--ns-c-event`、`--ns-alert`、淡色）。自动总结的“离下一章多远”由 `stageProgress` 算，两页共用。原来移进来的“记忆数据库”块（`data-bakemono-owned-section="database"`）和 `memory-records-ui.js` 已删除，改成页面里的一排数字（`#bakemono-memory-count-story` 等仍由 workbench-renderer 填）。设置中心是分组列表，每行 `data-hub-keys` 供顶上的“找设置”过滤。
- **少写说明**（v1.21.1，用户要求）：标题下面不再放换个说法重复标题的小字，分组标题下也不放一行介绍。只留三类：会多花请求（“+1 次请求”）、数字怎么填（“0 表示全部”）、会重建或覆盖的提醒。新页面照这个写。
- **记忆从哪来三页**（v1.22.0）：`settings`、`scan`、`archive` 面板都加了 `bk-sum bk-auto`，沿用自动记忆的状态区、行和设置列表。摘要方式的四个单选仍是 `name="bakemono-memory-summary-source"`，由 summary-source-wizard 填高级搭配，走底部保存栏；高级搭配状态写在 `#bakemono-memory-summary-source-adv`。楼层收纳不再是启动时移进来的块（删了 `data-bakemono-owned-section="archive"` 和对应插槽），直接写在 `archive` 面板里；`renderAutoHideRecentPanel` 画标题和楼层条，连续的隐藏 / 可见楼合并成一段（`flex-grow` 按楼数），隐藏按宿主的 `is_system` 或插件记录的隐藏楼判断；打开这一页时也会渲染。扫描页的识别结果每条一行：楼层、类型、摘要标题（有『…』时取标题）。
- **生成与注入三页**（v1.23.0）：`generation`、`prompts`、`injection` 面板同样是 `bk-sum bk-auto`。生成模型：接口来源改成两个单选 `name="bakemono-memory-api-provider"`（`configuration-service` 读选中的那个），选“自定义接口”才显示 `#bakemono-memory-custom-api-fields`；温度、最大输出长度、请求方式只对自定义接口生效，所以也放在里面。启动时移块的 `generation` 插槽已删。生成提示词：四份提示词各一行（`[data-bakemono-prompt]`，色点按意思：补课中性、补写琥珀、阶段青绿、多次紫），行里是开头一行和“默认 / 已修改”（和默认、通用默认都不同才算修改），点开才是编辑框，一次只开一份（`openPrompt`）。注入内容：标题“本轮注入 N 字”和顶栏同一个数（`renderInjectionContent` 的长度），分段条和图例用首页的来源名和 `--ns-source-*` 颜色；“记忆正文 · 只读”框去掉了，模板预览改用 `state.generatedMemory`。三页的“预设”行右侧写当前预设名（`data-bakemono-preset-value`）。
- **开场白**（v1.23.0）：第一条用户消息之前的角色消息是开场白（`src/shared/opening.js`，只在已经有用户消息时成立）。开场白没有自己的摘要时不算缺摘要：楼层索引里第一条回复有摘要后它跟着算，否则不列出；剧情状态不对它单独提取、不记失败、进度里不算“还没处理”，旧版本留下的开场白失败提示也不再显示。第一条回复时，随正文写的摘要 / 表格 / 剧情状态指令各加一句“连同开场白一起记”（开场白已有摘要块时摘要不加）；回复后单独写的摘要和表格把开场白放进同一次请求，独立提取剧情状态时也一起读。不额外发请求。
- **合并人物**（v1.23.0）：剧情状态新增事实 `person_merged`（`data: { id, into }`，只由用户发起）。重放时把被合并者的关系、约定、物品、在场、别人的状态指向转到保留的人，名字和别名并入保留者的别名，特征和临时状态合并，自己跟自己的关系和重复的持续关系去掉；`projection.merged` 记下旧 id，旧记录的名字（`entityName`）仍能显示成保留者。人物页有“合并重复人物”，可能重复的人（`sameShortName`：单独的名和“名·姓”的第一段相同）直接列出，其余人在一个下拉里；概览和档案页有“可能有重复的人物”提示。登记新人物和解析人名引用时，精确名字找不到就按同样规则找唯一的一个（`findPeopleByName`），所以“夏尔”不会再另建一个人。
- **多次总结的材料**（v1.23.0）：多次总结只用阶段总结或已有的多次总结，不再用剧情摘要（`selectEpicSourcePool`）；没有阶段总结时多次总结页的按钮不可点，提示先生成阶段总结。
- **来源检查的速度**（v1.23.0）：每楼的哈希按消息对象缓存（`messageHashes`，文本、重 roll、角色、排除标签不变就不重算）；同一个聊天数组再次登记时不清空来源图缓存（签名已包含每楼版本）；来源图里按 id / 楼层建了索引。分批加入任务时用 `summarySources.once()` 只刷新一次来源并在期间固定来源图（`holdSummaryGraph`），`silent` 的批量入队合并成一次保存（`saveSoon`）。900 楼、45 个阶段总结分 9 批：约 1.5 秒降到 0.1 秒（电脑）。忙的时候点生成会提示“上一个任务还在进行”。
- **滚动**：把某一项滚进视野时用 `src/ui/scroll-into-main.js` 的 `scrollIntoMain`，只滚内容区 `.bakemono-workbench-main`；不要用 `Element.scrollIntoView()`，它会连带滚动被裁剪的外层，手机上曾把整个剪辑台（连同顶栏和关闭按钮）推出屏幕。切换页面时 `resetWorkbenchFrame` 会把外层滚动归零。
- **侧栏**（v1.15.1）：常用是 剪辑台 / 总结 / 剧情状态 / 表格 / 向量记忆 / 待确认；记忆库在 v1.20.1 去掉了（只是浏览已保存的摘要，和总结页重复，用户不用）。`state.memoryRecords` / `buildMemoryRecords` 仍在，供注入和统计使用。表格和向量记忆仍可从“自动与数据”进入。
- **来源检查与排除标签**（v1.15.1）：总结的来源检查除了用生成时记录的排除标签，还会用当前的排除标签（扫描规则 + 向量设置）再算一次，并去掉没有结束标签的排除标签（如 `<img …>`，`stripConfiguredTags(text, tags, { unpaired: true })`）；任一种算法与记录一致就算没变。这样后来往旧楼层插入的图片等内容，只要标签在排除列表里，就不会让总结变成“需重建”。
- **操作单**：`src/ui/action-sheet.js` 是共用的“⋯”单子（`open({ title, subtitle, render(view), run(name) })`，`data-sheet-view` 切换确认步骤，`data-sheet-do` 执行），样式类 `bk-sheet*` / `bk-act` / `bk-confirm`。总结页和待确认都用它。
- **剧情状态结构**：四个标签（概览 / 档案 / 变化 / 设置）+ 详情 / 编辑 / 时间子页，子页左上角统一“‹ 返回”。关系图只画当前场景的人和直接相关的人，最多 6 人，否则回到列表（`relationGraph` 返回空串）。设置是草稿 + 粘性保存栏，修改数与首次渲染时的表单比较（`settingsBaseline`）。

### 数据与运行

- 总结页路由是 `preview`；异常摘要跳转要连同真实面板检查。向量计数/字数按整数校验，默认值须通过原生 validity；错误字段展开定位且保留输入。
- 宿主实时元数据用 getter；`ensureGlobalSettings()` 不返回对象，初始化后从 `extension_settings[STORAGE_KEY]` 取值。
- 后台不读隐藏表单、不把运行状态升为全局配置；合法的 false/0/空字符串不是缺失值。全局保存须回读核验，聊天保存不等于全局成功。
- 注入预览、计数与发送用实时有效来源；`generatedMemory` 只是每次重建的缓存（因此注入页“记忆正文”只读）。“已选入”不等于已发送。向量 `lastIndexError` 只属本聊天，失败后靠手动刷新恢复，不随后台事件重试刷屏。
- RP 串行事务检查聊天、来源、分支和修订；失败只回滚本次 RP，不覆盖较新状态或摘要；普通 RP 错误不阻断同聊天摘要；切聊天停止旧流程。
- 自动同源只处理一次；手动重提取替代模型旧批次，保留审计与人工纠错。早期来源变动后，后续绝对状态保守停用。RP 失败去重绑定来源与协议哈希，修正输出可重读；独立调用失败需手动重试。
- RP 简报/维护槽共享字符预算，只发相关现状和短引用，不发完整投影/近期事件 JSON。短引用由原身份确定，校验后解码，不换存档 ID。维护提示词超预算时暂停。
- RP 不参与向量/BM25 召回；`vector/source-policy` 清理旧 RP 索引与命中，不删账本。
- RP 恢复/清空只处理 RP 及其缓存：先确认、下载副本，绑定聊天/修订，恢复后停用并暂停；深层校验；旧包缺 RP 不清空现有 RP。
- 恢复副本只在新载入核对到修订后清理，focus/切页不算落盘证明；轻量恢复不能丢正式摘要、账本、表格与决定。
- 日志/诊断用白名单，不含正文、密钥、接口地址或原始模型输出。
- 摘要有效性/覆盖统一走 `memory/summary-provenance`；持久覆盖数组不是当前事实。新摘要 UUID 与 contentHash 分离，provenance 固定实际输入，编辑输出不能重绑来源。旧档迁移须预览/备份。
- 自动总结选材、编排与进度共用 `summary-selectors`、`summary/material-quality`、`summary/automation-status`；触发标记只在入队后写入，同批防重；来源校验比较实际输入。只检查所选批次内的缺口；选材、补写、覆盖与隐藏共用 `summarySourceFloors`。
- 摘要来源选择写入旧配置字段，保留旧手动及组合方式（“旧版组合设置”）；运行错误不进全局预设。

## 6. 测试与界面检查

### 常规检查（每次发布前）

```powershell
node --test
Get-ChildItem index.js, src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
git diff --check
```

### 离线 DOM 与原生浏览器

- `tests/offline/*.mjs`：`BAKEMONO_TEST_LINKEDOM` 指向已有 linkedom 的 `esm/index.js`（file URL），部分还需 `BAKEMONO_TEST_CSSTREE`；`rp-display` 另需 `BAKEMONO_TEST_TAVERN` 指向只读宿主。
- `tests/browser/settings-save-native.mjs`：`BAKEMONO_TEST_PLAYWRIGHT` 指向 Playwright 的 `index.mjs`，`BAKEMONO_TEST_BROWSER_PATH` 指向本机 Chrome。
- 这些依赖不装进仓库。v1.8.8 之后的版本在本机没有这些依赖，未运行它们；`tests/offline/automation-recovery-ui.mjs` 已按摘要方式向导更新但未实跑。

### 模拟酒馆页面（scripts/ui-harness）

不需要安装酒馆，也不调用模型：

```powershell
node scripts/ui-harness/server.mjs
# 浏览器打开 http://127.0.0.1:8765，点“剧情剪辑台”
```

- 模拟宿主在 `scripts/ui-harness/script.js`（8 楼示例对话，其中 2 楼带摘要；加 `?sum` 再追加 48 楼，每条回复带一段完整格式的剧情摘要，用来看总结页）与 `scripts/ui-harness/scripts/*.js`。它没有酒馆自己的样式，所以对话框里的输入框是白色的，这不代表插件有问题；`box-sizing` 已按酒馆补上。
- 剧情状态：打开 `http://127.0.0.1:8765/?rp`，最后一楼会带一段 27 条的示例 `rpEvents`（其中 1 条故意多余，用来检查“没记上”提示）；启用剧情状态后点“读取最新回复”。
- 插件会把聊天状态备份到 `localStorage`，刷新页面后旧状态会被恢复；要从头开始，先在控制台执行 `localStorage.clear()` 再刷新。
- 手机宽度（< 768px）在浏览器模拟时会自动刷新一次页面，脚本要等刷新完成再运行。
- 快照：在页面控制台执行 `(await import('/snap.js')).run('名字')`，结果写到 `scripts/ui-harness/.output/名字.json`；比较两次：`node scripts/ui-harness/tools/snapdiff.mjs a.json b.json`。它会逐页打开全部折叠栏，记录所有元素的位置与 40 余项计算样式，并关闭动画以保证可重复（同一版本连续两次应为 0 差异）。

## 7. 样式表现状与整理方法

- 现状约 10,700 行（v1.8.7 为 13,443）。剩余部分多数确实生效：约 850 条规则作用于脚本生成的内容；大量是“基础样式 + 某页覆盖”的叠法，基础样式在别的页面仍生效。再大幅缩减需要按组件重写样式规范，外观会变化，应先做样板页给用户确认。
- 历史层（注释里的 “precision pass”、“v1.2.3 refinement” 等）按出现顺序叠加。新增样式时优先修改真正生效的那条规则（可在浏览器里用 CSSOM 查 `el.matches(rule.selectorText)`），不要再追加一层覆盖。
- **安全删除流程**（`scripts/ui-harness/tools/`）：
  1. `css-dedupe.mjs`：删除同选择器、同媒体条件下必然被后面覆盖的声明（不删新语法的兜底写法）。
  2. 生效分析：`css-export.mjs style.css . .output/rules.json`、`css-conditions.mjs . .output/conditional.json`，然后在模拟页面按每个断点区间各一个宽度（360、415、480、580、660、710、800、1000、1280）运行 `(await import('/cascade.js')).analyze('w宽度')`，最后 `css-remove-dead.mjs style.css .output/rules.json 输出.css .output/cascade-*.json`。只有被“无条件”规则始终压过的声明才会删除；运行时切换的类名/属性、伪类、非宽度媒体查询都算有条件；作用于脚本渲染类名的规则一律保留。
  3. 用 `CSS_OVERRIDE=输出.css` 启动模拟页面，在 1280、800、375 三个宽度拍快照，与改动前比较必须为 0 差异；有差异就先修分析工具，不要手工放行。
- 注意：样式表内容改了之后，规则序号会变，分析结果必须针对同一份样式表重新生成。
- **清理某页旧样式**：`node scripts/ui-harness/tools/css-drop-classes.mjs style.css '<类名或编号的正则>'`（匹配 `.` 或 `#` 之后的名字）删掉提到这些名字的选择器，整条规则的选择器都删光时删除整条规则；名字只出现在 `:is()/:where()/:not()/:has()` 里的选择器只报告、不动，需手工处理。用于已经从 HTML 和 JS 中移除的名字，或整体重写某个组件时（先删旧规则，再写完整的新规则，包括布局）。第三个参数写 `--raw` 时把第二个参数当普通正则匹配整个选择器，可用来删属性选择器（如 `'^(?!.*data-active-tab).*data-bakemono-panel="preview"' --raw`）。
- **按页重写**（v1.10.0 起）：剧情状态的样式是一整段（注释 `Story state (剧情状态): film-slate layout`），替换了原来那段。后续页面同样整段替换该页旧规则，不在旧规则上再叠一层；替换前用快照工具确认别的页面 0 差异。

## 8. 发布流程

1. 版本号：`manifest.json`、帮助页 `settings.html` 中的 `v版本 ·`、README 顶部 `当前版本：**v版本**`（有测试核对），以及本文第 1 节。
2. 在 `CHANGELOG.md` 最上面加一节 `## v版本 · 标题`：先写用户能看懂的变化，验证细节放在 `<details><summary>验证记录</summary>` 里。
3. 跑第 6 节的常规检查。
4. 获授权后：`git -c http.sslVerify=true fetch origin`，确认本地与 `origin/main` 一致；提交；`git -c http.sslVerify=true push origin main`；用 `git ls-remote origin refs/heads/main` 比对 SHA。网络参数只在单次命令里加，不改全局配置。
5. 不提交本机依赖、截图、快照或临时数据（`scripts/ui-harness/.output/` 已忽略）。

## 9. 后续工作

- 手机实测：v1.8.8 – v1.23.0 的改动都只在模拟页面验证过，需要用户在真实酒馆（尤其手机、iOS Safari）确认；宿主保存、后台冻结、重 roll、流式协议隐藏同样需要实机。
- 新样式推广到其他页面（见第 5 节“新样式”）。已完成：剧情状态（v1.10.0）、首页（v1.11.0）、顶栏与侧栏（v1.12.0：电脑上 264px 细线侧栏，手机 ≤900px 为左侧抽屉 + 遮罩 `[data-bakemono-menu-close]`，布局尺寸与旧版一致，顶栏由 82px 收到 70px）、总结页（v1.13.0）、待确认（v1.14.0）、摘要树（v1.15.0）、表格（v1.16.0）、向量记忆（v1.17.0）、自动记忆（v1.18.0）、自动总结（v1.20.0）、自动与数据和设置中心（v1.21.0）。设置中心第一组子页（摘要方式、扫描与识别、楼层收纳，v1.22.0）、第二组（生成模型、生成提示词、注入内容，v1.23.0）。其余页面仍是旧样式：外观、整套配置、撤回与事务和提示词检查器。用户给的每页参考：首页 Magic Bento + 编辑式仪表盘；总结 时间线 + 卡片堆叠；摘要树 嵌套时间线；待确认 审阅队列；提示词检查器 文档阅读器；设置中心 系统设置列表；电脑导航 细线侧栏；手机导航 抽屉 + 分段标签。React 组件库（React Bits、Aceternity）不能直接用，只借效果、用 CSS 和原生 JS 实现。
- RP P1：历史范围重建、精细依赖纠错、丰富人物/历法、大账本增量缓存（RP 目前仍完整重放，大档有主线程耗时风险）。
- 固定模型输出的测试不证明真实模型语义准确率。

## 附录：v1.7.0 剧情状态实施与验收

剧情状态首次实现时的需求编号与测试对应表，修改剧情状态相关逻辑时可用来找回归测试。

### 范围与结果

起始提交 fad4a627997cc04acb4a79be572958fd026fcdcb（1.7.0-beta.3），起始工作区干净，没有覆盖用户未提交修改。执行任务书 P0-A～D，发布目标 main，版本 1.7.0。

| 范围 | 完成内容 | 主要入口 |
|---|---|---|
| P0-A | 空白启用、独立配置/正文来源、两种模式、手动单次提取、暂停/清空/RP 专属恢复 | service、policy、chat-sources、extraction-flow、rp-state-ui |
| P0-B | 局部事件、独立状态项、借还/恢复/重开、幂等、重提取替代、原子组、下游失效 | identity、extraction、groups、domain、local-events、ledger |
| P0-C | 暖纸总览，新建、变化/纠错、逐项状态、来源/差异、分页、进度/缺口 | rp-state-ui、rp-state-editors、rp-state-presentation、state-view |
| P0-D | 独立简报/维护槽、完整选材后预算、类型检索/缓存过滤、失败隔离、版本化恢复 | context、memory、injection-service、memory-orchestrator、backup |

基线 423 项通过；升级后 447 项 Node 回归通过，无跳过。新增用例执行生产 service → flow → orchestrator → injection-service 及实际 MESSAGE_SENT 回调；宿主保存与模型响应是离线替身，业务模块用生产实现。

133 个运行模块按 ES module 解析，完整 CSS 解析通过。15 组离线 UI/存储/显示检查，以及独立合成长档测量。没有打开浏览器、调用真实模型、同步本机酒馆或上传聊天。

### 兼容与行为变化

- schema 1、规则 3、协议 2、来源策略 2 分别管理；旧规则/来源继续读取，留升级前副本；旧 RP 基线、自定义提示词不删除。
- 新状态不导入旧表或摘要头部。默认 inline；旧 reply/reuse 无法等价迁移时暂停、提示重选，不自动增加调用。
- 旧 state 输入受局部保护，不能悄悄覆盖集合或越过借用/终止规则；旧记录按旧规则重放。
- 有效空事件推进进度，缺失/截断/失败不冒充成功；手动重提取不重复消耗、不覆盖人工纠错。
- 专属恢复绑定聊天，深层校验字段/引用/版本。恢复后模块关闭、任务暂停，仅清理 RP 缓存，不动其他记忆。

### 验收映射

测试名为可检索片段；Node 项执行下方全量命令，UI 项执行离线脚本。

| ID | 测试文件 / 场景 |
|---|---|
| I01、I03、I04、I05、I06 | rp-independent：independent activation and body-only policy；offline/rp-independent-ui 空白启用；check-rp-state 有旧表也不导入 |
| I02、P04、P05 | rp-independent-acceptance：production service→flow→orchestrator→injection with summary and tables disabled |
| I05 | rp-independent-acceptance：actual MESSAGE_SENT callback honors RP delayed timing |
| I07 | rp-auto-recording：summary edits do not invalidate body-owned state；rp-maintenance 旧来源兼容 |
| I08 | rp-independent：manual extraction works in paused inline without changing automatic settings |
| I09、I11 | rp-independent-acceptance：migration preserves legacy baseline, prompt and paused choice, and is idempotent |
| I10、R08、R09、R10 | rp-independent-acceptance：scoped backup restore and clear preserve unrelated data and reject another chat；rp-backup 任务暂停/旧包兼容 |
| S01、S02、S04 | rp-independent：local state rules preserve omissions and guard explicit transitions；rp-independent-acceptance：same-looking temporary states |
| S03、S04、S05、S06 | rp-independent-acceptance：loans, terminal plans and one-way relationships use explicit transitions |
| S07、S13 | rp-independent-acceptance：claims and dreams do not set scene；directed visibility；提示词约束待转告/私密信息 |
| S08、S09 | rp-independent-acceptance：two real consumes, callback retry, manual replacement and user correction |
| S10 | rp-independent-acceptance：homonymous explicit new people remain distinct；same-looking temporary states |
| S11 | rp-maintenance、rp-extraction、rp-protocol-tolerance：关联失败原子性/局部非法项；target/present 关联新建对象 |
| S12 | rp-independent-acceptance：missing/truncated output stays failed; a late complete empty block advances progress |
| R01、R02 | rp-flow：编辑/切聊天/修订/迟到结果；rp-feedback：host swipe metadata replacement and reload |
| R03、R04 | rp-independent-acceptance：earlier edit invalidates later absolute assertions while relative deltas replay safely |
| R05、R06 | rp-independent：failed save cannot alter RP or other data；rp-independent-acceptance：RP failure does not block summary |
| R07 | rp-independent-acceptance：未知版本、损坏字段/引用、迁移幂等；legacy same-floor replay order |
| R09 | rp-independent-acceptance：cancelled request cannot append job status into restored state |
| P01、P02、P03、P08 | rp-independent：all-entity relevance and indivisible budgets；实际注入的小总预算阻断 |
| P06 | recall-feedback：cached RP hit is revalidated after correction and disabling RP injection |
| P07 | rp-independent-acceptance：returning a loan updates current ownership and typed history without editing summaries |
| U01、U02 | offline/rp-independent-ui：新建/逐项结束/恢复；offline/rp-auto-ui：失败/旧表单/焦点/输入/预设；check-rp-state-v2 返回滚动 |
| U03 | rp-independent-acceptance：paged history、legacy historical snapshots；offline/rp-auto-ui 只读快照 |
| U04 | check-rp-story-sheet：360/390/430px DOM/CSS 约束、44px 按钮、长文本、20 条分页，不是浏览器布局实测 |

关系、梦境、在场等采用受控模型输出，验证规则和结算，不证明真实模型每次语义都正确。

### 运行方法

Windows / Node v24.14.0，仓库根目录：

~~~powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/*.test.mjs
git -c core.safecrlf=false diff --check
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/offline/rp-auto-ui.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/offline/rp-independent-ui.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/offline/rp-display.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/offline/rp-archive.mjs
~~~

UI 依赖 linkedom，可让 BAKEMONO_TEST_LINKEDOM 指向已有 esm/index.js，无需在酒馆安装。rp-display 另需 BAKEMONO_TEST_TAVERN 指向只读宿主，使用其实际格式化/正则与 Showdown，消毒及 DOM 为模拟。

本次另运行任务工作区 .ui-validation 的 check-runtime-syntax，以及 check、check-core、check-story、check-vector-config、check-recall-ui、check-rp-state、check-rp-state-v2、check-rp-feedback、check-rp-overview-v3、check-summary-source、check-rp-story-sheet、check-rp-protocol。旧导入/摘要头部测试改为当前合同，导航/安全文本/返回/窄屏断言保留。

#### 合成长档测量

单次离线结果，不是手机指标，不承诺固定耗时：

| 数据 | 操作 | 实测 |
|---|---|---|
| 1000 条来源事实、150 人物 | 来源核对与完整重放 | 2128.9 ms |
| 同上 | 编译简报 / 取一页历史 | 6.4 / 9.5 ms |
| 同上 | 序列化后校验与恢复 | 295.3 ms |
| 增加 1 条事实后 | 再次完整重放 | 1926.5 ms |
| 1001 条事实 | 序列化大小 | 438964 bytes |
| 205 个实体 | 20 次离线总览渲染 | 86.0 ms |

当前不是增量重放。大档有主线程耗时风险；检查点/增量缓存留 P1，分页不等于重放优化。

### 手动路径

1. 升级前备份聊天；菜单 → 剧情状态 → 从当前启用，无需配置表格或自动摘要。
2. 默认随正文；维护设置选择独立调用、暂停、延迟与正文过滤。手动“重新提取最新正文”会提示额外调用。
3. 点对象进详情修改或逐项结束状态；“添加记录”主动新建。问题看历史与处理进度，无需每楼审批。
4. 提示词设置载入新版默认再应用，或继续使用自定义预设。
5. 状态维护设置内备份/恢复，先下载副本，只操作本聊天 RP；恢复后主动启用，不自动补跑。

### 未包含

P1：历史范围补录/重建、精细依赖与摘要局部联动、丰富人物/私密认知/自定义历法、大账本增量缓存。未测试浏览器/手机真实布局、模型准确率或后台联网可靠性；页面冻结不能保证继续联网。
