export function createThemeController({
    query,
    documentRef,
    BlobCtor,
    urlApi,
    extensionSettings,
    storageKey,
    ensureGlobalSettings,
    saveGlobalSettings,
    sanitizeCustomTheme,
    defaultCustomTheme,
    builtInCustomThemePresetIds,
    normalizeCustomThemePreset,
    makeCustomThemePresetId,
    customThemeSchema,
    customThemeLibrarySchema,
    confirmDanger,
    toastr,
} = {}) {
    let appearanceThemeDraft = null;
    let appearanceThemeSection = 'palette';

    function getAppearanceSettings() {
        ensureGlobalSettings();
        return extensionSettings[storageKey].ui;
    }
    
    function getSelectedCustomThemePreset() {
        const ui = getAppearanceSettings();
        return ui.themePresets.find(preset => preset.id === ui.selectedThemePresetId) || ui.themePresets[0] || null;
    }
    
    function applyAppearanceTheme(themeOverride = null, modeOverride = null) {
        const root = documentRef.getElementById('bakemono-workbench-root');
        if (!root) {
            return;
        }
        const ui = getAppearanceSettings();
        const mode = ['tavern', 'custom'].includes(modeOverride) ? modeOverride : ui.themeMode;
        const theme = sanitizeCustomTheme(themeOverride || ui.customTheme);
        const variableMap = {
            paper: '--bakemono-theme-paper',
            paperRaised: '--bakemono-theme-paper-raised',
            paperSoft: '--bakemono-theme-paper-soft',
            ink: '--bakemono-theme-ink',
            muted: '--bakemono-theme-muted',
            accent: '--bakemono-theme-accent',
            secondary: '--bakemono-theme-secondary',
            accentStrong: '--bakemono-theme-accent-strong',
            line: '--bakemono-theme-line',
            backdrop: '--bakemono-theme-backdrop',
            danger: '--bakemono-theme-danger',
        };
        root.classList.toggle('bakemono-custom-theme', mode === 'custom');
        root.dataset.bakemonoThemeMode = mode;
        root.dataset.bakemonoThemeAppearance = mode === 'custom' ? theme.appearance : '';
        root.style.colorScheme = mode === 'custom' ? theme.appearance : '';
        for (const [key, cssVariable] of Object.entries(variableMap)) {
            if (mode === 'custom') {
                root.style.setProperty(cssVariable, theme.tokens[key]);
            } else {
                root.style.removeProperty(cssVariable);
            }
        }
        const effectVariables = {
            gradientStrength: ['--bakemono-theme-gradient-strength', '%'],
            gradientAngle: ['--bakemono-theme-gradient-angle', 'deg'],
            grain: ['--bakemono-theme-grain', '%'],
            shadow: ['--bakemono-theme-shadow', 'px'],
            radius: ['--bakemono-theme-radius', 'px'],
        };
        for (const [key, [cssVariable, unit]] of Object.entries(effectVariables)) {
            if (mode === 'custom') {
                root.style.setProperty(cssVariable, `${theme.effects[key]}${unit}`);
            } else {
                root.style.removeProperty(cssVariable);
            }
        }
        if (mode === 'custom') {
            root.style.setProperty('--bakemono-theme-shadow-blur', `${theme.effects.shadow * 2.8}px`);
        } else {
            root.style.removeProperty('--bakemono-theme-shadow-blur');
        }
    }
    
    function readCustomThemeFromUi() {
        const ui = getAppearanceSettings();
        const source = structuredClone(appearanceThemeDraft || getSelectedCustomThemePreset() || ui.customTheme || defaultCustomTheme);
        source.name = String(query('#bakemono-memory-theme-name').val() || source.name);
        source.appearance = String(query('#bakemono-memory-theme-appearance').val() || source.appearance);
        source.tokens = source.tokens || {};
        source.effects = source.effects || {};
        query('[data-bakemono-theme-color]').each(function () {
            source.tokens[this.dataset.bakemonoThemeColor] = this.value;
        });
        query('[data-bakemono-theme-effect]').each(function () {
            source.effects[this.dataset.bakemonoThemeEffect] = Number(this.value);
        });
        return sanitizeCustomTheme(source);
    }
    
    function setCustomThemeJson(theme) {
        query('#bakemono-memory-theme-json').val(JSON.stringify(sanitizeCustomTheme(theme), null, 2));
    }
    
    function renderAppearanceSettings() {
        const ui = getAppearanceSettings();
        const selectedPreset = getSelectedCustomThemePreset();
        const theme = sanitizeCustomTheme(appearanceThemeDraft || selectedPreset || ui.customTheme);
        const presetSelect = query('#bakemono-memory-theme-preset-select');
        presetSelect.empty();
        for (const preset of ui.themePresets) {
            presetSelect.append(query('<option>').val(preset.id).text(preset.name));
        }
        presetSelect.val(ui.selectedThemePresetId);
        query('[data-bakemono-theme-mode]').each(function () {
            const active = this.dataset.bakemonoThemeMode === ui.themeMode;
            this.classList.toggle('is-active', active);
            this.setAttribute('aria-pressed', String(active));
        });
        query('#bakemono-memory-custom-theme-editor').prop('hidden', ui.themeMode !== 'custom');
        query('#bakemono-memory-theme-name').val(theme.name);
        query('#bakemono-memory-theme-appearance').val(theme.appearance);
        query('[data-bakemono-theme-color]').each(function () {
            const key = this.dataset.bakemonoThemeColor;
            this.value = theme.tokens[key];
            query(`[data-bakemono-theme-color-value="${key}"]`).text(theme.tokens[key]);
        });
        query('[data-bakemono-theme-effect]').each(function () {
            const key = this.dataset.bakemonoThemeEffect;
            this.value = theme.effects[key];
            query(`[data-bakemono-theme-effect-value="${key}"]`).text(theme.effects[key]);
        });
        setCustomThemeJson(theme);
        query('[data-bakemono-theme-section]').each(function () {
            const active = this.dataset.bakemonoThemeSection === appearanceThemeSection;
            this.classList.toggle('is-active', active);
            this.setAttribute('aria-selected', String(active));
        });
        query('[data-bakemono-theme-section-panel]').each(function () {
            this.hidden = this.dataset.bakemonoThemeSectionPanel !== appearanceThemeSection;
        });
        applyAppearanceTheme(theme, ui.themeMode);
    }
    
    function previewCustomThemeFromUi() {
        const theme = readCustomThemeFromUi();
        appearanceThemeDraft = theme;
        query('[data-bakemono-theme-color-value]').each(function () {
            const key = this.dataset.bakemonoThemeColorValue;
            this.textContent = theme.tokens[key];
        });
        query('[data-bakemono-theme-effect-value]').each(function () {
            const key = this.dataset.bakemonoThemeEffectValue;
            this.textContent = theme.effects[key];
        });
        setCustomThemeJson(theme);
        applyAppearanceTheme(theme, 'custom');
    }
    
    function selectCustomThemePreset(presetId) {
        const ui = getAppearanceSettings();
        const preset = ui.themePresets.find(item => item.id === presetId);
        if (!preset) return false;
        ui.selectedThemePresetId = preset.id;
        ui.customTheme = sanitizeCustomTheme(preset);
        appearanceThemeDraft = sanitizeCustomTheme(preset);
        saveGlobalSettings();
        renderAppearanceSettings();
        return true;
    }
    
    function saveCustomThemePreset(options = {}) {
        const ui = getAppearanceSettings();
        const theme = readCustomThemeFromUi();
        const now = new Date().toISOString();
        const selectedIndex = ui.themePresets.findIndex(preset => preset.id === ui.selectedThemePresetId);
        const selectedPresetId = selectedIndex >= 0 ? ui.themePresets[selectedIndex].id : '';
        const saveAs = !!options.saveAs || selectedIndex < 0 || builtInCustomThemePresetIds.has(selectedPresetId);
        const preset = normalizeCustomThemePreset({
            ...theme,
            id: saveAs ? makeCustomThemePresetId(theme.name) : ui.themePresets[selectedIndex].id,
            createdAt: saveAs ? now : ui.themePresets[selectedIndex].createdAt,
            updatedAt: now,
        });
        if (saveAs) {
            ui.themePresets.push(preset);
        } else {
            ui.themePresets[selectedIndex] = preset;
        }
        ui.selectedThemePresetId = preset.id;
        ui.customTheme = sanitizeCustomTheme(preset);
        ui.themeMode = 'custom';
        appearanceThemeDraft = sanitizeCustomTheme(preset);
        saveGlobalSettings();
        renderAppearanceSettings();
        toastr.success(saveAs ? `已另存主题配置：${preset.name}` : `已保存主题配置：${preset.name}`);
        return preset;
    }
    
    function deleteSelectedCustomThemePreset() {
        const ui = getAppearanceSettings();
        if (ui.themePresets.length <= 1) {
            toastr.warning('至少保留一个主题配置。');
            return false;
        }
        const preset = getSelectedCustomThemePreset();
        if (preset && builtInCustomThemePresetIds.has(preset.id)) {
            toastr.warning('内置暖纸主题不能删除；修改它时会自动另存为新配置。');
            return false;
        }
        if (!preset || !confirmDanger(`删除主题配置“${preset.name}”？`, ['不会删除摘要、表格或其他插件配置。'])) return false;
        ui.themePresets = ui.themePresets.filter(item => item.id !== preset.id);
        ui.selectedThemePresetId = ui.themePresets[0].id;
        appearanceThemeDraft = sanitizeCustomTheme(ui.themePresets[0]);
        ui.customTheme = sanitizeCustomTheme(ui.themePresets[0]);
        saveGlobalSettings();
        renderAppearanceSettings();
        toastr.success('主题配置已删除。');
        return true;
    }
    
    function parseCustomThemeJson(text) {
        const parsed = JSON.parse(String(text || ''));
        if (!parsed || typeof parsed !== 'object' || !parsed.tokens || typeof parsed.tokens !== 'object') {
            throw new Error('主题 JSON 缺少 tokens 对象。');
        }
        if (parsed.$schema && parsed.$schema !== customThemeSchema) {
            throw new Error(`不支持的主题格式：${parsed.$schema}`);
        }
        return sanitizeCustomTheme(parsed);
    }
    
    function saveCustomTheme(theme, message = '自定义主题已保存。') {
        const ui = getAppearanceSettings();
        ui.themeMode = 'custom';
        ui.customTheme = sanitizeCustomTheme(theme);
        appearanceThemeDraft = sanitizeCustomTheme(theme);
        saveGlobalSettings();
        renderAppearanceSettings();
        toastr.success(message);
    }
    
    function downloadCustomThemeJson() {
        const theme = readCustomThemeFromUi();
        const blob = new BlobCtor([JSON.stringify(theme, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = urlApi.createObjectURL(blob);
        const link = documentRef.createElement('a');
        const safeName = theme.name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48) || 'bakemono-theme';
        link.href = url;
        link.download = `${safeName}.json`;
        documentRef.body.append(link);
        link.click();
        link.remove();
        urlApi.revokeObjectURL(url);
    }
    
    function downloadCustomThemeLibraryJson() {
        const ui = getAppearanceSettings();
        const payload = {
            $schema: customThemeLibrarySchema,
            exportedAt: new Date().toISOString(),
            selectedThemePresetId: ui.selectedThemePresetId,
            themes: ui.themePresets.map(preset => sanitizeCustomTheme(preset)),
        };
        const blob = new BlobCtor([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = urlApi.createObjectURL(blob);
        const link = documentRef.createElement('a');
        link.href = url;
        link.download = 'bakemono-theme-library.json';
        documentRef.body.append(link);
        link.click();
        link.remove();
        urlApi.revokeObjectURL(url);
    }
    
    function importCustomThemeJson(text, message = '主题已导入并应用。') {
        const parsed = JSON.parse(String(text || ''));
        const ui = getAppearanceSettings();
        const importedThemes = parsed?.$schema === customThemeLibrarySchema
            ? (Array.isArray(parsed.themes) ? parsed.themes : [])
            : [parsed];
        if (!importedThemes.length) {
            throw new Error('主题配置包中没有可导入的主题。');
        }
        const now = new Date().toISOString();
        const presets = importedThemes.map((item, index) => normalizeCustomThemePreset({
            ...parseCustomThemeJson(JSON.stringify(item)),
            id: makeCustomThemePresetId(item?.name || `imported-${index}`),
            createdAt: now,
            updatedAt: now,
        }, index));
        ui.themePresets.push(...presets);
        const selected = presets[0];
        ui.selectedThemePresetId = selected.id;
        ui.customTheme = sanitizeCustomTheme(selected);
        ui.themeMode = 'custom';
        appearanceThemeDraft = sanitizeCustomTheme(selected);
        saveGlobalSettings();
        renderAppearanceSettings();
        toastr.success(importedThemes.length > 1 ? `已导入 ${importedThemes.length} 个主题配置。` : message);
        return selected;
    }

    function setThemeMode(mode) {
        const ui = getAppearanceSettings();
        ui.themeMode = mode === 'custom' ? 'custom' : 'tavern';
        saveGlobalSettings();
        renderAppearanceSettings();
    }

    function setEditorSection(section) {
        appearanceThemeSection = ['palette', 'texture', 'json'].includes(section) ? section : 'palette';
        renderAppearanceSettings();
    }

    function resetDraft() {
        appearanceThemeDraft = structuredClone(defaultCustomTheme);
        renderAppearanceSettings();
        previewCustomThemeFromUi();
        toastr.info('已载入主题模板，保存后才会覆盖当前配置。');
    }

    return {
        applyAppearanceTheme,
        deleteSelectedCustomThemePreset,
        downloadCustomThemeJson,
        downloadCustomThemeLibraryJson,
        getAppearanceSettings,
        getSelectedCustomThemePreset,
        importCustomThemeJson,
        parseCustomThemeJson,
        previewCustomThemeFromUi,
        readCustomThemeFromUi,
        renderAppearanceSettings,
        resetDraft,
        saveCustomTheme,
        saveCustomThemePreset,
        selectCustomThemePreset,
        setCustomThemeJson,
        setEditorSection,
        setThemeMode,
    };
}
