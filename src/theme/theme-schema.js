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
            paper: '#eee4ce',
            paperRaised: '#f8f1df',
            paperSoft: '#ddd0b5',
            ink: '#40382b',
            muted: '#7c715f',
            accent: '#81734a',
            secondary: '#6d775e',
            accentStrong: '#5f5638',
            line: '#c8baa0',
            backdrop: '#302b25',
            danger: '#a14f45',
        },
        effects: {
            gradientStrength: 10,
            gradientAngle: 145,
            grain: 4,
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
                paper: '#211e1a',
                paperRaised: '#2b2721',
                paperSoft: '#383126',
                ink: '#eee3ce',
                muted: '#b8aa92',
                accent: '#c19a63',
                secondary: '#87917a',
                accentStrong: '#ddb67d',
                line: '#51483b',
                backdrop: '#12110f',
                danger: '#c9796c',
            },
            effects: {
                gradientStrength: 12,
                gradientAngle: 150,
                grain: 5,
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
