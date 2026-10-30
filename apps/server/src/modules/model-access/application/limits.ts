/**
 * v3.4（ADR-0032）：每用户并发 / 每分钟上限与账号健康参数（model_access.settings 的 gateway_limits）。
 * 读取有 10 秒进程内缓存（网关每次调用都要读）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { GatewayLimits } from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { modelAccessSettings } from '../infra/db/schema.js';

const KEY = 'gateway_limits';
const CACHE_MS = 10_000;

/** 默认值：每用户不限；连续失败 3 次暂停 1 分钟（2026-10-30 用户定，原 5 分钟改 1 分钟）。 */
export const DEFAULT_GATEWAY_LIMITS: GatewayLimits = {
  perUserConcurrency: null,
  perUserRpm: null,
  failureThreshold: 3,
  cooldownSeconds: 60,
  searchCandidatesPerUserDay: 20,
  searchCandidatesGlobalDay: 5000,
};

@Injectable()
export class GatewayLimitsService {
  private cached: { value: GatewayLimits; at: number } | null = null;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(): Promise<GatewayLimits> {
    const now = this.clock.nowMs();
    if (this.cached && now - this.cached.at < CACHE_MS) return this.cached.value;
    const [row] = await this.database.db
      .select()
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, KEY));
    const parsed = GatewayLimits.safeParse(row?.value);
    const value = parsed.success
      ? { ...DEFAULT_GATEWAY_LIMITS, ...parsed.data }
      : DEFAULT_GATEWAY_LIMITS;
    this.cached = { value, at: now };
    return value;
  }

  async update(adminId: string, value: GatewayLimits): Promise<GatewayLimits> {
    // 旧管理端不知道新增字段时，保留已设置的搜索额度。
    value = { ...(await this.get()), ...value };
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx.db
        .insert(modelAccessSettings)
        .values({ key: KEY, value, updatedAt: now, updatedBy: adminId })
        .onConflictDoUpdate({
          target: modelAccessSettings.key,
          set: { value, updatedAt: now, updatedBy: adminId },
        });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'gateway_limits.updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'model_access_settings',
          details: { ...value },
        },
        tx,
      );
    });
    this.cached = { value, at: this.clock.nowMs() };
    return value;
  }
}
