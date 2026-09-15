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
    const defaultCustomTheme = {
        $schema: CUSTOM_THEME_SCHEMA,
        name: '暖纸日间',
        appearance: 'light',
        tokens: {
            paper: '#f6f3eb',
            paperRaised: '#fcfaf5',
            paperSoft: '#e9eaf0',
            ink: '#303238',
            muted: '#656870',
            accent: '#616a88',
            secondary: '#486b59',
            accentStrong: '#434e70',
            line: '#d8d5ce',
            backdrop: '#272b38',
            danger: '#9d4a46',
        },
        effects: {
            gradientStrength: 0,
            gradientAngle: 145,
            grain: 0,
            shadow: 18,
            radius: 12,
        },
        constraints: {
            opaqueSurfaces: true,
            contrast: 'WCAG AA',
            doNotChange: ['layout', 'plugin logic', 'configuration structure', 'memory data'],
        },
        aiInstructions: '只修改 tokens、effects、name 与 appearance，保留 $schema 和字段结构；返回完整 JSON，不要加入 CSS、脚本或解释文字。所有颜色必须为六位十六进制色值。',
    };
    const builtInCustomThemeDefinitions = Object.freeze([
        {
            ...structuredClone(defaultCustomTheme),
            id: 'bakemono-warm-paper-day',
            name: '暖纸日间',
            createdAt: 'default',
            updatedAt: 'default',
        },
        {
            $schema: CUSTOM_THEME_SCHEMA,
            id: 'bakemono-warm-paper-night',
            name: '暖纸夜间',
            appearance: 'dark',
            tokens: {
                paper: '#27292c',
                paperRaised: '#2d3034',
                paperSoft: '#353b49',
                ink: '#e8e6df',
                muted: '#b0b1b5',
                accent: '#a3afcd',
                secondary: '#b0ccb7',
                accentStrong: '#c0cbe4',
                line: '#484b50',
                backdrop: '#191b1e',
                danger: '#e0a29d',
            },
            effects: {
                gradientStrength: 0,
                gradientAngle: 150,
                grain: 0,
                shadow: 22,
                radius: 12,
            },
            constraints: structuredClone(defaultCustomTheme.constraints),
            aiInstructions: defaultCustomTheme.aiInstructions,
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
