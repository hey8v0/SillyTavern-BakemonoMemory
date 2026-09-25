import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

// Use an installed Playwright/browser; this test never installs or calls a model.
const { chromium } = await import(process.env.BAKEMONO_TEST_PLAYWRIGHT || 'playwright');
const repo = new URL('../../', import.meta.url);
const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!/^\/(settings\.html|style\.css|src\/[a-zA-Z0-9/_-]+\.js)$/.test(path)) {
        response.writeHead(404).end(); return;
    }
    try {
        response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
        response.end(await readFile(new URL(path.slice(1), repo)));
    } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await chromium.launch({ headless: true, ...(process.env.BAKEMONO_TEST_BROWSER_PATH
        ? { executablePath: process.env.BAKEMONO_TEST_BROWSER_PATH } : {}) });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
        await page.goto(origin + '/settings.html');
        await page.addStyleTag({ url: origin + '/style.css' });
        await page.evaluate(async () => {
            const [{ createDefaultConfiguration }, { createVectorWorkbenchUi }, { createVectorSettingsModel },
                { createPageSettings }, { createWorkbenchNavigation }, { organizeWorkbenchOwnedSections }] = await Promise.all([
                import('/src/config/defaults.js'), import('/src/features/vector-workbench-ui.js'),
                import('/src/features/vector-settings-model.js'), import('/src/ui/page-settings.js'),
                import('/src/ui/workbench-navigation.js'),
                import('/src/ui/workbench-layout.js'),
            ]);
            const defaults = createDefaultConfiguration({ memoryStrategies: {}, workflowModes: {}, stageSourceModes: {},
                extensionPromptRoles: {}, defaultGenerationTargets: {}, injectionKey: 'test' }).defaultVectorMemory;
            const state = { vectorMemory: structuredClone(defaults) };
            const query = selector => {
                const nodes = [...document.querySelectorAll(selector)];
                return { length: nodes.length, 0: nodes[0],
                    val(value) { if (!arguments.length) return nodes[0]?.value; nodes.forEach(el => el.value = value); return this; },
                    prop(key, value) { if (arguments.length === 1) return nodes[0]?.[key]; nodes.forEach(el => el[key] = value); return this; },
                };
            };
            const model = createVectorSettingsModel({ query, defaultVectorMemory: defaults, getState: () => state });
            const form = createVectorWorkbenchUi({ query, document, defaultVectorMemory: defaults,
                markVectorFormRendered: model.markVectorFormRendered });
            const navigation = createWorkbenchNavigation();
            organizeWorkbenchOwnedSections();
            navigation.open(); navigation.switchTab('vector');
            form.renderVectorConfigurationFields(state);
            const test = window.test = { state, navigation, saves: [], warnings: [], confirmed: true };
            test.ui = createPageSettings({ documentRef: document, getState: () => state,
                getActiveTab: navigation.getActiveTab, notify: message => test.warnings.push(message),
                savePage: async tab => {
                    test.saves.push(tab);
                    if (tab === 'vector') test.saved = model.readVectorFormDraft(state).vectorMemory;
                    return test.confirmed;
                }, refresh: () => form.renderVectorConfigurationFields(state) });
            test.ui.bind(document.getElementById('bakemono-workbench-root')); test.ui.render();
            test.field = suffix => document.getElementById('bakemono-memory-vector-' + suffix);
            test.edit = (suffix, value) => {
                const el = test.field(suffix); el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            };
            test.collapse = () => document.querySelectorAll('[data-bakemono-panel="vector"] details').forEach(el => el.open = false);
        });
        const invalidDefaults = await page.evaluate(() => [...document.querySelectorAll('[id^="bakemono-memory-vector-"][type="number"]')]
            .filter(el => !el.validity.valid).map(el => ({ id: el.id, value: el.value, stepMismatch: el.validity.stepMismatch })));
        assert.deepEqual(invalidDefaults, [], 'production vector defaults must pass native browser validity');
        await page.locator('#bakemono-memory-page-save').click();
        assert.deepEqual(await page.evaluate(() => test.saves), ['vector']);
        assert.match(await page.locator('#bakemono-memory-page-save-status').textContent(), /已核验保存/);

        // An invalid hidden field must be named, expanded, focused and retained without a save attempt.
        await page.evaluate(async () => { test.edit('chunk-size', '239'); test.edit('model', 'keep-draft'); test.collapse(); await test.ui.save(); });
        assert.equal(await page.evaluate(() => test.saves.length), 1);
        assert.match(await page.evaluate(() => test.warnings.at(-1)), /片段长度.*240/);
        assert.match(await page.locator('#bakemono-memory-page-save-status').textContent(), /未保存.*片段长度/);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'bakemono-memory-vector-chunk-size');
        assert.equal(await page.locator('#bakemono-memory-vector-chunk-size').inputValue(), '239');
        assert.equal(await page.locator('#bakemono-memory-vector-model').inputValue(), 'keep-draft');
        assert.equal(await page.evaluate(() => {
            for (let parent = test.field('chunk-size').parentElement; parent; parent = parent.parentElement) {
                if (parent.tagName === 'DETAILS' && !parent.open) return false;
            }
            const rect = test.field('chunk-size').getBoundingClientRect();
            return rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
        }), true, 'invalid input is visible inside the viewport');
        if (process.env.BAKEMONO_TEST_SCREENSHOT_DIR) await page.screenshot({
            path: `${process.env.BAKEMONO_TEST_SCREENSHOT_DIR}/settings-error-${viewport.width}.png`,
        });

        await page.evaluate(async () => { test.edit('chunk-size', '900.5'); await test.ui.save(); });
        assert.match(await page.evaluate(() => test.warnings.at(-1)), /片段长度.*整数/);
        await page.evaluate(() => test.edit('chunk-size', '950'));
        assert.equal(await page.locator('#bakemono-memory-vector-chunk-size').getAttribute('aria-invalid'), null);
        // Native badInput can have an empty .value and must not be mistaken for an optional blank.
        await page.locator('#bakemono-memory-vector-chunk-size').fill('');
        await page.locator('#bakemono-memory-vector-chunk-size').press('-');
        assert.equal(await page.evaluate(() => test.field('chunk-size').validity.badInput), true);
        await page.evaluate(() => test.ui.save());
        assert.match(await page.evaluate(() => test.warnings.at(-1)), /片段长度.*有效数字/);
        assert.equal(await page.evaluate(() => test.field('chunk-size').validity.badInput), true, 'failed validation does not erase malformed input');

        await page.evaluate(async () => {
            test.edit('chunk-size', '950'); test.edit('max-stored-text-chars', '1230');
            test.edit('max-indexed-messages', '51'); test.edit('overlap', '0'); test.edit('full-recall-count', '0');
            test.edit('summary-max-chars', '521'); test.edit('min-score', '0.23'); await test.ui.save();
        });
        assert.equal(await page.evaluate(() => test.saves.length), 2);
        assert.deepEqual(await page.evaluate(() => [test.saved.chunkSize, test.saved.maxStoredTextChars, test.saved.maxIndexedMessages,
            test.saved.overlap, test.saved.fullRecallCount, test.saved.summaryMaxChars, test.saved.embeddingThreshold]), [950, 1230, 51, 0, 0, 521, 0.23]);
        await page.evaluate(async () => { test.edit('min-score', '0.225'); await test.ui.save(); });
        assert.match(await page.evaluate(() => test.warnings.at(-1)), /向量相似阈值.*0.01/);
        assert.equal(await page.evaluate(() => test.saves.length), 2);

        // Existing range limits and failed persistence feedback remain enforced on other settings pages.
        await page.evaluate(async () => {
            test.navigation.switchTab('generation'); test.ui.render();
            const input = document.getElementById('bakemono-memory-custom-temperature');
            input.value = '3'; input.dispatchEvent(new Event('input', { bubbles: true })); await test.ui.save();
        });
        assert.match(await page.evaluate(() => test.warnings.at(-1)), /温度.*2/);
        assert.equal(await page.evaluate(() => test.saves.length), 2);
        await page.evaluate(async () => {
            const input = document.getElementById('bakemono-memory-custom-temperature');
            input.value = '0.7'; input.dispatchEvent(new Event('input', { bubbles: true }));
            test.confirmed = false; await test.ui.save();
        });
        assert.match(await page.locator('#bakemono-memory-page-save-status').textContent(), /保存未确认/);
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`Native settings ${viewport.width}px: defaults, save, bounds, integer/decimal/zero, bad input, field focus and draft preservation passed.`);
    }
    console.log('Browser:', await browser.version());
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
