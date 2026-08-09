export function buildTableRollbackPlan(undoStack = [], messageIds = [], profileKey = '') {
    const affectedIds = new Set((Array.isArray(messageIds) ? messageIds : [])
        .map(Number)
        .filter(id => Number.isInteger(id) && id >= 0));
    if (!affectedIds.size) {
        return null;
    }

    const relevant = (Array.isArray(undoStack) ? undoStack : []).filter(snapshot => (
        snapshot && (!profileKey || !snapshot.profileKey || snapshot.profileKey === profileKey)
    ));
    const affectedPositions = relevant
        .map((snapshot, index) => ({
            index,
            affected: (Array.isArray(snapshot.sourceMessageIds) ? snapshot.sourceMessageIds : [])
                .map(Number)
                .some(id => affectedIds.has(id)),
        }))
        .filter(item => item.affected)
        .map(item => item.index);
    if (!affectedPositions.length) {
        return null;
    }

    const cutoff = Math.max(...affectedPositions);
    const rollbackSnapshots = relevant.slice(0, cutoff + 1);
    const affectedSnapshotIds = new Set(rollbackSnapshots
        .filter(snapshot => (Array.isArray(snapshot.sourceMessageIds) ? snapshot.sourceMessageIds : [])
            .map(Number)
            .some(id => affectedIds.has(id)))
        .map(snapshot => snapshot.id));
    const cascadedSourceMessageIds = [...new Set(rollbackSnapshots
        .filter(snapshot => !affectedSnapshotIds.has(snapshot.id))
        .flatMap(snapshot => Array.isArray(snapshot.sourceMessageIds) ? snapshot.sourceMessageIds : [])
        .map(Number)
        .filter(id => Number.isInteger(id) && id >= 0))]
        .sort((a, b) => a - b);
    const cascadedSnapshotIds = rollbackSnapshots
        .filter(snapshot => !affectedSnapshotIds.has(snapshot.id))
        .map(snapshot => snapshot.id);

    return {
        restoreSnapshot: relevant[cutoff],
        rollbackSnapshotIds: rollbackSnapshots.map(snapshot => snapshot.id),
        affectedSnapshotIds: [...affectedSnapshotIds],
        cascadedSnapshotIds,
        cascadedSourceMessageIds,
    };
}
