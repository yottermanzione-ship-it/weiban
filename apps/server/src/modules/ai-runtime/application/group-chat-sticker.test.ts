/**
 * T-20261103g：群聊发言复用私聊 #47 的表情包做法。用真实的 MediaAiService（表情规则）+ 桩依赖跑一次群聊发言：
 * - 能配时提示里有群聊说法；模型写的「[表情:…]」在发出前剥掉，表情包跟在文字后面；
 * - 同一轮已有别的角色带过表情：提示里不给，模型照写也只剥不发；
 * - 带表情时文字最多 2 条（群聊一次发言含表情最多 3 条）；照片标记在群里只剥不发。
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Message, MessageContent } from '@weiban/contracts';
import { GroupChatService } from './group-chat.js';
import { MediaAiService } from './media-ai.js';

const happy = { stickerId: 'happy', mediaId: 'happy-media', description: '开心哈哈大笑' };

let seq = 0;
function msg(sender: 'user' | 'character', content: MessageContent, participant: string): Message {
  seq++;
  return {
    messageId: `m${seq}`,
    conversationId: 'group-1',
    seq,
    senderParticipantId: participant,
    senderKind: sender,
    content,
    status: 'normal',
    scope: 'normal',
    quote: null,
    clientMsgId: null,
    createdAt: new Date(seq * 1000).toISOString(),
    recalledAt: null,
  };
}
const text = (t: string): MessageContent => ({ type: 'text', text: t });
const sticker = (stickerId: string): MessageContent => ({
  type: 'sticker',
  source: 'library',
  stickerId,
  mediaId: `${stickerId}-media`,
  description: null,
});

const speaker = {
  participantId: 'char-a',
  characterId: 'character-a',
  name: '林晚',
  aliases: [],
  talkativeness: 50,
  hobbies: [],
  familiarity: 2,
};
const other = { ...speaker, participantId: 'char-b', characterId: 'character-b', name: '周舟' };

function mediaAi() {
  return new MediaAiService(
    ...([
      {},
      {},
      { listStickersForCharacter: async () => [happy] },
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      { nowMs: () => 1000 },
      {},
      {},
    ] as unknown as ConstructorParameters<typeof MediaAiService>),
  );
}

function harness(history: Message[], reply: string) {
  const posted: Array<{ content: MessageContent; idempotencyKey: string }> = [];
  const generate = vi.fn(async (_req: { messages: Array<{ content: string }> }) => ({
    ok: true as const,
    value: { text: reply, usageRecordId: 'usage', chargedMicros: 10, modelKey: 'm' },
  }));
  const service = Object.create(GroupChatService.prototype) as GroupChatService;
  Object.assign(service, {
    stillActive: async () => true,
    history: async () => history,
    typingIfPresent: async () => undefined,
    newerUserMessage: async () => false,
    characters: {
      getForRuntime: async () => ({
        profile: { name: '林晚', aliases: [] },
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
    identity: { getProfile: async () => ({ nickname: '小明' }) },
    relations: { getRelation: async () => null },
    brain: { build: async () => ({ scope: 'normal', prefix: '人设', recall: '' }) },
    adultBoundary: { generate },
    writer: {
      postMessage: async (input: { content: MessageContent; idempotencyKey: string }) => {
        posted.push(input);
        return { ok: true, value: { messageId: `posted-${posted.length}` } };
      },
    },
    mediaAi: mediaAi(),
  });
  const speak = (triggerSeq: number) =>
    (
      service as unknown as {
        speak(input: Record<string, unknown>): Promise<{ text: string } | null>;
      }
    ).speak({
      userId: 'user',
      conversation: { conversationId: 'group-1', contentScope: 'normal', participants: [] },
      members: [speaker, other],
      speaker,
      reason: 'picked',
      instant: true,
      scenarioMode: 'daily',
      idempotencyKey: 'group-turn:1:char-a',
      purpose: 'chat_reply',
      topic: null,
      labels: [],
      triggerSeq,
    });
  const prompt = () => generate.mock.calls[0]?.[0].messages.at(-1)?.content ?? '';
  return { speak, posted, prompt };
}

describe('群聊发言配表情包', () => {
  it('能配时提示里给群聊说法；标记剥掉，表情包跟在文字后面', async () => {
    const trigger = msg('user', text('今天好开心'), 'user-p');
    const h = harness([msg('character', text('早'), 'char-a'), trigger], '哈哈太好了\n[表情:开心]');
    await h.speak(trigger.seq);
    expect(h.prompt()).toContain('这条群消息可以配一个表情包');
    expect(h.posted.map((p) => p.content)).toEqual([
      text('哈哈太好了'),
      {
        type: 'sticker',
        source: 'library',
        stickerId: 'happy',
        mediaId: 'happy-media',
        description: '开心哈哈大笑',
      },
    ]);
    expect(h.posted[1]!.idempotencyKey).toBe('group-turn:1:char-a:sticker');
    expect(JSON.stringify(h.posted)).not.toContain('[表情');
  }, 10_000);

  it('同一轮别的角色已带过表情：提示里不给，模型照写也只剥不发', async () => {
    const trigger = msg('user', text('今天好开心'), 'user-p');
    const history = [trigger, msg('character', sticker('x'), 'char-b')];
    const h = harness(history, '哈哈太好了\n[表情:开心]');
    await h.speak(trigger.seq);
    expect(h.prompt()).not.toContain('这条群消息可以配一个表情包');
    expect(h.posted.map((p) => p.content)).toEqual([text('哈哈太好了')]);
  }, 10_000);

  it('不连发：这个角色上一条就是表情，这轮不配', async () => {
    const mine = msg('character', sticker('y'), 'char-a');
    const trigger = msg('user', text('今天好开心'), 'user-p');
    const h = harness([mine, trigger], '哈哈太好了\n[表情:开心]');
    await h.speak(trigger.seq);
    expect(h.posted.map((p) => p.content.type)).toEqual(['text']);
  }, 10_000);

  it('带表情时文字最多 2 条（含表情共 3 条）；照片标记在群里只剥不发', async () => {
    const trigger = msg('user', text('今天好开心'), 'user-p');
    const h = harness([trigger], '一\n二\n三\n[照片]\n[表情:开心]');
    await h.speak(trigger.seq);
    expect(h.posted.map((p) => p.content)).toEqual([
      text('一'),
      text('二\n三'),
      expect.objectContaining({ type: 'sticker', stickerId: 'happy' }),
    ]);
    expect(JSON.stringify(h.posted)).not.toContain('[照片]');
  }, 10_000);
});
