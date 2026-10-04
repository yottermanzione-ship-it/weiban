/**
 * 把契约中所有 Zod schema 导出为 JSON Schema，供非 TypeScript 端（安卓 Kotlin）和文档使用。
 * 输出目录 packages/contracts/generated/（构建产物，不进仓库）。
 * 运行：pnpm --filter @weiban/contracts generate
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as contracts from '../src/index.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'generated');
mkdirSync(outDir, { recursive: true });

const result: Record<string, unknown> = {};
const skipped: string[] = [];

function collect(prefix: string, mod: Record<string, unknown>) {
  for (const [name, value] of Object.entries(mod)) {
    if (value instanceof z.ZodType) {
      try {
        result[`${prefix}${name}`] = z.toJSONSchema(value, { unrepresentable: 'any' });
      } catch {
        skipped.push(`${prefix}${name}`);
      }
    }
  }
}

collect('', contracts as unknown as Record<string, unknown>);
collect('Events.', contracts.Events as unknown as Record<string, unknown>);

writeFileSync(
  join(outDir, 'json-schema.json'),
  JSON.stringify({ contractVersion: contracts.CONTRACT_VERSION, schemas: result }, null, 2),
);

console.log(`导出 ${Object.keys(result).length} 个 schema 到 ${outDir}`);
if (skipped.length > 0) console.warn(`无法导出：${skipped.join(', ')}`);
