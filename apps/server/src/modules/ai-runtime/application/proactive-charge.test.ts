import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import {
  ProactiveChargeError,
  ProactiveSchedulerService,
  type SendOutcome,
} from './proactive-scheduler.js';

const fail = (
  ProactiveSchedulerService.prototype as unknown as {
    fail(plan: object, reason: string, chargedMicros: number): Promise<SendOutcome>;
  }
).fail;
it('preserves already charged image-search cost when writing the failure marker itself fails', async () => {
  const cause = new Error('database temporarily unavailable');
  const context = {
    drop: vi.fn(async () => {
      throw cause;
    }),
  };
  await expect(fail.call(context, {}, 'photo_unavailable', 7)).rejects.toMatchObject({
    chargedMicros: 7,
    message: 'photo_unavailable',
    cause,
  });
  await expect(fail.call(context, {}, 'photo_unavailable', 7)).rejects.toBeInstanceOf(
    ProactiveChargeError,
  );
});
it('normal failure returns the actual cost without another billing call', async () => {
  const drop = vi.fn(async () => undefined);
  expect(await fail.call({ drop }, {}, 'photo_unavailable', 7)).toEqual({
    ok: false,
    reason: 'photo_unavailable',
    chargedMicros: 7,
  });
  expect(drop).toHaveBeenCalledOnce();
});
