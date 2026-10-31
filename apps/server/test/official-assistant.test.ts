/**
 * 官方身份集成测试（迁移 0150 + ensure 语义）。
 * 只连 TEST_DATABASE_URL（weiban_test），无变量时整组跳过。
 */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { OFFICIAL_IDENTITY_KEY, OFFICIAL_REF_ID } from '@weiban/contracts';
import {
  Database,
  TestClock,
  newId,
} from '../src/platform/index.js';
import { ChatAdminService, ChatStore } from '../src/modules/chat/testing.js';
import { describeDb } from './support/db.js';
import {
  requireTestDatabaseUrl,
  resetTestDatabase,
  roundTripMigration,
  withClient,
} from './support/db-admin.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '55555555-5555-4555-8555-555555555555';

describeDb('官方身份迁移 0150', () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it('迁移可往返（down 再 up，结构恢复完整）', async () => {
    await roundTripMigration('0150_official_identity');
  });

  it('约束：官方参与者/消息可写，重复官方会话与非法键被拒', async () => {
    await withClient(async (client) => {
      const convId = newId();
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO chat.conversations
          (id, owner_user_id, type, character_id, official_identity_key, title,
           system_participant_id, content_scope, last_seq, created_at, updated_at)
         VALUES ($1,$2,'direct',NULL,$3,NULL,$4,'normal',0,$5,$5)`,
        [convId, USER_ID, OFFICIAL_IDENTITY_KEY, newId(), now],
      );
      const [userP, officialP] = [newId(), newId()];
      await client.query(
        `INSERT INTO chat.participants (id, conversation_id, kind, ref_id, joined_at, read_seq)
         VALUES ($1,$2,'user',$3,$4,0), ($5,$2,'official',$6,$4,0)`,
        [userP, convId, USER_ID, now, officialP, OFFICIAL_REF_ID],
      );
      await client.query(
        `INSERT INTO chat.messages
          (id, conversation_id, seq, sender_participant_id, sender_kind, client_msg_id,
           content_ciphertext, status, scope, created_at)
         VALUES ($1,$2,1,$3,'official','test-official-1',NULL,'normal','normal',$4)`,
        [newId(), convId, officialP, now],
      );

      // 同一用户第二个官方会话：部分唯一索引拒绝。
      await expect(
        client.query(
          `INSERT INTO chat.conversations
            (id, owner_user_id, type, character_id, official_identity_key, title,
             system_participant_id, content_scope, last_seq, created_at, updated_at)
           VALUES ($1,$2,'direct',NULL,$3,NULL,$4,'normal',0,$5,$5)`,
          [newId(), USER_ID, OFFICIAL_IDENTITY_KEY, newId(), now],
        ),
      ).rejects.toMatchObject({ code: '23505' });

      // 非法官方键：check 约束拒绝。
      await expect(
        client.query(
          `INSERT INTO chat.conversations
            (id, owner_user_id, type, character_id, official_identity_key, title,
             system_participant_id, content_scope, last_seq, created_at, updated_at)
           VALUES ($1,$2,'direct',NULL,'official:bogus',NULL,$3,'normal',0,$4,$4)`,
          [newId(), OTHER_USER_ID, newId(), now],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      // 非法参与者 kind 与消息 sender_kind：check 约束拒绝。
      await expect(
        client.query(
          `INSERT INTO chat.participants (id, conversation_id, kind, ref_id, joined_at, read_seq)
           VALUES ($1,$2,'bogus',$3,$4,0)`,
          [newId(), convId, USER_ID, now],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        client.query(
          `INSERT INTO chat.messages
            (id, conversation_id, seq, sender_participant_id, sender_kind, client_msg_id,
             content_ciphertext, status, scope, created_at)
           VALUES ($1,$2,2,$3,'bogus','test-bogus',NULL,'normal','normal',$4)`,
          [newId(), convId, userP, now],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});

describeDb('官方会话 ensure（真实库 + 真实 ChatAdminService）', () => {
  let database: Database;
  let admin: ChatAdminService;

  beforeAll(async () => {
    await resetTestDatabase();
    database = new Database({ url: requireTestDatabaseUrl() });
    const crypto = { open: vi.fn(async () => Buffer.from('{}')) };
    const accounts = { getAccountStatus: vi.fn(async () => 'active') };
    const store = new ChatStore(
      crypto as never,
      accounts as never,
    );
    admin = new ChatAdminService(
      database,
      new TestClock(),
      store,
      {} as never, // writer：ensure 路径不用
      { appendUpdate: vi.fn(async () => undefined) } as never,
      { publish: vi.fn(async () => undefined) } as never,
      {} as never, // policy：ensure 路径不用
    );
  });

  afterAll(async () => {
    await database.close();
  });

  it('首次创建带官方参与者，重复调用幂等（同一会话）', async () => {
    const first = await database.transaction((tx) =>
      admin.ensureOfficialConversation(tx as never, { userId: USER_ID }),
    );
    expect(first.type).toBe('direct');
    expect(first.participants.map((p) => p.kind).sort()).toEqual(['official', 'user']);
    expect(
      first.participants.find((p) => p.kind === 'official')?.refId,
    ).toBe(OFFICIAL_REF_ID);
    const second = await database.transaction((tx) =>
      admin.ensureOfficialConversation(tx as never, { userId: USER_ID }),
    );
    expect(second.conversationId).toBe(first.conversationId);
  });

  it('归档后再次 ensure 只恢复归档、不删历史消息', async () => {
    const conv = await database.transaction((tx) =>
      admin.ensureOfficialConversation(tx as never, { userId: USER_ID }),
    );
    const officialParticipant = conv.participants.find((p) => p.kind === 'official')!;
    await withClient(async (client) => {
      await client.query(
        `UPDATE chat.conversations SET archived_at = now() WHERE id = $1`,
        [conv.conversationId],
      );
      await client.query(
        `INSERT INTO chat.messages
          (id, conversation_id, seq, sender_participant_id, sender_kind, client_msg_id,
           content_ciphertext, status, scope, created_at)
         VALUES ($1,$2,1,$3,'official','test-history-1',NULL,'normal','normal',now())`,
        [newId(), conv.conversationId, officialParticipant.participantId],
      );
    });
    const restored = await database.transaction((tx) =>
      admin.ensureOfficialConversation(tx as never, { userId: USER_ID }),
    );
    expect(restored.conversationId).toBe(conv.conversationId);
    const count = await withClient(async (client) => {
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM chat.messages WHERE conversation_id = $1`,
        [conv.conversationId],
      );
      return Number(rows[0]!.count);
    });
    expect(count).toBe(1);
  });
});
