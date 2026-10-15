/**
 * 3.15：状态（总经理 10-14 总对照表 Q11，节点 T4.11「我的状态」）。
 *
 * - 我的状态：数据归 identity。用户选一个预设状态（可加自定义文字）并设有效期；过期后自动视为没有状态。
 *   角色能读到（ai-runtime 经 UserStatusReadPort）：私聊回复可自然读取已有状态，不新增主动任务。
 *   修改后服务器发 settings.updated(section = profile)，其他设备重新拉 GET /me/status。
 * - 角色状态沿已有TimelineEndpoints.getStatus，不在此重复定义。
 */
import { z } from 'zod';
import { API_PREFIX, NoContent, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';

export const UserStatusPreset = z.enum([
  'studying', // 学习中
  'working', // 工作中
  'quiet', // 想静静
  'out_playing', // 出去玩
  'sleeping', // 睡觉中
  'busy', // 忙碌
  'gaming', // 打游戏
  'travelling', // 旅行中
  'sick', // 不舒服
  'happy', // 开心
  'down', // 有点低落
  'custom', // 自定义（只用 text）
]);
export type UserStatusPreset = z.infer<typeof UserStatusPreset>;

/**
 * 预设状态的显示名、默认图标（emoji）与是否属于「安静」状态（角色少打扰）。客户端按这张表画选择列表；
 * 不认识的预设（新版本新增）按 custom 显示 label。
 */
export const USER_STATUS_PRESETS: ReadonlyArray<{
  preset: UserStatusPreset;
  label: string;
  emoji: string;
  quiet: boolean;
}> = [
  { preset: 'studying', label: '学习中', emoji: '📚', quiet: true },
  { preset: 'working', label: '工作中', emoji: '💼', quiet: true },
  { preset: 'quiet', label: '想静静', emoji: '🌙', quiet: true },
  { preset: 'out_playing', label: '出去玩', emoji: '🎈', quiet: false },
  { preset: 'sleeping', label: '睡觉中', emoji: '😴', quiet: true },
  { preset: 'busy', label: '忙碌', emoji: '⏳', quiet: true },
  { preset: 'gaming', label: '打游戏', emoji: '🎮', quiet: false },
  { preset: 'travelling', label: '旅行中', emoji: '✈️', quiet: false },
  { preset: 'sick', label: '不舒服', emoji: '🤒', quiet: false },
  { preset: 'happy', label: '开心', emoji: '😊', quiet: false },
  { preset: 'down', label: '有点低落', emoji: '🌧️', quiet: false },
  { preset: 'custom', label: '自定义', emoji: '💭', quiet: false },
];

export const UserStatus = z.object({
  preset: tolerantEnum(UserStatusPreset),
  /** 自定义文字（custom 必有；其他预设可选，作为补充说明）。 */
  text: z.string().max(20).nullable(),
  /** 显示用的一句话：有 text 用 text，否则用预设名。 */
  label: z.string().max(20),
  emoji: z.string().max(8),
  /** 安静状态（角色少打扰）。 */
  quiet: z.boolean(),
  setAt: Timestamp,
  /** 到期时间；null = 一直有效，直到手动清除。 */
  expiresAt: Timestamp.nullable(),
});
export type UserStatus = z.infer<typeof UserStatus>;

export const SetUserStatusRequest = z.object({
  preset: UserStatusPreset,
  text: z.string().trim().max(20).nullable().optional(),
  /**
   * 有效期：minutes = 从现在起多少分钟（15～10080，即最长 7 天）；end_of_day = 到今天结束（按资料里的时区）；
   * forever = 不过期。不传默认 24 小时（1440 分钟）。
   */
  duration: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('minutes'), minutes: z.number().int().min(15).max(10080) }),
      z.object({ kind: z.literal('end_of_day') }),
      z.object({ kind: z.literal('forever') }),
    ])
    .optional(),
});

export const UserStatusEndpoints = {
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/status`,
    auth: 'user',
    response: z.object({ status: UserStatus.nullable() }),
    summary: '3.15：我的状态（没有或已过期为 null）',
  }),
  set: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/me/status`,
    auth: 'user',
    body: SetUserStatusRequest,
    response: z.object({ status: UserStatus }),
    summary:
      '3.15：设置我的状态（custom 没有 text 时 400 bad_request）；发 settings.updated(profile)。角色在下一次回复 / 主动消息时看到',
  }),
  clear: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/me/status`,
    auth: 'user',
    response: NoContent,
    summary: '3.15：清除我的状态（没有也返回 204）；发 settings.updated(profile)',
  }),
} as const;

