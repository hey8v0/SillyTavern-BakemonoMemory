import { findTargetContinuityGaps } from './target-selection.js';

export function stageAutomationStatus(state, materials, { batch = materials.targets, records = [], busy = false } = {}) {
    const auto = state.automation || {};
    const status = (code, title, detail = '', action = null) => ({ code, title, detail, action });
    if (!auto.enabled) return status('off', '自动总结已关闭');
    const hashes = new Set(batch.map(block => block.hash));
    const sameBatch = item => item.kind === 'stage' && hashes.size > 0 && item.sourceHashes?.length === hashes.size
        && item.sourceHashes.every(hash => hashes.has(hash));
    const task = (state.taskQueue || []).find(item => sameBatch(item) && ['queued', 'running', 'failed'].includes(item.status));
    const draft = (state.drafts || []).find(sameBatch);
    if (task?.status === 'running' && busy) return status('running', '正在生成阶段总结');
    if (draft && !draft.metadata?.inputError) return status('draft', '已生成，等待保存', '', { tab: 'drafts', label: '查看草稿' });
    if (task?.status === 'failed') return status('failed', '阶段总结失败', task.error || '请查看任务详情',
        state.taskQueuePaused ? { tab: 'drafts', label: '查看失败任务' } : { taskId: task.id, label: '重试总结' });
    if (state.taskQueuePaused) return status('paused', '总结队列已暂停', '', { tab: 'drafts', label: '查看队列' });
    if (task) return status('queued', '阶段总结已排队', '', { tab: 'drafts', label: '查看队列' });
    const ids = batch.flatMap(block => [block.messageId, ...(block.sourceMessageIds || [])]).filter(Number.isFinite);
    const selectedFloors = new Set(ids);
    const relevantIssues = materials.issues?.filter(issue => !ids.length || !issue.floors.length
        || issue.floors.some(id => id >= Math.min(...ids) && id <= Math.max(...ids) && !selectedFloors.has(id)));
    const invalid = relevantIssues ? relevantIssues.map(issue => issue.reason) : materials.invalid || [];
    if (invalid.length) return status('invalid', '本批摘要材料需要检查', invalid.slice(0, 3).join('；'),
        relevantIssues?.[0] ? { summaryKey: relevantIssues[0].key, summaryType: relevantIssues[0].type, label: '查看异常摘要' }
            : { tab: 'summary', label: '查看摘要' });
    const gaps = findTargetContinuityGaps(batch, records, { includeLeading: false });
    if (gaps.length) return status('gap', '缺少摘要，自动总结暂停', gaps.slice(0, 8).map(item => '第 ' + item.id + ' 楼').join('、'),
        { tab: 'scan', label: '检查缺失摘要' });
    const count = auto.triggerType === 'chars' ? materials.targets.reduce((n, b) => n + String(b.content || '').length, 0) : materials.targets.length;
    const threshold = auto.triggerType === 'chars' ? auto.charInterval || 12000 : auto.floorInterval || 10;
    if (count < threshold) return status('waiting', '还差 ' + (threshold - count).toLocaleString() + (auto.triggerType === 'chars' ? ' 字' : ' 条摘要'));
    if (busy) return status('busy', '等待当前处理完成');
    if (auto.mode === 'remind') return status('remind', '已达到提醒条件', '', { tab: 'summary', label: '前往总结' });
    return status('ready', '已就绪，等待执行', materials.issues?.length ? `另有 ${materials.issues.length} 条异常摘要，未用于本批` : '');
}
