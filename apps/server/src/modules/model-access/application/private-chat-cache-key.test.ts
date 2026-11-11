import { afterEach, expect, it, vi } from 'vitest';
import type { GenerateTextInput } from '@weiban/contracts';
import { privateChatPromptCacheKey } from './gateway.js';
import { OpenAiTextAdapter } from '../infra/text-adapter.js';

const model = 'abliteration-ai/abliterated-model';
const firstTurn: GenerateTextInput = {
  userId: 'fixture-user',
  characterId: 'fixture-character',
  conversationId: 'fixture-conversation',
  modelRole: 'adult',
  billingOwner: 'user',
  purpose: 'chat_reply',
  meta: { conversationKind: 'direct' },
  messages: [{ role: 'user', content: '固定样例第一轮' }],
  idempotencyKey: 'first-request',
};

afterEach(() => vi.unstubAllGlobals());

it('同一私密会话各轮共享标识，不同会话、用户和模型的标识不同', () => {
  const key = privateChatPromptCacheKey(firstTurn, model);
  const nextTurn: GenerateTextInput = {
    ...firstTurn,
    messages: [...firstTurn.messages, { role: 'user', content: '固定样例下一轮' }],
    idempotencyKey: 'next-request',
  };
  expect(key).toMatch(/^[a-f0-9]{64}$/u);
  expect(privateChatPromptCacheKey(nextTurn, model)).toBe(key);
  expect(privateChatPromptCacheKey({ ...nextTurn, userId: 'other-user' }, model)).not.toBe(key);
  expect(privateChatPromptCacheKey({ ...nextTurn, conversationId: 'other-chat' }, model)).not.toBe(
    key,
  );
  expect(privateChatPromptCacheKey(nextTurn, 'other-model')).not.toBe(key);
});

it('日常聊天、群聊、后台整理和无会话的调用不使用私密会话标识', () => {
  const requests: GenerateTextInput[] = [
    { ...firstTurn, modelRole: 'chat' },
    { ...firstTurn, meta: { conversationKind: 'group' } },
    { ...firstTurn, purpose: 'memory' },
    { ...firstTurn, conversationId: undefined },
  ];
  for (const request of requests) expect(privateChatPromptCacheKey(request, model)).toBeUndefined();
});

it('仅给官方直连的请求加缓存标识，消息内容保持原样', async () => {
  const send = vi.fn(async (_url: string, _options: RequestInit) =>
    Response.json({ choices: [{ message: { content: '固定样例回复' }, finish_reason: 'stop' }] }),
  );
  vi.stubGlobal('fetch', send);
  const adapter = new OpenAiTextAdapter();
  const key = privateChatPromptCacheKey(firstTurn, model)!;
  const messages = firstTurn.messages.map(({ role, content }) => ({ role, content }));
  for (const [baseUrl, promptCacheKey] of [
    ['https://api.abliteration.ai/v1/', key],
    ['https://example.test/v1', key],
    ['https://api.abliteration.ai.example.test/v1', key],
    ['https://api.abliteration.ai/v1', undefined],
  ] as const) {
    const result = await adapter.generate({
      baseUrl,
      apiKey: 'fixture-key',
      model: 'abliterated-model',
      messages,
      maxOutputTokens: 20,
      idempotencyKey: firstTurn.idempotencyKey,
      timeoutMs: 1_000,
      promptCacheKey,
    });
    expect(result.ok).toBe(true);
  }
  const [direct, other, lookalike, ordinary] = send.mock.calls.map(([, init]) =>
    JSON.parse(init.body as string),
  );
  expect(direct).toEqual({ ...other, prompt_cache_key: key });
  expect(other).toEqual(lookalike);
  expect(other).toEqual(ordinary);
  expect(direct.messages).toEqual(messages);
});
