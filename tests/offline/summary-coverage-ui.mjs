import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from '../helpers/summary-runtime.mjs';
import {createMemoryRecordsUi} from '../../src/features/memory-records-ui.js';
import {createStoryToolsUi} from '../../src/features/story-tools-ui.js';
import {createSummaryTimelineUi} from '../../src/features/summary-timeline-ui.js';
import {refreshMemoryLinks} from '../../src/memory/story-state.js';
const {parseHTML}=await import(process.env.BAKEMONO_TEST_LINKEDOM||'linkedom');
const settings=await readFile(new URL('../../settings.html',import.meta.url),'utf8');
const {document,window}=parseHTML(`<html><body><div id="bakemono-workbench-root">${settings}</div></body></html>`);
window.HTMLElement.prototype.click=function(){};
const x=fixture(); await x.stage('S',[10]); await x.generateEpic('E');
x.chat[10].mes+=' changed'; x.state.memoryRecords=x.records();
const query=selector=>({val:()=>document.querySelector(selector)?.value||'',text:value=>{const n=document.querySelector(selector);if(n)n.textContent=String(value);}});
const types={STORY:'story',STAGE:'stage',EPIC:'epic'};
const ui=createMemoryRecordsUi({query,documentRef:document,getState:()=>x.state,blockTypes:types,
    memoryRecordStatuses:Object.fromEntries(['source','covered','saved','injected','archived','draft','stale'].map(k=>[k.toUpperCase(),k])),
    normalizeSearchText:s=>s.toLowerCase(),getKindLabel:s=>s});
ui.renderMemoryRecordList();
assert.equal(document.querySelectorAll('.bakemono-memory-record-chip.is-stale').length,2);
assert.match(document.querySelector('#bakemono-memory-record-list').textContent,/第 10 楼/);
assert.equal(document.querySelectorAll('.bakemono-memory-record-chip.is-injected').length,0);
const malicious='<img src=x onerror=alert(1)>';
x.state.stageSummaries[0].title=malicious; x.state.memoryRecords=x.records(); ui.renderMemoryRecordList();
assert.equal(document.querySelector('#bakemono-memory-record-list img'),null);
assert.ok(document.querySelector('#bakemono-memory-record-list').textContent.includes(malicious));

const legacy=fixture(); legacy.state.storySummaries.push({hash:'legacy',title:'旧摘要',content:'kept',sourceMessageIds:[10]});
refreshMemoryLinks(legacy.state,legacy.chat); const downloads=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tools=createStoryToolsUi({documentRef:document,getState:()=>legacy.state,getChat:()=>legacy.chat,getChatKey:()=> 'synthetic',getScannedBlocks:()=>[],
    saveState:()=>{refreshMemoryLinks(legacy.state,legacy.chat);return {};},saveChat:async()=>{},refresh:()=>{},isBusy:()=>false,escapeHtml:esc,notify:()=>{},confirm:()=>true,
    urlApi:{createObjectURL:blob=>{downloads.push(JSON.parse(blob.text));return 'blob:test';},revokeObjectURL:()=>{}},BlobCtor:class{constructor(parts){this.text=parts.join('');}}});
tools.render(); const before=JSON.stringify(legacy.state.storySummaries);
await tools.action(document.querySelector('[data-story-action=summary-preview]'));
assert.equal(JSON.stringify(legacy.state.storySummaries),before);
await tools.action(document.querySelector('[data-story-action=summary-repair]'));
assert.equal(downloads[0].format,'bakemono-memory-backup');
assert.ok(legacy.state.storySummaries[0].id); assert.equal(legacy.state.storySummaries[0].content,'kept');
await tools.action(document.querySelector('[data-story-action=summary-diagnostic]'));
assert.ok(!JSON.stringify(downloads[1]).includes('kept'));

const e=x.state.epicSummaries[0]; e.sourceStageHashes=[e.hash]; e.sourceHashes=[];
const timeline=createSummaryTimelineUi({documentRef:document,getState:()=>x.state,getStoryBlocks:()=>[],getBlocksByType:()=>[],blockTypes:types,
    dedupeByHash:xs=>xs,summaryToBlock:s=>s,unique:xs=>[...new Set(xs)],getMultiSummaryLabel:()=> '多次总结',getKindLabel:s=>s,getBlockTitle:s=>s});
timeline.render(); assert.match(document.querySelector('#bakemono-memory-timeline').textContent,/需重建/);
console.log('Offline summary UI: status, cause, safe text, preview/backup/repair, diagnostic and cycle rendering passed.');
