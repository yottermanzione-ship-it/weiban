/**
 * 表情包标签幂等回填 CLI（0154 建表配套；只写 media.library_sticker_labels）。
 * 默认只校验（三键核对）不写库；--apply 才写库。写库执行前须走总控批准的写路径。
 *
 * 用法（在 apps/server 目录）：
 *   pnpm --filter @weiban/server seed:sticker-labels -- --input /path/sticker-tags-20261031.jsonl
 *   pnpm --filter @weiban/server seed:sticker-labels -- --input /path/sticker-tags-20261031.jsonl --apply
 */
import { readFile } from 'node:fs/promises';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { loadConfig } from '../platform/config/config.js';
import { Database } from '../platform/db/database.js';
import { backfillStickerLabels, parseStickerLabelFile } from './seed-sticker-labels-options.js';

const USAGE = `用法：
  seed:sticker-labels -- --input <sticker-tags-20261031.jsonl 路径> [--apply]

默认只校验不写库（输出 valid / failures 清单）；--apply 才把校验通过的行幂等写入
media.library_sticker_labels。review_needed=true 的行写入时同时带 retry_excluded=true 标记。
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(USAGE);
    return;
  }
  let input: string | undefined;
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--input') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--input 需要一个文件路径');
      input = next;
      i++;
    } else {
      throw new Error(`未知参数 ${arg}；可用 --input、--apply、--help`);
    }
  }
  if (!input) throw new Error('缺少 --input <JSONL 路径>');
  const rows = parseStickerLabelFile(await readFile(input, 'utf8'));
  loadLocalEnv();
  const config = loadConfig();
  const db = new Database({ url: config.database.url, poolMax: 1 });
  try {
    const summary = await db.transaction(async (tx) => backfillStickerLabels(tx, rows, { apply }));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
