/**
 * 素材库（ADM-04 第 1～3 条）与用户自定义表情（MED-01 第 3 条）。契约：http/assets.ts、ports/media.ts MediaAssetReadPort。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import {
  AdminVoiceWrite,
  CardTemplateWrite,
  StickerAdminEndpoints,
  StickerPackWrite,
  USER_STICKER_LIMIT,
  type AdminVoice,
  type CardTemplate,
  type LibrarySticker,
  type MediaAssetReadPort,
  type StickerPack,
  type UserSticker,
  type Voice,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  AppError,
  newId,
  parseContract,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import {
  cardTemplates,
  libraryStickers,
  objects,
  stickerPacks,
  userStickers,
  voices,
} from '../infra/db/schema.js';
import {
  MEDIA_MESSAGE_LOOKUP,
  MEDIA_REAL_PERSON_NAMES,
  type MediaMessageLookup,
  type MediaRealPersonNames,
  type MediaStickerCheck,
} from '../tokens.js';
import { MediaService } from './media.js';

type PackRow = typeof stickerPacks.$inferSelect;
type VoiceRow = typeof voices.$inferSelect;
type TemplateRow = typeof cardTemplates.$inferSelect;

/** 比较名称时去掉空白、中间点、大小写差异（「杨 幂」「杨·幂」都算含「杨幂」）。 */
function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·・•.\-_—]/g, '');
}

@Injectable()
export class MediaAssetService implements MediaAssetReadPort, MediaStickerCheck {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(MediaService) private readonly media: MediaService,
    @Optional()
    @Inject(MEDIA_MESSAGE_LOOKUP)
    private readonly messages: MediaMessageLookup | null = null,
    @Optional()
    @Inject(MEDIA_REAL_PERSON_NAMES)
    private readonly realPeople: MediaRealPersonNames | null = null,
  ) {}

  // ---------- 表情包库 ----------

  private async packsWithStickers(rows: PackRow[], viewerId: string): Promise<StickerPack[]> {
    if (!rows.length) return [];
    const stickers = await this.database.db
      .select()
      .from(libraryStickers)
      .where(
        and(
          inArray(
            libraryStickers.packId,
            rows.map((r) => r.id),
          ),
          isNull(libraryStickers.deletedAt),
        ),
      )
      .orderBy(asc(libraryStickers.sortOrder), asc(libraryStickers.createdAt));
    const out: StickerPack[] = [];
    for (const pack of rows) {
      const items: LibrarySticker[] = [];
      for (const s of stickers.filter((x) => x.packId === pack.id)) {
        const url = await this.media.urlFor(viewerId, s.mediaId);
        if (!url) continue;
        items.push({
          stickerId: s.id,
          mediaId: s.mediaId,
          url,
          description: s.description,
          packId: pack.id,
        });
      }
      out.push({
        packId: pack.id,
        name: pack.name,
        characterIds: pack.characterIds,
        userVisible: pack.userVisible,
        enabled: pack.enabled,
        stickers: items,
        updatedAt: pack.updatedAt.toISOString(),
      });
    }
    return out;
  }

  async listUserPacks(userId: string): Promise<{ items: StickerPack[] }> {
    const rows = await this.database.db
      .select()
      .from(stickerPacks)
      .where(and(eq(stickerPacks.enabled, true), eq(stickerPacks.userVisible, true)))
      .orderBy(asc(stickerPacks.createdAt));
    return { items: await this.packsWithStickers(rows, userId) };
  }

  async adminListPacks(adminId: string): Promise<{ items: StickerPack[] }> {
    const rows = await this.database.db
      .select()
      .from(stickerPacks)
      .orderBy(asc(stickerPacks.createdAt));
    return { items: await this.packsWithStickers(rows, adminId) };
  }

  private async onePack(adminId: string, packId: string): Promise<StickerPack> {
    const [row] = await this.database.db
      .select()
      .from(stickerPacks)
      .where(eq(stickerPacks.id, packId));
    if (!row) throw new AppError('not_found', '表情包分类不存在');
    const [pack] = await this.packsWithStickers([row], adminId);
    return pack!;
  }

  async createPack(adminId: string, input: unknown): Promise<StickerPack> {
    const body = parseContract(StickerPackWrite, input);
    const id = newId();
    const at = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx.db.insert(stickerPacks).values({
        id,
        name: body.name,
        characterIds: [...new Set(body.characterIds)],
        userVisible: body.userVisible,
        enabled: body.enabled,
        createdAt: at,
        updatedAt: at,
      });
      await this.auditAdmin(tx, adminId, 'sticker_pack.created', 'sticker_pack', id, {
        name: body.name,
      });
    });
    return this.onePack(adminId, id);
  }

  async updatePack(adminId: string, packId: string, input: unknown): Promise<StickerPack> {
    const body = parseContract(StickerPackWrite.partial(), input);
    await this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .update(stickerPacks)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.characterIds !== undefined
            ? { characterIds: [...new Set(body.characterIds)] }
            : {}),
          ...(body.userVisible !== undefined ? { userVisible: body.userVisible } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          updatedAt: this.clock.now(),
        })
        .where(eq(stickerPacks.id, packId))
        .returning();
      if (!row) throw new AppError('not_found', '表情包分类不存在');
      await this.auditAdmin(tx, adminId, 'sticker_pack.updated', 'sticker_pack', packId, {
        fields: Object.keys(body),
      });
    });
    return this.onePack(adminId, packId);
  }

  async addLibrarySticker(
    adminId: string,
    packId: string,
    input: unknown,
  ): Promise<LibrarySticker> {
    const body = parseContract(StickerAdminEndpoints.addSticker.body!, input) as {
      mediaId: string;
      description: string;
      confirmNoRealPersonPortrait: true;
    };
    if (body.confirmNoRealPersonPortrait !== true)
      throw new AppError('bad_request', '请确认不含真人本人肖像');
    const media = await this.media.findReady(body.mediaId);
    if (!media || media.purpose !== 'sticker_library')
      throw new AppError('bad_request', '请先以 sticker_library 用途上传表情图片');
    const id = newId();
    await this.database.transaction(async (tx) => {
      const [pack] = await tx.db.select().from(stickerPacks).where(eq(stickerPacks.id, packId));
      if (!pack) throw new AppError('not_found', '表情包分类不存在');
      const [n] = await tx.db
        .select({ n: count() })
        .from(libraryStickers)
        .where(eq(libraryStickers.packId, packId));
      await tx.db.insert(libraryStickers).values({
        id,
        packId,
        mediaId: body.mediaId,
        description: body.description,
        sortOrder: n?.n ?? 0,
        confirmedBy: adminId,
        createdAt: this.clock.now(),
        deletedAt: null,
      });
      await tx.db
        .update(stickerPacks)
        .set({ updatedAt: this.clock.now() })
        .where(eq(stickerPacks.id, packId));
      // 审计记录管理员的真人肖像确认（ADM-04 第 1 条）。
      await this.auditAdmin(tx, adminId, 'sticker.added', 'sticker', id, {
        packId,
        mediaId: body.mediaId,
        confirmNoRealPersonPortrait: true,
      });
    });
    return {
      stickerId: id,
      mediaId: body.mediaId,
      url: (await this.media.urlFor(adminId, body.mediaId))!,
      description: body.description,
      packId,
    };
  }

  async deleteLibrarySticker(adminId: string, stickerId: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .update(libraryStickers)
        .set({ deletedAt: this.clock.now() })
        .where(and(eq(libraryStickers.id, stickerId), isNull(libraryStickers.deletedAt)))
        .returning();
      if (!row) throw new AppError('not_found', '表情不存在');
      await this.auditAdmin(tx, adminId, 'sticker.deleted', 'sticker', stickerId, {
        packId: row.packId,
      });
    });
  }

  // ---------- 用户自定义表情 ----------

  private async toUserSticker(
    userId: string,
    row: typeof userStickers.$inferSelect,
  ): Promise<UserSticker | null> {
    const url = await this.media.urlFor(userId, row.mediaId);
    if (!url) return null;
    return {
      stickerId: row.id,
      mediaId: row.mediaId,
      url,
      order: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listMyStickers(userId: string): Promise<{ items: UserSticker[] }> {
    const rows = await this.database.db
      .select()
      .from(userStickers)
      .where(eq(userStickers.userId, userId))
      .orderBy(asc(userStickers.sortOrder), asc(userStickers.createdAt));
    const items: UserSticker[] = [];
    for (const row of rows) {
      const item = await this.toUserSticker(userId, row);
      if (item) items.push(item);
    }
    return { items };
  }

  async addMySticker(
    userId: string,
    input:
      | { from: 'message'; conversationId: string; messageId: string }
      | { from: 'upload'; mediaId: string },
  ): Promise<UserSticker> {
    let sourceMediaId: string;
    if (input.from === 'message') {
      const found = this.messages
        ? await this.messages.findMessageMedia(userId, input.conversationId, input.messageId)
        : null;
      if (!found) throw new AppError('not_found', '找不到这条图片或表情消息');
      sourceMediaId = found.mediaId;
    } else {
      if (!(await this.media.canUse(userId, input.mediaId, ['user_sticker'])))
        throw new AppError('not_found', '找不到媒体');
      sourceMediaId = input.mediaId;
    }
    const source = await this.media.findReady(sourceMediaId);
    if (!source || !source.mimeType.startsWith('image/'))
      throw new AppError('bad_request', '只能把图片添加为表情');
    const [existing] = source.contentHash
      ? await this.database.db
          .select()
          .from(userStickers)
          .where(
            and(eq(userStickers.userId, userId), eq(userStickers.contentHash, source.contentHash)),
          )
      : [];
    if (existing) throw new AppError('conflict', '已经添加过了');
    const [n] = await this.database.db
      .select({ n: count() })
      .from(userStickers)
      .where(eq(userStickers.userId, userId));
    if ((n?.n ?? 0) >= USER_STICKER_LIMIT)
      throw new AppError('limit_reached', '表情已满', { details: { limit: USER_STICKER_LIMIT } });
    // 从消息添加：复制一份为本人的 user_sticker（原消息被删、对方注销都不影响）；上传的直接使用。
    const mediaId =
      input.from === 'message'
        ? (await this.media.copyRow(sourceMediaId, userId, 'user_sticker')).id
        : sourceMediaId;
    const id = newId();
    const at = this.clock.now();
    let row: typeof userStickers.$inferSelect | undefined;
    try {
      row = await this.database.transaction(async (tx) => {
        // 新添加的排在第一个（design media-l5.md 5.2）。
        await tx.query(
          'UPDATE media.user_stickers SET sort_order = sort_order + 1 WHERE user_id = $1',
          [userId],
        );
        const [inserted] = await tx.db
          .insert(userStickers)
          .values({
            id,
            userId,
            mediaId,
            contentHash: source.contentHash,
            sortOrder: 0,
            createdAt: at,
          })
          .returning();
        await this.stickersChanged(tx, userId, id);
        return inserted;
      });
    } catch (error) {
      if (input.from === 'message') await this.media.deleteObject(mediaId).catch(() => undefined);
      if ((error as { code?: string }).code === '23505')
        throw new AppError('conflict', '已经添加过了');
      throw error;
    }
    return (await this.toUserSticker(userId, row!))!;
  }

  async reorderMyStickers(userId: string, stickerIds: string[]): Promise<void> {
    await this.database.transaction(async (tx) => {
      const rows = await tx.db
        .select({ id: userStickers.id })
        .from(userStickers)
        .where(eq(userStickers.userId, userId));
      const mine = new Set(rows.map((r) => r.id));
      const ordered = [...new Set(stickerIds)].filter((id) => mine.has(id));
      // 没列出的排在后面，保持原有相对顺序。
      const rest = rows.map((r) => r.id).filter((id) => !ordered.includes(id));
      let i = 0;
      for (const id of [...ordered, ...rest])
        await tx.db
          .update(userStickers)
          .set({ sortOrder: i++ })
          .where(and(eq(userStickers.id, id), eq(userStickers.userId, userId)));
      await this.stickersChanged(tx, userId, null);
    });
  }

  async deleteMySticker(userId: string, stickerId: string): Promise<void> {
    const row = await this.database.transaction(async (tx) => {
      const [deleted] = await tx.db
        .delete(userStickers)
        .where(and(eq(userStickers.id, stickerId), eq(userStickers.userId, userId)))
        .returning();
      if (!deleted) throw new AppError('not_found', '表情不存在');
      await this.stickersChanged(tx, userId, stickerId);
      return deleted;
    });
    // 已发出的消息不受影响：消息里引用的 mediaId 仍保留，媒体对象不删；注销时随用户一起删除。
    void row;
  }

  private async stickersChanged(tx: DbTx, userId: string, itemId: string | null): Promise<void> {
    await this.media.appendUpdate(tx, userId, {
      type: 'data.changed',
      data: { section: 'stickers', characterId: null, itemId },
    });
  }

  /** chat 发送校验（MEDIA_STICKER_CHECK）。 */
  async canSendSticker(
    userId: string,
    input: { stickerId: string; source: 'library' | 'user'; mediaId: string },
  ): Promise<boolean> {
    if (input.source === 'user') {
      const [row] = await this.database.db
        .select()
        .from(userStickers)
        .where(and(eq(userStickers.id, input.stickerId), eq(userStickers.userId, userId)));
      return !!row && row.mediaId === input.mediaId;
    }
    const [row] = await this.database.db
      .select({ mediaId: libraryStickers.mediaId })
      .from(libraryStickers)
      .innerJoin(stickerPacks, eq(stickerPacks.id, libraryStickers.packId))
      .where(
        and(
          eq(libraryStickers.id, input.stickerId),
          isNull(libraryStickers.deletedAt),
          eq(stickerPacks.enabled, true),
          eq(stickerPacks.userVisible, true),
        ),
      );
    return !!row && row.mediaId === input.mediaId;
  }

  // ---------- 音色库 ----------

  private async toAdminVoice(row: VoiceRow, viewerId: string): Promise<AdminVoice> {
    return {
      voiceId: row.id,
      name: row.name,
      tags: row.tags,
      sampleMediaId: row.sampleMediaId,
      sampleUrl: row.sampleMediaId ? await this.media.urlFor(viewerId, row.sampleMediaId) : null,
      enabled: row.enabled,
      providerVoiceKey: row.providerVoiceKey,
      modelKey: row.modelKey,
      careFallbackMediaId: row.careFallbackMediaId,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listUserVoices(userId: string): Promise<{ items: Voice[] }> {
    const rows = await this.database.db
      .select()
      .from(voices)
      .where(eq(voices.enabled, true))
      .orderBy(asc(voices.createdAt));
    const items: Voice[] = [];
    for (const row of rows) {
      const v = await this.toAdminVoice(row, userId);
      items.push({
        voiceId: v.voiceId,
        name: v.name,
        tags: v.tags,
        sampleMediaId: v.sampleMediaId,
        sampleUrl: v.sampleUrl,
        enabled: v.enabled,
      });
    }
    return { items };
  }

  async adminListVoices(adminId: string): Promise<{ items: AdminVoice[] }> {
    const rows = await this.database.db.select().from(voices).orderBy(asc(voices.createdAt));
    const items: AdminVoice[] = [];
    for (const row of rows) items.push(await this.toAdminVoice(row, adminId));
    return { items };
  }

  /** ADM-04 第 2 条：音色名称中出现已录入真人角色的姓名时无法保存。 */
  private async assertVoiceName(name: string): Promise<void> {
    const normalized = normalizeName(name);
    const names = this.realPeople ? await this.realPeople.listRealPersonNames() : [];
    for (const person of names) {
      const n = normalizeName(person);
      if (n.length >= 2 && normalized.includes(n))
        throw new AppError('bad_request', '音色名称不能包含真人角色的姓名', {
          details: { field: 'name' },
        });
    }
  }

  private async assertMediaPurpose(mediaId: string | null | undefined, purpose: string) {
    if (!mediaId) return;
    const row = await this.media.findReady(mediaId);
    if (!row || row.purpose !== purpose)
      throw new AppError('bad_request', `请先以 ${purpose} 用途上传文件`);
  }

  async createVoice(adminId: string, input: unknown): Promise<AdminVoice> {
    const body = parseContract(AdminVoiceWrite, input);
    await this.assertVoiceName(body.name);
    await this.assertMediaPurpose(body.sampleMediaId, 'voice_sample');
    await this.assertMediaPurpose(body.careFallbackMediaId, 'voice_sample');
    const id = newId();
    const at = this.clock.now();
    const row = await this.database.transaction(async (tx) => {
      const [inserted] = await tx.db
        .insert(voices)
        .values({
          id,
          name: body.name,
          tags: body.tags,
          sampleMediaId: body.sampleMediaId,
          providerVoiceKey: body.providerVoiceKey,
          modelKey: body.modelKey,
          careFallbackMediaId: body.careFallbackMediaId,
          enabled: body.enabled,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      await this.auditAdmin(tx, adminId, 'voice.created', 'voice', id, { name: body.name });
      return inserted!;
    });
    return this.toAdminVoice(row, adminId);
  }

  async updateVoice(adminId: string, voiceId: string, input: unknown): Promise<AdminVoice> {
    const body = parseContract(AdminVoiceWrite.partial(), input);
    if (body.name !== undefined) await this.assertVoiceName(body.name);
    await this.assertMediaPurpose(body.sampleMediaId, 'voice_sample');
    await this.assertMediaPurpose(body.careFallbackMediaId, 'voice_sample');
    const row = await this.database.transaction(async (tx) => {
      const [updated] = await tx.db
        .update(voices)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
          ...(body.sampleMediaId !== undefined ? { sampleMediaId: body.sampleMediaId } : {}),
          ...(body.providerVoiceKey !== undefined
            ? { providerVoiceKey: body.providerVoiceKey }
            : {}),
          ...(body.modelKey !== undefined ? { modelKey: body.modelKey } : {}),
          ...(body.careFallbackMediaId !== undefined
            ? { careFallbackMediaId: body.careFallbackMediaId }
            : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          updatedAt: this.clock.now(),
        })
        .where(eq(voices.id, voiceId))
        .returning();
      if (!updated) throw new AppError('not_found', '音色不存在');
      await this.auditAdmin(tx, adminId, 'voice.updated', 'voice', voiceId, {
        fields: Object.keys(body),
      });
      return updated;
    });
    return this.toAdminVoice(row, adminId);
  }

  // ---------- 卡面模板 ----------

  private async toTemplate(row: TemplateRow, viewerId: string): Promise<CardTemplate | null> {
    const url = await this.media.urlFor(viewerId, row.mediaId);
    if (!url) return null;
    return {
      templateId: row.id,
      name: row.name,
      kinds: row.kinds as CardTemplate['kinds'],
      mediaId: row.mediaId,
      url,
      portraitFree: row.portraitFree,
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async adminListTemplates(adminId: string): Promise<{ items: CardTemplate[] }> {
    const rows = await this.database.db
      .select()
      .from(cardTemplates)
      .orderBy(asc(cardTemplates.createdAt));
    const items: CardTemplate[] = [];
    for (const row of rows) {
      const t = await this.toTemplate(row, adminId);
      if (t) items.push(t);
    }
    return { items };
  }

  async createTemplate(adminId: string, input: unknown): Promise<CardTemplate> {
    const body = parseContract(CardTemplateWrite, input);
    await this.assertMediaPurpose(body.mediaId, 'card_template');
    const id = newId();
    const at = this.clock.now();
    const row = await this.database.transaction(async (tx) => {
      const [inserted] = await tx.db
        .insert(cardTemplates)
        .values({
          id,
          name: body.name,
          kinds: [...new Set(body.kinds)],
          mediaId: body.mediaId,
          portraitFree: body.portraitFree,
          enabled: body.enabled,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      await this.auditAdmin(tx, adminId, 'card_template.created', 'card_template', id, {
        name: body.name,
      });
      return inserted!;
    });
    return (await this.toTemplate(row, adminId))!;
  }

  async updateTemplate(adminId: string, templateId: string, input: unknown): Promise<CardTemplate> {
    const body = parseContract(CardTemplateWrite.partial(), input);
    if (body.mediaId !== undefined) await this.assertMediaPurpose(body.mediaId, 'card_template');
    const row = await this.database.transaction(async (tx) => {
      const [updated] = await tx.db
        .update(cardTemplates)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.kinds !== undefined ? { kinds: [...new Set(body.kinds)] } : {}),
          ...(body.mediaId !== undefined ? { mediaId: body.mediaId } : {}),
          ...(body.portraitFree !== undefined ? { portraitFree: body.portraitFree } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          updatedAt: this.clock.now(),
        })
        .where(eq(cardTemplates.id, templateId))
        .returning();
      if (!updated) throw new AppError('not_found', '卡面模板不存在');
      await this.auditAdmin(tx, adminId, 'card_template.updated', 'card_template', templateId, {
        fields: Object.keys(body),
      });
      return updated;
    });
    const out = await this.toTemplate(row, adminId);
    if (!out) throw new AppError('not_found', '卡面模板图片不存在');
    return out;
  }

  // ---------- MediaAssetReadPort ----------

  async listStickersForCharacter(
    characterId: string,
  ): Promise<Array<{ stickerId: string; mediaId: string; description: string }>> {
    const packs = await this.database.db
      .select()
      .from(stickerPacks)
      .where(eq(stickerPacks.enabled, true));
    const usable = packs
      .filter((p) => p.characterIds.length === 0 || p.characterIds.includes(characterId))
      .map((p) => p.id);
    if (!usable.length) return [];
    const rows = await this.database.db
      .select({
        stickerId: libraryStickers.id,
        mediaId: libraryStickers.mediaId,
        description: libraryStickers.description,
      })
      .from(libraryStickers)
      .innerJoin(objects, eq(objects.id, libraryStickers.mediaId))
      .where(
        and(
          inArray(libraryStickers.packId, usable),
          isNull(libraryStickers.deletedAt),
          eq(objects.state, 'ready'),
        ),
      )
      .orderBy(asc(libraryStickers.sortOrder));
    return rows;
  }

  async getVoice(voiceId: string): Promise<{
    voiceId: string;
    name: string;
    providerVoiceKey: string;
    modelKey: string;
    enabled: boolean;
    careFallbackMediaId: string | null;
  } | null> {
    const [row] = await this.database.db.select().from(voices).where(eq(voices.id, voiceId));
    if (!row) return null;
    return {
      voiceId: row.id,
      name: row.name,
      providerVoiceKey: row.providerVoiceKey,
      modelKey: row.modelKey,
      enabled: row.enabled,
      careFallbackMediaId: row.careFallbackMediaId,
    };
  }

  async listCardTemplates(
    kind: string,
    portraitFreeOnly: boolean,
  ): Promise<Array<{ templateId: string; mediaId: string }>> {
    const rows = await this.database.db
      .select()
      .from(cardTemplates)
      .where(eq(cardTemplates.enabled, true))
      .orderBy(asc(cardTemplates.createdAt));
    return rows
      .filter((r) => r.kinds.includes(kind) && (!portraitFreeOnly || r.portraitFree))
      .map((r) => ({ templateId: r.id, mediaId: r.mediaId }));
  }

  private async auditAdmin(
    tx: DbTx,
    adminId: string,
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      {
        module: 'media',
        action,
        actorType: 'admin',
        actorId: adminId,
        targetType,
        targetId,
        details,
      },
      tx,
    );
  }
}
