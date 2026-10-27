/**
 * 实时通话音色（批 V，0145）：角色专属音色（旧站复刻、按模型登记）优先，否则用该模型的默认系统音色。
 * 供应商复刻音色只在登记它的模型 / 账号 workspace 上有效，所以按 (角色, 模型键) 存，绝不跨模型复用。
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

  /** 这通电话用的供应商音色：角色专属 → 模型默认 → null（不可接通，不换别的模型的音色）。 */
  async voiceFor(characterId: string, modelKey: string): Promise<string | null> {
    const [own] = await this.database.db
      .select({ key: realtimeVoiceBindings.providerVoiceKey })
      .from(realtimeVoiceBindings)
      .where(
        and(
          eq(realtimeVoiceBindings.characterId, characterId),
          eq(realtimeVoiceBindings.modelKey, modelKey),
        ),
      );
    if (own && ProviderVoiceKey.safeParse(own.key).success) return own.key;
    return (await this.defaults())[modelKey] ?? null;
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

  async count(modelKey: string): Promise<number> {
    const [row] = await this.database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(realtimeVoiceBindings)
      .where(eq(realtimeVoiceBindings.modelKey, modelKey));
    return row?.n ?? 0;
  }
}
