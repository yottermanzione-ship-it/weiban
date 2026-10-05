/**
 * 价目表（billing.md 第 4 节）：版本草稿、修改、发布；当前生效版本；按版本取某模型的价格。
 * 规则：任一时刻只有一个 active；已生效过（active / retired）的版本不可修改（409 price_version_immutable）；
 * 发布新版本时原生效版本自动停用。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PriceTable, PriceUnit } from '@weiban/contracts';
import { AdminPriceVersion } from '@weiban/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { validatePriceItems, type PriceBand, type PriceRow } from '../domain/rules.js';
import { priceItems, priceVersions } from '../infra/db/schema.js';

export type AdminPriceVersion = z.infer<typeof AdminPriceVersion>;
type VersionRow = typeof priceVersions.$inferSelect;
type ItemRow = typeof priceItems.$inferSelect;

export interface PriceItemInput {
  modelKey: string;
  unit: PriceUnit;
  priceMicros: number;
  costMicros: number;
  band: PriceBand | null;
}

function toRow(item: ItemRow): PriceRow {
  return {
    modelKey: item.modelKey,
    unit: item.unit as PriceUnit,
    band: (item.band as PriceBand | null) ?? null,
    priceMicros: item.priceMicros,
    costMicros: item.costMicros,
  };
}

@Injectable()
export class PriceService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ---------- 计价用 ----------

  /** 当前生效的版本（事务内读）。 */
  async activeVersion(tx: DbTx): Promise<VersionRow | null> {
    const [row] = await tx.db
      .select()
      .from(priceVersions)
      .where(eq(priceVersions.status, 'active'));
    return row ?? null;
  }

  /** 某版本里某模型的全部价格。 */
  async modelPrices(tx: DbTx, priceVersionId: string, modelKey: string): Promise<PriceRow[]> {
    const rows = await tx.db
      .select()
      .from(priceItems)
      .where(and(eq(priceItems.priceVersionId, priceVersionId), eq(priceItems.modelKey, modelKey)));
    return rows.map(toRow);
  }

  // ---------- 用户端 ----------

  async publicTable(): Promise<PriceTable> {
    const [version] = await this.database.db
      .select()
      .from(priceVersions)
      .where(eq(priceVersions.status, 'active'));
    if (!version) throw new AppError('not_found', '暂无生效的价目表');
    const items = await this.itemsOf(version.id);
    return {
      priceVersionId: version.id,
      versionLabel: version.versionLabel,
      effectiveFrom: (version.effectiveFrom ?? version.createdAt).toISOString(),
      items: items.map((i) => ({
        modelKey: i.modelKey,
        unit: i.unit as PriceUnit,
        priceMicros: i.priceMicros,
        band: (i.band as PriceBand | null) ?? null,
      })),
    };
  }

  // ---------- 管理端 ----------

  async list(): Promise<AdminPriceVersion[]> {
    const versions = await this.database.db
      .select()
      .from(priceVersions)
      .orderBy(desc(priceVersions.createdAt), desc(priceVersions.id));
    const result: AdminPriceVersion[] = [];
    for (const v of versions) result.push(this.toAdmin(v, await this.itemsOf(v.id)));
    return result;
  }

  async createDraft(
    operatorUserId: string,
    input: { versionLabel: string; note: string | null; items: PriceItemInput[] },
  ): Promise<AdminPriceVersion> {
    this.assertValid(input.items);
    const now = this.clock.now();
    const id = newId();
    return this.database.transaction(async (tx) => {
      await tx.db.insert(priceVersions).values({
        id,
        versionLabel: input.versionLabel,
        status: 'draft',
        effectiveFrom: null,
        note: input.note,
        createdAt: now,
        createdBy: operatorUserId,
      });
      await this.insertItems(tx, id, input.items);
      await this.audit.record(
        {
          module: 'billing',
          action: 'price_version.created',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'price_version',
          targetId: id,
          details: { items: input.items.length },
        },
        tx,
      );
      return this.load(tx, id);
    });
  }

  async updateDraft(
    operatorUserId: string,
    priceVersionId: string,
    patch: { note?: string | null; items?: PriceItemInput[] },
  ): Promise<AdminPriceVersion> {
    if (patch.items) this.assertValid(patch.items);
    return this.database.transaction(async (tx) => {
      const version = await this.lockVersion(tx, priceVersionId);
      if (version.status !== 'draft') {
        throw new AppError('price_version_immutable', '已生效或已停用的价目表不可修改，请新建版本');
      }
      if (patch.note !== undefined) {
        await tx.db
          .update(priceVersions)
          .set({ note: patch.note })
          .where(eq(priceVersions.id, priceVersionId));
      }
      if (patch.items) {
        await tx.db.delete(priceItems).where(eq(priceItems.priceVersionId, priceVersionId));
        await this.insertItems(tx, priceVersionId, patch.items);
      }
      await this.audit.record(
        {
          module: 'billing',
          action: 'price_version.updated',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'price_version',
          targetId: priceVersionId,
        },
        tx,
      );
      return this.load(tx, priceVersionId);
    });
  }

  /**
   * 发布（null = 立即生效）。暂不支持「预约将来生效」：effectiveFrom 晚于现在返回 400（见 docs/backend/billing.md）。
   * 重复发布同一个已生效版本直接返回（幂等）；已停用的版本不能再发布（409）。
   * 契约要求的「目录中启用的模型缺少价格时 422」需要模型目录（model-access），billing 不能调用 model-access，
   * 留给 D-L0-08 / D-L0-13 在管理后台或网关侧检查（交接说明）。
   */
  async activate(
    operatorUserId: string,
    priceVersionId: string,
    effectiveFrom: string | null,
  ): Promise<AdminPriceVersion> {
    const now = this.clock.now();
    const from = effectiveFrom ? new Date(effectiveFrom) : now;
    if (from.getTime() > now.getTime()) {
      throw new AppError('bad_request', '暂不支持预约生效，请在生效时间到了以后再发布', {
        details: { issues: [{ path: 'effectiveFrom', message: '不能晚于现在' }] },
      });
    }
    return this.database.transaction(async (tx) => {
      const version = await this.lockVersion(tx, priceVersionId);
      if (version.status === 'active') return this.load(tx, priceVersionId);
      if (version.status === 'retired') {
        throw new AppError('price_version_immutable', '已停用的价目表不能再发布，请复制后新建版本');
      }
      const items = await this.itemsOf(priceVersionId, tx);
      if (items.length === 0) throw new AppError('bad_request', '价目表没有任何价格，不能发布');
      // 所有版本行按固定顺序加锁后再切换，避免两个发布同时进行
      await tx.query(`SELECT id FROM billing.price_versions WHERE status = 'active' FOR UPDATE`);
      await tx.db
        .update(priceVersions)
        .set({ status: 'retired', retiredAt: now })
        .where(eq(priceVersions.status, 'active'));
      await tx.db
        .update(priceVersions)
        .set({ status: 'active', effectiveFrom: from })
        .where(eq(priceVersions.id, priceVersionId));
      await this.audit.record(
        {
          module: 'billing',
          action: 'price_version.activated',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'price_version',
          targetId: priceVersionId,
        },
        tx,
      );
      return this.load(tx, priceVersionId);
    });
  }

  // ---------- 内部 ----------

  private assertValid(items: PriceItemInput[]): void {
    const problems = validatePriceItems(items);
    if (problems.length > 0) {
      throw new AppError('bad_request', '价目表内容不正确', {
        details: { issues: problems.map((message) => ({ path: 'items', message })) },
      });
    }
  }

  private async insertItems(tx: DbTx, versionId: string, items: PriceItemInput[]): Promise<void> {
    if (items.length === 0) return;
    await tx.db.insert(priceItems).values(
      items.map((item, index) => ({
        id: newId(),
        priceVersionId: versionId,
        modelKey: item.modelKey,
        unit: item.unit,
        band: item.band,
        priceMicros: item.priceMicros,
        costMicros: item.costMicros,
        sortOrder: index,
      })),
    );
  }

  private async lockVersion(tx: DbTx, id: string): Promise<VersionRow> {
    const [row] = await tx.db
      .select()
      .from(priceVersions)
      .where(eq(priceVersions.id, id))
      .for('update');
    if (!row) throw new AppError('not_found', '价目表版本不存在');
    return row;
  }

  private async itemsOf(versionId: string, tx?: DbTx): Promise<ItemRow[]> {
    return (tx?.db ?? this.database.db)
      .select()
      .from(priceItems)
      .where(eq(priceItems.priceVersionId, versionId))
      .orderBy(asc(priceItems.sortOrder));
  }

  private async load(tx: DbTx, id: string): Promise<AdminPriceVersion> {
    const [row] = await tx.db.select().from(priceVersions).where(eq(priceVersions.id, id));
    if (!row) throw new AppError('not_found', '价目表版本不存在');
    return this.toAdmin(row, await this.itemsOf(id, tx));
  }

  private toAdmin(v: VersionRow, items: ItemRow[]): AdminPriceVersion {
    return {
      priceVersionId: v.id,
      versionLabel: v.versionLabel,
      status: v.status as AdminPriceVersion['status'],
      effectiveFrom: v.effectiveFrom?.toISOString() ?? null,
      note: v.note,
      items: items.map((i) => ({
        modelKey: i.modelKey,
        unit: i.unit as PriceUnit,
        priceMicros: i.priceMicros,
        costMicros: i.costMicros,
        band: (i.band as PriceBand | null) ?? null,
      })),
      createdAt: v.createdAt.toISOString(),
    };
  }
}
