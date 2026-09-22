# 剧情剪辑台开发交接

## 接手约定

- 当前版本 1.8.3，分支 main，远端 hey8v0/SillyTavern-BakemonoMemory。先查 Git，不从旧对话推断。
- 不覆盖用户修改、不强推；提交推送以当次授权为准。不默认打开浏览器、调用模型或同步本机酒馆。
- 当前源码在本目录；任务工作区与酒馆安装目录不是源码。本次离线依赖在任务工作区 .ui-validation，Node 24，无新增运行框架。
- 使用见 README；验收映射、命令及余项见 TESTING_v1.7.0.md；实际提示词见 RP_EVENTS_PROMPT.md。本文不追加流水账，历史查 Git。

## 产品与数据边界

- 摘要、自由表格、RP 独立。旧 chronicle 仍服务表格/摘要，不能删除或当 RP 真相源。
- 菜单直接进入“剧情状态”；表格/向量在“自动与数据 → 记忆结构”。总览点对象进详情；全部记录按类型分组，每页 20 项。目录独立样式，测试 tests/offline/rp-directory-style.mjs 需 BAKEMONO_TEST_LINKEDOM 和 BAKEMONO_TEST_CSSTREE。
- RP 空白启用，从当前开始；不导入旧表、不从摘要头部生成新事实。旧 RP 基线保留。
- 自动方式仅 inline / independent，默认 inline 无额外请求；独立模式须主动选择。手动最新正文提取不改变自动方式；时机、过滤、注入独立。
- schema 1、规则 3、协议 2、来源策略 2、规范化 1 分开管理。旧规则/来源保留，迁移留 upgradeSnapshot，未知版本不改写。
- 模型输出局部 events，自动收录，用户事后纠错。省略不清空，状态逐项修订/结束，借还/销毁/恢复/约定重开有明确动作。只有 Facts 改状态。
- 随正文 rpEvents 仅显示隐藏，原文/编辑/导出保留。宿主显示正则与 DOM 补做配合，不覆盖用户正则。
- 提示词版本 3，协议仍为 2。仅精确匹配的旧内置默认自动升级；自定义及预设保留。已应用指令与表单草稿分离，预设跨聊天共享。

## 代码入口

| 职责 | 入口 |
|---|---|
| 宿主装配/事件 | index.js；前向依赖使用惰性回调 |
| RP 生命周期/事务 | src/rp-core/service.js、transaction.js、policy.js |
| 来源/自动提取 | chat-sources.js、extraction-flow.js、extraction.js |
| 身份/分组/规则/重放 | identity.js、groups.js、domain.js、local-events.js、ledger.js |
| 状态注入/短引用/说法 | rp-core/context.js、model-references.js、current-information.js；features/injection-service.js |
| 状态界面/提示词 | features/rp-state-*.js；rp-core/prompt.js、prompt-library.js |
| 全局设置/保存 | src/core/*settings*、global-config-save.js、persistence.js |
| 聊天恢复/备份 | summary-recovery-journal.js；rp-core/backup.js；memory/backup-package.js |
| 摘要/表格/召回 | features/summary-*.js、table-*.js、vector-*.js；src/vector |
| 填表校验/错误 | tables/operation-parser.js、operation-feedback.js；table-memory-model 预检与应用共用暂存校验；所有草稿应用须传 raw，失败保留原文 |
| 本轮注入预览 | features/overview-token-manifest.js、injection-preview.js；只读当前配置；body 顶层 dialog，不手工 inert 工作台 |
| 设置保存反馈 | ui/page-settings.js；顶部仅保存当前设置页，切页草稿不自动应用；全局回读与聊天保存均完成才报成功 |
| 模型候选/选择 | vector/provider-config.js；ui/model-picker.js；千帆个人版为有日期的官方候选快照，非账户鉴权结果；接口变化清理本页候选 |

## 不能破坏的保护

- 宿主实时元数据用 getter；ensureGlobalSettings() 不返回对象，初始化后从 extension_settings[STORAGE_KEY] 取值。
- 后台不读隐藏表单、不把运行状态升为全局配置；合法 false/0/空字符串不是缺失值。全局保存须回读核验，聊天保存不等于全局成功。
- 注入预览、计数和发送使用实时有效来源，generatedMemory 只是缓存；“已选入”不等于已发送。向量 lastIndexError 只属本聊天，失败后由手动刷新恢复；不随后台事件重试刷屏。
- RP 串行事务检查聊天、来源、分支和修订。失败只回滚本次 RP，不能覆盖较新状态或摘要。普通 RP 错误不阻断同聊天摘要；切聊天停止旧流程。
- 自动同源只处理一次；手动重提取替代模型旧批次，保留审计与人工纠错。早期来源变动后，后续绝对状态保守停用，不机械沿用旧数字。
- RP 简报/维护槽共享字符预算；仅相关现状和短引用，不发送完整投影/近期事件 JSON。短引用由原身份确定，类型/所属状态校验后解码，不更换存档 ID；新对象不用猜短引用。独立提取先保正文与现状，再按余额加入旧对话/设定。维护提示词超可用预算时暂停。
- RP 不参与向量/BM25 召回，vector/source-policy 清理旧 RP 索引与命中，不删账本。剧情页预览在面板内，不叠加遮挡宿主的浮层；全部记录分页保留。
- RP 恢复/清空只处理 RP 及其缓存；先确认、下载副本，绑定聊天/修订，恢复后停用并暂停。深层校验字段/引用/版本；旧包缺 RP 不清空现有 RP。
- 恢复副本只在新载入核对到修订后清理，focus/切页不算落盘证明；轻量恢复不能丢正式摘要、账本、表格与决定。
- 日志/诊断白名单，不加正文、密钥、接口地址或原始模型输出。必要状态保持可枚举、可序列化。
- 摘要有效性/覆盖统一走 memory/summary-provenance；持久覆盖数组不是当前事实。新摘要 UUID 与 contentHash 分离，provenance 固定实际输入，编辑输出不能重绑来源。旧档迁移须预览/备份，不放行不明来源；验收见 TESTING_SUMMARY_COVERAGE.md。

## 发布与后续

- 全量 tests、运行模块语法、CSS、离线 DOM、显示过滤、备份、diff 检查；紧凑状态验收见 CHANGELOG_RP_1.8.0.md。固定模型输出测试不证明真实语义准确率。
- 同步 manifest、帮助页、README 版本；不提交本机依赖、截图或临时数据。
- 获授权后 fetch、核对 main、普通 push 并比对 SHA；网络单次使用 git -c http.sslVerify=true，不改全局配置。
- P1：历史范围重建、精细依赖纠错、丰富人物/历法、大账本增量缓存。RP 当前仍完整重放。
- 用户实机检查手机布局、宿主保存/后台冻结、异步组件、重 roll、流式协议隐藏；离线不等于手机实测。
