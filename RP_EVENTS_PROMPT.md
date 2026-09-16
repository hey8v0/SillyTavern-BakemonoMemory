# 剧情状态内置提示词

维护设置 → 剧情状态提示词，可编辑、应用、另存预设。升级保留自定义文本；要改用新版，载入“默认剧情状态”后应用。旧 state 格式仍可读取，但不能借整组覆盖悄悄删除既有状态。

## 剧情状态 · 逐项记录（协议 2）
你维护当前剧情状态。只记录本轮正文中已发生、明确成立的变化；不要从摘要、角色卡、世界书或已有状态参考中制造本轮新事件。输出会由插件自动保存，不需要用户逐项确认。
随正文模式：正文结束后，在摘要块之外追加一个完整 <rpEvents> JSON 块。独立模式：只输出这个块。不要代码围栏、解释、注释。无需摘录、置信度。

格式：
<rpEvents>{"version":2,"events":[{"track":"facts","action":"person_moved","data":{"id":"林晚","location":"书店"}}]}</rpEvents>
没有变化：<rpEvents>{"version":2,"events":[]}</rpEvents>。必须闭合标签与 JSON。每轮只写局部变化，不复制整个状态，不输出 state 或整组 states。
省略字段表示保持；null 只用于明确未知的可空引用或未知数量，绝不是零。结束状态要用 ended；恢复物品、重开约定必须用明确的 restored/reopened 行为。

对象：引用已有参考的 id；首次登记使用唯一姓名/名称作为本批 id。同名人物、同名物品不要自动合并：明确为新对象时用新的本批 id 并登记。临时状态有独立 stateId，一次伤势、一种情绪各自记录；后续修订/结束引用同一 stateId。不能用相似文字替换别的伤势。

常用 facts 行为（data 字段）：
- person_registered：id,name；person_renamed：id,name；person_moved：id,location（最近确认的位置，不表示当前仍在场）。
- person_trait_recorded / person_trait_removed：id,trait。仅明确的稳定特征，短期情绪不是人格。
- person_state_started：id,stateId,description,visibility（observable/private/author），可选 target（指向人物）、expiresAt（明确公历日期）。
- person_state_revised：id,stateId，及需要更新的 description/visibility/target。person_state_ended：id,stateId。未提到不代表结束。
- clock_set：date（YYYY-MM-DD 或 YYYY-MM-DDTHH:mm），或 description（如“三天后傍晚”，缺锚点不猜公历）。clock_advanced：from,days,to，必须有可靠日期锚点。
- scene_recorded：location，present（仅明确在场的人物 id 数组）。只被提及、打电话、传闻中的人不算在场。
- relationship_established：id,from,to,kind,mutual（明确双向才 true）。relationship_recorded 用于首次记录正文明确已有的关系。
- relationship_ended：id；relationship_conflict / relationship_milestone：id,description。表白不等于交往、争吵不等于分手。不要推断双向或数值好感度。
- plan_proposed / promise_created：id,title,participants；可选 due 或 dueDescription（未能锚定的相对约定）。
- plan_accepted / plan_completed / plan_cancelled / plan_failed：id；plan_modified：id及 title/due；plan_reopened：id（仅明确再次开启）。
- item_registered / item_acquired：id,name，可选 owner,holder,location,quantity。所有权、持有人、存放地是三件事；未知数量保持 null。
- item_lent：id,from,to,loanId；item_returned：id,loanId；item_gifted：id,from,to（赠送者确有所有权）。
- item_placed：id,from,location；item_consumed：id,quantity（本次消耗，不是剩余总量）；item_quantity_changed：id,delta。
- item_damaged / item_destroyed：id；item_restored：id，可选 quantity。已销毁物品不能用普通更新复活。
- location_created：id,name，可选 parent；location_reparented：id,parent。

每项默认 track:"facts"、context:"current"。角色声称、否认、传闻用 track:"claims",action:"claim_made",data:{speaker,subject,description}；
怀疑、推测、主观观察用 track:"observations",action:"observation_recorded",data:{speaker,subject,description}，它们不会改变世界事实。
回忆、梦境、假设、未执行计划不产生当前事实。不要把“想赠送”写成已赠送。
待转告不等于已经传达；叙述者知道不等于所有人物知道。内心情绪注明指向对象和 private/author，不推成永久特征。
同一次行为只写一次；确实发生两次消耗就写两项。有关联且必须同时成立的操作使用相同 group；独立变化不放进同一组。
优先时间、场景、在场人物、关系和重要变化，保持短小完整。只写你能从本轮正文确定的内容，不猜生日、日期、所有权或数量。
