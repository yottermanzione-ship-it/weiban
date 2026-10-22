/**
 * 角色生态 v1：设置与闸门（17 号 §1、§2、§6；16 号 §4）。
 *
 * - 用户设置：总开关（默认关）、活跃程度四档、关掉的动作、每个角色一个开关（没设置过 = 开）。
 * - 平台参数：决策模型（后台必须配置；未配置时生态不运行，不回退用户聊天模型）、四档次数、关掉的动作、唤醒时段。
 * - 闸门 isActive：账号正常 + PRO+（统一用 isProPlus）+ 总开关 + 未因积分不足暂停 + 角色开关 + 动作开关。
 *   所有「角色自己做、扣用户积分」的旧流程（推演、朋友圈、群里自己聊、经期关怀、你不在时、名场面……）都先过它。
 * 说明见 docs/ai/ecology-v1.md。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  EcologyConfig,
  Id,
  UpdateEcologySettings,
  type ContactsReadPort,
  type EcologyActionKey,
  type EcologyActivityLevel,
  type EcologyAdminOverview,
  type EcologySettings,
  type IdentityAccountStatusPort,
  type IdentityMembershipReadPort,
  type ModelGatewayMediaPort,
  type ModelQuotePort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  parseContract,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import {
  IDENTITY_ACCOUNT_STATUS_PORT,
  IDENTITY_MEMBERSHIP_READ_PORT,
} from '../../identity/index.js';
import { MODEL_GATEWAY_MEDIA_PORT, MODEL_QUOTE_PORT } from '../../model-access/index.js';
import {
  ACTION_DEF,
  DEFAULT_ECOLOGY_CONFIG,
  ECOLOGY_ACTIONS,
  LEVEL_LABELS,
  LEVEL_ORDER,
  averageWakes,
  detectUserRequest,
  microsToPoints,
} from '../domain/ecology.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import type { BillingReadPort } from '@weiban/contracts';
import {
  ecologyCharacterSettings,
  ecologyConfigTable,
  ecologyRuns,
  ecologySettings,
} from '../infra/db/ecology-schema.js';

/** 决策调用的估算用量（报价用）：快照约 3000 token 输入。 */
const DECISION_ESTIMATE = { inputTokens: 3500, outputTokens: 300 };
const CONFIG_CACHE_MS = 30_000;

type SettingsRow = typeof ecologySettings.$inferSelect;

@Injectable()
export class EcologySettingsService {
  private cache: { at: number; config: EcologyConfig } | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT) private readonly membership: IdentityMembershipReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(MODEL_QUOTE_PORT) private readonly quotes: ModelQuotePort,
    @Inject(MODEL_GATEWAY_MEDIA_PORT) private readonly media: ModelGatewayMediaPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
  ) {}

  // =========================================================================
  // 平台参数
  // =========================================================================
  async config(): Promise<EcologyConfig> {
    const now = this.clock.nowMs();
    if (this.cache && now - this.cache.at < CONFIG_CACHE_MS) return this.cache.config;
    const [row] = await this.db.db
      .select()
      .from(ecologyConfigTable)
      .where(eq(ecologyConfigTable.id, 'default'));
    const parsed = row ? EcologyConfig.safeParse(row.config) : null;
    const config = parsed?.success ? parsed.data : DEFAULT_ECOLOGY_CONFIG;
    this.cache = { at: now, config };
    return config;
  }

  /** 决策模型是否可用（已配置、在目录中、有价格）。 */
  async decisionModelReady(probeUserId: string): Promise<boolean> {
    const config = await this.config();
    if (!config.decisionModelKey) return false;
    return (await this.quoteDecision(probeUserId, config.decisionModelKey)) !== null;
  }

  private async quoteDecision(userId: string, modelKey: string): Promise<number | null> {
    const quote = await this.quotes
      .quote({
        userId,
        purpose: 'behavior_planning',
        modelKeyOverride: modelKey,
        estimate: DECISION_ESTIMATE,
      })
      .catch(() => null);
    return quote?.ok ? quote.value.amountMicros : null;
  }

  async adminOverview(adminUserId: string): Promise<EcologyAdminOverview> {
    const config = await this.config();
    const ready = config.decisionModelKey
      ? (await this.quoteDecision(adminUserId, config.decisionModelKey)) !== null
      : false;
    const warnings: string[] = [];
    if (!config.decisionModelKey)
      warnings.push('未配置决策模型：角色生态不会运行（不会改用用户的聊天模型）。');
    else if (!ready)
      warnings.push(
        `决策模型 ${config.decisionModelKey} 不在模型目录、已下架或没有价格：角色生态暂停。`,
      );
    const since = new Date(this.clock.nowMs() - 86400_000);
    const [enabled] = await this.db.db
      .select({ n: count() })
      .from(ecologySettings)
      .where(eq(ecologySettings.enabled, true));
    const [runs] = await this.db.db
      .select({
        n: count(),
        actions: sql<number>`count(*) FILTER (WHERE ${ecologyRuns.status} = 'done')`,
        micros: sql<string>`COALESCE(SUM(${ecologyRuns.chargedMicros}), 0)`,
      })
      .from(ecologyRuns)
      .where(gte(ecologyRuns.createdAt, since));
    return {
      config,
      decisionModelReady: ready,
      warnings,
      last24h: {
        enabledUsers: Number(enabled?.n ?? 0),
        runs: Number(runs?.n ?? 0),
        actions: Number(runs?.actions ?? 0),
        points: microsToPoints(Number(runs?.micros ?? 0)),
      },
    };
  }

  async updateConfig(adminUserId: string, input: EcologyConfig): Promise<EcologyAdminOverview> {
    const config = parseContract(EcologyConfig, input);
    if (config.decisionModelKey) {
      const amount = await this.quoteDecision(adminUserId, config.decisionModelKey);
      if (amount === null)
        throw new AppError('bad_request', '决策模型不在模型目录、已下架或没有价格');
    }
    const now = this.clock.now();
    await this.db.db
      .insert(ecologyConfigTable)
      .values({ id: 'default', config, updatedBy: adminUserId, updatedAt: now })
      .onConflictDoUpdate({
        target: ecologyConfigTable.id,
        set: { config, updatedBy: adminUserId, updatedAt: now },
      });
    this.cache = null;
    return this.adminOverview(adminUserId);
  }

  // =========================================================================
  // 用户设置
  // =========================================================================
  async row(userId: string): Promise<SettingsRow | null> {
    const [row] = await this.db.db
      .select()
      .from(ecologySettings)
      .where(eq(ecologySettings.userId, userId));
    return row ?? null;
  }

  async characterEnabled(userId: string, characterId: string): Promise<boolean> {
    const [row] = await this.db.db
      .select({ enabled: ecologyCharacterSettings.enabled })
      .from(ecologyCharacterSettings)
      .where(
        and(
          eq(ecologyCharacterSettings.userId, userId),
          eq(ecologyCharacterSettings.characterId, characterId),
        ),
      );
    return row?.enabled ?? true;
  }

  /** 平台能否执行某动作（不看用户开关）。 */
  async actionAvailable(key: EcologyActionKey, config?: EcologyConfig): Promise<string | null> {
    const def = ACTION_DEF.get(key);
    if (!def) return '即将上线';
    if (def.mode === 'reserved') return def.reservedReason ?? '即将上线';
    if ((config ?? (await this.config())).disabledActions.includes(key)) return '平台暂未开放';
    if (def.needs && !(await this.media.isServiceEnabled(def.needs).catch(() => false)))
      return def.needs === 'speech_synthesis' ? '平台未开通语音合成' : '平台未开通联网搜索';
    return null;
  }

  /**
   * 生态闸门：这个用户（+ 角色 + 动作）现在能不能由角色自己行动。
   * 不检查决策模型（旧流程用各自的模型；决策模型只管生态唤醒）。
   */
  async isActive(
    userId: string,
    characterId?: string | null,
    action?: EcologyActionKey,
  ): Promise<boolean> {
    try {
      const row = await this.row(userId);
      if (!row?.enabled || row.pausedReason) return false;
      if ((await this.accounts.getAccountStatus(userId)) !== 'active') return false;
      // 3.22（批 E2 遗留）：封禁账号的生态全部跳过，不扣积分（网关处也会再拦一次）。
      if (await this.accounts.isBanned?.(userId)) return false;
      if (!(await this.membership.isProPlus(userId))) return false;
      if (characterId && !(await this.characterEnabled(userId, characterId))) return false;
      if (action) {
        if (row.disabledActions.includes(action)) return false;
        if (await this.actionAvailable(action)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 开着生态的用户（循环用；会员与暂停在单个用户处理时再判断）。 */
  async enabledUserIds(): Promise<string[]> {
    const rows = await this.db.db
      .select({ userId: ecologySettings.userId })
      .from(ecologySettings)
      .where(eq(ecologySettings.enabled, true));
    return rows.map((r) => r.userId);
  }

  async get(userId: string): Promise<EcologySettings> {
    parseContract(Id, userId);
    const [row, config, eligible] = await Promise.all([
      this.row(userId),
      this.config(),
      this.membership.isProPlus(userId),
    ]);
    const contacts = await this.contacts.listActiveContacts(userId).catch(() => []);
    const ids = contacts.map((c) => c.characterId);
    const switches = ids.length
      ? await this.db.db
          .select()
          .from(ecologyCharacterSettings)
          .where(
            and(
              eq(ecologyCharacterSettings.userId, userId),
              inArray(ecologyCharacterSettings.characterId, ids),
            ),
          )
      : [];
    const characters = ids.map((characterId) => ({
      characterId,
      enabled: switches.find((s) => s.characterId === characterId)?.enabled ?? true,
    }));
    const disabled = new Set(row?.disabledActions ?? []);
    const actions = [];
    for (const def of ECOLOGY_ACTIONS) {
      const reason = await this.actionAvailable(def.key, config);
      actions.push({
        key: def.key,
        group: def.group,
        label: def.label,
        available: reason === null,
        unavailableReason: reason,
        enabled: !disabled.has(def.key),
      });
    }
    const perWake = await this.estimatePerWakeMicros(userId, config);
    const levels = LEVEL_ORDER.map((level) => {
      const range = config.levels[level];
      return {
        level,
        label: LEVEL_LABELS[level],
        minPerDay: range.min,
        maxPerDay: range.max,
        pointsPerCharacterPerDay:
          perWake === null
            ? null
            : Math.round(microsToPoints(perWake * averageWakes(range)) * 10) / 10,
      };
    });
    const level = (row?.activityLevel ?? 'often') as EcologyActivityLevel;
    const activeCharacters = characters.filter((c) => c.enabled).length;
    const perCharacter = levels.find((l) => l.level === level)?.pointsPerCharacterPerDay ?? null;
    return {
      enabled: !!row?.enabled,
      activityLevel: level,
      actions,
      levels,
      characters,
      eligible,
      runnable: !!config.decisionModelKey && perWake !== null,
      pausedReason: row?.pausedReason === 'insufficient_balance' ? 'insufficient_balance' : null,
      introSeen: !!row?.introSeen,
      estimatedPointsPerDay:
        perCharacter === null ? null : Math.round(perCharacter * activeCharacters * 10) / 10,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * 每次唤醒的估算花费：最近 7 天全平台生态唤醒的平均实扣（样本 ≥ 20），否则按决策模型报价 × 2.5
   * （决策一次 + 一部分唤醒会真正执行动作）。决策模型不可用返回 null。
   */
  private async estimatePerWakeMicros(
    userId: string,
    config: EcologyConfig,
  ): Promise<number | null> {
    if (!config.decisionModelKey) return null;
    const decision = await this.quoteDecision(userId, config.decisionModelKey);
    if (decision === null) return null;
    const [avg] = await this.db.db
      .select({
        n: count(),
        avg: sql<string>`COALESCE(AVG(${ecologyRuns.chargedMicros}), 0)`,
      })
      .from(ecologyRuns)
      .where(
        and(
          eq(ecologyRuns.origin, 'ecology'),
          inArray(ecologyRuns.status, ['done', 'idle']),
          gte(ecologyRuns.createdAt, new Date(this.clock.nowMs() - 7 * 86400_000)),
        ),
      );
    if (Number(avg?.n ?? 0) >= 20) return Number(avg?.avg ?? 0);
    return Math.round(decision * 2.5);
  }

  async update(userId: string, input: unknown): Promise<EcologySettings> {
    parseContract(Id, userId);
    const body = parseContract(UpdateEcologySettings, input);
    if (body.enabled === true && !(await this.membership.isProPlus(userId)))
      throw new AppError('forbidden', '角色生态是 PRO+ 会员专属');
    const now = this.clock.now();
    const current = await this.row(userId);
    const disabled = new Set(current?.disabledActions ?? []);
    for (const a of body.actions ?? []) {
      if (a.enabled) disabled.delete(a.key);
      else disabled.add(a.key);
    }
    const values = {
      enabled: body.enabled ?? current?.enabled ?? false,
      activityLevel: body.activityLevel ?? current?.activityLevel ?? 'often',
      disabledActions: [...disabled].sort(),
      introSeen: body.introSeen ?? current?.introSeen ?? false,
      // 用户重新打开总开关时清掉暂停（充值后也会自动清）。
      ...(body.enabled === true ? { pausedReason: null, pausedAt: null } : {}),
      updatedAt: now,
    };
    await this.db.transaction(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('ecology-settings:' || $1,0))",
        [userId],
      );
      if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
        throw new AppError('unauthenticated', '账号不可用');
      await tx.db
        .insert(ecologySettings)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: ecologySettings.userId, set: values });
    });
    return this.get(userId);
  }

  async setCharacter(userId: string, characterId: string, enabled: boolean) {
    parseContract(Id, userId);
    parseContract(Id, characterId);
    if (!(await this.contacts.getActiveContact(userId, characterId)))
      throw new AppError('not_found', '好友不存在');
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('ecology-settings:' || $1,0))",
        [userId],
      );
      if (!(await this.contacts.getActiveContactEpoch(userId, characterId, tx)))
        throw new AppError('not_found', '好友不存在');
      await tx.db
        .insert(ecologyCharacterSettings)
        .values({ userId, characterId, enabled, updatedAt: now })
        .onConflictDoUpdate({
          target: [ecologyCharacterSettings.userId, ecologyCharacterSettings.characterId],
          set: { enabled, updatedAt: now },
        });
    });
    return { characterId, enabled };
  }

  /**
   * 用户在聊天里让角色做的动作（17 号 §7）现在能不能执行：PRO+、平台可执行、积分没有不足。
   * 不看生态开关（用户主动要求的不受开关限制）。
   */
  async canExecuteRequest(userId: string, action: EcologyActionKey): Promise<boolean> {
    if (!(await this.membership.isProPlus(userId).catch(() => false))) return false;
    if (await this.actionAvailable(action)) return false;
    const spend = await this.billing.getSpendStatus(userId).catch(() => null);
    return !!spend && !spend.insufficient;
  }

  /**
   * 私聊回复动态结尾的一段（reply-context 调用）：说到做到。识别到用户让角色做某个动作时，
   * 告诉模型系统会不会真的执行，避免「嘴上答应」。
   */
  async replyHint(userId: string, userText: string): Promise<string> {
    const base =
      '说到做到：不要说自己已经发了朋友圈、改了签名、拍了拍对方，除非下面写明系统会去做；你不会主动给对方打电话，也不要说「一会儿打给你」。';
    const action = detectUserRequest(userText);
    if (!action) return base;
    const label = ACTION_DEF.get(action)?.label ?? '这件事';
    return (await this.canExecuteRequest(userId, action))
      ? `${base}\n对方让你「${label}」：系统会在你回复后真的去做，你可以自然地答应（例如「好，我去发」），不要编造具体内容。`
      : `${base}\n对方让你「${label}」：这个现在做不到，不要答应、也不要假装做了，用自然的说法带过（例如「下次吧」）。`;
  }

  /** 积分不足：静默暂停（下次打开 App 的一次提示由 billing 记录，16 号 §8）。 */
  async pause(userId: string, reason: 'insufficient_balance'): Promise<void> {
    const now = this.clock.now();
    await this.db.db
      .update(ecologySettings)
      .set({ pausedReason: reason, pausedAt: now })
      .where(eq(ecologySettings.userId, userId));
  }

  /** 充值后恢复（billing.balance_restored）。 */
  async resume(userId: string): Promise<void> {
    await this.db.db
      .update(ecologySettings)
      .set({ pausedReason: null, pausedAt: null })
      .where(eq(ecologySettings.userId, userId));
  }
}
