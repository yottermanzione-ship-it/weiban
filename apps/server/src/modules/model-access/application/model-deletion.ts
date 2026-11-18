import { createHash } from 'node:crypto';
/**
 * 3.23：删除模型（软删，可批量）。
 *
 * 做法：目录行保留，model_key 改成「原键#deleted:<随机>」腾出原键（同键可以重新添加），原键存 original_model_key、
 * 记删除时间、恒为停用。所有按模型键查目录的地方（网关、报价、场景解析、用户端列表）因此天然查不到已删除的行；
 * 后台列表仍返回它（modelKey = 原键、deletedAt 非空），只为历史调用记录 / 用量 / 对账显示模型名。
 *
 * 同一操作里清理引用（预览接口按同样的口径计数）：
 * - model-access（同一事务）：线路、用户场景配置、角色逐场景设置、场景推荐 / 平台内部模型、展示倍率基准；
 * - billing（BillingModelRatePort.removeModels，同一事务）：发布不含这些模型的新价目表（历史版本保留）、删折扣。
 * 用户的选择被清掉后回到「未配置」（文本聊天没了 → needsSetup，首次引导重新选），不报错。
 * 「角色生态决策」模型存在生态配置里（ai-runtime），由配置所属模块在删除事务内按当前引用清理。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  BillingModelRatePort,
  ModelDeletionImpact,
  ModelScenario,
  PlatformInternalUse,
} from '@weiban/contracts';
import { DisplayMultiplierSettings, ModelScenarioSettings } from '@weiban/contracts';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  OUTBOX,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import {
  characterScenarioOverrides,
  modelAccessSettings,
  modelCatalog,
  modelRoutes,
  scenarioSelections,
} from '../infra/db/schema.js';
import { MODEL_RATE_PORT } from '../tokens.js';
import { CATALOG_LOCK_KEY, MODEL_USES_KEY } from './catalog.js';
import { DISPLAY_BASE_KEY, DisplayPricingService } from './display-pricing.js';

type Executor = Database['db'] | DbTx['db'];

interface Counted {
  revision: string;
  upstreamAccounts: { upstreamId: string; name: string; shared: boolean }[];
  models: { modelKey: string; displayName: string; enabled: boolean }[];
  users: number;
  scenarioSelections: number;
  characters: number;
  characterOverrides: number;
  recommended: ModelScenario[];
  internal: PlatformInternalUse[];
  routes: number;
  displayMultiplierBase: boolean;
}

@Injectable()
export class ModelDeletionService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(MODEL_RATE_PORT) private readonly rates: BillingModelRatePort,
    @Optional() @Inject(DisplayPricingService) private readonly display?: DisplayPricingService,
  ) {}

  private ecology?: {
    isReferenced: (keys: readonly string[]) => Promise<boolean>;
    clear: (tx: DbTx, keys: readonly string[], operator: string) => Promise<boolean>;
  };
  bindEcology(reference: NonNullable<ModelDeletionService['ecology']>) {
    this.ecology = reference;
  }
  /** 删除前预览：将要清理的引用（只读）。 */
  async preview(modelKeys: readonly string[]): Promise<ModelDeletionImpact> {
    await this.assertNotFixedPrivate(modelKeys);
    const counted = await this.count(this.database.db, modelKeys);
    const footprint = await this.rates.modelPriceFootprint(modelKeys);
    return {
      ...counted,
      ecologyDecision: (await this.ecology?.isReferenced(modelKeys)) ?? false,
      discounts: footprint.discountedModelKeys.length,
      pricedModels: footprint.pricedModelKeys.length,
    };
  }

  /**
   * 3.28：平台固定的私密模型不能直接删——删了会让全站私密模式突然不可用；
   * 先要求管理员换一个固定私密模型，再删旧模型。
   */
  private async assertNotFixedPrivate(
    modelKeys: readonly string[],
    db: Executor = this.database.db,
  ): Promise<void> {
    const fixed = (await this.modelUses(db)).fixed?.private ?? null;
    if (!fixed || !modelKeys.includes(fixed)) return;
    throw new AppError(
      'conflict',
      `这是平台固定的私密模型（${fixed}），不能删除；请先在后台「固定私密模型」里换一个再删`,
      { status: 409, details: { fixedPrivate: fixed } },
    );
  }

  async delete(
    adminId: string,
    modelKeys: readonly string[],
    options: { expectedRevision?: string } = {},
  ): Promise<ModelDeletionImpact> {
    const keys = [...new Set(modelKeys)];
    await this.assertNotFixedPrivate(keys);
    const removed = await this.database.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [CATALOG_LOCK_KEY]);
      await this.assertNotFixedPrivate(keys, tx.db);
      await tx.db
        .select({ modelKey: modelCatalog.modelKey })
        .from(modelCatalog)
        .where(and(inArray(modelCatalog.modelKey, keys), isNull(modelCatalog.deletedAt)))
        .for('update');
      const result = await this.count(tx.db, keys);
      if (options.expectedRevision && options.expectedRevision !== result.revision) {
        throw new AppError('conflict', '模型已经变化，请重新查看删除范围', { status: 409 });
      }
      const now = this.clock.now();

      await tx.db.delete(modelRoutes).where(inArray(modelRoutes.modelKey, keys));
      const users = await tx.db
        .delete(scenarioSelections)
        .where(inArray(scenarioSelections.modelKey, keys))
        .returning({ userId: scenarioSelections.userId });
      const chars = await tx.db
        .delete(characterScenarioOverrides)
        .where(inArray(characterScenarioOverrides.modelKey, keys))
        .returning({
          userId: characterScenarioOverrides.userId,
          characterId: characterScenarioOverrides.characterId,
        });

      // 场景推荐 / 平台内部模型
      if (result.recommended.length > 0 || result.internal.length > 0) {
        const uses = await this.modelUses(tx.db);
        for (const s of result.recommended) uses.recommended[s] = null;
        for (const u of result.internal) uses.internal[u] = null;
        await tx.db
          .insert(modelAccessSettings)
          .values({ key: MODEL_USES_KEY, value: uses, updatedAt: now, updatedBy: adminId })
          .onConflictDoUpdate({
            target: modelAccessSettings.key,
            set: { value: uses, updatedAt: now, updatedBy: adminId },
          });
      }
      if (result.displayMultiplierBase) {
        const value: DisplayMultiplierSettings = { baseModelKey: null };
        await tx.db
          .update(modelAccessSettings)
          .set({ value, updatedAt: now, updatedBy: adminId })
          .where(eq(modelAccessSettings.key, DISPLAY_BASE_KEY));
      }

      // 软删：改键腾出原键，保留行给历史记录显示模型名
      for (const m of result.models) {
        await tx.db
          .update(modelCatalog)
          .set({
            modelKey: `${m.modelKey}#deleted:${newId()}`,
            originalModelKey: m.modelKey,
            deletedAt: now,
            enabled: false,
            updatedAt: now,
          })
          .where(and(eq(modelCatalog.modelKey, m.modelKey), isNull(modelCatalog.deletedAt)));
        await this.audit.record(
          {
            module: 'model_access',
            action: 'catalog.deleted',
            actorType: 'admin',
            actorId: adminId,
            targetType: 'model',
            targetId: m.modelKey,
            details: {
              displayName: m.displayName,
              wasEnabled: m.enabled,
              recommended: result.recommended,
              internal: result.internal,
              scenarioSelections: users.length,
              characterOverrides: chars.length,
            },
          },
          tx,
        );
      }

      // 选择变了：通知受影响的用户刷新模型配置（与用户自己改选择同一个事件）
      for (const userId of new Set(users.map((u) => u.userId)))
        await this.outbox.publish(tx, 'model_access.selection_changed', 'model_access', {
          userId,
          characterId: null,
        });
      for (const key of new Set(chars.map((c) => `${c.userId}|${c.characterId}`))) {
        const [userId, characterId] = key.split('|') as [string, string];
        await this.outbox.publish(tx, 'model_access.selection_changed', 'model_access', {
          userId,
          characterId,
        });
      }
      const billing = await this.rates.removeModels(
        { operatorUserId: adminId, modelKeys: keys },
        tx,
      );
      const ecologyDecision = (await this.ecology?.clear(tx, keys, adminId)) ?? false;
      return { ...result, ...billing, ecologyDecision };
    });
    this.display?.invalidate();
    return removed;
  }

  private async modelUses(db: Executor): Promise<ModelScenarioSettings> {
    const [row] = await db
      .select()
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, MODEL_USES_KEY));
    const parsed = ModelScenarioSettings.safeParse(row?.value);
    return parsed.success ? parsed.data : { recommended: {}, internal: {} };
  }

  /** 统计这些（未删除的）模型的引用；有不存在或已删除的键时 404。 */
  private async count(db: Executor, modelKeys: readonly string[]): Promise<Counted> {
    const keys = [...new Set(modelKeys)];
    const rows = await db
      .select({
        modelKey: modelCatalog.modelKey,
        displayName: modelCatalog.displayName,
        enabled: modelCatalog.enabled,
        generation: sql<string>`xmin::text`,
      })
      .from(modelCatalog)
      .where(and(inArray(modelCatalog.modelKey, keys), isNull(modelCatalog.deletedAt)));
    const missing = keys.filter((k) => !rows.some((r) => r.modelKey === k));
    if (missing.length > 0)
      throw new AppError('not_found', `这些模型不存在或已删除：${missing.join('、')}`, {
        details: { modelKeys: missing },
      });

    const targets = sql.join(
      keys.map((key) => sql`${key}`),
      sql`, `,
    );
    const accounts = await db.execute<{ upstreamId: string; name: string; shared: boolean }>(sql`
      WITH bindings AS (
        SELECT model_key,upstream_id FROM model_access.model_catalog WHERE deleted_at IS NULL
        UNION
        SELECT r.model_key,r.upstream_id FROM model_access.model_routes r
        JOIN model_access.model_catalog c ON r.model_key=c.model_key WHERE c.deleted_at IS NULL
      )
      SELECT u.id AS "upstreamId",u.name,bool_or(b.model_key NOT IN (${targets})) AS shared
      FROM bindings b JOIN model_access.upstreams u ON u.id=b.upstream_id AND u.deleted_at IS NULL
      GROUP BY u.id,u.name HAVING bool_or(b.model_key IN (${targets})) ORDER BY u.id
    `);
    const revision = createHash('sha256')
      .update(JSON.stringify(rows.map((r) => [r.modelKey, r.generation]).sort()))
      .digest('hex');
    const [sel] = await db
      .select({
        rows: sql<number>`cast(count(*) as integer)`,
        users: sql<number>`cast(count(distinct ${scenarioSelections.userId}) as integer)`,
      })
      .from(scenarioSelections)
      .where(inArray(scenarioSelections.modelKey, keys));
    const [ovr] = await db
      .select({
        rows: sql<number>`cast(count(*) as integer)`,
        characters: sql<number>`cast(count(distinct (${characterScenarioOverrides.userId}, ${characterScenarioOverrides.characterId})) as integer)`,
      })
      .from(characterScenarioOverrides)
      .where(inArray(characterScenarioOverrides.modelKey, keys));
    const [routeCount] = await db
      .select({ rows: sql<number>`cast(count(*) as integer)` })
      .from(modelRoutes)
      .where(inArray(modelRoutes.modelKey, keys));

    const uses = await this.modelUses(db);
    const recommended = (Object.entries(uses.recommended) as [ModelScenario, string | null][])
      .filter(([, k]) => k != null && keys.includes(k))
      .map(([s]) => s);
    const internal = (Object.entries(uses.internal) as [PlatformInternalUse, string | null][])
      .filter(([, k]) => k != null && keys.includes(k))
      .map(([u]) => u);
    const [base] = await db
      .select()
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, DISPLAY_BASE_KEY));
    const baseKey = DisplayMultiplierSettings.safeParse(base?.value);

    return {
      revision,
      upstreamAccounts: accounts.rows,
      models: keys.map((k) => {
        const m = rows.find((r) => r.modelKey === k)!;
        return { modelKey: m.modelKey, displayName: m.displayName, enabled: m.enabled };
      }),
      users: sel?.users ?? 0,
      scenarioSelections: sel?.rows ?? 0,
      characters: ovr?.characters ?? 0,
      characterOverrides: ovr?.rows ?? 0,
      recommended,
      internal,
      routes: routeCount?.rows ?? 0,
      displayMultiplierBase:
        baseKey.success && !!baseKey.data.baseModelKey && keys.includes(baseKey.data.baseModelKey),
    };
  }
}
