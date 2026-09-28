// Until 1.25.5 the built-in 多次总结 keywords and sections still carried the names of the very first prompt
// (纪元回溯·史诗简史, 事件断代史, 命运锚点, 灵魂蝶变, 高维观测), which the prompt dropped long ago.
// Saved rules that are still exactly that old default move to the current one; edited rules are left alone.
const legacyEpicClassification = '多次总结, 长期总览, 篇章总结, 纪元回溯, 史诗简史, 事件断代史, 命运锚点';
const legacyEpicLayout = `时间线|时间线总览,事件断代史|normal
锚点|关键锚点,命运锚点|tag
角色|角色状态,灵魂蝶变|normal
未解|未解事项|tag
长期笔记|第四面墙·长期笔记,第四面墙·高维观测|bubble`;

const lines = value => String(value ?? '').split('\n').map(line => line.trim()).filter(Boolean).join('\n');

export function migrateLegacyRuleDefaults(config, { classification, layouts }) {
    if (!config || typeof config !== 'object') return false;
    let changed = false;
    if (config.classificationRules && lines(config.classificationRules.epic) === legacyEpicClassification) {
        config.classificationRules.epic = classification.epic;
        changed = true;
    }
    if (config.previewLayouts && lines(config.previewLayouts.epic) === legacyEpicLayout) {
        config.previewLayouts.epic = layouts.epic;
        changed = true;
    }
    return changed;
}
