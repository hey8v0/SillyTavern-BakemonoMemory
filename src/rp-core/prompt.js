export const RP_PROMPT_VERSION = 3;
export const RP_EVENT_GUIDE = `## 剧情状态 · 变化记录
模型判断变化，插件自动保存。只记录本轮正文明确成立的现状；首次补齐正文已交代的时间、场景、人物和关系。设定、摘要、已有状态参考只帮助理解，不制造新事件。

正文结束后，在摘要外输出一个完整块；独立提取只输出此块。无需摘录、置信度、解释或代码围栏。
<rpEvents>{"version":2,"events":[{"action":"person_moved","data":{"id":"林晚","location":"书店"}}]}</rpEvents>
无变化：<rpEvents>{"version":2,"events":[]}</rpEvents>

只写变化，省略=保持，未提及≠结束；不重复整份状态。默认 track:"facts"。引用已有对象优先复制短引用 @rp…；人物状态与借用分别用其 stateId、loanId。新对象用姓名/名称作 id；明确同名新对象另起本批 id 并登记。未列出的旧对象可用唯一名称，不猜短引用。

事实 action(data)：
- clock_set(date 或 description)：有明确日期用 YYYY-MM-DD[THH:mm]；只有“三天后傍晚”就记 description，不猜生日或公历。
- location_created(id,name,parent?)；scene_recorded(location,present[])：只列明确在场者，不含被提及、远程通话者。
- person_registered(id,name)；person_moved(id,location)；person_renamed(id,name)。
- person_state_started(id,stateId,description,visibility?,target?)：持续伤势/情绪。visibility 为 observable/private/author；内心及作者信息不共享给其他角色。
- person_state_revised(id,stateId,description) 修订同一状态；person_state_ended(id,stateId) 明确结束。缓解不等于痊愈。
- person_trait_recorded(id,trait) / person_trait_removed(id,trait)：仅稳定特征。
- relationship_recorded(id,from,to,kind,mutual?) 记录已成立关系；relationship_established 同字段用于本轮建立；relationship_ended(id) 明确结束。表白≠交往，争吵≠分手。
- plan_proposed(id,title,participants[],due?/dueDescription?)；promise_created 同字段；plan_accepted / plan_completed / plan_cancelled / plan_failed / plan_reopened(id)；plan_modified(id,title?/due?/dueDescription?)。
- item_registered(id,name,owner?,holder?,location?,quantity?)；所有者、持有人、存放地分别记录，未知数量用 null。
- item_lent(id,from,to,loanId) 借用；item_returned(id,loanId) 归还；item_gifted(id,from,to) 转移所有权。
- item_placed(id,from,location)；item_consumed(id,quantity) 本次消耗；item_quantity_changed(id,delta)。
- item_damaged / item_destroyed / item_restored(id)：损坏、销毁和明确恢复。

声称、否认、传闻只记录说法，不改变事实：
{"track":"claims","data":{"speaker":"林晚","subject":"沈砚","description":"声称两人没有交往","heardBy":["沈砚"]}}
怀疑/推测改用 track:"observations"。heardBy 仅填明确知情者，未知可省略，不能推成所有人知道。“我没事”不是伤势恢复，计划赠送不是已经赠送。梦境、回忆、假设不写当前事实。

优先时间地点、在场者、持续状态、关系、重要物品和未完成约定；不记录每个表情动作。不确定就不改已有事实。同次操作只写一次；真实多次消耗逐项写。必须共同成立的操作用相同 group。保持简短，闭合 JSON 和标签。`;
