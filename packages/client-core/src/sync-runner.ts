import type { ClientSyncOperation } from '@weiban/contracts';
import { SyncEngine } from './sync-engine.js';
import type { LocalSyncState, SyncEffect } from './sync-state.js';

export interface SyncDriverPort {
  /** 原子保存整个state；归属不符时返回false。 */
  save(state: LocalSyncState): Promise<boolean>;
  execute(effect: SyncEffect, signal: AbortSignal): Promise<ClientSyncOperation[] | void>;
  changed(state: LocalSyncState): void;
  failed(error: unknown): void;
}

/** 本机事务先于网络副作用；网络回调重新进入串行队列，避免ACK与更新互相覆盖。 */
export class SyncRunner {
  private engine: SyncEngine;
  private queue: Promise<void> = Promise.resolve();
  private lifetime = new AbortController();
  private stopped = false;

  constructor(
    initial: unknown,
    private readonly port: SyncDriverPort,
  ) {
    this.engine = new SyncEngine(initial);
  }
  get state(): LocalSyncState {
    return this.engine.state;
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
    }, guard);
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
        if (!(await this.port.save(this.engine.state))) {
          this.engine = new SyncEngine(previous);
          this.stop();
          return;
        }
      } catch (error) {
        // 保存失败时不能发送，也不能把未持久化游标呈现为已同步。
        this.engine = new SyncEngine(previous);
        this.stop();
        this.port.failed(error);
        throw error;
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
      if (!this.stopped && !signal.aborted) this.port.failed(error);
    }
  }
}
