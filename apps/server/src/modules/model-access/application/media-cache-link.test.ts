import { describe, expect, it, vi } from 'vitest';
import { ModelGatewayMedia } from './media-gateway.js';

const base = {
  userId: '00000000-0000-4000-8000-000000000001',
  purpose: 'voice' as const,
  billingOwner: 'user' as const,
  idempotencyKey: 'media-cache-link',
};

/**
 * 真实缺陷回归（2026-10-24 隔离环境真实供应商验收发现）：
 * run() 只把 hold/usage 关联写进 generation_results，内存里的 GenerationRow 仍是空值，
 * restoreMediaResult 随即以“媒体结算缓存关联不一致”拒绝已经成功的供应商结果（供应商已被计费）。
 */
describe('media result cache stays linked to the reservation used by this call', () => {
  function gateway() {
    const gw = Object.create(ModelGatewayMedia.prototype) as ModelGatewayMedia & {
      [key: string]: unknown;
    };
    const generation: {
      id: string;
      userId: string;
      holdId: string | null;
      usageRecordId: string | null;
    } = {
      id: 'generation-1',
      userId: base.userId,
      holdId: null,
      usageRecordId: null,
    };
    const charge = {
      usageRecordId: '00000000-0000-4000-8000-0000000000aa',
      holdId: '00000000-0000-4000-8000-0000000000bb',
      model: { modelKey: 'probe/tts', upstreamId: 'up-1', upstreamModelId: 'mimo-v2.5-tts' },
      startedAt: new Date('2026-10-24T00:00:00Z'),
      wallStart: performance.now(),
      attemptId: 'attempt-1',
      sent: true,
    };
    Object.assign(gw, {
      activeGenerations: new Map([[base, generation]]),
      cache: {
        attach: vi.fn(async () => undefined),
        save: vi.fn(async () => undefined),
      },
      reserve: vi.fn(async () => ({ ok: true, value: charge })),
      beginCharge: vi.fn(async () => true),
      withTarget: vi.fn(async (_model: unknown, call: (t: object, a: object) => Promise<unknown>) =>
        call({}, {}),
      ),
      succeed: vi.fn(async () => ({
        ok: true,
        value: {
          modelKey: 'probe/tts',
          chargedMicros: 0,
          latencyMs: 1,
          usageRecordId: charge.usageRecordId,
        },
      })),
      fail: vi.fn(async () => undefined),
      clock: { nowMs: () => Date.parse('2026-10-24T00:00:01Z') },
    });
    return { gw, generation, charge };
  }

  it('returns the successful provider result instead of a cache-link mismatch', async () => {
    const { gw, generation, charge } = gateway();
    const result = await (
      gw as unknown as {
        run: (b: unknown, m: unknown, e: unknown, c: unknown) => Promise<{ ok: boolean }>;
      }
    ).run(base, charge.model, { ttsChars: 6 }, async () => ({
      ok: true,
      value: { mediaId: 'media-1', durationMs: 1440 },
      actual: { ttsChars: 6 },
    }));
    expect(result.ok).toBe(true);
    expect(generation.usageRecordId).toBe(charge.usageRecordId);
    expect(generation.holdId).toBe(charge.holdId);
    expect(gw.succeed).toHaveBeenCalledWith(charge, { ttsChars: 6 }, true);
  });

  it('still refuses a stored result that belongs to a different reservation', async () => {
    const { gw, generation } = gateway();
    const restore = (
      gw as unknown as {
        restoreMediaResult: (row: unknown, source: unknown) => Promise<unknown>;
      }
    ).restoreMediaResult.bind(gw);
    generation.holdId = 'another-hold';
    generation.usageRecordId = 'another-usage';
    await expect(
      restore(
        { ...generation },
        {
          ok: true,
          value: { mediaId: 'media-1' },
          mediaSettlement: {
            charge: { holdId: 'hold', usageRecordId: 'usage' },
            actual: {},
            actualKnown: true,
          },
        },
      ),
    ).rejects.toThrow('媒体结算缓存关联不一致');
  });
});
