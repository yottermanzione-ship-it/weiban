/**
 * media 模块（L0 最小版）：图片上传，用于我的头像、通讯录自定义头像、预设角色头像。
 * 上传使用 multipart/form-data（字段名 file），因此这里只定义响应；L5 扩展语音、表情包等用途。
 *
 * 头像上传（总经理第二轮意见第 2 条，T-009 加入）：
 * - 用户为自己通讯录里的角色上传：purpose = contact_avatar，只对本人可见，
 *   上传后通过 PATCH /api/v1/contacts/:characterId 的 customAvatarMediaId 绑定；
 * - 管理员为预设角色上传：走管理接口 adminUpload，purpose = character_avatar，
 *   所有登录用户可读，上传后通过角色库接口的 avatar.imageMediaId 绑定。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';

/**
 * 用途决定谁能读、保留多久（3.0 扩展，D-L5-01）：
 * - user_avatar / contact_avatar / chat_image / chat_voice / user_sticker / moments_image / pet_photo /
 *   import_screenshot / custom_character_avatar：只有上传者本人可读（import_screenshot 随导入原文删除）；
 * - generated_image / generated_voice：系统为某用户生成（角色发图、角色语音、宠物照片），只有该用户可读；
 * - character_avatar / sticker_library / voice_sample / card_template / pet_art：素材库，所有登录用户可读，只能管理员上传；
 * - plaza_avatar：人设广场公开头像（作品发布时由 plaza 经 MediaWritePort 复制生成），所有登录用户可读。
 * 3.0 起响应中用接收端容错解析（不认识的用途按「其他」处理）。
 */
export const MediaPurpose = z.enum([
  'user_avatar',
  'contact_avatar',
  'character_avatar',
  'chat_image',
  'chat_voice',
  'user_sticker',
  'moments_image',
  'pet_photo',
  'import_screenshot',
  'custom_character_avatar',
  'generated_image',
  'generated_voice',
  'sticker_library',
  'voice_sample',
  'card_template',
  'pet_art',
  'plaza_avatar',
  /** 3.5：角色制作申请的参考图（只有上传者本人可读；管理员经申请详情取短期链接）。 */
  'role_request_image',
  /** 3.8：反馈 / 投诉截图（只有上传者本人可读；管理员经工单详情取短期链接）。 */
  'support_image',
]);
export type MediaPurpose = z.infer<typeof MediaPurpose>;

/** 用户可自行上传的用途；character_avatar 只能由管理员上传。 */
export const UserMediaPurpose = z.enum([
  'user_avatar',
  'contact_avatar',
  'chat_image',
  'chat_voice',
  'user_sticker',
  'moments_image',
  'pet_photo',
  'import_screenshot',
  'custom_character_avatar',
  'role_request_image',
  'support_image',
]);

/** 3.0：只能由管理员上传的素材库用途。 */
export const AdminMediaPurpose = z.enum([
  'character_avatar',
  'sticker_library',
  'voice_sample',
  'card_template',
  'pet_art',
]);

export const MEDIA_LIMITS = {
  imageMaxBytes: 10 * 1024 * 1024,
  imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  /** 3.0：语音消息（chat_voice）最长 60 秒，格式见 voiceMimeTypes。 */
  voiceMaxBytes: 2 * 1024 * 1024,
  voiceMaxDurationMs: 60_000,
  voiceMimeTypes: ['audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav'],
  /** 3.0：导入文件（.txt / .csv）上限 5 MB，见 http/importer.ts。 */
  importFileMaxBytes: 5 * 1024 * 1024,
} as const;

export const MediaObject = z.object({
  mediaId: Id,
  purpose: tolerantEnum(MediaPurpose),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** 带签名的临时访问链接；过期后重新调用 getMedia 获取。 */
  url: z.url(),
  urlExpiresAt: Timestamp,
  createdAt: Timestamp,
  /** 3.0：图片缩略图（短边 360px）访问链接；不是图片或尚未生成时为 null。 */
  thumbnailUrl: z.url().nullable().optional(),
  /** 3.0：语音时长。 */
  durationMs: z.number().int().positive().nullable().optional(),
});
export type MediaObject = z.infer<typeof MediaObject>;

export const MediaEndpoints = {
  download: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/media/:mediaId/content`,
    auth: 'none',
    params: z.object({ mediaId: Id }),
    query: z.object({ token: z.string().min(1).max(1000) }),
    response: z.string().meta({ format: 'binary' }),
    responseContentType: 'image/webp',
    summary: '凭5分钟媒体访问凭证下载；不接受越期或跨媒体凭证；响应是WebP二进制',
  }),
  upload: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/media`,
    auth: 'user',
    query: z.object({ purpose: UserMediaPurpose }),
    response: MediaObject,
    summary:
      '上传图片或语音（multipart/form-data，字段 file；语音另带表单字段 durationMs）；大小与格式见 MEDIA_LIMITS。图片同步生成缩略图',
  }),
  getMedia: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/media/:mediaId`,
    auth: 'user',
    params: z.object({ mediaId: Id }),
    response: MediaObject,
    summary:
      '获取媒体信息与新的访问链接。user_avatar / contact_avatar 只能访问自己的；character_avatar 所有登录用户可读',
  }),
} as const;

export const MediaAdminEndpoints = {
  adminUpload: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/media`,
    auth: 'admin',
    query: z.object({ purpose: AdminMediaPurpose }),
    response: MediaObject,
    summary:
      '管理员上传素材（预设角色头像、表情包、音色试听、卡面模板、宠物插画；multipart/form-data，字段 file）；写审计日志',
  }),
} as const;

// ---------- 3.0：语音转文字、链接预览（D-L5-03、D-L5-06） ----------

/** 语音转文字状态。pending：识别中；failed：识别失败（MED-03 第 5 条「当前无法识别语音」）。 */
export const TranscriptStatus = z.enum(['pending', 'ready', 'failed', 'unavailable']);

export const MediaTranscript = z.object({
  mediaId: Id,
  status: tolerantEnum(TranscriptStatus),
  text: z.string().max(4000).nullable(),
});
export type MediaTranscript = z.infer<typeof MediaTranscript>;

/** 链接预览（MED-05 第 4 条）：服务器抓取标题与摘要；只访问 http(s) 公网地址，拒绝内网地址。 */
export const LinkPreview = z.object({
  url: z.url(),
  title: z.string().min(1).max(100),
  source: z.string().max(30).nullable(),
  description: z.string().max(200).nullable(),
  /** 封面图已转存为 media（purpose = chat_image，只有本人可读）；没有封面为 null。 */
  coverMediaId: Id.nullable(),
  appHint: z.enum(['music', 'video', 'web']),
  /** false：打不开（超时、4xx/5xx）；客户端仍可按网址发送，标题用网址。 */
  reachable: z.boolean(),
});
export type LinkPreview = z.infer<typeof LinkPreview>;

export const MediaExtraEndpoints = {
  getTranscript: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/media/:mediaId/transcript`,
    auth: 'user',
    params: z.object({ mediaId: Id }),
    response: MediaTranscript,
    summary:
      '语音「转文字」（MED-03 第 3 条）。用户语音由 ai-runtime 识别后写入（MediaTranscriptPort）；识别完成另发 media.transcript_ready 更新',
  }),
  previewLink: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/links/preview`,
    auth: 'user',
    body: z.object({ url: z.url().max(2000) }),
    response: LinkPreview,
    summary: '取链接标题、来源、摘要、封面（用户发链接、发朋友圈前）；每用户每分钟限 20 次',
  }),
} as const;
