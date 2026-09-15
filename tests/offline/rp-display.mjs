import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as display from '../../src/features/rp-protocol-display.js';

const { parseHTML } = await import(process.env.BAKEMONO_TEST_LINKEDOM || 'linkedom');
const host = process.env.BAKEMONO_TEST_TAVERN;
assert.ok(host, 'Set BAKEMONO_TEST_TAVERN to a read-only SillyTavern checkout with installed Showdown.');
const hostUrl = pathToFileURL(host.replace(/[/\\]$/, '') + '/');
const showdown = createRequire(new URL('package.json', hostUrl))('showdown');
const { markdownUnderscoreExt } = await import(new URL('public/scripts/showdown-underscore.js', hostUrl));
const script = await readFile(new URL('public/script.js', hostUrl), 'utf8');
const engine = await readFile(new URL('public/scripts/extensions/regex/engine.js', hostUrl), 'utf8');
function exportedFunction(source, name) {
    const start = source.indexOf('export function ' + name + '(');
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf('\n/**', start)).trim().replace(/^export /, '');
}
const { document, window } = parseHTML('<html><body><div id="chat"></div></body></html>');
const chat = [], extension_settings = { regex: [], disabledExtensions: [] };
const converter = new showdown.Converter({ emoji: true, literalMidWordUnderscores: true, parseImgDimensions: true,
    tables: true, underline: true, simpleLineBreaks: true, strikethrough: true,
    disableForced4SpacesIndentedSublists: true, extensions: [markdownUnderscoreExt()] });
const context = vm.createContext({ chat, extension_settings, converter, console,
    power_user: { reasoning: {}, allow_name2_display: true },
    COMMENT_NAME_DEFAULT: 'Comment', systemUserName: 'System',
    substituteParams: s => s, substituteParamsExtended: s => s,
    getRegexScripts: () => extension_settings.regex,
    regex_placement: { USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, REASONING: 6 },
    substitute_find_regex: { NONE: 0, RAW: 1, ESCAPED: 2 },
    RegexProvider: { instance: { get(value) { const end = value.lastIndexOf('/'); return new RegExp(value.slice(1, end), value.slice(end + 1)); } } },
    canUseNegativeLookbehind: () => true,
    encodeStyleTags: s => s, decodeStyleTags: s => s,
    // Offline DOM approximation of sanitization: unknown tags lose their wrapper, not their text.
    DOMPurify: { sanitize(html) {
        const root = document.createElement('div'); root.innerHTML = html;
        for (const tag of root.querySelectorAll('rpevents')) tag.replaceWith(...tag.childNodes);
        return root.innerHTML;
    } },
});
vm.runInContext(['getRegexedString', 'runRegexScript'].map(name => exportedFunction(engine, name)).join('\n')
    + '\n' + exportedFunction(script, 'messageFormatting'), context);
const format = (text, message = {}, id = 0) => context.messageFormatting(text, message.name || '甲', !!message.is_system, !!message.is_user, id);
const payload = description => '<rpEvents>' + JSON.stringify({ version: 1, state: { people: [{ name: '甲', traits: [description] }] } }) + '</rpEvents>';
const originals = [];
for (const description of ['普通描述', '**胃痛**', '取走了 `钥匙`', '高兴 :smile:', '[详情](https://example.org)', '![图](https://example.org/image.png)', 'a & b < c']) {
    const raw = '正常正文\n\n' + payload(description);
    const root = document.createElement('div'); root.innerHTML = format(raw);
    originals.push(root.innerHTML);
    display.hideRenderedRpProtocol(root, raw, { renderProtocol: text => format(text, {}, -1) });
    assert.doesNotMatch(root.textContent, /version|people|traits/, description);
    assert.equal(root.querySelector('img'), null, description);
    assert.match(root.textContent, /正常正文/);
}

display.ensureRpDisplayFilter(extension_settings);
for (const encode of [false, true]) {
    context.power_user.encode_tags = encode;
    const raw = '正常正文\n\n' + payload('**胃痛** `钥匙` :smile:');
    chat.splice(0, chat.length, { mes: raw, extra: {}, swipes: [raw] });
    const stored = JSON.stringify(chat);
    const html = format(raw);
    assert.doesNotMatch(html, /rpEvents|version|traits|people/);
    assert.match(format(raw, { is_user: true }), /version/);
    assert.equal(JSON.stringify(chat), stored);
    assert.match(context.getRegexedString(raw, 2, { isPrompt: true }), /rpEvents/);
    assert.match(context.getRegexedString(raw, 2, { isEdit: true }), /rpEvents/);
}
context.power_user.encode_tags = false;
// Previously rendered rows and hosts with the regex extension disabled use the scoped DOM fallback.
extension_settings.disabledExtensions = ['regex'];
chat.splice(0, chat.length, { mes: '正文' + payload('**胃痛**') }, { mes: '正文' + payload('**胃痛**'), is_user: true },
    { mes: '原正文', extra: { display_text: '显示副本' + payload('`钥匙`') } });
const stored = JSON.stringify(chat);
const container = document.querySelector('#chat');
container.innerHTML = chat.map((message, id) => `<div class="mes" mesid="${id}"><div class="mes_text">${format(message.extra?.display_text || message.mes, message, id)}<button>小组件</button></div></div>`).join('');
const button = container.querySelector('button');
let clicked = 0; button.addEventListener('click', () => clicked++);
const controller = display.createRpProtocolDisplay({ documentRef: document, getChat: () => chat, Observer: window.MutationObserver,
    renderProtocol: (text, message) => format(text, message, -1) });
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
controller.bind(); controller.bind(); await settle();
assert.doesNotMatch(container.querySelector('[mesid="0"]').textContent, /version/);
assert.match(container.querySelector('[mesid="1"]').textContent, /version/);
assert.doesNotMatch(container.querySelector('[mesid="2"]').textContent, /version/);
button.dispatchEvent(new window.Event('click')); assert.equal(clicked, 1);
assert.equal(button.isConnected, true);
const root = container.querySelector('[mesid="0"] .mes_text');
for (const text of ['新正文' + payload(':smile:'), '重 roll' + payload('`钥匙`'), '输出中<rpEvents>{"version":1,"state":{"people":[{"name":"**甲**']) {
    chat[0].mes = text; root.innerHTML = format(text); await settle();
    assert.doesNotMatch(root.textContent, /version|people/);
}
root.innerHTML = '<textarea></textarea><div contenteditable="true"></div>';
root.querySelector('textarea').value = chat[0].mes;
root.querySelector('[contenteditable]').textContent = chat[0].mes;
await settle();
assert.match(root.querySelector('textarea').value, /rpEvents/);
assert.match(root.querySelector('[contenteditable]').textContent, /rpEvents/);
root.querySelector('[contenteditable]').innerHTML = '<span>' + payload('**甲**') + '</span>';
await settle();
assert.ok(root.querySelector('[contenteditable] rpevents'));
assert.equal(display.hideRenderedRpProtocol(root.querySelector('[contenteditable] span'), payload('**甲**')), false);
assert.equal(JSON.stringify(chat.slice(1)), JSON.stringify(JSON.parse(stored).slice(1)));
controller.dispose(); controller.bind(); await settle(); controller.dispose();
assert.equal(originals.length, 7);
console.log('PASS: real host formatter/regex + Showdown, Markdown/emoji/images, display-only filtering, old rows, streaming, swipe, display_text, widget identity, raw/edit preservation. Sanitizer/DOM simulated; no browser.');
