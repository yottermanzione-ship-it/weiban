import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AdminCharacterPurgeImpact,
  AdminCharacterPurgeResult,
  AdminCharacterWrite,
  AuthResponse,
  CharacterCard,
  type ChatUserPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  JOB_QUEUE,
  TestClock,
  newId,
  type Database,
  type JobQueue,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CharacterCheckWorker,
  CharacterService,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { ContactsCommands, ContactsTestQueries } from '../src/modules/contacts/testing.js';
import { CHAT_USER_PORT } from '../src/modules/chat/index.js';
import { MomentsService } from '../src/modules/moments/testing.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };
const card = CharacterCard.parse(sample.card);

describeDb('管理员彻底删除预设角色：真实 PG 单事务清理与审计', () => {
  let app: INestApplication;
  let db: Database;
  let identity: IdentityCommands;
  let characterService: CharacterService;
  let checkWorker: CharacterCheckWorker;
  let contacts: ContactsCommands;
  let contactsQuery: ContactsTestQueries;
  let chatUser: ChatUserPort;
  let moments: MomentsService;
  let adminId: string;
  let userId: string;
  let adminToken: string;
  let userToken: string;
  const clock = new TestClock('2026-10-24T08:00:00Z');
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await resetTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web' }),
          clock,
          logger: captureLogger().logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    })
      .overrideProvider(CHARACTER_EVALUATOR)
      .useValue({
        evaluate: async () => ({
          childFeaturesDetected: false,
          personaStabilityPassed: true,
          hardBoundaryCasesPassed: true,
        }),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    await app.get<JobQueue>(JOB_QUEUE).start();
    db = app.get(DATABASE);
    identity = app.get(IdentityCommands);
    characterService = app.get(CharacterService);
    checkWorker = app.get(CharacterCheckWorker);
    contacts = app.get(ContactsCommands);
    contactsQuery = new ContactsTestQueries(db);
    chatUser = app.get(CHAT_USER_PORT);
    moments = app.get(MomentsService);
    adminId = await identity.createAdmin('purge_admin', 'correct horse battery');
    userId = await identity.createAdmin('purge_user', 'correct horse battery', 'Asia/Shanghai');
    await identity.setRole('purge_user', 'user');
    adminToken = await login('purge_admin', 'admin');
    userToken = await login('purge_user', 'app');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function login(username: string, kind: 'admin' | 'app') {
    return AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({
            username,
            password: 'correct horse battery',
            kind,
            device: {
              platform: 'web',
              name: 'character purge',
              appVersion: '0.1.0',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(200)
      ).body,
    ).session.token;
  }

  async function createPublished(name: string): Promise<string> {
    const row = await characterService.create(
      adminId,
      AdminCharacterWrite.parse({
        name,
        tagline: '硬删除测试',
        intro: '这是一位原创成年虚构角色，用于管理员硬删除集成测试。',
        categoryId: 'original',
        avatar: {
          imageMediaId: null,
          display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
        },
        birthday: null,
        fanName: null,
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
        fallbackGreetings: ['你好，欢迎来聊聊天'],
        card,
      }),
    );
    await checkWorker.runChecks({ characterId: row.characterId, adminId, revision: 1 });
    return (await characterService.publish(adminId, row.characterId)).characterId;
  }

  /** 真实走通：添加联系人 → P30 通过 → 私聊 → 用户发一条消息 → 角色发一条朋友圈。 */
  async function attachUserData(characterId: string): Promise<void> {
    await contacts.add(userId, { characterId, greeting: '你好' });
    const contact = await contactsQuery.row(userId, characterId);
    if (!contact) throw new Error('联系人创建失败');
    clock.advance(Math.max(0, contact.accept_after.getTime() - clock.nowMs()) + 1000);
    await contacts.accept({ userId, characterId, requestId: contact.request_id });
    const [row] = (
      await db.query<{ conversation_id: string }>(
        'SELECT conversation_id FROM contacts.contacts WHERE user_id=$1 AND character_id=$2',
        [userId, characterId],
      )
    ).rows;
    await chatUser.sendMessage(userId, row!.conversation_id, {
      clientMsgId: newId(),
      content: { type: 'text', text: '这条消息会随角色一起删除' },
    });
    const posted = await moments.createPost(null, {
      ownerUserId: userId,
      characterId,
      text: '今天的朋友圈也会随角色一起删除',
      imageMediaIds: [],
      link: null,
      sourceRef: { kind: 'daily_event', id: newId() },
      idempotencyKey: newId(),
    });
    if (!posted.ok) throw new Error(`发朋友圈失败：${posted.error}`);
  }

  async function rowCounts(characterId: string) {
    const { rows } = await db.query<{
      characters: number;
      contacts: number;
      conversations: number;
      messages: number;
      moments: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM characters.characters WHERE id=$1) AS characters,
         (SELECT count(*)::int FROM contacts.contacts WHERE character_id=$1) AS contacts,
         (SELECT count(*)::int FROM chat.conversations WHERE character_id=$1) AS conversations,
         (SELECT count(*)::int FROM chat.messages m
            JOIN chat.conversations c ON c.id=m.conversation_id
           WHERE c.character_id=$1) AS messages,
         (SELECT count(*)::int FROM moments.posts WHERE author_character_id=$1) AS moments`,
      [characterId],
    );
    return rows[0]!;
  }

  it('影响面计数正确；删除后角色、联系人、会话、消息、朋友圈都查不到；重复删除 404', async () => {
    const characterId = await createPublished('彻底删除测试角色');
    await attachUserData(characterId);

    const before = await rowCounts(characterId);
    expect(before).toMatchObject({ characters: 1, contacts: 1, conversations: 1, moments: 1 });
    // 联系人通过时写了一条系统提示，用户又发了一条。
    expect(before.messages).toBe(2);

    const impactResponse = await http()
      .get(`/api/v1/admin/characters/${characterId}/purge-impact`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const impact = AdminCharacterPurgeImpact.parse(impactResponse.body);
    expect(impact.counts).toEqual({
      contacts: before.contacts,
      conversations: before.conversations,
      messages: before.messages,
      moments: before.moments,
    });

    const purgeResponse = await http()
      .delete(`/api/v1/admin/characters/${characterId}`)
      .query({ purge: 'true' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const result = AdminCharacterPurgeResult.parse(purgeResponse.body);
    expect(result.counts).toEqual(impact.counts);

    expect(await rowCounts(characterId)).toEqual({
      characters: 0,
      contacts: 0,
      conversations: 0,
      messages: 0,
      moments: 0,
    });
    await http()
      .get(`/api/v1/admin/characters/${characterId}/purge-impact`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    await http()
      .delete(`/api/v1/admin/characters/${characterId}`)
      .query({ purge: 'true' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('非管理员不能查影响面或彻底删除（403），且角色数据不变', async () => {
    const characterId = await createPublished('普通用户不能删的角色');
    for (const response of [
      await http()
        .get(`/api/v1/admin/characters/${characterId}/purge-impact`)
        .set('Authorization', `Bearer ${userToken}`),
      await http()
        .delete(`/api/v1/admin/characters/${characterId}`)
        .query({ purge: 'true' })
        .set('Authorization', `Bearer ${userToken}`),
    ])
      expect(response.status).toBe(403);
    expect((await rowCounts(characterId)).characters).toBe(1);

    // 未带 purge=true 的 DELETE 不是硬删除入口，按契约校验拒绝。
    await http()
      .delete(`/api/v1/admin/characters/${characterId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect((await rowCounts(characterId)).characters).toBe(1);
  });

  it('删除写审计 character.purged，并记录影响条数', async () => {
    const characterId = await createPublished('审计测试角色');
    await attachUserData(characterId);
    const purgeResponse = await http()
      .delete(`/api/v1/admin/characters/${characterId}`)
      .query({ purge: 'true' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const result = AdminCharacterPurgeResult.parse(purgeResponse.body);

    const { rows } = await db.query<{
      actor_id: string;
      actor_type: string;
      target_type: string;
      details: { name: string; impact: Record<string, number> };
    }>(
      `SELECT actor_id, actor_type, target_type, details
         FROM platform.audit_log
        WHERE action = 'character.purged' AND target_id = $1
        ORDER BY occurred_at DESC
        LIMIT 1`,
      [characterId],
    );
    expect(rows[0]).toMatchObject({
      actor_id: adminId,
      actor_type: 'admin',
      target_type: 'character',
    });
    expect(rows[0]?.details.name).toBe('审计测试角色');
    expect(rows[0]?.details.impact).toEqual({
      contacts: result.counts.contacts,
      conversations: result.counts.conversations,
      messageCount: result.counts.messages,
      moments: result.counts.moments,
    });
  });

  it('别的角色日报里的「同行角色」引用被清空，不留悬空 id', async () => {
    const purged = await createPublished('被删的同行角色');
    const owner = await createPublished('保留日报的角色');
    const eventId = newId();
    await db.query(
      `INSERT INTO proactive.daily_events
         (id, user_id, character_id, event_date, summary, with_character_id, source, created_at)
       VALUES ($1, $2, $3, DATE '2026-10-24', '今天和 TA 一起散步', $4, 'simulation', now())`,
      [eventId, userId, owner, purged],
    );

    await http()
      .delete(`/api/v1/admin/characters/${purged}`)
      .query({ purge: 'true' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 日报属于用户自己的记录：保留正文，只把已删除角色的引用置空。
    const { rows } = await db.query<{ with_character_id: string | null }>(
      'SELECT with_character_id FROM proactive.daily_events WHERE id = $1',
      [eventId],
    );
    expect(rows[0]).toEqual({ with_character_id: null });
  });
});
