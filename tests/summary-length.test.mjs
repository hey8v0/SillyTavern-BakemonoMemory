import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultSummaryLength, summaryLengthChars, summaryLengthModes, summaryLengthNote } from '../src/summary/length-target.js';
import { createSummaryGenerationController } from '../src/features/summary-generation-controller.js';

// Saved chapters go out with every message, and left to itself a summary keeps every detail the template asks for.
test('the target is a share of the material with a ceiling per kind; too little material needs none', () => {
    assert.equal(defaultSummaryLength, 'balanced');
    assert.equal(summaryLengthChars('stage', 3000, 'balanced'), 1000, 'about a third');
    assert.equal(summaryLengthChars('stage', 30000, 'balanced'), 1500, 'a third of a long chapter is still long');
    assert.equal(summaryLengthChars('epic', 30000, 'balanced'), 2500);
    assert.equal(summaryLengthChars('stage', 3000, 'concise'), 600);
    assert.equal(summaryLengthChars('stage', 30000, 'concise'), 800);
    assert.equal(summaryLengthChars('stage', 3000, 'detailed'), 1500);
    assert.equal(summaryLengthChars('epic', 30000, 'detailed'), 5000);
    assert.equal(summaryLengthChars('stage', 100, 'balanced'), 0);
    assert.equal(summaryLengthChars('stage', 3000, 'off'), 0);
    assert.equal(summaryLengthChars('stage', 3000, undefined), 0);
    assert.equal(summaryLengthChars('story', 3000, 'balanced'), 0, 'only chapters');
    assert.deepEqual(Object.values(summaryLengthModes).map(mode => mode.label), ['精简', '适中', '详细']);
});

test('the note gives the number and spends the words by weight, and takes precedence over a template that asks for every detail', () => {
    const note = summaryLengthNote('stage', 12345, 'balanced');
    assert.match(note, /材料约 12,345 字/);
    assert.match(note, /1,500 字以内/);
    assert.match(note, /优先于上面模板/);
    assert.match(note, /改变局面、关系或留下伏笔的大事.*起因、经过、结果和人物反应.*100 到 200 字/);
    assert.match(note, /一般的事：30 到 60 字/);
    assert.match(note, /琐事：合并成一句，或者不写/);
    assert.match(note, /不要凑字/);
    assert.match(summaryLengthNote('stage', 12345, 'concise'), /60 到 120 字/);
    assert.match(summaryLengthNote('stage', 12345, 'detailed'), /150 到 300 字/);
    assert.equal(summaryLengthNote('stage', 12345, 'off'), '');
    assert.equal(summaryLengthNote('stage', 100, 'balanced'), '');
});

function controllerWith(generationPrompts) {
    const state = { generationPrompts };
    return createSummaryGenerationController({ getState: () => state, renderGenerationPrompt: (template, blocks) => template.replace('{{blocks}}', blocks.map(block => block.content).join('\n')),
        summarySources: { assertMaterials() {} }, blockTypes: { STORY: 'story', STAGE: 'stage', EPIC: 'epic' } });
}

test('both prompts get it after the material, a prompt the user wrote too, and it counts the text, not the tags', () => {
    const body = '林晚去了码头，等到天黑也没有等到人。'.repeat(100);
    const blocks = [{ messageId: 2, type: 'story', content: `<bakemono>${body}</bakemono>` }];
    const stage = controllerWith({ stage: '我自己写的模板，什么都要保留：\n{{blocks}}', epic: '多次：\n{{blocks}}', summaryLength: 'balanced' });
    const prompt = stage.buildStageUserPrompt(blocks);
    assert.ok(prompt.startsWith('我自己写的模板'));
    assert.ok(prompt.indexOf('【篇幅要求') > prompt.indexOf(body), 'after the material, where it is read last');
    assert.match(prompt, new RegExp(`材料约 ${body.length.toLocaleString('en-US')} 字`));
    assert.match(prompt, /600 字以内/);
    assert.match(stage.buildEpicUserPrompt(blocks), /【篇幅要求/);
    const long = [{ messageId: 2, type: 'stage', content: '很长的阶段总结。'.repeat(2000) }];
    assert.match(stage.buildStageUserPrompt(long), /1,500 字以内/);
    assert.match(stage.buildEpicUserPrompt(long), /2,500 字以内/);
    const off = controllerWith({ stage: '模板\n{{blocks}}', epic: '模板\n{{blocks}}', summaryLength: 'off' });
    assert.doesNotMatch(off.buildStageUserPrompt(blocks), /篇幅要求/);
});

test('the choice is on the prompts page, kept with the prompts and in presets; new chats and old ones start at 适中', () => {
    const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const html = read('settings.html');
    assert.match(html, /id="bakemono-memory-summary-length"/);
    for (const label of ['精简', '适中', '详细', '不限']) assert.ok(new RegExp(`<option value="\\w+">${label}`).test(html), label);
    assert.match(read('src/ui/page-settings.js'), /summary-length/);
    assert.match(read('src/features/configuration-service.js'), /generationPrompts\.summaryLength = String\(query\('#bakemono-memory-summary-length'\)/);
    assert.match(read('src/features/configuration-service.js'), /summaryLength: String\(state\.generationPrompts\.summaryLength/);
    assert.match(read('src/features/workbench-renderer.js'), /#bakemono-memory-summary-length/);
    const controller = read('src/features/configuration-controller.js');
    assert.equal(controller.match(/state\.generationPrompts\.summaryLength = /g).length, 2, 'both ways a preset is applied');
    assert.match(controller, /summaryLength: String\(state\.generationPrompts\.summaryLength/);
    assert.match(read('src/config/defaults.js'), /generationPrompts: \{[^}]*summaryLength: 'balanced'/);
});
