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
import { API_PREFIX, Id, Timestamp, defineEndpoint } from '../common.js';

export const MediaPurpose = z.enum(['user_avatar', 'contact_avatar', 'character_avatar']);
export type MediaPurpose = z.infer<typeof MediaPurpose>;

/** 用户可自行上传的用途；character_avatar 只能由管理员上传。 */
export const UserMediaPurpose = z.enum(['user_avatar', 'contact_avatar']);

export const MEDIA_LIMITS = {
  imageMaxBytes: 10 * 1024 * 1024,
  imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
} as const;

export const MediaObject = z.object({
  mediaId: Id,
  purpose: MediaPurpose,
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** 带签名的临时访问链接；过期后重新调用 getMedia 获取。 */
  url: z.url(),
  urlExpiresAt: Timestamp,
  createdAt: Timestamp,
});
export type MediaObject = z.infer<typeof MediaObject>;

export const MediaEndpoints = {
  upload: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/media`,
    auth: 'user',
    query: z.object({ purpose: UserMediaPurpose }),
    response: MediaObject,
    summary: '上传图片（multipart/form-data，字段 file）；大小与格式见 MEDIA_LIMITS',
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
    query: z.object({ purpose: z.literal('character_avatar') }),
    response: MediaObject,
    summary: '管理员上传预设角色头像（multipart/form-data，字段 file）；写审计日志',
  }),
} as const;
