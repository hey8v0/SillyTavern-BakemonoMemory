# 剧情剪辑台开发交接文档

更新时间：2026-07-07

这份文档是给后续 Codex / 新窗口 / 压缩上下文后的自己看的项目记忆。先读它，再改插件。

## 一句话定位

剧情剪辑台是一个 SillyTavern 第三方扩展，用来把长篇 RP 的正文、摘要、阶段总结、多次总结、表格记忆、向量召回和楼层收纳整理成可长期使用的上下文记忆。

用户的核心诉求不是“做一个摘要按钮”，而是：

- 能在几百楼、几千楼甚至上万楼聊天里持续记住剧情。
- 能兼容用户已有的 `<bakemono>` 正文摘要正则工作流。
- 能在没有摘要的旧聊天里补课。
- 能把缺失的正文摘要补回原助手楼层，继续走用户原本的摘要流。
- 能用表格记录角色、关系、事件、设定、物品、约定、剧情指导等结构化信息。
- 能用向量召回被隐藏或被压缩掉的旧剧情，但不要爆 token。
- 手机端必须好用，因为用户主要用手机酒馆。

## 路径与仓库

- 工作区根目录：
  `C:\Users\22674\Documents\Codex\2026-05-17\bakemono-5-content-bakemono-details-summary`
- 插件源码目录：
  `C:\Users\22674\Documents\Codex\2026-05-17\bakemono-5-content-bakemono-details-summary\BakemonoMemory`
- 酒馆实际安装目录：
  `E:\SillyTavern\public\scripts\extensions\third-party\SillyTavern-BakemonoMemory`
- GitHub：
  `https://github.com/hey8v0/SillyTavern-BakemonoMemory`
- 主分支：
  `main`

用户经常说“推 github / 推一下”，通常表示：

1. 修改 `BakemonoMemory` 源码。
2. 同步到 `E:\SillyTavern\public\scripts\extensions\third-party\SillyTavern-BakemonoMemory`。
3. 跑静态检查。
4. 提交并推送到 GitHub `main`。

但如果用户没有明确要求推送，只改源码即可，最终说明“还没推”。

## 常用命令

检查仓库状态：

```powershell
git -C BakemonoMemory status --short --branch
```

检查 JS：

```powershell
node --check BakemonoMemory\index.js
```

检查 diff 空白问题：

```powershell
git -C BakemonoMemory diff --check
```

同步到酒馆安装目录：

```powershell
$src='C:\Users\22674\Documents\Codex\2026-05-17\bakemono-5-content-bakemono-details-summary\BakemonoMemory'
$dst='E:\SillyTavern\public\scripts\extensions\third-party\SillyTavern-BakemonoMemory'
foreach ($name in @('manifest.json','index.js','settings.html','style.css','DEVELOPMENT_HANDOFF.md')) {
  Copy-Item -LiteralPath (Join-Path $src $name) -Destination (Join-Path $dst $name) -Force
}
```

检查安装目录 JS：

```powershell
node --check E:\SillyTavern\public\scripts\extensions\third-party\SillyTavern-BakemonoMemory\index.js
```

提交推送：

```powershell
git -C BakemonoMemory add manifest.json index.js settings.html style.css DEVELOPMENT_HANDOFF.md
git -C BakemonoMemory commit -m "简短英文提交信息"
git -C BakemonoMemory push origin main
```

注意：`E:\SillyTavern...` 在沙盒外，复制过去通常需要提权。

## 文件结构

`manifest.json`

- SillyTavern 扩展元信息。
- 版本号在这里，用户问过为什么别人是 `0.1/0.2` 而这里一直 `1.0.0`，后来开始手动 bump。

`settings.html`

- 扩展设置面板的 DOM 模板。
- 现在 UI 比较大，很多面板都在这里。

`style.css`

- 手机抽屉、底部导航、PC 工作台、手账预览、表格、向量详情、批量摘要弹窗、内部通知等样式。
- 手机端 `<details>`、textarea、嵌套滚动问题很多，改动要保守。

`index.js`

- 主要逻辑全部在这里，是一个很大的单文件。
- 包含状态默认值、迁移、扫描、分类、摘要生成、批量任务、自动总结、楼层隐藏、注入、表格、向量、UI 渲染、事件绑定。
- 尽量不要做大重构。用户更需要稳定迭代。

`DEVELOPMENT_HANDOFF.md`

- 本文件。用于新窗口接续开发。

## 核心状态与存储

当前聊天级数据主要存在 `chat_metadata` 中的插件 key 里。

全局配置 / profile / 预设主要存在 `extension_settings` 中的插件 key 里。

重要状态概念：

- `blocks`：扫描出来的摘要或文本片段。
- `storySummaries`：普通剧情摘要 / 正文摘要。
- `stageSummaries`：阶段总结。
- `epicSummaries`：过去叫“史诗简史”，现在更倾向叫“多次总结 / 长期总览”。
- `generationPrompts`：生成提示词，包括旧正文批次摘要、补写缺失摘要、阶段总结、多次总结等。
- `scanRules`：扫描标签、排除标签、全文管线 / 标签块模式等。
- `classificationRules`：普通摘要、阶段总结、多次总结的分类关键词。
- `previewLayouts`：手账预览分段规则。
- `taskQueue`：批量摘要、补课、缺失摘要、自动处理等任务队列。
- `drafts`：待确认草稿。
- `history`：保存记录。
- `tableDatabase` / table profiles：表格框架、表格组、行数据、表格 prompt。
- `inlineGeneration`：随正文生成摘要 / 表格相关配置。
- `vectorMemory`：向量索引、召回参数、模型配置、上次召回详情。
- `autoHideRecent`：楼层自动收纳 / 只保留最近 N 楼正文。
- `autoSummaryTransactions`：自动总结事务记录，用于以后做安全回滚；当前 UI 里不展示回滚按钮，避免误触。

## 三套主要记忆工作流

### 1. 已有摘要模式 / Bakemono 摘要流

适用场景：

- 用户正文里本来就让模型输出 `<bakemono>` 摘要。
- 用户的酒馆正则会让 5 楼外只保留摘要，减少 token。
- 用户希望插件读取这些摘要，再做阶段总结 / 多次总结。

关键原则：

- 普通剧情摘要通常不重复注入，因为正文正则已经会发送摘要。
- 阶段总结和多次总结要注入长期记忆。
- 如果模型某一楼偷懒没写摘要，用“补写缺失摘要”，把摘要补回原助手楼层正文末尾。
- 补写缺失摘要输出必须是：

```html
<bakemono>
<details>
<summary>剧情摘要</summary>
...
</details>
</bakemono>
```

标题要求：

- 不要猜章节号。
- 必须保留原楼层数字。
- 允许 AI 根据正文写短标题。
- 推荐形态类似：
  `第123楼：短标题`

不要写成：

- `第x章`
- `第123楼：正文摘要` 这种死标题，用户不喜欢。

### 2. 通用旧正文补课

适用场景：

- 老聊天没有 `<bakemono>` 摘要。
- 用户中途才开始使用插件。
- 需要把 700 楼甚至更多旧正文批量压缩成插件内摘要。

关键原则：

- 旧正文补课保存到插件记忆，不写回正文。
- 它和“补写缺失摘要”不是一回事。
- 补课完成后，应提示用户切回“已有摘要模式”继续 RP，或者继续使用通用模式。
- 用户曾经困惑：“补课完了之后要怎么办？”所以 UI 文案要明确：
  旧正文补课是补过去；之后继续 RP 最好让正文恢复正常摘要流。

### 3. 补写缺失摘要

适用场景：

- 用户正在用已有摘要模式。
- 某些助手楼层缺了 `<bakemono>`。
- 用户希望补回来，继续被正则和插件扫描。

关键原则：

- 默认只处理助手楼层，不处理 user 楼层。
- 自动跳过已经含摘要标签的楼层。
- 不应该一楼一个 API 调用。大批量时必须按批处理。
- 应用草稿时会修改原助手楼层，把摘要追加到正文末尾。
- 应用很多草稿时必须分批、让 UI 有响应，避免手机卡死。

用户曾经一次扫出 360 个缺失摘要，不能生成 360 个任务逐个请求 API；要按批次生成。

## 阶段总结与多次总结

阶段总结：

- 输入普通剧情摘要。
- 输出一个更高层级的阶段总结。
- 默认提示词已经要求：
  - 标题行包含“时间跨度”。
  - 剧情长焦概括章节内容时包含时间。

多次总结：

- 过去叫“史诗简史”，用户觉得太宏大，尤其日常 RP 不合适。
- 现在统一倾向叫“多次总结 / 长期总览”。
- 用来继续压缩阶段总结，避免阶段总结无限堆积。
- 默认提示词已经改成：
  - `<summary>【多次总结·长期总览】</summary>` 或类似长期总览措辞。
  - 标题行包含“总跨度”和“时间跨度”。
  - 时间线总览按时间顺序整理并标注时间。

用户反馈过：

- 多次总结只注入一条的问题，要确认不会只取最新一条。
- 阶段总结编辑后标题被 `<summary>` 覆盖的问题，已改为手动标题优先。
- 阶段总结 / 多次总结按钮太多，所以控制台里单次和批量入口合并：点击后选择单次或批量。

## 注入逻辑

注入内容进入 `setExtensionPrompt`。

顺序原则：

1. 多次总结 / 长期总览。
2. 未被多次总结覆盖的阶段总结。
3. 是否注入普通摘要取决于模式。
4. 表格记忆按总开关和表格规则决定。
5. 向量召回作为动态补充。

已有摘要模式：

- 普通剧情摘要不重复注入，避免和正文正则重复。
- 阶段总结、多次总结应注入。

通用旧正文补课模式：

- 普通补课摘要可以注入，否则隐藏旧楼后会失忆。
- 被阶段总结覆盖后，普通补课摘要应退出注入。

表格：

- 用户要求“表格内容注入上下文”有总开关。
- 表格内容不要同时在长期记忆注入和随正文填表 prompt 中重复塞两遍。
- 随正文填表需要携带当前表格数据，但要注意 token。

向量：

- 不应召回已经在长期记忆里注入的阶段总结 / 多次总结，避免重复。
- 默认不索引或不召回 user 楼层，因为用户认为 user 楼层通常意义不大。

## 向量记忆设计

目标：

- 让被隐藏、被压缩、离当前窗口很远的旧剧情可以按需召回。
- 能在上万楼聊天中继续工作。
- 避免召回太多造成 token 爆炸。

当前概念：

- 建索引：对每楼正文 / 摘要建立记录。
- 查询重写：把当前输入和最近剧情改写成多个检索线索。
- Embedding 检索：用向量相似度找候选。
- Rerank 分档：决定哪些发全文、哪些发摘要。
- 最终注入：按预算输出到上下文。

用户喜欢的召回详情布局：

- 上次召回详情。
- 查询重写：显示“检索意图 + 多条线索”。
- Embedding 检索：候选列表。
- Rerank 分档：全文档 / 摘要档。
- 最终注入：最终进入上下文的内容。

注意：

- 用户明确说不要照抄别人的插件 UI / 文案。
- 可以学习逻辑，但外观和措辞要有自己的风格。
- 当前“查询重写”曾出现问题：
  - Qwen/Qwen3.5-27B 输出英文规则残渣。
  - 输出 `Clue 1`、`Analyze the Request`、`Current context` 之类提示词内容。
  - 只输出一条线索。
- 已经做过过滤，但仍要观察。

推荐查询重写输出结构：

```text
意图：一句中文，概括当前需要找什么旧记忆
线索1：具体旧剧情检索问题
线索2：具体旧剧情检索问题
线索3：具体旧剧情检索问题
线索4：具体旧剧情检索问题
线索5：具体旧剧情检索问题
```

不要让模型输出：

- 英文系统规则。
- 分析过程。
- “Thinking Process”。
- “Analyze the Request”。
- 当前 prompt 原文。

向量参数用户经常问含义，应在 UI 文案里简明解释：

- 重排候选数：embedding 先取多少条进入 rerank。
- 向量相似阈值：低于这个连摘要档都不要。
- 重排全文阈值：高于这个可发全文。
- 召回全文数：最多几条全文。
- 最终召回条数：全文 + 摘要总数。
- 起召 AI 楼数：聊天太短时不召回。
- 可见最近窗口楼数：仍在可见上下文里的内容不召回。

用户困惑过“最近窗口”：

- 它不是酒馆实际渲染条数。
- 更合理的逻辑应该考虑隐藏楼层和实际可见 / 已发送内容。
- 如果楼层已隐藏，就不该因为楼号在最近 N 内直接跳过。

## 表格记忆

目标：

- 支持用户自定义多张表。
- 记录结构化信息：角色特征、人物关系、事件摘要、世界设定、重要物品、约定、大总结、剧情指导等。
- 表格内容可以注入上下文。
- AI 可以随正文输出 `<tableEdit>`，插件解析并更新表格。

重要规则：

- 只读表：适合“剧情指导”，用户手写，只读，禁止 AI 修改。
- 可写表：AI 可以插入 / 修改 / 删除。
- 表格 profile 分全局 / 角色 / 当前聊天。
- 切换 profile 要提示当前数据不会丢，只是切换本聊天使用的表格组。

表格操作格式：

```text
insertRow(tableIndex, {"0":"值"})
updateRow(tableIndex, rowIndex, {"列号":"新值"})
deleteRow(tableIndex, rowIndex)
```

注意：

- 曾经单引号导致解析失败，例如字符串里出现 `'有趣'`。
- 解析器最好宽容，但 prompt 也要要求字符串里不要出现双引号和奇怪引号。
- 随正文填表曾经重复读取两遍，导致重复行。
- 删除聊天楼层后表格不会自动回退，这是一个设计难点。
- 用户曾经提出“表格跟随聊天记录走”，但这会和插件 DB 模式冲突，改动要非常谨慎。

UI 偏好：

- 表格内容要在表格页首屏。
- 表格框架、表格组、导入、提示词等配置应折叠或放后面。
- 点开表格编辑区后，要和原始预览表格有明显视觉区别。
- 删除行要二次确认，或有撤销重做。

## 楼层收纳 / 隐藏楼层

用户想要类似隐藏助手的“自动只保留最近 N 楼正文”。

核心诉求：

- 不是点一次隐藏一次。
- 开启后每次新消息 / 删除 / reroll 后都应动态整理。
- 删除最新楼层时，之前自动隐藏的楼层应按规则恢复。
- UI 不要太复杂。

用户要求楼层收纳 UI 保留三个核心：

1. 启动自动收纳开关。
2. 只保留最近正文楼数。
3. 恢复自动收纳的楼。

其他如“应用自动收纳”“立即整理一次”不需要长期露出；开启时可以自动执行一次。

注意：

- 自定义楼层范围隐藏 / 恢复仍有用，可以保留。
- “高级”两个字用户不喜欢，楼层收纳是常用功能。
- 控制台隐藏楼层数字最好能读取酒馆实际隐藏楼层，而不是只显示插件管理的数量。

## 自动总结

功能：

- 自动检测未总结摘要数量。
- 自动生成阶段总结草稿或自动保存。
- 可自动隐藏已覆盖楼层，保留最近 N 楼上下文。

风险：

- 用户曾经遇到：
  1. roll 了两层。
  2. 自动总结刚好触发。
  3. 自动隐藏 50-96 楼。
  4. 用户想删除 96 楼重 roll，担心状态不会回退。

后来方向：

- 增加 `autoSummaryTransactions` 事务记录。
- 记录自动总结覆盖范围、生成的总结、隐藏范围。
- UI 里不要放显眼“自动总结回滚”，因为用户觉得待确认里的回滚容易误触。
- 如果未来做回滚，应做成低误触的历史 / 撤销中心。

## UI / UX 原则

用户明确偏好：

- 手机端优先。用户主要在手机酒馆测试。
- PC 端也要清楚，但不要为了 PC 大改把手机弄坏。
- 不要悬浮球。
- 入口：
  - 魔法棒菜单。
  - 可选顶部导航栏按钮。
  - 扩展设置里有开关控制是否显示顶部按钮。
- 颜色跟随 SillyTavern 主题。
- UI 要有手账感，但不要乱、不要堆。
- 尽量使用 Font Awesome / 高级图标，不要用 emoji 当 UI 主图标。
- 危险操作必须二次确认。
- 重要按钮点击后要有反馈：toast、内部通知、loading、禁用态、进度。
- 不要外部浏览器 alert 风格，尽量用插件内部提示框。
- 长表单在手机端默认折叠。
- 相同功能不要出现两套入口。
- 标题随当前模块变化，比如“表格”“向量记忆”“总结”。

用户不喜欢：

- “工具面板感”。
- 入口藏太深。
- 按钮太多。
- 同一个设置在多个地方重复。
- 保存按钮其实是另存为，导致一堆同名配置。
- 载入按钮多余：选择配置后应直接切换，必要时再确认使用。
- 史诗简史这个名字过于宏大。
- 小 i 提示一直露在标题上；折叠时应隐藏，展开后再出现。
- 小 i 的外圈和阴影太突出。
- UI 动效导致闪屏。

## 手机端滚动与闪屏问题

这是长期重点。

已出现过的问题：

- 总结页点开一个摘要能滑，关掉再点另一个摘要就滑不动。
- 摘要少的时候更容易复现，摘要多的时候反而不明显。
- SillyTavern 和 Tauri Tavern 都能复现。
- 生成提示词编辑页也出现过类似问题。
- 点开记忆库 / 摘要详情会闪屏。

可能原因：

- `<details>` 展开 / 收起触发高度重排。
- 父容器和子容器都有 `overflow`。
- 移动端 WebView 对嵌套滚动和 textarea 很敏感。
- CSS 动画 / transform / backdrop-filter 可能加重闪屏。

已有缓解：

- `stabilizeMobileWorkbenchScroll(expectedTab)`。
- 展开 details 后延迟修复滚动容器高度和 overflow。
- 减少部分动效。

以后改 UI 时要注意：

- 不要给大滚动容器随便加 transform。
- 不要让很多卡片同时动画。
- details 展开后要确保外层仍能滚动。
- textarea 高度要有限制，内部可滚动。
- 手机端改动必须让用户实机验证。

## 批量任务与性能

用户的典型规模：

- 700 多楼聊天。
- 360 个缺失摘要。
- 未来目标上万楼。

性能要求：

- 不要一楼一个 API 调用。
- 不要一次性渲染几百张大卡。
- 不要一次性修改几百条楼层正文导致酒馆卡死。
- 批量应用应分批、可取消、可清理卡住任务。
- 任务队列里生成中的旧任务必须能解除卡住。

用户遇到过：

- 360 个补写缺失摘要生成 360 个任务。
- 一键应用 17 个摘要就让酒馆卡住。
- 旧的“旧正文补课 14/15”任务卡在队列里，取消不了。

后续如果改任务队列：

- 要有“清理卡住任务”。
- 运行中任务也应有超时 / 强制移除。
- 批量摘要任务应按批记录，而不是每楼一个任务。
- UI 应清楚显示正在做什么、进度多少、能否取消。

## 提示词体系

现在生成提示词区应该至少包含：

- 旧正文批次摘要提示词。
- 补写缺失摘要提示词。
- 阶段总结提示词。
- 多次总结提示词。
- 自动记忆正文摘要提示词。
- 表格修改提示词。
- 随正文摘要提示词。
- 随正文表格提示词。
- 查询重写提示词。

用户希望：

- 都能自定义。
- 能保存预设。
- 能切换预设。
- 手机端不要一口气展开所有文本框。

注意区分：

旧正文批次摘要：

- 用于没有摘要的旧正文。
- 结果进入插件记忆。
- 不写回正文。

补写缺失摘要：

- 用于已有摘要模式里漏掉摘要的助手楼层。
- 结果追加回原助手楼层正文。
- 必须输出 `<bakemono><details><summary>剧情摘要</summary>...`。

自动记忆正文摘要：

- 回复后处理。
- 如果保存到插件草稿，可用 `<summaryDraft>`。
- 如果要写回正文，就必须改成 `<bakemono>`。
- 当前用户问过这点，要保持文案明确。

## 用户个人工作流记忆

用户常用方式：

1. 让正文模型每楼输出 `<bakemono>` 摘要。
2. 酒馆正则负责 5 楼外只保留摘要。
3. 插件扫描摘要。
4. 累积到一定数量后生成阶段总结。
5. 隐藏被覆盖楼层。
6. 阶段总结多了后生成多次总结。
7. 向量召回补足旧剧情细节。
8. 表格记录结构化信息。

用户也会：

- 中途打开旧档补课。
- reroll / 删除楼层。
- 手机端频繁测试。
- 自己推 GitHub 或让 Codex 推。
- 在不同聊天之间切换，希望配置全局保留。

## 明确不要做的事

- 不要 `git reset --hard`。
- 不要回退用户没让回退的改动。
- 不要一次性重写整个插件。
- 不要强行打开浏览器测试，用户经常说酒馆她自己看。
- 不要把别人插件的文案 / UI 直接抄过来。
- 不要把危险操作做成一键无确认。
- 不要在移动端放太多常驻大按钮。
- 不要把摘要标题变回固定 `剧集终了·点击回看`。
- 不要让普通摘要在已有摘要模式里重复注入。
- 不要让表格内容在两个注入位置重复出现。

## GitHub 提交与更新日志索引

说明：
- 本地可以精确查到每个 commit 的时间、标题和改动文件。
- “每次 push 到 GitHub 的批次”不一定能从本地还原，因为一次 push 可能包含多个 commit。
- 因此这里按 commit 和日期整理成更新日志索引，方便新窗口快速理解项目演化。

截至 2026-07-07，`main` / `origin/main` 已有 68 个提交。最近一次远端提交为：

- `3b58735` / 2026-07-07 / `Fix prompt editor mobile scroll`

### 2026-05-17：插件从零搭建

- `793625b Initial Bakemono Memory extension`
  - 新增插件基本结构：`manifest.json`、`index.js`、`settings.html`、`style.css`、`README.md`。
  - 初版目标是扫描 `<bakemono>` 摘要块、生成更高层级总结、保存到聊天元数据并注入上下文。
  - 初版代码量很大，基本奠定“剧情剪辑台”的核心功能。
- `4c85ebc Initial commit`
  - 补了远端仓库初始 README。
- `19f217a Merge remote main`
  - 合并远端 main。
- `570dfba Fix settings.html path`
  - 修复 SillyTavern 加载 `settings.html` 的路径问题。
- `8410aab Improve backfill ordering and presets`
  - 改进旧正文补课 / backfill 的排序。
  - 添加或调整预设逻辑。
- `0d9ee51 Refresh scanned blocks and enrich generic prompts`
  - 扫描规则切换后刷新已扫描片段，避免旧扫描结果残留。
  - 扩充通用提示词，让没有 `<bakemono>` 的正文也能压缩。

### 2026-05-18：工作流、生成范围和手机 UI 初步成型

- `9519a08 Add generic backfill workflow`
  - 新增通用旧正文补课工作流。
  - 加入对应 UI 和样式。
- `981fa2b Simplify workflow overview`
  - 简化总览页工作流说明。
  - 让新用户更容易理解当前模式。
- `5633cef Add target selection and auto commit hide mode`
  - 生成阶段总结时加入目标选择。
  - 加入自动保存并隐藏已覆盖楼层的模式。
- `dd17db4 Confirm generation ranges and configurable auto hide`
  - 生成总结前弹出范围确认。
  - 自动隐藏保留楼层数变成可配置。
- `c148c65 Use custom range dialog for generation`
  - 把生成范围从固定面板迁移到弹窗。
  - 改进移动端范围选择体验。
- `270b480 Improve target dialog and mobile nav state`
  - 修复范围弹窗位置和底部导航选中态。
- `4c35a99 Refine mobile dialog and nav active state`
  - 继续微调手机端弹窗和导航状态。
- `bcf3fdb Simplify range controls and add mobile folds`
  - 移除总览固定“生成范围”区域。
  - 手机端加入折叠布局，长表单默认收起。

### 2026-05-19 至 2026-05-20：配置预设和自定义 API

- `57e65a5 Split config presets by section`
  - 配置预设拆分为不同区域保存。
  - 解决切换工作流导致扫描过滤、自动总结等配置被重置的问题。
- `462ac0d Add custom API model presets`
  - 添加自定义 OpenAI-compatible API 的模型配置预设。
  - 包括模型名、接口地址、密钥、流式选项等。
  - 为“不用酒馆主 API”的用户提供基础配置保存。

### 2026-06-25：向量记忆和表格数据库大功能加入

- `7c30737 add vector memory and turn context options`
  - 新增向量记忆：embedding、召回、最近上下文选项。
  - 新增回复后处理时携带角色卡 / 世界书等上下文选项。
  - 这是插件从“摘要总结器”变成“长期记忆系统”的关键提交。
- `a9199a9 add table schema scopes`
  - 表格框架支持全局 / 角色 / 当前聊天作用域。
  - 解决切换聊天后表格框架丢失的问题。
- `1130082 expand table inline and vector memory flows`
  - 扩展随正文输出表格、表格自动处理和向量记忆流程。
  - 引入 `<tableEdit>` 等解析流程。
- `c3e4ba7 Fix table row add interaction`
  - 修复数据行“新增一行”无效或折叠面板自动收起的问题。

### 2026-06-26：表格编辑修复、导航改造、多次总结概念出现

- `e443623 Fix table editing and vector model controls`
  - 修复表格编辑和向量模型控制项。
  - 涉及拉取模型、保存配置等交互。
- `d10e429 Fix table field editing persistence`
  - 修复字段提示词新增 / 删除字段不生效的问题。
- `c32e493 Refine workbench navigation and table auto apply`
  - 重构左侧模块导航。
  - 表格修改草稿支持自动应用。
  - 移除部分重复设置入口。
- `ffee200 Polish mobile hint popovers`
  - 调整手机端小 i 提示气泡。
  - 目标是折叠时隐藏、展开时显示，减少遮挡。
- `29d9e28 Generalize epic summaries into multi summaries`
  - 把“史诗简史”泛化为“多次总结 / 长期总览”。
  - 解决日常 RP 中“史诗”命名太宏大的问题。

### 2026-06-27：配置逻辑、表格安全、表格 UI 和去重

- `a7c8f5d Simplify global configuration presets`
  - 简化全局配置预设逻辑。
  - 减少“保存”和“覆盖”重复、同名配置堆积等问题。
- `a84ce05 Improve table capture and undo safety`
  - 改进表格随正文捕获。
  - 添加删除行二次确认或撤销安全相关逻辑。
- `4b14925 Prioritize table content workflow`
  - 表格页面把表格内容放到更靠前位置。
  - 表格框架 / 表格组 / 导入等配置折叠到后面。
- `a5c4e0d Fix table capture hints and dedupe`
  - 修复表格随正文解析重复读取两遍的问题。
  - 改进捕获提示。
- `2fce145 Fix table info hint popover`
  - 修复表格页面小 i 提示位置。
- `8cdd008 Avoid duplicate inline table context`
  - 避免随正文填表提示词里重复携带表格上下文。
- `07da0e0 Simplify table context controls`
  - 删除字段级“注入上下文 / 注入上限”等重复控制。
  - 让表格上下文注入改为更集中的控制。

### 2026-06-28：楼层收纳、顶部入口

- `16944ba Add persistent floor archiving and vector limits`
  - 加入持续楼层收纳 / 自动只保留最近正文楼数。
  - 向量记忆增加限制项，避免过量召回。
- `9f852d9 Fix persistent floor archive balancing`
  - 修复删除 / reroll 后自动收纳楼层不恢复的问题。
  - 让“只保留最近 N 楼”更接近隐藏助手逻辑。
- `74b4aa4 Simplify auto archive controls`
  - 楼层收纳 UI 简化为常用项。
  - 用户不喜欢“高级”字样，也不想看到太多按钮。
- `7557462 Add optional top navigation entry`
  - 扩展设置里新增开关：是否在顶部导航栏显示剧情剪辑台按钮。
  - 保留魔法棒入口，顶部入口可选，避免和主题美化冲突。

### 2026-06-29 至 2026-06-30：PC UI 尝试与 toast 修复，向量召回重做起点

- `38cb913 Polish desktop UI and localize labels`
  - 尝试优化 PC 端布局。
  - UI 文案全中文化。
  - 注意：用户后来觉得 PC 重构方向不完全合适，后续没有把它作为最终方向继续大改。
- `360c637 Fix toast background icon repetition`
  - 修复 SillyTavern 全局消息提示框背景被插件小 i 图标污染的问题。
- `1f7e52c Revamp vector recall and restore toast styling`
  - 开始重做向量召回逻辑。
  - 恢复/修复全局 toast 样式影响。

### 2026-07-01：向量索引和分支记忆清理

- `4b63619 Fix vector indexing and branch memory cleanup`
  - 修复向量索引建立 / 刷新。
  - 处理分支、删除、重 roll 后旧记忆污染问题。

### 2026-07-02：表格注入开关、阶段总结注入、向量拆分

- `0b16acd Add table memory injection toggle`
  - 表格记忆增加总注入开关。
  - 解决表格内容被多个位置重复注入的问题。
- `9a49e37 Refine vector recall recent-window skip`
  - 改进“内容仍在最近窗口内时跳过召回”的判断。
  - 后来发现要结合隐藏楼层和实际可见上下文继续修。
- `98338eb Preserve stage memory and add vector fallback`
  - 保证阶段总结进入长期记忆。
  - 向量召回增加 fallback。
- `8492e3c Fix stage injection and vector scoring`
  - 修复已有摘要模式下阶段总结没有注入的问题。
  - 调整向量评分逻辑。
- `e8fd14e Split vector body and summary indexes`
  - 向量索引拆成正文索引和摘要索引。
  - 目标是全文召回省略摘要块，摘要块单独召回。
- `b6b2303 Add vector query model fetching`
  - 查询重写模型支持拉取模型列表。
  - manifest 版本号开始持续递增。
- `6a7beba Fix vector recall window and memory records`
  - 修复向量最近窗口判断。
  - 让记忆库显示和索引记录更一致。

### 2026-07-03：向量召回详情持续打磨

- `4eb1455 Improve vector recall ordering and details`
  - 向量召回结果按楼层 / 时间顺序整理，避免剧情顺序错乱。
  - 添加更详细的召回过程展示。
- `aed9385 Improve vector recall details and saved summaries`
  - 修复记忆库中保存摘要显示不全或不显示的问题。
  - 继续改进“上次召回详情”。
- `ea2ef9f Consolidate vector recall details`
  - 把最近召回、索引片段预览等内容合并到“上次召回详情”思路里。
  - 减少重复面板。
- `6af3f36 Improve vector query detail display`
  - 查询重写详情显示优化。
  - 展示检索意图和多条线索。
- `ccda3fd Distinguish vector query rewrite display`
  - 避免向量查询重写展示太像其他插件。
  - 区分 UI 表达和文案结构。

### 2026-07-05：多次总结、移动滚动、查询重写、批量摘要

- `4fc7e63 Inject all active multi summaries`
  - 修复多次总结只注入一条的问题。
  - 改为注入所有活跃多次总结。
- `2c1247c Fix mobile navigation and preview scrolling`
  - 修复左侧菜单切换闪屏和记忆预览滑动问题。
- `943d1ac Stabilize mobile preview interactions`
  - 减少手机端摘要预览动效和滚动冲突。
- `340d1cf Fix sparse mobile preview scrolling`
  - 修复摘要数量少时，点开一个摘要后再点另一个会滑不动的问题。
- `f7fc9be Fix table edit parsing with apostrophes`
  - 表格解析支持字符串里的单引号场景。
  - 解决 `有趣` 这类单引号导致 `<tableEdit>` 识别失败的问题。
- `6e8b2b0 Improve vector query rewrite prompt`
  - 默认查询重写 prompt 改向“检索意图 + 多线索”结构。
- `a04c6e0 Harden vector query rewrite parsing`
  - 过滤 Qwen 等模型输出的规则残渣、英文说明、无效 Clue。
- `8cfcebb Improve vector rewrite feedback`
  - 查询重写 / 建索引 / 测试召回增加更明确反馈。
  - 便于用户知道按钮是否正在执行。
- `5d3a93d Polish batch summary workflow`
  - 加入批量摘要入口。
  - 区分旧正文补课和补写缺失摘要。
  - 解决 360 个缺失摘要不应变成 360 次 API 请求的问题。
- `21164ea Allow clearing stuck queue tasks`
  - 任务队列支持清理卡住的生成中任务。
  - 解决旧正文补课 14/15 等旧任务无法取消的问题。

### 2026-07-06：批量总结、真实隐藏楼层、提示词整理

- `8b27134 Add batch summary controls and real hidden count`
  - 控制台隐藏楼层数读取酒馆实际隐藏楼层。
  - 阶段总结 / 多次总结加入批量模式。
- `d53e4cd Refine batch summary controls`
  - 合并“生成阶段总结”和“批量阶段总结”入口。
  - 合并“生成多次总结”和“批量多次总结”入口。
  - 批量摘要面板排版优化。
- `5d3e9e7 Clarify missing summary titles`
  - 补写缺失摘要标题要求使用原楼层号，但允许 AI 根据正文生成短标题。
  - 避免乱写章节号。
- `995f215 Move batch sizing into batch flows`
  - 把旧正文每批楼数从自动总结设置移到批量流程弹窗。
  - 减少用户在多个页面来回找配置。

### 2026-07-07：自动总结事务和移动端提示词滚动

- `2ce4b5a Add auto summary rollback tracking`
  - 增加自动总结事务记录。
  - 记录自动总结覆盖范围、生成的总结、自动隐藏范围。
  - 主要用于将来处理 reroll / 删除楼层后的状态一致性。
  - 用户后来觉得“待确认里的自动总结回滚”容易误触，所以 UI 入口被隐藏或弱化。
- `3b58735 Fix prompt editor mobile scroll`
  - 添加本交接文档初版。
  - 修复生成提示词编辑页手机端滑不动。
  - 增加 `stabilizeMobileWorkbenchScroll(expectedTab)`。
  - 调整提示词页移动端滚动 CSS。
  - 阶段 / 多次默认提示词加入时间跨度要求。
  - 阶段总结编辑后优先使用用户手动标题。
  - 隐藏自动总结回滚入口。
  - 增加预览重渲染保护，缓解总结页只显示某一类摘要的问题。

### 查更精确历史的方法

如果需要看最近提交：

```powershell
git -C BakemonoMemory log --oneline -20
```

如果需要看完整提交标题：

```powershell
git -C BakemonoMemory log --reverse --date=short --pretty=format:"%h %ad %s"
```

如果需要看每次提交改了哪些文件：

```powershell
git -C BakemonoMemory log --reverse --stat --date=short --pretty=format:"commit %h %ad %s"
```

## 新窗口接续步骤

如果新开 Codex 窗口继续：

1. 先让新窗口读：
   `BakemonoMemory\DEVELOPMENT_HANDOFF.md`
2. 再跑：
   `git -C BakemonoMemory status --short --branch`
3. 如果用户说“继续刚才的”，先确认最近一条用户需求，而不是从旧上下文猜。
4. 小步修改，别大重构。
5. 改完跑：
   - `node --check BakemonoMemory\index.js`
   - `git -C BakemonoMemory diff --check`
6. 如果用户要推：
   - 同步 E:\ 安装目录。
   - 检查安装目录 `node --check`。
   - commit + push。
7. 最终回复要短，说明改了什么、检查了什么、是否推送。

## 当前最值得继续观察的问题

1. 手机端 `<details>` 展开后的滚动冻结是否彻底解决。
2. Qwen/Qwen3.5-27B 查询重写是否仍输出无效英文残渣。
3. 多次总结是否全部注入，而不是只注入一条。
4. 阶段总结编辑后的标题是否始终使用用户手动标题。
5. 大批量补写缺失摘要是否真的按批生成，不再一楼一请求。
6. 批量应用摘要是否仍会导致手机酒馆卡顿。
7. 自动楼层收纳是否能像隐藏助手一样动态维护，而不是点一次生效一次。
8. 表格随正文解析是否仍有重复读取、删除后不回退的问题。
9. 向量召回是否会召回当前可见正文、已注入阶段总结或 user 楼层。
10. 控制台隐藏楼层数是否能反映酒馆实际隐藏楼层。

## 给后续 Codex 的一句话提醒

这个插件不是普通“小工具”，它已经承担了用户长篇 RP 的记忆系统。每次改动都要优先考虑：手机端是否能用、长聊天是否会卡、token 是否重复、用户是否知道下一步该点哪里。
