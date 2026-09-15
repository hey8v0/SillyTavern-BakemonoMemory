# 剧情剪辑台开发交接

## 当前状态与工作约定

- 当前版本 `1.7.0-beta.3`，开发与发布分支为 `main`；测试分支已合入。实际提交、未提交修改和远端状态先查 Git，不从旧对话推断。
- 不打开浏览器，不同步本机酒馆；实机视觉由用户检查。后续提交、推送、切分支仍以当次用户授权为准。
- 不覆盖用户修改，不强制推送，不回退无关代码。改动先补行为回归，再跑完整检查。
- 本文只维护当前接手所需信息，不追加逐日流水账。使用说明见 [README](README.md)，版本验收与余项见 [TESTING_v1.7.0.md](TESTING_v1.7.0.md)，历史查 Git。

## 仓库与环境

- 源码：`C:\Users\22674\Documents\Codex\2026-05-17\bakemono-5-content-bakemono-details-summary\BakemonoMemory`
- 远端：[SillyTavern-BakemonoMemory](https://github.com/hey8v0/SillyTavern-BakemonoMemory)
- 当前任务目录：`C:\Users\22674\Documents\Codex\2026-08-15\c-users-22674-documents-codex-2026-3`。它不是源码仓库；离线检查依赖位于其 `.ui-validation`。
- 本机酒馆安装目录：`E:\SillyTavern\public\scripts\extensions\third-party\SillyTavern-BakemonoMemory`。仅供定位，不默认同步；若用户另行授权，同步必须包含完整 `src`，不能只复制入口文件。
- 当前检查环境：Windows / PowerShell / Node 24，无新增运行框架依赖。

## 产品与数据边界

- 常用流程：正文自带 `bakemono` 摘要 → 插件扫描 → 阶段总结 → 多次总结 → 继续压缩；Hybrid RAG 补旧剧情细节。
- “旧正文补课”存入插件记忆；“补写缺失摘要”追加回原助手楼层。两者不可混用。已有摘要模式不重复注入普通摘要，覆盖层级与失效来源决定哪些总结参与注入。
- 左上角菜单提供“剧情状态”；原表格、向量记忆保留在“自动与数据 → 记忆结构”。不把旧表数据和 RP 状态视为同一份数据库。
- 剧情状态：模型整理、插件自动收录、用户事后修改，不再要求逐条确认。旧摘要草稿的确认流程不受影响。
- 支持随正文、复用回复后处理、独立提取；只有用户选择独立模式才新增调用。保留即时／延迟一轮，延迟结果仍绑定原回复。
- 新协议 `<rpEvents>{"version":1,"state":{...},"claims":[...],"observations":[...]}</rpEvents>`；旧 `events` 兼容。摘录可省略或改写，不作为模型记录的写入门槛。
- `rpCore` 的 Facts／Claims／Observations 分开保存；只有有效 Facts 参与投影。模型可提交当前字段，插件转成带来源的账本记录；省略字段保留，非法结构、负数量、循环地点或歧义引用跳过并留原因，不转交人工队列。
- 来源绑定聊天、消息、swipe 与版本。正文和摘要可分别核对；不因原摘录措辞不同阻止收录，也不能用旧异步结果覆盖新回复。人工更正留审计，同来源重复提取不覆盖更正或复活已忽略决定。
- `rpCore` schema 为 1、规则版本为 2，仍读取规则 1；未知版本保护。旧 `chronicle` 独立保留。回退到旧插件前应保留升级前聊天副本。
- 随正文协议只在阅读区隐藏：宿主 markdownOnly 正则先处理，旧消息由 DOM 补做；匹配须兼容宿主 Markdown，不能只比原始 JSON。编辑框、提示词和聊天导出保留原始块；独立提取不追加正文。不要为了隐藏协议删掉聊天原文或覆盖用户正则。
- RP 提示词在“剧情状态 → 维护设置 → 剧情状态提示词”，支持编辑、应用、另存、覆盖、删除预设，跨聊天共用；运行时只读已应用指令。默认内容见 [RP_EVENTS_PROMPT.md](RP_EVENTS_PROMPT.md)。

## 代码入口

| 修改内容 | 入口 |
|---|---|
| 宿主生命周期、服务装配 | `index.js`；前向依赖使用惰性回调，避免初始化前访问 |
| 默认配置、全局与聊天状态 | `src/config/defaults.js`、`src/core/*settings*`、`chat-state-service.js`、`config-sync.js` |
| 保存与恢复 | `src/core/persistence.js`、`persisted-chat-state.js`、`summary-recovery-journal.js` |
| 扫描、总结、草稿、批量任务 | `src/features/scan-controller.js`、`content-block-service.js`、`summary-*.js` |
| 自动编排与生成 | `memory-orchestrator.js`、`turn-processing-controller.js`、`generation-client.js`（均在 `src/features`） |
| 注入、楼层收纳、表格 | `src/features/injection-service.js`、`archive-controller.js`、`table-*.js` |
| 向量配置、自动召回、服务 | `src/features/vector-*.js`；算法、索引、预算与缓存在 `src/vector` |
| RP 自动提取、字段协议、账本与事务 | `src/rp-core/extraction-flow.js`、`extraction.js`、`state-update.js`、`service.js`、`ledger.js`、`transaction.js` |
| RP 来源、时间、恢复、检索 | `src/rp-core/*source*.js`、`chat-sources.js`、`clock.js`、`time-views.js`、`backup.js`、`memory.js` |
| RP 界面与提示词 | `src/features/rp-state-*.js`、`rp-protocol-display.js`；`src/rp-core/prompt.js`、`prompt-library.js` |
| 模板、样式、主题、帮助 | `settings.html`、`style.css`、`src/ui`、`src/theme`、`src/features/help-guide*.js` |

入口已模块化，不再把所有业务塞回 `index.js`。沿用现有职责边界，不为减少行数做额外拆分。

## 必须保留的稳定性保护

- **实时元数据**：宿主会重新赋值 `chat_metadata`。服务通过 getter 取得当前对象，不能长期持有装配时的快照；没有可保存状态不能报成功。
- **聊天／全局分离**：聊天记忆在 `chat_metadata`，共享设置与预设在 `extension_settings`。`ensureGlobalSettings()` 只初始化、不返回对象；初始化后从 `extension_settings[STORAGE_KEY]` 读取。后台任务不读取隐藏表单，不提升整份运行状态为全局配置；开关只提交开关，合法的 `false / 0 / ""` 不当缺失值。
- **保存确认**：聊天保存返回不等于全局设置已落盘。全局配置走 `global-config-save.js` 回读核验；未核验明确提示，不把网络失败包装成保存成功。
- **恢复副本**：只在新载入状态核对到对应修订后清理；同一运行期 focus／切页不是落盘证明。配额不足可降级，但轻量恢复不能舍弃正式摘要、表格、账本及决定。
- **事务隔离**：副本验证后统一提交；聊天、来源或修订改变则拒绝旧结果。保存失败不能用旧快照覆盖较新修改。
- **可序列化状态**：保持普通可枚举数据。不要对整份 `ensureState()` 做早退缓存或将必要状态改为非枚举属性；曾导致配置无法初始化、无法保存。
- **召回**：主回复前接自动检索，失败／超时不使用旧命中；请求修订保护新结果。分档、楼层、片段都遵守去重、条数和字数预算，全文名额不是必须填满。
- **索引**：未变化片段复用，追加内容有限跟进；排除脚本、样式和配置标签。未知无标签组件无法可靠区分剧情，不擅自删除。自定义嵌入失败不偷换成本地向量；缓存隔离接口、模型和维度。
- **来源与覆盖**：删除、重 roll、正文或下层总结修改后重新检查来源。过期上层总结不能继续挡住有效下层；手动标题不能被生成标题覆盖。
- **长档与手机**：隐藏工作台不建整页 DOM，当前页按需渲染；列表分页，批量操作让出执行时间并支持取消。未实际测过手机，不把离线模拟写成实测。
- **隐私**：恢复包不增加完整正文、API 配置、密钥或向量索引；诊断只用白名单数量、版本、状态和错误分类，不输出名称、摘录、接口或原始错误。

## 界面约束

- 暖纸日间／夜间、手机优先；剧情状态先展示一个可点击总览，进入详情后再编辑，保留返回位置与焦点。
- 普通状态页不整页横向滚动，表格横向滚动仅限编辑器。触控目标至少 44px，按钮不逐字竖排。
- 说明进小 i 或手册；错误、保存结果和风险直接显示。不要重复入口、空白大卡、悬浮球或大滚动容器动画。
- 不恢复已移除的摘要卡底部“正文来源说明／管理正文来源”工具区。新预设或主题迁移不得覆盖用户自定义内容。
- RP 日常记录无人工确认；删除、清空、恢复包替换等破坏性操作仍需防误触。

## 检查与发布

在源码仓库运行（PowerShell）：

```powershell
Set-Location 'C:\Users\22674\Documents\Codex\2026-05-17\bakemono-5-content-bakemono-details-summary\BakemonoMemory'
git status --short --branch
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/*.test.mjs
git diff --check
```

- 发布基线：423 项 Node 回归、130 个运行模块语法解析、完整 CSS、14 组离线界面／存储检查通过。接线测试执行入口实际回调；协议显示测试使用宿主格式化与正则函数、真实 Showdown。具体覆盖、运行方式与测量见 [TESTING_v1.7.0.md](TESTING_v1.7.0.md)。
- 语法检查须覆盖 `index.js` 和完整 `src`，按 ES module 解析；仅查入口语法不能发现装配期错误。离线脚本位于任务目录 `.ui-validation`；仓库新增 `tests/offline/rp-auto-ui.mjs`，需 linkedom。
- 修改版本时同步 `manifest.json`、帮助页版本与 README。提交前检查暂存差异，不把截图、测试依赖或临时产物一起提交。
- 已获推送授权时，先 fetch、核对目标分支与远端，提交后普通 push 并验证 SHA。当前 Windows 网络命令使用单次 `git -c http.sslVerify=true ...`，不关闭证书验证、不改全局 Git 配置。
- 不因推送自动同步酒馆。旧文档历史可用 `git log -- DEVELOPMENT_HANDOFF.md` 查找，具体内容用 `git show <提交>:DEVELOPMENT_HANDOFF.md`。

## 未完成项与实机关注点

- 完整历史补录／撤回／重新提取差异浏览；RP 摘要与事实修订联动、RP 与旧表注入去重。
- RP 大账本当前仍完整重放；增量重放／可丢弃检查点未完成，不与旧 `chronicle` 的检查点混淆。
- 深层恢复校验、自定义历法、主动新建对象界面与更多字段编辑；详细边界统一维护在测试说明，不声称原 v1.7.0 大计划全部完成。
- 实机重点：移动端嵌套滚动、长档批量应用、重 roll／删楼后的来源与表格回退、文尾组件持续追加、协议显示隐藏、宿主保存和后台挂起。
