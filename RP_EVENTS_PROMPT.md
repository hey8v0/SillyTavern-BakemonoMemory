# 剧情状态提取提示词

下面是插件实际发送的固定提示词，与运行代码保持一致。

运行时还会附加当前聊天的已知人物、关系、约定、物品、地点和时钟参考（每类最多 100 项）。独立提取另附本楼正文、已识别摘要、有限的近期上下文；角色卡与命中世界书仅在对应设置开启时加入。参考资料用于理解，不当作本轮新事件的证据。

```text
## 剧情事件提取
你负责记录本轮剧情中有依据的状态与变化。完成原请求的正文或摘要后，在 bakemono 块外输出且只输出一个 rpEvents JSON 块；独立提取请求则只输出该块。不要输出代码围栏、注释、解释或未闭合 JSON。
没有需要记录的内容时输出：<rpEvents>{"version":1,"events":[]}</rpEvents>

### 最简格式
facts（事实）：track、action、data、excerpt 四项必填。action 必须选下方事实行为，不能省略或猜测。
claims（角色说法）：只需 track、data、excerpt；action 可省略，插件固定补为 claim_made。
observations（观察或推测）：只需 track、data、excerpt；action 可省略，插件固定补为 observation_recorded。
说法与观察的 data 必须有 description；speaker、subject 有明确依据时再填。省略 action 只表示记录说法或观察，不会将其变成事实。
context 默认为 current，可省略；梦境、假设、回忆必须分别标明 dream、hypothetical、flashback，且不能放在 facts。
excerpt 使用本楼中能定位的一小段连续原句，保留原词和否定词；不要复述整段，不用省略号拼句。若信息来自本楼已识别摘要，加 source:"summary"。不能引用小剧场、第四面墙、推理或操作块。
data 字段后的 ? 表示可省略，不是字段名的一部分。仅填该行为需要的字段；不要为了凑格式编造对象、数量、关系或日期。关联操作可使用相同 group 字符串，必须一起成立；无关联的操作不加 group。

以下仅是格式示例，不是真实剧情或可用证据，不要照搬人物与事件：
示例原文：2024-04-12T23:45。林晚说：“钥匙不在我这里。”沈砚猜测钥匙在书店。
<rpEvents>{"version":1,"events":[{"track":"facts","action":"clock_set","data":{"date":"2024-04-12T23:45"},"excerpt":"2024-04-12T23:45"},{"track":"claims","data":{"speaker":"林晚","description":"声称钥匙不在自己这里"},"excerpt":"钥匙不在我这里。"},{"track":"observations","data":{"speaker":"沈砚","description":"猜测钥匙在书店"},"excerpt":"沈砚猜测钥匙在书店。"}]}</rpEvents>

### 事实行为
角色说法放 claims；怀疑、推断和主观观察放 observations。回忆、梦境、假设不能写成当前事实。不得把小剧场、推理或旧操作块当作证据。
facts 行为及 data 字段：
person_registered: id,name,birthDate? 或 age?,ageDate?（登记已有的人，不是出生事件）；person_created 同义兼容；person_renamed: id,name；person_trait_recorded: id,trait；person_age_recorded: id,age,ageDate?；person_moved: id,location。
relationship_recorded: id,from,to,kind,mutual（已存在的关系，不以当前日期充当开始日期）；relationship_established 同字段（本轮新建立）；relationship_ended: id；relationship_conflict / relationship_milestone: id,description。
plan_proposed / promise_created: id,title,participants,due?；plan_accepted / plan_cancelled: id；plan_completed / plan_failed: id,outcome；plan_modified: id,title?,due?。
item_acquired: id,name,owner?,holder?,location?,quantity?；item_lent: id,from,to,loanId；item_gifted: id,from,to；item_returned: id,from,loanId；item_placed: id,from,location；item_consumed: id,quantity；item_quantity_changed: id,delta；item_damaged / item_destroyed: id。
item_registered: id,name,owner?,holder?,location?,quantity?（首次明确出现的已有物品，不代表本轮获得）；没有明确所有权、持有或数量依据时对应字段留 null。
scene_recorded: location（本轮当前场景，不默认所有人都在此）；location_created: id,name,parent?；location_reparented: id,parent；clock_set: date 或 description；clock_advanced: from,days,to。
person_state_started: id,stateId,description,expiresAt?；person_state_ended: id,stateId。
已有对象可引用下方 ID 或唯一名称。首次出现的人物、地点、已有物品可以直接引用摘录中的全名，插件自动登记身份；需补特征时才单独登记。不要编造 char_1 等未声明代号；同名对象要区分。姿势变化不等于换地点，桌上物品翻转不等于角色曾持有。
首次处理时补齐明确的当前时间、场景、人物位置与已知关系；之后只输出变化，未提及的值保持不变。摘要中的时间/当前地点/在场角色字段由插件直接读取，不必重复输出同样的事件。时间跨度不能充当当前日期；不要为填空而猜测状态。控制单轮事件数量，优先完整输出时间、场景、关系和重要变化。
表白不等于交往，争执不等于分手，道歉不等于恢复信任；romantic/partner/married 必须有双方确认且 mutual=true。
想做某事用 plan_proposed，明确承诺用 promise_created；到期不等于完成或失败。借用不转移所有权。未知数量用 null，不猜零。
日期只用明确公历 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm；相对推进必须提供当时已知的 from 与算出的 to。不确定时间不能臆造日期。
参考资料仅用于理解身份和设定，不是本轮新事件的证据。claims/observations 不改变世界状态；角色声称某事发生不等于该事属实。
输出前检查：JSON 可解析、标签成对、每条 facts 有 action、每条有 data 和连续 excerpt。尽量少而完整，先记录重要变化，不要开始写无法完整结束的事件。
```
