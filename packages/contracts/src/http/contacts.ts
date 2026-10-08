/**
 * contacts 模块：添加角色、通讯录、备注、删除与恢复、专属称呼。
 * 需求：CHR-03、CHR-05、CHR-06、GRW-01；关系类型（GRW-02）在 L2 扩展。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, NoContent, Timestamp, defineEndpoint } from '../common.js';

export const ContactStatus = z.enum([
  'pending', // 已发送申请，等待「通过」（P-30）
  'active',
]);
export type ContactStatus = z.infer<typeof ContactStatus>;

export const Contact = z.object({
  characterId: Id,
  status: ContactStatus,
  /** 备注名：只改用户看到的名字（CHR-05 第 2 条）。 */
  remark: z.string().max(20).nullable(),
  /** 用户自定义头像，只对自己可见。 */
  customAvatarMediaId: Id.nullable(),
  /** 专属称呼：TA 怎么叫我（GRW-01）；null 表示使用我的昵称。 */
  addressAs: z.string().max(20).nullable(),
  /** 认识日期（用户当地日期，「认识第 1 天」）；恢复时沿用原日期（GRW-04 第 1 条）。 */
  knownSince: LocalDate,
  /** 私聊会话 ID；status = pending 时为 null。 */
  conversationId: Id.nullable(),
  addedAt: Timestamp,
  /** GRW-02：用户明确选择，旧响应缺省时沿用既有关系。 */
  relationship: z.string().trim().min(1).max(30).optional(),
});
export type Contact = z.infer<typeof Contact>;

export const AddContactRequest = z.object({
  characterId: Id,
  /** 打招呼的话，最多 50 字（CHR-03 第 1 条）。 */
  greeting: z.string().max(50).nullable().optional(),
  /**
   * 30 天内删除过、重新添加时必填：restore 恢复以前的记录和记忆；fresh 重新认识（CHR-06 第 3 条）。
   * 缺少时返回 409 restore_choice_required。
   */
  restoreMode: z.enum(['restore', 'fresh']).optional(),
  /** 通过名片推荐添加时的推荐人（CHR-04 第 3 条，L4 起使用）。 */
  referrerCharacterId: Id.nullable().optional(),
});

export const UpdateContactRequest = z.object({
  remark: z.string().max(20).nullable().optional(),
  customAvatarMediaId: Id.nullable().optional(),
  addressAs: z.string().max(20).nullable().optional(),
  relationship: z.string().trim().min(1).max(30).optional(),
});

export const ContactsEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/contacts`,
    auth: 'user',
    response: z.object({ items: z.array(Contact) }),
    summary: '通讯录（客户端按名字首字母排序）',
  }),
  add: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/contacts`,
    auth: 'user',
    body: AddContactRequest,
    response: Contact,
    summary:
      '发送好友申请（CHR-03）：返回 pending，P-30 秒后服务器自动「通过」并创建私聊、角色发第一条消息。错误：contact_limit_reached（P-26）、contact_exists、restore_choice_required、character_not_available',
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/contacts/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: UpdateContactRequest,
    response: Contact,
    summary: '修改备注名、自定义头像、专属称呼',
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/contacts/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    query: z.object({ mode: z.enum(['soft', 'purge']).default('soft') }),
    response: NoContent,
    summary: '删除角色：soft 保留 30 天可恢复；purge 立即彻底删除（CHR-06）',
  }),
} as const;
