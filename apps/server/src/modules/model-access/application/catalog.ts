/**
 * 模型目录（billing.md 3.2）：管理员维护（模型键 → 上游 + 上游模型名、能力、标签、默认标记、启用 / 停用），
 * 用户端模型列表（只列启用的），以及给选择 / 状态 / 网关用的查询。
 *
 * 规则：
 * - 无审查模型不能设为生成默认；仅专用 adult_check 例外，调用时仍须成人资格与OpenRouter路由。
 * - 默认识图模型必须具备 vision 能力；停用的模型不能是默认；
 * - 每种默认最多一个：设新默认时自动从原默认模型上摘掉（同一事务、审计里记下），
 *   所有目录写入经一把事务级咨询锁串行，避免并发设两个默认；
 * - 改指上游、启用 / 停用都写审计；可用性翻转时发 model_access.model_status_changed。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  AdminCatalogEntry,
  ModelCapability,
  ModelInfo,
  ModelRoute,
  SystemMessageMode,
  UpstreamStatus,
} from '@weiban/contracts';
import {
  AdminCatalogEntryWrite,
  ModelLeaderboardSource,
  RouteBillingBounds,
} from '@weiban/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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
import {
  hasAdultContent,
  priceTier,
  standardReplyMicros,
  unavailableReason,
} from '../domain/rules.js';
import {
  modelCatalog,
  modelRoutes,
  upstreams,
  selections,
  modelAccessSettings,
} from '../infra/db/schema.js';
import {
  MODEL_ACCESS_CHARGE_QUERY,
  MODEL_PRICE_SOURCE,
  type ChargeQuery,
  type ModelPriceSource,
} from '../tokens.js';
import { DisplayPricingService } from './display-pricing.js';
import { ChargeQueryUnavailableError } from './defaults.js';

type CatalogRow = typeof modelCatalog.$inferSelect;
type CatalogWrite = z.infer<typeof AdminCatalogEntryWrite>;
export type DefaultUse =
  | 'chat'
  | 'background'
  | 'vision'
  | 'planner'
  | 'adult_check'
  | 'speech_synthesis'
  | 'speech_recognition'
  | 'image_generation'
  | 'web_search';
/** 模型故障提醒只关心这三类默认（ModelNotificationReadPort.previousDefaultFor）。 */
const NOTIFY_USES = ['chat', 'background', 'vision'] as const;
type NotifyUse = (typeof NOTIFY_USES)[number];
const isNotifyUse = (u: string): u is NotifyUse => (NOTIFY_USES as readonly string[]).includes(u);

/** 一个模型的当前事实：目录条目（可能不存在）+ 所属上游状态（上游可能已删除）。 */
export interface ModelFacts {
  modelKey: string;
  entry: CatalogRow | null;
  upstreamStatus: UpstreamStatus | null;
  upstreamBaseUrl?: string | null;
}

/** 目录写入串行化的咨询锁键（任意固定数字）。 */
export const CATALOG_LOCK_KEY = 72_270_008;

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
    systemMessageMode: row.systemMessageMode as SystemMessageMode,
    billingBounds: row.billingBounds,
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
    @Optional() @Inject(DisplayPricingService) private readonly display?: DisplayPricingService,
  ) {}

  // ---------- 管理后台 ----------
  async leaderboardSource() {
    const [row] = await this.database.db
      .select()
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, 'leaderboard_source'));
    const source = ModelLeaderboardSource.safeParse(row?.value);
    return source.success ? source.data : null;
  }
  async setLeaderboardSource(operatorUserId: string, input: unknown) {
    const source = ModelLeaderboardSource.parse(input);
    await this.database.transaction(async (tx) => {
      await tx.db
        .insert(modelAccessSettings)
        .values({
          key: 'leaderboard_source',
          value: source,
          updatedAt: this.clock.now(),
          updatedBy: operatorUserId,
        })
        .onConflictDoUpdate({
          target: modelAccessSettings.key,
          set: { value: source, updatedAt: this.clock.now(), updatedBy: operatorUserId },
        });
      await this.audit.record(
        {
          module: 'model-access',
          action: 'leaderboard_source.updated',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'model_settings',
          targetId: null,
        },
        tx,
      );
    });
    return source;
  }
  async leaderboardInfo() {
    const source = await this.leaderboardSource();
    const popular = await this.database.db
      .select({ modelKey: selections.chatModelKey, users: sql<number>`cast(count(*) as integer)` })
      .from(selections)
      .where(sql`${selections.chatModelKey} IS NOT NULL`)
      .groupBy(selections.chatModelKey);
    return {
      source,
      popular: popular.filter((r): r is { modelKey: string; users: number } => r.modelKey !== null),
    };
  }

  async adminList(): Promise<AdminCatalogEntry[]> {
    const rows = await this.database.db
      .select()
      .from(modelCatalog)
      .orderBy(asc(modelCatalog.sortOrder), asc(modelCatalog.modelKey));
    return rows.map(toAdminEntry);
  }

  async upsert(adminId: string, pathKey: string, body: CatalogWrite): Promise<AdminCatalogEntry> {
    this.validateBillingBounds(body.billingBounds);
    if (pathKey !== body.modelKey) {
      throw new AppError('bad_request', '路径里的模型键与请求体不一致');
    }
    const capabilities = [...new Set(body.capabilities)];
    const defaultFor = [...new Set(body.defaultFor)];
    const tags = [...new Set(body.tags)];
    if (defaultFor.some((use) => use !== 'adult_check') && hasAdultContent(capabilities)) {
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
    // v5（model-routing-ecology 块 A-4）：平台默认聊天模型不能识图时，必须已有默认识图模型兜底，
    // 否则用户发图会直接失败（resolver 不再静默改用其他模型以外的路径）。
    if (
      defaultFor.includes('chat') &&
      !capabilities.includes('vision') &&
      !(await this.defaultModel('vision')) &&
      (await this.defaultModel('chat'))?.modelKey !== body.modelKey
    ) {
      throw new AppError(
        'bad_request',
        '这个模型不能识图，且平台还没有默认识图模型：请先设置默认识图模型，或选能识图的模型做聊天默认',
        { status: 422 },
      );
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
        // v3.6：不传 = 保持原值（旧后台页面不认识这个字段）
        systemMessageMode: body.systemMessageMode ?? before?.systemMessageMode ?? 'multi',
        billingBounds:
          body.billingBounds !== undefined
            ? body.billingBounds
            : before?.upstreamId === body.upstreamId &&
                before.upstreamModelId === body.upstreamModelId
              ? before.billingBounds
              : null,
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
      if (upstream)
        await this.syncPrimaryRoute(
          tx,
          row.modelKey,
          row.upstreamId,
          row.upstreamModelId,
          body.billingBounds,
        );

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
            ...(before.defaultFor.some(isNotifyUse)
              ? { previousDefaultFor: before.defaultFor.filter(isNotifyUse) }
              : {}),
          });
        }
      }
      if (
        defaultFor.includes('adult_check') &&
        (!before?.defaultFor.includes('adult_check') ||
          upstreamChanged ||
          before.upstreamModelId !== row.upstreamModelId)
      ) {
        await this.outbox.publish(tx, 'model_access.adult_checker_configured', 'model_access', {
          modelKey: row.modelKey,
        });
      }
      return toAdminEntry(row);
    });
  }

  // ---------- 用户端 ----------

  async listModels(capability?: string): Promise<ModelInfo[]> {
    const rows = await this.database.db
      .select({
        entry: modelCatalog,
        upstreamStatus: upstreams.status,
      })
      .from(modelCatalog)
      .leftJoin(upstreams, eq(upstreams.id, modelCatalog.upstreamId))
      .where(eq(modelCatalog.enabled, true))
      .orderBy(asc(modelCatalog.sortOrder), asc(modelCatalog.modelKey));
    const visible0 = capability
      ? rows.filter((r) => r.entry.capabilities.includes(capability))
      : rows;
    const routed = await this.routeStatus(visible0.map((r) => r.entry.modelKey));
    const visible = visible0.map((r) => ({
      ...r,
      upstreamStatus: routed.get(r.entry.modelKey) ?? r.upstreamStatus,
    }));
    const prices = await this.prices.textPrices(visible.map((r) => r.entry.modelKey));
    // 3.17：约每条积分按最近 7 天平均实扣（不足时按默认假设）+ 展示倍率；未装配时退回 v3.3 标准回复估算
    const display = await this.display?.forModels(
      visible.map((r) => r.entry.modelKey),
      prices,
    );
    const perReply = (key: string) => {
      const d = display?.get(key);
      if (d) return d.pointsPerReply;
      const p = prices.get(key);
      return p ? Math.round(standardReplyMicros(p) / 100) / 100 : null;
    };
    return visible.map(({ entry, upstreamStatus }) => ({
      modelKey: entry.modelKey,
      displayName: entry.displayName,
      vendorName: entry.vendorName,
      priceTier: priceTier(prices.get(entry.modelKey)),
      pointsPerReply: perReply(entry.modelKey),
      ...(display?.get(entry.modelKey)
        ? {
            pointsPerReplyBasis: display.get(entry.modelKey)!.pointsPerReplyBasis,
            displayMultiplier: display.get(entry.modelKey)!.displayMultiplier,
          }
        : {}),
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
      .select({
        entry: modelCatalog,
        upstreamStatus: upstreams.status,
        upstreamBaseUrl: upstreams.baseUrl,
      })
      .from(modelCatalog)
      .leftJoin(upstreams, eq(upstreams.id, modelCatalog.upstreamId))
      .where(inArray(modelCatalog.modelKey, keys));
    for (const key of keys) out.set(key, { modelKey: key, entry: null, upstreamStatus: null });
    const routed = await this.routeStatus(rows.map((r) => r.entry.modelKey));
    for (const r of rows) {
      out.set(r.entry.modelKey, {
        modelKey: r.entry.modelKey,
        entry: r.entry,
        upstreamStatus:
          routed.get(r.entry.modelKey) ?? (r.upstreamStatus as UpstreamStatus | null) ?? null,
        upstreamBaseUrl: r.upstreamBaseUrl,
      });
    }
    return out;
  }

  // ---------- v3.4 模型路由（一个模型 → 多个上游账号） ----------

  /**
   * 按路由算模型可用性：有任一启用路由指向「启用且状态正常」的账号 → active，否则 unavailable。
   * 没有路由的模型不在结果里（调用方沿用主上游状态）。暂停（cooldown）是短暂的，不算模型不可用。
   */
  async routeStatus(modelKeys: readonly string[]): Promise<Map<string, UpstreamStatus>> {
    const keys = [...new Set(modelKeys)];
    const out = new Map<string, UpstreamStatus>();
    if (keys.length === 0) return out;
    const rows = await this.database.db
      .select({
        modelKey: modelRoutes.modelKey,
        up: sql<boolean>`bool_or(${modelRoutes.enabled} and ${upstreams.enabled} and ${upstreams.status} = 'active')`,
      })
      .from(modelRoutes)
      .innerJoin(upstreams, eq(upstreams.id, modelRoutes.upstreamId))
      .where(inArray(modelRoutes.modelKey, keys))
      .groupBy(modelRoutes.modelKey);
    for (const r of rows) out.set(r.modelKey, r.up ? 'active' : 'unavailable');
    return out;
  }

  /** 一批模型的路由（按优先级升序、权重降序）。 */
  async routes(modelKeys: readonly string[]): Promise<Map<string, ModelRoute[]>> {
    const keys = [...new Set(modelKeys)];
    const out = new Map<string, ModelRoute[]>();
    if (keys.length === 0) return out;
    const rows = await this.database.db
      .select()
      .from(modelRoutes)
      .where(inArray(modelRoutes.modelKey, keys))
      .orderBy(asc(modelRoutes.priority), sql`${modelRoutes.weight} desc`);
    for (const r of rows) {
      const list = out.get(r.modelKey) ?? [];
      list.push({
        upstreamId: r.upstreamId,
        upstreamModelId: r.upstreamModelId,
        billingBounds: r.billingBounds,
        priority: r.priority,
        weight: r.weight,
        enabled: r.enabled,
      });
      out.set(r.modelKey, list);
    }
    return out;
  }

  /** 整体替换某模型的路由（后台「模型」向导）。账号必须存在、不能重复。 */
  async replaceRoutes(adminId: string, modelKey: string, routes: ModelRoute[]): Promise<void> {
    for (const route of routes) this.validateBillingBounds(route.billingBounds);
    const ids = routes.map((r) => r.upstreamId);
    if (new Set(ids).size !== ids.length) {
      throw new AppError('bad_request', '同一个上游账号在路由里出现了两次', { status: 422 });
    }
    await this.database.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [CATALOG_LOCK_KEY]);
      const found = await tx.db
        .select({ id: upstreams.id })
        .from(upstreams)
        .where(inArray(upstreams.id, ids));
      if (found.length !== ids.length) {
        throw new AppError('bad_request', '路由里有不存在的上游账号', { status: 422 });
      }
      const beforeRoutes = await tx.db
        .select()
        .from(modelRoutes)
        .where(eq(modelRoutes.modelKey, modelKey));
      const now = this.clock.now();
      await tx.db.delete(modelRoutes).where(eq(modelRoutes.modelKey, modelKey));
      await tx.db.insert(modelRoutes).values(
        routes.map((r) => ({
          modelKey,
          upstreamId: r.upstreamId,
          upstreamModelId: r.upstreamModelId,
          billingBounds:
            r.billingBounds !== undefined
              ? r.billingBounds
              : (beforeRoutes.find(
                  (old) =>
                    old.upstreamId === r.upstreamId && old.upstreamModelId === r.upstreamModelId,
                )?.billingBounds ?? null),
          priority: r.priority,
          weight: r.weight,
          enabled: r.enabled,
          createdAt: now,
          updatedAt: now,
        })),
      );
      await this.audit.record(
        {
          module: 'model_access',
          action: 'catalog.routes_replaced',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'model',
          targetId: modelKey,
          details: { routes },
        },
        tx,
      );
    });
  }

  validateBillingBounds(bounds: RouteBillingBounds | null | undefined): void {
    if (bounds == null) return;
    const parsed = RouteBillingBounds.safeParse(bounds);
    if (!parsed.success || Date.parse(parsed.data.checkedAt) > this.clock.nowMs())
      throw new AppError(
        'bad_request',
        '计费上限格式不正确或核准时间在服务器未来，请核实后再保存',
        { status: 422 },
      );
  }

  /**
   * 旧接口（upsertCatalogEntry）保存后保证主路由存在：模型只有 0～1 条路由时替换为这一条；
   * 已有多条时更新 / 补上这个账号（优先级取现有最小值）。
   */
  private async syncPrimaryRoute(
    tx: DbTx,
    modelKey: string,
    upstreamId: string,
    upstreamModelId: string,
    billingBounds?: import('@weiban/contracts').RouteBillingBounds | null,
  ): Promise<void> {
    const existing = await tx.db
      .select()
      .from(modelRoutes)
      .where(eq(modelRoutes.modelKey, modelKey));
    const now = this.clock.now();
    if (existing.length <= 1) {
      const only = existing[0];
      if (only && only.upstreamId === upstreamId && only.upstreamModelId === upstreamModelId) {
        if (billingBounds !== undefined)
          await tx.db
            .update(modelRoutes)
            .set({ billingBounds, updatedAt: now })
            .where(and(eq(modelRoutes.modelKey, modelKey), eq(modelRoutes.upstreamId, upstreamId)));
        return;
      }
      await tx.db.delete(modelRoutes).where(eq(modelRoutes.modelKey, modelKey));
      await tx.db.insert(modelRoutes).values({
        modelKey,
        upstreamId,
        upstreamModelId,
        billingBounds: billingBounds ?? null,
        priority: only?.priority ?? 1,
        weight: only?.weight ?? 100,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }
    const mine = existing.find((r) => r.upstreamId === upstreamId);
    if (mine) {
      if (mine.upstreamModelId !== upstreamModelId || billingBounds !== undefined)
        await tx.db
          .update(modelRoutes)
          .set({ upstreamModelId, updatedAt: now, billingBounds: billingBounds ?? null })
          .where(and(eq(modelRoutes.modelKey, modelKey), eq(modelRoutes.upstreamId, upstreamId)));
      return;
    }
    await tx.db.insert(modelRoutes).values({
      modelKey,
      upstreamId,
      upstreamModelId,
      priority: Math.min(...existing.map((r) => r.priority)),
      weight: 100,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  async fact(modelKey: string): Promise<ModelFacts> {
    const map = await this.facts([modelKey]);
    return map.get(modelKey) ?? { modelKey, entry: null, upstreamStatus: null };
  }

  /** 平台默认模型（每种最多一个；只算启用的）。 */
  async defaultModel(use: DefaultUse): Promise<ModelFacts | null> {
    const rows = await this.database.db
      .select({
        entry: modelCatalog,
        upstreamStatus: upstreams.status,
        upstreamBaseUrl: upstreams.baseUrl,
      })
      .from(modelCatalog)
      .leftJoin(upstreams, eq(upstreams.id, modelCatalog.upstreamId))
      .where(sql`${use}::text = any(${modelCatalog.defaultFor}) and ${modelCatalog.enabled}`)
      .orderBy(asc(modelCatalog.modelKey))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const routed = await this.routeStatus([r.entry.modelKey]);
    return {
      modelKey: r.entry.modelKey,
      entry: r.entry,
      upstreamStatus:
        routed.get(r.entry.modelKey) ?? (r.upstreamStatus as UpstreamStatus | null) ?? null,
      upstreamBaseUrl: r.upstreamBaseUrl,
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
