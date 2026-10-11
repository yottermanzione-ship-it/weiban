import { readFile, writeFile } from 'node:fs/promises';
import { parseObservationLines } from './observations.js';
import { summarizeEvalRun } from './run.js';

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const [input, output] = args;
  if (!input || args.length > 2) throw new Error('用法：summarize <观察JSONL文件> [汇总JSON文件]');
  const report = summarizeEvalRun(parseObservationLines(await readFile(input, 'utf8')));
  const result = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(output, result, { flag: 'wx' });
  else process.stdout.write(result);
  // 此0只表示当前登记题，不是完整19类、产品许可或独立验收。
  process.exitCode =
    report.status === 'passed_registered_cases' ? 0 : report.status === 'needs_review' ? 2 : 1;
}
void main().catch((error: unknown) => {
  process.stderr.write(`评测汇总失败：${error instanceof Error ? error.message : '未知错误'}\n`);
  process.exitCode = 1;
});
