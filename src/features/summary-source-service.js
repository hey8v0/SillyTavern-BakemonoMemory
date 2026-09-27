import {ensureChronicle, refreshMemoryLinks} from '../memory/story-state.js';
import {captureSummaryInputs, validateSummaryInputs, getSummaryStatus, resolveSummaryGraph, summaryDiagnostic, holdSummaryGraph} from '../memory/summary-provenance.js';

export function createSummarySourceService({getState,getChat,getChatIdentity=()=>''}={}) {
    // Inside once(), sources are refreshed a single time: queuing many batches must not rehash the chat per batch.
    let held=null;
    function refresh(state=getState()) {
        if(held && held.state===state)return state;
        ensureChronicle(state,getChat());refreshMemoryLinks(state,getChat());
        if(held){held.state=state;resolveSummaryGraph(state);holdSummaryGraph(state,true);}
        return state;
    }
    function once(fn) {
        if(held)return fn();
        held={state:null};
        try{return fn();}finally{if(held.state)holdSummaryGraph(held.state,false);held=null;}
    }
    function capture(blocks,state=getState()) { refresh(state);return captureSummaryInputs(state,getChat(),blocks,getChatIdentity()); }
    function validate(snapshot,state=getState()) { if(getState()!==state)throw Error('聊天已切换，来源检查已停止');refresh(state);return validateSummaryInputs(state,snapshot,getChatIdentity()); }
    function assertMaterials(blocks,state=getState()) {
        refresh(state);
        const graph=resolveSummaryGraph(state);
        for(const block of blocks){const status=getSummaryStatus(state,block,graph);if(!status.valid)throw Error('来源需重建：'+status.reason);}
    }
    function diagnose(state=getState()) {refresh(state);return summaryDiagnostic(state);}
    function effective(state=getState()) {refresh(state);return resolveSummaryGraph(state);}
    return {refresh,once,capture,validate,assertMaterials,diagnose,effective};
}
