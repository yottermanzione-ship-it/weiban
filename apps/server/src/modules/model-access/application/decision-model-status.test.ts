/** 批 EJ：判定能力以线路 billingBounds.decision 为唯一来源（Jev 目录条目 capabilities 为空）。 */
import { describe, expect, it, vi } from 'vitest';
import { ModelGatewayMedia } from './media-gateway.js';

const JEV = 'jev/jev-latest';

describe('网关判定能力：以 billingBounds.decision 为唯一来源', () => {
  function gateway(entry: Record<string, unknown> | null, bounds: unknown, upstream = 'active') {
    const svc = Object.create(ModelGatewayMedia.prototype) as ModelGatewayMedia;
    Object.assign(svc, {
      catalog: {
        fact: vi.fn().mockResolvedValue({ modelKey: JEV, entry, upstreamStatus: upstream }),
      },
      bounds: { get: vi.fn().mockResolvedValue(bounds) },
    });
    return svc;
  }
  const entry = {
    modelKey: JEV,
    enabled: true,
    capabilities: [],
    upstreamId: 'up',
    upstreamModelId: 'jev-latest',
  };

  it('capabilities 为空但有决策上限 = 判定模型；只有文字上限 = 不是', async () => {
    expect(
      await gateway(entry, { decision: { maxInputTokens: 2000 } }).decisionModelStatus(JEV),
    ).toEqual({ ready: true, reason: null });
    expect(
      await gateway(entry, {
        text: {
          contextTokens: 1000,
          maxOutputTokens: 100,
          totalOutputIncludesReasoning: true,
          outputParameter: 'max_tokens',
          maxImages: 0,
        },
      }).decisionModelStatus(JEV),
    ).toEqual({ ready: false, reason: 'not_decision_model' });
    expect(await gateway(null, null).decisionModelStatus(JEV)).toEqual({
      ready: false,
      reason: 'model_removed',
    });
    expect(
      await gateway(
        { ...entry, capabilities: ['adult_content'] },
        {
          decision: { maxInputTokens: 1 },
        },
      ).decisionModelStatus(JEV),
    ).toEqual({ ready: false, reason: 'model_not_allowed' });
  });
});
