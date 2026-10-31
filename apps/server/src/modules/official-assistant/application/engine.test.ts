import { describe, expect, it, vi } from 'vitest';
import type {
  ChatAdminPort,
  ChatParticipantPort,
  ChatReadPort,
  Conversation,
  Message,
  ModelGatewayPlatformPort,
} from '@weiban/contracts';
import type { Database } from '../../../platform/index.js';
import { OFFICIAL_REF_ID } from '@weiban/contracts';
import { OfficialAssistantEngine, type OfficialReplyJob } from './engine.js';
import { BriefService } from './brief.js';
import { loadKnowledgeBase } from '../domain/knowledge-base.js';
import {
  OFFICIAL_FAILURE_TEXT,
  OFFICIAL_NON_TEXT_TEXT,
  OFFICIAL_RATE_LIMIT_TEXT,
  OFFICIAL_UNKNOWN_TEXT,
  OFFICIAL_WELCOME_TEXT,
} from '../domain/identity.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const OFFICIAL_PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444';

function conversation(participants: Array<{ kind: string; refId: string }>): Conversation {
  return {
    conversationId: CONVERSATION_ID,
    type: 'direct',
    title: null,
    participants: participants.map((p, i) => ({
      participantId: `p${i}`,
      kind: p.kind,
      refId: p.refId,
      joinedAt: '2026-10-31T00:00:00.000Z',
    })),
    contentScope: 'normal',
    lastSeq: 3,
    lastMessage: null,
    state: {
      pinned: false,
      muted: false,
      hidden: false,
      clearedThroughSeq: 0,
      readSeq: 0,
      markedUnread: false,
      backgroundMediaId: null,
    },
    unreadCount: 0,
    peerReadSeq: 0,
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
  } as unknown as Conversation;
}

function officialConversation(): Conversation {
  const conv = conversation([
    { kind: 'user', refId: USER_ID },
    { kind: 'official', refId: OFFICIAL_REF_ID },
  ]);
  conv.participants[1]!.participantId = OFFICIAL_PARTICIPANT_ID;
  return conv;
}

function textMessage(seq: number, senderKind: string, text: string, id = MESSAGE_ID): Message {
  return {
    messageId: id,
    conversationId: CONVERSATION_ID,
    seq,
    senderParticipantId: 'p0',
    senderKind,
    content: { type: 'text', text },
    quote: null,
    status: 'normal',
    scope: 'normal',
    clientMsgId: null,
    createdAt: '2026-10-31T00:00:00.000Z',
    recalledAt: null,
  } as unknown as Message;
}

const FULL_FACTS = {
  pointsBalance: '1234',
  contactCount: '3',
  contactLimit: '50',
  membershipTier: '免费',
  membershipExpiresAt: null,
  membershipPlans: '月卡 20 元 / 1 个月，首次 12.9 元，开通赠 2000 积分',
  rechargeTiers: '10 元、30 元、100 元，不赠送',
  signupBonus: '100',
};

interface Harness {
  engine: OfficialAssistantEngine;
  chatRead: { getConversation: ReturnType<typeof vi.fn>; readMessages: ReturnType<typeof vi.fn>; getMessage: ReturnType<typeof vi.fn> };
  participants: { postMessage: ReturnType<typeof vi.fn>; markRead: ReturnType<typeof vi.fn> };
  gateway: { generatePlatformText: ReturnType<typeof vi.fn> };
  chatAdmin: { ensureOfficialConversation: ReturnType<typeof vi.fn> };
  brief: { assemble: ReturnType<typeof vi.fn> };
  database: { transaction: ReturnType<typeof vi.fn> };
}

function buildHarness(opts: {
  conv?: Conversation;
  history?: Message[];
  afterMessages?: Message[];
  existingMessages?: Message[];
  gatewayResult?: unknown;
  facts?: Record<string, string | null>;
} = {}): Harness {
  const chatRead = {
    getConversation: vi.fn(async () => opts.conv ?? officialConversation()),
    readMessages: vi.fn(async (input: { afterSeq?: number; beforeSeq?: number }) => {
      if (input.afterSeq !== undefined) return opts.afterMessages ?? [];
      if (input.beforeSeq !== undefined) return opts.history ?? [];
      return opts.existingMessages ?? [];
    }),
    getMessage: vi.fn(async () => null),
  };
  const participants = {
    postMessage: vi.fn(async () => ({ ok: true, value: textMessage(4, 'official', 'ok') })),
    markRead: vi.fn(async () => undefined),
  };
  const gateway = {
    generatePlatformText: vi.fn(async () => opts.gatewayResult ?? {
      ok: true,
      value: {
        text: '模型回答',
        modelKey: 'small_v',
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0, estimated: false },
        chargedMicros: 0,
        latencyMs: 1,
        usageRecordId: 'usage-1',
      },
    }),
  };
  const chatAdmin = {
    ensureOfficialConversation: vi.fn(async () => opts.conv ?? officialConversation()),
  };
  const brief = {
    assemble: vi.fn(async () => ({ facts: opts.facts ?? FULL_FACTS, promptLines: ['会员档位：免费'] })),
  };
  const database = {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
  const engine = new OfficialAssistantEngine(
    database as unknown as Database,
    chatRead as unknown as ChatReadPort,
    chatAdmin as unknown as ChatAdminPort,
    participants as unknown as ChatParticipantPort,
    gateway as unknown as ModelGatewayPlatformPort,
    brief as unknown as BriefService,
    loadKnowledgeBase(),
  );
  return { engine, chatRead, participants, gateway, chatAdmin, brief, database };
}

const JOB: OfficialReplyJob = {
  userId: USER_ID,
  conversationId: CONVERSATION_ID,
  messageId: MESSAGE_ID,
  seq: 3,
  contentType: 'text',
};

describe('官方会话判定', () => {
  it('不是官方会话时不处理、不发消息、不调模型', async () => {
    const conv = conversation([
      { kind: 'user', refId: USER_ID },
      { kind: 'character', refId: '55555555-5555-4555-8555-555555555555' },
    ]);
    const h = buildHarness({ conv });
    const result = await h.engine.answerForMessage(JOB);
    expect(result.handled).toBe(false);
    expect(h.participants.postMessage).not.toHaveBeenCalled();
    expect(h.gateway.generatePlatformText).not.toHaveBeenCalled();
  });

  it('已有官方回复时不再重复答', async () => {
    const h = buildHarness({ afterMessages: [textMessage(4, 'official', '已回复')] });
    const result = await h.engine.answerForMessage(JOB);
    expect(result.handled).toBe(true);
    expect(h.participants.postMessage).not.toHaveBeenCalled();
  });
});

describe('确定性知识库回答', () => {
  it('会员价格问题直接按模板答，不调模型，数字来自简报', async () => {
    const h = buildHarness({ history: [textMessage(3, 'user', '会员多少钱？')] });
    const result = await h.engine.answerForMessage(JOB);
    expect(result.handled).toBe(true);
    expect(h.gateway.generatePlatformText).not.toHaveBeenCalled();
    const posted = h.participants.postMessage.mock.calls[0]![0] as { content: { text: string }; idempotencyKey: string };
    expect(posted.content.text).toContain('月卡 20 元');
    expect(posted.idempotencyKey).toBe(`official:reply:${MESSAGE_ID}`);
    expect(h.participants.markRead).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      participantId: OFFICIAL_PARTICIPANT_ID,
      readSeq: 3,
    });
  });

  it('未知条目直接按未知口径答，不调模型', async () => {
    const h = buildHarness({ history: [textMessage(3, 'user', '忘记密码怎么办')] });
    await h.engine.answerForMessage(JOB);
    expect(h.gateway.generatePlatformText).not.toHaveBeenCalled();
    const posted = h.participants.postMessage.mock.calls[0]![0] as { content: { text: string } };
    expect(posted.content.text).toBe(OFFICIAL_UNKNOWN_TEXT);
  });

  it('占位符缺值时降级走模型', async () => {
    const h = buildHarness({
      history: [textMessage(3, 'user', '通讯录上限是多少，我加了几个？')],
      facts: { ...FULL_FACTS, contactCount: null },
    });
    await h.engine.answerForMessage(JOB);
    expect(h.gateway.generatePlatformText).toHaveBeenCalledTimes(1);
  });
});

describe('模型回答路径', () => {
  it('无匹配问题调 small_v：purpose、modelRole、幂等键正确，不带 temperature 与 characterId', async () => {
    const h = buildHarness({ history: [textMessage(3, 'user', '今天天气怎么样')] });
    await h.engine.answerForMessage(JOB);
    expect(h.gateway.generatePlatformText).toHaveBeenCalledTimes(1);
    const input = h.gateway.generatePlatformText.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.purpose).toBe('small_v');
    expect(input.modelRole).toBe('background');
    expect(input.billingOwner).toBeUndefined();
    expect(input).not.toHaveProperty('temperature');
    expect(input).not.toHaveProperty('characterId');
    expect(input.idempotencyKey).toBe(`official:reply:${MESSAGE_ID}`);
    expect(input.maxOutputTokens).toBe(800);
    const messages = input.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe('system');
    expect(messages.at(-1)).toEqual({ role: 'user', content: '今天天气怎么样' });
    const posted = h.participants.postMessage.mock.calls[0]![0] as { content: { text: string }; charge?: unknown };
    expect(posted.content.text).toBe('模型回答');
    expect(posted).not.toHaveProperty('charge');
  });

  it('限频超限时发超限文案', async () => {
    const h = buildHarness({
      history: [textMessage(3, 'user', '今天天气怎么样')],
      gatewayResult: { ok: false, error: 'budget_exceeded' },
    });
    await h.engine.answerForMessage(JOB);
    const posted = h.participants.postMessage.mock.calls[0]![0] as { content: { text: string } };
    expect(posted.content.text).toBe(OFFICIAL_RATE_LIMIT_TEXT);
  });

  it('上游失败时发固定失败文案（不编答案）', async () => {
    const h = buildHarness({
      history: [textMessage(3, 'user', '今天天气怎么样')],
      gatewayResult: { ok: false, error: 'provider_unavailable' },
    });
    await h.engine.answerForMessage(JOB);
    const posted = h.participants.postMessage.mock.calls[0]![0] as { content: { text: string } };
    expect(posted.content.text).toBe(OFFICIAL_FAILURE_TEXT);
  });

  it('模型空输出时发固定失败文案', async () => {
    const h = buildHarness({
      history: [textMessage(3, 'user', '今天天气怎么样')],
      gatewayResult: {
        ok: true,
        value: {
          text: '  ',
          modelKey: 'small_v',
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, estimated: false },
          chargedMicros: 0,
          latencyMs: 1,
          usageRecordId: 'usage-1',
        },
      },
    });
    await h.engine.answerForMessage(JOB);
    const posted = h.participants.postMessage.mock.calls[0]![0] as { content: { text: string } };
    expect(posted.content.text).toBe(OFFICIAL_FAILURE_TEXT);
  });
});

describe('非文字消息', () => {
  it('图片消息发固定提示、不调模型', async () => {
    const h = buildHarness();
    const result = await h.engine.answerForMessage({ ...JOB, contentType: 'image' });
    expect(result.handled).toBe(true);
    expect(h.gateway.generatePlatformText).not.toHaveBeenCalled();
    const posted = h.participants.postMessage.mock.calls[0]![0] as { content: { text: string }; idempotencyKey: string };
    expect(posted.content.text).toBe(OFFICIAL_NON_TEXT_TEXT);
    expect(posted.idempotencyKey).toBe(`official:notice:${MESSAGE_ID}`);
  });

  it('表情包静默不回', async () => {
    const h = buildHarness();
    const result = await h.engine.answerForMessage({ ...JOB, contentType: 'sticker' });
    expect(result.handled).toBe(false);
    expect(h.participants.postMessage).not.toHaveBeenCalled();
  });
});

describe('补齐会话与欢迎语', () => {
  it('首次创建发一条欢迎语（定稿全文）', async () => {
    const h = buildHarness({ existingMessages: [] });
    await h.engine.ensureConversation(USER_ID);
    expect(h.chatAdmin.ensureOfficialConversation).toHaveBeenCalledTimes(1);
    const posted = h.participants.postMessage.mock.calls[0]![0] as { content: { text: string }; idempotencyKey: string };
    expect(posted.content.text).toBe(OFFICIAL_WELCOME_TEXT);
    expect(posted.idempotencyKey).toBe(`official:welcome:${USER_ID}`);
  });

  it('已有消息的会话不再重发欢迎语', async () => {
    const h = buildHarness({ existingMessages: [textMessage(1, 'official', OFFICIAL_WELCOME_TEXT, 'w1')] });
    await h.engine.ensureConversation(USER_ID);
    expect(h.participants.postMessage).not.toHaveBeenCalled();
  });
});
