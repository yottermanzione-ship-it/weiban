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
import { and, asc, eq } from 'drizzle-orm';
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
import { modelCatalog, upstreamStatus, upstreams } from '../infra/db/schema.js';
import { UPSTREAM_PROBE, type UpstreamProbe } from '../tokens.js';

type UpstreamRow = typeof upstreams.$inferSelect;
type Kind = z.infer<typeof UpstreamKind>;

/** 上游状态变化的来源（记在 upstream_status.source）。 */
export type StatusSource = 'created' | 'admin_test' | 'key_rotated' | 'gateway' | 'probe';

export function toUpstream(row: UpstreamRow): Upstream {
  return {
    upstreamId: row.id,
    name: row.name,
    kind: row.kind as Kind,
    baseUrl: row.baseUrl,
    maskedKey: formatMask(row.displayPrefix, row.displaySuffix),
    status: row.status as UpstreamStatus,
    statusChangedAt: row.statusChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
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

  async list(): Promise<Upstream[]> {
    const rows = await this.database.db
      .select()
      .from(upstreams)
      .orderBy(asc(upstreams.createdAt), asc(upstreams.id));
    return rows.map(toUpstream);
  }

  async create(
    adminId: string,
    input: { name: string; kind: Kind; baseUrl: string; apiKey: string },
  ): Promise<Upstream> {
    const baseUrl = this.checkBaseUrl(input.baseUrl);
    const apiKey = this.checkKey(input.apiKey);
    const failure = await this.runProbe(input.kind, baseUrl, apiKey);
    if (failure) {
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
          status: 'active',
          statusChangedAt: now,
          lastTestedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx.db.insert(upstreamStatus).values({
        id: newId(),
        upstreamId: id,
        fromStatus: null,
        toStatus: 'active',
        source: 'created',
        failure: null,
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
        .set({ lastTestedAt: this.clock.now() })
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

  /** 删除上游：仍有启用的模型指向它时 409。密文随行删除。 */
  async delete(adminId: string, upstreamId: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      const row = await this.lock(tx, upstreamId);
      const enabled = await tx.db
        .select({ modelKey: modelCatalog.modelKey })
        .from(modelCatalog)
        .where(and(eq(modelCatalog.upstreamId, upstreamId), eq(modelCatalog.enabled, true)));
      if (enabled.length > 0) {
        throw new AppError('conflict', '还有启用的模型使用这个上游，请先停用或改指到别的上游', {
          details: { modelKeys: enabled.map((e) => e.modelKey) },
        });
      }
      await tx.db.delete(upstreams).where(eq(upstreams.id, upstreamId));
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
      if (!row) return false;
      return this.applyStatus(tx, row, status, source, failure);
    });
  }

  async get(upstreamId: string): Promise<UpstreamRow> {
    const [row] = await this.database.db
      .select()
      .from(upstreams)
      .where(eq(upstreams.id, upstreamId));
    if (!row) throw new AppError('not_found', '上游不存在');
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
    if (wasUp !== isUp) {
      const models = await tx.db
        .select({ modelKey: modelCatalog.modelKey })
        .from(modelCatalog)
        .where(and(eq(modelCatalog.upstreamId, row.id), eq(modelCatalog.enabled, true)));
      for (const { modelKey } of models) {
        await this.outbox.publish(tx, 'model_access.model_status_changed', 'model_access', {
          modelKey,
          available: isUp,
          reason: isUp ? 'recovered' : 'provider_unavailable',
        });
      }
    }
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
    if (!row) throw new AppError('not_found', '上游不存在');
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
