import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AuthResponse, type UserUpdatePayload } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { DATABASE, TestClock, newId, type Database } from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { UpdateLogService, RealtimeTestQueries } from '../src/modules/realtime/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

describeDb('realtime 更新日志：真实事务、加密、断线补拉与保留边界', () => {
  let app: INestApplication;
  let db: Database;
  let log: UpdateLogService;
  let queries: RealtimeTestQueries;
  let userId: string;
  let token: string;
  let otherId: string;
  const clock = new TestClock('2026-10-06T12:00:00Z');
  const logs = captureLogger();
  const payload: UserUpdatePayload = { type: 'contact.removed', data: { characterId: newId() } };
  beforeAll(async () => {
    await resetTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig(),
          clock,
          logger: logs.logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DATABASE);
    log = app.get(UpdateLogService);
    queries = new RealtimeTestQueries(db);
    const commands = app.get(IdentityCommands);
    userId = await commands.createAdmin('sync_user', 'correct horse battery');
    await commands.setRole('sync_user', 'user');
    otherId = await commands.createAdmin('sync_other', 'correct horse battery');
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: 'sync_user',
        password: 'correct horse battery',
        kind: 'app',
        device: {
          platform: 'web',
          name: 'sync test',
          appVersion: '0.1.0',
          timeZone: 'Asia/Shanghai',
        },
      })
      .expect(200);
    token = AuthResponse.parse(result.body).session.token;
  });
  afterAll(async () => {
    await app?.close();
  });
  const append = () => db.transaction((tx) => log.appendUpdate(tx, userId, payload));
  it('未登录拒绝读取；新账号从零开始，不创建空游标行', async () => {
    await request(app.getHttpServer()).get('/api/v1/sync/state').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/sync/state')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { latestUpdateSeq: 0 });
    expect(await log.countUserData(userId)).toBe(0);
  });
  it('回滚不消耗序号，十个并发事务分配连续序号；密文没有业务载荷', async () => {
    await expect(
      db.transaction(async (tx) => {
        await log.appendUpdate(tx, userId, payload);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await log.getState(userId)).toEqual({ latestUpdateSeq: 0 });
    expect((await Promise.all(Array.from({ length: 10 }, append))).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    const rows = await queries.rows(userId);
    expect(rows).toHaveLength(10);
    for (const row of rows)
      expect(row.encrypted_payload.toString()).not.toContain(payload.data.characterId);
    expect(logs.capture.text).not.toContain(payload.data.characterId);
  });
  it('分页只返回当前账号，末页 hasMore=false；非法或未来游标拒绝', async () => {
    const a = await log.getUpdates(userId, { since: 0, limit: 3 });
    expect(a.items.map((x) => x.updateSeq)).toEqual([1, 2, 3]);
    expect(a).toMatchObject({ latestUpdateSeq: 10, hasMore: true });
    const b = await log.getUpdates(userId, { since: 9 });
    expect(b.items).toEqual([{ ...payload, updateSeq: 10, occurredAt: clock.now().toISOString() }]);
    expect(b.hasMore).toBe(false);
    expect(await log.getUpdates(otherId, { since: 0 })).toEqual({
      items: [],
      latestUpdateSeq: 0,
      hasMore: false,
    });
    for (const since of [-1, 11, 9007199254740992])
      await expect(log.getUpdates(userId, { since })).rejects.toMatchObject({
        code: 'bad_request',
      });
  });
  it('保留边界不重置最高序号；全部修剪后旧游标410，边界游标可继续', async () => {
    clock.advance(30 * 86400000);
    expect(await log.pruneUser(userId)).toBe(0);
    clock.advance(1);
    expect(await log.pruneUser(userId)).toBe(10);
    await expect(log.getUpdates(userId, { since: 0 })).rejects.toMatchObject({
      code: 'sync_cursor_expired',
    });
    expect(await log.getUpdates(userId, { since: 10 })).toEqual({
      items: [],
      latestUpdateSeq: 10,
      hasMore: false,
    });
    expect(await append()).toBe(11);
    expect((await log.getUpdates(userId, { since: 10 })).items.map((x) => x.updateSeq)).toEqual([
      11,
    ]);
  });
  it('日志内部缺口报错，不默默跳过；未知账号不能创建密文或游标', async () => {
    expect(await append()).toBe(12);
    await queries.removeUpdate(userId, 11);
    await expect(log.getUpdates(userId, { since: 10 })).rejects.toMatchObject({
      code: 'internal_error',
    });
    const absent = newId();
    await expect(
      db.transaction((tx) => log.appendUpdate(tx, absent, payload)),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await log.countUserData(absent)).toBe(0);
    expect(await log.purgeUser(userId)).toBe(2);
    expect(await log.purgeUser(userId)).toBe(0);
  });
  it('时钟回拨导致内部老记录时，修剪连续前缀而不留下同步缺口', async () => {
    const add = () => db.transaction((tx) => log.appendUpdate(tx, otherId, payload));
    expect(await add()).toBe(1);
    clock.advance(-40 * 86400000);
    expect(await add()).toBe(2);
    clock.advance(40 * 86400000);
    expect(await add()).toBe(3);
    expect(await log.pruneUser(otherId)).toBe(2);
    await expect(log.getUpdates(otherId, { since: 1 })).rejects.toMatchObject({
      code: 'sync_cursor_expired',
    });
    expect((await log.getUpdates(otherId, { since: 2 })).items.map((x) => x.updateSeq)).toEqual([
      3,
    ]);
  });
});
