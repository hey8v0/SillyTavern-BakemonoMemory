import {getHash, stripConfiguredTags, extractConfiguredTagBlocks, parseList, filterTextByConfiguredTags} from '../shared/text.js';
import {stripPostProcessNoise} from '../shared/prompt-utils.js';

const cache = new WeakMap();
const chats = new WeakMap();
const kindKeys = {story:'storySummaries',stage:'stageSummaries',epic:'epicSummaries'};
export const newSummaryId = () => 'summary-' + (globalThis.crypto?.randomUUID?.() || Date.now()+'-'+Math.random().toString(36).slice(2));
export const summaryKey = item => item?.id || item?.hash;
export const inputSignature = snapshot => getHash(JSON.stringify(snapshot || null));
export function registerSummaryChat(state, chat) { chats.set(state, chat); cache.delete(state); }
export function invalidateSummaryGraph(state) { cache.delete(state); }
export function summaryNodes(state) {
    const nodes = Object.entries(kindKeys).flatMap(([type,key]) => (state[key] || []).map(item => ({...item,type,saved:true})));
    for (const block of state.blocks || []) {
        if (!block?.hash || block.isGeneratedSummary || nodes.some(n => n.hash === block.hash && n.type === block.type)) continue;
        nodes.push({...block,type:block.type || 'story',saved:false});
    }
    return nodes;
}
const failure = (code, detail, path=[]) => ({valid:false,code,reason:detail,path});
const ok = () => ({valid:true,code:'valid',reason:'来源有效',path:[]});
const refFloor = ref => Number.isInteger(ref.floor) ? '第 '+ref.floor+' 楼' : '来源';
function checkSource(state, input) {
    const sources = state.chronicle?.sources || [];
    const source = sources.find(s => s.id === input.sourceId);
    const message = chats.get(state)?.[source?.floor];
    if (!source || !message) return failure('source_missing',refFloor(input)+'已删除或来源缺失');
    if (source.ambiguous) return failure('ambiguous_identity',refFloor(input)+'来源身份不唯一');
    if (String(source.variant ?? '') !== String(input.variant ?? '')) return failure('source_changed',refFloor(input)+'回复变体已变化');
    const text = stripConfiguredTags(message.mes || '',input.excludeTags || []).trim();
    let consumed = input.filter === 'turn-v1' ? stripPostProcessNoise(filterTextByConfiguredTags(message.mes || '', {excludeTags:input.excludeTags || [],includeTags:input.includeTags || []})) : text;
    if (input.kind === 'tag') {
        const matches = extractConfiguredTagBlocks(text,[input.tag]);
        if (matches.length !== input.tagCount) return failure('source_changed',refFloor(input)+'摘要标签数量变化');
        consumed = matches[input.ordinal]?.content;
    }
    if (typeof consumed !== 'string' || getHash(consumed) !== input.revision || consumed.length !== input.length)
        return failure('source_changed',refFloor(input)+'的实际输入版本变化');
    return ok();
}
export function resolveSummaryGraph(state) {
    const nodes = summaryNodes(state);
    const signature = getHash(JSON.stringify([nodes,state.chronicle?.sources,state.chronicle?.links]));
    if (cache.get(state)?.signature === signature) return cache.get(state);
    const byKey = new Map(), byHash = new Map();
    for (const node of nodes) {
        // Type is part of legacy identity, until explicit repair assigns stable IDs.
        node.key = node.id || node.type+':'+node.hash;
        if (!byHash.has(node.hash)) byHash.set(node.hash,[]);
        byHash.get(node.hash).push(node);
        if (byKey.has(node.key)) node.duplicate = true;
        else byKey.set(node.key,node);
    }
    const result = new Map(), checking = new Set(), edges = new Map();
    const find = input => input.id ? byKey.get(input.id) || nodes.find(n => n.id === input.id) : null;
    const check = node => {
        if (result.has(node.key)) return result.get(node.key);
        if (checking.has(node.key)) return failure('cycle','来源引用形成循环',[node.key]);
        if (checking.size > 500) return failure('depth_limit','来源层数超过安全检查范围',[node.key]);
        checking.add(node.key);
        let status = ok(); const children = [];
        const provenance = node.provenance;
        const link = state.chronicle?.links?.[node.hash];
        if (node.duplicate || (byHash.get(node.hash)?.length > 1 && !node.id)) {
            status = failure('ambiguous_identity','相同文字的多条记录共用了旧身份，请预览来源修复',[node.key]);
        } else if (provenance) {
            if (provenance.version !== 2 || !Array.isArray(provenance.inputs) || !provenance.inputs.length) status = failure('unknown_version','来源版本无法识别或缺少输入',[node.key]);
            else {
                for (const input of provenance.inputs) {
                    let childStatus;
                    if (input.kind === 'summary') {
                        const child = find(input);
                        if (!child) childStatus = failure('child_missing','下层摘要已删除或缺失',[input.id]);
                        else {
                            children.push(child);
                            childStatus = check(child);
                            if (childStatus.valid && (getHash(child.content || '') !== input.revision
                                || inputSignature(child.provenance || state.chronicle?.links?.[child.hash]?.binding) !== input.sourceSignature))
                                childStatus = failure('source_changed','下层摘要输入版本已变化',[child.key]);
                        }
                    } else if (['tag','body'].includes(input.kind)) childStatus = checkSource(state,input);
                    else if (input.kind === 'legacy') childStatus = checkLegacyRef(input.ref);
                    else childStatus = failure('source_unknown','来源类型无法核实');
                    if (!childStatus.valid && status.valid) status = failure(input.kind==='summary'?'child_stale':childStatus.code,
                        (input.kind==='summary'?'下层摘要需重建 → ':'')+childStatus.reason,[node.key,...childStatus.path]);
                }
            }
        } else if (node.saved && link) {
            if (link.unverified) status = failure('source_unknown','旧记录没有可核验的生成输入，请从底层重新生成',[node.key]);
            for (const ref of link.refs || []) {
                const checked = checkLegacyRef(ref);
                if (!checked.valid && status.valid) status = {...checked,path:[node.key]};
            }
            for (const ref of link.children || []) {
                const matches = byHash.get(ref.hash) || [];
                const child = matches.length === 1 ? matches[0] : null;
                if (!child) { if(status.valid) status=failure(matches.length?'ambiguous_identity':'child_missing','下层摘要缺失或身份不唯一',[node.key,ref.hash]); continue; }
                children.push(child);
                const checked = check(child);
                if (!checked.valid && status.valid) status=failure('child_stale','下层摘要需重建 → '+checked.reason,[node.key,...checked.path]);
                else if(getHash(child.content||'')!==ref.revision && status.valid) status=failure('source_changed','下层摘要内容已变化',[node.key,child.key]);
            }
        } else if (node.saved && state.chronicle) status = failure('source_unknown','旧记录来源尚未核验，请从底层重新生成',[node.key]);
        // Freshly scanned material belongs to the current scan, not the persistent legacy links.
        checking.delete(node.key); edges.set(node.key,children);
        result.set(node.key,status); return status;
    };
    function checkLegacyRef(ref) {
        const source=state.chronicle?.sources?.find(s=>s.id===ref.id);
        if (!source) return failure('source_missing',refFloor(ref)+'来源缺失');
        if (source.ambiguous) return failure('ambiguous_identity',refFloor(ref)+'来源身份不唯一');
        if (source.floor !== ref.floor || (ref.memoryRevision ? source.memoryRevision !== ref.memoryRevision : source.revision !== ref.revision))
            return failure('source_changed',refFloor(ref)+'的原输入版本变化');
        return ok();
    }
    nodes.forEach(check);
    const coveredBy = new Map(), coveredStoryHashes=new Set(), coveredStageHashes=new Set(), coveredEpicHashes=new Set();
    const cover = (parent,child) => {
        if (parent.key === child.key || !result.get(parent.key)?.valid || !result.get(child.key)?.valid) return;
        if(!coveredBy.has(child.key))coveredBy.set(child.key,[]);
        if(!coveredBy.get(child.key).includes(parent.key))coveredBy.get(child.key).push(parent.key);
        ({story:coveredStoryHashes,stage:coveredStageHashes,epic:coveredEpicHashes}[child.type])?.add(child.hash);
    };
    for (const parent of nodes.filter(n=>['stage','epic'].includes(n.type) && result.get(n.key)?.valid)) {
        for (const child of edges.get(parent.key) || []) cover(parent,child);
        const hashes = parent.provenance
            ? parent.provenance.inputs.filter(i=>i.kind!=='summary').map(i=>i.hash).filter(Boolean)
            : [...(parent.sourceHashes||[]),...(parent.sourceStageHashes||[])];
        for(const hash of hashes) {
            const children=byHash.get(hash)||[];
            if(children.length===1)cover(parent,children[0]);
            else if(!children.length && parent.type==='stage')coveredStoryHashes.add(hash);
        }
        // A floor shift can change scan hashes, but only the same identified source and consumed block match.
        for(const input of parent.provenance?.inputs || []) if(input.kind==='tag'||input.kind==='body'){
            const source=state.chronicle?.sources?.find(s=>s.id===input.sourceId);
            for(const child of nodes) if(!child.saved && child.messageId===source?.floor && getHash(child.content||'')===input.revision)cover(parent,child);
        }
    }
    const graph = {signature,nodes,byKey,byHash,result,edges,coveredBy,coveredStoryHashes,coveredStageHashes,coveredEpicHashes};
    cache.set(state,graph); return graph;
}
export function getSummaryStatus(state,item,graph=resolveSummaryGraph(state)) {
    const node=(item?.id && graph.byKey.get(item.id)) || graph.nodes.find(n=>n.hash===item?.hash && (!item?.type || n.type===item.type));
    const status=node ? graph.result.get(node.key) : (state.chronicle?.links?.[item?.hash] || item?.provenance || item?.isGeneratedSummary) ? failure('source_missing','摘要记录已移除') : ok();
    const coveredBy=node ? graph.coveredBy.get(node.key)||[] : [];
    return {...status,coveredBy,reason:!status.valid?status.reason:coveredBy.length?'已由 '+coveredBy.map(key=>graph.byKey.get(key)?.title||'上层总结').join('、')+' 覆盖，原记录保留':status.reason};
}
export function captureSummaryInputs(state,chat,blocks,chatId='') {
    const graph=resolveSummaryGraph(state), inputs=[];
    for(const block of blocks){
        const saved=graph.nodes.filter(n=>n.saved && n.hash===block.hash && (!block.type||n.type===block.type));
        if(saved.length>1)throw Error('来源身份不唯一，请先预览修复');
        if(saved.length===1){
            const node=saved[0],status=graph.result.get(node.key);
            if(!status.valid)throw Error('来源需重建：'+status.reason);
            inputs.push({kind:'summary',id:node.key,hash:node.hash,revision:getHash(node.content||''),sourceSignature:inputSignature(node.provenance || state.chronicle?.links?.[node.hash]?.binding)});
            continue;
        }
        const source=state.chronicle?.sources?.[block.messageId];
        if(!source || source.ambiguous)throw Error('正文来源缺失或身份不唯一');
        const excludeTags=Array.isArray(block.sourceExcludeTags)?block.sourceExcludeTags:parseList(state.scanRules?.excludeTags);
        const text=stripConfiguredTags(chat[block.messageId]?.mes||'',excludeTags).trim();
        const input={kind:'body',sourceId:source.id,floor:block.messageId,variant:source.variant||'',excludeTags,revision:getHash(block.content||''),length:String(block.content||'').length,hash:block.hash};
        if(block.sourceFilter)Object.assign(input,{filter:block.sourceFilter,includeTags:block.sourceIncludeTags || []});
        if(block.sourceKind==='tag' || (block.matchedTag && block.matchedTag!=='全文')){
            const matches=extractConfiguredTagBlocks(text,[block.matchedTag]);
            const same=matches.map((m,i)=>m.content===block.content?i:-1).filter(i=>i>=0);
            if(same.length!==1)throw Error('第 '+block.messageId+' 楼摘要标签无法唯一定位');
            Object.assign(input,{kind:'tag',tag:block.matchedTag,ordinal:same[0],tagCount:matches.length});
        }
        const checked=checkSource(state,input); if(!checked.valid)throw Error('来源需重建：'+checked.reason);
        inputs.push(input);
    }
    if(!inputs.length)throw Error('没有可核验的来源材料');
    return {version:2,chatId,inputs};
}
export function validateSummaryInputs(state,snapshot,chatId='') {
    if(!snapshot || snapshot.version!==2 || !Array.isArray(snapshot.inputs))throw Error('草稿缺少生成输入快照，请重新选择材料生成；原草稿已保留');
    if(snapshot.chatId && chatId && snapshot.chatId!==chatId)throw Error('聊天已切换，旧草稿不能绑定当前聊天');
    const graph=resolveSummaryGraph(state);
    for(const input of snapshot.inputs){
        if(input.kind==='summary'){
            const node=graph.byKey.get(input.id);
            if(!node)throw Error('来源摘要已删除，请从底层重建');
            const status=graph.result.get(node.key);
            if(!status.valid)throw Error('来源需重建：'+status.reason);
            if(getHash(node.content||'')!==input.revision || inputSignature(node.provenance || state.chronicle?.links?.[node.hash]?.binding)!==input.sourceSignature)
                throw Error('生成输入摘要已变化，原草稿保留，请重新生成');
        }else{
            const checked=checkSource(state,input); if(!checked.valid)throw Error('来源需重建：'+checked.reason);
        }
    }
    return true;
}
export function summaryDiagnostic(state) {
    const graph=resolveSummaryGraph(state);
    return {format:'bakemono-summary-sources',version:2,records:graph.nodes.filter(n=>n.saved).map(n=>({
        id:n.key,kind:n.type,hash:n.hash,contentRevision:getHash(n.content||''),floors:n.sourceMessageIds||[],
        status:graph.result.get(n.key)?.code,reasonPath:graph.result.get(n.key)?.path,
        children:(graph.edges.get(n.key)||[]).map(c=>c.key),coveredBy:graph.coveredBy.get(n.key)||[],
    }))};
}
