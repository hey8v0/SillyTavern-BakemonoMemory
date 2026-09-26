export function refreshBuiltInThemePresets(ui, definitions, { sanitizeCustomTheme, normalizeCustomThemePreset }) {
    for (const definition of [...definitions].reverse()) {
        const index = ui.themePresets.findIndex(preset => preset.id === definition.id);
        const previous = ui.themePresets[index];
        const wasActive = ui.selectedThemePresetId === definition.id && previous
            && JSON.stringify(sanitizeCustomTheme(ui.customTheme)) === JSON.stringify(sanitizeCustomTheme(previous));
        const next = normalizeCustomThemePreset(definition);
        if (index < 0) ui.themePresets.unshift(next);
        else ui.themePresets[index] = next;
        if (wasActive) ui.customTheme = sanitizeCustomTheme(next);
    }
}

// Earlier built-ins: an untouched stored copy is dropped, an edited or in-use one stays as a normal preset.
export const retiredBuiltInThemeTokens = Object.freeze({
    'bakemono-warm-paper-day': { paper: '#f6f3eb', ink: '#303238', accent: '#616a88' },
    'bakemono-warm-paper-night': { paper: '#27292c', ink: '#e8e6df', accent: '#a3afcd' },
});

export function themeChoiceLabel(ui = {}) {
    if (ui.themeMode !== 'custom') return '跟随酒馆';
    return ({ 'bakemono-whiteboard-day': '白板 · 日', 'bakemono-slate-night': '场记板 · 夜' })[ui.selectedThemePresetId] || '自定义';
}

export function retireBuiltInThemePresets(ui, retired = retiredBuiltInThemeTokens) {
    const inUse = id => ui.themeMode === 'custom' && ui.selectedThemePresetId === id;
    ui.themePresets = ui.themePresets.filter(preset => {
        const marks = retired[preset.id];
        return !marks || inUse(preset.id) || Object.entries(marks).some(([key, value]) => preset.tokens?.[key] !== value);
    });
}

export function createThemeSchema({ getHash } = {}) {
    const CUSTOM_THEME_SCHEMA = 'bakemono-memory-theme/v1';
    const CUSTOM_THEME_LIBRARY_SCHEMA = 'bakemono-memory-theme-library/v1';
    const customThemeColorKeys = [
        'paper',
        'paperRaised',
        'paperSoft',
        'ink',
        'muted',
        'accent',
        'secondary',
        'accentStrong',
        'line',
        'backdrop',
        'danger',
    ];
    const constraints = {
        opaqueSurfaces: true,
        contrast: 'WCAG AA',
        doNotChange: ['layout', 'plugin logic', 'configuration structure', 'memory data'],
    };
    const aiInstructions = '只修改 tokens、effects、name 与 appearance，保留 $schema 和字段结构；返回完整 JSON，不要加入 CSS、脚本或解释文字。所有颜色必须为六位十六进制色值。';
    const defaultCustomTheme = {
        $schema: CUSTOM_THEME_SCHEMA,
        name: '白板 · 日',
        appearance: 'light',
        tokens: {
            paper: '#f2eee5',
            paperRaised: '#f8f5ee',
            paperSoft: '#e7e1d4',
            ink: '#23201b',
            muted: '#5f584d',
            accent: '#a8600f',
            secondary: '#5c7a64',
            accentStrong: '#8a4d0a',
            line: '#d4ccbc',
            backdrop: '#2a2621',
            danger: '#b23b28',
        },
        effects: {
            gradientStrength: 0,
            gradientAngle: 145,
            grain: 0,
            shadow: 10,
            radius: 4,
        },
        constraints,
        aiInstructions,
    };
    // Film-slate pair shown as “白板 · 日 / 场记板 · 夜” on the appearance page.
    const builtInCustomThemeDefinitions = Object.freeze([
        {
            ...structuredClone(defaultCustomTheme),
            id: 'bakemono-whiteboard-day',
            createdAt: 'default',
            updatedAt: 'default',
        },
        {
            $schema: CUSTOM_THEME_SCHEMA,
            id: 'bakemono-slate-night',
            name: '场记板 · 夜',
            appearance: 'dark',
            tokens: {
                paper: '#151412',
                paperRaised: '#1c1a17',
                paperSoft: '#24211d',
                ink: '#ece5d6',
                muted: '#b3ab9c',
                accent: '#e0a045',
                secondary: '#8fa88a',
                accentStrong: '#e8b25e',
                line: '#3a3630',
                backdrop: '#0b0a09',
                danger: '#e0735f',
            },
            effects: {
                gradientStrength: 0,
                gradientAngle: 150,
                grain: 0,
                shadow: 14,
                radius: 4,
            },
            constraints: structuredClone(constraints),
            aiInstructions,
            createdAt: 'default',
            updatedAt: 'default',
        },
    ]);
    const builtInCustomThemePresetIds = new Set(builtInCustomThemeDefinitions.map(theme => theme.id));
    
    function normalizeThemeHex(value, fallback) {
        const color = String(value || '').trim();
        return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
    }
    
    function clampThemeNumber(value, fallback, min, max) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
    }
    
    function sanitizeCustomTheme(value = {}) {
        const source = value && typeof value === 'object' ? value : {};
        const sourceTokens = source.tokens && typeof source.tokens === 'object' ? source.tokens : {};
        const sourceEffects = source.effects && typeof source.effects === 'object' ? source.effects : {};
        const tokens = {};
        for (const key of customThemeColorKeys) {
            tokens[key] = normalizeThemeHex(sourceTokens[key], defaultCustomTheme.tokens[key]);
        }
        return {
            $schema: CUSTOM_THEME_SCHEMA,
            name: String(source.name || defaultCustomTheme.name).trim().slice(0, 80) || defaultCustomTheme.name,
            appearance: source.appearance === 'dark' ? 'dark' : 'light',
            tokens,
            effects: {
                gradientStrength: clampThemeNumber(sourceEffects.gradientStrength, defaultCustomTheme.effects.gradientStrength, 0, 24),
                gradientAngle: clampThemeNumber(sourceEffects.gradientAngle, defaultCustomTheme.effects.gradientAngle, 0, 360),
                grain: clampThemeNumber(sourceEffects.grain, defaultCustomTheme.effects.grain, 0, 12),
                shadow: clampThemeNumber(sourceEffects.shadow, defaultCustomTheme.effects.shadow, 0, 36),
                radius: clampThemeNumber(sourceEffects.radius, defaultCustomTheme.effects.radius, 0, 24),
            },
            constraints: structuredClone(defaultCustomTheme.constraints),
            aiInstructions: String(source.aiInstructions || defaultCustomTheme.aiInstructions).trim().slice(0, 1000) || defaultCustomTheme.aiInstructions,
        };
    }
    
    function makeCustomThemePresetId(name = 'theme') {
        return `theme-${getHash(`${Date.now()}|${name}|${Math.random()}`)}`;
    }
    
    function normalizeCustomThemePreset(value = {}, index = 0) {
        const theme = sanitizeCustomTheme(value);
        const now = new Date().toISOString();
        return {
            ...theme,
            id: String(value.id || makeCustomThemePresetId(`${theme.name}-${index}`)),
            createdAt: String(value.createdAt || now),
            updatedAt: String(value.updatedAt || value.createdAt || now),
        };
    }

    return {
        CUSTOM_THEME_SCHEMA,
        CUSTOM_THEME_LIBRARY_SCHEMA,
        builtInCustomThemeDefinitions,
        builtInCustomThemePresetIds,
        customThemeColorKeys,
        defaultCustomTheme,
        makeCustomThemePresetId,
        normalizeCustomThemePreset,
        sanitizeCustomTheme,
    };
}
