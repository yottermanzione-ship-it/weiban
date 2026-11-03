import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  Events,
  type BillingPaidHistoryPort,
  type CardCopywriterPort,
  type ChatAdminPort,
  type Contact,
  type ContactsReadPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { DATABASE, TestClock, newId, type Database } from '../src/platform/index.js';
import { BILLING_PAID_HISTORY_PORT } from '../src/modules/billing/index.js';
import { CHAT_ADMIN_PORT } from '../src/modules/chat/index.js';
import { CONTACTS_READ_PORT } from '../src/modules/contacts/index.js';
import { GROWTH_CARD_COPYWRITER, GrowthService } from '../src/modules/growth/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

/**
 * T-20261104d：熟悉度从第 5 阶段「恋人」升到第 6 阶段「伴侣」（真实 PG）。
 * 生产事故：契约事件 growth.familiarity_leveled_up 的 level 写死上限 5，升到 6 时 Outbox.publish 校验失败，
 * 整个加分事务回滚，用户永远停在第 5 阶段、每条消息都重复报错。这里走与生产订阅者相同的
 * GrowthService.awardUserMessage，事件经真实 Outbox 校验写入，系统提示经真实 chat 写进私聊。
 * 好友关系只替换「读联系人」一个端口（指向真实私聊会话），省去角色上架与加好友的整条链路。
 */
describeDb('熟悉度升到第 6 阶段：真实PG', () => {
  let app: INestApplication;
  let db: Database;
  let growth: GrowthService;
  let userId: string;
  let conversationId: string;
  const characterId = newId();
  const clock = new TestClock('2026-11-03T11:30:00Z');
  const logs = captureLogger();
  const notices: Array<Parameters<ChatAdminPort['postSystemMessage']>[1]> = [];

  beforeAll(async () => {
    await resetTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web' }),
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
    growth = app.get(GrowthService);
    const identity = app.get(IdentityCommands);
    userId = await identity.createAdmin('stage6_owner', 'correct horse battery');
    await identity.setRole('stage6_owner', 'user');

    const chatAdmin = app.get<ChatAdminPort>(CHAT_ADMIN_PORT);
    conversationId = (
      await db.transaction((tx) =>
        chatAdmin.ensureDirectConversation(tx, { userId, characterId, restoreHistory: true }),
      )
    ).conversationId;
    // 系统提示照常写进真实私聊，只记下参数供断言。
    const post = chatAdmin.postSystemMessage.bind(chatAdmin);
    vi.spyOn(chatAdmin, 'postSystemMessage').mockImplementation((tx, input) => {
      notices.push(input);
      return post(tx, input);
    });

    const contact: Contact = {
      characterId,
      status: 'active',
      remark: '阿澈',
      customAvatarMediaId: null,
      addressAs: null,
      knownSince: '2026-10-01',
      conversationId,
      addedAt: '2026-10-01T00:00:00.000Z',
    };
    const contacts = app.get<ContactsReadPort>(CONTACTS_READ_PORT);
    vi.spyOn(contacts, 'getActiveContact').mockImplementation(async (u, c) =>
      u === userId && c === characterId ? contact : null,
    );
    vi.spyOn(contacts, 'listActiveContacts').mockImplementation(async (u) =>
      u === userId ? [contact] : [],
    );
    // 充值过的账号不受「亲密好友」上限限制，可以到第 6 阶段。
    vi.spyOn(
      app.get<BillingPaidHistoryPort>(BILLING_PAID_HISTORY_PORT),
      'hasPaidBefore',
    ).mockResolvedValue(true);
    // 卡片文案用模板（不调模型）。
    vi.spyOn(
      app.get<CardCopywriterPort>(GROWTH_CARD_COPYWRITER),
      'writeCardCopy',
    ).mockResolvedValue(null);

    // 第 5 阶段「恋人」，差 4 点（一条有效消息）到第 6 阶段（默认阈值 700）。
    await db.query(
      `INSERT INTO growth.familiarity
         (id, user_id, character_id, total_points, level, daily_points, daily_points_date, updated_at)
       VALUES ($1, $2, $3, 696, 5, 0, '2026-11-03', $4)`,
      [newId(), userId, characterId, clock.now()],
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  const leveledUpEvents = async () =>
    (
      await db.query<{ event: unknown }>(
        `SELECT event FROM platform.outbox WHERE event_type = 'growth.familiarity_leveled_up'`,
      )
    ).rows.map((r) => Events.FamiliarityLeveledUp.parse(r.event));

  it('一条有效消息从第 5 阶段升到第 6 阶段：事件发出、阶段落库为 6、系统提示和卡片都发出', async () => {
    const added = await db.transaction((tx) =>
      growth.awardUserMessage(
        tx,
        userId,
        characterId,
        newId(),
        '今天也想和你多聊一会儿',
        clock.now(),
      ),
    );
    expect(added).toBe(4);

    const { rows } = await db.query<{ level: number; total_points: number }>(
      'SELECT level, total_points FROM growth.familiarity WHERE user_id = $1 AND character_id = $2',
      [userId, characterId],
    );
    expect(rows).toEqual([{ level: 6, total_points: 700 }]);

    const events = await leveledUpEvents();
    expect(events.map((e) => e.payload)).toEqual([{ userId, characterId, level: 6 }]);

    const cards = await db.query<{ title: string; line: string; idempotency_key: string }>(
      `SELECT title, line, idempotency_key FROM growth.cards
        WHERE user_id = $1 AND character_id = $2 AND kind = 'familiarity'`,
      [userId, characterId],
    );
    expect(cards.rows).toEqual([
      {
        title: '伴侣',
        line: '往后的日子，也想一直和你一起过。',
        idempotency_key: 'familiarity:6',
      },
    ]);

    expect(notices.find((n) => n.code === 'familiarity_level_up')).toMatchObject({
      conversationId,
      params: { characterId, characterName: '阿澈', level: 6, levelName: '伴侣' },
    });
    expect(notices.find((n) => n.code === 'card_obtained')).toMatchObject({
      conversationId,
      params: { kind: 'familiarity', title: '伴侣', level: 6, levelName: '伴侣' },
    });
    const written = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM chat.messages WHERE conversation_id = $1 AND sender_kind = 'system'`,
      [conversationId],
    );
    expect(Number(written.rows[0]?.n)).toBe(2);

    const info = await growth.getFamiliarity(userId, characterId);
    expect(info).toMatchObject({ level: 6, stageName: '伴侣', pointsToNextLevel: null });
  });

  it('到第 6 阶段后继续聊天：照常加分，不再重复升级或报错', async () => {
    clock.advance(5_000);
    const added = await db.transaction((tx) =>
      growth.awardUserMessage(tx, userId, characterId, newId(), '晚安，明天见', clock.now()),
    );
    expect(added).toBe(4);
    const { rows } = await db.query<{ level: number; total_points: number }>(
      'SELECT level, total_points FROM growth.familiarity WHERE user_id = $1 AND character_id = $2',
      [userId, characterId],
    );
    expect(rows).toEqual([{ level: 6, total_points: 704 }]);
    expect(await leveledUpEvents()).toHaveLength(1);
  });
});
