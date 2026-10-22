import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import type { GenerateTextInput, GenerateTextOutput } from '@weiban/contracts';
import { TestClock } from '../../../platform/index.js';
import { ImagePublicSearch } from './image-public-search.js';

function setup() {
  const role = {
    profile: { kind: 'preset' },
    personaVersion: 1,
    classification: { realPersonKind: 'public_figure' },
    card: {
      data: {
        recognition: {
          selfEnabled: true,
          selfPublicImages: [
            {
              title: '星际来信',
              publisher: '公开出版社',
              date: '2026-01-01',
              sourceUrl: 'https://example.org/work',
            },
          ],
        },
      },
    },
  };
  const value: GenerateTextOutput = {
    text: '我看看。\n<图片描述>[{"n":1,"kind":"magazine","description":"私有描述金丝雀","text":"星际来信","people":[]}]</图片描述>',
    modelKey: 'chat',
    chargedMicros: 2,
    latencyMs: 1,
    usageRecordId: 'first',
    usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, estimated: false },
  };
  const input: GenerateTextInput = {
    userId: 'user',
    characterId: 'role',
    billingOwner: 'user',
    purpose: 'chat_reply',
    modelRole: 'chat',
    idempotencyKey: 'turn',
    messages: [
      {
        role: 'user',
        content: '这是什么作品？聊天隐私金丝雀',
        images: [{ mediaId: 'image', ownerUserId: 'user' }],
      },
    ],
  };
  const decidePublicImage = vi.fn(async () => ({
    ok: true,
    value: {
      answers: ['public_clues', 'external_facts'].map((questionId) => ({
        questionId,
        choice: 'yes',
        confidence: 0.9,
      })),
    },
  }));
  const webSearch = vi.fn(async () => ({
    ok: true,
    value: {
      items: [{ title: '公开作品出处', url: 'https://example.org/work', snippet: '公开作品介绍' }],
    },
  }));
  const generate = vi.fn(async () => ({
    ok: true as const,
    value: { ...value, chargedMicros: 3, usageRecordId: 'second', text: '这张海报来自星际来信。' },
  }));
  const args = [
    { imagePublicSearchEnabled: true },
    new TestClock(),
    { getForRuntime: async () => role },
    { isServiceEnabled: async () => true, decidePublicImage, webSearch },
    { getAccountStatus: async () => 'active', isBanned: async () => false },
    { listAdminUserIds: async () => ['admin'] },
  ] as unknown as ConstructorParameters<typeof ImagePublicSearch>;
  return {
    service: new ImagePublicSearch(...args),
    input,
    first: { ok: true as const, value },
    decidePublicImage,
    webSearch,
    generate,
  };
}

it('同一轮取公开出处，第二次只发文字，两次生成费相加；站外看不到图片、描述或聊天', async () => {
  const t = setup();
  const result = await t.service.refine(t.input, t.first, t.generate, async () => true);
  expect(result.ok && result.value.chargedMicros).toBe(5);
  expect(t.generate).toHaveBeenCalledTimes(1);
  const second = t.generate.mock.calls[0] as unknown as [GenerateTextInput];
  expect(second[0].messages.some((m) => m.images?.length)).toBe(false);
  expect(second[0].messages.some((m) => m.content.includes('私有描述金丝雀'))).toBe(true);
  expect(JSON.stringify(t.webSearch.mock.calls)).not.toMatch(/金丝雀|mediaId|ownerUserId|images/);
  expect(JSON.stringify(t.decidePublicImage.mock.calls)).not.toMatch(/金丝雀|星际来信|公开出版社/);
  expect(result.ok && result.value.text).toContain('<图片描述>');
});

it('低置信度、源资料变更或供应商故障保留首轮回复，不多发文本请求', async () => {
  const low = setup();
  low.decidePublicImage.mockResolvedValue({
    ok: true,
    value: { answers: [{ questionId: 'public_clues', choice: 'yes', confidence: 0.3 }] },
  });
  expect(await low.service.refine(low.input, low.first, low.generate, async () => true)).toBe(
    low.first,
  );
  expect(low.webSearch).not.toHaveBeenCalled();
  const stale = setup();
  let validations = 0;
  expect(
    await stale.service.refine(
      stale.input,
      stale.first,
      stale.generate,
      async () => ++validations < 3,
    ),
  ).toBe(stale.first);
  expect(stale.generate).not.toHaveBeenCalled();
  const error = setup();
  error.webSearch.mockRejectedValue(new Error('supplier unavailable'));
  expect(
    await error.service.refine(error.input, error.first, error.generate, async () => true),
  ).toBe(error.first);
  expect(error.generate).not.toHaveBeenCalled();
});

it('私密范围、其它用户的图片和已禁用的情景根本不搜索', async () => {
  const t = setup();
  for (const input of [
    { ...t.input, modelRole: 'adult' as const },
    {
      ...t.input,
      messages: [
        {
          role: 'user' as const,
          content: '什么作品',
          images: [{ mediaId: 'image', ownerUserId: 'someone-else' }],
        },
      ],
    },
  ])
    expect(await t.service.refine(input, t.first, t.generate, async () => true)).toBe(t.first);
  expect(await t.service.refine(t.input, t.first, t.generate, async () => true, false)).toBe(
    t.first,
  );
  expect(t.webSearch).not.toHaveBeenCalled();
  expect(t.generate).not.toHaveBeenCalled();
});
