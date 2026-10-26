/** 维护 CLI 读取：当前目录里可用于语音消息（voice_message）且启用的模型键。只读 model_access 自己的表。 */
import type { Database } from '../../../platform/index.js';

export async function listVoiceMessageModelKeys(db: Database): Promise<string[]> {
  const { rows } = await db.query<{ model_key: string }>(
    `SELECT model_key FROM model_access.model_catalog
      WHERE enabled = true AND deleted_at IS NULL AND 'voice_message' = ANY(scenarios)
      ORDER BY model_key`,
  );
  return rows.map((row) => row.model_key);
}
