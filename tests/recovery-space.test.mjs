import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSummaryRecoveryJournal } from '../src/core/summary-recovery-journal.js';

const quota = () => Object.assign(new Error('The quota has been exceeded'), { name: 'QuotaExceededError' });
const emptyState = () => ({ persistenceRevision: 0, storySummaries: [{ hash: 's', content: '摘要' }], stageSummaries: [], epicSummaries: [], drafts: [],
    history: [], coveredBlockHashes: [], coveredStageHashes: [], hiddenMessageIds: [], customHiddenMessageIds: [],
    autoHideRecent: {}, autoSummaryTransactions: [], taskQueue: [], turnSummary: {} });

// Browser local space is shared by the whole tavern (about 5 MB). Copies left by chats that were never reopened
// used to fill it until every save showed a warning.
test('when the copy does not fit, copies left by other chats make room', () => {
    const values = new Map([['bakemono-memory-summary-recovery-v1:other', 'x'.repeat(100)], ['someone-else', 'keep']]);
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { if (values.has('bakemono-memory-summary-recovery-v1:other')) throw quota(); values.set(key, value); },
        removeItem: key => values.delete(key),
        keys: () => [...values.keys()],
    };
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'current' });
    assert.equal(journal.stage(emptyState(), []).status, 'staged-compact');
    assert.equal(values.has('bakemono-memory-summary-recovery-v1:other'), false);
    assert.equal(values.get('someone-else'), 'keep', 'other extensions keep their data');
    assert.ok(journal.peek());
});

test('the missing-backup notice is plain and shown once per session', async () => {
    const source = await readFile(new URL('../src/features/summary-draft-service.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /TT 本地|恢复保护已降级/);
    assert.match(source, /!backupNoticeShown\) \{\s*backupNoticeShown = true;/);
    assert.match(await readFile(new URL('../index.js', import.meta.url), 'utf8'), /keys\(\) \{\s*return Array\.from\(\{ length: local\.length \}/);
});
