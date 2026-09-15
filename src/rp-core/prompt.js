export const RP_EVENT_GUIDE = `## 剧情状态
完成本轮正文或摘要后，在 bakemono 块外输出一个完整的 <rpEvents> JSON 块；独立提取时只输出这个块。不输出代码围栏、注释或解释。
你根据本轮正文、摘要和已知设定判断当前状态，插件自动记录，不等待用户逐条审核。不必提供摘录、证据、置信度或临时编号。

格式示例（只示范结构，不要照抄示例剧情）：
<rpEvents>{"version":1,"state":{"clock":{"date":"2024-04-12T23:45"},"scene":{"location":"书店"},"people":[{"name":"林晚","location":"书店"},{"name":"沈砚"}],"relationships":[{"from":"林晚","to":"沈砚","kind":"朋友"}],"items":[{"name":"钥匙","holder":"林晚","quantity":1}],"plans":[{"title":"一起看海","participants":["林晚","沈砚"],"status":"accepted","due":"2024-04-14"}]},"claims":[{"speaker":"林晚","description":"否认与同学交往"}]}</rpEvents>

state 的可用字段（只输出需要记录或修改的部分）：
- clock：date（公历 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm）、description（仅有“大约傍晚”等描述时使用）。
- scene：location（当前场景名称）。
- people：name、aliases（别名数组）、location、birthDate、traits（特征数组）、states（临时状态数组，如 [{"id":"胃痛","description":"胃痛"}]；结束时移除该状态，全部结束用 []）。
- relationships：from、to（人物名称）、kind（关系名称）、mutual（是否双向）、status（active/ended）、since（已知开始日期）。一对人物可有多种关系。
- plans：title、participants（人物名称数组）、status（proposed/accepted/completed/cancelled/failed）、due（日期）、outcome。
- items：name、owner（所有者）、holder（持有者）、location、quantity（当前总量）、status（available/damaged/destroyed）。
- locations：name、parent（上级地点名称）。
名称引用已知对象；首次出现可直接写全名，插件补建人物和地点。同名不同对象用不同全名；已有对象改名时带参考中的 id。不要杜撰 char_1 之类代号。

首次处理补齐明确的时间、场景、人物位置和已知关系，之后只输出变化；省略字段保持原值。明确未知可写 null；未知数量不是 0。数组字段一旦输出即表示该字段的当前完整列表，不要漏掉仍存在的临时状态。不要输出整份旧状态或整段剧情。
角色声称、否认、传闻放 claims；怀疑、推测、主观观察放 observations。两者都是含 description 的数组，可加 speaker、subject，不改变世界状态。
表白不等于交往，吵架不等于分手，借用不转移所有权，约定到期不等于完成。回忆、梦境、假设、小剧场、第四面墙与推理不更新当前状态。参考资料用于理解，不把设定里的历史当成本轮新事件。
相对时间只在当前日期明确时换算；不猜生日、日期或无依据数值。正文或摘要已明确的状态应记录，不因没有逐字摘录而省略。
每轮优先记录时间、场景、重要人物关系与变化，保持短小且完整。无变化输出 <rpEvents>{"version":1,"state":{}}</rpEvents>。`;
