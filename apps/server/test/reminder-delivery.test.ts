/** Q031：真实聊天写入、进度原子提交、失败重试及到点幂等。 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { SettingsService } from '../src/modules/identity/testing.js';
import { CustomCharacterService } from '../src/modules/characters/testing.js';
import { ContactsCommands, ContactsTestQueries } from '../src/modules/contacts/testing.js';
import { PlayContext, RemindersService } from '../src/modules/play/testing.js';
import {
  DATABASE,
  JOB_QUEUE,
  TestClock,
  type Database,
  type JobQueue,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('提醒可靠送达（真实数据库）', () => {
  let app: INestApplication;
  let db: Database;
  let service: RemindersService;
  let userId: string;
  let characterId: string;
  const clock = new TestClock('2026-11-04T08:00:00Z');

  beforeAll(async () => {
    await resetTestDatabase();
    const fixture = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig(),
          clock,
          logger: captureLogger().logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = fixture.createNestApplication({ logger: false });
    await app.init();
    await app.get<JobQueue>(JOB_QUEUE).start();
    db = app.get(DATABASE);
    service = app.get(RemindersService);
    const commands = app.get(IdentityCommands);
    userId = await commands.createAdmin('reminder_regression', randomBytes(24).toString('hex'));
    await commands.setRole('reminder_regression', 'user');
    const character = await app.get(CustomCharacterService).create(userId, {
      name: '合成提醒角色',
      description:
        '一位完全虚构的成年角色，喜欢阅读与观察日常，语气自然简洁，尊重他人边界。这些资料仅用于自动测试。',
      classification: {
        basis: 'original',
        realPersonKind: null,
        ageSetting: 'adult',
        childAppearance: false,
      },
    });
    characterId = character.characterId;
    const contacts = app.get(ContactsCommands);
    await contacts.add(userId, { characterId });
    const contact = (await new ContactsTestQueries(db).row(userId, characterId))!;
    clock.advance(Math.max(0, contact.accept_after.getTime() - clock.nowMs()));
    await contacts.accept({ userId, characterId, requestId: contact.request_id });
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  async function reminder(options: { health?: boolean; daily?: boolean; bypass?: boolean } = {}) {
    const wall = new Date(clock.nowMs() + 8 * 3_600_000 + 3 * 60_000).toISOString();
    return service.create(userId, {
      clientRequestId: randomUUID(),
      characterId,
      text: '喝水',
      time: wall.slice(11, 16),
      repeat: options.daily
        ? { kind: 'daily', weekdays: [] }
        : { kind: 'once', date: wall.slice(0, 10) },
      health: options.health ?? false,
      bypassDoNotDisturb: options.bypass ?? true,
      enabled: true,
    });
  }

  function advanceTo(iso: string) {
    clock.advance(Math.max(0, Date.parse(iso) - clock.nowMs()) + 1000);
  }
  async function state(id: string) {
    return (
      await db.query<{
        next_fire_at: Date | null;
        last_fired_at: Date | null;
        phrasing_cursor: number;
      }>('SELECT next_fire_at,last_fired_at,phrasing_cursor FROM play.reminders WHERE id=$1', [id])
    ).rows[0]!;
  }
  async function messages(id: string) {
    return (
      await db.query<{ labels: string[] | null }>(
        'SELECT labels FROM chat.messages WHERE client_msg_id LIKE $1',
        [`reminder:${id}:%`],
      )
    ).rows;
  }

  it.each([false, true])(
    '普通/健康提醒在零余额下到点发送，并发扫描只一条（健康=%s）',
    async (health) => {
      const r = await reminder({ health });
      advanceTo(r.nextFireAt!);
      await Promise.all([service.sweepDue(clock.now()), service.sweepDue(clock.now())]);
      const sent = await messages(r.reminderId);
      expect(sent).toHaveLength(1);
      expect((sent[0]!.labels ?? []).includes('health')).toBe(health);
      expect(await state(r.reminderId)).toMatchObject({
        next_fire_at: null,
        last_fired_at: new Date(r.nextFireAt!),
        phrasing_cursor: 1,
      });
    },
  );

  it.each(['before', 'after'] as const)(
    '发送%s阶段失败不消费本次，下一分钟恢复只发一次',
    async (stage) => {
      const r = await reminder({ daily: true });
      const initial = await state(r.reminderId);
      advanceTo(r.nextFireAt!);
      const ctx = app.get(PlayContext);
      const original = ctx.postToDirectChat.bind(ctx);
      const spy = vi.spyOn(ctx, 'postToDirectChat').mockImplementationOnce(async (...args) => {
        if (stage === 'after') await original(...args);
        throw new Error('synthetic delivery failure');
      });
      try {
        await service.sweepDue(clock.now());
      } finally {
        spy.mockRestore();
      }
      expect(await state(r.reminderId)).toEqual(initial);
      expect(await messages(r.reminderId)).toHaveLength(0);
      clock.advance(60_000);
      await service.sweepDue(clock.now());
      await service.sweepDue(clock.now());
      expect(await messages(r.reminderId)).toHaveLength(1);
      const saved = await state(r.reminderId);
      expect(saved.last_fired_at).toEqual(new Date(r.nextFireAt!));
      expect(saved.next_fire_at!.getTime() - Date.parse(r.nextFireAt!)).toBe(86_400_000);
      expect(saved.phrasing_cursor).toBe(1);
    },
  );

  it('错过超过三十分钟保持原规则：不补发旧提醒', async () => {
    const r = await reminder();
    advanceTo(r.nextFireAt!);
    clock.advance(31 * 60_000);
    await service.sweepDue(clock.now());
    expect(await messages(r.reminderId)).toHaveLength(0);
    expect(await state(r.reminderId)).toMatchObject({
      next_fire_at: null,
      last_fired_at: new Date(r.nextFireAt!),
    });
  });

  it('免打扰期间仅发送明确勾选仍提醒的条目', async () => {
    await app.get(SettingsService).updateNotificationSettings(userId, {
      doNotDisturb: { enabled: true, start: '00:00', end: '23:59' },
    });
    const muted = await reminder({ bypass: false });
    const bypassed = await reminder({ bypass: true });
    advanceTo(bypassed.nextFireAt!);
    await service.sweepDue(clock.now());
    expect(await messages(muted.reminderId)).toHaveLength(0);
    expect(await messages(bypassed.reminderId)).toHaveLength(1);
  });
});
