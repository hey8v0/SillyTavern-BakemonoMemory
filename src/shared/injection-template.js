export function normalizeLineEndings(value) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function migrateBuiltInInjectionDefaults(injection, legacyTemplate, nextTemplate, options = {}) {
    if (!injection || typeof injection !== 'object') return false;
    const currentTemplate = normalizeLineEndings(injection.template || '').trim();
    const recognizedLegacyTemplate = normalizeLineEndings(legacyTemplate || '').trim();
    if (!recognizedLegacyTemplate || currentTemplate !== recognizedLegacyTemplate) return false;
    const legacyDepth = Number(options.legacyDepth ?? 4);
    const nextDepth = Number(options.nextDepth ?? 999);
    injection.template = String(nextTemplate || legacyTemplate);
    if (Number(injection.depth ?? legacyDepth) === legacyDepth) injection.depth = nextDepth;
    if (injection.enabled === undefined) injection.enabled = true;
    return true;
}

export function stripLeadingText(value, prefix) {
    let text = normalizeLineEndings(value).trim();
    const normalizedPrefix = normalizeLineEndings(prefix).trim();
    if (!normalizedPrefix) {
        return text;
    }

    while (text.startsWith(normalizedPrefix)) {
        text = text.slice(normalizedPrefix.length).trim();
    }
    return text;
}

export function stripTrailingText(value, suffix) {
    let text = normalizeLineEndings(value).trim();
    const normalizedSuffix = normalizeLineEndings(suffix).trim();
    if (!normalizedSuffix) {
        return text;
    }

    while (text.endsWith(normalizedSuffix)) {
        text = text.slice(0, -normalizedSuffix.length).trim();
    }
    return text;
}

export function normalizeInjectionMemoryBody(value, template = '', fallbackTemplate = '') {
    let text = normalizeLineEndings(value).trim();
    if (!text) {
        return '';
    }

    const templates = [...new Set([template, fallbackTemplate]
        .map(item => normalizeLineEndings(item || ''))
        .filter(Boolean))];
    for (const currentTemplate of templates) {
        if (currentTemplate.includes('{{memory}}')) {
            const [prefix, ...rest] = currentTemplate.split('{{memory}}');
            text = stripLeadingText(text, prefix);
            text = stripTrailingText(text, rest.join('{{memory}}'));
        } else {
            text = stripLeadingText(text, currentTemplate);
        }
    }

    return text.trim();
}

export function renderInjectionTemplate(value, template = '', fallbackTemplate = '') {
    const activeTemplate = String(template || fallbackTemplate);
    const memory = normalizeInjectionMemoryBody(value, activeTemplate, fallbackTemplate);
    if (!memory) {
        return '';
    }
    return activeTemplate.includes('{{memory}}')
        ? activeTemplate.replaceAll('{{memory}}', memory).trim()
        : `${activeTemplate.trim()}\n\n${memory}`.trim();
}
