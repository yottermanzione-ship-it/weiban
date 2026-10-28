/**
 * 实时通话音色（批 V，0145；V2 0146 加 source = clone）：角色专属音色（旧站迁入、管理员登记、按需复刻）优先，
 * 否则用该模型的默认系统音色。供应商复刻音色只在登记它的模型 / 账号上有效，所以按 (角色, 模型键) 存，绝不跨模型复用。
 * 按需复刻的流程见 realtime-voice-clone.ts。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { modelAccessSettings, realtimeVoiceBindings } from '../infra/db/schema.js';
import { REALTIME_CALL_VOICES_SETTING_KEY } from './realtime-call.js';

/** 供应商音色代号：字母数字与 `-_.:`，1～200 字符（不接受 URL 或空白）。 */
export const ProviderVoiceKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const DefaultVoices = z.record(z.string().min(1).max(128), ProviderVoiceKey);

export interface RealtimeVoiceRow {
  characterId: string;
  modelKey: string;
  providerVoiceKey: string;
}

@Injectable()
export class RealtimeVoiceStore {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  async defaults(): Promise<Record<string, string>> {
    const [row] = await this.database.db
      .select()
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, REALTIME_CALL_VOICES_SETTING_KEY));
    const parsed = DefaultVoices.safeParse(row?.value);
    return parsed.success ? parsed.data : {};
  }

  /** 角色在这个模型下的专属音色（旧站迁入 / 管理员登记 / V2 按需复刻）；没有返回 null。 */
  async binding(characterId: string, modelKey: string): Promise<string | null> {
    const [own] = await this.database.db
      .select({ key: realtimeVoiceBindings.providerVoiceKey })
      .from(realtimeVoiceBindings)
      .where(
        and(
          eq(realtimeVoiceBindings.characterId, characterId),
          eq(realtimeVoiceBindings.modelKey, modelKey),
        ),
      );
    return own && ProviderVoiceKey.safeParse(own.key).success ? own.key : null;
  }

  /**
   * V2：按需复刻成功后写入绑定（source = clone）并审计。V3（契约 4.6）：模型登记了 voice_clone 售价时复刻费由
   * 触发通话的用户承担（billedTo = user，chargedMicros = 实际扣费微元），没登记时平台承担（billedTo = platform）；
   * 审计里同时记供应商成本 costYuan 便于对账。已有绑定（并发 / 其他实例 / 管理员刚登记）时不覆盖，返回已有的音色。
   */
  async saveClone(input: {
    characterId: string;
    modelKey: string;
    providerVoiceKey: string;
    sampleMediaId: string;
    costYuan: number;
    billedTo?: 'user' | 'platform';
    chargedMicros?: number;
  }): Promise<string> {
    if (!ProviderVoiceKey.safeParse(input.providerVoiceKey).success)
      throw new Error('REALTIME_VOICE_INVALID');
    return this.database.transaction(async (tx) => {
      const now = this.clock.now();
      const inserted = await tx.db
        .insert(realtimeVoiceBindings)
        .values({
          characterId: input.characterId,
          modelKey: input.modelKey,
          providerVoiceKey: input.providerVoiceKey,
          source: 'clone',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ key: realtimeVoiceBindings.providerVoiceKey });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'realtime_voice.cloned',
          actorType: 'system',
          actorId: null,
          targetType: 'character',
          targetId: input.characterId,
          details: {
            modelKey: input.modelKey,
            sampleMediaId: input.sampleMediaId,
            saved: inserted.length > 0,
            costYuan: input.costYuan,
            billedTo: input.billedTo ?? 'platform',
            chargedMicros: input.chargedMicros ?? 0,
          },
        },
        tx,
      );
      if (inserted.length) return input.providerVoiceKey;
      const [existing] = await tx.db
        .select({ key: realtimeVoiceBindings.providerVoiceKey })
        .from(realtimeVoiceBindings)
        .where(
          and(
            eq(realtimeVoiceBindings.characterId, input.characterId),
            eq(realtimeVoiceBindings.modelKey, input.modelKey),
          ),
        );
      return existing?.key ?? input.providerVoiceKey;
    });
  }

  /** 各来源的绑定条数（--show 用；clone 条数 × 0.01 元 ≈ 复刻的供应商成本）。 */
  async countBySource(modelKey: string): Promise<Record<string, number>> {
    const rows = await this.database.db
      .select({ source: realtimeVoiceBindings.source, n: sql<number>`count(*)::int` })
      .from(realtimeVoiceBindings)
      .where(eq(realtimeVoiceBindings.modelKey, modelKey))
      .groupBy(realtimeVoiceBindings.source);
    return Object.fromEntries(rows.map((r) => [r.source, r.n]));
  }

  async setDefault(operatorUserId: string, modelKey: string, voice: string | null): Promise<void> {
    if (voice !== null && !ProviderVoiceKey.safeParse(voice).success)
      throw new Error('REALTIME_VOICE_INVALID');
    await this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(modelAccessSettings)
        .where(eq(modelAccessSettings.key, REALTIME_CALL_VOICES_SETTING_KEY))
        .for('update');
      const before = DefaultVoices.safeParse(row?.value);
      const next: Record<string, string> = { ...(before.success ? before.data : {}) };
      if (voice === null) delete next[modelKey];
      else next[modelKey] = voice;
      const now = this.clock.now();
      await tx.db
        .insert(modelAccessSettings)
        .values({
          key: REALTIME_CALL_VOICES_SETTING_KEY,
          value: next,
          updatedAt: now,
          updatedBy: operatorUserId,
        })
        .onConflictDoUpdate({
          target: modelAccessSettings.key,
          set: { value: next, updatedAt: now, updatedBy: operatorUserId },
        });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'realtime_voice.default_set',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'model',
          targetId: null,
          details: { modelKey, voice },
        },
        tx,
      );
    });
  }

  /** 旧站迁入：只插入没有的 (角色, 模型)；已有的（含管理员改过的）不覆盖。返回新插入条数。 */
  async importLegacy(operatorUserId: string, rows: readonly RealtimeVoiceRow[]): Promise<number> {
    if (!rows.length) return 0;
    return this.database.transaction(async (tx) => {
      const now = this.clock.now();
      let inserted = 0;
      for (const row of rows) {
        if (!ProviderVoiceKey.safeParse(row.providerVoiceKey).success) continue;
        const result = await tx.db
          .insert(realtimeVoiceBindings)
          .values({ ...row, source: 'legacy', createdAt: now, updatedAt: now })
          .onConflictDoNothing()
          .returning({ characterId: realtimeVoiceBindings.characterId });
        inserted += result.length;
      }
      await this.audit.record(
        {
          module: 'model_access',
          action: 'realtime_voice.legacy_imported',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'model',
          targetId: null,
          details: { offered: rows.length, inserted },
        },
        tx,
      );
      return inserted;
    });
  }

  /**
   * V3：模型改挂另一个上游账号（例 北京 workspace）时，删掉在旧账号上按需复刻的绑定（source = clone；
   * 复刻音色只在创建它的账号有效）。旧站迁入 / 管理员登记的不动。返回删除条数，写审计。
   */
  async deleteClones(operatorUserId: string, modelKey: string): Promise<number> {
    return this.database.transaction(async (tx) => {
      const removed = await tx.db
        .delete(realtimeVoiceBindings)
        .where(
          and(
            eq(realtimeVoiceBindings.modelKey, modelKey),
            eq(realtimeVoiceBindings.source, 'clone'),
          ),
        )
        .returning({ characterId: realtimeVoiceBindings.characterId });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'realtime_voice.clones_dropped',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'model',
          targetId: null,
          details: { modelKey, removed: removed.length },
        },
        tx,
      );
      return removed.length;
    });
  }

  async count(modelKey: string): Promise<number> {
    const [row] = await this.database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(realtimeVoiceBindings)
      .where(eq(realtimeVoiceBindings.modelKey, modelKey));
    return row?.n ?? 0;
  }
}
