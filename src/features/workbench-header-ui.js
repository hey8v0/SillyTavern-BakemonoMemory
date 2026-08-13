export function createWorkbenchHeaderUi({
    documentRef,
    getState,
    getChat,
    getMemoryStrategyLabel,
    renderInjectionContent,
    defaultAutomation,
    getAppearanceSettings,
}) {
    function getPanelTitle(tabName) {
        const titles = {
            overview: '剪辑台',
            'prompt-inspector': '提示词清单',
            'data-hub': '自动与数据',
            'settings-hub': '设置中心',
            settings: '工作流设置',
            preview: '总结',
            records: '记忆库',
            tables: '表格',
            'turn-summary': '自动记忆',
            drafts: '待确认',
            timeline: '摘要树',
            automation: '自动总结',
            scan: '扫描规则',
            vector: '向量记忆',
            injection: '注入内容',
            generation: '默认生成模型',
            prompts: '生成提示词',
            archive: '楼层收纳',
            config: '整套配置',
            appearance: '自定义主题',
            maintenance: '撤回与事务',
            help: '使用说明',
        };
        return titles[tabName] || '剧情剪辑台';
    }

    function getPanelKicker(tabName, state = getState()) {
        const currentFloor = Math.max(0, (Array.isArray(getChat()) ? getChat().length : 1) - 1);
        const recordCount = Array.isArray(state.memoryRecords) ? state.memoryRecords.length : 0;
        const tableCount = Array.isArray(state.tableDatabase?.tables) ? state.tableDatabase.tables.length : 0;
        const vectorCount = Array.isArray(state.vectorMemory?.records) ? state.vectorMemory.records.length : 0;
        const contexts = {
            overview: `剧情剪辑 · 第 ${currentFloor.toLocaleString()} 楼`,
            'prompt-inspector': '上一轮实测 · 提示词清单',
            'data-hub': '后台工作 · 4 个工具',
            'settings-hub': '偏好与规则 · 当前聊天',
            settings: `工作方式 · ${getMemoryStrategyLabel(state.memoryStrategy)}`,
            preview: `剧情回看 · ${(state.storySummaries?.length || 0).toLocaleString()} 条摘要`,
            records: `长期记忆 · ${recordCount.toLocaleString()} 条记录`,
            tables: `结构化记忆 · ${tableCount.toLocaleString()} 个表格`,
            'turn-summary': `正文后处理 · 第 ${currentFloor.toLocaleString()} 楼`,
            drafts: `人工确认 · ${(state.drafts?.length || 0).toLocaleString()} 个待办`,
            timeline: `章节结构 · ${(state.stageSummaries?.length || 0).toLocaleString()} 个阶段`,
            automation: `后台规则 · ${state.automation?.enabled ? '运行中' : '尚未开启'}`,
            scan: `扫描识别 · ${(state.scanPreview?.length || 0).toLocaleString()} 条结果`,
            vector: `混合召回 · ${vectorCount.toLocaleString()} 个片段`,
            injection: `上下文注入 · ${renderInjectionContent(state).length.toLocaleString()} 字符`,
            generation: `默认模型 · ${(state.automation?.apiProvider || defaultAutomation.apiProvider) === 'custom' ? '自定义接口' : '酒馆主模型'}`,
            prompts: '生成风格 · 四类提示词',
            archive: `聊天收纳 · ${(state.hiddenMessageIds?.length || 0).toLocaleString()} 层已隐藏`,
            config: '配置预设 · 跨聊天复用',
            appearance: `外观主题 · ${getAppearanceSettings().themeMode === 'custom' ? '自定义' : '跟随酒馆'}`,
            maintenance: `安全维护 · ${(state.autoSummaryTransactions?.length || 0).toLocaleString()} 条事务`,
            help: '帮助中心 · 随时可查',
        };
        return contexts[tabName] || '剧情剪辑台 · 长期记忆';
    }

    function getPanelShortKicker(tabName, state = getState()) {
        const currentFloor = Math.max(0, (Array.isArray(getChat()) ? getChat().length : 1) - 1);
        const recordCount = Array.isArray(state.memoryRecords) ? state.memoryRecords.length : 0;
        const tableCount = Array.isArray(state.tableDatabase?.tables) ? state.tableDatabase.tables.length : 0;
        const vectorCount = Array.isArray(state.vectorMemory?.records) ? state.vectorMemory.records.length : 0;
        const contexts = {
            overview: `剧情剪辑 · ${currentFloor.toLocaleString()}楼`,
            'prompt-inspector': '上一轮实测',
            'data-hub': '后台工作 · 4个工具',
            'settings-hub': '偏好与规则',
            settings: '工作方式',
            preview: `剧情回看 · ${(state.storySummaries?.length || 0).toLocaleString()}条`,
            records: `长期记忆 · ${recordCount.toLocaleString()}条`,
            tables: `表格 · ${tableCount.toLocaleString()}个`,
            'turn-summary': `正文处理 · ${currentFloor.toLocaleString()}楼`,
            drafts: `人工确认 · ${(state.drafts?.length || 0).toLocaleString()}个`,
            timeline: `章节结构 · ${(state.stageSummaries?.length || 0).toLocaleString()}个`,
            automation: state.automation?.enabled ? '自动总结 · 运行中' : '自动总结 · 未开启',
            scan: `扫描识别 · ${(state.scanPreview?.length || 0).toLocaleString()}条`,
            vector: `混合召回 · ${vectorCount.toLocaleString()}个`,
            injection: `上下文 · ${renderInjectionContent(state).length.toLocaleString()}字`,
            generation: (state.automation?.apiProvider || defaultAutomation.apiProvider) === 'custom' ? '默认模型 · 自定义' : '默认模型 · 酒馆',
            prompts: '生成风格',
            archive: `楼层收纳 · ${(state.hiddenMessageIds?.length || 0).toLocaleString()}层`,
            config: '整套配置',
            appearance: '外观主题',
            maintenance: `安全维护 · ${(state.autoSummaryTransactions?.length || 0).toLocaleString()}条`,
            help: '帮助中心',
        };
        return contexts[tabName] || '剧情剪辑台';
    }

    function getInjectionStatus(state = getState()) {
        if (!state.injection?.enabled) return { short: '注入关', full: '已关闭' };
        const characterCount = renderInjectionContent(state).length;
        if (!characterCount) return { short: '注入空', full: '已开启 · 暂无可注入内容' };
        return { short: '注入开', full: `已开启 · ${characterCount.toLocaleString()} 字符` };
    }

    function render(tabName, state = getState()) {
        const fullContext = getPanelKicker(tabName, state);
        const shortContext = getPanelShortKicker(tabName, state);
        const injectionStatus = getInjectionStatus(state);
        const kicker = documentRef.getElementById('bakemono-workbench-section-title');
        if (kicker) kicker.textContent = fullContext;
        const shortKicker = documentRef.getElementById('bakemono-workbench-section-title-short');
        if (shortKicker) shortKicker.textContent = shortContext;
        const badge = documentRef.getElementById('bakemono-memory-injection-badge');
        if (badge) {
            badge.textContent = injectionStatus.short;
            badge.title = `注入状态：${injectionStatus.full}`;
            badge.setAttribute('aria-label', `注入状态：${injectionStatus.full}`);
        }
    }

    return { getInjectionStatus, getPanelKicker, getPanelShortKicker, getPanelTitle, render };
}
