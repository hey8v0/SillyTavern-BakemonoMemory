import test from 'node:test';
import assert from 'node:assert/strict';
import { createVectorMemoryService } from '../src/features/vector-memory-service.js';
import { stripPostProcessNoise } from '../src/shared/prompt-utils.js';
import { stripConfiguredTags } from '../src/shared/text.js';

test('event protocol is excluded from plain-body retrieval, query rewriting and subsequent summary input', () => {
    const raw = '甲来到花园。<rpEvents>{"events":["UNCONFIRMED_SECRET"]}</rpEvents>';
    const state = { scanRules: {}, vectorMemory: { excludeTags: '', summaryTags: '' } };
    const service = createVectorMemoryService({ getState: () => state, getContext: () => ({ chat: [{ mes: raw }] }),
        defaultVectorMemory: { excludeTags: '' }, parseList: value => String(value || '').split(/\s+/).filter(Boolean),
        unique: values => [...new Set(values)], stripHtml: value => value.replace(/<[^>]*>/g, ''),
        stripConfiguredTags, normalizeLineEndings: String });
    assert.equal(service.getVectorBodyText(raw), '甲来到花园。');
    assert.ok(!service.getVectorQueryText().includes('UNCONFIRMED_SECRET'));
    assert.equal(stripPostProcessNoise(raw), '甲来到花园。');
});
