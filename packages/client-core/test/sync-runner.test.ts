import { expect, it, vi } from 'vitest';
import type { ClientSyncOperation } from '@weiban/contracts';
import { SyncRunner, freshSyncState, type SyncDriverPort, type SyncEffect } from '../src/index.js';
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
  await expect(runner.dispatch(send)).rejects.toThrow('disk full');
  expect(runner.state).toEqual(freshSyncState());
  expect(failed).toHaveBeenCalledOnce();
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
