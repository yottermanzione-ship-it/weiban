import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, Timestamp, defineEndpoint } from '../common.js';

export const MuseWeiboSubmission = z
  .object({
    characterId: Id,
    authorNickname: z.string().trim().min(1).max(120),
    /** 手机分享链接不带作者 ID，由连接器从同一条原帖的资料提交。 */
    authorWeiboId: z
      .string()
      .regex(/^\d{5,20}$/u)
      .optional(),
    sourceUrl: z.url().max(300),
    publishedOn: LocalDate,
    /** 无文字的图片或视频原帖只展示原帖链接。 */
    text: z.string().trim().max(2000).default(''),
  })
  .strict();
export type MuseWeiboSubmission = z.infer<typeof MuseWeiboSubmission>;

export const MuseWeiboReceipt = z.object({
  receiptId: Id,
  characterId: Id,
  state: z.enum(['queued', 'publishing', 'published', 'blocked', 'withdrawn']),
  acceptedAt: Timestamp,
});
export type MuseWeiboReceipt = z.infer<typeof MuseWeiboReceipt>;

export const MuseWeiboAdminEndpoints = {
  submit: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/ecology/muse-weibo`,
    auth: 'admin',
    body: MuseWeiboSubmission,
    response: MuseWeiboReceipt,
    summary: 'Muse 投稿已核实的公开微博（202）。同一角色同一帖子重试返回同一回执。',
  }),
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/ecology/muse-weibo/:receiptId`,
    auth: 'admin',
    params: z.object({ receiptId: Id }),
    response: MuseWeiboReceipt,
    summary: '查微博入库及发布进度，仅返回回执元数据。',
  }),
} as const;
