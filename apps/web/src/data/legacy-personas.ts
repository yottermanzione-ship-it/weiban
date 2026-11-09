import { ApiFailure } from '@weiban/client-core';
import type { LegacyPersonaBlockedReason, LegacyPersonaReset } from '@weiban/contracts';

/** Page-local only: no localStorage, raw persona cache or command transfer across owners. */
export class LegacyPersonaSession {
  private active = true;
  private readonly requests = new Set<AbortController>();
  private command: { characterId: string; body: LegacyPersonaReset } | null = null;
  constructor(
    private readonly owner: string,
    private readonly currentOwner: () => string,
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}
  activate() {
    this.active = true;
  }
  isCurrent() {
    return this.active && this.owner !== 'public' && this.currentOwner() === this.owner;
  }
  get resetPending() {
    return this.command !== null;
  }
  clearReset() {
    this.command = null;
  }
  dispose() {
    this.active = false;
    this.command = null;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
  }
  async request<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const expired = () => new ApiFailure('session_changed', '登录状态已改变', 0);
    if (!this.isCurrent()) throw expired();
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      const result = await work(controller.signal);
      if (!this.isCurrent() || controller.signal.aborted) throw expired();
      return result;
    } catch (error) {
      if (!this.isCurrent() || controller.signal.aborted) throw expired();
      throw error;
    } finally {
      this.requests.delete(controller);
    }
  }
  async reset<T>(
    characterId: string,
    version: number,
    work: (body: LegacyPersonaReset, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (!this.isCurrent()) throw new ApiFailure('session_changed', '登录状态已改变', 0);
    if (this.command && this.command.characterId !== characterId)
      throw new ApiFailure('conflict', '请重新读取这份设定', 409);
    this.command ??= {
      characterId,
      body: { clientCommandId: this.uuid(), expectedVersion: version },
    };
    try {
      const result = await this.request((signal) => work({ ...this.command!.body }, signal));
      this.command = null;
      return result;
    } catch (error) {
      if (legacyPersonaConflict(error)) this.command = null;
      throw error;
    }
  }
}

export function legacyPersonaConflict(error: unknown): boolean {
  return error instanceof ApiFailure && (error.status === 409 || error.code === 'conflict');
}
export function legacyPersonaError(error: unknown, operation: 'read' | 'reset'): string {
  if (error instanceof ApiFailure && [401, 403, 404].includes(error.status))
    return operation === 'read'
      ? '暂时无法读取这份旧版设定，请稍后重试。'
      : '暂时无法恢复默认，请重新读取后再试。';
  return operation === 'read'
    ? '旧版设定暂未读取，请检查网络后重试。'
    : '请求结果暂未确认。请重试恢复默认，重复请求不会再次清除。';
}
export function legacyPersonaBlockedNotice(reason: LegacyPersonaBlockedReason | null): string {
  const notices: Record<LegacyPersonaBlockedReason, string> = {
    source_unverified: '这份旧版设定还在核对中，暂未用于聊天。',
    base_missing: '这份旧版设定还需要与原人设核对，暂未用于聊天。',
    base_mismatch: '这份旧版设定与当前人设仍需核对，暂未用于聊天。',
    identity_mapping_unverified: '这份旧版设定对应的角色仍在核对，暂未用于聊天。',
    target_personal_changes: '你在新版还有自己的设定。为保留这些修改，旧版设定暂未启用。',
    unsupported_structure: '部分旧版内容还需要整理，暂未用于聊天。',
    classification_unverified: '这份旧版设定还在核对中，暂未用于聊天。',
    restricted_identity_change: '这份旧版设定含有暂不能沿用的内容，尚未生效。',
    character_unavailable: '这位角色目前暂不可使用，旧版设定尚未生效。',
  };
  return reason ? notices[reason] : '这份旧版设定尚未生效。';
}
