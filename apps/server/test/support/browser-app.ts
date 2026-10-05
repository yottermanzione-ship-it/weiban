/** 浏览器端到端专用真实服务器；只允许独立weiban_test库，启动前重建。 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApp } from '../../src/main.js';
import { IdentityCommands } from '../../src/modules/identity/index.js';
import { BillingAdminService } from '../../src/modules/billing/testing.js';
import { newId, TestClock, loadConfig, createLogger } from '../../src/platform/index.js';
import { randomBytes } from 'node:crypto';
import { resetTestDatabase, requireTestDatabaseUrl } from './db-admin.js';
requireTestDatabaseUrl();
await resetTestDatabase();
const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: requireTestDatabaseUrl(),
  MEDIA_PUBLIC_BASE_URL: 'http://127.0.0.1:5173',
});
const fixture = await Test.createTestingModule({
  imports: [
    AppModule.forRoot({
      config,
      clock: new TestClock('2026-10-05T12:00:00.000Z'),
      kekRing: { currentVersion: 1, keys: new Map([[1, randomBytes(32)]]) },
      logger: createLogger({ level: 'silent' }),
      background: false,
    }),
  ],
}).compile();
const app = fixture.createNestApplication({ logger: false });
configureHttpApp(app, config);
await app.init();
const commands = app.get(IdentityCommands);
const admin = await commands.createAdmin('browser_admin', 'correct horse battery');
for (const [name, balance] of [
  ['browser_user', 50_000_000],
  ['browser_other', 1_000_000],
] as const) {
  const user = await commands.createAdmin(name, 'correct horse battery');
  await commands.setRole(name, 'user');
  await app.get(BillingAdminService).adjust(admin, user, {
    direction: 'grant',
    amountMicros: balance,
    reason: '浏览器测试赠送',
    idempotencyKey: newId(),
  });
}
await app.listen(3000, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => void app.close().then(() => process.exit(0)));
