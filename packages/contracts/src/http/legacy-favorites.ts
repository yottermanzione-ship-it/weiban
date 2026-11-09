/** 7.9：旧安卓仅本机收藏的受保护承接。与普通收藏端点分开，旧客户端不受影响。 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, cursorPage, defineEndpoint } from '../common.js';

export const LegacyFavoriteAccountKey = z.string().regex(/^[a-z0-9]{4,20}$/);
export const LegacyFavoriteItemKey = z.string().regex(/^[a-f0-9]{64}$/);
export const LegacyFavoriteMediaIssue = z.enum([
  'remote_reference',
  'file_missing',
  'media_unavailable',
  'path_rejected',
  'unsupported_media',
  'media_too_large',
  'item_ambiguous',
  'upload_limit_exceeded',
]);
const nullableText = (max: number) => z.string().max(max).nullable().optional();

/** 保留旧 ChatMessage.toMap 的已知字段和扩展 JSON，禁止导入过程中静默丢字段。 */
export const LegacyFavoriteMessageSnapshot = z
  .object({
    author: nullableText(200),
    avatar: nullableText(4096),
    content: nullableText(200_000),
    isMine: z.boolean().nullable().optional(),
    type: nullableText(64),
    duration: z.number().finite().nonnegative().max(86400).nullable().optional(),
    imageUrl: nullableText(4096),
    isLocal: z.boolean().optional(),
    mentionMe: z.boolean().optional(),
    quotedAuthor: nullableText(200),
    quotedContent: nullableText(200_000),
    timestamp: z
      .union([z.number().int().safe(), z.string().max(80)])
      .nullable()
      .optional(),
    audioPath: nullableText(4096),
    serverJobId: z
      .union([z.string().max(200), z.number().int().safe()])
      .nullable()
      .optional(),
    serverSeq: z
      .union([z.string().max(200), z.number().int().safe()])
      .nullable()
      .optional(),
    clientMessageId: nullableText(200),
    stickerId: z
      .union([z.string().max(200), z.number().int().safe()])
      .nullable()
      .optional(),
    sendState: nullableText(64),
  })
  .catchall(z.json());

export const LegacyFavoriteSnapshot = z
  .object({
    chatKey: z.string().min(1).max(200),
    chatTitle: z.string().max(200),
    savedAt: z.number().int().safe().min(0).max(253402300799999),
    message: LegacyFavoriteMessageSnapshot,
  })
  .strict();

export const LegacyFavoriteImportItem = z
  .object({
    accountKey: LegacyFavoriteAccountKey,
    itemKey: LegacyFavoriteItemKey,
    favorite: LegacyFavoriteSnapshot,
    /** 先通过现有媒体接口上传本人旧附件；服务端仍须校验归属、用途和原快照引用。 */
    mediaId: Id.optional(),
    /** 固定原因类别；只用于显示未完成附件，不能改变归属/可用性判定。 */
    mediaIssue: LegacyFavoriteMediaIssue.optional(),
  })
  .strict();

export const LegacyFavoriteImportRequest = z
  .object({
    items: z.array(LegacyFavoriteImportItem).min(1).max(25),
  })
  .strict()
  .superRefine((value, context) => {
    // Also compiles without Node/DOM globals. JSON.stringify escapes lone surrogates.
    let bytes = 0;
    for (const character of JSON.stringify(value)) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes > 512 * 1024) break;
    }
    if (bytes > 512 * 1024)
      context.addIssue({ code: 'custom', message: '收藏批次过大，请分批迁入' });
  });

/** 不返回旧文件路径或未经验证的外部URL；仅已验证归属的媒体可展示。 */
export const LegacyFavorite = z.object({
  favoriteId: Id,
  accountKey: LegacyFavoriteAccountKey,
  itemKey: LegacyFavoriteItemKey,
  chatTitle: z.string().max(200),
  savedAt: Timestamp,
  importedAt: Timestamp,
  message: z.object({
    author: z.string().max(200),
    type: z.string().max(64),
    content: z.string().max(200_000),
    isMine: z.boolean(),
    timestamp: z.string().max(80).nullable(),
    duration: z.number().finite().nonnegative().max(86400).nullable(),
    quotedAuthor: z.string().max(200).nullable(),
    quotedContent: z.string().max(200_000).nullable(),
  }),
  media: z
    .object({
      kind: z.enum(['image', 'voice']),
      mediaId: Id,
      durationMs: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  mediaStatus: z.enum(['none', 'ready', 'unavailable']),
  mediaIssue: LegacyFavoriteMediaIssue.nullable(),
});
export type LegacyFavorite = z.infer<typeof LegacyFavorite>;
export type LegacyFavoriteSnapshot = z.infer<typeof LegacyFavoriteSnapshot>;
export type LegacyFavoriteImportItem = z.infer<typeof LegacyFavoriteImportItem>;

export const LegacyFavoritesEndpoints = {
  source: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/library/legacy-favorites/source`,
    auth: 'user',
    response: z.object({
      userId: Id,
      legacyAccountKeys: z.array(LegacyFavoriteAccountKey).max(8),
      available: z.boolean(),
    }),
    summary: '仅返回已核实归属当前账号的旧安卓收藏分区；不按当前昵称或客户端自报用户名猜测',
  }),
  import: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/library/legacy-favorites/import`,
    auth: 'user',
    body: LegacyFavoriteImportRequest,
    response: z.object({
      imported: z.number().int().nonnegative(),
      existing: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      items: z
        .array(
          z.object({
            accountKey: LegacyFavoriteAccountKey,
            itemKey: LegacyFavoriteItemKey,
            status: z.enum(['imported', 'existing', 'removed']),
            mediaStatus: z.enum(['none', 'ready', 'unavailable']),
          }),
        )
        .max(25),
    }),
    summary: '批次内原子承接旧收藏加密快照；稳定来源去重，取消收藏后不因重装恢复，不触发成就或收费',
  }),
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/library/legacy-favorites`,
    auth: 'user',
    query: z.object({
      cursor: z.string().max(300).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    response: cursorPage(LegacyFavorite),
    summary: '当前账号承接的旧收藏，按原收藏时间倒序',
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/library/legacy-favorites/:favoriteId`,
    auth: 'user',
    params: z.object({ favoriteId: Id }),
    response: NoContent,
    summary: '删除收藏密文，保留来源去重标记防止旧手机再次上传；注销时标记也删除',
  }),
} as const;
