/** 旧卡头像导入的数据库 / 媒体写入（只由 operator CLI 调用）。 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { AppError, type Database } from '../../../platform/index.js';
import { characters } from '../infra/db/schema.js';
import type {
  AvatarImportCounts,
  AvatarImportIssue,
  AvatarInspection,
} from '../domain/legacy-avatar-import.js';

/** 头像只需要媒体模块的这两个写能力；用结构类型避免 characters 依赖 media 内部实现。 */
export interface AvatarMediaWriter {
  putObject(input: {
    ownerUserId: null;
    purpose: 'character_avatar';
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{ mediaId: string }>;
  deleteObject(mediaId: string): Promise<void>;
}

export interface AvatarCharacterRow {
  id: string;
  name: string;
  kind: string;
  avatarMediaId: string | null;
}

export async function readAvatarCharacters(
  db: Database,
  ids: readonly string[],
): Promise<Map<string, AvatarCharacterRow>> {
  if (!ids.length) return new Map();
  const rows = await db.db
    .select({
      id: characters.id,
      name: characters.name,
      kind: characters.kind,
      avatarMediaId: characters.avatarMediaId,
    })
    .from(characters)
    .where(inArray(characters.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row]));
}

export interface AvatarApplyInput {
  characterId: string;
  inspection: Extract<AvatarInspection, { ok: true }>;
}

export interface AvatarApplyResult {
  imported: number;
  failed: number;
}

/** 逐条写入：先落加密媒体对象，再把 avatar_media_id 绑到角色；失败只影响当前角色。 */
export async function applyAvatarImports(
  db: Database,
  media: Pick<AvatarMediaWriter, 'putObject' | 'deleteObject'>,
  items: readonly AvatarApplyInput[],
  input: {
    now: Date;
    counts: AvatarImportCounts;
    issues: AvatarImportIssue[];
    offset?: number;
    progress?: (event: Record<string, unknown>) => void;
  },
): Promise<AvatarApplyResult> {
  const { now, counts, issues, progress } = input;
  const offset = input.offset ?? 0;
  let imported = 0;
  let failed = 0;
  for (const [index, item] of items.entries()) {
    const position = offset + index + 1;
    let savedMediaId: string | null = null;
    try {
      const saved = await media.putObject({
        ownerUserId: null,
        purpose: 'character_avatar',
        bytes: item.inspection.buffer,
        mimeType: item.inspection.mimeType,
      });
      savedMediaId = saved.mediaId;
      const updated = await db.db
        .update(characters)
        .set({ avatarMediaId: saved.mediaId, updatedAt: now })
        .where(and(eq(characters.id, item.characterId), isNull(characters.avatarMediaId)))
        .returning({ id: characters.id });
      if (!updated.length) {
        await media.deleteObject(saved.mediaId).catch(() => undefined);
        savedMediaId = null;
        failed++;
        counts.failed++;
        issues.push({
          characterId: item.characterId,
          code: 'write_failed',
          detail: 'AVATAR_SET_RACE',
        });
        progress?.({
          event: 'avatar',
          index: position,
          total: items.length + offset,
          characterId: item.characterId,
          status: 'failed',
          code: 'write_failed',
        });
        continue;
      }
      // 绑定已提交；后续进度输出即使失败也不能再删媒体。
      savedMediaId = null;
      imported++;
      counts.imported++;
      progress?.({
        event: 'avatar',
        index: position,
        total: items.length + offset,
        characterId: item.characterId,
        status: 'imported',
        mediaId: saved.mediaId,
      });
    } catch (error) {
      if (savedMediaId) await media.deleteObject(savedMediaId).catch(() => undefined);
      failed++;
      counts.failed++;
      const code = error instanceof AppError ? error.code : 'write_failed';
      issues.push({ characterId: item.characterId, code: 'write_failed', detail: code });
      progress?.({
        event: 'avatar',
        index: position,
        total: items.length + offset,
        characterId: item.characterId,
        status: 'failed',
        code,
      });
      // 存储 / 账号配置错误对后续每一条都会失败，直接停下，避免刷 677 次无效重试。
      if (
        code === 'service_unavailable' ||
        code === 'unauthenticated' ||
        (error instanceof Error && error.message === 'STORAGE_CONFIGURATION_INVALID')
      )
        throw error;
    } finally {
      item.inspection.buffer.fill(0);
    }
  }
  return { imported, failed };
}
