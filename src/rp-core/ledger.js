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

// `change` is only shown in the history view; replay never reads it, so it is not copied for every step.
function cloneForReplay(event) {
    const { change, ...rest } = event;
    return structuredClone(rest);
}

// One extraction accepts its candidates one by one and needs the state before and after each. Replaying the whole
// ledger for every step grows with the square of the story, so while only new facts are appended at the end of the
// order, they are applied on top of the last result. Anything else (a retraction, a fact placed earlier) replays in full.
export function createReplayCache(applyFact) {
    let last = null;
    const retractions = core => core.decisions.filter(record => record.action === 'retract' || record.action === 'supersede').length;
    // A rolled-back step can hand the next fact the same id, so the last fact is recognised by its content too.
    const mark = fact => fact ? JSON.stringify(cloneForReplay(fact)) : '';
    return core => {
        const retracts = retractions(core);
        if (last && last.retracts === retracts && core.facts.length >= last.count
            && (!last.count || mark(core.facts[last.count - 1]) === last.lastMark)) {
            const added = core.facts.slice(last.count).sort((a, b) => a.sequence - b.sequence);
            const appends = added.every(fact => fact.origin?.kind !== 'user' && fact.sequence > last.maxSequence
                && (fact.order > last.maxOrder || (fact.order === last.maxOrder && !last.userAtMax)));
            if (appends) {
                if (added.length) {
                    let projection = last.result.projection;
                    const pending = [...last.result.pending], applied = [...last.result.applied];
                    for (const event of added) {
                        try { projection = applyFact(structuredClone(projection), cloneForReplay(event)); applied.push(event.id); }
                        catch (error) { pending.push({ factId: event.id, reason: String(error?.message || error) }); }
                    }
                    const top = added.at(-1);
                    last = { ...last, count: core.facts.length, lastMark: mark(core.facts.at(-1)), maxSequence: top.sequence,
                        userAtMax: top.order === last.maxOrder && last.userAtMax, maxOrder: Math.max(last.maxOrder, ...added.map(fact => fact.order)),
                        result: { available: true, projection, pending, applied } };
                }
                return last.result;
            }
        }
        const result = replayLedger(core, applyFact);
        const maxOrder = Math.max(-Infinity, ...core.facts.map(fact => fact.order));
        last = { retracts, count: core.facts.length, lastMark: mark(core.facts.at(-1)), result, maxOrder,
            maxSequence: Math.max(-Infinity, ...core.facts.map(fact => fact.sequence)),
            userAtMax: core.facts.some(fact => fact.order === maxOrder && fact.origin?.kind === 'user') };
        return result;
    };
}

// Only the most recent floors keep their change-by-change detail; everything earlier is folded into the starting
// state, the way a film keeps its latest reels on the bench and files the rest. Without this the ledger, and the time
// to rebuild it after every reply, grow without bound on long stories.
export const RP_DETAIL_FLOORS = 300;
export const RP_FOLD_STEP = 100;
export function foldLedger(core, cutoff, applyFact) {
    assertLedgerVersion(core);
    if (!Number.isSafeInteger(cutoff) || cutoff <= core.baseline.floor) return core;
    const kept = record => (record.order ?? record.floor) >= cutoff;
    const folded = replayLedger({ ...core, facts: core.facts.filter(fact => !kept(fact)) }, applyFact);
    const projection = structuredClone(folded.projection);
    // Ended temporary states are history; the current state only needs the ones still running.
    for (const person of projection.people || []) person.states = (person.states || []).filter(item => !item.ended && item.endedAt == null);
    const raise = record => ({ ...record, floor: Math.max(record.floor, cutoff) });
    const facts = core.facts.filter(kept);
    const claims = core.claims.map(raise), observations = core.observations.map(raise);
    const candidates = core.candidates.filter(kept);
    const recordIds = new Set([...facts, ...claims, ...observations].map(record => record.id));
    const candidateIds = new Set(candidates.map(candidate => candidate.id));
    const decisions = core.decisions.filter(decision => decision.factId ? recordIds.has(decision.factId)
        : decision.candidateId ? candidateIds.has(decision.candidateId) : decision.floor >= cutoff).map(raise);
    return {
        ...core,
        baseline: { floor: cutoff, projection, startFloor: core.baseline.startFloor ?? core.baseline.floor, foldedAt: new Date().toISOString() },
        facts, claims, observations, candidates, decisions,
        batches: core.batches.filter(batch => (batch.sourceFloor ?? batch.floor) >= cutoff && batch.floor >= cutoff),
        ...(core.extractionJobs ? { extractionJobs: core.extractionJobs.filter(job => !Number.isInteger(job.sourceFloor) || job.sourceFloor >= cutoff) } : {}),
        ...(core.invalidations ? { invalidations: core.invalidations.filter(item => item.floor >= cutoff) } : {}),
    };
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
            const candidate = applyFact(structuredClone(projection), cloneForReplay(event));
            if (!candidate || typeof candidate !== 'object') throw new Error('规则没有返回有效状态');
            projection = candidate;
            applied.push(event.id);
        } catch (error) {
            pending.push({ factId: event.id, reason: String(error?.message || error) });
        }
    }
    return { available: true, projection, pending, applied };
}
