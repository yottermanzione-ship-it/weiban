import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import {
  Conversation,
  TimelineEndpoints,
  TimelineSummaryResponse,
  type ChatReadPort,
  type ContactsReadPort,
  type ModelGatewayPort,
  type PublicUpdateReadPort,
  type TimelineEntry,
} from '@weiban/contracts';
import { TimelineListService, TimelineSummaryService } from './timeline.js';
import { type SimulationReadPort, type DailyEventEntry } from './simulation.js';
import type { JointEventView, SocialService } from './social.js';
import type { SharedEpisodesService } from './shared-episodes.js';
import { TestClock, newId, type Database } from '../../../platform/index.js';

const userId = newId();
const characterId = newId();
const conversationId = newId();
const now = new Date('2026-10-09T18:00:00Z');
const lastActiveAt = '2026-10-09T06:00:00Z';
function fixture(n = 3) {
  const events: DailyEventEntry[] = Array.from({ length: n }, (_, seq) => ({
    id: newId(),
    userId,
    characterId,
    eventDate: '2026-10-09',
    seq,
    kind: 'work',
    summary: `事件${seq}`,
    createdAt: new Date('2026-10-09T12:00:00Z'),
  }));
  const simulation: SimulationReadPort = {
    getDailyEvents: vi.fn(async (_u, _c, date) => events.filter((e) => e.eventDate === date)),
    getCurrentMood: vi.fn(async () => 'happy' as const),
  };
  const generateText = vi.fn<ModelGatewayPort['generateText']>().mockResolvedValue({
    ok: true,
    value: {
      text: '今天也努力过啦',
      modelKey: 'test/model',
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, estimated: false },
      chargedMicros: 1,
      latencyMs: 1,
      usageRecordId: newId(),
    },
  });
  const gateway: ModelGatewayPort = {
    generateText,
    getModelStatus: async () => {
      throw new Error('unused');
    },
  };
  const conversation = Conversation.parse({
    conversationId,
    type: 'direct',
    title: null,
    participants: [],
    contentScope: 'normal',
    lastSeq: 0,
    lastMessage: null,
    state: {
      pinned: false,
      muted: false,
      hidden: false,
      clearedThroughSeq: 0,
      readSeq: 0,
      markedUnread: false,
    },
    unreadCount: 0,
    peerReadSeq: 0,
    createdAt: lastActiveAt,
    updatedAt: lastActiveAt,
  });
  const chat: Pick<ChatReadPort, 'findDirectConversation'> = {
    findDirectConversation: vi.fn(async () => conversation),
  };
  const service = new TimelineSummaryService(simulation, gateway, new TestClock(now), chat);
  return { events, simulation, generateText, chat, service };
}

it('P-18不足12小时不调用模型，包括原任务卡中的一小时窗口', async () => {
  const f = fixture();
  for (const hours of [0.5, 2, 11]) {
    const result = await f.service.getSummary(
      userId,
      characterId,
      conversationId,
      new Date(now.getTime() - hours * 3600_000).toISOString(),
    );
    expect(result.summary).toBeNull();
    expect(TimelineSummaryResponse.safeParse(result).success).toBe(true);
  }
  expect(f.generateText).not.toHaveBeenCalled();
});

it('满12小时读取事件，调用后台预算网关并返回严格契约响应', async () => {
  const f = fixture();
  const result = await f.service.getSummary(userId, characterId, conversationId, lastActiveAt);
  expect(result.summary).toBe('今天也努力过啦');
  expect(result.events).toHaveLength(3);
  expect(TimelineSummaryResponse.safeParse(result).success).toBe(true);
  expect(f.generateText).toHaveBeenCalledWith(
    expect.objectContaining({
      purpose: 'behavior_planning',
      countAsBackground: true,
      billingOwner: 'user',
      modelRole: 'background',
      conversationId,
    }),
  );
});

it('无缺席期间事件时不生成摘要；跨日事件会被读取，最多五条', async () => {
  const empty = fixture(0);
  expect(
    (await empty.service.getSummary(userId, characterId, conversationId, lastActiveAt)).summary,
  ).toBeNull();
  expect(empty.generateText).not.toHaveBeenCalled();
  const f = fixture(6);
  f.events.forEach((e) => {
    e.eventDate = '2026-10-08';
    e.createdAt = new Date('2026-10-08T12:00:00Z');
  });
  const result = await f.service.getSummary(
    userId,
    characterId,
    conversationId,
    '2026-10-08T06:00:00Z',
  );
  expect(result.events).toHaveLength(5);
  expect(f.simulation.getDailyEvents).toHaveBeenCalledWith(userId, characterId, '2026-10-08');
  expect(result.events.map((e) => e.seq)).toEqual([5, 4, 3, 2, 1]);
});

it('缺席以前的事件与未来事件排除，不调用模型', async () => {
  const f = fixture(2);
  f.events[0]!.createdAt = new Date('2026-10-09T05:00:00Z');
  f.events[1]!.createdAt = new Date('2026-10-09T19:00:00Z');
  expect(
    (await f.service.getSummary(userId, characterId, conversationId, lastActiveAt)).events,
  ).toEqual([]);
  expect(f.generateText).not.toHaveBeenCalled();
});

it('后台预算耗尽静默返回空摘要，事件仍可查看', async () => {
  const f = fixture();
  f.generateText.mockResolvedValue({ ok: false, error: 'budget_exceeded' });
  const result = await f.service.getSummary(userId, characterId, conversationId, lastActiveAt);
  expect(result.summary).toBeNull();
  expect(result.events).toHaveLength(3);
});

it('同一缺席窗口幂等键稳定，不同窗口不复用旧摘要', async () => {
  const f = fixture();
  await f.service.getSummary(userId, characterId, conversationId, lastActiveAt);
  await f.service.getSummary(userId, characterId, conversationId, lastActiveAt);
  await f.service.getSummary(userId, characterId, conversationId, '2026-10-08T06:00:00Z');
  const keys = f.generateText.mock.calls.map(([input]) => input.idempotencyKey);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[0]);
});

it('错误会话归属在读事件与计费之前被拒绝', async () => {
  const f = fixture();
  vi.mocked(f.chat.findDirectConversation).mockResolvedValue(null);
  await expect(
    f.service.getSummary(userId, characterId, conversationId, lastActiveAt),
  ).rejects.toThrow('找不到私聊会话');
  expect(f.simulation.getDailyEvents).not.toHaveBeenCalled();
  expect(f.generateText).not.toHaveBeenCalled();
});

it('缺失/非法查询与未来时间被拒绝，不能把NaN写进响应', async () => {
  const f = fixture();
  expect(TimelineEndpoints.getSummary.query!.safeParse({}).success).toBe(false);
  expect(
    TimelineEndpoints.getSummary.query!.safeParse({ characterId, lastActiveAt: 'bad' }).success,
  ).toBe(false);
  await expect(f.service.getSummary(userId, characterId, conversationId, 'bad')).rejects.toThrow(
    '无效时间线请求',
  );
  await expect(
    f.service.getSummary(userId, characterId, conversationId, '2026-10-10T00:00:00Z'),
  ).rejects.toThrow('上次活跃时间不能晚于现在');
  expect(f.generateText).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// TimelineListService.list：朋友圈一源已去掉，其余三源与共同经历保留
// ---------------------------------------------------------------------------

const listNow = new Date('2026-10-09T18:00:00Z');
const otherCharacterId = newId();

function listFixture(active = true) {
  const dailyRow = {
    id: newId(),
    userId,
    characterId,
    eventDate: '2026-10-09',
    seq: 0,
    kind: 'work',
    summary: '日常事件',
    moodAfter: null,
    createdAt: new Date('2026-10-09T12:00:00Z'),
  };
  const chain = {
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: async () => [dailyRow] }),
      }),
    }),
  };
  const db = { db: { select: () => chain } } as unknown as Database;
  const contacts = {
    getActiveContact: async () => (active ? { characterId } : null),
    listActiveContacts: async () => [{ characterId }, { characterId: otherCharacterId }],
  } as unknown as ContactsReadPort;
  const joint: JointEventView = {
    id: newId(),
    eventDate: '2026-10-09',
    otherCharacterId,
    kind: 'social' as JointEventView['kind'],
    summary: '共同事件',
    detail: null,
    createdAt: new Date('2026-10-09T13:00:00Z'),
  };
  const social = {
    listJointEvents: async () => [joint],
  } as unknown as SocialService;
  const episode: TimelineEntry = {
    entryId: newId(),
    source: 'shared_episode',
    occurredAt: '2026-10-09T14:00:00.000Z',
    kind: null,
    summary: '共同经历',
    moodAfter: null,
    withCharacterIds: [],
    ref: null,
  };
  const episodes = { list: async () => [episode] } as unknown as SharedEpisodesService;
  const publicUpdates = {
    listEffective: async () => [
      {
        updateId: newId(),
        characterId,
        kind: 'event',
        content: '公开动态',
        startDate: '2026-10-08',
        endDate: null,
        effectiveDate: '2026-10-08',
        sourceUrl: '',
        phase: 'past',
      },
    ],
  } as unknown as PublicUpdateReadPort;
  const service = new TimelineListService(
    db,
    new TestClock(listNow),
    contacts,
    social,
    episodes,
    publicUpdates,
  );
  return { service, episode, joint, dailyRow };
}

it('时间线列表不再含朋友圈一源，其余三源与共同经历保留', async () => {
  const f = listFixture();
  const result = await f.service.list(userId, characterId, { limit: 20 });
  expect(result.items.map((i) => i.source).sort()).toEqual([
    'character_interaction',
    'daily_event',
    'public_update',
    'shared_episode',
  ]);
  expect(result.items.some((i) => i.source === 'moments_post')).toBe(false);
  expect(result.items[0]?.source).toBe('shared_episode');
  expect(result.items.map((i) => i.entryId)).toContain(f.episode.entryId);
  expect(result.items.map((i) => i.entryId)).toContain(f.joint.id);
  expect(result.items.map((i) => i.entryId)).toContain(f.dailyRow.id);
  expect(TimelineEndpoints.listTimeline.response!.safeParse(result).success).toBe(true);
});

it('时间线列表在好友不存在时拒绝', async () => {
  const f = listFixture(false);
  await expect(f.service.list(userId, characterId, { limit: 20 })).rejects.toThrow('好友不存在');
});
