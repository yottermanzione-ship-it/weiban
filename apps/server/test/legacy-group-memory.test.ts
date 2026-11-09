import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { ChatReadPort, GenerateTextInput } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { CHAT_READ_PORT } from '../src/modules/chat/index.js';
import { ChatGroupService, ChatStore } from '../src/modules/chat/testing.js';
import {
  LegacyGroupMemoryService,
  MemoryService,
  GroupChatService,
  ReplyPlanStore,
  GroupReplyStore,
  LegacySharedGroupBatch,
  LEGACY_GROUP_CONTEXT_MAX_BYTES,
} from '../src/modules/ai-runtime/testing.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  EVENT_DISPATCHER,
  OUTBOX,
  TestClock,
  newId,
  type Database,
  type EnvelopeCrypto,
  type EventDispatcher,
  type Outbox,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase, TEST_DATABASE_URL } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const now = '2026-11-09T08:00:00.000Z',
  joined = '2026-10-01T00:00:00.000Z';
const up = readFileSync(
  fileURLToPath(new URL('../drizzle/0164_legacy_group_memories.sql', import.meta.url)),
  'utf8',
);
const down = readFileSync(
  fileURLToPath(new URL('../drizzle/0164_legacy_group_memories.down.sql', import.meta.url)),
  'utf8',
);
describeDb('旧共享群记忆：群级加密、读取边界与隔离迁移', () => {
  let app: INestApplication,
    db: Database,
    service: LegacyGroupMemoryService,
    crypto: EnvelopeCrypto,
    chat: ChatReadPort;
  const clock = new TestClock(now),
    logs = captureLogger('silent');
  let sequence = 0;
  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    const ci =
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' &&
      /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') &&
      url.hostname === '127.0.0.1' &&
      url.port === '5432' &&
      url.pathname === '/weiban_test' &&
      url.username === 'weiban';
    if (
      url.hostname !== '127.0.0.1' ||
      (!ci &&
        (url.pathname !== '/codex_migration_group_scope_1109' ||
          url.port !== '56389' ||
          url.username !== 'postgres')) ||
      url.search ||
      url.hash
    )
      throw new Error('DEDICATED_GROUP_SCOPE_DATABASE_REQUIRED');
    if (!ci) {
      const client = new pg.Client({ connectionString: TEST_DATABASE_URL! });
      await client.connect();
      try {
        const count = await client.query(
          "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE'",
        );
        if (count.rows[0].n) {
          const marker = await client.query(
            "SELECT to_regclass('public.codex_migration_fixture') marker",
          );
          if (
            !marker.rows[0].marker ||
            (
              await client.query(
                "SELECT synthetic FROM public.codex_migration_fixture WHERE id='migration-1109'",
              )
            ).rows[0]?.synthetic !== true
          )
            throw new Error('EXISTING_NON_FIXTURE_DATABASE_REFUSED');
        }
      } finally {
        await client.end();
      }
    }
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
    service = app.get(LegacyGroupMemoryService);
    crypto = app.get(ENVELOPE_CRYPTO);
    chat = app.get(CHAT_READ_PORT);
    if (!ci)
      await db.query(
        "CREATE TABLE IF NOT EXISTS public.codex_migration_fixture(id text PRIMARY KEY,synthetic boolean NOT NULL); INSERT INTO public.codex_migration_fixture VALUES('migration-1109',true) ON CONFLICT DO NOTHING",
      );
    await db.transaction(async (tx) => {
      await tx.query(down);
      await tx.query(up);
    });
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });
  async function fixture() {
    const username = `group_scope_${++sequence}`;
    const user = await app
      .get(IdentityCommands)
      .createAdmin(username, randomBytes(32).toString('hex'));
    await app.get(IdentityCommands).setRole(username, 'user');
    const group = newId(),
      characters = [newId(), newId()],
      sourceGroup = newId();
    const participants = [newId(), newId(), newId()];
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO chat.conversations(id,owner_user_id,type,title,system_participant_id,content_scope,last_seq,created_at,updated_at)
          VALUES($1,$2,'group','Synthetic group',$3,'normal',1,$4,$4)`,
        [group, user, newId(), joined],
      );
      for (let index = 0; index < 3; index++)
        await tx.query(
          `INSERT INTO chat.participants(id,conversation_id,kind,ref_id,joined_at,read_seq)
        VALUES($1,$2,$3,$4,$5,0)`,
          [
            participants[index],
            group,
            index === 0 ? 'user' : 'character',
            index === 0 ? user : characters[index - 1],
            joined,
          ],
        );
      await tx.query(
        'INSERT INTO chat.user_conversation_states(conversation_id,user_id) VALUES($1,$2)',
        [group, user],
      );
      const message = newId();
      await tx.query(
        `INSERT INTO chat.messages(id,conversation_id,seq,sender_participant_id,sender_kind,client_msg_id,content_ciphertext,status,scope,created_at,content_type)
        VALUES($1,$2,1,$3,'user',$4,$5,'normal','normal',$6,'text')`,
        [
          message,
          group,
          participants[0],
          newId(),
          await crypto.seal(
            user,
            `chat:message:${message}`,
            JSON.stringify({ type: 'text', text: 'Synthetic original group history' }),
            tx,
          ),
          joined,
        ],
      );
      for (const character of characters) {
        const direct = newId();
        await tx.query(
          `INSERT INTO chat.conversations(id,owner_user_id,type,character_id,system_participant_id,content_scope,last_seq,created_at,updated_at)
          VALUES($1,$2,'direct',$3,$4,'normal',0,$5,$5)`,
          [direct, user, character, newId(), joined],
        );
        await tx.query(
          `INSERT INTO chat.participants(id,conversation_id,kind,ref_id,joined_at,read_seq)
          VALUES($1,$2,'user',$3,$4,0),($5,$2,'character',$6,$4,0)`,
          [newId(), direct, user, joined, newId(), character],
        );
        await tx.query(
          'INSERT INTO chat.user_conversation_states(conversation_id,user_id) VALUES($1,$2)',
          [direct, user],
        );
        await tx.query(
          `INSERT INTO contacts.contacts(id,user_id,character_id,status,request_id,acceptance_mode,accept_after,known_since,added_at,conversation_id,relationship_type)
          VALUES($1,$2,$3,'active',$4,'restored',$5,'2026-10-01',$5,$6,'friend')`,
          [newId(), user, character, newId(), joined, direct],
        );
      }
    });
    const row = (n = 0) => ({
      id: `source-${n}`,
      group_id: sourceGroup,
      mem_type: '群共同事实',
      content: `SYNTHETIC_SHARED_${n}`,
      confidence: 0.8,
      enabled: 1 as const,
      source: 'auto',
      created_at: new Date(Date.parse('2026-10-25T00:00:00Z') + n * 1000).toISOString(),
      subject_character_id: '' as const,
      supersedes_id: '' as const,
      provenance_json: '{}',
    });
    const batch = async (rows = [row()]): Promise<LegacySharedGroupBatch> => ({
      format: 'weiban-legacy-shared-group-memory-v1',
      sourceAccountId: user,
      sourceGroup: { id: sourceGroup, user_id: user, archived: 0 },
      targetConversationId: group,
      expectedTargetDigest: (await service.targetSnapshot(user, group)).digest,
      batchId: 'synthetic-review',
      cutoff: now,
      evidence: {
        ownerMappingVerified: true,
        sourceComplete: true,
        normalScopeVerified: true,
        deletionReviewComplete: true,
        forgetReviewComplete: true,
      },
      rows,
    });
    const context = (purpose = 'chat_reply', character = characters[0]!) =>
      service.context(user, group, character, purpose);
    return { user, group, characters, participants, sourceGroup, row, batch, context };
  }
  it('保存全部原行但仅返回原群最近30条启用记录，完整正文加密且不复制个人记忆', async () => {
    const f = await fixture(),
      input = await f.batch(Array.from({ length: 35 }, (_, i) => f.row(i)));
    input.rows.push({ ...f.row(35), enabled: 0 });
    const result = await service.importBatch(f.user, input);
    expect(result).toEqual({ inserted: 36, active: 35, blocked: 1, existing: 0 });
    const context = await f.context(),
      lines = JSON.parse(context.text.split('\n')[1]!) as string[];
    expect(lines).toEqual(Array.from({ length: 30 }, (_, i) => `SYNTHETIC_SHARED_${34 - i}`));
    const saved = (
      await db.query<{ id: string; ciphertext: Buffer }>(
        'SELECT id,ciphertext FROM ai_runtime.legacy_group_memories WHERE user_id=$1 AND source_memory_id=$2',
        [f.user, 'source-0'],
      )
    ).rows[0]!;
    expect(saved.ciphertext.includes(Buffer.from('SYNTHETIC_SHARED'))).toBe(false);
    const plain = await crypto.open(f.user, `ai:legacy-group-memory:${saved.id}`, saved.ciphertext);
    try {
      expect(JSON.parse(plain.toString())).toEqual({ version: 1, source: f.row() });
    } finally {
      plain.fill(0);
    }
    expect(
      (await db.query('SELECT * FROM ai_runtime.memories WHERE user_id=$1', [f.user])).rows,
    ).toHaveLength(0);
    expect(logs.capture.text).not.toContain('SYNTHETIC_SHARED');
  });
  it('来源账号/群映射明确、跨用户与跨群拒绝，重跑及并发只写一次', async () => {
    const a = await fixture(),
      b = await fixture(),
      input = await a.batch();
    await expect(service.importBatch(b.user, input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      service.importBatch(a.user, { ...input, targetConversationId: b.group }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const results = await Promise.all([
      service.importBatch(a.user, input),
      service.importBatch(a.user, input),
    ]);
    expect(results.reduce((n, r) => n + r.inserted, 0)).toBe(1);
    expect((await service.context(b.user, a.group, a.characters[0]!, 'chat_reply')).text).toBe('');
    expect((await service.context(a.user, b.group, a.characters[0]!, 'chat_reply')).text).toBe('');
    await expect(
      service.importBatch(a.user, { ...input, rows: [{ ...a.row(), content: 'changed' }] }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('总预算包含JSON转义，仅选完整条目；长行原件保留，输入集合变化让旧戳失效', async () => {
    const f = await fixture();
    const rows = Array.from({ length: 35 }, (_, n) => ({
      ...f.row(n),
      content:
        n < 5
          ? `outside-recent-30-${n}`
          : n === 34
            ? '长'.repeat(5000)
            : n % 2
              ? '\u0000'.repeat(200)
              : `record-${n}-${'合'.repeat(100)}`,
    }));
    const input = await f.batch(rows);
    expect((await service.importBatch(f.user, input)).active).toBe(35);
    const context = await f.context(),
      selected = JSON.parse(context.text.split('\n')[1]!) as string[];
    expect(Buffer.byteLength(context.text, 'utf8')).toBeLessThanOrEqual(
      LEGACY_GROUP_CONTEXT_MAX_BYTES,
    );
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThan(30);
    expect(selected.every((value) => rows.slice(5).some((row) => row.content === value))).toBe(
      true,
    );
    expect(selected).not.toContain(rows[34]!.content);
    const saved = (
      await db.query<{ id: string; ciphertext: Buffer }>(
        'SELECT id,ciphertext FROM ai_runtime.legacy_group_memories WHERE user_id=$1 AND source_memory_id=$2',
        [f.user, 'source-34'],
      )
    ).rows[0]!;
    const plain = await crypto.open(f.user, `ai:legacy-group-memory:${saved.id}`, saved.ciphertext);
    try {
      expect(JSON.parse(plain.toString()).source.content).toBe(rows[34]!.content);
    } finally {
      plain.fill(0);
    }
    const more = await f.batch([{ ...f.row(36), content: 'newest complete record' }]);
    await service.importBatch(f.user, more);
    expect(await service.isCurrent(f.user, f.group, f.characters[0]!, context.stamp!)).toBe(false);
    expect((await f.context()).text).toContain('newest complete record');
  });
  it('缺少审核、旧群归档、停用及健康/未知来源均不自动激活', async () => {
    for (const mode of ['missing', 'archived', 'disabled', 'health', 'provenance'] as const) {
      const f = await fixture(),
        input = await f.batch();
      if (mode === 'missing') input.evidence.forgetReviewComplete = false;
      if (mode === 'archived') input.sourceGroup.archived = 1;
      if (mode === 'disabled') input.rows[0]!.enabled = 0;
      if (mode === 'health') input.rows[0]!.content = 'Synthetic menstrual health information';
      if (mode === 'provenance') input.rows[0]!.provenance_json = '{"scope":"unknown"}';
      expect((await service.importBatch(f.user, input)).active).toBe(0);
      expect((await f.context()).text).toBe('');
    }
  });
  it('空群仅加密留档；补齐历史不覆盖已blocked来源，不靠重跑自动激活', async () => {
    const f = await fixture();
    const original = (
      await db.query(
        'SELECT id,client_msg_id,content_ciphertext FROM chat.messages WHERE conversation_id=$1',
        [f.group],
      )
    ).rows[0]!;
    await db.query('DELETE FROM chat.messages WHERE conversation_id=$1', [f.group]);
    await db.query('UPDATE chat.conversations SET last_seq=0 WHERE id=$1', [f.group]);
    const input = await f.batch();
    expect(await service.importBatch(f.user, input)).toEqual({
      inserted: 1,
      existing: 0,
      active: 0,
      blocked: 1,
    });
    expect((await f.context()).text).toBe('');
    expect(
      (
        await db.query('SELECT ciphertext FROM ai_runtime.legacy_group_memories WHERE user_id=$1', [
          f.user,
        ])
      ).rows[0]!.ciphertext,
    ).toBeInstanceOf(Buffer);
    await db.query(
      `INSERT INTO chat.messages(id,conversation_id,seq,sender_participant_id,sender_kind,client_msg_id,content_ciphertext,status,scope,created_at,content_type)
      VALUES($1,$2,1,$3,'user',$4,$5,'normal','normal',$6,'text')`,
      [
        original.id,
        f.group,
        f.participants[0],
        original.client_msg_id,
        original.content_ciphertext,
        joined,
      ],
    );
    await db.query('UPDATE chat.conversations SET last_seq=1 WHERE id=$1', [f.group]);
    await expect(service.importBatch(f.user, await f.batch())).rejects.toMatchObject({
      code: 'conflict',
    });
    expect((await f.context()).text).toBe('');
  });
  it('明确来源格式与截止点严格校验，坏行导致整批回滚且无私人正文日志', async () => {
    const f = await fixture(),
      input = await f.batch();
    await expect(
      service.importBatch(f.user, {
        ...input,
        rows: [{ ...f.row(), subject_character_id: f.characters[0] }],
      }),
    ).rejects.toThrow();
    const rows = [f.row(), { ...f.row(1), created_at: '2026-12-01T00:00:00Z' }];
    await expect(service.importBatch(f.user, { ...input, rows })).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(
      (await db.query('SELECT * FROM ai_runtime.legacy_group_memories WHERE user_id=$1', [f.user]))
        .rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query('SELECT * FROM ai_runtime.legacy_group_memory_sources WHERE user_id=$1', [
          f.user,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(logs.capture.text).not.toContain('SYNTHETIC_SHARED');
  });
  it('目标修改、离群、隐藏、归档、清空和非普通范围不会被历史承接覆盖', async () => {
    const f = await fixture(),
      input = await f.batch();
    await db.query(
      'UPDATE chat.user_conversation_states SET cleared_through_seq=1 WHERE conversation_id=$1',
      [f.group],
    );
    await expect(service.importBatch(f.user, input)).rejects.toMatchObject({ code: 'conflict' });
    for (const mode of ['left', 'hidden', 'archived', 'cleared', 'adult'] as const) {
      const g = await fixture();
      await service.importBatch(g.user, await g.batch());
      if (mode === 'left')
        await db.query('UPDATE chat.participants SET left_at=$2 WHERE id=$1', [
          g.participants[1],
          now,
        ]);
      if (mode === 'hidden')
        await db.query(
          'UPDATE chat.user_conversation_states SET hidden=true WHERE conversation_id=$1',
          [g.group],
        );
      if (mode === 'archived')
        await db.query('UPDATE chat.conversations SET archived_at=$2 WHERE id=$1', [g.group, now]);
      if (mode === 'cleared')
        await db.query(
          'UPDATE chat.user_conversation_states SET cleared_through_seq=1 WHERE conversation_id=$1',
          [g.group],
        );
      if (mode === 'adult')
        await db.query("UPDATE chat.conversations SET content_scope='adult' WHERE id=$1", [
          g.group,
        ]);
      expect((await g.context()).text).toBe('');
    }
  });
  it('真实个人记忆遗忘留下独立排除墓碑，清理memory_states后不复活；其他成员仍保留群记录', async () => {
    const f = await fixture();
    await service.importBatch(f.user, await f.batch());
    const memory = app.get(MemoryService);
    const created = await memory.create(f.user, f.characters[0]!, {
      clientMemoryId: newId(),
      content: 'Synthetic personal fact',
      category: 'basic',
    });
    expect((await f.context()).text).toContain('SYNTHETIC_SHARED');
    await memory.remove(f.user, f.characters[0]!, created.memoryId);
    await db.query('DELETE FROM ai_runtime.memory_states WHERE user_id=$1 AND character_id=$2', [
      f.user,
      f.characters[0],
    ]);
    expect((await f.context()).text).toBe('');
    expect((await f.context('chat_reply', f.characters[1]!)).text).toContain('SYNTHETIC_SHARED');
  });
  it('联系时期变化立即阻断旧成员，generation变化使旧请求戳失效', async () => {
    const f = await fixture();
    await service.importBatch(f.user, await f.batch());
    const previous = await f.context();
    await db.query(
      `INSERT INTO ai_runtime.group_memory_states(id,user_id,conversation_id,generation,last_user_at)
      VALUES($1,$2,$3,1,$4)`,
      [newId(), f.user, f.group, now],
    );
    expect(await service.isCurrent(f.user, f.group, f.characters[0]!, previous.stamp!)).toBe(false);
    expect((await f.context()).text).toContain('SYNTHETIC_SHARED');
    await db.query(
      'UPDATE contacts.contacts SET request_id=$3,accept_after=$4 WHERE user_id=$1 AND character_id=$2',
      [f.user, f.characters[0], newId(), now],
    );
    expect((await f.context()).text).toBe('');
  });
  it('读取不创建写事务，私聊和主动用途不读取共享群内容，不产生历史费用或outbox', async () => {
    const f = await fixture();
    const before = (await db.query<{ n: number }>('SELECT count(*)::int n FROM platform.outbox'))
      .rows[0]!.n;
    await service.importBatch(f.user, await f.batch());
    const spy = vi.spyOn(db, 'transaction');
    try {
      expect((await f.context()).text).toContain('SYNTHETIC_SHARED');
      expect((await f.context('proactive')).text).toBe('');
      expect((await f.context('private_chat')).text).toBe('');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(
      (await db.query<{ n: number }>('SELECT count(*)::int n FROM platform.outbox')).rows[0]!.n,
    ).toBe(before);
    expect(
      Number((await db.query('SELECT count(*) n FROM billing.ledger_entries')).rows[0]!.n),
    ).toBe(0);
  });
  it('写前门禁等候并发清空的同一会话行锁，清空提交后旧戳被拒绝且不另开连接', async () => {
    const f = await fixture();
    await service.importBatch(f.user, await f.batch());
    const snapshot = await f.context();
    await expect(
      chat.getGroupMemoryAccess!(f.user, f.group, undefined, true),
    ).rejects.toMatchObject({ code: 'bad_request' });
    let release!: () => void, held!: () => void, entered!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      held = resolve;
    });
    const locking = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const clear = db.transaction(async (tx) => {
      const row = await app.get(ChatStore).load(tx, f.group, f.user);
      await tx.query(
        'UPDATE chat.user_conversation_states SET cleared_through_seq=$2 WHERE conversation_id=$1',
        [f.group, row.lastSeq],
      );
      held();
      await hold;
    });
    await ready;
    const read = chat.getGroupMemoryAccess!.bind(chat);
    const spy = vi
      .spyOn(chat, 'getGroupMemoryAccess')
      .mockImplementation(async (u, c, tx, lock) => {
        if (lock) entered();
        return read(u, c, tx, lock);
      });
    let finished = false;
    const check = db
      .transaction(async (tx) => {
        await app.get(ReplyPlanStore).lock(tx, f.user, f.group);
        return service.isCurrent(f.user, f.group, f.characters[0]!, snapshot.stamp!, tx);
      })
      .finally(() => {
        finished = true;
      });
    try {
      await locking;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(finished).toBe(false);
    } finally {
      release();
    }
    try {
      await clear;
      expect(await check).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
  it('群解散事件清除密文并保留防重建来源标记，账号注销清除全部新表', async () => {
    const f = await fixture(),
      input = await f.batch();
    await service.importBatch(f.user, input);
    await app.get(ChatGroupService).dissolveForUser(f.user, f.group);
    for (let i = 0; i < 5; i++) {
      const result = await app.get<EventDispatcher>(EVENT_DISPATCHER).dispatchOnce(100);
      if (result.claimed === 0) break;
    }
    const rows = (
      await db.query<{ ciphertext: Buffer | null; deleted_at: Date | null }>(
        'SELECT ciphertext,deleted_at FROM ai_runtime.legacy_group_memories WHERE user_id=$1',
        [f.user],
      )
    ).rows;
    expect(rows[0]!.ciphertext).toBeNull();
    expect(rows[0]!.deleted_at).toBeInstanceOf(Date);
    await expect(service.importBatch(f.user, input)).rejects.toMatchObject({ code: 'not_found' });
    await db.query("UPDATE identity.users SET status='deleting' WHERE id=$1", [f.user]);
    await app.get(ReplyPlanStore).purgeUser(f.user);
    await db.transaction(async (tx) => {
      for (const type of ['contacts.contact_reset', 'contacts.contact_purged'] as const)
        await app.get<Outbox>(OUTBOX).publish(tx, type, 'contacts', {
          userId: f.user,
          characterId: f.characters[0]!,
          conversationId: null,
        });
    });
    for (let i = 0; i < 5; i++) {
      const result = await app.get<EventDispatcher>(EVENT_DISPATCHER).dispatchOnce(100);
      if (result.claimed === 0) break;
    }
    for (const table of [
      'legacy_group_memories',
      'legacy_group_memory_sources',
      'legacy_group_memory_exclusions',
    ])
      expect(
        (await db.query(`SELECT * FROM ai_runtime.${table} WHERE user_id=$1`, [f.user])).rows,
      ).toHaveLength(0);
  });
  it('0164空表down/up成功；有数据时拒绝破坏性回滚', async () => {
    const f = await fixture();
    await service.importBatch(f.user, await f.batch());
    await expect(db.transaction((tx) => tx.query(down))).rejects.toThrow(
      'legacy_group_memory_data_requires_forward_fix',
    );
    expect((await f.context()).text).toContain('SYNTHETIC_SHARED');
  });
  it('群回复真实speak路径仅普通回合带群记录；旧缓存戳失效时不调用模型或发送', async () => {
    const f = await fixture();
    await service.importBatch(f.user, await f.batch());
    const conversation = (await chat.getConversation(f.group))!;
    const calls: Array<GenerateTextInput & { legacyGroupMemoryStamp?: string }> = [],
      posted: unknown[] = [];
    const speaker = {
      participantId: f.participants[1],
      characterId: f.characters[0],
      name: 'Synthetic',
      familiarity: 0,
    };
    const runtime = Object.create(GroupChatService.prototype) as GroupChatService;
    Object.assign(runtime, {
      legacyGroupMemory: service,
      db,
      replies: app.get(GroupReplyStore),
      stillActive: async () => true,
      history: async () => [],
      typingIfPresent: async () => {},
      newerUserMessage: async () => false,
      characters: {
        getForRuntime: async () => ({
          profile: { name: 'Synthetic', aliases: [] },
          card: null,
          legacyCard: null,
        }),
      },
      policy: {
        getCharacterPolicy: async () => ({
          isRealPerson: false,
          isMinor: false,
          romanceAllowed: true,
        }),
      },
      identity: { getProfile: async () => ({ nickname: 'Synthetic' }) },
      relations: { getRelation: async () => null },
      brain: {
        build: async () => ({ scope: 'normal', prefix: 'Synthetic personal context', recall: '' }),
      },
      adultBoundary: {
        generate: async (request: GenerateTextInput) => {
          calls.push(request);
          return { ok: true, value: { text: '合成回答' } };
        },
      },
      writer: {
        postMessage: async (value: unknown) => {
          posted.push(value);
          return { ok: true, value: { messageId: newId() } };
        },
      },
    });
    const speak = (purpose: string, durable?: unknown) =>
      (runtime as unknown as { speak(value: unknown): Promise<unknown> }).speak({
        userId: f.user,
        conversation,
        members: [speaker],
        speaker,
        reason: 'picked',
        instant: true,
        scenarioMode: 'daily',
        idempotencyKey: newId(),
        purpose,
        topic: null,
        labels: [],
        triggerSeq: 0,
        ...(durable ? { durable } : {}),
      });
    await speak('chat_reply');
    expect(calls[0]!.messages.map((m) => m.content).join('\n')).toContain('SYNTHETIC_SHARED');
    await speak('proactive');
    expect(calls[1]!.messages.map((m) => m.content).join('\n')).not.toContain('SYNTHETIC_SHARED');
    const frozen = calls[0]!;
    await db.transaction((tx) => service.excludeCharacter(tx, f.user, f.characters[0]!));
    Object.assign(runtime, {
      replies: {
        open: async (_row: unknown, part: string) =>
          part === 'input' ? frozen : { text: 'old result' },
        checkpoint: async () => ({}),
      },
    });
    const before = calls.length,
      delivered = posted.length;
    expect(await speak('chat_reply', { retryEpoch: 1 })).toBeNull();
    expect(calls).toHaveLength(before);
    expect(posted).toHaveLength(delivered);
  });
});
