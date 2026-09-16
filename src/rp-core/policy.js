export const RP_RULE_VERSION = 3;
export const RP_SOURCE_VERSION = 2;
export const RP_SETTINGS = Object.freeze({ enabled: true, automatic: true, inject: true, autoApply: true,
    mode: 'inline', triggerTiming: 'immediate', includeTags: '', excludeTags: '', contextBudget: 16000 });
export function sourcePolicy(settings = {}) {
    return { version: RP_SOURCE_VERSION, includeTags: settings.includeTags || '', excludeTags: settings.excludeTags || '' };
}
export function migrateRpCore(core, state) {
    if (!core || core.ruleVersion === RP_RULE_VERSION) return core;
    if (![1, 2].includes(core.ruleVersion)) throw new Error('不支持的剧情账本版本，只能只读查看');
    const next = structuredClone(core), old = core.settings || {};
    // Preserve the actual old inputs. This is a migration snapshot, not a claim
    // that these settings were also used for every historical extraction.
    next.legacySourceSettings = { scanRules: { includeTags: state.scanRules?.includeTags || '', excludeTags: state.scanRules?.excludeTags || '' },
        turnSummary: { includeTags: state.turnSummary?.includeTags || '', excludeTags: state.turnSummary?.excludeTags || '' }, vectorMemory: { excludeTags: state.vectorMemory?.excludeTags || '' } };
    next.upgradeSnapshot = structuredClone(core);
    const inline = old.mode === 'inline' || old.mode === 'reuse' && !!(state.inlineGeneration?.summaryEnabled || state.inlineGeneration?.tableEnabled);
    next.settings = { ...RP_SETTINGS, ...old, mode: old.mode === 'independent' ? 'independent' : 'inline',
        automatic: old.automatic !== false && (old.mode === 'independent' || inline), modeNeedsChoice: !inline && old.mode !== 'independent',
        triggerTiming: state.turnSummary?.triggerTiming === 'next_user' ? 'next_user' : 'immediate',
        includeTags: state.turnSummary?.includeTags || '',
        excludeTags: [state.scanRules?.includeTags, state.scanRules?.excludeTags, state.turnSummary?.excludeTags, state.vectorMemory?.excludeTags].filter(Boolean).join(',') };
    next.ruleVersion = RP_RULE_VERSION;
    next.revision++;
    return next;
}
