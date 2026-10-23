import { describe, expect, it, vi } from 'vitest';
import { ModelGatewayMedia } from './media-gateway.js';

function setup(result: unknown) {
  const gateway = Object.create(ModelGatewayMedia.prototype) as ModelGatewayMedia;
  const charge = { usageRecordId: 'usage', model: {}, holdId: 'hold' };
  const reserve = vi.fn().mockResolvedValue({ ok: true, value: charge });
  const fail = vi.fn().mockResolvedValue(undefined);
  const succeed = vi.fn().mockResolvedValue({ ok: true, value: { chargedMicros: 7 } });
  Object.assign(gateway, {
    precheck: async () => true,
    resolve: async () => ({
      ok: true,
      value: {
        modelKey: 'asr',
        billingBounds: {
          asr: { maxSeconds: 15, billingStepSeconds: 1 },
        },
      },
    }),
    reserve,
    fail,
    succeed,
    cancelCharge: vi.fn().mockResolvedValue(undefined),
    beginCharge: async () => true,
    transcribePcm: vi.fn().mockResolvedValue(result),
  });
  return { gateway, charge, fail, succeed };
}

async function sessionFor(result: unknown) {
  const state = setup(result);
  const opened = await state.gateway.openRealtimeAsr({
    userId: 'user',
    purpose: 'voice',
    billingOwner: 'user',
    sampleRate: 16000,
    idempotencyKey: 'cascade-asr',
  });
  if (!opened.ok) throw new Error(opened.error);
  const session = opened.value;
  const samples = Buffer.alloc(3200);
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(1000, i);
  session.pushAudio(samples);
  session.pushAudio(new Uint8Array(22400));
  return { ...state, session };
}

describe('cascade ASR segment accounting and error boundary (controlled adapter)', () => {
  it.each([1.2, undefined])(
    'settles provider seconds when reported, otherwise flags file-duration estimate (%s)',
    async (seconds) => {
      const { session, charge, succeed } = await sessionFor({
        ok: true,
        value: { text: '你好', asrSeconds: seconds },
      });
      expect(await session.results()[Symbol.asyncIterator]().next()).toEqual({
        done: false,
        value: { text: '你好', final: true },
      });
      expect(succeed).toHaveBeenCalledWith(
        charge,
        { asrSeconds: seconds === undefined ? 1 : 2 },
        seconds !== undefined,
      );
      expect((await session.close()).chargedMicros).toBe(7);
    },
  );

  it.each([true, false])(
    'provider/local failures reject the result stream, never masquerade as balance exhaustion (zeroCost=%s)',
    async (zeroCost) => {
      const { session, charge, fail } = await sessionFor({
        ok: false,
        category: 'bad_request',
        zeroCost,
      });
      await expect(session.results()[Symbol.asyncIterator]().next()).rejects.toThrow(
        'ASR_SESSION_FAILED',
      );
      expect(fail).toHaveBeenCalledWith(
        charge,
        'bad_request',
        zeroCost ? { asrSeconds: 0 } : undefined,
      );
      await session.close();
    },
  );
});
