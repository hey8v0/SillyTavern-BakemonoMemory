# 开发交接

给接手开发的人（或新的 AI 窗口）看。用户说明在 [README](../README.md)，版本变化在 [CHANGELOG](../CHANGELOG.md)，模块边界在 [ARCHITECTURE](ARCHITECTURE.md)，剧情状态实际提示词在 [RP_EVENTS_PROMPT](RP_EVENTS_PROMPT.md)。本文只写现状与约定，历史过程查 Git。

## 1. 接手约定

- 当前版本 **1.10.0**，分支 `main`，远端 `hey8v0/SillyTavern-BakemonoMemory`。先看 `git status` / `git log`，不要从旧对话推断现状。
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
- **主题**：外观页四个选项“跟随酒馆 / 场记板 · 夜 / 白板 · 日 / 自定义”，数据结构不变（夜/日是 `themeMode: 'custom'` + 内置预设 `bakemono-slate-night` / `bakemono-whiteboard-day`）。旧的暖纸预设未改动过的副本会被清掉，改过或正在用的保留为普通配置。**跟随酒馆时背景必须不透明**：`theme-controller.js` 把宿主的 `--SmartThemeBlurTintColor` 按文字明暗叠在实心底色上，写回插件根节点；宿主主题变化由 MutationObserver 跟进。注意插件根节点自己也有 `data-bakemono-theme-mode` 属性，查询主题按钮要限定在 `.bakemono-memory-theme-mode` 里。
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

- 模拟宿主在 `scripts/ui-harness/script.js`（8 楼示例对话，其中 2 楼带摘要）与 `scripts/ui-harness/scripts/*.js`。它没有酒馆自己的样式，所以对话框里的输入框是白色的，这不代表插件有问题；`box-sizing` 已按酒馆补上。
- 剧情状态：打开 `http://127.0.0.1:8765/?rp`，最后一楼会带一段 27 条的示例 `rpEvents`（其中 1 条故意多余，用来检查“没记上”提示）；启用剧情状态后点“读取最新回复”。
- 插件会把聊天状态备份到 `localStorage`，刷新页面后旧状态会被恢复；要从头开始，先在控制台执行 `localStorage.clear()` 再刷新。
- 手机宽度（< 768px）在浏览器模拟时会自动刷新一次页面，脚本要等刷新完成再运行。
- 快照：在页面控制台执行 `(await import('/snap.js')).run('名字')`，结果写到 `scripts/ui-harness/.output/名字.json`；比较两次：`node scripts/ui-harness/tools/snapdiff.mjs a.json b.json`。它会逐页打开全部折叠栏，记录所有元素的位置与 40 余项计算样式，并关闭动画以保证可重复（同一版本连续两次应为 0 差异）。

## 7. 样式表现状与整理方法

- 现状 12,074 行（v1.8.7 为 13,443）。剩余部分多数确实生效：约 850 条规则作用于脚本生成的内容；大量是“基础样式 + 某页覆盖”的叠法，基础样式在别的页面仍生效。再大幅缩减需要按组件重写样式规范，外观会变化，应先做样板页给用户确认。
- 历史层（注释里的 “precision pass”、“v1.2.3 refinement” 等）按出现顺序叠加。新增样式时优先修改真正生效的那条规则（可在浏览器里用 CSSOM 查 `el.matches(rule.selectorText)`），不要再追加一层覆盖。
- **安全删除流程**（`scripts/ui-harness/tools/`）：
  1. `css-dedupe.mjs`：删除同选择器、同媒体条件下必然被后面覆盖的声明（不删新语法的兜底写法）。
  2. 生效分析：`css-export.mjs style.css . .output/rules.json`、`css-conditions.mjs . .output/conditional.json`，然后在模拟页面按每个断点区间各一个宽度（360、415、480、580、660、710、800、1000、1280）运行 `(await import('/cascade.js')).analyze('w宽度')`，最后 `css-remove-dead.mjs style.css .output/rules.json 输出.css .output/cascade-*.json`。只有被“无条件”规则始终压过的声明才会删除；运行时切换的类名/属性、伪类、非宽度媒体查询都算有条件；作用于脚本渲染类名的规则一律保留。
  3. 用 `CSS_OVERRIDE=输出.css` 启动模拟页面，在 1280、800、375 三个宽度拍快照，与改动前比较必须为 0 差异；有差异就先修分析工具，不要手工放行。
- 注意：样式表内容改了之后，规则序号会变，分析结果必须针对同一份样式表重新生成。
- **按页重写**（v1.10.0 起）：剧情状态的样式是一整段（注释 `Story state (剧情状态): film-slate layout`），替换了原来那段。后续页面同样整段替换该页旧规则，不在旧规则上再叠一层；替换前用快照工具确认别的页面 0 差异。

## 8. 发布流程

1. 版本号：`manifest.json`、帮助页 `settings.html` 中的 `v版本 ·`、README 顶部 `当前版本：**v版本**`（有测试核对），以及本文第 1 节。
2. 在 `CHANGELOG.md` 最上面加一节 `## v版本 · 标题`：先写用户能看懂的变化，验证细节放在 `<details><summary>验证记录</summary>` 里。
3. 跑第 6 节的常规检查。
4. 获授权后：`git -c http.sslVerify=true fetch origin`，确认本地与 `origin/main` 一致；提交；`git -c http.sslVerify=true push origin main`；用 `git ls-remote origin refs/heads/main` 比对 SHA。网络参数只在单次命令里加，不改全局配置。
5. 不提交本机依赖、截图、快照或临时数据（`scripts/ui-harness/.output/` 已忽略）。

## 9. 后续工作

- 手机实测：v1.8.8 – v1.10.0 的改动都只在模拟页面验证过，需要用户在真实酒馆（尤其手机、iOS Safari）确认；宿主保存、后台冻结、重 roll、流式协议隐藏同样需要实机。
- 新样式推广到其他页面（见第 5 节“新样式”）。用户给的每页参考：首页 Magic Bento + 编辑式仪表盘；总结 时间线 + 卡片堆叠；摘要树 嵌套时间线；记忆库 相册 + 动画列表；待确认 审阅队列；提示词检查器 文档阅读器；设置中心 系统设置列表；电脑导航 细线侧栏；手机导航 抽屉 + 分段标签。React 组件库（React Bits、Aceternity）不能直接用，只借效果、用 CSS 和原生 JS 实现。
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
