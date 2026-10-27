import { expect, it, vi } from 'vitest';
import type { ClientSyncOperation } from '@weiban/contracts';
import {
  LocalSaveError,
  SyncRunner,
  freshSyncState,
  type SyncDriverPort,
  type SyncEffect,
} from '../src/index.js';
const id = '11111111-1111-4111-8111-111111111111';
const send: ClientSyncOperation = {
  type: 'enqueue',
  conversationId: id,
  body: { clientMsgId: id, content: { type: 'text', text: 'durable canary' } },
  now: 1,
};
function port(overrides: Partial<SyncDriverPort> = {}): SyncDriverPort {
  return {
    save: async () => true,
    execute: async () => [],
    changed: () => {},
    failed: () => {},
    ...overrides,
  };
}
it('持久化完成前不发消息；副作用回调不占用串行状态队列', async () => {
  let release!: (value: boolean) => void;
  const effects: SyncEffect[] = [];
  let hold = false;
  const runner = new SyncRunner(
    { ...freshSyncState(), initialized: true },
    port({
      save: async () =>
        hold
          ? new Promise((resolve) => {
              release = resolve;
            })
          : true,
      execute: async (effect) => {
        effects.push(effect);
        return [];
      },
    }),
  );
  await runner.dispatch({ type: 'reconnect', latestUpdateSeq: 0, now: 0 });
  hold = true;
  const pending = runner.dispatch(send);
  await vi.waitFor(() => expect(release).toBeDefined());
  expect(effects).toEqual([]);
  release(true);
  await pending;
  expect(effects).toEqual([{ type: 'send', conversationId: id, body: send.body }]);
  runner.stop();
});
it('落库失败回滚游标与待发状态，归属失效或停止后没有网络副作用', async () => {
  const execute = vi.fn(async () => []);
  const failed = vi.fn();
  const runner = new SyncRunner(
    freshSyncState(),
    port({
      save: async () => {
        throw new Error('disk full');
      },
      execute,
      failed,
    }),
  );
  await expect(runner.dispatch(send)).rejects.toBeInstanceOf(LocalSaveError);
  expect(runner.state).toEqual(freshSyncState());
  expect(failed).toHaveBeenCalledOnce();
  expect(failed.mock.calls[0]![0]).toBeInstanceOf(LocalSaveError);
  expect(runner.active).toBe(false);
  expect(execute).not.toHaveBeenCalled();
  const invalid = new SyncRunner(freshSyncState(), port({ save: async () => false, execute }));
  await invalid.dispatch({ type: 'reconnect', latestUpdateSeq: 0, now: 0 });
  expect(invalid.state).toEqual(freshSyncState());
  await invalid.dispatch(send);
  expect(execute).not.toHaveBeenCalled();
});
it('网络结果晚于停止时，不再保存或发布状态；同时中断HTTP信号', async () => {
  let release!: (value: ClientSyncOperation[]) => void;
  let signal!: AbortSignal;
  const save = vi.fn(async () => true);
  const changed = vi.fn();
  const runner = new SyncRunner(
    freshSyncState(),
    port({
      save,
      changed,
      execute: async (_effect, abort) => {
        signal = abort;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    }),
  );
  await runner.dispatch({ type: 'reconnect', latestUpdateSeq: 0, now: 0 });
  expect(save).toHaveBeenCalledOnce();
  runner.stop();
  expect(signal.aborted).toBe(true);
  release([{ type: 'rebuild.state', latestUpdateSeq: 50 }]);
  await Promise.resolve();
  await Promise.resolve();
  expect(save).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledOnce();
  expect(runner.state.lastUpdateSeq).toBe(0);
});
it('断线会中止旧补拉；迟到结果不能污染重连的新一轮状态', async () => {
  const releases: Array<(value: ClientSyncOperation[]) => void> = [];
  const signals: AbortSignal[] = [];
  const failed = vi.fn();
  const runner = new SyncRunner(
    freshSyncState(),
    port({
      failed,
      execute: async (_effect, signal) => {
        signals.push(signal);
        return new Promise((resolve) => releases.push(resolve));
      },
    }),
  );
  await runner.dispatch({ type: 'reconnect', latestUpdateSeq: 10, now: 0 });
  await runner.dispatch({ type: 'offline' });
  expect(signals[0]!.aborted).toBe(true);
  await runner.dispatch({ type: 'reconnect', latestUpdateSeq: 20, now: 1 });
  releases[0]!([{ type: 'rebuild.state', latestUpdateSeq: 10 }]);
  await Promise.resolve();
  await Promise.resolve();
  expect(signals).toHaveLength(2);
  expect(runner.state.lastUpdateSeq).toBe(0);
  expect(failed).not.toHaveBeenCalled();
  releases[1]!([{ type: 'rebuild.state', latestUpdateSeq: 20 }]);
  await vi.waitFor(() => expect(signals).toHaveLength(3));
  runner.stop();
});
// U7：「本机保存失败」误报——轮询读到的服务器序号在排队期间被实时推送超过，曾被当成服务器倒退并停掉同步。
const unknownUpdate = (updateSeq: number) => ({
  updateSeq,
  occurredAt: '2026-10-27T00:00:00.000Z',
  type: 'future.update.type',
  data: {},
});
it('排队期间推送已前进：过时的服务器序号不算倒退，同步不停止', async () => {
  const failed = vi.fn();
  const runner = new SyncRunner(
    { ...freshSyncState(), initialized: true, lastUpdateSeq: 5 },
    port({ failed }),
  );
  await runner.reconnect(5, 5, 0);
  await runner.dispatch({ type: 'update', update: unknownUpdate(6) as never });
  expect(runner.lastUpdateSeq).toBe(6);
  await runner.reconnect(5, 5, 1);
  expect(runner.active).toBe(true);
  expect(failed).not.toHaveBeenCalled();
  // 读数低于请求发出时的本机游标，才是真正的倒退：报错但不当成本机保存失败。
  await expect(runner.reconnect(3, 6, 2)).rejects.toThrow('服务器更新序号不能倒退');
  expect(runner.active).toBe(true);
  expect(failed).toHaveBeenCalledOnce();
  expect(failed.mock.calls[0]![0]).not.toBeInstanceOf(LocalSaveError);
  runner.stop();
});
it('回放网络结果时数据出错：回滚、只上报一次、同步保持可重试', async () => {
  const failed = vi.fn();
  const runner = new SyncRunner(
    { ...freshSyncState(), initialized: true, lastUpdateSeq: 5 },
    port({
      failed,
      // 补拉页游标不前进，引擎会拒绝。
      execute: async () => [
        {
          type: 'updates.page',
          page: { items: [], hasMore: true, latestUpdateSeq: 9 },
          now: 0,
        } as never,
      ],
    }),
  );
  await runner.reconnect(9, 5, 0);
  await vi.waitFor(() => expect(failed).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(failed).toHaveBeenCalledOnce();
  expect(failed.mock.calls[0]![0]).not.toBeInstanceOf(LocalSaveError);
  expect(runner.active).toBe(true);
  expect(runner.lastUpdateSeq).toBe(5);
  runner.stop();
});
