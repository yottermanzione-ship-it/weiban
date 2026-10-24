/** 旧卡音色绑定：只写 characters.default_voices（模块自己的 schema）。 */
import { eq } from 'drizzle-orm';
import type { Database } from '../../../platform/index.js';
import { defaultVoices } from '../infra/db/schema.js';

export type VoiceBindCode = 'BIND_CONFLICT';

export interface VoiceBindResult {
  bound: boolean;
}

/** 幂等绑定：已有同音色返回 bound=false；已有不同音色返回 BIND_CONFLICT，不覆盖。 */
export async function bindDefaultVoice(
  db: Database,
  characterId: string,
  voiceId: string,
  now: Date,
): Promise<VoiceBindResult> {
  const [existing] = await db.db
    .select({ voiceId: defaultVoices.voiceId })
    .from(defaultVoices)
    .where(eq(defaultVoices.characterId, characterId));
  if (existing) {
    if (existing.voiceId !== voiceId)
      throw Object.assign(new Error('BIND_CONFLICT'), { code: 'BIND_CONFLICT' });
    return { bound: false };
  }
  await db.db
    .insert(defaultVoices)
    .values({ characterId, voiceId, updatedAt: now })
    .onConflictDoNothing({ target: defaultVoices.characterId });
  const [row] = await db.db
    .select({ voiceId: defaultVoices.voiceId })
    .from(defaultVoices)
    .where(eq(defaultVoices.characterId, characterId));
  if (!row) throw Object.assign(new Error('BIND_MISSING'), { code: 'BIND_CONFLICT' });
  if (row.voiceId !== voiceId)
    throw Object.assign(new Error('BIND_CONFLICT'), { code: 'BIND_CONFLICT' });
  return { bound: true };
}
