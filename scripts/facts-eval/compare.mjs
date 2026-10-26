// Two evaluation results side by side: node scripts/facts-eval/compare.mjs before.json after.json
// Prints what changed: scenarios, key facts, wrong facts, recall, flows and cost.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function compareReports(a, b) {
    const lines = [`对比：${a.name}（${a.model}，${a.floors ?? '?'} 楼） → ${b.name}（${b.model}，${b.floors ?? '?'} 楼）`];
    const row = (label, x, y, better = 'up') => {
        const delta = Number(y) - Number(x);
        const mark = !delta ? '=' : (delta > 0) === (better === 'up') ? '↑ 更好' : '↓ 更差';
        lines.push(`${label}：${x} → ${y}  ${mark}`);
    };
    row('场景通过', a.passed, b.passed);
    if (a.keyFacts && b.keyFacts) row('关键事实', a.keyFacts.hit, b.keyFacts.hit);
    if (a.wrongFacts && b.wrongFacts) row('错误事实', a.wrongFacts.hit, b.wrongFacts.hit, 'down');
    row('无据新增卡', a.unknownCards?.length ?? 0, b.unknownCards?.length ?? 0, 'down');
    if (a.recall && b.recall) row('召回命中（用卡片）', a.recall.withFacts, b.recall.withFacts);
    row('请求次数', a.metrics?.requests ?? 0, b.metrics?.requests ?? 0, 'down');
    const tokens = r => r.metrics?.promptTokens ? r.metrics.promptTokens + r.metrics.completionTokens : r.metrics?.tokensEstimated ?? 0;
    row('Token', tokens(a), tokens(b), 'down');
    const byId = new Map((a.results || []).map(r => [String(r.id), r]));
    for (const r of b.results || []) {
        const before = byId.get(String(r.id));
        if (!before) lines.push(`  新检查 ${r.id} ${r.ok ? '✔' : '✖'} ${r.name}`);
        else if (before.ok !== r.ok) lines.push(`  ${r.ok ? '修好了' : '变坏了'} ${r.id} ${r.name}`);
    }
    return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [first, second] = process.argv.slice(2);
    if (!first || !second) { console.error('用法：node scripts/facts-eval/compare.mjs 之前.json 之后.json'); process.exit(2); }
    const [a, b] = await Promise.all([first, second].map(async file => JSON.parse(await readFile(file, 'utf8'))));
    console.log(compareReports(a, b));
}
