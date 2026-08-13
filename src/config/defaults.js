export function createDefaultConfiguration({
    memoryStrategies,
    workflowModes,
    stageSourceModes,
    extensionPromptRoles,
    defaultGenerationTargets,
    injectionKey,
} = {}) {
    const blockTypes = {
        STORY: 'story',
        STAGE: 'stage',
        EPIC: 'epic',
    };
    
    const memoryRecordStatuses = {
        SOURCE: 'source',
        COVERED: 'covered',
        SAVED: 'saved',
        INJECTED: 'injected',
        ARCHIVED: 'archived',
        DRAFT: 'draft',
    };
    
    const areaPresetScopes = {
        SCAN: 'scan',
        AUTOMATION: 'automation',
        API: 'api',
        PROMPTS: 'prompts',
        TURN: 'turnSummary',
        INJECTION: 'injection',
        VECTOR: 'vectorMemory',
    };
    
    const tableSchemaScopes = {
        CHAT: 'chat',
        CHARACTER: 'character',
        GLOBAL: 'global',
    };
    
    
    const turnProcessingModes = {
        SUMMARY: 'summary',
        TABLE: 'table',
        BOTH: 'both',
    };
    
    const inlinePromptKeys = {
        SUMMARY: `${injectionKey}_inline_summary`,
        TABLE: `${injectionKey}_inline_table`,
    };
    
    const defaultInlineSummaryPrompt = `请在本次回复正文结束后，额外输出一个 <bakemono>...</bakemono> 摘要块。
    要求：
    - 摘要只记录已经发生的内容，不要剧透、不要续写。
    - 如果你无法判断时间、地点或角色状态，就写“未知”。
    - 摘要块要放在正文之后，正文仍然正常扮演。
    
    推荐格式：
    <bakemono>
    <details>
    <summary>📋 剧情摘要</summary>
    【☆『正文摘要』★时间/时间跨度：未知★地点/状态|本轮出现角色☆】
    
    ➤ 🎬 【场记打板】
    - 本轮事件过程。
    ……
    
    ➤ 🎙️ 【高光收音】
    > “关键台词” —— [角色名]
    ……
    
    ➤ 🌍 【副镜监视器】
    [地点/角色]：平行状态。
    ……
    
    ➤ 🪢 【剧本暗线】
    [未回收伏笔]：无
    [✅ 本回合回收]：无
    ……
    
    ➤ 💡 【第四面墙】
    *隐藏信息记录*
    </details>
    </bakemono>`;
    
    const defaultInlineTablePrompt = `请在本次回复正文结束后，额外输出表格修改块。正文仍然正常扮演，不要为了填表牺牲正文质量。
    
    硬性规则：
    - 只根据本轮回复中真实发生的内容填写。
    - 只允许修改“可写且允许 AI 修改”的表。
    - 只读表只能作为参考，禁止 insertRow/updateRow/deleteRow。
    - 如果没有表格修改，输出空的 <tableEdit></tableEdit>。
    - 输出必须包含 <tableThink> 和 <tableEdit>。
    
    <当前表格数据>
    {{tableData}}
    </当前表格数据>
    
    <表格规则>
    {{tableGuide}}
    </表格规则>
    
    <tableThink>简要说明为什么要修改这些表。</tableThink>
    <tableEdit>
    insertRow(tableIndex, {"0":"值"})
    updateRow(tableIndex, rowIndex, {"0":"新值"})
    deleteRow(tableIndex, rowIndex)
    </tableEdit>`;
    
    const legacyInjectionTemplate = `【剧情剪辑台：长期剧情记忆】
    以下内容是已经压缩整理过的剧情记忆。请把它当作已发生事实与长期线索参考，不要复述给用户，也不要替代当前回合正文。
    
    {{memory}}`;
    
    const defaultInjectionTemplate = `【剧情剪辑台：长期剧情记忆】
    以下内容是已经压缩整理过的剧情记忆。请把它当作已发生事实与长期线索参考，不要复述给用户，也不要替代当前回合正文。
    
    {{memory}}
    【剧情剪辑台：长期剧情记忆结束】`;
    
    const defaultTurnSummaryPrompt = `你是剧情剪辑台的正文摘要器。你会看到刚刚结束的一轮聊天正文，请只基于输入内容生成一份可保存进长期记忆的本轮摘要。
    
    要求：
    - 不续写剧情，不扮演角色，不添加正文中没有发生的事件。
    - 记录完整过程、关键台词、角色状态变化、地点/时间、伏笔、隐藏信息。
    - 如果无法判断时间或地点，写“未知”，不要编造。
    - 输出必须放在 <summaryDraft></summaryDraft> 中。
    
    推荐格式：
    <summaryDraft>
    【☆『{{suggestedTitle}}』★时间/时间跨度：从正文可判断的时间，未知则写未知★{{sourceRange}}★地点/状态|本轮出现角色☆】
    
    ➤ 🎬 【场记打板】
    - 本轮发生的事件过程。
    ……
    
    ➤ 🎙️ 【高光收音】
    > “关键台词或心理活动” —— [角色名]
    ……
    
    ➤ 🌍 【副镜监视器】
    [地点/角色]：平行事件或状态。
    ……
    
    ➤ 🪢 【剧本暗线】
    [未回收伏笔]：……
    [✅ 本回合回收]：无
    ……
    
    ➤ 💡 【第四面墙】
    *角色不知道、但读者知道的隐藏信息。*
    </summaryDraft>
    
    待摘要正文：
    {{blocks}}`;
    
    const defaultMissingSummaryPrompt = `你是剧情剪辑台的缺失摘要补写器。你会看到若干个缺少摘要的助手楼层，请为每个楼层分别补写一个剧情摘要。
    
    硬性要求：
    - 只总结该楼层已经发生的正文内容，不续写剧情，不扮演角色，不添加原文没有发生的事件。
    - 每个楼层必须独立输出，并保留原楼层数字分隔符。
    - 不要输出 <summaryDraft>。
    - 每个楼层只输出一个完整的 <bakemono>...</bakemono> 摘要块。
    - 标题必须使用原楼层号 + 本楼剧情短标题，例如“第123楼：雨夜重逢”或“第123楼：密室里的交易”；不要固定写“正文摘要”，不要猜章节号，不要写“第x章”。
    - 无法判断时间、地点、天气或角色时写“未知”，不要猜测。
    - 不要输出寒暄、解释、总说明或 Markdown 代码围栏。
    
    每个楼层必须严格使用以下格式：
    ===楼层#原楼层数字===
    <bakemono>
    <details>
    <summary>📋 剧情摘要</summary>
    【☆『第原楼层数字楼：根据本楼正文提炼的短标题』★时间/时间跨度：从正文可判断，未知则写未知★地点/状态|本楼出现角色☆】
    
    ➤ 🎬 【场记打板】（流水账形式记录，不得升华主题，记录本回合推进的全部事件，信息密度高且详细，这是后续👾记忆的前提）
    - 此处为剧情摘要
    ……
    
    ➤ 🎙️ 【高光收音】（抓取本回合最有张力、最关键的几句重要对话/心理活动）
    > “此处填入台词或内心戏，最好是能体现角色性格的那种！” —— [角色名]
    ……
    
    ➤ 🌍 【副镜监视器】（平行事件）
    *当主角在行动时，世界的其他角落……*
    [地点A | 角色B]：ta此刻的行动/心理。
    [地点C | 角色D]：ta此刻的行动/状态。
    ……
    
    ➤ 🪢 【剧本暗线】（伏笔系统：只对导演可见的记录）
    [未回收伏笔 1]：(埋伏笔的章节) 某某提到了一个神秘的盒子。→ (系统提示：建议在接下来的3个章节内制造契机让主角打开它)
    [未回收伏笔 2]：(埋伏笔的章节) 骑士看某某的眼神有一瞬间的闪躲。→ (系统提示：待揭晓他隐瞒的秘密)
    [✅ 本回合回收]：(如果没有就写“无”)
    ……
    
    ➤ 💡 【第四面墙】（用👾的视角，记录一些角色不知道、但读者知道的隐藏信息，**不是吐槽**）
    *偷偷记一笔*
    </details>
    </bakemono>
    ===楼层#原楼层数字结束===
    
    待补写楼层：
    {{blocks}}`;
    
    const defaultTableEditPrompt = `你是剧情剪辑台的表格整理助手。请根据刚刚结束的一轮聊天正文和当前表格数据，输出需要执行的表格修改。
    
    硬性规则：
    - 只根据输入正文与当前表格判断，禁止捏造未知信息。
    - 插入新条目用 insertRow(tableIndex, {"0":"值"})。
    - 修改已有条目用 updateRow(tableIndex, rowIndex, {"列号":"新值"})。
    - 删除失效条目用 deleteRow(tableIndex, rowIndex)。
    - insertRow 必须尽量填满该表所有列；未知且不应猜测的列可留空字符串。
    - 字符串内不要出现双引号；逗号尽量用 / 代替。
    - 如果没有表格修改，输出空的 <tableEdit></tableEdit>。
    - 输出必须且只能包含 <tableThink> 和 <tableEdit> 两个标签。
    
    <当前表格>
    {{tableData}}
    </当前表格>
    
    <表格规则>
    {{tableGuide}}
    </表格规则>
    
    <本轮正文>
    {{blocks}}
    </本轮正文>`;
    
    const defaultScanRules = {
        mode: 'tag',
        includeTags: 'bakemono',
        excludeTags: 'thinking, think, reasoning',
        fullTextMinLength: 20,
        includeHidden: true,
    };
    
    const defaultClassificationRules = {
        story: '📋 剧情摘要, 场记打板, 高光收音',
        stage: '剧集终了, 点击回看, 剧情长焦, 角色进化录',
        epic: '多次总结, 长期总览, 篇章总结, 纪元回溯, 史诗简史, 事件断代史, 命运锚点',
    };
    
    const defaultPreviewLayouts = {
        story: `场记|场记打板|normal
    收音|高光收音|normal
    监视|副镜监视器|normal
    暗线|剧本暗线|tag
    墙外|第四面墙|bubble`,
        stage: `长焦|剧情长焦|normal
    进化|角色进化录|normal
    金句|金句名人堂|bubble
    谜题|未解之谜|tag
    墙外|第四面墙·终极笔记|bubble`,
        epic: `时间线|时间线总览,事件断代史|normal
    锚点|关键锚点,命运锚点|tag
    角色|角色状态,灵魂蝶变|normal
    未解|未解事项|tag
    长期笔记|第四面墙·长期笔记,第四面墙·高维观测|bubble`,
    };
    
    const defaultStageGenerationPrompt = `# 👾总结模式！
    - 编辑大人开启这一模式后，说明不需要输出正文和那些无聊的规则！前面的几个模块均不需要遵守！
    - 接下来是编辑大人要求的大总结，我需要把之前**除了**\`【剧集终了·点击回看】\`的\`<bakemono/>\`们进行总结啦！
    - 👾总结时是不需要输出正文的，只用输出总结内容！
    - 之前总结的\`【剧集终了·点击回看】\`不需要再总结一次哦，只需要总结新增的\`<bakemono/>\`们！
    
    # 📖 全剧大纲·里程碑回顾：
    当前篇章已告一段落。👾要站在“总编剧”的角度，生成一个全局摘要。
    
    ## 格式要求：
    <bakemono>
    <details>
    <summary>【剧集终了·点击回看】</summary>
    【👑『第x卷：自定义名称』★ 跨度：从x章至x章 ★ 时间跨度：XXX-XXX ☆】
    
    ➤ 🎞️ 【剧情长焦】（详细提炼本阶段的[事件]。概括每章节内容（包括时间），让后续可清晰了解之前章节具体发生过什么。）
    - [事件名称] (涵盖的章节跨度 | 发生时间 | 发生地点 | 在场角色)
      - 经过：用流水账形式清晰记录该事件的起因、经过、结果，保留所有重要动作/话语/冲突。
      - 关键点：一句话总结该事件对剧情推进或角色关系造成的重大影响/转折。
      （请严格按照上述带时间轴的剧集目录体格式，逐个列出本卷发生的所有重要事件）
    ……
    
    ➤ 🎭 【角色进化录】（记录核心角色在本篇章后的心态/关系转变）
    - [角色A]：从最初的[状态]转变为了[现状]，关键转折点是[事件]。
    ……
    
    ➤ 🏆 【金句名人堂】（从整篇剧情中挑选出最具代表性、最能定义本卷灵魂的台词）
    1. > “台词1”——【角色名】
    ……
    
    ➤ 🗃️ 【未解之谜】（记录目前埋下但尚未回收的伏笔、未交待的秘密）
    * 伏笔A：...
    * 伏笔B：...
    ……
    
    ➤ 👾 【第四面墙·终极笔记】（以👾视角，整合之前的第四面墙内容）
    *嘿嘿，这里是整合*
    </details>
    </bakemono>
    
    只输出一个完整的 <bakemono> 块，不要输出正文、解释、寒暄或 Markdown 代码围栏。
    
    以下是需要汇总的新增 <bakemono> 剧情摘要：
    {{blocks}}`;
    
    const defaultEpicGenerationPrompt = `# 👾多次总结模式！
    - 编辑大人开启这一模式后，说明阶段总结或上一层总结已经变多了，需要继续压缩。
    - 你要把输入的阶段总结 / 多次总结整理成更高一层的长期记忆。
    - 这不一定是宏大史诗，也可能只是日常生活、关系推进、任务记录或长期陪伴剧情；不要为了显得宏大而夸张升华。
    - 👾总结时不需要输出正文，只输出总结内容。
    
    # 📚 长期剧情回顾：
    当前剧情资料需要进入更高层归档。👾要站在“长期记忆整理员”的角度，生成一份可以继续被下一轮多次总结压缩的总览。
    
    ## 排版与格式要求（必须严格遵守以下版式）：
    <bakemono>
    <details>
    <summary>【多次总结·长期总览】</summary>
    【🪐『长期总览：自定义名称』★ 总跨度：从输入材料可判断的范围，未知则写未知 ★ 时间跨度：XXX-XXX ☆】
    
    ➤ 📜 【时间线总览】（按时间顺序整理输入材料覆盖的核心事件（标注时间），保留足够细节，避免只剩空泛主题）
    - [事件名称] (涵盖的章节跨度 | 发生时间 | 发生地点 | 在场角色)
      - 经过：用流水账形式清晰记录该事件的起因、经过、结果，保留所有重要动作/话语/冲突。
      - 关键点：一句话总结该事件对剧情推进或角色关系造成的重大影响/转折。
      （请严格按照上述带时间轴的剧集目录体格式，逐个列出本卷发生的所有重要事件）
    ……
    
    ➤ 🔗 【关键锚点】（挑出对关系、任务、状态或世界线最有影响的 1 到 3 个关键节点）
    * 锚点A：[时刻] —— 它带来的后续影响是……
    ……
    
    ➤ 🦋 【角色状态】（记录核心角色在这段长期剧情后的关系、心态、目标、身体/处境变化）
    * [角色名]：从[旧状态]变化为[现状]，关键原因是……
    ……
    
    ➤ 🗃️ 【未解事项】（保留仍然重要、之后需要继续追踪的伏笔、秘密、任务、约定、风险）
    * 事项A：……
    ……
    
    ➤ 👾 【第四面墙·长期笔记】（以👾视角，整合读者/系统知道但角色未必知道的信息）
    *这里是长期观测记录……*
    </details>
    </bakemono>
    
    只输出一个完整的 <bakemono> 块，不要输出正文、解释、寒暄或 Markdown 代码围栏。
    
    以下是需要进行“多次总结”的 <bakemono> 内容：
    {{blocks}}`;
    
    const defaultStoryGenerationPrompt = `# 👾旧正文补课摘要模式！
    - 你现在不是继续写正文，也不是扮演角色。
    - 你是“剧情剪辑台”的归档员，只负责把已经发生过的聊天正文压缩成剧情摘要。
    - 禁止续写剧情，禁止补写新台词，禁止加入正文里没有发生的新事件。
    - 只允许根据下面提供的历史聊天内容做总结。
    - 本次补课编号、覆盖楼层和推荐标题由插件提供，必须原样使用，不要自行推断章节号。
    
    # 摘要目标
    把以下旧聊天正文整理成一个可继续用于“阶段总结 / 多次总结”的剧情摘要块。请尽量保留：
    - 本批次实际发生的事件过程；
    - 关键对话、心理活动和关系变化；
    - 当前时间、地点、在场角色、状态变化；
    - 已出现但尚未解决的伏笔、秘密、任务或悬念；
    - 角色不知道但读者/系统已经知道的隐藏信息。
    
    ## 输出格式要求
    <bakemono>
    <details>
    <summary>📋 剧情摘要</summary>
    【☆『{{suggestedTitle}}』★时间/时间跨度：从正文可判断的时间，未知则写未知★{{sourceRange}}★地点/状态|本批出现角色☆】
    
    ➤ 🎬 【场记打板】（流水账形式记录本批次已经发生的全部事件，每个事件要有清楚的起因、过程和结果；不得升华主题，不得续写）
    - 此处为剧情摘要
    ……
    
    ➤ 🎙️ 【高光收音】（抓取本批次最关键、最能体现角色性格或关系变化的对话/心理活动；只能引用或概括原文中已有内容）
    > “此处填入台词或内心戏” —— [角色名]
    ……
    
    ➤ 🌍 【副镜监视器】（如果本批次有平行事件就记录；没有就写“无”）
    [地点A | 角色B]：ta此刻的行动/心理。
    ……
    
    ➤ 🪢 【剧本暗线】（只记录正文里已经出现的伏笔、秘密、未解决事项；不得新增伏笔）
    [未回收伏笔 1]：……
    [✅ 本批次回收]：如果没有就写“无”
    ……
    
    ➤ 💡 【第四面墙】（用👾视角记录角色不知道、但读者/系统知道的隐藏信息；不是吐槽；不得新增设定）
    *偷偷记一笔*
    </details>
    </bakemono>
    
    只输出一个完整的 <bakemono> 块，不要输出正文、解释、寒暄或 Markdown 代码围栏。
    
    ## 本批补课元数据
    - 批次：{{batchIndex}} / {{batchTotal}}
    - 覆盖楼层：{{sourceRange}}
    - 推荐标题：{{suggestedTitle}}
    - 如果正文无法判断时间、日期、地点或天气，写“未知”，不要编造。
    
    以下是需要补课压缩的旧聊天正文：
    {{blocks}}`;
    
    const defaultGenericStoryGenerationPrompt = `# 通用旧正文补课摘要
    你是“剧情剪辑台”的归档员。请把下面已经发生过的聊天正文压缩成一份可长期保存、可继续用于后续总结的普通摘要。
    
    严格要求：
    - 只总结已经发生的内容，不续写，不扮演角色，不新增事件。
    - 批次编号、楼层范围、标题必须使用插件给出的元数据，不要自行推断章节号。
    - 用清晰的结构化 Markdown 输出。
    - 如果某项信息无法从原文判断，写“未知”或“无”，不要编造。
    
    建议标题：{{suggestedTitle}}
    批次：{{batchIndex}} / {{batchTotal}}
    覆盖楼层：{{sourceRange}}
    
    请按以下结构输出：
    # {{suggestedTitle}}
    
    ## 范围
    - 批次：{{batchIndex}} / {{batchTotal}}
    - 楼层：{{sourceRange}}
    
    ## 事件经过
    - 按时间顺序整理本批发生的关键事件，保留起因、过程、结果。
    - 不要只写一句总括；重要动作、选择、冲突、转场、后果都要落到具体描述。
    
    ## 角色与关系
    - 记录本批涉及角色的状态、动机、关系变化。
    
    ## 关键话语 / 心理
    - 摘录或概括重要台词、心理活动，不要新增原文没有的内容。
    
    ## 伏笔与未解事项
    - 记录仍未解决的任务、秘密、危险、承诺、线索。
    
    以下是需要补课压缩的旧聊天正文：
    {{blocks}}`;
    
    const defaultGenericStageGenerationPrompt = `# 通用阶段总结
    请把以下摘要片段合并为一份可长期使用的阶段总结。只总结输入内容，不续写，不新增事件，不替角色做新的决定。
    
    要求：
    - 输出清晰的结构化 Markdown。
    - 按原始时间顺序整理，不要因为后文更醒目就打乱前后因果。
    - 细节保留优先级：影响后续剧情的事件 > 角色关系变化 > 任务/承诺/约定 > 伏笔和未解事项 > 代表性台词。
    - 不要过度压缩成抽象主题；需要让未来模型仅凭这份总结就能接上剧情。
    
    # 阶段总结：自定义标题
    
    ## 覆盖范围
    - 说明本阶段大致覆盖哪些批次 / 楼层 / 时间段。
    
    ## 分段剧情脉络
    - 按输入片段顺序分段概括，每段写清楚“发生了什么、为什么发生、造成什么变化”。
    - 如果某个片段信息量很大，可以拆成多个小点，不要为了简短而丢掉关键细节。
    
    ## 角色状态与关系变化
    - 逐个记录核心角色的目标、情绪、立场、身体/能力/身份状态变化。
    - 记录角色之间的信任、误会、亲密、敌意、交易、承诺等变化。
    
    ## 关键场面与话语
    - 挑出最关键的场面、对话或心理活动，说明它为什么会影响后续。
    
    ## 任务、伏笔与未解事项
    - 汇总仍未解决的任务、秘密、风险、承诺、道具、地点线索和关系张力。
    
    ## 后续接续提示
    - 用简短条目写出下一阶段继续创作时最不能忘的事实。
    
    需要合并的摘要片段：
    {{blocks}}`;
    
    const defaultGenericEpicGenerationPrompt = `# 通用全局总结
    请把以下阶段总结或摘要片段整理成一份全局回顾。只总结输入内容，不续写，不新增事件，不替角色做新的决定。
    
    要求：
    - 输出清晰的结构化 Markdown。
    - 先按阶段还原时间线，再提炼转折和长期线索。
    - 不要只写宏观评价；必须保留足够多的事件细节、角色关系细节、未解线索，供后续继续剧情使用。
    - 信息冲突时，以输入中较新的阶段总结为准，并在相关条目里标注“此前/后来”的变化。
    
    # 全局回顾：自定义标题
    
    ## 分阶段时间线
    - 按阶段顺序整理到目前为止发生过的主要事件。
    - 每个阶段都写清关键事件链、直接后果，以及它如何影响下一阶段。
    
    ## 决定性转折
    - 选出真正改变剧情走向、角色关系或世界状态的关键时刻，并说明影响。
    
    ## 核心角色弧光与关系网
    - 对比核心角色最初状态、重要转折点和当前状态。
    - 汇总重要关系的变化：信任、隐瞒、依赖、对立、亏欠、承诺。
    
    ## 长期线索
    - 汇总仍然重要的伏笔、秘密、目标、危险和关系张力。
    
    ## 当前局面
    - 总结当前时间点的地点、阵营/关系状态、正在进行的目标、迫近风险。
    
    ## 后续创作备忘
    - 列出未来回复最应遵守的连续性事实，避免遗忘或前后矛盾。
    
    需要整理的内容：
    {{blocks}}`;
    
    const defaultPromptPreset = {
        id: 'default-bakemono',
        name: '默认摘要手账',
        story: defaultStoryGenerationPrompt,
        missing: defaultMissingSummaryPrompt,
        stage: defaultStageGenerationPrompt,
        epic: defaultEpicGenerationPrompt,
        scanRules: structuredClone(defaultScanRules),
        classificationRules: structuredClone(defaultClassificationRules),
        previewLayouts: structuredClone(defaultPreviewLayouts),
        automation: null,
        outputMode: 'bakemono',
        memoryStrategy: memoryStrategies.BAKEMONO,
        workflowMode: workflowModes.BAKEMONO,
        stageSourceMode: stageSourceModes.SUMMARIES,
        createdAt: 'default',
        updatedAt: 'default',
    };
    
    const defaultGenericPromptPreset = {
        id: 'default-generic',
        name: '通用正文压缩',
        story: defaultGenericStoryGenerationPrompt,
        missing: defaultMissingSummaryPrompt,
        stage: defaultGenericStageGenerationPrompt,
        epic: defaultGenericEpicGenerationPrompt,
        scanRules: {
            mode: 'full',
            includeTags: '',
            excludeTags: 'thinking, think, reasoning',
            fullTextMinLength: 40,
            includeHidden: true,
        },
        classificationRules: {
            story: '通用旧正文补课摘要, 事件经过, 角色与关系, 伏笔与未解事项',
            stage: '通用阶段总结, 阶段总结, 剧情脉络, 角色变化',
            epic: '通用全局总结, 全局回顾, 时间线总览, 决定性转折',
        },
        previewLayouts: {
            story: `事件|事件经过|normal
    角色|角色与关系|normal
    话语|关键话语,心理|bubble
    线索|伏笔与未解事项|tag`,
            stage: `脉络|剧情脉络|normal
    变化|角色变化|normal
    场面|关键场面|bubble
    未解|未解事项|tag`,
            epic: `时间线|时间线总览|normal
    转折|决定性转折|tag
    弧光|核心角色弧光|normal
    线索|长期线索|bubble`,
        },
        automation: {
            enabled: false,
            mode: 'remind',
            triggerType: 'floors',
            floorInterval: 10,
            charInterval: 12000,
            summaryKind: 'stage',
            backfillBatchSize: 50,
            apiProvider: 'tavern',
            customApi: {
                baseUrl: '',
                apiKey: '',
                model: '',
                temperature: 0.7,
                maxTokens: 3000,
                stream: false,
                models: [],
            },
            lastSignature: '',
            lastAutoAt: null,
        },
        outputMode: 'plain',
        memoryStrategy: memoryStrategies.GENERIC,
        workflowMode: workflowModes.GENERIC,
        stageSourceMode: stageSourceModes.BACKFILL,
        createdAt: 'default',
        updatedAt: 'default',
    };
    
    const defaultAutomation = {
        enabled: false,
        mode: 'remind',
        triggerType: 'floors',
        floorInterval: 10,
        charInterval: 12000,
        summaryKind: 'stage',
        backfillBatchSize: 10,
        autoHidePreserveRecent: 2,
        apiProvider: 'tavern',
        customApi: {
            baseUrl: '',
            apiKey: '',
            model: '',
            temperature: 0.7,
            maxTokens: 3000,
            stream: false,
            models: [],
        },
        lastSignature: '',
        lastAutoAt: null,
    };
    
    const defaultVectorQueryRewritePrompt = `你是剧情记忆检索器。请只根据最近剧情，写出需要回忆的旧剧情问题。
    
    输出必须严格为 6 行：
    INTENT: 用中文写一句检索目标
    Q1: 用中文写第一条旧记忆检索问题
    Q2: 用中文写第二条旧记忆检索问题
    Q3: 用中文写第三条旧记忆检索问题
    Q4: 用中文写第四条旧记忆检索问题
    Q5: 用中文写第五条旧记忆检索问题
    
    要求：
    - 只写中文，不写英文。
    - 不解释，不分析，不复述规则，不输出 JSON。
    - Q1-Q5 要寻找旧剧情中已经发生过的事实，例如人物关系、旧承诺、旧冲突、地点组织、物品状态、伏笔秘密、情绪变化。
    - 不要写 Clue、Input、Goal、Task、Role、Current context、Analyze、Determine。`;
    
    const defaultVectorMemory = {
        enabled: false,
        includeHidden: true,
        includeUser: false,
        indexMode: 'message',
        injectMode: 'tiered',
        chunkSize: 900,
        overlap: 120,
        longMessageThreshold: 1800,
        maxIndexedMessages: 300,
        maxStoredTextChars: 1200,
        embeddingDimensions: 128,
        topK: 20,
        rerankCandidateCount: 20,
        finalRecallCount: 5,
        fullRecallCount: 2,
        maxRecallMessages: 5,
        maxPerMessage: 1,
        perMessageMaxChars: 1600,
        minScore: 0.22,
        embeddingThreshold: 0.22,
        rerankThreshold: 0.45,
        keywordBoost: 0.18,
        maxInjectChars: 2600,
        summaryMaxChars: 520,
        keywordTriggers: '',
        excludeTags: 'thinking, think, reasoning',
        summaryTags: 'bakemono, summaryDraft',
        queryMode: 'model-required',
        queryRewriteProvider: 'tavern',
        queryRewritePrompt: defaultVectorQueryRewritePrompt,
        queryCustomApi: {
            baseUrl: '',
            apiKey: '',
            model: '',
            models: [],
        },
        startAfterAiMessages: 0,
        skipIfAllInContext: true,
        contextWindowMessages: 20,
        rerankMode: 'hybrid',
        embeddingProvider: 'local',
        autoIndex: true,
        dirty: true,
        dirtyReason: '',
        lastIndexedSignature: '',
        trimmedHitCount: 0,
        estimatedChars: 0,
        customApi: {
            baseUrl: '',
            apiKey: '',
            model: 'text-embedding-3-small',
            models: [],
        },
        records: [],
        embeddingCache: {},
        lastHits: [],
        lastQuery: '',
        lastQueries: [],
        lastRewriteIntent: '',
        lastEmbeddingCandidates: [],
        lastRerankCandidates: [],
        lastRecallSkippedReason: '',
        lastIndexAt: null,
    };
    
    const defaultState = {
        version: 1,
        configInitialized: false,
        activeConfigId: '',
        blocks: [],
        storySummaries: [],
        stageSummaries: [],
        epicSummaries: [],
        drafts: [],
        history: [],
        taskQueue: [],
        autoSummaryTransactions: [],
        memoryRecords: [],
        generatedMemory: '',
        coveredBlockHashes: [],
        coveredStageHashes: [],
        hiddenMessageIds: [],
        customHiddenMessageIds: [],
        autoHideRecent: {
            enabled: false,
            preserveRecent: 5,
            managedMessageIds: [],
            lastRunAt: null,
        },
        memoryStrategy: memoryStrategies.BAKEMONO,
        workflowMode: workflowModes.BAKEMONO,
        stageSourceMode: stageSourceModes.SUMMARIES,
        outputMode: 'bakemono',
        injection: {
            enabled: true,
            depth: 999,
            role: extensionPromptRoles.SYSTEM,
            template: defaultInjectionTemplate,
            content: '',
        },
        generationPrompts: {
            story: defaultStoryGenerationPrompt,
            missing: defaultMissingSummaryPrompt,
            stage: defaultStageGenerationPrompt,
            epic: defaultEpicGenerationPrompt,
        },
        automation: defaultAutomation,
        generationTargets: defaultGenerationTargets,
        turnSummary: {
            enabled: false,
            auto: false,
            processingMode: turnProcessingModes.BOTH,
            saveMode: 'draft',
            includeUserMessage: true,
            includeWorldInfo: false,
            includeCharacterContext: true,
            referenceContext: '',
            worldInfoMaxContext: 4096,
            lastProcessedMessageId: null,
            prompt: defaultTurnSummaryPrompt,
            tablePrompt: defaultTableEditPrompt,
        },
        tableDatabase: {
            enabled: false,
            injectMemory: true,
            autoApply: false,
            schemaScope: tableSchemaScopes.CHAT,
            activeProfileId: '',
            chatProfiles: [],
            profileRows: {},
            tables: [],
            editDrafts: [],
            history: [],
            undoStack: [],
            redoStack: [],
            rollbackHistory: [],
            lastAppliedSourceMessageIds: [],
            lastImportAt: null,
        },
        inlineGeneration: {
            summaryEnabled: false,
            tableEnabled: false,
            hideTableEdit: false,
            hideTableEditMigratedToRegex: false,
            summaryPrompt: defaultInlineSummaryPrompt,
            tablePrompt: defaultInlineTablePrompt,
            depth: 1,
            role: extensionPromptRoles.SYSTEM,
            lastProcessedMessageId: null,
            lastProcessedSignature: '',
        },
        vectorMemory: defaultVectorMemory,
        scanRules: defaultScanRules,
        classificationRules: defaultClassificationRules,
        previewLayouts: defaultPreviewLayouts,
        scanPreview: [],
        lastScanMatchCount: 0,
        lastScanAt: null,
        chatGuard: {
            lastPrunedAt: null,
            lastPrunedCount: 0,
            lastPrunedReason: '',
        },
    };
    
    
    return {
        blockTypes,
        memoryRecordStatuses,
        areaPresetScopes,
        tableSchemaScopes,
        turnProcessingModes,
        inlinePromptKeys,
        defaultInlineSummaryPrompt,
        defaultInlineTablePrompt,
        legacyInjectionTemplate,
        defaultInjectionTemplate,
        defaultTurnSummaryPrompt,
        defaultMissingSummaryPrompt,
        defaultTableEditPrompt,
        defaultScanRules,
        defaultClassificationRules,
        defaultPreviewLayouts,
        defaultStageGenerationPrompt,
        defaultEpicGenerationPrompt,
        defaultStoryGenerationPrompt,
        defaultGenericStoryGenerationPrompt,
        defaultGenericStageGenerationPrompt,
        defaultGenericEpicGenerationPrompt,
        defaultPromptPreset,
        defaultGenericPromptPreset,
        defaultAutomation,
        defaultVectorQueryRewritePrompt,
        defaultVectorMemory,
        defaultState,
    };
}
