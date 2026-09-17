const clone=value=>value===undefined?undefined:structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const key=value=>value && typeof value==='object' ? value.id || value.hash : JSON.stringify(value);

// Inverse only the fields still equal to this operation's prepared values.
export function undoSummaryChanges(before,prepared,current) {
    if(same(before,prepared))return current;
    if(same(current,prepared))return clone(before);
    if([before,prepared,current].every(Array.isArray)){
        if(![before,prepared,current].every(values=>values.every(v=>key(v)!==undefined)&&new Set(values.map(key)).size===values.length))return current;
        const old=new Map(before.map(v=>[key(v),v])), next=new Map(prepared.map(v=>[key(v),v])), live=new Map(current.map(v=>[key(v),v]));
        for(const id of new Set([...old.keys(),...next.keys()])){
            const value=undoSummaryChanges(old.get(id),next.get(id),live.get(id));
            if(value===undefined)live.delete(id);else live.set(id,value);
        }
        return [...live.values()];
    }
    if([before,prepared,current].every(v=>v&&typeof v==='object'&&!Array.isArray(v))){
        const result={...current};
        for(const name of new Set([...Object.keys(before),...Object.keys(prepared)])){
            const value=undoSummaryChanges(before[name],prepared[name],current[name]);
            if(value===undefined)delete result[name];else result[name]=value;
        }
        return result;
    }
    return current;
}
