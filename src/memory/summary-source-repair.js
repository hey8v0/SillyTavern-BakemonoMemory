import {newSummaryId, inputSignature, resolveSummaryGraph, summaryNodes, invalidateSummaryGraph, registerSummaryChat} from './summary-provenance.js';
import {getHash} from '../shared/text.js';

const keys = ['storySummaries','stageSummaries','epicSummaries'];
export const summaryRepairRevision = state => inputSignature([keys.map(key=>state[key]),state.chronicle?.links,state.chronicle?.sources]);

// Upgrade only uniquely identified legacy bindings. Never infer new source versions.
export function previewSummarySourceRepair(state, chat = []) {
    const copy={...state,...Object.fromEntries(keys.map(key=>[key,structuredClone(state[key]||[])]))}, original=summaryNodes(state).filter(node=>node.saved);
    const nodes=summaryNodes(copy).filter(node=>node.saved), byHash=new Map();
    for(const node of nodes){ if(!byHash.has(node.hash))byHash.set(node.hash,[]); byHash.get(node.hash).push(node); }
    const visiting=new Set(), changes=[];
    function migrate(node) {
        if(node.provenance)return node;
        const link=copy.chronicle?.links?.[node.hash];
        if(!link || link.unverified || byHash.get(node.hash)?.length!==1 || visiting.has(node.hash))return null;
        visiting.add(node.hash);
        const inputs=(link.refs||[]).map(ref=>({kind:'legacy',ref:structuredClone(ref)}));
        for(const ref of link.children||[]){
            const candidates=byHash.get(ref.hash)||[];
            const child=candidates.length===1 ? migrate(candidates[0]) : null;
            if(!child){visiting.delete(node.hash);return null;}
            inputs.push({kind:'summary',id:child.id,hash:child.hash,revision:ref.revision,sourceSignature:inputSignature(child.provenance)});
        }
        visiting.delete(node.hash);
        if(!inputs.length)return null;
        node.id=newSummaryId(); node.contentHash=getHash(node.content||'');
        node.provenance={version:2,inputs};
        const record=copy[keys[['story','stage','epic'].indexOf(node.type)]].find(item=>item.hash===node.hash);
        Object.assign(record,{id:node.id,contentHash:node.contentHash,provenance:node.provenance});
        changes.push({kind:node.type,hash:node.hash,id:node.id}); return node;
    }
    nodes.forEach(migrate);
    registerSummaryChat(copy,chat);
    const graph=resolveSummaryGraph(copy);
    return {revision:summaryRepairRevision(state),changes,records:Object.fromEntries(keys.map(key=>[key,copy[key]])),
        unresolved:original.length-changes.length-original.filter(node=>node.provenance).length,
        rebuild:graph.nodes.filter(node=>node.saved&&!graph.result.get(node.key)?.valid).map(node=>({kind:node.type,hash:node.hash,reason:graph.result.get(node.key)?.reason}))};
}

export function applySummarySourceRepair(state,plan) {
    if(summaryRepairRevision(state)!==plan.revision)throw Error('预览后记忆已变化，请重新预览修复');
    for(const key of keys)state[key]=structuredClone(plan.records[key]||[]);
    invalidateSummaryGraph(state);
}
