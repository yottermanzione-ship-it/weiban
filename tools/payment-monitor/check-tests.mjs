import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = resolve(import.meta.dirname, 'app/build/test-results/testDebugUnitTest');
const files = readdirSync(dir).filter((f) => f.endsWith('.xml'));
let count = 0;
for (const file of files) {
  const xml = readFileSync(resolve(dir, file), 'utf8');
  count += Number(xml.match(/<testsuite[^>]*\btests="(\d+)"/)?.[1] ?? 0);
  for (const field of ['failures', 'errors', 'skipped']) {
    if (Number(xml.match(new RegExp(`<testsuite[^>]*\\b${field}="(\\d+)"`))?.[1] ?? 0))
      throw Error('Monitor tests failed or skipped');
  }
}
for (const suite of [
  'ReceiptParserTest',
  'QueueStoreTest',
  'RetryJobTest',
  'StartupTest',
  'ListenerLifecycleTest',
]) {
  if (!files.some((file) => file.endsWith(`.${suite}.xml`)))
    throw Error(`Monitor test suite missing: ${suite}`);
}
if (count < 42) throw Error('Monitor tests did not run');
console.log(`Payment monitor: ${count} tests, zero failures/skips`);
