/**
 * 旧卡音色导入的媒体侧写入：只操作 media.voices（模块自己的 schema）。
 *
 * 角色 ↔ 音色的绑定由 characters 模块写 characters.default_voices；这里不跨 schema。
 * 幂等键是 (model_key, provider_voice_key)：已存在就复用，不重复建行。
 */
import { and, eq } from 'drizzle-orm';
import { v5 as uuidV5 } from 'uuid';
import type { Clock, Database } from '../../../platform/index.js';
import { voices } from '../infra/db/schema.js';

const LEGACY_NAMESPACE = uuidV5.URL;

export interface VoiceCatalogEntry {
  id: string;
  providerVoiceKey: string;
  modelKey: string;
  enabled: boolean;
}

export interface RegisterVoiceInput {
  modelKey: string;
  providerVoiceKey: string;
  name: string;
  tags: string[];
  enabled: boolean;
}

export interface RegisterVoiceResult {
  id: string;
  created: boolean;
  enabled: boolean;
}

export function legacyVoiceId(modelKey: string, providerVoiceKey: string): string {
  return uuidV5(`wb:voice:${modelKey}:${providerVoiceKey}`, LEGACY_NAMESPACE);
}

export class MediaVoiceImportService {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async listVoices(): Promise<VoiceCatalogEntry[]> {
    return this.database.db
      .select({
        id: voices.id,
        providerVoiceKey: voices.providerVoiceKey,
        modelKey: voices.modelKey,
        enabled: voices.enabled,
      })
      .from(voices);
  }

  /** 同 provider+key 已存在（无论 id）即复用；停用的音色不静默接管，交给调用方报告。 */
  async ensureVoice(input: RegisterVoiceInput): Promise<RegisterVoiceResult> {
    const id = legacyVoiceId(input.modelKey, input.providerVoiceKey);
    const [byId] = await this.database.db
      .select({
        id: voices.id,
        modelKey: voices.modelKey,
        providerVoiceKey: voices.providerVoiceKey,
        enabled: voices.enabled,
      })
      .from(voices)
      .where(eq(voices.id, id));
    if (byId) {
      if (byId.modelKey !== input.modelKey || byId.providerVoiceKey !== input.providerVoiceKey)
        throw Object.assign(new Error('VOICE_ID_CONFLICT'), { code: 'VOICE_ID_CONFLICT' });
      return { id: byId.id, created: false, enabled: byId.enabled };
    }
    const [same] = await this.database.db
      .select({ id: voices.id, enabled: voices.enabled })
      .from(voices)
      .where(
        and(
          eq(voices.modelKey, input.modelKey),
          eq(voices.providerVoiceKey, input.providerVoiceKey),
        ),
      );
    if (same) return { id: same.id, created: false, enabled: same.enabled };
    const now = this.clock.now();
    await this.database.db
      .insert(voices)
      .values({
        id,
        name: input.name,
        tags: input.tags,
        sampleMediaId: null,
        providerVoiceKey: input.providerVoiceKey,
        modelKey: input.modelKey,
        careFallbackMediaId: null,
        enabled: input.enabled,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: voices.id });
    const [created] = await this.database.db
      .select({ id: voices.id, enabled: voices.enabled })
      .from(voices)
      .where(eq(voices.id, id));
    if (!created)
      throw Object.assign(new Error('VOICE_INSERT_MISSING'), { code: 'VOICE_INSERT_MISSING' });
    return { id: created.id, created: true, enabled: created.enabled };
  }
}

export function createMediaVoiceImportService(
  database: Database,
  clock: Clock,
): MediaVoiceImportService {
  return new MediaVoiceImportService(database, clock);
}
