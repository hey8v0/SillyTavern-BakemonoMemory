import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitInjectionPreview } from '../src/features/injection-preview.js';
import { createOverviewTokenManifest } from '../src/features/overview-token-manifest.js';

test('module previews split tables, recall hits and paragraphs without changing or dropping text', () => {
    const cases = [
        ['table', '## 表格记忆\n### 0: 人物\n姓名|地点\n甲|家\n\n### 1: 物品\n钥匙', 2],
        ['vector', '## 召回\n- 来源：第 1 楼\n正文一\n\n- 来源：第 2 楼\n正文二', 2],
        ['memory', '第一条\n\n第二条\n\n第三条', 3],
        ['rule', '<instruction>不可渲染</instruction>\n\n规则二', 2],
        ['rpState', '## 当前剧情状态\n人物：甲\n地点：家', 1],
        ['summary', '## 阶段总结\n内容\n\n## 长期总结\n内容二', 2],
        ['memory', '长'.repeat(100000), 1],
    ];
    for (const [key, text, count] of cases) {
        const parts = splitInjectionPreview(key, text);
        assert.equal(parts.length, count);
        assert.equal(parts.join(''), text);
    }
    assert.deepEqual(splitInjectionPreview('vector', ''), []);
    assert.deepEqual(splitInjectionPreview('vector', '  \n '), []);
});

test('preview and token totals use the prepared inline instructions including appended table guidance', () => {
    const state = { injection: { enabled: true, template: '规则{{memory}}' }, inlineGeneration: { tableEnabled: true, summaryEnabled: true } };
    const sources = { rpState: '状态', summary: '总结', memory: '摘要', table: '表格', vector: '召回' };
    const manifest = createOverviewTokenManifest({ getState: () => state,
        getInjectionMemoryParts: () => ({ sources, rpMaintenance: 'RP规则', inlineValues: { summaryValue: '摘要指令', tableValue: '表格指令+状态填写指南' } }),
        renderInjectionContent: () => '规则正文', renderInlinePrompt: () => { throw new Error('must use prepared instructions'); } });
    assert.deepEqual(manifest.getOverviewInjectionSources(), { ...sources, rule: '规则\n\n摘要指令\n\n表格指令+状态填写指南\n\nRP规则' });
    assert.equal(manifest.doesLastPromptMatchCurrentInjection('规则正文 摘要指令 表格指令+状态填写指南 RP规则'), true);
    assert.equal(manifest.doesLastPromptMatchCurrentInjection('规则正文 摘要指令 表格指令 RP规则'), false);
    state.injection.enabled = false;
    assert.equal(manifest.getOverviewInjectionSources().table, '');
    assert.match(manifest.getOverviewInjectionSources().rule, /表格指令\+状态填写指南/);
});

test('six native module buttons and popup lifecycle are wired into the workbench', () => {
    const html = readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
    assert.equal([...html.matchAll(/<button[^>]*data-bakemono-token-source=/g)].length, 6);
    const shell = readFileSync(new URL('../src/ui/workbench-shell-events.js', import.meta.url), 'utf8');
    assert.match(shell, /injectionPreview\?\.bind\(rootElement\)/);
    const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /getSources:.*overviewTokenManifest\.getOverviewInjectionSources/);
    assert.match(index, /closeHelp:[\s\S]{0,150}injectionPreview\.close/);
    assert.match(index, /eventSource\.on\(event_types\.CHAT_CHANGED,[\s\S]{0,150}injectionPreview\.close/);
});
