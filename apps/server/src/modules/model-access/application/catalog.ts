/**
 * 模型目录（billing.md 3.2）：管理员维护（模型键 → 上游 + 上游模型名、能力、标签、默认标记、启用 / 停用），
 * 用户端模型列表（只列启用的），以及给选择 / 状态 / 网关用的查询。
 *
 * 规则：
 * - 无审查（adult_content）模型不能设为任何平台默认（422 model_not_allowed；数据库 CHECK 兜底）；
 * - 默认识图模型必须具备 vision 能力；停用的模型不能是默认；
 * - 每种默认最多一个：设新默认时自动从原默认模型上摘掉（同一事务、审计里记下），
 *   所有目录写入经一把事务级咨询锁串行，避免并发设两个默认；
 * - 改指上游、启用 / 停用都写审计；可用性翻转时发 model_access.model_status_changed。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminCatalogEntry,
  ModelCapability,
  ModelInfo,
  UpstreamStatus,
} from '@weiban/contracts';
import { AdminCatalogEntryWrite } from '@weiban/contracts';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import { hasAdultContent, priceTier, unavailableReason } from '../domain/rules.js';
import { modelCatalog, upstreams } from '../infra/db/schema.js';
import {
  MODEL_ACCESS_CHARGE_QUERY,
  MODEL_PRICE_SOURCE,
  type ChargeQuery,
  type ModelPriceSource,
} from '../tokens.js';
import { ChargeQueryUnavailableError } from './defaults.js';

type CatalogRow = typeof modelCatalog.$inferSelect;
type CatalogWrite = z.infer<typeof AdminCatalogEntryWrite>;
export type DefaultUse = 'chat' | 'background' | 'vision';

/** 一个模型的当前事实：目录条目（可能不存在）+ 所属上游状态（上游可能已删除）。 */
export interface ModelFacts {
  modelKey: string;
  entry: CatalogRow | null;
  upstreamStatus: UpstreamStatus | null;
}

/** 目录写入串行化的咨询锁键（任意固定数字）。 */
const CATALOG_LOCK_KEY = 72_270_008;

export function toAdminEntry(row: CatalogRow): AdminCatalogEntry {
  return {
    modelKey: row.modelKey,
    displayName: row.displayName,
    vendorName: row.vendorName,
    upstreamId: row.upstreamId,
    upstreamModelId: row.upstreamModelId,
    capabilities: row.capabilities as ModelCapability[],
    tags: row.tags,
    leaderboardRank: row.leaderboardRank,
    sortOrder: row.sortOrder,
    defaultFor: row.defaultFor as DefaultUse[],
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(MODEL_PRICE_SOURCE) private readonly prices: ModelPriceSource,
    @Inject(MODEL_ACCESS_CHARGE_QUERY) private readonly charges: ChargeQuery,
  ) {}

  // ---------- 管理后台 ----------

  async adminList(): Promise<AdminCatalogEntry[]> {
    const rows = await this.database.db
      .select()
      .from(modelCatalog)
      .orderBy(asc(modelCatalog.sortOrder), asc(modelCatalog.modelKey));
    return rows.map(toAdminEntry);
  }

  async upsert(adminId: string, pathKey: string, body: CatalogWrite): Promise<AdminCatalogEntry> {
    if (pathKey !== body.modelKey) {
      throw new AppError('bad_request', '路径里的模型键与请求体不一致');
    }
    const capabilities = [...new Set(body.capabilities)];
    const defaultFor = [...new Set(body.defaultFor)];
    const tags = [...new Set(body.tags)];
    if (defaultFor.length > 0 && hasAdultContent(capabilities)) {
      throw new AppError('model_not_allowed', '无审查（允许成人内容）模型不能设为平台默认模型', {
        status: 422,
      });
    }
    if (defaultFor.includes('vision') && !capabilities.includes('vision')) {
      throw new AppError('bad_request', '默认识图模型必须具备识图（vision）能力', { status: 422 });
    }
    if (defaultFor.length > 0 && !body.enabled) {
      throw new AppError('bad_request', '停用的模型不能设为平台默认模型', { status: 422 });
    }

    if (body.enabled) await this.requirePrice(body.modelKey);

    return this.database.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [CATALOG_LOCK_KEY]);
      const [before] = await tx.db
        .select()
        .from(modelCatalog)
        .where(eq(modelCatalog.modelKey, body.modelKey))
        .for('update');
      const upstreamChanged = !before || before.upstreamId !== body.upstreamId;
      const [upstream] = await tx.db
        .select({ status: upstreams.status })
        .from(upstreams)
        .where(eq(upstreams.id, body.upstreamId))
        .for('share');
      if (!upstream && (body.enabled || upstreamChanged)) {
        throw new AppError('bad_request', '指定的上游不存在', { status: 422 });
      }
      const beforeStatus = before ? await this.upstreamStatusOf(tx, before.upstreamId) : null;

      // 每种默认最多一个：从其他模型上摘掉
      const movedFrom: Array<{ modelKey: string; use: string }> = [];
      for (const use of defaultFor) {
        const holders = await tx.db
          .select({ modelKey: modelCatalog.modelKey })
          .from(modelCatalog)
          .where(
            sql`${use}::text = any(${modelCatalog.defaultFor}) and ${modelCatalog.modelKey} <> ${body.modelKey}`,
          );
        for (const h of holders) {
          await tx.db
            .update(modelCatalog)
            .set({ defaultFor: sql`array_remove(${modelCatalog.defaultFor}, ${use}::text)` })
            .where(eq(modelCatalog.modelKey, h.modelKey));
          movedFrom.push({ modelKey: h.modelKey, use });
        }
      }

      const now = this.clock.now();
      const values = {
        modelKey: body.modelKey,
        displayName: body.displayName,
        vendorName: body.vendorName,
        upstreamId: body.upstreamId,
        upstreamModelId: body.upstreamModelId,
        capabilities,
        tags,
        leaderboardRank: body.leaderboardRank,
        sortOrder: body.sortOrder,
        defaultFor,
        enabled: body.enabled,
        updatedAt: now,
      };
      const [row] = before
        ? await tx.db
            .update(modelCatalog)
            .set(values)
            .where(eq(modelCatalog.modelKey, body.modelKey))
            .returning()
        : await tx.db
            .insert(modelCatalog)
            .values({ ...values, createdAt: now })
            .returning();
      if (!row) throw new Error('数据库没有返回写入的行');

      await this.audit.record(
        {
          module: 'model_access',
          action: before ? 'catalog.updated' : 'catalog.created',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'model',
          targetId: body.modelKey,
          details: {
            upstreamId: body.upstreamId,
            upstreamModelId: body.upstreamModelId,
            ...(before && before.upstreamId !== body.upstreamId
              ? { upstreamChangedFrom: before.upstreamId }
              : {}),
            ...(before && before.upstreamModelId !== body.upstreamModelId
              ? { upstreamModelChangedFrom: before.upstreamModelId }
              : {}),
            ...(before && before.enabled !== body.enabled ? { enabledChanged: body.enabled } : {}),
            capabilities,
            defaultFor,
            ...(movedFrom.length > 0 ? { defaultMovedFrom: movedFrom } : {}),
          },
        },
        tx,
      );

      if (before) {
        const wasReason = unavailableReason(before, beforeStatus);
        const isReason = unavailableReason(row, (upstream?.status as UpstreamStatus) ?? null);
        if ((wasReason === null) !== (isReason === null)) {
          await this.outbox.publish(tx, 'model_access.model_status_changed', 'model_access', {
            modelKey: row.modelKey,
            available: isReason === null,
            reason: isReason ?? 'recovered',
          });
        }
      }
      return toAdminEntry(row);
    });
  }

  // ---------- 用户端 ----------

  async listModels(capability?: string): Promise<ModelInfo[]> {
    const rows = await this.database.db
      .select({ entry: modelCatalog, upstreamStatus: upstreams.status })
      .from(modelCatalog)
      .leftJoin(upstreams, eq(upstreams.id, modelCatalog.upstreamId))
      .where(eq(modelCatalog.enabled, true))
      .orderBy(asc(modelCatalog.sortOrder), asc(modelCatalog.modelKey));
    const visible = capability
      ? rows.filter((r) => r.entry.capabilities.includes(capability))
      : rows;
    const prices = await this.prices.textPrices(visible.map((r) => r.entry.modelKey));
    return visible.map(({ entry, upstreamStatus }) => ({
      modelKey: entry.modelKey,
      displayName: entry.displayName,
      vendorName: entry.vendorName,
      priceTier: priceTier(prices.get(entry.modelKey)),
      capabilities: entry.capabilities as ModelCapability[],
      tags: entry.tags,
      leaderboardRank: entry.leaderboardRank,
      available:
        unavailableReason(entry, (upstreamStatus as UpstreamStatus | null) ?? null) === null,
    }));
  }

  // ---------- 查询（选择、状态、网关） ----------

  /** 一批模型键的当前事实（不存在的键 entry 为 null）。 */
  async facts(modelKeys: readonly string[]): Promise<Map<string, ModelFacts>> {
    const keys = [...new Set(modelKeys)];
    const out = new Map<string, ModelFacts>();
    if (keys.length === 0) return out;
    const rows = await this.database.db
      .select({ entry: modelCatalog, upstreamStatus: upstreams.status })
      .from(modelCatalog)
      .leftJoin(upstreams, eq(upstreams.id, modelCatalog.upstreamId))
      .where(inArray(modelCatalog.modelKey, keys));
    for (const key of keys) out.set(key, { modelKey: key, entry: null, upstreamStatus: null });
    for (const r of rows) {
      out.set(r.entry.modelKey, {
        modelKey: r.entry.modelKey,
        entry: r.entry,
        upstreamStatus: (r.upstreamStatus as UpstreamStatus | null) ?? null,
      });
    }
    return out;
  }

  async fact(modelKey: string): Promise<ModelFacts> {
    const map = await this.facts([modelKey]);
    return map.get(modelKey) ?? { modelKey, entry: null, upstreamStatus: null };
  }

  /** 平台默认模型（每种最多一个；只算启用的）。 */
  async defaultModel(use: DefaultUse): Promise<ModelFacts | null> {
    const rows = await this.database.db
      .select({ entry: modelCatalog, upstreamStatus: upstreams.status })
      .from(modelCatalog)
      .leftJoin(upstreams, eq(upstreams.id, modelCatalog.upstreamId))
      .where(sql`${use}::text = any(${modelCatalog.defaultFor}) and ${modelCatalog.enabled}`)
      .orderBy(asc(modelCatalog.modelKey))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      modelKey: r.entry.modelKey,
      entry: r.entry,
      upstreamStatus: (r.upstreamStatus as UpstreamStatus | null) ?? null,
    };
  }

  /**
   * 契约 1.3：保存为启用时，当前生效价目表必须有这个模型的价格，否则 422 model_unavailable
   * （billing.md 4.1、ADR-0017 第 1 条）。计费查询端口未接入时 503，不放行。
   */
  private async requirePrice(modelKey: string): Promise<void> {
    let priced: string[];
    try {
      priced = await this.charges.listActivePricedModelKeys();
    } catch (error) {
      if (error instanceof ChargeQueryUnavailableError) {
        throw new AppError('service_unavailable', '暂时无法查询价目表，模型未启用，请稍后再试');
      }
      throw error;
    }
    if (!priced.includes(modelKey)) {
      throw new AppError(
        'model_unavailable',
        '当前生效的价目表里没有这个模型的价格：请先发布含该模型价格的价目表，再启用模型',
        { status: 422 },
      );
    }
  }

  private async upstreamStatusOf(tx: DbTx, upstreamId: string): Promise<UpstreamStatus | null> {
    const [u] = await tx.db
      .select({ status: upstreams.status })
      .from(upstreams)
      .where(eq(upstreams.id, upstreamId));
    return (u?.status as UpstreamStatus | undefined) ?? null;
  }
}
