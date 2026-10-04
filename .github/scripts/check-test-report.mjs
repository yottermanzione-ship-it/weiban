// CI 专用：读 Vitest 的 JSON 测试报告，确认「需要数据库的集成测试真的跑了，没有被跳过」。
// 维护：运维负责人。说明见 docs/ops/ci.md 第二节。
//
// 为什么需要它：服务器集成测试在没有 TEST_DATABASE_URL 时会整组「跳过」，跳过不算失败，
// CI 依然是绿勾。这个脚本把「跳过」也当成失败，防止数据库没接上时悄悄漏测。
//
// 用法（在仓库根目录执行）：node .github/scripts/check-test-report.mjs <报告文件路径>
// 规则：
//   1. 任何测试的状态是 skipped / pending / todo → 失败（除非写进下面的 ALLOWED_SKIPS 并注明原因）；
//   2. apps/server/test/ 下（集成测试目录）实际通过的测试数必须大于 0；
//   3. 有失败的测试 → 失败（正常情况下前一步 pnpm test 已经失败，这里是兜底）。
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

// 允许跳过的测试（完整名称 → 原因）。目前没有。新增必须写清原因，并在交接说明里告诉运维负责人。
const ALLOWED_SKIPS = new Map([]);

const SERVER_INTEGRATION_DIR = 'apps/server/test/';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('用法：node .github/scripts/check-test-report.mjs <Vitest JSON 报告路径>');
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));

let total = 0;
let passed = 0;
let failed = 0;
let serverIntegrationPassed = 0;
const skipped = [];

for (const file of report.testResults ?? []) {
  const filePath = relative(process.cwd(), String(file.name ?? '')).replaceAll('\\', '/');
  const isServerIntegration = filePath.startsWith(SERVER_INTEGRATION_DIR);
  for (const test of file.assertionResults ?? []) {
    total += 1;
    if (test.status === 'passed') {
      passed += 1;
      if (isServerIntegration) serverIntegrationPassed += 1;
    } else if (test.status === 'failed') {
      failed += 1;
    } else {
      skipped.push({ name: test.fullName ?? test.title, file: filePath, status: test.status });
    }
  }
}

const unexpectedSkips = skipped.filter((t) => !ALLOWED_SKIPS.has(t.name));

console.log(`测试总数 ${total}：通过 ${passed}，失败 ${failed}，跳过 ${skipped.length}`);
console.log(`其中服务器集成测试（${SERVER_INTEGRATION_DIR}）通过 ${serverIntegrationPassed}`);
for (const t of skipped) {
  const reason = ALLOWED_SKIPS.get(t.name);
  console.log(`  [${reason ? '允许跳过' : '不允许跳过'}] ${t.status} ${t.name}（${t.file}）`);
  if (reason) console.log(`      原因：${reason}`);
}

const problems = [];
if (failed > 0) problems.push(`有 ${failed} 条测试失败`);
if (unexpectedSkips.length > 0) {
  problems.push(
    `有 ${unexpectedSkips.length} 条测试被跳过（多半是 TEST_DATABASE_URL 没设置或数据库没起来）`,
  );
}
if (serverIntegrationPassed === 0) {
  problems.push('服务器集成测试一条都没有通过（没有执行）');
}

if (problems.length > 0) {
  for (const p of problems) console.error(`失败：${p}`);
  process.exit(1);
}
console.log('通过：集成测试已实际执行，没有被跳过。');
