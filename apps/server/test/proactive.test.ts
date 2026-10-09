import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthGuard } from '../src/platform/auth/auth.js';
import { ApiErrorFilter } from '../src/platform/http/error-filter.js';
import { captureLogger } from './support/fixtures.js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type {
  ContactsReadPort,
  IdentityAccountStatusPort,
  IdentityReadPort,
  ChatReadPort,
} from '@weiban/contracts';
import { DailyEventEndpoints, HolidayEvent, Events } from '@weiban/contracts';
import {
  Database,
  TestClock,
  newId,
  EventBus,
  UserDataRegistry,
  type JobQueue,
} from '../src/platform/index.js';
import { Migrator } from '../src/platform/db/migrator.js';
import {
  ProactiveGuards,
  ProactiveMessageService,
  DailyEventService,
  HolidayService,
  ProactiveLifecycle,
  HolidayAdminController,
  DailyEventController,
} from '../src/modules/proactive/testing.js';
import {
  describeDb,
  resetTestDatabase,
  requireTestDatabaseUrl,
  MIGRATIONS_DIR,
} from './support/db.js';

describeDb('T-052 proactive 真实PG：事务配额、日报、节日和删除', () => {
  let db: Database;
  let messages: ProactiveMessageService;
  let events: DailyEventService;
  let holidays: HolidayService;
  let lifecycle: ProactiveLifecycle;
  let app: INestApplication;
  const clock = new TestClock('2026-10-09T01:00:00Z');
  const userId = newId();
  const characterId = newId();
  let active = true;
  let contactActive = true;
  let timeZone = 'Asia/Shanghai';
  const accounts: IdentityAccountStatusPort = {
    getAccountStatus: async () => (active ? 'active' : 'deleting'),
  };
  const contacts: ContactsReadPort = {
    getActiveContactEpoch: async () =>
      contactActive ? { version: 'epoch-1', acceptAfter: '2026-10-01T00:00:00Z' } : null,
    getActiveContact: async () => null,
    listActiveContacts: async () => [],
    getPendingGreeting: async () => null,
  };
  const identity: IdentityReadPort = {
    getProfile: async () => ({
      nickname: '测试',
      avatarMediaId: null,
      birthday: null,
      gender: 'unspecified',
      city: null,
      about: null,
      timeZone,
      updatedAt: clock.now().toISOString(),
    }),
    getLastActiveAt: async () => null,
    getNotificationSettings: async () => null,
  };
  const chat = {
    getConversation: async () => ({
      participants: [
        { kind: 'user', refId: userId },
        { kind: 'character', refId: characterId },
      ],
    }),
  } as unknown as ChatReadPort;
  let bus: EventBus;
  let registry: UserDataRegistry;
  const jobs = {
    work: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn().mockResolvedValue(undefined),
  } as unknown as JobQueue;
  const send = (key: string, char = characterId, holiday = false, uid = userId) =>
    db.transaction((tx) =>
      messages.recordSent(
        uid,
        char,
        '2026-10-09',
        key,
        holiday ? 'holiday' : 'daily_event',
        tx,
        holiday,
      ),
    );
  const daily = (overrides = {}) => ({
    eventId: newId(),
    userId,
    characterId,
    eventDate: '2026-10-09',
    summary: '今天练了一首新曲',
    source: 'simulation' as const,
    ...overrides,
  });

  beforeAll(async () => {
    await resetTestDatabase();
    db = new Database({ url: requireTestDatabaseUrl() });
    const guards = new ProactiveGuards(accounts, contacts);
    messages = new ProactiveMessageService(db, clock, guards);
    events = new DailyEventService(db, clock, guards);
    holidays = new HolidayService(db, clock, identity);
    bus = new EventBus();
    registry = new UserDataRegistry();
    lifecycle = new ProactiveLifecycle(
      db,
      bus,
      jobs,
      registry,
      guards,
      events,
      messages,
      chat,
      contacts,
    );
    const module = await Test.createTestingModule({
      controllers: [HolidayAdminController, DailyEventController],
      providers: [
        { provide: HolidayService, useValue: holidays },
        { provide: DailyEventService, useValue: events },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalGuards(
      new AuthGuard(new Reflector(), () => ({
        verify: async (token) =>
          token === 'admin' || token === 'user'
            ? {
                userId,
                sessionId: newId(),
                role: token === 'admin' ? 'admin' : 'user',
                adminSession: token === 'admin',
              }
            : null,
      })),
    );
    app.useGlobalFilters(new ApiErrorFilter(captureLogger().logger));
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await db?.close();
  });
  beforeEach(async () => {
    await db.query(
      'TRUNCATE proactive.daily_events, proactive.proactive_sent_log, proactive.proactive_pending_reply, proactive.holidays',
    );
    active = true;
    contactActive = true;
    timeZone = 'Asia/Shanghai';
    clock.set('2026-10-09T01:00:00Z');
  });
  it('真实执行迁移 down/up，注册清理队列与账号删除清单', async () => {
    await lifecycle.onModuleInit();
    const migrator = new Migrator(requireTestDatabaseUrl(), MIGRATIONS_DIR);
    expect(await migrator.down()).toEqual(['0021_proactive']);
    expect(await migrator.up()).toEqual(['0021_proactive']);
    expect(jobs.schedule).toHaveBeenCalledWith('proactive.prune_daily_events', '30 * * * *');
    expect(registry.list().some((v) => v.module === 'proactive')).toBe(true);
    expect((await holidays.list({ limit: 100 })).items.map((v) => v.name)).not.toContain('中秋节');
  });
  it('20 次并发同角色发送最多 3 次，节日也计入上限', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => send('parallel-' + i, characterId, true)),
    );
    expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(3);
    expect(await messages.getDailyCount(userId, characterId, '2026-10-09')).toBe(3);
    expect(await messages.canSendProactive(userId, characterId, '2026-10-09', 3, true)).toBe(false);
  });
  it('跨角色并发最多 8 次；用户本地日期切换不串计数', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => send('total-' + i, newId(), true)),
    );
    expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(8);
    expect(await messages.getDailyTotalCount(userId, '2026-10-09')).toBe(8);
    expect(await messages.getDailyTotalCount(userId, '2026-10-10')).toBe(0);
  });
  it('同键重投不重复计数；回复后重投不复活待回复；其他账号相同键独立', async () => {
    await send('same');
    await send('same');
    expect(await messages.getDailyCount(userId, characterId, '2026-10-09')).toBe(1);
    expect(await messages.hasPendingProactive(userId, characterId)).toBe(true);
    await messages.markReplied(userId, characterId);
    await send('same');
    expect(await messages.hasPendingProactive(userId, characterId)).toBe(false);
    expect(await send('same', characterId, false, newId())).toBe(1);
    await expect(send('same', newId())).rejects.toMatchObject({ code: 'conflict' });
  });
  it('待回复抑制普通消息，节日例外不清掉待回复；迟到旧回复不能清掉新消息', async () => {
    await send('normal');
    await expect(send('normal2')).rejects.toMatchObject({ code: 'conflict' });
    await send('holiday', characterId, true);
    expect(await messages.hasPendingProactive(userId, characterId)).toBe(true);
    await messages.markReplied(userId, characterId, undefined, '2026-10-08T12:00:00Z');
    expect(await messages.hasPendingProactive(userId, characterId)).toBe(true);
    await messages.markReplied(userId, characterId);
    expect(await messages.canSendProactive(userId, characterId, '2026-10-09')).toBe(true);
  });
  it('同一事务回滚消息伴随写入与配额；注销/移除联系人后的迟到写入拒绝', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO proactive.daily_events(id,user_id,character_id,event_date,summary,source,created_at) VALUES($1,$2,$3,'2026-10-09','模拟消息事务伴随记录','simulation',now())",
          [newId(), userId, characterId],
        );
        await messages.recordSent(userId, characterId, '2026-10-09', 'rollback', 'daily_event', tx);
        throw new Error('message failed');
      }),
    ).rejects.toThrow('message failed');
    expect(await lifecycle.countUserData(userId)).toBe(0);
    active = false;
    await expect(send('late')).rejects.toMatchObject({ code: 'not_found' });
    await expect(events.createBatch([daily()])).rejects.toMatchObject({ code: 'not_found' });
    active = true;
    contactActive = false;
    await expect(send('removed')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('用户消息订阅清掉待回复；重复联系人清理不影响恢复后的有效关系', async () => {
    await send('reply-event');
    const event = Events.MessageCreated.parse({
      eventId: newId(),
      type: 'chat.message_created',
      version: 1,
      producer: 'chat',
      occurredAt: clock.now().toISOString(),
      payload: {
        conversationId: newId(),
        conversationType: 'direct',
        messageId: newId(),
        seq: 1,
        senderParticipantId: newId(),
        senderKind: 'user',
        senderRefId: userId,
        contentType: 'text',
        scope: 'normal',
        quoteMessageId: null,
        mentionedParticipantIds: [],
        userRecipientIds: [userId],
      },
    });
    const subscription = bus.subscribersOf(event.type)[0]!;
    await db.transaction((tx) => subscription.handle(event, tx));
    await db.transaction((tx) => subscription.handle(event, tx));
    expect(await messages.hasPendingProactive(userId, characterId)).toBe(false);
    await events.createBatch([daily()]);
    const purge = Events.ContactPurged.parse({
      eventId: newId(),
      type: 'contacts.contact_purged',
      version: 1,
      producer: 'contacts',
      occurredAt: clock.now().toISOString(),
      payload: { userId, characterId, conversationId: null },
    });
    const clear = bus.subscribersOf(purge.type)[0]!;
    await db.transaction((tx) => clear.handle(purge, tx));
    expect(await lifecycle.countUserData(userId)).toBe(2);
    contactActive = false;
    await db.transaction((tx) => clear.handle(purge, tx));
    await db.transaction((tx) => clear.handle(purge, tx));
    expect(await lifecycle.countUserData(userId)).toBe(0);
  });
  it('日报幂等写入，分页无重复、账户隔离、坏游标与错误范围拒绝', async () => {
    const batch = Array.from({ length: 5 }, () => daily());
    expect(await events.createBatch(batch)).toBe(5);
    expect(await events.createBatch(batch)).toBe(0);
    await expect(events.createBatch([{ ...batch[0]!, summary: 'changed' }])).rejects.toMatchObject({
      code: 'conflict',
    });
    const a = await events.listByCharacter(userId, characterId, { limit: 2 });
    DailyEventEndpoints.listByCharacter.response.parse(a);
    const b = await events.listByCharacter(userId, characterId, {
      limit: 2,
      cursor: a.nextCursor!,
    });
    const c = await events.listByCharacter(userId, characterId, {
      limit: 2,
      cursor: b.nextCursor!,
    });
    expect(new Set([...a.items, ...b.items, ...c.items].map((v) => v.eventId)).size).toBe(5);
    expect(c.nextCursor).toBeNull();
    expect((await events.listByCharacter(newId(), characterId, { limit: 10 })).items).toEqual([]);
    await expect(
      events.listByCharacter(userId, newId(), { limit: 2, cursor: a.nextCursor! }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(
      events.listByCharacter(userId, characterId, { limit: 2, cursor: 'garbage' }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(
      events.listByCharacter(userId, characterId, {
        limit: 2,
        from: '2026-10-10',
        to: '2026-10-09',
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });
  it('清理超期日报、账号所有数据，清理后迟到注销写入无法复活', async () => {
    await events.createBatch([daily()]);
    await send('purge');
    const old = await events.createBatch([daily({ eventDate: '2026-09-01' })]);
    expect(old).toBe(1);
    clock.set('2026-12-09T12:00:00Z');
    expect(await events.pruneOldEvents()).toBe(1);
    expect(await lifecycle.purgeUser(userId)).toBe(3);
    expect(await lifecycle.countUserData(userId)).toBe(0);
    active = false;
    await expect(send('purged-late')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('节日 CRUD 真分页、停用、跨年、闰年与无效日期', async () => {
    for (const [name, dateType, dateValue] of [
      ['元旦', 'annual', '01-01'],
      ['闰日', 'annual', '02-29'],
      ['一次性', 'once', '2026-12-31'],
    ] as const) {
      HolidayEvent.parse(await holidays.create({ name, dateType, dateValue, romantic: false }));
    }
    const a = await holidays.list({ limit: 1 });
    const b = await holidays.list({ limit: 1, cursor: a.nextCursor! });
    expect(a.items[0]!.holidayId).not.toBe(b.items[0]!.holidayId);
    const upcoming = await holidays.getUpcoming('2026-12-31', 2);
    expect(upcoming.map((v) => v.name)).toEqual(['一次性', '元旦']);
    expect((await holidays.getUpcoming('2027-02-28', 3)).map((v) => v.name)).not.toContain('闰日');
    expect((await holidays.getUpcoming('2028-02-28', 3)).find((v) => v.name === '闰日')?.date).toBe(
      '2028-02-29',
    );
    await holidays.update(a.items[0]!.holidayId, { enabled: false });
    expect((await holidays.list({ enabled: true, limit: 100 })).items).toHaveLength(2);
    await holidays.remove(a.items[0]!.holidayId);
    await expect(
      holidays.create({ name: '坏日期', dateType: 'annual', dateValue: '02-30', romantic: false }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(
      holidays.create({
        name: '坏日期',
        dateType: 'once',
        dateValue: '2026-02-29',
        romantic: false,
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(holidays.list({ limit: 1, cursor: 'bad' })).rejects.toMatchObject({
      code: 'bad_request',
    });
  });
  it('相同 UTC 时刻按照用户 IANA 时区选择当天节日', async () => {
    await holidays.create({
      name: '9日',
      dateType: 'once',
      dateValue: '2026-10-09',
      romantic: false,
    });
    await holidays.create({
      name: '8日',
      dateType: 'once',
      dateValue: '2026-10-08',
      romantic: false,
    });
    expect((await holidays.getUpcomingForUser(userId, 1)).map((v) => v.name)).toEqual(['9日']);
    timeZone = 'America/Los_Angeles';
    expect((await holidays.getUpcomingForUser(userId, 1)).map((v) => v.name)).toEqual(['8日']);
  });
  it('真实 HTTP 守卫、契约校验、日报响应和联系人隐藏', async () => {
    const http = () => request(app.getHttpServer());
    const base = '/api/v1/admin/proactive/holidays';
    await http().get(base).expect(401);
    await http().get(base).set('Authorization', 'Bearer user').expect(403);
    const row = HolidayEvent.parse(
      (
        await http()
          .post(base)
          .set('Authorization', 'Bearer admin')
          .send({ name: '国庆节', dateType: 'annual', dateValue: '10-01' })
          .expect(201)
      ).body,
    );
    await http()
      .patch(base + '/bad')
      .set('Authorization', 'Bearer admin')
      .send({ enabled: false })
      .expect(400);
    await http()
      .patch(base + '/' + row.holidayId)
      .set('Authorization', 'Bearer admin')
      .send({ enabled: false })
      .expect(200);
    await http()
      .post(base)
      .set('Authorization', 'Bearer admin')
      .send({ name: '坏日期', dateType: 'annual', dateValue: '02-30' })
      .expect(400);
    const batch = '/api/v1/internal/proactive/daily-events/batch';
    const e = daily();
    await http()
      .post(batch)
      .set('Authorization', 'Bearer user')
      .send({ events: [e] })
      .expect(403);
    expect(
      (
        await http()
          .post(batch)
          .set('Authorization', 'Bearer admin')
          .send({ events: [e] })
          .expect(201)
      ).body,
    ).toEqual({ created: 1 });
    expect(
      (
        await http()
          .post(batch)
          .set('Authorization', 'Bearer admin')
          .send({ events: [e] })
          .expect(201)
      ).body,
    ).toEqual({ created: 0 });
    const path = '/api/v1/characters/' + characterId + '/daily-events';
    await http().get(path).expect(401);
    const page = DailyEventEndpoints.listByCharacter.response.parse(
      (await http().get(path).set('Authorization', 'Bearer user').expect(200)).body,
    );
    expect(page.items[0]!.eventId).toBe(e.eventId);
    await http()
      .get(path + '?cursor=bad')
      .set('Authorization', 'Bearer user')
      .expect(400);
    contactActive = false;
    await http().get(path).set('Authorization', 'Bearer user').expect(404);
  });
});
