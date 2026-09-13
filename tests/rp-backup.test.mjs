import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackup, validateMemoryBackup, restoreMemoryBackup, createDiagnosticReport } from '../src/memory/backup-package.js';
import { createLedger } from '../src/rp-core/ledger.js';
import { createProjection } from '../src/rp-core/domain.js';
import { sourceSnapshot } from '../src/rp-core/source.js';
import { prepareExtraction, decideCandidate } from '../src/rp-core/extraction.js';
import { createSummaryRecoveryJournal } from '../src/core/summary-recovery-journal.js';
import { validateRpBackup, importRpBackup } from '../src/rp-core/backup.js';

test('RP backup validates extraction jobs and pauses only validated running jobs', () => {
    const core = populatedCore();
    for (const extractionJobs of [{}, [null], [{ sourceKey: 'm|v', sourceRevision: 'r', status: 'unknown' }]]) {
        assert.throws(() => validateRpBackup({ ...core, extractionJobs }), /恢复数据无效/);
    }
    const job = { sourceKey: 'm|v', sourceRevision: 'r', status: 'running', recordedAt: '2026-09-13T00:00:00.000Z' };
    assert.throws(() => validateRpBackup({ ...core, extractionJobs: [job, job] }), /恢复数据无效/);
    assert.equal(importRpBackup({ ...core, extractionJobs: [job] }).extractionJobs[0].status, 'paused');
});

function populatedCore() {
    const source = sourceSnapshot('甲来了。甲说门没有锁。似乎有人跟着。', { messageId: 'm', variantId: 'v' });
    const events = [
        { track: 'facts', action: 'person_created', data: { id: 'a', name: '甲' }, excerpt: '甲来了' },
        { track: 'claims', action: 'statement', data: { description: '门没有锁' }, excerpt: '甲说门没有锁' },
        { track: 'observations', action: 'suspicion', data: { description: '有人跟着' }, excerpt: '似乎有人跟着' },
    ];
    let core = prepareExtraction(createLedger(createProjection()), JSON.stringify({ version: 1, events }), source, { floor: 0 }).core;
    for (const id of core.candidates.map(candidate => candidate.id)) core = decideCandidate(core, id, 'accept', source, { floor: 0 });
    return core;
}

test('nonempty backup preserves separate tracks, evidence and every review decision', () => {
    const core = populatedCore();
    const restored = restoreMemoryBackup({}, validateMemoryBackup(createMemoryBackup({ rpCore: core }))).rpCore;
    for (const key of ['facts', 'claims', 'observations', 'candidates', 'decisions', 'batches']) assert.deepEqual(restored[key], core[key]);
});

test('essential recovery retains RP ledger and review decisions after reload', () => {
    const values = new Map();
    let attempts = 0;
    const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key),
        setItem(key, value) {
            if (!attempts++) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
            values.set(key, value);
        } };
    const state = { rpCore: populatedCore() };
    const journal = createSummaryRecoveryJournal({ storage, getChatId: () => 'rp' });
    assert.equal(journal.stage(state, []).status, 'staged-compact');
    const loaded = {};
    assert.equal(createSummaryRecoveryJournal({ storage, getChatId: () => 'rp' }).reconcile(loaded, []).status, 'recovered');
    assert.deepEqual(loaded.rpCore, state.rpCore);
});

test('RP backup includes authoritative tracks, pauses extraction, and keeps old-package compatibility', () => {
    const core = createLedger(createProjection());
    core.settings = { enabled: true, autoApply: true, inject: true, mode: 'independent', apiKey: 'never-export' };
    const pack = createMemoryBackup({ rpCore: core });
    assert.equal(pack.formatVersion, 2);
    assert.ok(!JSON.stringify(pack).includes('never-export'));
    const restored = restoreMemoryBackup({}, validateMemoryBackup(pack));
    assert.deepEqual(restored.rpCore.facts, []);
    assert.equal(restored.rpCore.settings.enabled, false);
    assert.equal(restored.rpCore.settings.autoApply, false);
    const old = createMemoryBackup({});
    assert.equal(old.formatVersion, 1);
    const existing = { rpCore: core };
    restoreMemoryBackup(existing, validateMemoryBackup(old));
    assert.equal(existing.rpCore, core);
});

test('diagnostics expose only RP counts and supported version information', () => {
    const core = createLedger(createProjection());
    core.claims.push({ name: 'secret-character', excerpt: 'secret-story' });
    const report = createDiagnosticReport({ rpCore: core });
    assert.equal(report.counts.rpClaims, 1);
    assert.ok(!JSON.stringify(report).includes('secret-'));
});
