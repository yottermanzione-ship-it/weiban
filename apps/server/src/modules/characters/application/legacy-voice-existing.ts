/** 旧卡音色导入前的只读现状（角色、已绑定默认音色、media.voices 目录、可用的语音模型）。 */
import { inArray } from 'drizzle-orm';
import type { Database } from '../../../platform/index.js';
import { characters, defaultVoices } from '../infra/db/schema.js';
import { voiceKeyId, type VoiceExisting } from '../domain/legacy-voice-import.js';
import type { VoiceCatalogEntry } from '../../media/index.js';

export async function readVoiceExisting(
  db: Database,
  characterIds: readonly string[],
  voiceRows: readonly VoiceCatalogEntry[],
  registeredModels: readonly string[],
): Promise<VoiceExisting> {
  if (!characterIds.length)
    return {
      characterIds: new Set(),
      boundVoiceIds: new Map(),
      voicesByKey: new Map(),
      registeredModels: new Set(registeredModels),
    };
  const [characterRows, boundRows] = await Promise.all([
    db.db
      .select({ id: characters.id })
      .from(characters)
      .where(inArray(characters.id, [...characterIds])),
    db.db
      .select({ characterId: defaultVoices.characterId, voiceId: defaultVoices.voiceId })
      .from(defaultVoices)
      .where(inArray(defaultVoices.characterId, [...characterIds])),
  ]);
  return {
    characterIds: new Set(characterRows.map((row) => row.id)),
    boundVoiceIds: new Map(boundRows.map((row) => [row.characterId, row.voiceId])),
    voicesByKey: new Map(
      voiceRows.map((row) => [
        voiceKeyId(row.modelKey, row.providerVoiceKey),
        { id: row.id, enabled: row.enabled },
      ]),
    ),
    registeredModels: new Set(registeredModels),
  };
}
