import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { GenerateTextInput } from '@weiban/contracts';
import { ModelGateway, thinkingBudgetFor, thinkingBudgetForModel } from './gateway.js';
import { ModelResolver } from './resolver.js';
import { UpstreamScheduler } from './scheduler.js';
import { DEFAULT_GATEWAY_LIMITS } from './limits.js';
import { thinkingControlFor, thinkingOffFields } from '../infra/text-adapter.js';
import { supportsThinkingDisabled } from '../infra/anthropic-adapter.js';

const request = (overrides: Partial<GenerateTextInput> = {}) =>
  ({
    userId: '00000000-0000-4000-8000-000000000001',
    characterId: '00000000-0000-4000-8000-000000000002',
    conversationId: '00000000-0000-4000-8000-000000000003',
    billingOwner: 'user',
    modelRole: 'chat',
    purpose: 'chat_reply',
    messages: [{ role: 'user', text: '普通测试文字' }],
    idempotencyKey: 'trigger:reply',
    ...overrides,
  }) as GenerateTextInput;
function gateway(firstError = 'provider_unavailable', primary = 'primary/model') {
  const failure = { ok: false, error: firstError };
  const success = {
    ok: true,
    value: { modelKey: 'xiaomi/mimo-v2.6-flash', text: '假上游正常回复' },
  };
  const generateOnce = vi.fn().mockResolvedValueOnce(failure).mockResolvedValue(success);
  const service = Object.create(ModelGateway.prototype) as ModelGateway;
  const recommendedModel = vi.fn(async () => null);
  Object.assign(service, {
    generateOnce,
    catalog: { recommendedModel },
    resolver: { pick: vi.fn(async () => ({ facts: { modelKey: primary } })) },
    logger: { log: vi.fn() },
  });
  return { service, generateOnce, failure, success, recommendedModel };
}
describe('保留线上日常备用链：私密与其他任务不越界', () => {
  it('日常供应商失败后尝试备用，幂等键保留reply尾缀，成功后停止', async () => {
    const t = gateway();
    expect(await t.service.generateText(request())).toBe(t.success);
    expect(t.generateOnce).toHaveBeenCalledTimes(2);
    expect(t.generateOnce.mock.calls[1]?.[1]).toMatchObject({
      chatFallbackModelKey: 'deepseek/deepseek-v4.1-flash',
    });
    expect(t.generateOnce.mock.calls[1]?.[0].idempotencyKey).toMatch(/:reply$/);
    expect(t.generateOnce.mock.calls[1]?.[0].idempotencyKey).not.toBe('trigger:reply');
  });
  it('当前模型已是DeepSeek时跳过自己，不递归重复调用', async () => {
    const t = gateway('provider_unavailable', 'deepseek/deepseek-v4.1-flash');
    await t.service.generateText(request());
    expect(t.generateOnce.mock.calls[1]?.[1]).toMatchObject({
      chatFallbackModelKey: 'xiaomi/mimo-v2.6-flash',
    });
  });
  it('私密回复、私密记忆和后台任务均不进入日常备用链', async () => {
    for (const input of [
      request({ modelRole: 'adult' }),
      request({ modelRole: 'adult', purpose: 'memory' }),
      request({ modelRole: 'background', purpose: 'memory' }),
    ]) {
      const t = gateway();
      expect(await t.service.generateText(input)).toBe(t.failure);
      expect(t.generateOnce).toHaveBeenCalledOnce();
      expect(t.recommendedModel).not.toHaveBeenCalled();
    }
  });
  it('预算或权限拒绝不通过备用模型绕过；备用模型必须仍已上架', async () => {
    for (const error of ['policy_denied', 'bad_request', 'budget_exceeded']) {
      const t = gateway(error);
      expect(await t.service.generateText(request())).toBe(t.failure);
      expect(t.generateOnce).toHaveBeenCalledOnce();
    }
    const fact = vi.fn(async () => ({
      entry: { enabled: false, deletedAt: null, scenarios: ['chat'] },
    }));
    const resolver = new ModelResolver({ fact } as never, {} as never, {} as never);
    await expect(
      resolver.resolve({
        userId: 'u',
        modelRole: 'chat',
        purpose: 'chat_reply',
        chatFallbackModelKey: 'disabled',
      }),
    ).resolves.toMatchObject({ ok: false, error: 'model_unavailable' });
    await expect(
      resolver.resolve({
        userId: 'u',
        modelRole: 'adult',
        purpose: 'chat_reply',
        chatFallbackModelKey: 'disabled',
      }),
    ).resolves.toMatchObject({ ok: false, error: 'bad_request' });
  });
});

describe('保留线上线路冷却与思考参数修复', () => {
  it('模型软故障只冷却该模型线路，其他模型仍可用，一分钟后恢复试探', async () => {
    let now = Date.parse('2026-10-30T00:00:00Z');
    const row = {
      route: { upstreamModelId: 'model', priority: 0, weight: 1 },
      upstream: {
        id: 'shared-upstream',
        status: 'active',
        cooldownUntil: null,
        weight: 1,
        priority: 0,
        baseUrl: 'https://example.invalid',
        kind: 'openai',
        maxConcurrency: null,
        rpmLimit: null,
      },
    };
    const query = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(async () => [row]),
    };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    const update = vi.fn();
    const scheduler = new UpstreamScheduler(
      { db: { select: () => query, update } } as never,
      { nowMs: () => now, now: () => new Date(now) } as never,
      { get: async () => DEFAULT_GATEWAY_LIMITS } as never,
      {} as never,
    );
    expect(DEFAULT_GATEWAY_LIMITS.cooldownSeconds).toBe(60);
    for (let i = 0; i < 3; i++)
      await scheduler.recordFailure('shared-upstream', 'provider_error', 'broken-model');
    expect(await scheduler.plan('broken-model', null)).toEqual([]);
    expect(await scheduler.plan('healthy-model', null)).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
    now += 60_001;
    expect(await scheduler.plan('broken-model', null)).toHaveLength(1);
  });
  it('私密Abliteration记忆不花掉正文预算，其他模型与任务沿原预算', () => {
    expect(thinkingBudgetForModel('memory', 1000, 'vendor/abliterated-model')).toBe(0);
    expect(thinkingBudgetForModel('memory', 1000, 'other/model')).toBe(
      thinkingBudgetFor('memory', 1000),
    );
    expect(thinkingBudgetForModel('simulation', 1000, 'vendor/abliterated-model')).toBe(
      thinkingBudgetFor('simulation', 1000),
    );
  });
  it('关闭思考仅作用于支持的模型，不误给新Claude或large-v2传不兼容字段', () => {
    expect(thinkingOffFields(thinkingControlFor('https://provider.example', 'gpt-5.6'))).toEqual({
      reasoning_effort: 'none',
    });
    expect(
      thinkingOffFields(thinkingControlFor('https://provider.example', 'abliterated-model-flash')),
    ).toEqual({ reasoning_effort: 'none' });
    expect(thinkingControlFor('https://provider.example', 'abliterated-model-large-v2')).toBe(
      'none',
    );
    expect(supportsThinkingDisabled('claude-opus-5')).toBe(true);
    expect(supportsThinkingDisabled('claude-opus-5.5')).toBe(false);
    expect(supportsThinkingDisabled('claude-sonnet-5.5')).toBe(false);
  });
});
