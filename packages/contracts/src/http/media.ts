/**
 * media 模块（L0 最小版）：图片上传，用于我的头像、通讯录自定义头像。
 * 上传使用 multipart/form-data（字段名 file），因此这里只定义响应；L5 扩展语音、表情包等用途。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint } from '../common.js';

export const MediaPurpose = z.enum(['user_avatar', 'contact_avatar']);
export type MediaPurpose = z.infer<typeof MediaPurpose>;

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
    query: z.object({ purpose: MediaPurpose }),
    response: MediaObject,
    summary: '上传图片（multipart/form-data，字段 file）；大小与格式见 MEDIA_LIMITS',
  }),
  getMedia: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/media/:mediaId`,
    auth: 'user',
    params: z.object({ mediaId: Id }),
    response: MediaObject,
    summary: '获取媒体信息与新的访问链接（只能访问自己的文件）',
  }),
} as const;
