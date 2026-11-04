/** Q027：真实验密后的在途请求不能跨过密码重置，合法并发升级仍能登录。 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash as bcryptHash } from '@node-rs/bcrypt';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  AccountService,
  PASSWORD_HASHER,
  SettingsService,
  type PasswordHasher,
} from '../src/modules/identity/testing.js';
import {
  DATABASE,
  SESSION_VERIFIER,
  TestClock,
  type Database,
  type SessionVerifier,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const device = {
  platform: 'web' as const,
  name: 'Credential race test',
  appVersion: 'test',
  timeZone: 'Asia/Shanghai',
};

describeDb('Q027 凭据使用与重置串行化', () => {
  let app: INestApplication;
  let database: Database;
  let accounts: AccountService;
  let commands: IdentityCommands;
  let hasher: PasswordHasher;
  let sessions: SessionVerifier;
  let sequence = 0;

  beforeAll(async () => {
    await resetTestDatabase();
    const fixture = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig(),
          clock: new TestClock('2026-11-04T09:00:00Z'),
          logger: captureLogger().logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = fixture.createNestApplication({ logger: false });
    await app.init();
    database = app.get(DATABASE);
    accounts = app.get(AccountService);
    commands = app.get(IdentityCommands);
    hasher = app.get(PASSWORD_HASHER);
    sessions = app.get(SESSION_VERIFIER);
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  function login(username: string, password: string, kind: 'app' | 'admin' = 'app') {
    return accounts.login({ username, password, kind, device }, '192.0.2.40');
  }

  async function user(legacy = false) {
    const username = `credential_race_${++sequence}`;
    const password = randomBytes(24).toString('hex');
    const result = await accounts.register({ username, password, device }, '192.0.2.41');
    const id = result.response.user.userId;
    if (legacy)
      await database.query('UPDATE identity.users SET password_hash=$1 WHERE id=$2', [
        await bcryptHash(password, { cost: 4, version: '2a' }),
        id,
      ]);
    return { username, password, id };
  }

  /** 只暂停第一次真实校验完成后的返回；不替换数据库或密码算法。 */
  async function interleave<T>(operation: () => Promise<T>, during: () => Promise<unknown>) {
    let verified!: () => void;
    const ready = new Promise<void>((resolve) => {
      verified = resolve;
    });
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const original = hasher.verify.bind(hasher);
    const spy = vi.spyOn(hasher, 'verify').mockImplementationOnce(async (...args) => {
      const valid = await original(...args);
      verified();
      await gate;
      return valid;
    });
    const pending = operation().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      await Promise.race([
        ready,
        pending.then(() => {
          throw new Error('Operation ended before password verification');
        }),
      ]);
      await during();
    } finally {
      resume();
    }
    try {
      return await pending;
    } finally {
      spy.mockRestore();
    }
  }

  it.each([false, true])('重置密码拒绝在途旧密码登录，保留新密码（旧版=%s）', async (legacy) => {
    const u = await user(legacy);
    const newPassword = randomBytes(24).toString('hex');
    // 历史登录名与改后的别名都必须受同一凭据边界保护。
    const alias = `${u.username}_alias`;
    await app.get(SettingsService).updateAlias(u.id, alias);
    const result = await interleave(
      () => login(alias.toUpperCase(), u.password),
      () => commands.resetPassword(u.username, newPassword),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_credentials' } });
    await expect(login(u.username, u.password)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    const current = await login(alias, newPassword);
    expect(await sessions.verify(current.session.token, 'user')).toMatchObject({ userId: u.id });
  });

  it('注册重试不能用重置前的密码重新取得会话', async () => {
    const u = await user();
    const next = randomBytes(24).toString('hex');
    const result = await interleave(
      () => accounts.register({ username: u.username, password: u.password, device }, '192.0.2.42'),
      () => commands.resetPassword(u.username, next),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'username_taken' } });
    const retry = await accounts.register(
      { username: u.username, password: next, device },
      '192.0.2.42',
    );
    expect(retry.created).toBe(false);
    expect(await sessions.verify(retry.response.session.token, 'user')).toMatchObject({
      userId: u.id,
    });
  });

  it('旧密码已校验的注销申请不能越过重置继续删除账号', async () => {
    const u = await user();
    const next = randomBytes(24).toString('hex');
    const result = await interleave(
      () => accounts.requestDeletion(u.id, u.password),
      () => commands.resetPassword(u.username, next),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_credentials', status: 403 },
    });
    const state = await database.query<{ status: string }>(
      'SELECT status FROM identity.users WHERE id=$1',
      [u.id],
    );
    expect(state.rows[0]?.status).toBe('active');
    const current = await login(u.username, next);
    expect(await sessions.verify(current.session.token, 'user')).toMatchObject({ userId: u.id });
    await accounts.requestDeletion(u.id, next);
    expect(await sessions.verify(current.session.token, 'user')).toBeNull();
  });

  it('另一笔合法登录升级旧哈希后，在途同密码登录仍然成功', async () => {
    const u = await user(true);
    const result = await interleave(
      () => login(u.username, u.password),
      async () => {
        const second = await login(u.username, u.password);
        expect(await sessions.verify(second.session.token, 'user')).toMatchObject({ userId: u.id });
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(await sessions.verify(result.value.session.token, 'user')).toMatchObject({
        userId: u.id,
      });
  });

  it('管理员降级后，在途登录不能再创建管理会话', async () => {
    const u = await user();
    await commands.setRole(u.username, 'admin');
    const result = await interleave(
      () => login(u.username, u.password, 'admin'),
      () => commands.setRole(u.username, 'user'),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const current = await login(u.username, u.password);
    expect(current.user.role).toBe('user');
  });
});
