import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  AdminCharacterWrite,
  CharacterCard,
  type ChatParticipantPort,
  type ChatReadPort,
  type ChatUserPort,
  type GenerateTextInput,
  type ModelGatewayPort,
  type CallTranscriptTurn,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  AUDIT_LOG,
  JOB_QUEUE,
  EVENT_DISPATCHER,
  TestClock,
  newId,
  type Database,
  type AuditLog,
  type JobQueue,
  type EventDispatcher,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CharacterService,
  ScenarioModeService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { ContactsCommands, ContactsTestQueries } from '../src/modules/contacts/testing.js';
import {
  CHAT_ADMIN_PORT,
  CHAT_PARTICIPANT_PORT,
  CHAT_READ_PORT,
  CHAT_USER_PORT,
} from '../src/modules/chat/index.js';
import { MODEL_GATEWAY_PORT } from '../src/modules/model-access/index.js';
import { MEDIA_SYSTEM_PORT, MEDIA_TRANSCRIPT_PORT } from '../src/modules/media/index.js';
import {
  MemoryService,
  ReplyContext,
  ConversationMemoryService,
  CompanionSettingsService,
  replyPlans,
} from '../src/modules/ai-runtime/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };

describeDb('电话与文字共用上下文：真实数据库及加密存档，模型与媒体为假端口', () => {
  let app: INestApplication;
  let db: Database;
  let userId: string;
  let characterId: string;
  let cid: string;
  let senderId: string;
  let epoch: string;
  const clock = new TestClock('2026-11-07T02:00:00Z');
  const requests: GenerateTextInput[] = [];
  const mediaId = newId();
  let modelResult = JSON.stringify({ operations: [], episode: '' });
  const gateway: ModelGatewayPort = {
    getModelStatus: async () => {
      throw Error('unused');
    },
    generateText: async (input) => {
      requests.push(input);
      return {
        ok: true,
        value: {
          text: modelResult,
          modelKey: 'fixture/model',
          usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, estimated: false },
          chargedMicros: 1,
          latencyMs: 1,
          usageRecordId: newId(),
        },
      };
    },
  };
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
      .overrideProvider(MODEL_GATEWAY_PORT)
      .useValue(gateway)
      .overrideProvider(MEDIA_SYSTEM_PORT)
      .useValue({ canUse: async () => true })
      .overrideProvider(MEDIA_TRANSCRIPT_PORT)
      .useValue({
        getTranscript: async (id: string) =>
          id === mediaId
            ? { status: 'ready', text: 'VOICE_CONTEXT_CANARY：请记住我周末去看蓝色风车。' }
            : { status: 'unavailable', text: null },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    await app.get<JobQueue>(JOB_QUEUE).start();
    db = app.get(DATABASE);
    const identity = app.get(IdentityCommands);
    const adminId = await identity.createAdmin('call_admin', 'fixture horse battery');
    userId = await identity.createAdmin('call_user', 'fixture horse battery');
    await identity.setRole('call_user', 'user');
    const service = app.get(CharacterService);
    const draft = await service.create(
      adminId,
      AdminCharacterWrite.parse({
        name: '电话上下文测试角色',
        tagline: '测试',
        intro: '原创成年',
        categoryId: 'original',
        avatar: {
          imageMediaId: null,
          display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
        },
        birthday: '2000-01-02',
        fanName: null,
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
        fallbackGreetings: ['你好'],
        card: CharacterCard.parse(sample.card),
      }),
    );
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: draft.characterId, adminId, revision: 1 });
    characterId = (await service.publish(adminId, draft.characterId)).characterId;
    const contacts = app.get(ContactsCommands);
    await contacts.add(userId, { characterId, greeting: '你好' });
    const row = (await new ContactsTestQueries(db).row(userId, characterId))!;
    clock.advance(row.accept_after.getTime() - clock.nowMs());
    await contacts.accept({ userId, characterId, requestId: row.request_id });
    epoch = row.request_id;
    const conversation = (await app
      .get<ChatReadPort>(CHAT_READ_PORT)
      .findDirectConversation(userId, characterId))!;
    cid = conversation.conversationId;
    senderId = conversation.participants.find((p) => p.kind === 'user')!.participantId;
  });
  afterAll(async () => {
    await app?.close();
  });
  const context = (turns: CallTranscriptTurn[] = []) =>
    app.get(ReplyContext).buildCall({
      userId,
      characterId,
      conversationId: cid,
      callId: newId(),
      startedAt: clock.now(),
      turns,
    });
  const message = (text: string) =>
    app.get<ChatUserPort>(CHAT_USER_PORT).sendMessage(userId, cid, {
      clientMsgId: newId(),
      content: { type: 'text', text },
    });
  async function dispatch() {
    for (let i = 0; i < 20; i++)
      if ((await app.get<EventDispatcher>(EVENT_DISPATCHER).dispatchOnce(200)).claimed === 0)
        return;
    throw Error('event backlog');
  }
  async function record(turns: CallTranscriptTurn[], attach = true) {
    const callId = newId();
    const posted = await app.get<ChatParticipantPort>(CHAT_PARTICIPANT_PORT).postMessage({
      conversationId: cid,
      senderParticipantId: senderId,
      idempotencyKey: callId,
      content: {
        type: 'call_record',
        callId,
        direction: 'outgoing',
        outcome: 'completed',
        durationSec: 120,
      },
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) throw Error('fixture record failed');
    const input = {
      userId,
      characterId,
      conversationId: cid,
      callId,
      scope: 'normal' as const,
      turns,
      transcript: turns.map((t) => `${t.role === 'user' ? '用户' : '我'}：${t.content}`).join('\n'),
      epoch,
      startedAt: clock.now(),
    };
    if (attach) await app.get(MemoryService).enqueueCallExtraction(input);
    return { input, message: posted.value };
  }

  it('电话沿用完整角色前缀、近期长文字和语音转写，并正确区分通话双方', async () => {
    await message('LONG_HISTORY_HEAD ' + '上下文测试'.repeat(100) + ' LONG_HISTORY_TAIL');
    for (let i = 0; i < 16; i++) await message(`日常第 ${i} 句`);
    await app.get<ChatUserPort>(CHAT_USER_PORT).sendMessage(userId, cid, {
      clientMsgId: newId(),
      content: { type: 'voice', mediaId, durationMs: 2500, transcript: null },
    });
    const snapshot = await context([
      { role: 'user', content: 'PHONE_CURRENT_CANARY：我现在在电话里。' },
    ]);
    expect(snapshot).not.toBeNull();
    const joined = JSON.stringify(snapshot!.messages);
    for (const expected of [
      'LONG_HISTORY_HEAD',
      'LONG_HISTORY_TAIL',
      'VOICE_CONTEXT_CANARY',
      'PHONE_CURRENT_CANARY',
      '语音通话',
    ])
      expect(joined).toContain(expected);
    expect(
      snapshot!.messages.some(
        (m) => m.role === 'user' && m.content.includes('PHONE_CURRENT_CANARY'),
      ),
    ).toBe(true);
    expect(snapshot!.stablePrefixChars).toBeGreaterThan(100);
    expect(snapshot!.messages[0]?.content).toContain('微伴');
    await app
      .get(CompanionSettingsService)
      .update(userId, characterId, { scenarioMode: 'treehole' });
    const changed = await context();
    expect(changed?.scenarioMode).toBe('treehole');
    expect(JSON.stringify(changed?.messages)).toContain('树洞');
    const catalog = app.get(ScenarioModeService);
    try {
      await catalog.update(userId, 'treehole', {
        presetPrompt: 'CALL_SCENE_CANARY：先问今天最想分享的一件事。',
      });
      const configured = JSON.stringify((await context())?.messages);
      expect(configured).toContain('CALL_SCENE_CANARY');
      expect(configured).not.toContain('多听少说');
      expect(configured).toContain('不改变角色身份');
    } finally {
      await catalog.update(userId, 'treehole', { presetPrompt: null });
    }
    await app.get(CompanionSettingsService).update(userId, characterId, { scenarioMode: 'daily' });
  });

  it('语音消息的已存转写进入普通记忆抽取，不再只留语音占位', async () => {
    await dispatch();
    const before = requests.length;
    await app
      .get(MemoryService)
      .extract({ userId, characterId, conversationId: cid, epoch, urgent: true, force: true });
    expect(JSON.stringify(requests.slice(before).map((r) => r.messages))).toContain(
      'VOICE_CONTEXT_CANARY',
    );
  });

  it('超过旧截断长度的电话原文加密留在同一气泡；文字和下一通电话都能接续，不排额外回复', async () => {
    await dispatch();
    const beforePlans = await db.db.select().from(replyPlans);
    const turns: CallTranscriptTurn[] = [
      { role: 'user', content: 'PHONE_BEGIN ' + '日常资料'.repeat(2300) },
      { role: 'assistant', content: '角色接话。' },
      { role: 'user', content: '电话后半段'.repeat(1500) + ' PHONE_END' },
    ];
    const saved = await record(turns);
    await dispatch();
    expect((await db.db.select().from(replyPlans)).map((p) => p.id)).toEqual(
      beforePlans.map((p) => p.id),
    );
    const read = await app
      .get<ChatReadPort>(CHAT_READ_PORT)
      .getMessage(saved.message.messageId, ['normal']);
    expect(read?.content).toMatchObject({ type: 'call_record', transcript: turns });
    const encrypted = await db.query<{ content_ciphertext: Buffer }>(
      'SELECT content_ciphertext FROM chat.messages WHERE id=$1',
      [saved.message.messageId],
    );
    expect(encrypted.rows[0]!.content_ciphertext.toString()).not.toContain('PHONE_BEGIN');
    expect(JSON.stringify((await context())!.messages)).toContain('PHONE_END');
    await message('接着刚才的电话聊。');
    await dispatch();
    const plan = (await db.db.select().from(replyPlans).orderBy(replyPlans.triggerSeq)).at(-1)!;
    const textContext = await app.get(ReplyContext).build(plan);
    expect(JSON.stringify(textContext?.messages)).toContain('PHONE_BEGIN');
    expect(JSON.stringify(textContext?.messages)).toContain('PHONE_END');
    // 幂等收尾不能替换既有转写，也不能新增普通消息。
    await app
      .get(MemoryService)
      .enqueueCallExtraction({ ...saved.input, turns: [{ role: 'user', content: '不应覆盖' }] });
    expect(
      (await app.get<ChatReadPort>(CHAT_READ_PORT).getMessage(saved.message.messageId, ['normal']))
        ?.content,
    ).toMatchObject({ transcript: turns });
    const before = requests.length;
    const worker = app.get(ConversationMemoryService);
    modelResult = JSON.stringify({
      operations: [
        {
          action: 'ADD',
          content: '分段资料已提取',
          category: 'status',
          importance: 5,
          sourceMessageIds: [saved.message.messageId],
        },
      ],
      episode: '',
    });
    for (let i = 0; i < 4; i++) await worker.call(saved.input.callId);
    modelResult = JSON.stringify({ operations: [], episode: '' });
    const chunks = requests
      .slice(before)
      .filter((r) => r.idempotencyKey.startsWith(`call-memory:${saved.input.callId}:`));
    expect(chunks.length).toBeGreaterThan(1);
    const restored = chunks
      .map((r) =>
        (JSON.parse(r.messages[1]!.content) as { turns: CallTranscriptTurn[] }).turns
          .map((t) => t.content)
          .join(''),
      )
      .join('');
    expect(restored).toBe(saved.input.transcript);
    const state = await db.query<{ status: string; ciphertext: Buffer | null }>(
      'SELECT status,ciphertext FROM ai_runtime.call_memory_jobs WHERE id=$1',
      [saved.input.callId],
    );
    expect(state.rows[0]).toMatchObject({ status: 'done', ciphertext: null });
    const outcomes = await db.query<{ action: string; details: unknown }>(
      "SELECT action,details FROM platform.audit_log WHERE target_type='call_memory_job' AND target_id=$1 ORDER BY occurred_at,id",
      [saved.input.callId],
    );
    expect(outcomes.rows.filter((row) => row.action === 'call_memory.done')).toEqual([
      { action: 'call_memory.done', details: { reason: 'saved' } },
    ]);
    expect(outcomes.rows.filter((row) => row.action === 'call_memory.partial')).toHaveLength(
      chunks.length - 1,
    );
    expect(
      (await app.get<ChatReadPort>(CHAT_READ_PORT).getMessage(saved.message.messageId, ['normal']))
        ?.content,
    ).toMatchObject({ transcript: turns });
  }, 120000);

  it('普通长历史整理会读取电话双方原文和语音转写，并完整推进长电话各段', async () => {
    const before = requests.length;
    const lastSeq = (await app.get<ChatReadPort>(CHAT_READ_PORT).getConversation(cid))!.lastSeq;
    // 空摘要是允许的测试模型输出；只检查真实送入整理器的来源内容和覆盖范围。
    modelResult = JSON.stringify({ items: [] });
    for (let i = 0; i < 4; i++)
      await app.get(MemoryService).compactWindow(userId, characterId, 'normal', lastSeq);
    modelResult = JSON.stringify({ operations: [], episode: '' });
    const summaries = requests
      .slice(before)
      .filter((r) => r.meta?.promptTemplateVersion === 'chat-summary-v2');
    const content = summaries.map((r) => r.messages[1]!.content).join('\n');
    for (const marker of ['VOICE_CONTEXT_CANARY', 'PHONE_BEGIN', 'PHONE_END', '角色接话'])
      expect(content).toContain(marker);
    const state = await db.query<{ covered_seq: string; partial_offset: number }>(
      'SELECT covered_seq,partial_offset FROM ai_runtime.chat_summary_states',
    );
    expect(Number(state.rows[0]!.covered_seq)).toBe(lastSeq);
    expect(state.rows[0]!.partial_offset).toBe(0);
  });

  it('电话整理额外字段和未知操作不再取消合法记忆，保存后文字上下文可接续且重放不重复', async () => {
    const saved = await record([{ role: 'user', content: 'REPAIR_FACT_CANARY：我喜欢蓝色风车。' }]);
    const before = requests.length;
    modelResult = JSON.stringify({
      operations: [
        {
          action: 'ADD',
          content: 'REPAIR_FACT_CANARY：喜欢蓝色风车',
          category: 'preference',
          importance: 8,
          sourceMessageIds: [saved.message.messageId],
          explanation: 'PRIVATE_EXTRA_CANARY',
        },
        {
          action: 'UNSUPPORTED',
          content: 'UNSUPPORTED_FACT_CANARY',
          category: 'status',
          importance: 5,
          sourceMessageIds: [saved.message.messageId],
        },
      ],
      episode: '一起聊了蓝色风车。',
    });
    try {
      const worker = app.get(ConversationMemoryService);
      await worker.call(saved.input.callId);
      await worker.call(saved.input.callId);
      expect(requests).toHaveLength(before + 1);
      expect(requests.at(-1)!.meta?.promptTemplateVersion).toBe('call-memory-v2');
      expect(requests.at(-1)!.messages[0]!.content).toContain('"action":"ADD"');
      const state = await db.query(
        'SELECT status,ciphertext,result_ciphertext FROM ai_runtime.call_memory_jobs WHERE id=$1',
        [saved.input.callId],
      );
      expect(state.rows).toEqual([{ status: 'done', ciphertext: null, result_ciphertext: null }]);
      const stored = await app
        .get(MemoryService)
        .context(userId, characterId, 'normal', '', undefined, { uncapped: true });
      expect(
        stored.items.filter((item) => item.content.includes('REPAIR_FACT_CANARY')),
      ).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain('UNSUPPORTED_FACT_CANARY');
      expect(JSON.stringify(stored)).not.toContain('PRIVATE_EXTRA_CANARY');
      expect(JSON.stringify((await context())!.messages)).toContain('REPAIR_FACT_CANARY');
      const audit = await db.query(
        "SELECT action,details FROM platform.audit_log WHERE target_type='call_memory_job' AND target_id=$1",
        [saved.input.callId],
      );
      expect(audit.rows).toEqual([
        {
          action: 'call_memory.done',
          details: { reason: 'saved_valid_parts', ignoredOperations: 1 },
        },
      ]);
      const episodes = await db.query(
        "SELECT count(*)::int AS n FROM ai_runtime.shared_episodes WHERE source_key=encode(sha256(convert_to('call:'||$1::text,'UTF8')),'hex')",
        [saved.input.callId],
      );
      expect(episodes.rows[0]!.n).toBe(1);
    } finally {
      modelResult = JSON.stringify({ operations: [], episode: '' });
    }
  });

  it('合法结果保存中断后从加密结果重试，记忆与审计一起回滚且不再调用模型', async () => {
    const saved = await record([{ role: 'user', content: 'REPAIR_RETRY_CANARY' }]);
    modelResult = JSON.stringify({
      operations: [
        {
          action: 'ADD',
          content: 'REPAIR_RETRY_CANARY',
          category: 'status',
          importance: 5,
          sourceMessageIds: [saved.message.messageId],
          extra: 'PRIVATE_EXTRA',
        },
      ],
      episode: '',
    });
    const before = requests.length;
    const failAudit = vi
      .spyOn(app.get<AuditLog>(AUDIT_LOG), 'record')
      .mockRejectedValueOnce(new Error('fixture audit unavailable'));
    try {
      await app.get(ConversationMemoryService).call(saved.input.callId);
      const pending = await db.query<{ status: string; result_ciphertext: Buffer | null }>(
        'SELECT status,result_ciphertext FROM ai_runtime.call_memory_jobs WHERE id=$1',
        [saved.input.callId],
      );
      expect(pending.rows[0]!.status).toBe('pending');
      expect(pending.rows[0]!.result_ciphertext).toBeInstanceOf(Buffer);
      expect(pending.rows[0]!.result_ciphertext!.toString()).not.toContain('REPAIR_RETRY_CANARY');
      const beforeRetry = await app
        .get(MemoryService)
        .context(userId, characterId, 'normal', '', undefined, { uncapped: true });
      expect(beforeRetry.items.some((item) => item.content.includes('REPAIR_RETRY_CANARY'))).toBe(
        false,
      );
      failAudit.mockRestore();
      await db.query('UPDATE ai_runtime.call_memory_jobs SET retry_after=NULL WHERE id=$1', [
        saved.input.callId,
      ]);
      await app.get(ConversationMemoryService).call(saved.input.callId);
      await app.get(ConversationMemoryService).call(saved.input.callId);
      expect(requests).toHaveLength(before + 1);
      const stored = await app
        .get(MemoryService)
        .context(userId, characterId, 'normal', '', undefined, { uncapped: true });
      expect(
        stored.items.filter((item) => item.content.includes('REPAIR_RETRY_CANARY')),
      ).toHaveLength(1);
    } finally {
      failAudit.mockRestore();
      modelResult = JSON.stringify({ operations: [], episode: '' });
    }
  });

  it('整份操作均不支持时明确登记没有有效记忆，不猜测新事实，不重复扣模型调用', async () => {
    const saved = await record([{ role: 'user', content: 'UNSUPPORTED_ONLY_PHONE' }]);
    modelResult = JSON.stringify({ operations: [{ action: 'UNSUPPORTED' }], episode: '' });
    const before = requests.length;
    try {
      await app.get(ConversationMemoryService).call(saved.input.callId);
      await app.get(ConversationMemoryService).call(saved.input.callId);
      expect(requests).toHaveLength(before + 1);
      const audit = await db.query(
        "SELECT action,details FROM platform.audit_log WHERE target_type='call_memory_job' AND target_id=$1",
        [saved.input.callId],
      );
      expect(audit.rows).toEqual([
        { action: 'call_memory.done', details: { reason: 'no_valid_parts', ignoredOperations: 1 } },
      ]);
    } finally {
      modelResult = JSON.stringify({ operations: [], episode: '' });
    }
  });

  it.each([
    ['invalid_result_json', () => 'PRIVATE_RESULT_CANARY: not JSON'],
    [
      'invalid_result_schema',
      () => JSON.stringify({ operations: 'PRIVATE_RESULT_CANARY', episode: '' }),
    ],
    [
      'invalid_source_reference',
      () =>
        JSON.stringify({
          operations: [
            {
              action: 'ADD',
              content: 'PRIVATE_RESULT_CANARY',
              category: 'status',
              importance: 5,
              sourceMessageIds: [newId()],
            },
          ],
          episode: '',
        }),
    ],
    [
      'restricted_content',
      (sourceId: string) =>
        JSON.stringify({
          operations: [
            {
              action: 'ADD',
              content: 'PRIVATE_RESULT_CANARY：经期记录',
              category: 'status',
              importance: 5,
              sourceMessageIds: [sourceId],
            },
          ],
          episode: '',
        }),
    ],
  ] as const)('电话记忆取消区分 %s，保留原通话且审计不含模型内容', async (reason, output) => {
    const turns: CallTranscriptTurn[] = [
      { role: 'user', content: 'PRIVATE_PHONE_CANARY：周末看风车。' },
    ];
    const saved = await record(turns);
    const before = requests.length;
    modelResult = output(saved.message.messageId);
    try {
      const worker = app.get(ConversationMemoryService);
      await worker.call(saved.input.callId);
      await worker.call(saved.input.callId);
      expect(requests).toHaveLength(before + 1);
      const state = await db.query(
        'SELECT status,ciphertext,result_ciphertext FROM ai_runtime.call_memory_jobs WHERE id=$1',
        [saved.input.callId],
      );
      expect(state.rows).toEqual([
        { status: 'cancelled', ciphertext: null, result_ciphertext: null },
      ]);
      const audit = await db.query(
        'SELECT action,actor_type,details FROM platform.audit_log WHERE target_type=$1 AND target_id=$2',
        ['call_memory_job', saved.input.callId],
      );
      expect(audit.rows).toEqual([
        { action: 'call_memory.cancelled', actor_type: 'system', details: { reason } },
      ]);
      expect(JSON.stringify(audit.rows)).not.toContain('PRIVATE_');
      expect(
        (
          await app
            .get<ChatReadPort>(CHAT_READ_PORT)
            .getMessage(saved.message.messageId, ['normal'])
        )?.content,
      ).toMatchObject({ transcript: turns });
    } finally {
      modelResult = JSON.stringify({ operations: [], episode: '' });
    }
  });

  it.each(['contact_changed', 'memory_changed'] as const)(
    '电话记忆 %s 屏障取消也留原因，不再请求模型',
    async (reason) => {
      const saved = await record([{ role: 'user', content: 'FENCE_PHONE_CANARY' }]);
      if (reason === 'contact_changed')
        await db.query('UPDATE ai_runtime.call_memory_jobs SET epoch=$2 WHERE id=$1', [
          saved.input.callId,
          newId(),
        ]);
      else
        await db.query('UPDATE ai_runtime.call_memory_jobs SET revision=revision+1 WHERE id=$1', [
          saved.input.callId,
        ]);
      const before = requests.length;
      await app.get(ConversationMemoryService).call(saved.input.callId);
      await app.get(ConversationMemoryService).call(saved.input.callId);
      expect(requests).toHaveLength(before);
      const audit = await db.query(
        'SELECT action,details FROM platform.audit_log WHERE target_type=$1 AND target_id=$2',
        ['call_memory_job', saved.input.callId],
      );
      expect(audit.rows).toEqual([{ action: 'call_memory.cancelled', details: { reason } }]);
    },
  );

  it('取消审计写入失败时整次状态更新回滚，不丢临时输入或制造无原因取消', async () => {
    const saved = await record([{ role: 'user', content: 'AUDIT_ATOMIC_PHONE_CANARY' }]);
    modelResult = 'invalid JSON';
    const audit = app.get<AuditLog>(AUDIT_LOG);
    const failAudit = vi
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('fixture audit unavailable'));
    try {
      await expect(app.get(ConversationMemoryService).call(saved.input.callId)).rejects.toThrow(
        'fixture audit unavailable',
      );
      const state = await db.query<{ status: string; ciphertext: Buffer | null }>(
        'SELECT status,ciphertext FROM ai_runtime.call_memory_jobs WHERE id=$1',
        [saved.input.callId],
      );
      expect(state.rows[0]!.status).toBe('pending');
      expect(state.rows[0]!.ciphertext).not.toBeNull();
      const events = await db.query(
        'SELECT id FROM platform.audit_log WHERE target_type=$1 AND target_id=$2',
        ['call_memory_job', saved.input.callId],
      );
      expect(events.rows).toEqual([]);
    } finally {
      failAudit.mockRestore();
      modelResult = JSON.stringify({ operations: [], episode: '' });
    }
  });

  it('电话来源范围、归属和已清空记录都不能被迟到收尾写回', async () => {
    const saved = await record([{ role: 'user', content: 'LATE_PHONE_CONTENT' }], false);
    const writer = app.get<ChatParticipantPort>(CHAT_PARTICIPANT_PORT);
    expect(
      await db.transaction((tx) =>
        writer.attachCallTranscript(tx, { ...saved.input, scope: 'adult' }),
      ),
    ).toBeNull();
    expect(
      await db.transaction((tx) =>
        writer.attachCallTranscript(tx, { ...saved.input, characterId: newId() }),
      ),
    ).toBeNull();
    await expect(
      db.transaction((tx) => writer.attachCallTranscript(tx, { ...saved.input, userId: newId() })),
    ).rejects.toThrow();
    await db.query(
      'UPDATE chat.user_conversation_states SET cleared_through_seq=$3 WHERE user_id=$1 AND conversation_id=$2',
      [userId, cid, saved.message.seq],
    );
    await app.get(MemoryService).enqueueCallExtraction(saved.input);
    expect(
      (await app.get<ChatReadPort>(CHAT_READ_PORT).getMessage(saved.message.messageId, ['normal']))
        ?.content,
    ).not.toHaveProperty('transcript');
    expect(
      (
        await db.query('SELECT id FROM ai_runtime.call_memory_jobs WHERE id=$1', [
          saved.input.callId,
        ])
      ).rows,
    ).toEqual([]);
  });

  it('删除记忆后电话原文遵守同一遗忘屏障，不能通过再次电话读回', async () => {
    await record([{ role: 'user', content: 'PHONE_FORGET_CANARY：准备去找红色风车。' }]);
    expect(JSON.stringify((await context())!.messages)).toContain('PHONE_FORGET_CANARY');
    const memory = app.get(MemoryService);
    const item = await memory.create(userId, characterId, {
      clientMemoryId: newId(),
      category: 'status',
      content: '准备去找红色风车。',
    });
    await memory.remove(userId, characterId, item.memoryId);
    await message('接下来换个话题。');
    expect(JSON.stringify((await context())!.messages)).not.toContain('PHONE_FORGET_CANARY');
  });

  it('通话使用健康私密提示时标记记录，不进入长期抽取；私密范围不能打开通话上下文', async () => {
    const saved = await record([{ role: 'user', content: '仅供本次健康关怀使用的资料' }], false);
    await app.get(MemoryService).enqueueCallExtraction({ ...saved.input, healthUsed: true });
    expect(
      (await app.get<ChatReadPort>(CHAT_READ_PORT).getMessage(saved.message.messageId, ['normal']))
        ?.labels,
    ).toContain('health');
    expect(
      (
        await db.query('SELECT id FROM ai_runtime.call_memory_jobs WHERE id=$1', [
          saved.input.callId,
        ])
      ).rows,
    ).toEqual([]);
    await app.get(CHAT_ADMIN_PORT).setContentScope({ conversationId: cid, scope: 'adult' });
    expect(await context()).toBeNull();
    await app.get(CHAT_ADMIN_PORT).setContentScope({ conversationId: cid, scope: 'normal' });
  });
});
