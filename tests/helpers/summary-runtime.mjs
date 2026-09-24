import {ensureChronicle, refreshMemoryLinks} from '../../src/memory/story-state.js';
import {createSummaryMemoryModel} from '../../src/features/summary-memory-model.js';
import {createSummarySelectors} from '../../src/features/summary-selectors.js';
import {createSummaryDraftService} from '../../src/features/summary-draft-service.js';
import {createSummaryGenerationController} from '../../src/features/summary-generation-controller.js';
import {createSummaryTaskQueue} from '../../src/features/summary-task-queue.js';
import {createInjectionService} from '../../src/features/injection-service.js';
import {createContentBlockService} from '../../src/features/content-block-service.js';
import {getHash} from '../../src/shared/text.js';
import {unique,dedupeByHash} from '../../src/shared/collections.js';
import * as meta from '../../src/summary/source-metadata.js';
import * as levels from '../../src/summary/levels.js';
import {buildPersistedChatState} from '../../src/core/persisted-chat-state.js';
import * as sourceModule from '../../src/features/summary-source-service.js';
import {getSortedTargetBlocks, findTargetContinuityGaps} from '../../src/summary/target-selection.js';
import {buildFloorMemoryIndex} from '../../src/memory/floor-memory-index.js';
const no=()=>{}, types={STORY:'story',STAGE:'stage',EPIC:'epic'}, modes={SUMMARIES:'summaries',BACKFILL:'backfill',RAW:'raw',AUTO:'auto',MIXED:'mixed'};
const statuses=Object.fromEntries(['source','covered','saved','injected','archived','draft','stale'].map(k=>[k.toUpperCase(),k]));
export function fixture(n=201){
    const chat=Array.from({length:n},(_,i)=>({mes:'original floor '+i,send_date:'date-'+i,name:'actor',swipe_id:0}));
    let state={tableDatabase:{tables:[],profileRows:{},schemaScope:'chat',activeProfileId:'p'},outputMode:'plain',storySummaries:[],stageSummaries:[],epicSummaries:[],blocks:[],drafts:[],history:[],autoSummaryTransactions:[],coveredBlockHashes:[],coveredStageHashes:[],injection:{enabled:true},inlineGeneration:{},automation:{},memoryStrategy:'generic',scanRules:{},vectorMemory:{},generationTargets:{epic:{sourceMode:'stage'}},generationPrompts:{epic:'template'},taskQueue:[]};
    const getState=()=>state, refresh=()=>refreshMemoryLinks(state,chat); ensureChronicle(state,chat);
    const source=sourceModule.createSummarySourceService?.({getState,getChat:()=>chat,getChatIdentity:()=> 'synthetic-chat'}) || {};
    const model=createSummaryMemoryModel({blockTypes:types,memoryStrategies:{GENERIC:'generic'},memoryRecordStatuses:statuses,dedupeByHash,...meta,...levels,unique,getBlockTitle:(_,f)=>f,getKindLabel:x=>x,getDefaultDraftTitle:x=>x});
    const injection=createInjectionService({ensureState:getState,getChat:()=>chat,...model,...levels,memoryStrategies:{GENERIC:'generic'},defaultInjectionTemplate:'{{memory}}'});
    const content=createContentBlockService({getState,...meta});
    const selectors=createSummarySelectors({getState,getChat:()=>chat,getBlocksByType:content.getBlocksByType,blockTypes:types,stageSourceModes:modes,workflowModes:{GENERIC:'generic'},dedupeByHash,summaryToBlock:model.summaryToBlock,getSortedTargetBlocks,defaultAutomation:{floorInterval:10,charInterval:12000}});
    const toast={success:no,error:no,warning:no,info:no,clear:no};
    let failure=false, persisted=null, result='', calls=0, onCall=null, onSave=null;
    const saveState=()=>{refresh();return {};};
    const service=createSummaryDraftService({ensureState:getState,getChat:()=>chat,summarySources:source,getHash,getBlockTitle:(_,f)=>f,blockTypes:types,toastr:toast,
        saveChatConditional:async()=>{await onSave?.();if(failure)throw Error('synthetic disk failure');persisted=JSON.parse(JSON.stringify(buildPersistedChatState(state)));},saveState,
        updateInjectionFromSummaries:()=>{state.generatedMemory=injection.getInjectionMemoryParts().memory;},renderWorkbenchScope:no,workbenchRenderScopes:{DRAFTS:'drafts'},...meta,...levels,unique,mergeBlocks:content.mergeBlocks,getKindLabel:x=>x,confirm:()=>true});
    const queue=createSummaryTaskQueue({getState,getHash,getKindLabel:x=>x,saveState,summarySources:source,renderWorkbenchScope:no,renderTaskQueueProgress:no,workbenchRenderScopes:{DRAFTS:'drafts'},getIsBusy:()=>false,setBusy:no,toastr:toast,
        callGenerationModel:async()=>{calls++;await onCall?.();return result;},normalizeGeneratedBakemono:service.normalizeGeneratedBakemono,createDraft:service.createDraft,commitDraft:service.commitDraft,blockTypes:types,defaultAutomation:{},switchWorkbenchTab:no,
        getTaskSourceSignature: task=>JSON.stringify((task.sourceMessageIds||[]).map(id=>[id,chat[id]?.swipe_id,getHash(chat[id]?.mes||'')]))});
    const controller=createSummaryGenerationController({getIsBusy:()=>false,scanBlocks:refresh,getState,summarySources:source,...selectors,readGenerationTargetSettings:no,promptGenerationTargetSelection:async()=>state.generationTargets.epic,selectGenerationTargets:x=>x,
        findTargetContinuityGaps,getFloorMemoryIndex:()=>buildFloorMemoryIndex({messages:chat,state}),
        getTargetSelectionLabel:()=> 'selected range',renderGenerationPrompt:(_,blocks)=>blocks.map(x=>x.content).join('\n'),...meta,...levels,enqueueSummaryTask:task=>queue.enqueueSummaryTask({...task,autoStart:false}),blockTypes:types,unique,renderWorkbenchScope:no,workbenchRenderScopes:{SUMMARY:'summary'},toastr:toast,confirm:()=>true});
    async function stage(text,ids,{tag}={}){
        refresh();const blocks=ids.map(id=>({hash:'input-'+id,content:tag?`<${tag}>summary input</${tag}>`:chat[id].mes,messageId:id,sourceKind:tag?'tag':'raw',matchedTag:tag||'全文',type:'story'}));
        const snapshot=source.capture?.(blocks);
        const draft=service.createDraft({kind:'stage',content:text,sourceHashes:blocks.map(x=>x.hash),sourceMessageIds:ids,metadata:snapshot?{inputSnapshot:snapshot}:{}});
        return service.commitDraft(draft.id);
    }
    async function generateEpic(text,{save=true}={}){result=text;await controller.generateEpicDraft();await queue.processTaskQueue();const draft=state.drafts[0];if(!draft)throw Error(state.taskQueue.at(-1)?.error||'no draft');return save?service.commitDraft(draft.id):draft;}
    return {get state(){return state;},chat,source,service,queue,controller,selectors,stage,generateEpic,parts:()=>injection.getInjectionMemoryParts(),records:()=>{refresh();return model.buildMemoryRecords(state);},calls:()=>calls,failSave:value=>{failure=value;},onCall:fn=>{onCall=fn;},onSave:fn=>{onSave=fn;},replaceState:value=>{state=value;},reload:()=>{state={blocks:[],scanPreview:[],memoryRecords:[],...JSON.parse(JSON.stringify(persisted))};ensureChronicle(state,chat);refresh();}};
}
