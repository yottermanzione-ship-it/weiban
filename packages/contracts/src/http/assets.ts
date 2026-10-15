/**
 * media 模块 3.0：素材库（ADM-04 第 1～3 条，D-L5-01、D-L5-02）——表情包库、用户自定义表情、音色库、卡面模板。
 * 文件本体都是 media 对象（见 http/media.ts 的用途）；这里是素材的元数据。数据归 media。
 * 宠物图鉴归 growth（http/pets.ts），每日一问题库归 play（http/play.ts）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint } from '../common.js';

// ---------- 表情包 ----------

/** 表情包库中的一个表情（MED-01 第 2 条）。不得包含真人本人肖像（上传时管理员确认）。 */
export const LibrarySticker = z.object({
  stickerId: Id,
  mediaId: Id,
  url: z.url(),
  /** 含义，例「捂脸笑」，供无识图能力时理解（MED-01 第 3 条）。 */
  description: z.string().min(1).max(40),
  packId: Id,
});
export type LibrarySticker = z.infer<typeof LibrarySticker>;

export const StickerPack = z.object({
  packId: Id,
  name: z.string().min(1).max(20),
  /** 只给这些角色用；空数组 = 所有角色可用（ADM-04 第 1 条「指定给哪些角色使用」）。 */
  characterIds: z.array(Id),
  /** 用户输入框表情面板是否显示此包。 */
  userVisible: z.boolean(),
  enabled: z.boolean(),
  stickers: z.array(LibrarySticker),
  updatedAt: Timestamp,
  /** 3.15（总对照表 Q2）：是否在表情商店上架。旧服务器不返回时按 false。 */
  inStore: z.boolean().optional(),
  /** 3.15：商店排序（小的在前）。 */
  storeOrder: z.number().int().optional(),
  /** 3.15：商店简介。 */
  intro: z.string().max(100).optional(),
  /** 3.15：商店封面用哪个表情（null = 第一个）。 */
  coverStickerId: Id.nullable().optional(),
  /** 3.15：用户端——这个包是我从商店添加的（false = 平台默认显示的包）。 */
  addedFromStore: z.boolean().optional(),
});
export type StickerPack = z.infer<typeof StickerPack>;

/** 用户自己添加的表情（MED-01 第 3 条，「我 → 表情」）。上限 300 个。 */
export const UserSticker = z.object({
  stickerId: Id,
  mediaId: Id,
  url: z.url(),
  order: z.number().int().nonnegative(),
  createdAt: Timestamp,
});
export type UserSticker = z.infer<typeof UserSticker>;
export const USER_STICKER_LIMIT = 300 as const;

export const StickerEndpoints = {
  listPacks: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/stickers/packs`,
    auth: 'user',
    response: z.object({ items: z.array(StickerPack) }),
    summary:
      '用户可用的内置表情包（userVisible 且 enabled）；3.15 起也包含我从表情商店添加的包（addedFromStore = true，排在后面）',
  }),
  listMyStickers: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/stickers`,
    auth: 'user',
    response: z.object({ items: z.array(UserSticker) }),
    summary: '我添加的表情（按 order）',
  }),
  addMySticker: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/me/stickers`,
    auth: 'user',
    body: z.discriminatedUnion('from', [
      /** 「添加到表情」：从收到的图片 / 表情消息添加，服务器复制一份为 user_sticker。 */
      z.object({ from: z.literal('message'), conversationId: Id, messageId: Id }),
      /** 从相册上传后添加（先 POST /media?purpose=user_sticker）。 */
      z.object({ from: z.literal('upload'), mediaId: Id }),
    ]),
    response: UserSticker,
    summary:
      '添加到我的表情；超过 300 个返回 422 limit_reached；成人模式 / 「健康」标记的消息也可添加（只对自己可见）',
  }),
  reorderMyStickers: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/me/stickers/order`,
    auth: 'user',
    body: z.object({ stickerIds: z.array(Id).max(USER_STICKER_LIMIT) }),
    response: NoContent,
    summary: '整理表情顺序',
  }),
  deleteMySticker: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/me/stickers/:stickerId`,
    auth: 'user',
    params: z.object({ stickerId: Id }),
    response: NoContent,
    summary: '删除我的表情（已发出的消息不受影响）',
  }),
} as const;

export const StickerPackWrite = z.object({
  name: z.string().min(1).max(20),
  characterIds: z.array(Id),
  userVisible: z.boolean(),
  enabled: z.boolean(),
  /** 3.15：商店上架 / 下架（下架后已添加的用户仍可使用；停用 enabled = false 才对所有人不可用）。 */
  inStore: z.boolean().optional(),
  storeOrder: z.number().int().min(0).max(100_000).optional(),
  intro: z.string().trim().max(100).optional(),
  coverStickerId: Id.nullable().optional(),
});

// ---------- 3.15：表情商店（总对照表 Q2，节点 T1.13.3） ----------

/** 商店里的一个表情包（列表卡片）。 */
export const StickerStorePack = z.object({
  packId: Id,
  name: z.string().min(1).max(20),
  intro: z.string().max(100),
  /** 封面（封面表情或第一个表情）的短期链接；包里没有表情时为 null。 */
  coverUrl: z.url().nullable(),
  stickerCount: z.number().int().nonnegative(),
  /** 我是否已添加（平台默认显示的包也算已添加，不能移除）。 */
  added: z.boolean(),
  /** 平台默认显示的包（userVisible）：人人都有，不需要添加。 */
  builtIn: z.boolean(),
  /** 停用包仍可在安装管理中移除，但不能发送。 */
  enabled: z.boolean(),
  inStore: z.boolean(),
  updatedAt: Timestamp,
});
export type StickerStorePack = z.infer<typeof StickerStorePack>;

export const StickerStorePackDetail = StickerStorePack.extend({
  stickers: z.array(LibrarySticker),
});
export type StickerStorePackDetail = z.infer<typeof StickerStorePackDetail>;

const StorePackParams = z.object({ packId: Id });

export const StickerStoreEndpoints = {
  listAdded: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/sticker-packs`,
    auth: 'user',
    response: z.object({ items: z.array(StickerStorePack) }),
    summary: '安装管理（含停用或下架的已添加包）；发送列表仍过滤停用包',
  }),
  listPacks: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/sticker-store/packs`,
    auth: 'user',
    response: z.object({ items: z.array(StickerStorePack) }),
    summary: '3.15：表情商店列表（已上架且启用的包，按后台排序）',
  }),
  getPack: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/sticker-store/packs/:packId`,
    auth: 'user',
    params: StorePackParams,
    response: StickerStorePackDetail,
    summary: '3.15：表情包详情（全部表情）；未上架且我没添加过的 404',
  }),
  addPack: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/me/sticker-packs/:packId`,
    auth: 'user',
    params: StorePackParams,
    response: StickerStorePackDetail,
    summary:
      '3.15：添加到我的表情（免费；已添加幂等）。未上架或已停用 404。之后 GET /stickers/packs 会包含它，发 data.changed(stickers)',
  }),
  removePack: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/me/sticker-packs/:packId`,
    auth: 'user',
    params: StorePackParams,
    response: NoContent,
    summary:
      '3.15：移除我添加的表情包（已发出的消息不受影响；没添加过也返回 204）；发 data.changed(stickers)',
  }),
  reorderMyPacks: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/me/sticker-packs/order`,
    auth: 'user',
    body: z.object({ packIds: z.array(Id).max(200) }),
    response: NoContent,
    summary: '3.15：整理我添加的表情包顺序（只排我添加的；没列出的排在后面）',
  }),
} as const;

export const StickerStoreAdminEndpoints = {
  reorderStore: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/stickers/store-order`,
    auth: 'admin',
    body: z.object({ packIds: z.array(Id).max(500) }),
    response: NoContent,
    summary:
      '3.15：表情商店排序（按给定顺序写 storeOrder = 0, 1, 2…）；上下架用 PATCH /admin/stickers/packs/:packId 的 inStore；写审计',
  }),
} as const;

export const StickerAdminEndpoints = {
  listPacks: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/stickers/packs`,
    auth: 'admin',
    response: z.object({ items: z.array(StickerPack) }),
    summary: '表情包库（含停用的）',
  }),
  createPack: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/stickers/packs`,
    auth: 'admin',
    body: StickerPackWrite,
    response: StickerPack,
    summary: '新建表情包分类',
  }),
  updatePack: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/stickers/packs/:packId`,
    auth: 'admin',
    params: z.object({ packId: Id }),
    body: StickerPackWrite.partial(),
    response: StickerPack,
    summary: '编辑分类、指定角色、启停',
  }),
  addSticker: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/stickers/packs/:packId/stickers`,
    auth: 'admin',
    params: z.object({ packId: Id }),
    body: z.object({
      mediaId: Id,
      description: z.string().trim().min(1).max(40),
      /** 管理员确认不含真人本人肖像（SAFE-01），必须为 true。 */
      confirmNoRealPersonPortrait: z.literal(true),
    }),
    response: LibrarySticker,
    summary: '向包里添加表情（先 POST /admin/media?purpose=sticker_library）；写审计',
  }),
  deleteSticker: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/stickers/:stickerId`,
    auth: 'admin',
    params: z.object({ stickerId: Id }),
    response: NoContent,
    summary: '删除表情（已发出的消息仍能显示）',
  }),
} as const;

// ---------- 音色库（MED-03 第 1 条、ADM-04 第 2 条） ----------

/** 非克隆的平台预置音色。名称不得含任何已录入真人角色的姓名（保存时检查，422 bad_request）。 */
export const Voice = z.object({
  voiceId: Id,
  name: z.string().min(1).max(20),
  /** 气质标签，例「温柔」「少年感」。 */
  tags: z.array(z.string().max(10)).max(8),
  /** 试听音频（purpose = voice_sample）：管理员上传或平台账户预先生成一次，用户试听不调用模型、不扣余额。 */
  sampleMediaId: Id.nullable(),
  sampleUrl: z.url().nullable(),
  enabled: z.boolean(),
});
export type Voice = z.infer<typeof Voice>;

export const AdminVoice = Voice.extend({
  /** 语音合成服务里的预置音色代号（只在管理端出现）。 */
  providerVoiceKey: z.string().min(1).max(64),
  /** 用于语音合成的模型（模型目录中带 voice_output 能力）。 */
  modelKey: z.string().min(1),
  /** 关怀兜底音频（AI 变更申请第 24 条②）：余额不足时通话中播放的固定关怀语音。 */
  careFallbackMediaId: Id.nullable(),
  updatedAt: Timestamp,
});
export type AdminVoice = z.infer<typeof AdminVoice>;

export const AdminVoiceWrite = AdminVoice.omit({
  voiceId: true,
  sampleUrl: true,
  updatedAt: true,
});

export const VoiceEndpoints = {
  listVoices: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/voices`,
    auth: 'user',
    response: z.object({ items: z.array(Voice) }),
    summary: '可选音色（角色设置中更换音色，MED-03 第 1 条）；平台未开通语音时返回空列表',
  }),
} as const;

export const VoiceAdminEndpoints = {
  listVoices: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/voices`,
    auth: 'admin',
    response: z.object({ items: z.array(AdminVoice) }),
    summary: '音色库',
  }),
  createVoice: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/voices`,
    auth: 'admin',
    body: AdminVoiceWrite,
    response: AdminVoice,
    summary: '登记音色；名称含真人角色姓名时 422 bad_request；写审计',
  }),
  updateVoice: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/voices/:voiceId`,
    auth: 'admin',
    params: z.object({ voiceId: Id }),
    body: AdminVoiceWrite.partial(),
    response: AdminVoice,
    summary: '编辑音色；停用后已选用的角色退回预设角色默认音色或平台默认音色',
  }),
} as const;

// ---------- 卡面模板（GRW-05 第 2 条、ADM-04 第 3 条） ----------

/** 素材用途：卡片种类见 growth-cards.ts；daily_photo 用于聊天/朋友圈日常配图。 */
export const CardTemplateKind = z.enum([
  'anniversary',
  'familiarity',
  'holiday',
  'moment',
  'pet',
  'play',
  'daily_photo',
]);

/** 卡面模板。portraitFree = 不含人物，可用于真人角色（GRW-05 第 2 条）。 */
export const CardTemplate = z.object({
  templateId: Id,
  name: z.string().min(1).max(20),
  kinds: z.array(CardTemplateKind).min(1),
  mediaId: Id,
  url: z.url(),
  portraitFree: z.boolean(),
  /**
   * 3.1（积压 ㉓）：古风插画（GRW-05 第 2 条：历史人物可用古风插画）。挑选规则：历史人物优先取 classicalStyle = true 的模板，
   * 其余真人只取 portraitFree = true 的模板。不传 / 旧服务器不返回时按 false。
   */
  classicalStyle: z.boolean().optional(),
  enabled: z.boolean(),
  updatedAt: Timestamp,
});
export type CardTemplate = z.infer<typeof CardTemplate>;

export const CardTemplateWrite = CardTemplate.omit({
  templateId: true,
  url: true,
  updatedAt: true,
});

export const CardTemplateAdminEndpoints = {
  listTemplates: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/card-templates`,
    auth: 'admin',
    response: z.object({ items: z.array(CardTemplate) }),
    summary: '卡面模板库',
  }),
  createTemplate: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/card-templates`,
    auth: 'admin',
    body: CardTemplateWrite,
    response: CardTemplate,
    summary: '新增卡面模板（先 POST /admin/media?purpose=card_template）',
  }),
  updateTemplate: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/card-templates/:templateId`,
    auth: 'admin',
    params: z.object({ templateId: Id }),
    body: CardTemplateWrite.partial(),
    response: CardTemplate,
    summary: '编辑、启停卡面模板（已发出的卡片不受影响）',
  }),
} as const;
