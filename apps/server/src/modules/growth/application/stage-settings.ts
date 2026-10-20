/**
 * 3.25（10-21 G1-6）：好感度六阶段阈值的后台配置。默认 P25_FAMILIARITY.defaultStageThresholds；
 * 存 growth.settings（familiarity_stages），30 秒内存缓存。改阈值写审计；已达到的阶段不回落（effectiveStage 只升不降）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  FAMILIARITY_FREE_CEILING_LEVEL,
  FAMILIARITY_STAGE_NAMES,
  FamiliarityStageThresholds,
  type FamiliarityStageSettings,
  type UpdateFamiliarityStageSettingsRequest,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  P25_FAMILIARITY,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { growthSettings } from '../infra/db/schema.js';

const KEY = 'familiarity_stages';
const CACHE_MS = 30_000;

@Injectable()
export class FamiliarityStageSettingsService {
  private cache: { at: number; thresholds: number[]; updatedAt: Date | null } | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  private async load(): Promise<{ thresholds: number[]; updatedAt: Date | null }> {
    if (this.cache && this.clock.nowMs() - this.cache.at < CACHE_MS) return this.cache;
    const [row] = await this.db.db.select().from(growthSettings).where(eq(growthSettings.key, KEY));
    const parsed = FamiliarityStageThresholds.safeParse(
      (row?.value as { thresholds?: unknown } | undefined)?.thresholds,
    );
    this.cache = {
      at: this.clock.nowMs(),
      thresholds: parsed.success ? parsed.data : [...P25_FAMILIARITY.defaultStageThresholds],
      updatedAt: parsed.success ? (row?.updatedAt ?? null) : null,
    };
    return this.cache;
  }

  async thresholds(): Promise<number[]> {
    return (await this.load()).thresholds;
  }

  async get(): Promise<FamiliarityStageSettings> {
    const { thresholds, updatedAt } = await this.load();
    return {
      thresholds,
      stageNames: [...FAMILIARITY_STAGE_NAMES],
      freeCeilingLevel: FAMILIARITY_FREE_CEILING_LEVEL,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
    };
  }

  async update(
    adminId: string,
    body: UpdateFamiliarityStageSettingsRequest,
  ): Promise<FamiliarityStageSettings> {
    const before = await this.thresholds();
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const value = { thresholds: body.thresholds };
      await tx.db
        .insert(growthSettings)
        .values({ key: KEY, value, updatedAt: now, updatedBy: adminId })
        .onConflictDoUpdate({
          target: growthSettings.key,
          set: { value, updatedAt: now, updatedBy: adminId },
        });
      await this.audit.record(
        {
          module: 'growth',
          action: 'familiarity_stages.updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'growth_settings',
          targetId: null,
          details: { before, after: body.thresholds },
        },
        tx,
      );
    });
    this.cache = null;
    return this.get();
  }
}
