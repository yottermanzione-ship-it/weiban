import { describe, expect, it, vi } from 'vitest';
import type { GenerateTextInput } from '@weiban/contracts';
import { contextBudget, contextTokens, compactablePrefix } from './context-budget.js';
import { ModelGateway } from '../application/gateway.js';
import type { VerifiedRoute } from '../application/billing-bounds.js';

describe('模型容量与切换保护', () => {
  it('容量按模型缩放，取线路下界并扣掉输出和安全余量', () => {
    const small = contextBudget('small', [{ contextTokens: 32000, maxOutputTokens: 4000 }])!;
    const large = contextBudget('large', [{ contextTokens: 128000, maxOutputTokens: 4000 }])!;
    expect(small.triggerTokens).toBeLessThan(large.triggerTokens);
    expect(small.inputTokens).toBeLessThan(28000);
    expect(
      contextBudget('routes', [
        { contextTokens: 32000, maxOutputTokens: 4000 },
        { contextTokens: 16000, maxOutputTokens: 4000 },
      ])?.contextTokens,
    ).toBe(16000);
    expect(contextBudget('missing', [])).toBeNull();
    expect(contextBudget('bad', [{ contextTokens: 1000, maxOutputTokens: 1000 }])).toBeNull();
  });
  it('中文、图片、消息结构都占预算，不把字数当作精确容量', () => {
    expect(contextTokens([{ content: '中'.repeat(100) }])).toBeGreaterThan(100);
    expect(
      contextTokens([{ content: '', images: [{ mediaId: 'image', ownerUserId: 'owner' }] }]),
    ).toBeGreaterThan(8000);
  });
  it('不压系统头、末尾指令或最后用户段，也不悄悄丢掉旧图片', () => {
    const messages: GenerateTextInput['messages'] = [
      { role: 'system', content: '固定人设' },
      { role: 'user', content: '旧用户'.repeat(100) },
      { role: 'assistant', content: '旧回答'.repeat(100) },
      { role: 'user', content: '当前问题' },
      { role: 'system', content: '本轮指令' },
    ];
    expect(compactablePrefix(messages, 30)).toEqual({ start: 1, end: 3 });
    messages[1]!.images = [{ mediaId: 'image', ownerUserId: 'owner' }];
    expect(compactablePrefix(messages, 30)).toBeNull();
  });
  it.each(['chat', 'adult'] as const)(
    '缩到目标容量后才返回，%s 压缩始终保持正确范围',
    async (modelRole) => {
      const generate = vi.fn(async () => ({
        ok: true,
        value: { text: '用户与角色约好周六见面。' },
      }));
      const service = Object.create(ModelGateway.prototype) as unknown as {
        generateOnce: typeof generate;
        fitContext(
          input: GenerateTextInput,
          model: string,
          routes: VerifiedRoute[],
        ): Promise<GenerateTextInput | null>;
      };
      service.generateOnce = generate;
      const messages: GenerateTextInput['messages'] = [{ role: 'system', content: '固定人设不改' }];
      for (let i = 0; i < 6; i++)
        messages.push(
          { role: 'user', content: '用户旧话'.repeat(750) },
          { role: 'assistant', content: '角色旧话'.repeat(750) },
        );
      messages.push(
        { role: 'user', content: '最后这个问题必须保留' },
        { role: 'system', content: '尾部指令不改' },
      );
      const input = {
        userId: 'owner',
        characterId: 'character',
        conversationId: 'conversation',
        purpose: 'chat_reply',
        billingOwner: 'user',
        modelRole,
        maxOutputTokens: 4000,
        idempotencyKey: 'same-logical-request',
        messages,
        meta: { scenarioMode: modelRole === 'adult' ? 'adult' : 'normal' },
      } satisfies GenerateTextInput;
      const routes = [
        { billingBounds: { text: { contextTokens: 32000, maxOutputTokens: 4000 } } },
      ] as unknown as VerifiedRoute[];
      const fitted = await service.fitContext(input, 'target', routes);
      expect(fitted).not.toBeNull();
      expect(contextTokens(fitted!.messages)).toBeLessThanOrEqual(
        contextBudget('target', [{ contextTokens: 32000, maxOutputTokens: 4000 }], 4000)!
          .inputTokens,
      );
      expect(fitted!.messages[0]).toEqual(messages[0]);
      expect(fitted!.messages.at(-1)).toEqual(messages.at(-1));
      expect(JSON.stringify(fitted!.messages)).toContain('最后这个问题必须保留');
      expect(generate).toHaveBeenCalled();
      for (const [request, internal] of generate.mock.calls as unknown as [
        GenerateTextInput,
        unknown,
      ][]) {
        expect(request.purpose).toBe('memory');
        expect(request.modelRole).toBe(modelRole === 'adult' ? 'adult' : 'background');
        if (modelRole === 'adult') expect(internal).toBeUndefined();
      }
    },
  );
  it('不满足输入容量时不宣称成功，压缩失败不转用别的摘要模型', async () => {
    const generate = vi.fn(async () => ({ ok: false, error: 'provider_unavailable' }));
    const service = Object.create(ModelGateway.prototype) as unknown as {
      generateOnce: typeof generate;
      fitContext(
        input: GenerateTextInput,
        model: string,
        routes: VerifiedRoute[],
      ): Promise<GenerateTextInput | null>;
    };
    service.generateOnce = generate;
    const input = {
      userId: 'u',
      purpose: 'chat_reply',
      billingOwner: 'user',
      modelRole: 'adult',
      idempotencyKey: 'failed',
      maxOutputTokens: 4000,
      messages: [
        { role: 'system', content: '固定设定'.repeat(30000) },
        { role: 'user', content: '只有当前问题' },
      ],
    } satisfies GenerateTextInput;
    expect(
      await service.fitContext(input, 'target', [
        { billingBounds: { text: { contextTokens: 32000, maxOutputTokens: 4000 } } },
      ] as unknown as VerifiedRoute[]),
    ).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
});
