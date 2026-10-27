import type { ClientSyncOperation } from '@weiban/contracts';
import { SyncEngine } from './sync-engine.js';
import type { LocalSyncState, SyncEffect } from './sync-state.js';

export interface SyncDriverPort {
  /** 原子保存整个state；归属不符时返回false。 */
  save(state: LocalSyncState): Promise<boolean>;
  execute(effect: SyncEffect, signal: AbortSignal): Promise<ClientSyncOperation[] | void>;
  changed(state: LocalSyncState): void;
  /**
   * 失败分两类：error 是 LocalSaveError 时本机写入失败、同步已停止（active 为 false）；
   * 其它是数据或网络问题，状态已回滚，同步仍可重试。
   */
  failed(error: unknown): void;
}

/** 本机写入（IndexedDB）失败。只有这一类会停止同步，其余错误回滚后保持可重试。 */
export class LocalSaveError extends Error {
  constructor(readonly reason: unknown) {
    super('本机保存失败');
    this.name = 'LocalSaveError';
  }
  /** 浏览器报告存储空间不足。 */
  get quota(): boolean {
    const reason = this.reason;
    return Boolean(
      reason &&
      typeof reason === 'object' &&
      'name' in reason &&
      reason.name === 'QuotaExceededError',
    );
  }
}

/** mutate 已上报过的错误，execute 不再重复上报。 */
const reported = new WeakSet<object>();
function mark(error: unknown): void {
  if (error && typeof error === 'object') reported.add(error);
}

/** 本机事务先于网络副作用；网络回调重新进入串行队列，避免ACK与更新互相覆盖。 */
export class SyncRunner {
  private engine: SyncEngine;
  private queue: Promise<void> = Promise.resolve();
  private lifetime = new AbortController();
  private stopped = false;
  private snapshots = 0;
  get snapshotRevision(): number {
    return this.snapshots;
  }

  constructor(
    initial: unknown,
    private readonly port: SyncDriverPort,
  ) {
    this.engine = new SyncEngine(initial);
  }
  get state(): LocalSyncState {
    return this.engine.state;
  }
  /** 当前游标（不复制整份状态）。 */
  get lastUpdateSeq(): number {
    return this.engine.lastUpdateSeq;
  }
  get isRebuilding(): boolean {
    return this.engine.isRebuilding;
  }
  get active(): boolean {
    return !this.stopped;
  }
  stop(): void {
    this.stopped = true;
    this.lifetime.abort();
  }
  dispatch(operation: ClientSyncOperation, guard?: AbortSignal): Promise<void> {
    return this.mutate((engine) => {
      if (operation.type === 'offline') {
        this.lifetime.abort();
        this.lifetime = new AbortController();
      }
      engine.apply(operation);
    }, guard).then(() => {
      if (operation.type === 'snapshot' && !this.stopped && !guard?.aborted) this.snapshots++;
    });
  }
  /**
   * 服务器最新序号是在本机游标为 since 时读到的；排队期间实时推送已让本机前进，
   * 这份读数只是过时、不是服务器倒退，按「已是最新」处理。读数低于 since 才算真正倒退。
   */
  reconnect(latestUpdateSeq: number, since: number, now: number): Promise<void> {
    return this.mutate((engine) => {
      const local = engine.lastUpdateSeq;
      const seq = latestUpdateSeq < local && latestUpdateSeq >= since ? local : latestUpdateSeq;
      engine.apply({ type: 'reconnect', latestUpdateSeq: seq, now });
    });
  }
  history(conversationId: string, beforeSeq: number, page: unknown): Promise<void> {
    return this.mutate((engine) => engine.history(conversationId, beforeSeq, page));
  }
  clearHistory(conversationId: string, throughSeq: number): Promise<void> {
    return this.mutate((engine) => engine.clearHistory(conversationId, throughSeq));
  }
  private mutate(action: (engine: SyncEngine) => void, guard?: AbortSignal): Promise<void> {
    const work = this.queue.then(async () => {
      if (this.stopped || guard?.aborted) return;
      const previous = this.engine.state;
      try {
        action(this.engine);
      } catch (error) {
        // 数据不合预期（过时的序号、看不懂的帧等）：引擎已自行回滚、本机什么都没写，
        // 不停止同步，由驱动转为离线并稍后重试；不能报成本机存储故障。
        this.engine = new SyncEngine(previous);
        mark(error);
        this.port.failed(error);
        throw error;
      }
      let saved: boolean;
      try {
        saved = await this.port.save(this.engine.state);
      } catch (error) {
        // 保存失败时不能发送，也不能把未持久化游标呈现为已同步。
        this.engine = new SyncEngine(previous);
        this.stop();
        const failure = new LocalSaveError(error);
        mark(failure);
        this.port.failed(failure);
        throw failure;
      }
      if (!saved) {
        this.engine = new SyncEngine(previous);
        this.stop();
        return;
      }
      if (this.stopped) return;
      const effects = this.engine.drainEffects();
      this.port.changed(this.engine.state);
      for (const effect of effects) void this.execute(effect);
    });
    this.queue = work.catch(() => {});
    return work;
  }
  private async execute(effect: SyncEffect): Promise<void> {
    const signal = this.lifetime.signal;
    try {
      if (this.stopped) return;
      const operations = await this.port.execute(effect, signal);
      if (this.stopped || signal.aborted) return;
      for (const operation of operations ?? []) {
        if (signal.aborted) return;
        await this.dispatch(operation, signal);
      }
    } catch (error) {
      // 回放结果时 mutate 已上报过一次，这里不重复。
      if (
        !this.stopped &&
        !signal.aborted &&
        !(error && typeof error === 'object' && reported.has(error))
      )
        this.port.failed(error);
    }
  }
}
