import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthResponse } from '@weiban/contracts';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { throttleKey } from '../src/modules/identity/testing.js';
import { DATABASE, TestClock, type Database } from '../src/platform/index.js';
import { NestPinoLogger } from '../src/platform/logging/nest-logger.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const device = { platform: 'web', name: 'reset-test', appVersion: '1', timeZone: 'Asia/Shanghai' };
const secret = () => randomBytes(24).toString('base64url');

describeDb('后台重置密码：真实权限、会话、审计与账号隔离', () => {
  let app: INestApplication;
  let url: string;
  let db: Database;
  let commands: IdentityCommands;
  let operator: { id: string; username: string; password: string };
  let token: string;
  let ip = 0;
  const clock = new TestClock('2026-11-10T01:00:00.000Z');
  const { logger, capture } = captureLogger();
  const secrets = new Set<string>();
  const auth = (username: string, password: string, kind: 'admin' | 'app' = 'app') =>
    request(url)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', `10.9.0.${++ip}`)
      .send({ username, password, kind, device });
  async function account(role: 'admin' | 'user' = 'user') {
    const username = `reset_${randomBytes(5).toString('hex')}`;
    const password = secret();
    secrets.add(password);
    const id = await commands.createAdmin(username, password);
    if (role === 'user') await commands.setRole(username, 'user');
    return { id, username, password };
  }
  function reset(id: string, password: string, bearer: string | null = token) {
    secrets.add(password);
    const req = request(url).post(`/api/v1/admin/users/${id}/password`);
    if (bearer) req.set('Authorization', `Bearer ${bearer}`);
    return req.send({ password });
  }
  async function snapshot(id: string) {
    return (
      await db.query(
        `SELECT (to_jsonb(u)-'password_hash'-'updated_at'-'last_active_at') AS account,
      (SELECT to_jsonb(p) FROM identity.profiles p WHERE p.user_id=u.id) AS profile,
      (SELECT jsonb_agg(m) FROM identity.memberships m WHERE m.user_id=u.id) AS membership,
      (SELECT jsonb_agg(b) FROM billing.accounts b WHERE b.user_id=u.id) AS balance
      FROM identity.users u WHERE u.id=$1`,
        [id],
      )
    ).rows;
  }

  beforeAll(async () => {
    await resetTestDatabase();
    const config = testConfig({ HTTP_TRUST_PROXY: 'true' });
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config,
          clock,
          logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: new NestPinoLogger(logger) });
    configureHttpApp(app, config);
    await app.init();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    db = app.get(DATABASE);
    commands = app.get(IdentityCommands);
    operator = await account('admin');
    token = AuthResponse.parse(
      (await auth(operator.username, operator.password, 'admin').expect(200)).body,
    ).session.token;
    secrets.add(token);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('按编号重置同名用户；旧密码和全部旧会话失效，别的账号及资料保持原样', async () => {
    const target = await account();
    const other = await account();
    await db.query('UPDATE identity.profiles SET nickname=$1 WHERE user_id=ANY($2::uuid[])', [
      '同名测试用户',
      [target.id, other.id],
    ]);
    const first = AuthResponse.parse(
      (await auth(target.username, target.password).expect(200)).body,
    );
    const second = AuthResponse.parse(
      (await auth(target.username, target.password).expect(200)).body,
    );
    const before = await snapshot(target.id);
    const password = secret();
    const result = await reset(target.id, password).expect(200);
    expect(result.body).toEqual({ revokedSessions: 2 });
    for (const old of [first, second]) {
      secrets.add(old.session.token);
      await request(url)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${old.session.token}`)
        .expect(401);
    }
    await auth(target.username, target.password).expect(401);
    await auth(target.username, password).expect(200);
    await auth(other.username, other.password).expect(200);
    expect(await snapshot(target.id)).toEqual(before);
    const audit = await db.query(
      'SELECT actor_type,actor_id,target_id,details FROM platform.audit_log WHERE action=$1 AND target_id=$2',
      ['password.reset', target.id],
    );
    expect(audit.rows).toEqual([
      {
        actor_type: 'admin',
        actor_id: operator.id,
        target_id: target.id,
        details: { revokedSessions: 2 },
      },
    ]);
    expect(JSON.stringify(audit.rows).includes(password)).toBe(false);
  });

  it('只接受管理会话；拒绝管理员目标、注销中用户和不合格密码，不产生成功审计', async () => {
    const target = await account();
    const member = AuthResponse.parse(
      (await auth(target.username, target.password).expect(200)).body,
    );
    const adminApp = AuthResponse.parse(
      (await auth(operator.username, operator.password).expect(200)).body,
    );
    await reset(target.id, secret(), null).expect(401);
    await reset(target.id, secret(), member.session.token).expect(403);
    await reset(target.id, secret(), adminApp.session.token).expect(403);
    await reset(operator.id, secret()).expect(403);
    await reset(randomUUID(), secret()).expect(404);
    await reset(target.id, secret().slice(0, 7)).expect(400);
    await reset(target.id, target.username).expect(400);
    await auth(target.username, target.password).expect(200);
    await db.query(
      "UPDATE identity.users SET status='deleting',deletion_requested_at=$2 WHERE id=$1",
      [target.id, clock.now()],
    );
    await reset(target.id, secret()).expect(404);
    const audit = await db.query(
      "SELECT count(*)::int AS n FROM platform.audit_log WHERE action='password.reset' AND target_id=$1",
      [target.id],
    );
    expect(audit.rows[0]?.n).toBe(0);
  });

  it('清除关联登录名锁定，保留公共来源锁定和封禁；日志不包含输入的密码', async () => {
    const target = await account();
    const alias = `alias_${randomBytes(5).toString('hex')}`;
    await db.query(
      'INSERT INTO identity.login_aliases(alias,user_id,created_at) VALUES($1,$2,$3)',
      [alias, target.id, clock.now()],
    );
    await db.query(
      'UPDATE identity.users SET current_alias=$2,banned_at=$3,ban_reason=$4,banned_by=$5 WHERE id=$1',
      [target.id, alias, clock.now(), '测试封禁', operator.id],
    );
    const before = await snapshot(target.id);
    const keys = [
      throttleKey('username', target.username),
      throttleKey('username', alias),
      throttleKey('ip', '10.7.1.1'),
    ];
    for (const key of keys)
      await db.query(
        'INSERT INTO identity.login_throttle(key,failures,last_failed_at,locked_until) VALUES($1,5,$2,$3)',
        [key, clock.now(), new Date(clock.nowMs() + 60_000)],
      );
    await reset(target.id, secret()).expect(200);
    expect(await snapshot(target.id)).toEqual(before);
    const remaining = await db.query(
      'SELECT key FROM identity.login_throttle WHERE key=ANY($1::bytea[])',
      [keys],
    );
    expect(remaining.rows).toHaveLength(1);
    expect((remaining.rows[0]?.key as Buffer).equals(keys[2]!)).toBe(true);
    for (const password of secrets) expect(capture.text.includes(password)).toBe(false);
  });
});
