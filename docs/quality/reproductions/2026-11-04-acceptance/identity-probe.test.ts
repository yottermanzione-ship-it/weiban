/** 账号并发验收：真实服务、真实数据库，仅控制校验完成后的调度时序。凭据仅在内存。 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { Test } from '@nestjs/testing';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { AppModule } from '../../../../apps/server/src/app.module.js';
import { configureHttpApp } from '../../../../apps/server/src/main.js';
import {
  AccountService,
  PASSWORD_HASHER,
} from '../../../../apps/server/src/modules/identity/application/accounts.js';
import { IdentityCommands } from '../../../../apps/server/src/modules/identity/index.js';
import { SettingsService } from '../../../../apps/server/src/modules/identity/application/settings.js';
import { DeletionService } from '../../../../apps/server/src/modules/identity/application/deletion.js';
import { PasswordHasher } from '../../../../apps/server/src/modules/identity/infra/password-hasher.js';
import {
  DATABASE,
  EVENT_DISPATCHER,
  JOB_QUEUE,
  TestClock,
  type Database,
} from '../../../../apps/server/src/platform/index.js';
import { resetTestDatabase } from '../../../../apps/server/test/support/db.js';
import {
  captureLogger,
  testConfig,
  testKekRing,
} from '../../../../apps/server/test/support/fixtures.js';
const serverRequire = createRequire(
  new URL('../../../../apps/server/package.json', import.meta.url),
);
let app: any, db: Database, accounts: AccountService, commands: IdentityCommands;
let hasher: PasswordHasher, baseUrl: string;
const device = {
  platform: 'web' as const,
  name: 'Synthetic QA',
  appVersion: 'qa',
  timeZone: 'Asia/Shanghai',
};
beforeAll(async () => {
  if (new URL(process.env.TEST_DATABASE_URL ?? '').pathname !== '/wbqa_identityprobe_20261104')
    throw new Error('QA identity probe requires its own named database');
  await resetTestDatabase();
  const config = testConfig();
  const fixture = await Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        config,
        clock: new TestClock('2026-11-04T09:00:00Z'),
        logger: captureLogger().logger,
        kekRing: testKekRing().ring,
        background: false,
      }),
    ],
  }).compile();
  app = fixture.createNestApplication({ logger: false });
  configureHttpApp(app, config);
  await app.init();
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  db = app.get(DATABASE);
  accounts = app.get(AccountService);
  commands = app.get(IdentityCommands);
  hasher = app.get(PASSWORD_HASHER);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await app?.close();
});
function signal() {
  let release!: () => void;
  return {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
}

it('改过微伴号的账号注销后，审计中不应残留改名前后的明文账号名', async () => {
  const name = 'qa_alias_before',
    alias = 'qa_alias_after',
    password = randomBytes(24).toString('hex');
  const id = await commands.createAdmin(name, password);
  await commands.setRole(name, 'user');
  await app.get(SettingsService).updateAlias(id, alias);
  await app.get(JOB_QUEUE).start();
  await accounts.requestDeletion(id, password);
  const dispatcher = app.get(EVENT_DISPATCHER);
  await vi.waitFor(
    async () => {
      await dispatcher.dispatchOnce();
      const remaining = await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM identity.users WHERE id=$1',
        [id],
      );
      expect(Number(remaining.rows[0]?.n)).toBe(0);
    },
    { timeout: 90_000, interval: 200 },
  );
  await app.get(DeletionService).scrubTraces(id);
  const report = await commands.verifyPurgedReport(id);
  const remaining = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM platform.audit_log WHERE details->>'username'=$1 OR details->>'previous'=$2`,
    [alias, name],
  );
  const namesRemaining = Number(remaining.rows[0]?.n);
  console.log(
    JSON.stringify({
      probe: 'alias-after-deletion',
      verifierOk: report.ok,
      blockingRemnants: report.checks.filter((c) => c.blocking && c.count > 0).length,
      auditRowsWithNames: namesRemaining,
    }),
  );
  expect(namesRemaining).toBe(0);
}, 120_000);
for (const legacy of [false, true]) {
  it(`${legacy ? '旧版迁入' : '新建'}账号重置密码后，在途旧密码登录不得取得有效会话或覆盖新密码`, async () => {
    const name = legacy ? 'qa_race_legacy' : 'qa_race_current';
    const oldPassword = randomBytes(24).toString('hex'),
      newPassword = randomBytes(24).toString('hex');
    const id = await commands.createAdmin(name, oldPassword);
    await commands.setRole(name, 'user');
    if (legacy) {
      const hash = await serverRequire('@node-rs/bcrypt').hash(oldPassword, {
        cost: 4,
        version: '2a',
      });
      await db.query('UPDATE identity.users SET password_hash=$1 WHERE id=$2', [hash, id]);
    }
    const verified = signal(),
      resume = signal(),
      original = hasher.verify.bind(hasher);
    const spy = vi.spyOn(hasher, 'verify').mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      verified.release();
      await resume.promise;
      return result;
    });
    const pending = accounts.login(
      { username: name, password: oldPassword, kind: 'app', device },
      '192.0.2.10',
    );
    try {
      await verified.promise;
      await commands.resetPassword(name, newPassword);
    } finally {
      resume.release();
    }
    const raced = await pending.then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    );
    spy.mockRestore();
    let oldSessionAccepted = false;
    if (raced.ok) {
      const result = await fetch(`${baseUrl}/api/v1/me`, {
        headers: { Authorization: `Bearer ${raced.value.session.token}` },
      });
      oldSessionAccepted = result.status === 200;
      await result.arrayBuffer();
    }
    const loginWorks = async (password: string) =>
      accounts.login({ username: name, password, kind: 'app', device }, '192.0.2.11').then(
        () => true,
        () => false,
      );
    const newPasswordAccepted = await loginWorks(newPassword),
      oldPasswordAccepted = await loginWorks(oldPassword);
    const outcome = { legacy, oldSessionAccepted, newPasswordAccepted, oldPasswordAccepted };
    console.log(JSON.stringify({ probe: 'password-reset-race', ...outcome }));
    expect(outcome).toEqual({
      legacy,
      oldSessionAccepted: false,
      newPasswordAccepted: true,
      oldPasswordAccepted: false,
    });
  });
}
