import { describe, expect, it, vi } from 'vitest';
import { MemoryService } from './memory.js';
import type { DbTx } from '../../../platform/index.js';

function setup(retryAfter: Date | null = null) {
  const send = vi.fn(
    async (_name: string, _data: unknown, _options: Record<string, unknown>) => 'job',
  );
  const where = vi.fn(async () => undefined);
  const set = vi.fn((_patch: Record<string, unknown>) => ({ where }));
  const tx = { db: { update: () => ({ set }) } } as unknown as DbTx;
  const service = Object.create(MemoryService.prototype) as MemoryService;
  Object.assign(service, {
    jobs: { send },
    clock: {
      now: () => new Date('2026-10-30T00:00:00Z'),
      nowMs: () => Date.parse('2026-10-30T00:00:00Z'),
    },
    lock: vi.fn(async () => undefined),
    state: vi.fn(async () => ({
      id: 'state',
      cursorSeq: 0,
      pendingCount: 0,
      factTriggerSeq: 0,
      factAttempts: 2,
      retryAfter,
    })),
  });
  return { service, tx, send, set };
}
const job = {
  userId: 'user',
  characterId: 'character',
  conversationId: 'conversation',
  epoch: 'epoch',
};
describe('事实整理窄触发', () => {
  it('普通消息只记待处理量，不每条排三分钟任务，满十条也不直接生成', async () => {
    const t = setup();
    for (let seq = 1; seq <= 20; seq++) await t.service.observe(t.tx, job, true, false, seq, false);
    expect(t.send).not.toHaveBeenCalled();
  });
  it('明确候选合并到同一会话任务，队列不再叠十次自动重试', async () => {
    const t = setup();
    await t.service.observe(t.tx, job, true, false, 1, true);
    expect(t.send).toHaveBeenCalledOnce();
    expect(t.send.mock.calls[0]?.[2]).toMatchObject({
      retryLimit: 0,
      singletonKey: 'facts:user:conversation',
    });
    expect(t.set.mock.calls[0]?.[0]).toMatchObject({ factTriggerSeq: 1 });
  });
  it('冷却期间的新候选不清零失败次数，也不新发模型任务', async () => {
    const t = setup(new Date('2026-10-30T02:00:00Z'));
    await t.service.observe(t.tx, job, true, false, 2, true);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.set.mock.calls[0]?.[0]).not.toHaveProperty('factAttempts');
  });
});
