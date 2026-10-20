/**
 * 上游登记（billing.md 3.1）：平台密钥信封加密、掩码、连通测试、更换、删除、审计；上游状态与状态事件。
 *
 * 密钥规则（security-and-privacy.md 第 3 节）：
 * - 密钥原文只出现在「登记 / 更换」请求里，先做连通测试，成功才加密保存（AAD = upstream:{id}）；
 * - 数据库只有密文和掩码；任何返回值只有掩码；日志、审计、事件里都不出现密钥；
 * - 解密只在 withApiKey() 里发生（D-L0-09 的网关发请求那一刻用），用完即弃。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { AdminAlertFacts, Upstream, UpstreamKind, UpstreamStatus } from '@weiban/contracts';
import { and, asc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  APP_CONFIG,
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  LOGGER,
  OUTBOX,
  PLATFORM_KEY_OWNER,
  newId,
  type AppConfig,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type Logger,
  type Outbox,
} from '../../../platform/index.js';
import {
  checkBaseUrl,
  formatMask,
  maskParts,
  normalizeApiKey,
  statusAfterTest,
  upstreamAad,
  type UpstreamTestFailure,
} from '../domain/rules.js';
import {
  modelCatalog,
  modelRoutes,
  upstreamStatus,
  upstreams,
  usageRecords,
} from '../infra/db/schema.js';
import { beijingDay, beijingDayRange } from '../domain/rules.js';
import { fetchUpstreamModels } from '../infra/upstream-probe.js';
import { UPSTREAM_PROBE, type UpstreamProbe } from '../tokens.js';

type UpstreamRow = typeof upstreams.$inferSelect;
type Kind = z.infer<typeof UpstreamKind>;

/** 上游状态变化的来源（记在 upstream_status.source）。 */
export type StatusSource = 'created' | 'admin_test' | 'key_rotated' | 'gateway' | 'probe';

export function toUpstream(
  row: UpstreamRow,
  extra?: { inFlight?: number; todayCalls?: number; todayCostMicros?: number },
): Upstream {
  return {
    upstreamId: row.id,
    name: row.name,
    kind: row.kind as Kind,
    baseUrl: row.baseUrl,
    maskedKey: formatMask(row.displayPrefix, row.displaySuffix),
    status: row.status as UpstreamStatus,
    statusChangedAt: row.statusChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    provider: row.provider,
    priority: row.priority,
    weight: row.weight,
    maxConcurrency: row.maxConcurrency,
    rpmLimit: row.rpmLimit,
    enabled: row.enabled,
    note: row.note,
    cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
    consecutiveFailures: row.consecutiveFailures,
    lastError: row.lastError,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    ...(extra?.inFlight !== undefined ? { inFlight: extra.inFlight } : {}),
    ...(extra?.todayCalls !== undefined ? { todayCalls: extra.todayCalls } : {}),
    ...(extra?.todayCostMicros !== undefined ? { todayCostMicros: extra.todayCostMicros } : {}),
  };
}

/** v3.4：上游账号的调度参数（创建 / 修改共用）。 */
export interface UpstreamPoolFields {
  provider?: string;
  priority?: number;
  weight?: number;
  maxConcurrency?: number | null;
  rpmLimit?: number | null;
  enabled?: boolean;
  note?: string | null;
}

@Injectable()
export class UpstreamService {
  private readonly log: Logger;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(UPSTREAM_PROBE) private readonly probe: UpstreamProbe,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'model_access' });
  }

  /** 账号列表（v3.4 带今日调用数、今日成本；inFlight 由调用方从调度器取）。 */
  async list(inFlight?: (upstreamId: string) => number): Promise<Upstream[]> {
    const rows = await this.database.db
      .select()
      .from(upstreams)
      .orderBy(asc(upstreams.priority), asc(upstreams.createdAt), asc(upstreams.id));
    const today = await this.todayStats();
    return rows.map((row) =>
      toUpstream(row, {
        ...(inFlight ? { inFlight: inFlight(row.id) } : {}),
        todayCalls: today.get(row.id)?.calls ?? 0,
        todayCostMicros: today.get(row.id)?.cost ?? 0,
      }),
    );
  }

  /** 今天（北京时间）各账号的调用次数与成本。 */
  private async todayStats(): Promise<Map<string, { calls: number; cost: number }>> {
    const { from } = beijingDayRange(beijingDay(this.clock.now()));
    const rows = await this.database.db
      .select({
        upstreamId: usageRecords.upstreamId,
        calls: sql<string>`count(*)`,
        cost: sql<string>`coalesce(sum(${usageRecords.costMicros} + ${usageRecords.absorbedCostMicros}), 0)`,
      })
      .from(usageRecords)
      .where(and(gte(usageRecords.createdAt, from), ne(usageRecords.status, 'pending')))
      .groupBy(usageRecords.upstreamId);
    return new Map(
      rows.map((r) => [r.upstreamId, { calls: Number(r.calls), cost: Number(r.cost) }]),
    );
  }

  async create(
    adminId: string,
    input: {
      name: string;
      kind: Kind;
      baseUrl: string;
      apiKey: string;
      saveOnTestFailure?: boolean;
    } & UpstreamPoolFields,
  ): Promise<Upstream> {
    const baseUrl = this.checkBaseUrl(input.baseUrl);
    const apiKey = this.checkKey(input.apiKey);
    const failure = await this.runProbe(input.kind, baseUrl, apiKey);
    if (failure && !input.saveOnTestFailure) {
      await this.audit.record({
        module: 'model_access',
        action: 'upstream.test_failed',
        actorType: 'admin',
        actorId: adminId,
        targetType: 'upstream',
        details: { stage: 'create', name: input.name, reason: failure },
      });
      throw testFailed(failure);
    }
    const id = newId();
    const now = this.clock.now();
    const mask = maskParts(apiKey);
    const initial = statusAfterTest(failure);
    return this.database.transaction(async (tx) => {
      const sealed = await this.crypto.seal(PLATFORM_KEY_OWNER, upstreamAad(id), apiKey, tx);
      const [row] = await tx.db
        .insert(upstreams)
        .values({
          id,
          name: input.name,
          kind: input.kind,
          baseUrl,
          secretCiphertext: sealed,
          displayPrefix: mask.prefix,
          displaySuffix: mask.suffix,
          status: initial,
          statusChangedAt: now,
          lastTestedAt: now,
          createdAt: now,
          updatedAt: now,
          provider: input.provider ?? input.kind,
          priority: input.priority ?? 1,
          weight: input.weight ?? 100,
          maxConcurrency: input.maxConcurrency ?? null,
          rpmLimit: input.rpmLimit ?? null,
          enabled: input.enabled ?? true,
          note: input.note ?? null,
          lastError: failure,
        })
        .returning();
      await tx.db.insert(upstreamStatus).values({
        id: newId(),
        upstreamId: id,
        fromStatus: null,
        toStatus: initial,
        source: 'created',
        failure,
        changedAt: now,
      });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'upstream.created',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'upstream',
          targetId: id,
          details: { name: input.name, kind: input.kind, baseUrl },
        },
        tx,
      );
      return toUpstream(must(row));
    });
  }

  /** v3.4：修改账号（不含密钥）。改地址会清空暂停与连续失败。 */
  async update(
    adminId: string,
    upstreamId: string,
    patch: UpstreamPoolFields & { name?: string; baseUrl?: string },
  ): Promise<Upstream> {
    const baseUrl = patch.baseUrl !== undefined ? this.checkBaseUrl(patch.baseUrl) : undefined;
    return this.database.transaction(async (tx) => {
      const before = await this.lock(tx, upstreamId);
      const set: Partial<UpstreamRow> = { updatedAt: this.clock.now() };
      if (patch.name !== undefined) set.name = patch.name;
      if (baseUrl !== undefined && baseUrl !== before.baseUrl) {
        set.baseUrl = baseUrl;
        set.cooldownUntil = null;
        set.consecutiveFailures = 0;
      }
      if (patch.provider !== undefined) set.provider = patch.provider;
      if (patch.priority !== undefined) set.priority = patch.priority;
      if (patch.weight !== undefined) set.weight = patch.weight;
      if (patch.maxConcurrency !== undefined) set.maxConcurrency = patch.maxConcurrency;
      if (patch.rpmLimit !== undefined) set.rpmLimit = patch.rpmLimit;
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      if (patch.note !== undefined) set.note = patch.note;
      await tx.db.update(upstreams).set(set).where(eq(upstreams.id, upstreamId));
      await this.audit.record(
        {
          module: 'model_access',
          action: 'upstream.updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'upstream',
          targetId: upstreamId,
          details: { ...patch, ...(baseUrl !== undefined ? { baseUrl } : {}) },
        },
        tx,
      );
      if (patch.enabled !== undefined && patch.enabled !== before.enabled)
        await this.publishModelAvailability(tx, upstreamId, patch.enabled);
      return this.getIn(tx, upstreamId);
    });
  }

  /** v3.4：批量测试 / 启用 / 停用。 */
  async batch(
    adminId: string,
    upstreamIds: string[],
    action: 'test' | 'enable' | 'disable',
  ): Promise<Upstream[]> {
    const out: Upstream[] = [];
    for (const id of [...new Set(upstreamIds)]) {
      out.push(
        action === 'test'
          ? await this.test(adminId, id)
          : await this.update(adminId, id, { enabled: action === 'enable' }),
      );
    }
    return out;
  }

  /** v3.4：从账号拉取可用模型列表；失败 422 upstream_test_failed。 */
  async models(upstreamId: string): Promise<{ items: Array<{ id: string }> }> {
    const row = await this.get(upstreamId);
    const result = await this.withApiKey(upstreamId, (apiKey) =>
      fetchUpstreamModels({ baseUrl: row.baseUrl, apiKey }),
    );
    if (!result.ok) throw testFailed(result.reason);
    return { items: result.ids.map((id) => ({ id })) };
  }

  /**
   * 账号可用性翻转时，对「经它路由、且没有别的正常账号」的启用模型发 model_status_changed
   * （一个模型有多个账号时，单个账号故障不算模型不可用）。
   */
  private async publishModelAvailability(tx: DbTx, upstreamId: string, isUp: boolean) {
    const routed = await tx.db
      .select({ modelKey: modelRoutes.modelKey })
      .from(modelRoutes)
      .innerJoin(modelCatalog, eq(modelCatalog.modelKey, modelRoutes.modelKey))
      .where(
        and(
          eq(modelRoutes.upstreamId, upstreamId),
          eq(modelRoutes.enabled, true),
          eq(modelCatalog.enabled, true),
        ),
      );
    const primary = await tx.db
      .select({ modelKey: modelCatalog.modelKey })
      .from(modelCatalog)
      .where(and(eq(modelCatalog.upstreamId, upstreamId), eq(modelCatalog.enabled, true)));
    const keys = [...new Set([...routed, ...primary].map((r) => r.modelKey))];
    if (keys.length === 0) return;
    const others = await tx.db
      .select({ modelKey: modelRoutes.modelKey })
      .from(modelRoutes)
      .innerJoin(upstreams, eq(upstreams.id, modelRoutes.upstreamId))
      .where(
        and(
          inArray(modelRoutes.modelKey, keys),
          ne(modelRoutes.upstreamId, upstreamId),
          eq(modelRoutes.enabled, true),
          eq(upstreams.enabled, true),
          eq(upstreams.status, 'active'),
        ),
      );
    const covered = new Set(others.map((o) => o.modelKey));
    for (const modelKey of keys) {
      if (covered.has(modelKey)) continue;
      await this.outbox.publish(tx, 'model_access.model_status_changed', 'model_access', {
        modelKey,
        available: isUp,
        reason: isUp ? 'recovered' : 'provider_unavailable',
      });
    }
  }

  /** 更换密钥：先用新密钥测试，成功才替换；失败 422，旧密钥不变。 */
  async rotateKey(adminId: string, upstreamId: string, rawKey: string): Promise<Upstream> {
    const current = await this.get(upstreamId);
    const apiKey = this.checkKey(rawKey);
    const failure = await this.runProbe(current.kind as Kind, current.baseUrl, apiKey);
    if (failure) {
      await this.audit.record({
        module: 'model_access',
        action: 'upstream.test_failed',
        actorType: 'admin',
        actorId: adminId,
        targetType: 'upstream',
        targetId: upstreamId,
        details: { stage: 'rotate_key', reason: failure },
      });
      throw testFailed(failure);
    }
    const mask = maskParts(apiKey);
    return this.database.transaction(async (tx) => {
      const row = await this.lock(tx, upstreamId);
      const now = this.clock.now();
      const sealed = await this.crypto.seal(
        PLATFORM_KEY_OWNER,
        upstreamAad(upstreamId),
        apiKey,
        tx,
      );
      await tx.db
        .update(upstreams)
        .set({
          secretCiphertext: sealed,
          displayPrefix: mask.prefix,
          displaySuffix: mask.suffix,
          keyRotatedAt: now,
          lastTestedAt: now,
          updatedAt: now,
          cooldownUntil: null,
          consecutiveFailures: 0,
          lastError: null,
        })
        .where(eq(upstreams.id, upstreamId));
      await this.applyStatus(tx, row, 'active', 'key_rotated', null);
      await this.audit.record(
        {
          module: 'model_access',
          action: 'upstream.key_rotated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'upstream',
          targetId: upstreamId,
          details: {
            oldMask: formatMask(row.displayPrefix, row.displaySuffix),
            newMask: formatMask(mask.prefix, mask.suffix),
          },
        },
        tx,
      );
      return this.getIn(tx, upstreamId);
    });
  }

  /** 手动连通测试：用已保存的密钥测试并刷新状态（失败也返回 200 + 新状态）。 */
  async test(adminId: string, upstreamId: string): Promise<Upstream> {
    const row = await this.get(upstreamId);
    const failure = await this.withApiKey(upstreamId, (apiKey) =>
      this.runProbe(row.kind as Kind, row.baseUrl, apiKey),
    );
    return this.database.transaction(async (tx) => {
      const locked = await this.lock(tx, upstreamId);
      await tx.db
        .update(upstreams)
        .set({
          lastTestedAt: this.clock.now(),
          // 手动测试通过 = 管理员确认恢复：清空暂停与连续失败
          ...(failure ? { lastError: failure } : { cooldownUntil: null, consecutiveFailures: 0 }),
        })
        .where(eq(upstreams.id, upstreamId));
      await this.applyStatus(tx, locked, statusAfterTest(failure), 'admin_test', failure);
      await this.audit.record(
        {
          module: 'model_access',
          action: 'upstream.tested',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'upstream',
          targetId: upstreamId,
          details: { result: failure ?? 'ok' },
        },
        tx,
      );
      return this.getIn(tx, upstreamId);
    });
  }

  /**
   * 删除上游（10-20 起软删）：仍被任何模型线路引用（启用或停用的路由、模型目录的主上游）时 409，
   * details 带引用它的模型键与名称，提示先换线路。删除后清空密文、停用、记删除时间；
   * 行保留，历史调用记录仍能显示账号名。已删除的账号不再出现在调度、探测、线路选择里。
   */
  async delete(adminId: string, upstreamId: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      const row = await this.lock(tx, upstreamId);
      const routed = await tx.db
        .select({ modelKey: modelRoutes.modelKey })
        .from(modelRoutes)
        .where(eq(modelRoutes.upstreamId, upstreamId));
      const primary = await tx.db
        .select({ modelKey: modelCatalog.modelKey })
        .from(modelCatalog)
        // 3.23：已删除的模型（软删，线路已删）不再挡删除
        .where(and(eq(modelCatalog.upstreamId, upstreamId), isNull(modelCatalog.deletedAt)));
      const keys = [...new Set([...routed, ...primary].map((r) => r.modelKey))].sort();
      if (keys.length > 0) {
        const named = await tx.db
          .select({ modelKey: modelCatalog.modelKey, displayName: modelCatalog.displayName })
          .from(modelCatalog)
          .where(inArray(modelCatalog.modelKey, keys));
        const nameOf = new Map(named.map((n) => [n.modelKey, n.displayName]));
        const modelNames = keys.map((k) => nameOf.get(k) ?? k);
        throw new AppError(
          'conflict',
          `这些模型还在用这个上游账号：${modelNames.join('、')}。请先在「模型」里把它们换到别的线路，再删除`,
          { details: { modelKeys: keys, modelNames } },
        );
      }
      const now = this.clock.now();
      await tx.db
        .update(upstreams)
        .set({
          deletedAt: now,
          enabled: false,
          secretCiphertext: Buffer.alloc(0),
          cooldownUntil: null,
          updatedAt: now,
        })
        .where(eq(upstreams.id, upstreamId));
      await this.audit.record(
        {
          module: 'model_access',
          action: 'upstream.deleted',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'upstream',
          targetId: upstreamId,
          details: { name: row.name, mask: formatMask(row.displayPrefix, row.displaySuffix) },
        },
        tx,
      );
    });
  }

  // ---------- 给网关（D-L0-09）用 ----------

  /**
   * 解密上游密钥并交给 fn 使用（只在发请求那一刻调用）。明文不缓存、不返回给调用方以外的地方；
   * fn 里不要记录密钥。上游不存在时抛 404。
   */
  async withApiKey<T>(upstreamId: string, fn: (apiKey: string) => Promise<T>): Promise<T> {
    const row = await this.get(upstreamId);
    const plain = await this.crypto.open(
      PLATFORM_KEY_OWNER,
      upstreamAad(upstreamId),
      row.secretCiphertext,
    );
    try {
      return await fn(plain.toString('utf8'));
    } finally {
      plain.fill(0);
    }
  }

  /**
   * 网关 / 恢复探测报告上游状态（billing.md 3.1 第 5、6 条）。状态不变时什么都不做。
   * 返回是否发生了变化。
   */
  async reportStatus(
    upstreamId: string,
    status: UpstreamStatus,
    source: 'gateway' | 'probe',
    failure: string | null = null,
  ): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(upstreams)
        .where(eq(upstreams.id, upstreamId))
        .for('update');
      if (!row || row.deletedAt) return false;
      return this.applyStatus(tx, row, status, source, failure);
    });
  }

  async get(upstreamId: string): Promise<UpstreamRow> {
    const [row] = await this.database.db
      .select()
      .from(upstreams)
      .where(eq(upstreams.id, upstreamId));
    if (!row || row.deletedAt) throw new AppError('not_found', '上游不存在');
    return row;
  }

  // ---------- 内部 ----------

  /**
   * 改上游状态（调用方已对上游行加锁）：写状态历史；可用性翻转时，对指向它的每个启用模型发
   * model_access.model_status_changed；写审计、错误日志，并发管理员提醒 platform.admin_alert_raised（billing.md 8.4）。
   */
  private async applyStatus(
    tx: DbTx,
    row: UpstreamRow,
    next: UpstreamStatus,
    source: StatusSource,
    failure: UpstreamTestFailure | string | null,
  ): Promise<boolean> {
    if (row.status === next) return false;
    const now = this.clock.now();
    await tx.db
      .update(upstreams)
      .set({ status: next, statusChangedAt: now, updatedAt: now })
      .where(eq(upstreams.id, row.id));
    await tx.db.insert(upstreamStatus).values({
      id: newId(),
      upstreamId: row.id,
      fromStatus: row.status,
      toStatus: next,
      source,
      failure,
      changedAt: now,
    });
    const wasUp = row.status === 'active';
    const isUp = next === 'active';
    if (wasUp !== isUp && row.enabled) await this.publishModelAvailability(tx, row.id, isUp);
    await this.audit.record(
      {
        module: 'model_access',
        action: 'upstream.status_changed',
        actorType: source === 'gateway' || source === 'probe' ? 'system' : 'admin',
        targetType: 'upstream',
        targetId: row.id,
        details: { from: row.status, to: next, source, failure },
      },
      tx,
    );
    const alert = upstreamAlert(next, wasUp, row.name);
    if (alert) {
      await this.outbox.publish(tx, 'platform.admin_alert_raised', 'model_access', {
        ...alert,
        dedupeKey: `${alert.kind}:${row.id}`,
        refs: { upstreamId: row.id },
      });
    }
    if (!isUp) {
      // quota_exhausted = 总经理需要去供应商处充值（billing.md 3.1 第 5 条）
      this.log.error(
        { upstreamId: row.id, from: row.status, to: next, source, failure },
        '上游状态异常，需要管理员处理',
      );
    } else {
      this.log.info({ upstreamId: row.id, from: row.status, source }, '上游恢复可用');
    }
    return true;
  }

  private async lock(tx: DbTx, upstreamId: string): Promise<UpstreamRow> {
    const [row] = await tx.db
      .select()
      .from(upstreams)
      .where(eq(upstreams.id, upstreamId))
      .for('update');
    if (!row || row.deletedAt) throw new AppError('not_found', '上游不存在');
    return row;
  }

  private async getIn(tx: DbTx, upstreamId: string): Promise<Upstream> {
    const [row] = await tx.db.select().from(upstreams).where(eq(upstreams.id, upstreamId));
    return toUpstream(must(row));
  }

  private async runProbe(
    kind: Kind,
    baseUrl: string,
    apiKey: string,
  ): Promise<UpstreamTestFailure | null> {
    const result = await this.probe.test({ kind, baseUrl, apiKey });
    return result.ok ? null : result.reason;
  }

  private checkKey(raw: string): string {
    const key = normalizeApiKey(raw);
    if (!key) throw new AppError('bad_request', '密钥去除首尾空白后应为 8～512 个字符');
    return key;
  }

  private checkBaseUrl(raw: string): string {
    const url = checkBaseUrl(raw, this.config.nodeEnv === 'production');
    if (!url) {
      throw new AppError(
        'bad_request',
        '接口地址不合法：生产环境必须是 https，且不能带账号密码、查询参数',
      );
    }
    return url;
  }
}

/**
 * 上游状态变化 → 管理员提醒（billing.md 8.4 节，契约 1.3）。载荷只有种类、级别、固定模板说明和上游 ID，
 * 上游展示名是管理员自己起的平台数据，不含用户信息和密钥。恢复只在之前异常时发（info，只进列表）。
 */
export function upstreamAlert(
  next: UpstreamStatus,
  wasUp: boolean,
  name: string,
): Pick<AdminAlertFacts, 'kind' | 'severity' | 'summary'> | null {
  const label = `上游「${name.slice(0, 40)}」`;
  switch (next) {
    case 'quota_exhausted':
      return {
        kind: 'upstream_quota_exhausted',
        severity: 'critical',
        summary: `${label}的平台余额已用完，请到供应商控制台充值`,
      };
    case 'invalid':
      return {
        kind: 'upstream_invalid',
        severity: 'critical',
        summary: `${label}的平台密钥无效或已被作废，请在管理后台更换密钥`,
      };
    case 'unavailable':
      return {
        kind: 'upstream_unavailable',
        severity: 'warning',
        summary: `${label}重试后仍不可用，相关模型暂时不能使用`,
      };
    case 'active':
      return wasUp
        ? null
        : { kind: 'upstream_recovered', severity: 'info', summary: `${label}已恢复可用` };
  }
}

function testFailed(reason: UpstreamTestFailure): AppError {
  return new AppError('upstream_test_failed', '连通测试失败，未保存', { details: { reason } });
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('数据库没有返回写入的行');
  return value;
}
