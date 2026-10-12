// 从 docs/ai/samples/S-*.md 抽出每张样本卡的第一个 ```json 代码块，生成
// src/cli/preset-seed/samples.generated.ts，供预设角色种子（src/cli/seed-presets.ts）打包进生产镜像。
// 样本卡的唯一来源仍是 docs/ai/samples；改了样本卡后在 apps/server 下运行 `pnpm seed:presets:gen` 重新生成。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(here, '../../../docs/ai/samples');
const out = join(here, '../src/cli/preset-seed/samples.generated.ts');

const files = readdirSync(samplesDir)
  .filter((name) => /^S-\d+.*\.md$/.test(name))
  .sort();
const samples = files.map((name) => {
  const text = readFileSync(join(samplesDir, name), 'utf8');
  const match = /```json\r?\n([\s\S]*?)\r?\n```/.exec(text);
  if (!match) throw new Error(`${name} 没有 json 代码块`);
  return { source: `docs/ai/samples/${name}`, ...JSON.parse(match[1]) };
});

writeFileSync(
  out,
  `// 由 apps/server/scripts/gen-preset-samples.mjs 从 docs/ai/samples 生成，请勿手改。\n` +
    `export const SAMPLE_PRESETS: readonly unknown[] = ${JSON.stringify(samples, null, 2)};\n`,
);
process.stdout.write(`已生成 ${samples.length} 张样本卡 → ${out}\n`);
