import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/summary-runtime.mjs';
import {createMemoryBackup,validateMemoryBackup,restoreMemoryBackup} from '../src/memory/backup-package.js';
import {getSummaryStatus,summaryDiagnostic} from '../src/memory/summary-provenance.js';
import {refreshMemoryLinks} from '../src/memory/story-state.js';
import {previewSummarySourceRepair,applySummarySourceRepair} from '../src/memory/summary-source-repair.js';
import {buildFloorMemoryIndex} from '../src/memory/floor-memory-index.js';

test('real generation queue and save cover only valid inputs; four disjoint epics coexist', async () => {
    const x = fixture(401);
    for (let i = 0; i < 4; i++) {
        await x.stage(`stage ${i}`, [i * 100]);
        await x.generateEpic(`epic ${i}`);
    }
    assert.equal(x.parts().stats.epic, 4);
    assert.equal(x.parts().stats.stage, 0);
    assert.equal(x.selectors.getUnsummarizedStageBlocks().length, 0);
});

test('stale child blocks the real generation entrance before a model request', async () => {
    const x = fixture();
    await x.stage('valid', [10]); await x.stage('will change', [170]);
    x.chat[170].mes += ' changed';
    await assert.rejects(x.generateEpic('must not generate'), /来源|重建/);
    assert.equal(x.calls(), 0);
});

test('stale parent releases valid children, and UI agrees with injection', async () => {
    const x = fixture();
    const a = await x.stage('A', [10]), b = await x.stage('B', [170]);
    const e = await x.generateEpic('E');
    x.chat[170].mes += ' changed';
    assert.equal(x.parts().stats.epic, 0); assert.equal(x.parts().stats.stage, 1);
    const rows = x.records();
    assert.equal(rows.find(r => r.hash === e.hash).status, 'stale');
    assert.equal(rows.find(r => r.hash === b.hash).status, 'stale');
    assert.equal(rows.find(r => r.hash === a.hash).status, 'injected');
    assert.ok(x.selectors.getUnsummarizedStageBlocks().some(r => r.hash === a.hash));
    assert.match(rows.find(r => r.hash === e.hash).reason, /170/);
});

test('same output across layers and regenerated instances has separate identities', async () => {
    const x = fixture(); const s = await x.stage('same', [10]);
    const e = await x.generateEpic('same');
    assert.notEqual(e.hash, s.hash); assert.equal(x.parts().stats.epic, 1);
    await x.service.deleteSavedSummary(e.hash);
    await x.service.deleteSavedSummary(s.hash);
    x.state.blocks.push({...s,isGeneratedSummary:true});
    assert.equal(x.parts().stats.stage,0,'an orphan generated block must not revive a deleted summary');
    x.state.blocks=[];
    const s2 = await x.stage('same', [11]); const e2 = await x.generateEpic('same');
    assert.notEqual(e2.hash, e.hash); assert.deepEqual(e2.sourceStageHashes, [s2.hash]);
    assert.equal(x.parts().stats.epic, 1);
});

test('tag input ignores outside widgets but catches consumed text edits and swipe changes', async () => {
    const x = fixture(); x.chat[10].mes = 'body <bakemono>summary input</bakemono> widget 1';
    await x.stage('from tag', [10], { tag: 'bakemono' });
    x.chat[10].mes += ' outside update'; assert.equal(x.parts().stats.stage, 1);
    x.chat[10].is_system = true; x.chat.push({ mes: 'new', send_date: 'new' }); assert.equal(x.parts().stats.stage, 1);
    x.chat[10].mes = x.chat[10].mes.replace('summary input', 'different input'); assert.equal(x.parts().stats.stage, 0);
});

test('draft source changed after response cannot be silently rebound on save', async () => {
    const x = fixture(); const s = await x.stage('stage', [10]);
    await x.generateEpic('epic', { save: false });
    await x.service.saveEditedSummary(s.hash, 'changed', 'changed stage');
    const draft = x.state.drafts[0];
    assert.equal(await x.service.commitDraft(draft.id), null);
    assert.ok(x.state.drafts.includes(draft)); assert.equal(x.state.epicSummaries.length, 0);
});

test('failed save rolls back source graph, arrays and actual injection; serialized reload agrees', async () => {
    const x = fixture(); await x.stage('S', [10]);
    await x.generateEpic('E', { save: false }); const before = JSON.stringify(x.state.chronicle.links);
    x.failSave(true); assert.equal(await x.service.commitDraft(x.state.drafts[0].id), null);
    assert.equal(JSON.stringify(x.state.chronicle.links), before); assert.equal(x.parts().stats.epic, 0);
    x.failSave(false); await x.service.commitDraft(x.state.drafts[0].id);
    const expected = x.parts().memory; x.reload(); assert.equal(x.parts().memory, expected);
});

test('editing output alone does not refresh outdated input evidence', async () => {
    const x = fixture(); const s = await x.stage('S', [10]); x.chat[10].mes += ' actual change';
    await x.service.saveEditedSummary(s.hash, 'S edited', 'S edited'); assert.equal(x.parts().stats.stage, 0);
});

test('159 / 160 / 161 / 200 / 320 / 400 floors have no arbitrary ceiling', async () => {
    for (const count of [159, 160, 161, 200, 320, 400]) {
        const x = fixture(401); await x.stage(`S${count}`, Array.from({length:count}, (_,i)=>i+1));
        await x.generateEpic(`E${count}`); assert.equal(x.parts().stats.epic, 1);
    }
});

test('backup round trip keeps precise provenance and queued draft input snapshots', async () => {
    const x=fixture(); await x.stage('private stage',[10]); await x.generateEpic('private epic',{save:false});
    const original=structuredClone(x.state.stageSummaries[0].provenance), draft=structuredClone(x.state.drafts[0].metadata.inputSnapshot);
    const backup=createMemoryBackup(x.state,{chat:x.chat});
    restoreMemoryBackup(x.state,validateMemoryBackup(backup));
    assert.deepEqual(x.state.stageSummaries[0].provenance,original);
    assert.deepEqual(x.state.drafts[0].metadata.inputSnapshot,draft);
    assert.equal(x.parts().stats.stage,1);
    x.chat[10].mes+=' edited'; assert.equal(x.parts().stats.stage,0);
});

test('input edit during model call preserves paid result as a noncommittable draft', async () => {
    const x=fixture(); await x.stage('S',[10]); x.onCall(()=>{x.chat[10].mes+=' changed';});
    const draft=await x.generateEpic('paid response',{save:false});
    assert.equal(draft.content,'paid response'); assert.match(draft.metadata.inputError,/来源|输入/);
    assert.equal(x.state.taskQueuePaused,true);
    assert.equal(await x.service.commitDraft(draft.id),null); assert.equal(x.calls(),1);
});

test('recursive compression falls back to valid intermediate nodes, without a ghost coverage cache', async () => {
    const x=fixture(); await x.stage('A',[10]); const e=await x.generateEpic('E');
    x.state.generationTargets.epic.sourceMode='epic'; const top=await x.generateEpic('TOP');
    assert.equal(x.parts().stats.epic,1);
    assert.equal(x.records().find(r=>r.hash===e.hash).status,'archived');
    await x.service.deleteSavedSummary(top.hash);
    assert.equal(x.parts().stats.epic,1); assert.ok(x.parts().memory.includes('E'));
    x.state.injection.enabled=false; assert.equal(x.records().find(r=>r.hash===e.hash).status,'saved');
});

test('cycles and missing dependencies are visible; diagnostic excludes narrative and endpoint secrets', async () => {
    const x=fixture(); const a=await x.stage('PRIVATE_SUMMARY',[10]);
    a.provenance.inputs=[{kind:'summary',id:a.id,revision:a.contentHash}];
    refreshMemoryLinks(x.state,x.chat);
    assert.equal(getSummaryStatus(x.state,a).valid,false);
    const diagnostic=JSON.stringify(summaryDiagnostic(x.state));
    assert.match(diagnostic,/cycle|child_stale/); assert.ok(!diagnostic.includes('PRIVATE_SUMMARY'));
    assert.ok(!diagnostic.includes('original floor')); assert.equal(x.parts().stats.stage,0);
});

test('precise sources survive floor shifts but reject deleted messages and changed swipes', async () => {
    const x=fixture(); await x.stage('S',[10]); x.chat.shift();
    assert.equal(x.parts().stats.stage,1);
    x.chat[9].swipe_id=1; assert.equal(x.parts().stats.stage,0);
    x.chat.splice(9,1); assert.equal(x.parts().stats.stage,0);
});

test('legacy repair preview is read only; preserved old evidence cannot wash stale nodes valid', () => {
    const x=fixture();
    x.state.storySummaries.push({hash:'old',content:'old source',sourceMessageIds:[10]});
    x.state.stageSummaries.push({hash:'upper',content:'old stage',sourceHashes:['old']});
    refreshMemoryLinks(x.state,x.chat); x.chat[10].mes+=' changed'; refreshMemoryLinks(x.state,x.chat);
    const before=JSON.stringify(x.state), plan=previewSummarySourceRepair(x.state,x.chat);
    assert.equal(JSON.stringify(x.state),before); assert.equal(plan.changes.length,2);
    applySummarySourceRepair(x.state,plan); refreshMemoryLinks(x.state,x.chat);
    assert.equal(getSummaryStatus(x.state,x.state.storySummaries[0]).valid,false);
    assert.equal(getSummaryStatus(x.state,x.state.stageSummaries[0]).valid,false);
    assert.throws(()=>applySummarySourceRepair(x.state,plan),/变化/);
});

test('ambiguous legacy output identity stays visible rather than guessing a repair', () => {
    const x=fixture();
    x.state.stageSummaries.push({hash:'same',content:'same',sourceMessageIds:[10]});
    x.state.epicSummaries.push({hash:'same',content:'same',sourceStageHashes:['same']});
    refreshMemoryLinks(x.state,x.chat); const plan=previewSummarySourceRepair(x.state,x.chat);
    assert.equal(plan.changes.length,0); assert.equal(plan.unresolved,2);
    assert.equal(x.records().filter(record=>record.status==='stale').length,2);
});

test('failed save preserves an unrelated draft created during the pending write', async () => {
    const x=fixture(); await x.stage('S',[10]); const draft=await x.generateEpic('E',{save:false});
    let newer;
    x.onSave(()=>{newer=x.service.createDraft({kind:'story',content:'newer draft'});}); x.failSave(true);
    assert.equal(await x.service.commitDraft(draft.id),null);
    assert.ok(x.state.drafts.some(d=>d.id===newer.id)); assert.ok(x.state.drafts.some(d=>d.id===draft.id));
    assert.equal(x.state.epicSummaries.length,0); assert.equal(x.parts().stats.stage,1);
});

test('explicit reorganization can consume covered valid material, not stale inputs', async () => {
    const x=fixture(); await x.stage('S',[10]); await x.generateEpic('E');
    x.state.generationTargets.epic.includeCovered=true;
    await x.generateEpic('reorganized'); assert.equal(x.state.epicSummaries.length,2);
    x.chat[10].mes+=' changed'; await assert.rejects(x.generateEpic('invalid'),/来源|重建/);
    assert.equal(x.calls(),2);
});

test('chat switch during response cannot write the result into the new chat', async () => {
    const x=fixture(); await x.stage('S',[10]);
    const other=structuredClone(x.state); other.drafts=[]; other.taskQueue=[];
    x.onCall(()=>x.replaceState(other));
    await assert.rejects(x.generateEpic('wrong chat'));
    assert.equal(other.epicSummaries.length,0); assert.equal(other.drafts.length,0);
});

test('floor readiness follows valid raw-source summaries, not stale generated block copies', async () => {
    const x=fixture(); await x.stage('S',[10]); await x.generateEpic('E');
    assert.equal(buildFloorMemoryIndex({messages:x.chat,state:x.state}).byId.get(10).summaryState,'covered');
    x.chat[10].mes+=' changed'; x.parts();
    assert.equal(buildFloorMemoryIndex({messages:x.chat,state:x.state}).byId.get(10).summaryState,'missing');
});
