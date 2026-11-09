import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  Id,
  LegacyFavorite,
  LegacyFavoriteImportRequest,
  LegacyFavoriteMediaIssue,
  LegacyFavoriteSnapshot,
  LegacyFavoritesEndpoints,
  type IdentityAccountStatusPort,
  type LegacyFavoriteImportItem,
  type MediaPurpose,
  type MediaSystemPort,
  type SyncPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { SYNC_PORT } from '../../realtime/index.js';

interface Row {
  id: string;
  user_id: string;
  account_key: string;
  item_key: string;
  snapshot_ciphertext: Buffer | null;
  saved_at: Date;
  imported_at: Date;
  deleted_at: Date | null;
}
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const StoredSnapshot = z.strictObject({
  version: z.literal(1),
  favorite: LegacyFavoriteSnapshot,
  mediaIssue: LegacyFavoriteMediaIssue.nullable(),
});
type StoredSnapshot = z.infer<typeof StoredSnapshot>;
interface Attachment {
  kind: 'image' | 'voice';
  reference: string;
  purposes: MediaPurpose[];
}
type PreparedAttachment =
  | (Attachment & { mediaId: string; priorId: string | null; priorUsable: boolean })
  | 'removed'
  | null;
function attachmentOf(favorite: LegacyFavoriteSnapshot): Attachment | null {
  const message = favorite.message,
    type = message.type ?? 'text';
  const kind = ['image', 'sticker'].includes(type) ? 'image' : type === 'voice' ? 'voice' : null;
  const reference =
    kind === 'image' ? message.imageUrl : kind === 'voice' ? message.audioPath : null;
  if (!kind || typeof reference !== 'string' || !reference.trim()) return null;
  return {
    kind,
    reference,
    purposes:
      kind === 'image'
        ? ['chat_image', 'generated_image', 'user_sticker', 'sticker_library']
        : ['chat_voice', 'generated_voice'],
  };
}
export const legacyFavoriteItemKey = (favorite: LegacyFavoriteSnapshot): string =>
  hash(
    `${favorite.chatKey}|${favorite.message.timestamp ?? 'null'}|${favorite.message.type ?? 'text'}|${favorite.message.content ?? ''}`,
  );
const cursorOf = (row: Row) =>
  Buffer.from(`${row.saved_at.toISOString()}|${row.id}`, 'utf8').toString('base64url');
function cursorValue(value?: string): { at: string; id: string } | null {
  if (value === undefined) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new AppError('bad_request', '分页游标不正确');
  const decoded = Buffer.from(value, 'base64url').toString('utf8'),
    parts = decoded.split('|');
  if (
    parts.length !== 2 ||
    !Id.safeParse(parts[1]).success ||
    !Number.isFinite(Date.parse(parts[0]!)) ||
    new Date(parts[0]!).toISOString() !== parts[0] ||
    Buffer.from(decoded, 'utf8').toString('base64url') !== value
  ) {
    throw new AppError('bad_request', '分页游标不正确');
  }
  return { at: parts[0]!, id: parts[1]! };
}

@Injectable()
export class LegacyFavoritesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
  ) {}

  private async lock(tx: DbTx, userId: string): Promise<void> {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('library:legacy-favorites:' || $1,0))",
      [userId],
    );
  }
  private async active(tx: DbTx, userId: string): Promise<void> {
    if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
      throw new AppError('unauthenticated', '账号已失效');
  }
  private async accountKeys(tx: DbTx, userId: string): Promise<string[]> {
    const { rows } = await tx.query<{ account_key: string }>(
      'SELECT account_key FROM library.legacy_favorite_sources WHERE user_id=$1 AND source_user_id=$1 ORDER BY account_key',
      [userId],
    );
    if (rows.length > 8) throw new AppError('conflict', '旧账号来源需要重新核对');
    return rows.map((row) => row.account_key);
  }
  async source(userId: string) {
    return this.database.transaction(async (tx) => {
      await this.active(tx, userId);
      const legacyAccountKeys = await this.accountKeys(tx, userId);
      return LegacyFavoritesEndpoints.source.response.parse({
        userId,
        legacyAccountKeys,
        available: legacyAccountKeys.length > 0,
      });
    });
  }
  async import(userId: string, input: unknown) {
    const body = parseContract(LegacyFavoriteImportRequest, input);
    for (const item of body.items) {
      if (legacyFavoriteItemKey(item.favorite) !== item.itemKey)
        throw new AppError('bad_request', '旧收藏标识与快照不一致');
    }
    const prepared = await this.prepareAttachments(userId, body.items);
    const result = await this.database.transaction(async (tx) => {
      await this.lock(tx, userId);
      await this.active(tx, userId);
      const allowed = new Set(await this.accountKeys(tx, userId));
      if (body.items.some((item) => !allowed.has(item.accountKey)))
        throw new AppError('forbidden', '旧收藏来源不属于当前账号');
      let total = (
        await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM library.legacy_favorites WHERE user_id=$1',
          [userId],
        )
      ).rows[0]!.n;
      const result = {
        imported: 0,
        existing: 0,
        removed: 0,
        items: [] as {
          accountKey: string;
          itemKey: string;
          status: 'imported' | 'existing' | 'removed';
        }[],
      };
      const importedAt = this.clock.now();
      let mappingAdded = false;
      let metadataChanged = false;
      for (const [index, item] of body.items.entries()) {
        const old = (
          await tx.query<Row>(
            'SELECT * FROM library.legacy_favorites WHERE user_id=$1 AND account_key=$2 AND item_key=$3',
            [userId, item.accountKey, item.itemKey],
          )
        ).rows[0];
        let status: 'imported' | 'existing' | 'removed';
        let stored: StoredSnapshot | null = null;
        if (old) {
          status = old.deleted_at ? 'removed' : 'existing';
          if (!old.deleted_at) {
            stored = await this.openSnapshot(old, tx);
            const original = attachmentOf(stored.favorite),
              incoming = attachmentOf(item.favorite);
            if (original?.kind !== incoming?.kind || original?.reference !== incoming?.reference)
              throw new AppError('conflict', '原收藏附件引用已变化，请核对后再迁入');
          }
        } else {
          if (total >= 4000) throw new AppError('conflict', '旧收藏已达到承接上限');
          const id = newId();
          const sealed = await this.crypto.seal(
            userId,
            `library:legacy-favorite:${id}`,
            JSON.stringify(
              StoredSnapshot.parse({
                version: 1,
                favorite: item.favorite,
                mediaIssue: item.mediaId ? null : (item.mediaIssue ?? null),
              }),
            ),
            tx,
          );
          await tx.query(
            `INSERT INTO library.legacy_favorites
            (id,user_id,account_key,item_key,snapshot_ciphertext,saved_at,imported_at)
            VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              id,
              userId,
              item.accountKey,
              item.itemKey,
              sealed,
              new Date(item.favorite.savedAt),
              importedAt,
            ],
          );
          status = 'imported';
          total++;
        }
        if (status !== 'removed' && item.mediaId) {
          const proof = prepared[index];
          if (!proof || proof === 'removed')
            throw new AppError('conflict', '收藏状态已变化，请重试');
          const inserted = await tx.query(
            `INSERT INTO library.legacy_favorite_media_links
            (user_id,reference_hash,kind,media_id,source_batch) VALUES($1,$2,$3,$4,'client-verified-upload')
            ON CONFLICT DO NOTHING RETURNING media_id`,
            [userId, hash(proof.reference), proof.kind, proof.mediaId],
          );
          const link = (
            await tx.query<{ media_id: string }>(
              `SELECT media_id FROM library.legacy_favorite_media_links
            WHERE user_id=$1 AND reference_hash=$2 AND kind=$3 FOR UPDATE`,
              [userId, hash(proof.reference), proof.kind],
            )
          ).rows[0]!;
          if (
            link.media_id !== proof.mediaId &&
            !(link.media_id === proof.priorId && proof.priorUsable)
          ) {
            if (link.media_id !== proof.priorId || proof.priorUsable)
              throw new AppError('conflict', '附件映射已变化，请核对后重试');
            // Only repair the exact unusable mapping observed before taking our transaction lock.
            // A concurrent import's new mapping must survive even if this request also uploaded a valid file.
            const repaired = await tx.query(
              `UPDATE library.legacy_favorite_media_links SET media_id=$4,source_batch='client-verified-upload'
              WHERE user_id=$1 AND reference_hash=$2 AND kind=$3 AND media_id=$5`,
              [userId, hash(proof.reference), proof.kind, proof.mediaId, proof.priorId],
            );
            if (repaired.rowCount !== 1) throw new AppError('conflict', '附件映射已变化，请重试');
            mappingAdded = true;
          }
          mappingAdded ||= (inserted.rowCount ?? 0) > 0;
        }
        if (status === 'existing' && old && stored) {
          const mediaIssue = item.mediaId ? null : (item.mediaIssue ?? stored.mediaIssue);
          if (mediaIssue !== stored.mediaIssue) {
            const sealed = await this.crypto.seal(
              userId,
              `library:legacy-favorite:${old.id}`,
              JSON.stringify(StoredSnapshot.parse({ ...stored, mediaIssue })),
              tx,
            );
            await tx.query(
              'UPDATE library.legacy_favorites SET snapshot_ciphertext=$2 WHERE id=$1',
              [old.id, sealed],
            );
            metadataChanged = true;
          }
        }
        result[status]++;
        result.items.push({ accountKey: item.accountKey, itemKey: item.itemKey, status });
      }
      if (result.imported || mappingAdded || metadataChanged) await this.changed(tx, userId, null);
      return result;
    });
    const items = [];
    const availability = new Map<string, LegacyFavorite['mediaStatus']>();
    for (const item of result.items) {
      const key = `${item.accountKey}:${item.itemKey}`;
      let mediaStatus: LegacyFavorite['mediaStatus'] = 'none';
      if (item.status !== 'removed') {
        const cached = availability.get(key);
        if (cached) mediaStatus = cached;
        else {
          const row = (
            await this.database.query<Row>(
              `SELECT * FROM library.legacy_favorites
            WHERE user_id=$1 AND account_key=$2 AND item_key=$3 AND deleted_at IS NULL`,
              [userId, item.accountKey, item.itemKey],
            )
          ).rows[0];
          mediaStatus = row ? (await this.dto(row)).mediaStatus : 'none';
          availability.set(key, mediaStatus);
        }
      }
      items.push({ ...item, mediaStatus });
    }
    return LegacyFavoritesEndpoints.import.response.parse({ ...result, items });
  }
  private async prepareAttachments(
    userId: string,
    items: LegacyFavoriteImportItem[],
  ): Promise<PreparedAttachment[]> {
    const prepared: PreparedAttachment[] = [];
    for (const item of items) {
      if (!item.mediaId) {
        prepared.push(null);
        continue;
      }
      const existing = (
        await this.database.query<{ deleted_at: Date | null }>(
          'SELECT deleted_at FROM library.legacy_favorites WHERE user_id=$1 AND account_key=$2 AND item_key=$3',
          [userId, item.accountKey, item.itemKey],
        )
      ).rows[0];
      if (existing?.deleted_at) {
        prepared.push('removed');
        continue;
      }
      const attachment = attachmentOf(item.favorite);
      if (!attachment)
        throw new AppError('bad_request', '只有带原附件引用的图片或语音才能关联媒体');
      if (!(await this.media.canUse(userId, item.mediaId, attachment.purposes)))
        throw new AppError('forbidden', '附件不属于当前账号或用途不符');
      const prior = (
        await this.database.query<{ media_id: string }>(
          `SELECT media_id FROM library.legacy_favorite_media_links
        WHERE user_id=$1 AND reference_hash=$2 AND kind=$3`,
          [userId, hash(attachment.reference), attachment.kind],
        )
      ).rows[0];
      const priorUsable =
        !!prior &&
        (prior.media_id === item.mediaId ||
          (await this.media.canUse(userId, prior.media_id, attachment.purposes)));
      prepared.push({
        ...attachment,
        mediaId: item.mediaId,
        priorId: prior?.media_id ?? null,
        priorUsable,
      });
    }
    return prepared;
  }
  async list(userId: string, input: { cursor?: string; limit: number }) {
    const query = parseContract(LegacyFavoritesEndpoints.list.query!, input),
      cursor = cursorValue(query.cursor);
    const rows = await this.database.transaction(async (tx) => {
      await this.active(tx, userId);
      const parameters: unknown[] = [userId];
      const after = cursor ? ' AND (saved_at,id)<($2::timestamptz,$3::uuid)' : '';
      if (cursor) parameters.push(cursor.at, cursor.id);
      parameters.push(query.limit + 1);
      return (
        await tx.query<Row>(
          `SELECT * FROM library.legacy_favorites
        WHERE user_id=$1 AND deleted_at IS NULL${after} ORDER BY saved_at DESC,id DESC LIMIT $${parameters.length}`,
          parameters,
        )
      ).rows;
    });
    const page = rows.slice(0, query.limit),
      items: LegacyFavorite[] = [];
    for (const row of page) items.push(await this.dto(row));
    return LegacyFavoritesEndpoints.list.response.parse({
      items,
      nextCursor: rows.length > query.limit ? cursorOf(page.at(-1)!) : null,
    });
  }
  private async openSnapshot(row: Row, tx?: DbTx): Promise<StoredSnapshot> {
    if (!row.snapshot_ciphertext) throw new AppError('not_found', '收藏不存在');
    const plain = await this.crypto.open(
      row.user_id,
      `library:legacy-favorite:${row.id}`,
      row.snapshot_ciphertext,
      tx,
    );
    try {
      return StoredSnapshot.parse(JSON.parse(plain.toString('utf8')));
    } finally {
      plain.fill(0);
    }
  }
  private async dto(row: Row): Promise<LegacyFavorite> {
    const stored = await this.openSnapshot(row),
      favorite = stored.favorite;
    const message = favorite.message,
      type = message.type ?? 'text';
    const attachment = attachmentOf(favorite);
    let media: LegacyFavorite['media'] = null;
    if (attachment) {
      const link = (
        await this.database.query<{ media_id: string }>(
          `SELECT media_id FROM library.legacy_favorite_media_links
        WHERE user_id=$1 AND reference_hash=$2 AND kind=$3`,
          [row.user_id, hash(attachment.reference), attachment.kind],
        )
      ).rows[0];
      if (link && (await this.media.canUse(row.user_id, link.media_id, attachment.purposes))) {
        media = {
          kind: attachment.kind,
          mediaId: link.media_id,
          durationMs:
            attachment.kind === 'voice' && message.duration != null
              ? Math.round(message.duration * 1000)
              : null,
        };
      }
    }
    // Keep text/transcripts, but never disclose known raw attachment/avatar references through a caption or quote.
    const references = [message.imageUrl, message.audioPath, message.avatar].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const displayText = (value: string) =>
      references.reduce((text, raw) => text.replaceAll(raw, '[旧附件]'), value);
    const knownText = ['text', 'system', 'call', 'voice', 'image', 'sticker'].includes(type);
    // The original attachment paths and all extension fields remain in the encrypted snapshot only.
    return LegacyFavorite.parse({
      favoriteId: row.id,
      accountKey: row.account_key,
      itemKey: row.item_key,
      chatTitle: displayText(favorite.chatTitle),
      savedAt: row.saved_at.toISOString(),
      importedAt: row.imported_at.toISOString(),
      message: {
        author: displayText(message.author ?? ''),
        type,
        content: knownText ? displayText(message.content ?? '') : '',
        isMine: message.isMine ?? false,
        timestamp: message.timestamp == null ? null : String(message.timestamp),
        duration: message.duration ?? null,
        quotedAuthor: message.quotedAuthor == null ? null : displayText(message.quotedAuthor),
        quotedContent: message.quotedContent == null ? null : displayText(message.quotedContent),
      },
      media,
      mediaStatus: ['text', 'system', 'call'].includes(type)
        ? 'none'
        : media
          ? 'ready'
          : 'unavailable',
      mediaIssue:
        ['text', 'system', 'call'].includes(type) || media
          ? null
          : (stored.mediaIssue ?? (knownText ? 'media_unavailable' : 'unsupported_media')),
    });
  }
  async remove(userId: string, favoriteId: string): Promise<void> {
    parseContract(Id, favoriteId);
    await this.database.transaction(async (tx) => {
      await this.lock(tx, userId);
      await this.active(tx, userId);
      const row = (
        await tx.query<Row>('SELECT * FROM library.legacy_favorites WHERE id=$1 AND user_id=$2', [
          favoriteId,
          userId,
        ])
      ).rows[0];
      if (!row) throw new AppError('not_found', '收藏不存在');
      if (row.deleted_at) return;
      await tx.query(
        'UPDATE library.legacy_favorites SET snapshot_ciphertext=NULL,deleted_at=$2 WHERE id=$1',
        [favoriteId, this.clock.now()],
      );
      await this.changed(tx, userId, favoriteId);
    });
  }
  private async changed(tx: DbTx, userId: string, itemId: string | null): Promise<void> {
    await this.sync.appendUpdate(tx, userId, {
      type: 'data.changed',
      data: { section: 'favorites', characterId: null, itemId },
    });
  }
  async purgeUser(userId: string, tx: DbTx): Promise<number> {
    await this.lock(tx, userId);
    let count = 0;
    for (const table of [
      'legacy_favorites',
      'legacy_favorite_sources',
      'legacy_favorite_media_links',
    ]) {
      count +=
        (await tx.query(`DELETE FROM library.${table} WHERE user_id=$1`, [userId])).rowCount ?? 0;
    }
    return count;
  }
  async countUserData(userId: string): Promise<number> {
    const result = await this.database.query<{ n: number }>(
      `SELECT (
      (SELECT count(*) FROM library.legacy_favorites WHERE user_id=$1)+
      (SELECT count(*) FROM library.legacy_favorite_sources WHERE user_id=$1)+
      (SELECT count(*) FROM library.legacy_favorite_media_links WHERE user_id=$1))::int AS n`,
      [userId],
    );
    return result.rows[0]!.n;
  }
}
