/**
 * 记忆分档与长上下文（v5 批 B，docs/refactor/16-membership-v5.md §5）。
 *
 * 「是否 PRO+」与「注册时间」集中在本文件的 membershipSnapshot() 一处判断（临时实现）：
 * TEMP(v5 批 A)：批 A（v5-membership）正在做统一的「是否 PRO+」查询，合并时由总负责人把
 * membershipSnapshot() 改接统一查询即可，其他地方都只调用本服务，不用改。
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  MemoryTierConfig,
  type IdentityMembershipReadPort,
  type IdentityRegistrationReadPort,
  type MemoryTierStatus,
  type ModelQuotePort,
} from '@weiban/contracts';
import {
  AppError,
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
import { MODEL_QUOTE_PORT } from '../../model-access/index.js';
import { memoryTierConfig } from '../infra/db/schema.js';
import {
  DEFAULT_MEMORY_TIER_CONFIG,
  normalizeTierConfig,
  resolveTier,
  windowProblem,
  type ResolvedMemoryTier,
} from '../domain/memory-tier.js';
import { WINDOW } from '../domain/memory-window.js';

const CONFIG_TTL_MS = 30_000;
/** 「约每条积分」的估算口径：窗口接近装满时的输入 token 与缓存命中比例（docs/ai 成本估算同口径的粗估）。 */
const ESTIMATE = {
  normal: { input: 12_000, cachedShare: 0.8 },
  long: { input: 100_000, cachedShare: 0.9 },
  output: 300,
};

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
    @Inject(MODEL_QUOTE_PORT) private readonly quotes: ModelQuotePort,
  ) {}

  /**
   * TEMP(v5 批 A)：唯一的「是否 PRO+ / 注册时间」判断处。
   * - 是否 PRO+：读现有会员表（identity.memberships，经 identity 的只读端口，按服务端时钟判断有效期）；
   * - 注册时间：identity 的注册时间端口（契约 3.17 IdentityRegistrationReadPort，新用户前 N 天按 PRO+ 记忆）；
   *   批 A 的统一查询若带注册时间 / 新用户体验，合并时可一并改接。
   * 查询失败一律按免费、非新用户处理（宁可少带记忆，不越档）。
   */
  async membershipSnapshot(
    userId: string,
  ): Promise<{ member: boolean; registeredAt: Date | null }> {
    const member = await this.membership
      .getMembership(userId)
      .then((m) => m.tier === 'pro_plus')
      .catch(() => false);
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

  /** 长上下文模式实际是否生效：PRO+ 会员 + 该角色打开。 */
  async longContextLimits(
    userId: string,
    enabled: boolean,
  ): Promise<{ active: boolean; limits: typeof WINDOW }> {
    if (!enabled) return { active: false, limits: WINDOW };
    const tier = await this.resolve(userId);
    if (!tier.member) return { active: false, limits: WINDOW };
    return { active: true, limits: tier.config.longContext };
  }

  /** 约每条积分（1 积分 = 10000 微元）；模型未配置或缺价返回 null。 */
  async estimatePoints(
    userId: string,
    characterId: string,
  ): Promise<{ normal: number | null; long: number | null }> {
    const quote = async (e: { input: number; cachedShare: number }) => {
      const cached = Math.round(e.input * e.cachedShare);
      const r = await this.quotes
        .quote({
          userId,
          characterId,
          purpose: 'chat_reply',
          estimate: {
            inputTokens: e.input - cached,
            cachedInputTokens: cached,
            outputTokens: ESTIMATE.output,
          },
        })
        .catch(() => null);
      return r?.ok ? Math.round(r.value.amountMicros / 100) / 100 : null;
    };
    const [normal, long] = await Promise.all([quote(ESTIMATE.normal), quote(ESTIMATE.long)]);
    return { normal, long };
  }

  async status(
    userId: string,
    characterId: string,
    libraryCount: number,
    longContextSetting: boolean,
  ): Promise<MemoryTierStatus> {
    const tier = await this.resolve(userId);
    const points = tier.member
      ? await this.estimatePoints(userId, characterId)
      : { normal: null, long: null };
    return {
      tier: tier.tier,
      basis: tier.basis,
      trialEndsAt: tier.trialEndsAt,
      limits: tier.limits,
      libraryCount,
      longContext: {
        available: tier.member,
        enabled: tier.member && longContextSetting,
        pointsPerMessage: points.long,
        normalPointsPerMessage: points.normal,
      },
    };
  }

  async adminGet() {
    const c = await this.loadConfig();
    return { ...c.value, updatedAt: c.updatedAt };
  }

  async adminUpdate(adminId: string, input: unknown) {
    const body = parseContract(MemoryTierConfig, input);
    const problem = windowProblem(body.longContext);
    if (problem) throw new AppError('bad_request', `长上下文窗口：${problem}`);
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
