/**
 * identity 模块集成测试（T-018 / D-L0-06）：每个接口的正常路径、未登录、无权限、参数错误、重复请求；
 * 邀请码（无效 / 已用 / 过期 / 并发只能用一次）；登录锁定；会话续期、过期与吊销；主题多设备同步；
 * 命令行操作；注销编排（删除清单框架）；日志里没有密码和令牌。
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ApiError,
  AuthResponse,
  CurrentUser,
  Invite,
  NotificationSettings,
  Profile,
  SessionSummary,
  UserPreferences,
  type DeviceInfo,
  type UserDataOwner,
} from '@weiban/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import { CommandError, IdentityCommands } from '../src/modules/identity/index.js';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  IdentityTestQueries,
  normalizeInviteCode,
} from '../src/modules/identity/testing.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  EVENT_BUS,
  EVENT_DISPATCHER,
  JOB_QUEUE,
  TestClock,
  USER_DATA_REGISTRY,
  type Database,
  type EnvelopeCrypto,
  type EventBus,
  type EventDispatcher,
  type JobQueue,
  type UserDataRegistry,
} from '../src/platform/index.js';
import { NestPinoLogger } from '../src/platform/logging/nest-logger.js';
import { describeDb, resetTestDatabase, withClient } from './support/db.js';
import { canaryKey, captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DEVICE: DeviceInfo = {
  platform: 'web',
  name: 'Chrome on Windows',
  appVersion: '0.1.0',
  timeZone: 'Asia/Shanghai',
};
const PHONE: DeviceInfo = {
  platform: 'android',
  name: '小米 14',
  appVersion: '0.1.0',
  timeZone: 'Asia/Shanghai',
};
const PASSWORD = 'correct horse battery';

describeDb('identity 模块（真实 PostgreSQL）', () => {
  let app: INestApplication;
  let baseUrl: string;
  let database: Database;
  let dispatcher: EventDispatcher;
  let bus: EventBus;
  let registry: UserDataRegistry;
  let crypto: EnvelopeCrypto;
  let commands: IdentityCommands;
  let q: IdentityTestQueries;
  const clock = new TestClock('2026-10-05T08:00:00.000Z');
  const { logger, capture } = captureLogger();
  /** 测试中出现过的全部令牌和密码，最后检查日志里一个都没有。 */
  const secrets = new Set<string>([PASSWORD]);
  /** 假 realtime：收到的 identity.preferences_updated。 */
  const realtimeSeen: string[] = [];
  let ipCounter = 0;

  beforeAll(async () => {
    await resetTestDatabase();
    const config = testConfig({ HTTP_TRUST_PROXY: 'true' });
    const moduleRef = await Test.createTestingModule({
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
    app = moduleRef.createNestApplication({ logger: new NestPinoLogger(logger) });
    configureHttpApp(app, config);
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    database = app.get<Database>(DATABASE);
    dispatcher = app.get<EventDispatcher>(EVENT_DISPATCHER);
    bus = app.get<EventBus>(EVENT_BUS);
    registry = app.get<UserDataRegistry>(USER_DATA_REGISTRY);
    crypto = app.get<EnvelopeCrypto>(ENVELOPE_CRYPTO);
    commands = app.get(IdentityCommands);
    // 注销的删除工作在 pg-boss 任务里执行（identity.purge_user_data），这里启动任务队列（分发器仍由测试手动驱动）
    await app.get<JobQueue>(JOB_QUEUE).start();
    q = new IdentityTestQueries(database);
    // 假的 realtime 订阅者（D-L1-01 实现前代替它）：收到偏好变化就记下来
    bus.subscribe({
      consumer: 'testrealtime.on_preferences_updated',
      eventType: 'identity.preferences_updated',
      handle: async (event) => {
        realtimeSeen.push(event.payload.userId);
      },
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // ---------- 小工具 ----------

  /** 每次调用换一个来源 IP，避免不同用例的失败计数互相影响（按 IP 锁定）。 */
  function freshIp(): string {
    ipCounter += 1;
    return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  }

  function http(ip = freshIp()) {
    const agent = request(baseUrl);
    const withIp = <T extends { set(k: string, v: string): T }>(r: T) =>
      r.set('X-Forwarded-For', ip);
    return {
      get: (path: string, token?: string) => auth(withIp(agent.get(path)), token),
      post: (path: string, token?: string) => auth(withIp(agent.post(path)), token),
      patch: (path: string, token?: string) => auth(withIp(agent.patch(path)), token),
      delete: (path: string, token?: string) => auth(withIp(agent.delete(path)), token),
    };
  }

  function auth<T extends { set(k: string, v: string): T }>(r: T, token?: string): T {
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  }

  async function newInvite(days: number | null = null): Promise<string> {
    return (await commands.createInvite(days)).code;
  }

  let userCounter = 0;
  function newUsername(prefix = 'user'): string {
    userCounter += 1;
    return `${prefix}_${userCounter}`;
  }

  async function register(
    username = newUsername(),
    options: { password?: string; device?: DeviceInfo; ip?: string } = {},
  ): Promise<AuthResponse> {
    const res = await http(options.ip)
      .post('/api/v1/auth/register')
      .send({
        username,
        password: options.password ?? PASSWORD,
        inviteCode: await newInvite(),
        device: options.device ?? DEVICE,
      })
      .expect(201);
    const body = AuthResponse.parse(res.body);
    secrets.add(body.session.token);
    return body;
  }

  function login(
    username: string,
    options: { password?: string; kind?: 'app' | 'admin'; device?: DeviceInfo; ip?: string } = {},
  ) {
    const req = http(options.ip)
      .post('/api/v1/auth/login')
      .send({
        username,
        password: options.password ?? PASSWORD,
        device: options.device ?? PHONE,
        ...(options.kind ? { kind: options.kind } : {}),
      });
    // 记下发出的令牌，最后检查日志里没有它们
    req.on('response', (res: { status: number; body: unknown }) => {
      if (res.status === 200) secrets.add(AuthResponse.parse(res.body).session.token);
    });
    return req;
  }

  function errorCode(res: { body: unknown }): string {
    return ApiError.parse(res.body).error.code;
  }

  async function outbox(type: string, userId: string) {
    return withClient(async (client) => {
      const { rows } = await client.query<{ event: { payload: Record<string, unknown> } }>(
        `SELECT event FROM platform.outbox
          WHERE event_type = $1 AND event->'payload'->>'userId' = $2 ORDER BY created_at, id`,
        [type, userId],
      );
      return rows.map((r) => r.event.payload);
    });
  }

  async function dispatchAll(): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      if ((await dispatcher.dispatchOnce()).claimed === 0) return;
    }
  }

  // ---------- 注册 ----------

  describe('注册 POST /auth/register', () => {
    it('正常：201，返回会话和用户；默认资料、设置、主题；邀请码被用掉；发 user_registered', async () => {
      const code = await newInvite();
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ username: 'Alice_01', password: PASSWORD, inviteCode: code, device: DEVICE })
        .expect(201);
      const body = AuthResponse.parse(res.body);
      secrets.add(body.session.token);
      expect(body.user).toMatchObject({
        username: 'Alice_01',
        role: 'user',
        profileCompleted: false,
      });
      expect(body.session.kind).toBe('app');
      expect(body.session.expiresAt).toBe(new Date(clock.nowMs() + 90 * DAY).toISOString());

      const me = await http().get('/api/v1/me', body.session.token).expect(200);
      expect(CurrentUser.parse(me.body).userId).toBe(body.user.userId);

      const profile = Profile.parse(
        (await http().get('/api/v1/me/profile', body.session.token).expect(200)).body,
      );
      expect(profile).toMatchObject({
        nickname: null,
        gender: 'unspecified',
        timeZone: 'Asia/Shanghai',
      });
      const settings = NotificationSettings.parse(
        (await http().get('/api/v1/me/notification-settings', body.session.token).expect(200)).body,
      );
      expect(settings.proactiveCallsEnabled).toBe(
        DEFAULT_NOTIFICATION_SETTINGS.proactiveCallsEnabled,
      );
      expect(settings.doNotDisturb.enabled).toBe(false);
      const prefs = UserPreferences.parse(
        (await http().get('/api/v1/me/preferences', body.session.token).expect(200)).body,
      );
      expect(prefs.theme).toBe('green');

      const invite = await q.invite(normalizeInviteCode(code));
      expect(invite?.usedBy).toBe(body.user.userId);
      expect(invite?.usedAt).not.toBeNull();
      expect(await outbox('identity.user_registered', body.user.userId)).toHaveLength(1);

      // 密码只存 argon2id 哈希；令牌只存 SHA-256
      const row = await q.user('alice_01');
      expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
      const dump = await q.dumpText();
      expect(dump.includes(PASSWORD)).toBe(false);
      expect(dump.includes(body.session.token)).toBe(false);
      expect(await q.sessionByToken(body.session.token)).not.toBeNull();
    });

    it('参数错误：用户名格式、密码长度、缺字段、时区不认识 → 400；弱密码 → 422', async () => {
      const code = await newInvite();
      const base = {
        username: newUsername(),
        password: PASSWORD,
        inviteCode: code,
        device: DEVICE,
      };
      for (const body of [
        { ...base, username: 'ab' },
        { ...base, username: 'has space' },
        { ...base, password: 'short' },
        { ...base, device: undefined },
        { ...base, inviteCode: undefined },
      ]) {
        const res = await http().post('/api/v1/auth/register').send(body).expect(400);
        expect(errorCode(res)).toBe('bad_request');
      }
      const tz = await http()
        .post('/api/v1/auth/register')
        .send({ ...base, device: { ...DEVICE, timeZone: 'Mars/Olympus' } })
        .expect(400);
      expect(JSON.stringify(tz.body)).toContain('device.timeZone');
      const weak = await http()
        .post('/api/v1/auth/register')
        .send({ ...base, password: `${base.username}12345` })
        .expect(422);
      expect(errorCode(weak)).toBe('password_too_weak');
      // 失败的请求没有用掉邀请码
      expect((await q.invite(normalizeInviteCode(code)))?.usedAt).toBeNull();
    });

    it('邀请码无效、已用、过期都被拒绝（422 invite_invalid）', async () => {
      const send = (inviteCode: string) =>
        http()
          .post('/api/v1/auth/register')
          .send({ username: newUsername(), password: PASSWORD, inviteCode, device: DEVICE });

      expect(errorCode(await send('NOPE-NOPE-NOPE').expect(422))).toBe('invite_invalid');

      const used = await newInvite();
      await send(used).expect(201);
      expect(errorCode(await send(used).expect(422))).toBe('invite_invalid');

      const expiring = await newInvite(1);
      clock.advance(DAY + 1);
      expect(errorCode(await send(expiring).expect(422))).toBe('invite_invalid');
      // 邀请码不区分大小写、可带空格
      const lower = await newInvite();
      await send(` ${lower.toLowerCase()} `).expect(201);
    });

    it('同一个邀请码并发注册：只有一个成功（邀请码只能用一次）', async () => {
      const code = await newInvite();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          http()
            .post('/api/v1/auth/register')
            .send({
              username: newUsername('race'),
              password: PASSWORD,
              inviteCode: code,
              device: DEVICE,
            }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 422, 422, 422, 422, 422]);
      const winner = AuthResponse.parse(results.find((r) => r.status === 201)?.body);
      secrets.add(winner.session.token);
      expect((await q.invite(normalizeInviteCode(code)))?.usedBy).toBe(winner.user.userId);
    });

    it('同一个用户名用不同邀请码并发注册：只有一个成功，其余 409，邀请码不被消耗', async () => {
      const username = newUsername('same');
      const codes = await Promise.all([newInvite(), newInvite(), newInvite()]);
      const results = await Promise.all(
        codes.map((inviteCode) =>
          http()
            .post('/api/v1/auth/register')
            .send({ username, password: PASSWORD, inviteCode, device: DEVICE }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(errorCode(r)).toBe('username_taken');
      }
      const unused = await Promise.all(codes.map((c) => q.invite(normalizeInviteCode(c))));
      expect(unused.filter((i) => i?.usedAt !== null)).toHaveLength(1);
    });

    it('重复请求：同一次注册重发（同用户名、密码、邀请码）→ 200 同一账号、新会话；用户名大小写不同也算占用', async () => {
      const code = await newInvite();
      const body = {
        username: newUsername('retry'),
        password: PASSWORD,
        inviteCode: code,
        device: DEVICE,
      };
      const first = AuthResponse.parse(
        (await http().post('/api/v1/auth/register').send(body).expect(201)).body,
      );
      const again = AuthResponse.parse(
        (await http().post('/api/v1/auth/register').send(body).expect(200)).body,
      );
      secrets.add(first.session.token).add(again.session.token);
      expect(again.user.userId).toBe(first.user.userId);
      expect(again.session.sessionId).not.toBe(first.session.sessionId);
      expect(await outbox('identity.user_registered', first.user.userId)).toHaveLength(1);

      // 密码不对的重发不能借机拿到会话
      const wrong = await http()
        .post('/api/v1/auth/register')
        .send({ ...body, password: 'another password!' })
        .expect(422);
      expect(errorCode(wrong)).toBe('invite_invalid');

      const taken = await http()
        .post('/api/v1/auth/register')
        .send({ ...body, username: body.username.toUpperCase(), inviteCode: await newInvite() })
        .expect(409);
      expect(errorCode(taken)).toBe('username_taken');
    });
  });

  // ---------- 登录 ----------

  describe('登录 POST /auth/login', () => {
    it('正常：200；用户名不区分大小写；每次登录一个新会话', async () => {
      const { user } = await register(newUsername('Bob'));
      const res = await login(user.username.toUpperCase()).expect(200);
      const body = AuthResponse.parse(res.body);
      expect(body.user.userId).toBe(user.userId);
      expect(body.session.kind).toBe('app');
      expect((await q.sessionsOf(user.userId)).length).toBe(2);
    });

    it('密码错、用户名不存在 → 401 invalid_credentials（同一个提示）；参数错误 → 400', async () => {
      const { user } = await register();
      const wrong = await login(user.username, { password: 'not the password' }).expect(401);
      const ghost = await login('nobody_here').expect(401);
      expect(errorCode(wrong)).toBe('invalid_credentials');
      expect(ApiError.parse(wrong.body).error.message).toBe(
        ApiError.parse(ghost.body).error.message,
      );
      const bad = await http().post('/api/v1/auth/login').send({ username: 'x' }).expect(400);
      expect(errorCode(bad)).toBe('bad_request');
      const badKind = await http()
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: PASSWORD, device: PHONE, kind: 'root' })
        .expect(400);
      expect(errorCode(badKind)).toBe('bad_request');
    });

    it('同一用户名连续 5 次失败锁定 15 分钟：期间正确密码也拒绝（429 account_locked），到期恢复', async () => {
      const { user } = await register();
      for (let i = 0; i < 5; i += 1)
        await login(user.username, { password: 'wrong password!' }).expect(401);
      const locked = await login(user.username).expect(429);
      expect(errorCode(locked)).toBe('account_locked');
      clock.advance(15 * MINUTE - 1);
      await login(user.username).expect(429);
      clock.advance(1);
      await login(user.username).expect(200);
    });

    it('同一 IP 连续 5 次失败（不同用户名）锁定该 IP；别的 IP 不受影响', async () => {
      const { user } = await register();
      const ip = freshIp();
      for (let i = 0; i < 5; i += 1) await login(newUsername('ghost'), { ip }).expect(401);
      expect(errorCode(await login(user.username, { ip }).expect(429))).toBe('account_locked');
      await login(user.username).expect(200);
      clock.advance(15 * MINUTE);
      await login(user.username, { ip }).expect(200);
    });

    it('成功登录清零失败计数（「连续」失败才锁）', async () => {
      const { user } = await register();
      for (let i = 0; i < 3; i += 1)
        await login(user.username, { password: 'wrong password!' }).expect(401);
      await login(user.username).expect(200);
      for (let i = 0; i < 3; i += 1)
        await login(user.username, { password: 'wrong password!' }).expect(401);
      await login(user.username).expect(200);
    });

    it('普通用户不能开管理会话（403）', async () => {
      const { user } = await register();
      expect(errorCode(await login(user.username, { kind: 'admin' }).expect(403))).toBe(
        'forbidden',
      );
    });
  });

  // ---------- 当前用户、退出、登录设备 ----------

  describe('会话：/me、退出、登录设备', () => {
    it('未登录 / 乱写令牌 → 401', async () => {
      for (const path of [
        '/api/v1/me',
        '/api/v1/me/sessions',
        '/api/v1/me/profile',
        '/api/v1/me/preferences',
        '/api/v1/me/notification-settings',
      ]) {
        expect(errorCode(await http().get(path).expect(401))).toBe('unauthenticated');
        await http().get(path, 'wbs_not-a-real-token').expect(401);
      }
      await http().post('/api/v1/auth/logout').expect(401);
      await http().patch('/api/v1/me/preferences').send({ theme: 'pink' }).expect(401);
      await http().delete('/api/v1/me').send({ password: PASSWORD, confirm: 'DELETE' }).expect(401);
    });

    it('退出：204，令牌立即失效，发 session_revoked(logout)；重复退出 401', async () => {
      const { user, session } = await register();
      await http().post('/api/v1/auth/logout', session.token).expect(204);
      await http().get('/api/v1/me', session.token).expect(401);
      await http().post('/api/v1/auth/logout', session.token).expect(401);
      const events = await outbox('identity.session_revoked', user.userId);
      expect(events).toEqual([
        { userId: user.userId, sessionId: session.sessionId, reason: 'logout' },
      ]);
      expect(await q.sessionsOf(user.userId)).toHaveLength(0);
    });

    it('登录设备列表：两台设备、标出当前设备；踢下线另一台 → 它的令牌失效；重复踢 404', async () => {
      const web = await register();
      const phone = AuthResponse.parse((await login(web.user.username).expect(200)).body);
      const list = await http().get('/api/v1/me/sessions', web.session.token).expect(200);
      const items = list.body.items.map((i: unknown) => SessionSummary.parse(i));
      expect(items).toHaveLength(2);
      expect(items.find((i: SessionSummary) => i.current)?.sessionId).toBe(web.session.sessionId);
      expect(items.find((i: SessionSummary) => !i.current)?.device.name).toBe('小米 14');

      await http()
        .delete(`/api/v1/me/sessions/${phone.session.sessionId}`, web.session.token)
        .expect(204);
      await http().get('/api/v1/me', phone.session.token).expect(401);
      const again = await http()
        .delete(`/api/v1/me/sessions/${phone.session.sessionId}`, web.session.token)
        .expect(404);
      expect(errorCode(again)).toBe('not_found');
      expect(await outbox('identity.session_revoked', web.user.userId)).toEqual([
        { userId: web.user.userId, sessionId: phone.session.sessionId, reason: 'revoked' },
      ]);
    });

    it('无权限：不能踢别人的设备（404，不暴露是否存在）；sessionId 不是 UUID → 400', async () => {
      const a = await register();
      const b = await register();
      await http()
        .delete(`/api/v1/me/sessions/${b.session.sessionId}`, a.session.token)
        .expect(404);
      await http().get('/api/v1/me', b.session.token).expect(200);
      expect(
        errorCode(
          await http().delete('/api/v1/me/sessions/not-a-uuid', a.session.token).expect(400),
        ),
      ).toBe('bad_request');
    });

    it('普通会话 90 天滑动续期：一直在用就不过期；90 天不用就失效并发 session_revoked(expired)', async () => {
      const { user, session } = await register();
      for (let i = 0; i < 3; i += 1) {
        clock.advance(60 * DAY);
        await http().get('/api/v1/me', session.token).expect(200);
      }
      const row = await q.sessionByToken(session.token);
      expect(row?.expiresAt.getTime()).toBe(clock.nowMs() + 90 * DAY);
      clock.advance(90 * DAY);
      await http().get('/api/v1/me', session.token).expect(401);
      expect(await outbox('identity.session_revoked', user.userId)).toEqual([
        { userId: user.userId, sessionId: session.sessionId, reason: 'expired' },
      ]);
    });

    it('/me：profileCompleted 随昵称变化', async () => {
      const { session } = await register();
      expect(
        (await http().get('/api/v1/me', session.token).expect(200)).body.profileCompleted,
      ).toBe(false);
      await http()
        .patch('/api/v1/me/profile', session.token)
        .send({ nickname: '小明' })
        .expect(200);
      const me = CurrentUser.parse(
        (await http().get('/api/v1/me', session.token).expect(200)).body,
      );
      expect(me.profileCompleted).toBe(true);
    });
  });

  // ---------- 资料 ----------

  describe('我的资料 /me/profile', () => {
    it('修改只改传了的字段（不补默认值，Q-001）；null 清空；发 profile_updated 列出变化字段', async () => {
      const { user, session } = await register();
      const first = Profile.parse(
        (
          await http()
            .patch('/api/v1/me/profile', session.token)
            .send({ nickname: '小明', city: '上海', birthday: '2000-02-29', about: '喜欢猫' })
            .expect(200)
        ).body,
      );
      clock.advance(MINUTE);
      const second = Profile.parse(
        (await http().patch('/api/v1/me/profile', session.token).send({ city: null }).expect(200))
          .body,
      );
      expect(second).toMatchObject({
        nickname: '小明',
        city: null,
        birthday: '2000-02-29',
        about: '喜欢猫',
        gender: 'unspecified',
      });
      expect(second.updatedAt > first.updatedAt).toBe(true);
      const events = await outbox('identity.profile_updated', user.userId);
      expect(events.map((e) => (e.changedFields as string[]).sort())).toEqual([
        ['about', 'birthday', 'city', 'nickname'],
        ['city'],
      ]);
      // 读回来和改完返回的一致
      expect(Profile.parse((await http().get('/api/v1/me/profile', session.token)).body)).toEqual(
        second,
      );
    });

    it('重复请求：同样的修改再发一次不写库、不发事件', async () => {
      const { user, session } = await register();
      const send = () =>
        http()
          .patch('/api/v1/me/profile', session.token)
          .send({ nickname: '阿花', gender: 'female' });
      const a = (await send().expect(200)).body;
      clock.advance(MINUTE);
      const b = (await send().expect(200)).body;
      expect(b).toEqual(a);
      expect(await outbox('identity.profile_updated', user.userId)).toHaveLength(1);
    });

    it('参数错误：昵称太长、空昵称、性别乱写、生日格式、时区不认识、「关于我」超 500 字 → 400', async () => {
      const { session } = await register();
      for (const body of [
        { nickname: '一'.repeat(21) },
        { nickname: '' },
        { gender: 'robot' },
        { birthday: '2000/01/01' },
        { timeZone: 'Mars/Olympus' },
        { about: '字'.repeat(501) },
        { avatarMediaId: 'not-a-uuid' },
      ]) {
        const res = await http().patch('/api/v1/me/profile', session.token).send(body).expect(400);
        expect(errorCode(res)).toBe('bad_request');
      }
    });
  });

  // ---------- 通知设置 ----------

  describe('全局通知与免打扰 /me/notification-settings', () => {
    it('修改免打扰与开关；重复修改不发事件；参数错误 400', async () => {
      const { user, session } = await register();
      const patch = {
        proactiveMessagesEnabled: false,
        doNotDisturb: { enabled: true, start: '23:30', end: '07:00' },
      };
      const updated = NotificationSettings.parse(
        (
          await http()
            .patch('/api/v1/me/notification-settings', session.token)
            .send(patch)
            .expect(200)
        ).body,
      );
      expect(updated).toMatchObject({
        ...patch,
        pushSoundEnabled: true,
        proactiveCallsEnabled: false,
      });
      await http().patch('/api/v1/me/notification-settings', session.token).send(patch).expect(200);
      expect(await outbox('identity.notification_settings_updated', user.userId)).toHaveLength(1);

      for (const body of [
        { doNotDisturb: { enabled: true, start: '25:00', end: '07:00' } },
        { doNotDisturb: { enabled: true } },
        { pushSoundEnabled: 'yes' },
      ]) {
        await http()
          .patch('/api/v1/me/notification-settings', session.token)
          .send(body)
          .expect(400);
      }
    });
  });

  // ---------- 主题多设备同步 ----------

  describe('界面偏好 /me/preferences（主题多设备同步）', () => {
    it('一台设备改主题 → 发 preferences_updated → realtime 收到；另一台设备拉取到新主题', async () => {
      const web = await register();
      const phone = AuthResponse.parse((await login(web.user.username).expect(200)).body);
      const res = await http()
        .patch('/api/v1/me/preferences', web.session.token)
        .send({ theme: 'pink' })
        .expect(200);
      expect(UserPreferences.parse(res.body).theme).toBe('pink');

      await dispatchAll();
      expect(realtimeSeen.filter((id) => id === web.user.userId)).toHaveLength(1);
      const onPhone = UserPreferences.parse(
        (await http().get('/api/v1/me/preferences', phone.session.token).expect(200)).body,
      );
      expect(onPhone.theme).toBe('pink');

      // 重复请求：不再发事件
      await http()
        .patch('/api/v1/me/preferences', web.session.token)
        .send({ theme: 'pink' })
        .expect(200);
      await http().patch('/api/v1/me/preferences', web.session.token).send({}).expect(200);
      expect(await outbox('identity.preferences_updated', web.user.userId)).toHaveLength(1);

      // 事件重复投递：订阅者只处理一次
      await withClient((c) =>
        c.query(
          `UPDATE platform.outbox SET dispatched_at = NULL
            WHERE event_type = 'identity.preferences_updated' AND event->'payload'->>'userId' = $1`,
          [web.user.userId],
        ),
      );
      await dispatchAll();
      expect(realtimeSeen.filter((id) => id === web.user.userId)).toHaveLength(1);
    });

    it('参数错误：不认识的主题 → 400', async () => {
      const { session } = await register();
      const res = await http()
        .patch('/api/v1/me/preferences', session.token)
        .send({ theme: 'blue' })
        .expect(400);
      expect(errorCode(res)).toBe('bad_request');
    });
  });

  // ---------- 管理员 ----------

  describe('管理员与邀请码 /admin/invites', () => {
    let adminToken = '';
    let adminAppToken = '';
    const adminName = 'boss_admin';

    beforeAll(async () => {
      await commands.createAdmin(adminName, PASSWORD);
      const admin = AuthResponse.parse(
        (await login(adminName, { kind: 'admin' }).expect(200)).body,
      );
      adminToken = admin.session.token;
      expect(admin.session.kind).toBe('admin');
      expect(admin.user.role).toBe('admin');
      expect(admin.session.expiresAt).toBe(new Date(clock.nowMs() + 12 * HOUR).toISOString());
      adminAppToken = AuthResponse.parse((await login(adminName).expect(200)).body).session.token;
    });

    it('管理会话生成邀请码（201），列表能看到；用它能注册', async () => {
      const res = await http()
        .post('/api/v1/admin/invites', adminToken)
        .send({ expiresInDays: 7 })
        .expect(201);
      const invite = Invite.parse(res.body);
      expect(invite.expiresAt).toBe(new Date(clock.nowMs() + 7 * DAY).toISOString());
      expect(invite.usedAt).toBeNull();
      const list = await http().get('/api/v1/admin/invites', adminToken).expect(200);
      expect(list.body.items.map((i: unknown) => Invite.parse(i).code)).toContain(invite.code);
      await http()
        .post('/api/v1/auth/register')
        .send({
          username: newUsername(),
          password: PASSWORD,
          inviteCode: invite.code,
          device: DEVICE,
        })
        .expect(201);
      const after = (await http().get('/api/v1/admin/invites', adminToken)).body.items.find(
        (i: { code: string }) => i.code === invite.code,
      );
      expect(after.usedAt).not.toBeNull();
    });

    it('重复请求：带同一个 Idempotency-Key 只生成一个码', async () => {
      const send = () =>
        http()
          .post('/api/v1/admin/invites', adminToken)
          .set('Idempotency-Key', 'invite-req-0001')
          .send({ expiresInDays: null });
      const [a, b] = await Promise.all([send(), send()]);
      expect(a.body.code).toBe(b.body.code);
      const c = await send().expect(201);
      expect(c.body.code).toBe(a.body.code);
      const bad = await http()
        .post('/api/v1/admin/invites', adminToken)
        .set('Idempotency-Key', 'x')
        .send({ expiresInDays: null })
        .expect(400);
      expect(errorCode(bad)).toBe('bad_request');
    });

    it('无权限：普通用户 403；管理员的 App 会话（非管理会话）也 403；未登录 401', async () => {
      const { session } = await register();
      for (const token of [session.token, adminAppToken]) {
        expect(
          errorCode(
            await http()
              .post('/api/v1/admin/invites', token)
              .send({ expiresInDays: 1 })
              .expect(403),
          ),
        ).toBe('forbidden');
        await http().get('/api/v1/admin/invites', token).expect(403);
      }
      await http().get('/api/v1/admin/invites').expect(401);
    });

    it('参数错误：有效天数 0、400、非整数、缺字段 → 400', async () => {
      for (const body of [
        { expiresInDays: 0 },
        { expiresInDays: 400 },
        { expiresInDays: 1.5 },
        {},
      ]) {
        await http().post('/api/v1/admin/invites', adminToken).send(body).expect(400);
      }
    });

    it('管理会话 12 小时过期，使用也不续期', async () => {
      const token = AuthResponse.parse((await login(adminName, { kind: 'admin' }).expect(200)).body)
        .session.token;
      clock.advance(11 * HOUR);
      await http().get('/api/v1/admin/invites', token).expect(200);
      clock.advance(HOUR);
      await http().get('/api/v1/admin/invites', token).expect(401);
    });

    it('邀请码生成写审计，审计里不记码本身', async () => {
      const rows = await withClient(
        async (c) =>
          (
            await c.query(
              `SELECT details::text AS d FROM platform.audit_log WHERE action = 'invite.created'`,
            )
          ).rows,
      );
      expect(rows.length).toBeGreaterThan(0);
      const fresh = AuthResponse.parse(
        (await login(adminName, { kind: 'admin' }).expect(200)).body,
      );
      const codes = (await http().get('/api/v1/admin/invites', fresh.session.token)).body.items.map(
        (i: { code: string }) => normalizeInviteCode(i.code),
      );
      for (const row of rows) for (const code of codes) expect(row.d.includes(code)).toBe(false);
    });
  });

  // ---------- 命令行操作 ----------

  describe('命令行脚本（IdentityCommands）', () => {
    it('重置密码：旧密码失效、新密码可用、所有设备下线、解除锁定', async () => {
      const { user, session } = await register();
      for (let i = 0; i < 5; i += 1) await login(user.username, { password: 'wrong password!' });
      await login(user.username).expect(429);
      const revoked = await commands.resetPassword(user.username, 'brand new secret 2');
      expect(revoked).toBe(1);
      secrets.add('brand new secret 2');
      await http().get('/api/v1/me', session.token).expect(401);
      await login(user.username).expect(401);
      await login(user.username, { password: 'brand new secret 2' }).expect(200);
    });

    it('创建管理员：用户名重复、密码太弱都报错；set-role 降级后管理会话作废', async () => {
      await expect(commands.createAdmin('boss_admin', PASSWORD)).rejects.toBeInstanceOf(
        CommandError,
      );
      await expect(commands.createAdmin('weak_admin', 'weak_admin1')).rejects.toThrow(/用户名/);
      await expect(commands.createAdmin('x', PASSWORD)).rejects.toThrow(/用户名/);
      await commands.createAdmin('second_admin', PASSWORD);
      const admin = AuthResponse.parse(
        (await login('second_admin', { kind: 'admin' }).expect(200)).body,
      );
      const app = AuthResponse.parse((await login('second_admin').expect(200)).body);
      await commands.setRole('second_admin', 'user');
      await http().get('/api/v1/admin/invites', admin.session.token).expect(401);
      const me = await http().get('/api/v1/me', app.session.token).expect(200);
      expect(me.body.role).toBe('user');
    });

    it('生成邀请码：天数不合法报错', async () => {
      await expect(commands.createInvite(0)).rejects.toThrow(/1–365/);
      expect((await commands.createInvite(30)).expiresAt).not.toBeNull();
    });
  });

  // ---------- 注销（删除清单框架）——放在最后：会往登记处加一个假模块 ----------

  describe('注销 DELETE /me 与删除清单编排', () => {
    it('参数错误 400；密码错 403（不下线）', async () => {
      const { session } = await register();
      await http().delete('/api/v1/me', session.token).send({ password: PASSWORD }).expect(400);
      await http()
        .delete('/api/v1/me', session.token)
        .send({ password: PASSWORD, confirm: 'delete' })
        .expect(400);
      const wrong = await http()
        .delete('/api/v1/me', session.token)
        .send({ password: 'not my password', confirm: 'DELETE' })
        .expect(403);
      expect(errorCode(wrong)).toBe('invalid_credentials');
      await http().get('/api/v1/me', session.token).expect(200);
    });

    it('注销：202，所有设备立即下线、不能登录、数据密钥删除；各模块回报后账号物理删除；重复投递无副作用', async () => {
      const purged: string[] = [];
      const growthOwner: UserDataOwner = {
        module: 'growth',
        purgeUser: async (userId) => {
          purged.push(userId);
          return 3;
        },
        countUserData: async () => 0,
      };
      registry.register(growthOwner);

      const canary = canaryKey();
      const web = await register();
      const phone = AuthResponse.parse((await login(web.user.username).expect(200)).body);
      await http()
        .patch('/api/v1/me/profile', web.session.token)
        .send({ about: canary })
        .expect(200);
      const sealed = await crypto.seal(
        web.user.userId,
        `import:job:${web.user.userId}`,
        'raw text',
      );

      const res = await http()
        .delete('/api/v1/me', web.session.token)
        .send({ password: PASSWORD, confirm: 'DELETE' })
        .expect(202);
      expect(res.body).toEqual({ status: 'deleting' });
      // 重复请求：会话已作废 → 401
      await http()
        .delete('/api/v1/me', web.session.token)
        .send({ password: PASSWORD, confirm: 'DELETE' })
        .expect(401);
      for (const token of [web.session.token, phone.session.token]) {
        await http().get('/api/v1/me', token).expect(401);
      }
      await login(web.user.username).expect(401);
      await expect(
        crypto.open(web.user.userId, `import:job:${web.user.userId}`, sealed),
      ).rejects.toThrow();
      const revoked = await outbox('identity.session_revoked', web.user.userId);
      expect(revoked.map((e) => e.reason)).toEqual(['account_deleting', 'account_deleting']);
      expect(await outbox('identity.user_deletion_requested', web.user.userId)).toHaveLength(1);
      expect((await q.userById(web.user.userId))?.status).toBe('deleting');

      // 分发注销事件 → 投递删除任务 → 任务执行各模块的删除清单并回报 → 再分发回报 → 账号删除
      await dispatchAll();
      await vi.waitFor(
        async () => {
          // 所有非identity删除清单各回报一次；T-037新增真实chat；另用growth模拟清理回报。
          expect(await outbox('platform.user_data_purged', web.user.userId)).toHaveLength(7);
        },
        { timeout: 20_000, interval: 200 },
      );
      await dispatchAll();
      expect(purged).toEqual([web.user.userId]);
      const reports = await outbox('platform.user_data_purged', web.user.userId);
      expect(reports).toContainEqual({ userId: web.user.userId, module: 'growth', deletedRows: 3 });
      expect(reports.map((r) => r.module).sort()).toEqual([
        'billing',
        'characters',
        'chat',
        'growth',
        'media',
        'model_access',
        'realtime',
      ]);
      expect(await q.userById(web.user.userId)).toBeNull();
      expect(await commands.verifyPurged(web.user.userId)).toEqual(
        registry.modules().map((module) => ({ module, count: 0 })),
      );
      expect((await q.dumpText()).includes(canary)).toBe(false);
      const audit = await withClient(
        async (c) =>
          (await c.query(`SELECT target_id FROM platform.audit_log WHERE action = 'user.deleted'`))
            .rows,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.target_id).not.toBe(web.user.userId);

      // 事件重复投递：删除清单不重复执行，也不出错
      await withClient((c) =>
        c.query(
          `UPDATE platform.outbox SET dispatched_at = NULL
            WHERE event->'payload'->>'userId' = $1
              AND event_type IN ('identity.user_deletion_requested', 'platform.user_data_purged')`,
          [web.user.userId],
        ),
      );
      await dispatchAll();
      expect(purged).toEqual([web.user.userId]);
      const dead = await withClient(
        async (c) =>
          (
            await c.query(
              `SELECT count(*)::int AS n FROM platform.outbox WHERE dead_at IS NOT NULL OR last_error IS NOT NULL`,
            )
          ).rows,
      );
      expect(dead[0]?.n).toBe(0);

      // 用户名注销后可以重新注册
      await register(web.user.username);
    });
  });

  // ---------- 日志 ----------

  it('日志里没有出现过任何密码和会话令牌（且确实写了日志）', () => {
    const text = capture.text;
    expect(text).toContain('登录成功');
    expect(text).toContain('登录失败');
    for (const secret of secrets)
      expect(text.includes(secret), '日志中出现了密码或令牌').toBe(false);
  });
});
