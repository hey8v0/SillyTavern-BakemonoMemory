const TRACKS = ['facts', 'claims', 'observations'];

export function assertLedgerVersion(core) {
    if (core?.schemaVersion !== 1 || ![1, 2, 3].includes(core?.ruleVersion)) throw new Error('不支持的剧情账本版本，只能只读查看');
    if (!core.baseline || !TRACKS.every(track => Array.isArray(core[track])) || !Array.isArray(core.decisions)) {
        throw new Error('剧情账本结构无效');
    }
}

export function createLedger(projection, floor = 0) {
    if (!Number.isSafeInteger(floor) || floor < 0) throw new Error('基线楼层无效');
    return {
        schemaVersion: 1, ruleVersion: 1, revision: 0,
        baseline: { floor, projection: structuredClone(projection) },
        facts: [], claims: [], observations: [], candidates: [], batches: [], decisions: [],
    };
}

function nextSequence(core) {
    if (!Number.isSafeInteger(core.revision) || core.revision < 0) throw new Error('账本修订无效');
    return core.revision + 1;
}

function recordPosition(core, context) {
    const floor = context?.floor, order = context?.order ?? floor;
    if (!Number.isSafeInteger(floor) || !Number.isFinite(order) || floor < core.baseline.floor) {
        throw new Error('记录位置无效');
    }
    if (order < core.baseline.floor) throw new Error('事实不能插入已确认基线之前');
    return { floor, order };
}

// These primitives operate on a transaction copy after domain validation.
export function appendRecord(core, event, context) {
    assertLedgerVersion(core);
    if (!TRACKS.includes(event?.track) || typeof event.action !== 'string' || !event.action) throw new Error('事件轨道或行为无效');
    const position = recordPosition(core, context);
    const sequence = nextSequence(core);
    const record = {
        id: 'rp-' + sequence, sequence, ...position,
        action: event.action, data: structuredClone(event.data || {}),
        ...(event.ruleVersion ? { ruleVersion: event.ruleVersion, protocolVersion: event.protocolVersion || 1 } : {}),
        context: event.context ?? 'current',
        evidence: event.evidence ? structuredClone(event.evidence) : null,
        ...(event.origin ? { origin: structuredClone(event.origin) } : {}),
        ...(event.change && typeof event.change === 'object' ? { change: structuredClone(event.change) } : {}),
        storyTime: event.storyTime || null, recordedAt: new Date().toISOString(),
    };
    core[event.track].push(record);
    core.revision = sequence;
    return structuredClone(record);
}

export function retractFact(core, factId, context) {
    assertLedgerVersion(core);
    if (!core.facts.some(fact => fact.id === factId)) throw new Error('事实不存在');
    const position = recordPosition(core, context);
    const sequence = nextSequence(core);
    const decision = { sequence, ...position, factId, action: 'retract',
        reason: String(context.reason || ''), recordedAt: new Date().toISOString() };
    core.decisions.push(decision);
    core.revision = sequence;
    return structuredClone(decision);
}

export function replayLedger(core, applyFact, { asOfFloor = Infinity, asOfSequence = Infinity } = {}) {
    assertLedgerVersion(core);
    if (asOfFloor < core.baseline.floor) return { available: false, projection: null, pending: [], applied: [] };
    const visible = record => record.floor <= asOfFloor && record.sequence <= asOfSequence;
    const retracted = new Set(core.decisions.filter(visible).filter(record => record.action === 'retract' || record.action === 'supersede').map(record => record.factId));
    let projection = structuredClone(core.baseline.projection);
    const pending = [], applied = [];
    const effective = core.facts.filter(visible).filter(fact => !retracted.has(fact.id));
    const newRuleOrders = new Set(effective.filter(fact => fact.ruleVersion >= 3).map(fact => fact.order));
    const ordered = effective.sort((a, b) => a.order - b.order || (newRuleOrders.has(a.order) ? Number(a.origin?.kind === 'user') - Number(b.origin?.kind === 'user') : 0) || a.sequence - b.sequence);
    for (const event of ordered) {
        try {
            const candidate = applyFact(structuredClone(projection), structuredClone(event));
            if (!candidate || typeof candidate !== 'object') throw new Error('规则没有返回有效状态');
            projection = candidate;
            applied.push(event.id);
        } catch (error) {
            pending.push({ factId: event.id, reason: String(error?.message || error) });
        }
    }
    return { available: true, projection, pending, applied };
}
