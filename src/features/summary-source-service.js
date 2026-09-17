import {ensureChronicle, refreshMemoryLinks} from '../memory/story-state.js';
import {captureSummaryInputs, validateSummaryInputs, getSummaryStatus, resolveSummaryGraph, summaryDiagnostic} from '../memory/summary-provenance.js';

export function createSummarySourceService({getState,getChat,getChatIdentity=()=>''}={}) {
    function refresh(state=getState()) { ensureChronicle(state,getChat());refreshMemoryLinks(state,getChat());return state; }
    function capture(blocks,state=getState()) { refresh(state);return captureSummaryInputs(state,getChat(),blocks,getChatIdentity()); }
    function validate(snapshot,state=getState()) { if(getState()!==state)throw Error('聊天已切换，来源检查已停止');refresh(state);return validateSummaryInputs(state,snapshot,getChatIdentity()); }
    function assertMaterials(blocks,state=getState()) {
        refresh(state);
        const graph=resolveSummaryGraph(state);
        for(const block of blocks){const status=getSummaryStatus(state,block,graph);if(!status.valid)throw Error('来源需重建：'+status.reason);}
    }
    function diagnose(state=getState()) {refresh(state);return summaryDiagnostic(state);}
    function effective(state=getState()) {refresh(state);return resolveSummaryGraph(state);}
    return {refresh,capture,validate,assertMaterials,diagnose,effective};
}
