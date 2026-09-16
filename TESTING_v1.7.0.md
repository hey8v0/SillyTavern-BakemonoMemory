# v1.7.0 实施与验收

## 范围与结果

起始提交 fad4a627997cc04acb4a79be572958fd026fcdcb（1.7.0-beta.3），起始工作区干净，没有覆盖用户未提交修改。执行任务书 P0-A～D，发布目标 main，版本 1.7.0。

| 范围 | 完成内容 | 主要入口 |
|---|---|---|
| P0-A | 空白启用、独立配置/正文来源、两种模式、手动单次提取、暂停/清空/RP 专属恢复 | service、policy、chat-sources、extraction-flow、rp-state-ui |
| P0-B | 局部事件、独立状态项、借还/恢复/重开、幂等、重提取替代、原子组、下游失效 | identity、extraction、groups、domain、local-events、ledger |
| P0-C | 暖纸总览，新建、变化/纠错、逐项状态、来源/差异、分页、进度/缺口 | rp-state-ui、rp-state-editors、rp-state-presentation、state-view |
| P0-D | 独立简报/维护槽、完整选材后预算、类型检索/缓存过滤、失败隔离、版本化恢复 | context、memory、injection-service、memory-orchestrator、backup |

基线 423 项通过；升级后 447 项 Node 回归通过，无跳过。新增用例执行生产 service → flow → orchestrator → injection-service 及实际 MESSAGE_SENT 回调；宿主保存与模型响应是离线替身，业务模块用生产实现。

133 个运行模块按 ES module 解析，完整 CSS 解析通过。15 组离线 UI/存储/显示检查，以及独立合成长档测量。没有打开浏览器、调用真实模型、同步本机酒馆或上传聊天。

## 兼容与行为变化

- schema 1、规则 3、协议 2、来源策略 2 分别管理；旧规则/来源继续读取，留升级前副本；旧 RP 基线、自定义提示词不删除。
- 新状态不导入旧表或摘要头部。默认 inline；旧 reply/reuse 无法等价迁移时暂停、提示重选，不自动增加调用。
- 旧 state 输入受局部保护，不能悄悄覆盖集合或越过借用/终止规则；旧记录按旧规则重放。
- 有效空事件推进进度，缺失/截断/失败不冒充成功；手动重提取不重复消耗、不覆盖人工纠错。
- 专属恢复绑定聊天，深层校验字段/引用/版本。恢复后模块关闭、任务暂停，仅清理 RP 缓存，不动其他记忆。

## 验收映射

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

## 运行方法

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

### 合成长档测量

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

## 手动路径

1. 升级前备份聊天；菜单 → 剧情状态 → 从当前启用，无需配置表格或自动摘要。
2. 默认随正文；维护设置选择独立调用、暂停、延迟与正文过滤。手动“重新提取最新正文”会提示额外调用。
3. 点对象进详情修改或逐项结束状态；“添加记录”主动新建。问题看历史与处理进度，无需每楼审批。
4. 提示词设置载入新版默认再应用，或继续使用自定义预设。
5. 状态维护设置内备份/恢复，先下载副本，只操作本聊天 RP；恢复后主动启用，不自动补跑。

## 未包含

P1：历史范围补录/重建、精细依赖与摘要局部联动、丰富人物/私密认知/自定义历法、大账本增量缓存。未测试浏览器/手机真实布局、模型准确率或后台联网可靠性；页面冻结不能保证继续联网。
