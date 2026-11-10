import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { GenerateTextInput, MessageContent } from '@weiban/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ReplyEngine } from './reply-engine.js';
import { ReplySnapshot } from './reply-context.js';

const META = '我们需要回答群聊。需要判断角色。没有指定是谁。';
const NORMAL = '行，那我先睡了，明天聊。';

function harness(outputs: string[], queuedText?: string) {
  const now = new Date('2026-11-11T00:00:00Z');
  const snapshot = ReplySnapshot.parse({
    triggerAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + 60_000).toISOString(),
    epoch: randomUUID(),
    participantId: randomUUID(),
    scope: 'normal',
    lastUserSeq: 1,
    messages: [
      { role: 'system', content: '你是虚构角色林晚。' },
      { role: 'user', content: '晚安。' },
    ],
    personaVersion: 1,
    promptTemplateVersion: 'test',
    instantReply: true,
    splitBubbles: true,
    highRisk: false,
    forceCareFallback: false,
    careActive: false,
    suspected: false,
    careVariant: 0,
    careFallback: '我在这里。',
    fallbackGreetings: [],
    deflect: '我们换个话题吧。',
    addressAs: null,
    policy: { isMinor: false, isRealPerson: false, romanceAllowed: true },
  });
  const row = {
    id: randomUUID(),
    userId: randomUUID(),
    characterId: randomUUID(),
    conversationId: randomUUID(),
    triggerId: randomUUID(),
    triggerSeq: 1,
    kind: 'message',
    status: queuedText ? 'sending' : 'generating',
    nextBubble: 0,
    retryEpoch: 0,
    leaseId: queuedText ? null : randomUUID(),
    inputCiphertext: Buffer.from('fake input'),
    resultCiphertext: queuedText ? Buffer.from('fake result') : null,
    failure: null,
  };
  let stored: unknown = queuedText ? { snapshot, bubbles: [queuedText], care: false } : null;
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        Object.assign(row, values);
      },
    }),
  });
  const tx = {
    db: {
      update,
      select: () => ({ from: () => ({ where: () => ({ for: async () => [{ ...row }] }) }) }),
    },
  };
  const seal = vi.fn(async (_tx: unknown, _row: unknown, _part: string, value: unknown) => {
    stored = structuredClone(value);
    return Buffer.from('fake result');
  });
  const replies = [...outputs];
  const generateText = vi.fn(async (_input: GenerateTextInput) => {
    const text = replies.shift();
    if (text === undefined) throw new Error('unexpected model call');
    return {
      ok: true as const,
      value: { text, chargedMicros: 10, modelKey: 'test', usageRecordId: 'usage', latencyMs: 1 },
    };
  });
  const warn = vi.fn();
  const postMessage = vi.fn(async (input: { content: MessageContent }) => ({
    ok: true as const,
    value: { messageId: randomUUID(), content: input.content },
  }));
  const engine = Object.create(ReplyEngine.prototype) as ReplyEngine;
  Object.assign(engine, {
    store: {
      claim: async () => ({ ...row }),
      get: async () => ({ ...row }),
      lock: async () => true,
      open: async (_row: unknown, part: 'input' | 'result') =>
        part === 'input' ? snapshot : stored,
      db: { db: { update }, transaction: async (fn: (tx: unknown) => unknown) => fn(tx) },
      seal,
      schedule: async () => undefined,
    },
    context: {
      currentEpoch: async () => snapshot.epoch,
      contacts: { getActiveContact: async () => ({ conversationId: row.conversationId }) },
      chat: {
        getConversation: async () => ({ contentScope: 'normal' }),
        readMessages: async () => [],
      },
      policy: { getCharacterPolicy: async () => snapshot.policy },
      memory: { revision: async () => snapshot.memoryRevision },
    },
    gateway: { generateText },
    writer: { markRead: vi.fn(), setTyping: vi.fn(), postMessage },
    mediaAi: { planExtras: async () => null },
    clock: { now: () => now, nowMs: () => now.getTime() },
    logger: { warn },
  });
  return { row, run: () => engine.run(row.id), generateText, postMessage, seal, warn };
}

describe('私聊正文检查', () => {
  it.each([false, true])('正常台词原样送达，是否先补写 %s', async (retry) => {
    const h = harness(retry ? [META, NORMAL] : [NORMAL]);
    await h.run();
    expect(h.row.status).toBe('sending');
    await h.run();
    expect(h.row.status).toBe('done');
    expect(h.generateText).toHaveBeenCalledTimes(retry ? 2 : 1);
    expect(h.postMessage.mock.calls.map(([input]) => input.content)).toEqual([
      { type: 'text', text: NORMAL },
    ]);
  });

  it('补写后仍是思考则等待，没有待发结果', async () => {
    const h = harness([META, META]);
    await h.run();
    expect(h.row).toMatchObject({ status: 'waiting', failure: 'provider_unavailable' });
    expect(h.seal).not.toHaveBeenCalled();
    expect(h.postMessage).not.toHaveBeenCalled();
    const [first, retry] = h.generateText.mock.calls.map(([input]) => input);
    expect(h.generateText).toHaveBeenCalledTimes(2);
    expect(retry!.messages.slice(0, -1)).toEqual(first!.messages);
    expect(retry!.messages.at(-1)).toMatchObject({
      role: 'system',
      content: expect.stringContaining('不写分析'),
    });
    expect(retry!.idempotencyKey).not.toBe(first!.idempotencyKey);
    expect(h.warn.mock.calls).toEqual([
      [
        {
          code: 'ai_meta_reasoning_blocked',
          conversationKind: 'direct',
          characterId: h.row.characterId,
        },
      ],
    ]);
  });

  it('旧版本已保存的待发思考在写入前也会被拦住', async () => {
    const h = harness([], META);
    await h.run();
    expect(h.row).toMatchObject({ status: 'waiting', resultCiphertext: null });
    expect(h.generateText).not.toHaveBeenCalled();
    expect(h.postMessage).not.toHaveBeenCalled();
  });
});
