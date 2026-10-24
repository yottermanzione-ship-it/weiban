/**
 * 记忆分档（v5 批 B，docs/refactor/16-membership-v5.md §5）。
 *
 * 「是否 PRO+」与「注册时间」集中在本文件的 membershipSnapshot() 一处：
 * 是否 PRO+ 用批 A 的统一查询 IdentityMembershipReadPort.isProPlus；注册时间用 IdentityRegistrationReadPort。
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  MemoryTierConfig,
  type IdentityMembershipReadPort,
  type IdentityRegistrationReadPort,
  type MemoryTierStatus,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  parseContract,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import {
  IDENTITY_MEMBERSHIP_READ_PORT,
  IDENTITY_REGISTRATION_READ_PORT,
} from '../../identity/index.js';
import { memoryTierConfig } from '../infra/db/schema.js';
import {
  DEFAULT_MEMORY_TIER_CONFIG,
  normalizeTierConfig,
  resolveTier,
  type ResolvedMemoryTier,
} from '../domain/memory-tier.js';

const CONFIG_TTL_MS = 30_000;

@Injectable()
export class MemoryTierService {
  private cache: { at: number; value: MemoryTierConfig; updatedAt: string | null } | null = null;
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT)
    private readonly membership: IdentityMembershipReadPort,
    @Inject(IDENTITY_REGISTRATION_READ_PORT)
    private readonly registration: IdentityRegistrationReadPort,
  ) {}

  /**
   * 唯一的「是否 PRO+ / 注册时间」判断处。
   * - 是否 PRO+：批 A 统一查询 isProPlus（v5 会员门槛的唯一口径）；
   * - 注册时间：identity 的注册时间端口（契约 3.18 IdentityRegistrationReadPort，新用户前 N 天按 PRO+ 记忆）；
   * 查询失败一律按免费、非新用户处理（宁可少带记忆，不越档）。
   */
  async membershipSnapshot(
    userId: string,
  ): Promise<{ member: boolean; registeredAt: Date | null }> {
    const member = await this.membership.isProPlus(userId).catch(() => false);
    const at = await this.registration.getRegisteredAt(userId).catch(() => null);
    return { member, registeredAt: at ? new Date(at) : null };
  }

  async isProPlus(userId: string): Promise<boolean> {
    return (await this.membershipSnapshot(userId)).member;
  }

  async config(): Promise<MemoryTierConfig> {
    return (await this.loadConfig()).value;
  }

  private async loadConfig() {
    const now = this.clock.nowMs();
    if (this.cache && now - this.cache.at < CONFIG_TTL_MS) return this.cache;
    const [row] = await this.db.db
      .select()
      .from(memoryTierConfig)
      .where(eq(memoryTierConfig.id, 1))
      .catch(() => []);
    this.cache = {
      at: now,
      value: row ? normalizeTierConfig(row.config) : DEFAULT_MEMORY_TIER_CONFIG,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
    return this.cache;
  }

  async resolve(userId: string): Promise<ResolvedMemoryTier> {
    const [snapshot, config] = await Promise.all([this.membershipSnapshot(userId), this.config()]);
    return resolveTier({ ...snapshot, now: this.clock.now(), config });
  }

  async status(userId: string, libraryCount: number): Promise<MemoryTierStatus> {
    const tier = await this.resolve(userId);
    return {
      tier: tier.tier,
      basis: tier.basis,
      trialEndsAt: tier.trialEndsAt,
      limits: tier.limits,
      libraryCount,
    };
  }

  async adminGet() {
    const c = await this.loadConfig();
    return { ...c.value, updatedAt: c.updatedAt };
  }

  async adminUpdate(adminId: string, input: unknown) {
    const body = parseContract(MemoryTierConfig, input);
    const previous = await this.config();
    body.groupMemoryMessageThreshold ??= previous.groupMemoryMessageThreshold ?? 20;
    body.groupMemoryIdleMinutes ??= previous.groupMemoryIdleMinutes ?? 10;
    const old = await this.config();
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await tx.db
        .insert(memoryTierConfig)
        .values({ id: 1, config: body, updatedBy: adminId, updatedAt: now })
        .onConflictDoUpdate({
          target: memoryTierConfig.id,
          set: { config: body, updatedBy: adminId, updatedAt: now },
        });
      await this.audit.record(
        {
          module: 'ai_runtime',
          action: 'memory_tier.config_updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'memory_tier_config',
          targetId: '1',
          details: { from: old, to: body },
        },
        tx,
      );
    });
    this.cache = null;
    return this.adminGet();
  }
}
