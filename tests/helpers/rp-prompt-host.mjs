import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGlobalSettingsService } from '../../src/core/global-settings-service.js';
import { createGlobalConfigSaveVerifier } from '../../src/core/global-config-save.js';
import { createRpPromptLibrary } from '../../src/rp-core/prompt-library.js';

const entry = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
const binding = (name, factory) => {
    const match = entry.match(new RegExp(`const ${name} = ${factory}\\([\\s\\S]*?^\\}\\);`, 'm'));
    assert.ok(match, `Production binding not found: ${name}`);
    return match[0];
};

// Execute production callbacks and the real initializer; only host I/O is simulated.
export function createRpPromptHost({ initialSettings = {}, saveMode = 'persist', stringSettings = false } = {}) {
    const extensionSettings = structuredClone(initialSettings), storageKey = 'bakemonoMemory';
    let saved = null, requests = 0;
    const noop = () => {};
    const { ensureGlobalSettings } = createGlobalSettingsService({
        extensionSettings, storageKey, sanitizeCustomTheme: value => value || {}, normalizeCustomThemePreset: value => value,
        builtInCustomThemeDefinitions: [], defaultPromptPreset: { id: 'default' }, defaultGenericPromptPreset: { id: 'generic' },
        migrateBuiltInInjectionDefaults: noop, migratePromptPresetTimelines: noop,
        areaPresetScopes: { INJECTION: 'injection' }, tableSchemaScopes: { CHAT: 'chat' },
    });
    const save = async () => {
        requests++;
        if (saveMode === 'fail') throw Error('simulated host save failure');
        if (saveMode === 'persist') saved = structuredClone(extensionSettings);
    };
    const result = vm.runInNewContext([
        binding('rpPromptLibrary', 'createRpPromptLibrary'),
        binding('confirmRpPromptConfiguration', 'createGlobalConfigSaveVerifier'),
        '({ library: rpPromptLibrary, confirm: confirmRpPromptConfiguration })',
    ].join('\n'), {
        ensureGlobalSettings, extension_settings: extensionSettings, STORAGE_KEY: storageKey, createRpPromptLibrary,
        createGlobalConfigSaveVerifier: options => createGlobalConfigSaveVerifier({ ...options, retryDelays: [0], timeoutMs: 1000 }),
        tavernHost: { saveSettings: save, getRequestHeaders: () => ({}) }, saveSettingsDebounced: save,
        fetch: async (url, options) => {
            assert.equal(url, '/api/settings/get'); assert.equal(options.method, 'POST');
            const settings = { extension_settings: saved };
            return { ok: true, json: async () => ({ settings: stringSettings ? JSON.stringify(settings) : settings }) };
        },
    });
    return { ...result, ensureGlobalSettings, extensionSettings, storageKey,
        setSaveMode: mode => { saveMode = mode; }, getSaved: () => structuredClone(saved), getSaveRequests: () => requests };
}
