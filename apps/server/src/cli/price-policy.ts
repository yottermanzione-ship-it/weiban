/** 已批准定价规则的受控发布入口：默认只读计数；--apply 才复制发布新价目。 */
import 'reflect-metadata';
import pg from 'pg';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { PriceService } from '../modules/billing/index.js';
import { createLogger, loadConfig } from '../platform/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.some((arg) => arg !== '--apply') || args.length > 1)
    throw new Error('Invalid arguments');
  loadLocalEnv();
  const config = loadConfig();
  const client = new pg.Client({ connectionString: config.database.url });
  const counts = async () =>
    (
      await client.query<{ total: number; mismatched: number }>(
        `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE i.price_micros <> ceil(i.cost_micros::numeric * 13 / 10))::int AS mismatched
     FROM billing.price_items i JOIN billing.price_versions v ON v.id=i.price_version_id
     WHERE v.status='active'`,
      )
    ).rows[0]!;
  await client.connect();
  try {
    const before = await counts();
    if (!args.includes('--apply')) {
      process.stdout.write(`${JSON.stringify({ ok: true, applied: false, ...before })}\n`);
      return;
    }
    const logger = createLogger({ level: 'warn' });
    const app = await NestFactory.createApplicationContext(
      AppModule.forRoot({ config, logger, background: false }),
      { logger: new NestPinoLogger(logger) },
    );
    try {
      const result = await app.get(PriceService, { strict: false }).publishCostPlusPolicy();
      const after = await counts();
      process.stdout.write(
        `${JSON.stringify({ ok: after.mismatched === 0, applied: true, before, after, ...result })}\n`,
      );
      if (after.mismatched) process.exitCode = 1;
    } finally {
      await app.close();
    }
  } finally {
    await client.end();
  }
}

main().catch(() => {
  // 不输出原始错误对象，连接字符串及环境配置不可进入日志。
  process.stderr.write('{"ok":false,"code":"PRICE_POLICY_FAILED"}\n');
  process.exitCode = 1;
});
