/**
 * growth 模块第二部分（L6，D-L6-01）：卡片（GRW-05）、成就（GRW-06）、熟悉度总览（GRW-03 第 7 条）。
 * 数据归 growth。没有抽卡、没有付费、没有随机掉落（GRW-05 第 3 条）。
 * 纪念卡、熟悉度卡、节日卡由 growth 自己发；名场面、宠物、玩法瞬间卡由 ai-runtime 经 GrowthCardPort 发
 * （卡上那句话由 AI 生成，失败用模板）。成就由 growth 订阅各模块事件判定，不读聊天内容（GRW-06 第 7 条）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';
import { FamiliarityInfo } from './growth.js';

// ---------- 卡片 ----------

/** 卡片种类：纪念卡、熟悉度卡、节日卡、瞬间卡（名场面 / 第一次通话 / 被拉群等）、宠物瞬间卡、玩法瞬间卡。 */
export const CardKind = z.enum(['anniversary', 'familiarity', 'holiday', 'moment', 'pet', 'play']);
export type CardKind = z.infer<typeof CardKind>;

export const GrowthCard = z.object({
  cardId: Id,
  characterId: Id,
  kind: tolerantEnum(CardKind),
  /** 该角色卡册内的编号（「No.012」），从 1 递增。 */
  serialNo: z.number().int().positive(),
  title: z.string().min(1).max(30),
  /** 角色写给用户的一句话（卡面最多 2 行，建议 40 字以内）。 */
  line: z.string().max(60),
  obtainedOn: LocalDate,
  /** 卡面：模板图或生成图（真人角色不含人物肖像，GRW-05 第 2 条）。 */
  face: z.object({ templateId: Id.nullable(), mediaId: Id.nullable(), url: z.url().nullable() }),
  /** 名场面瞬间卡关联的消息（供卡片详情回看）；其他为 null。 */
  sourceMessageIds: z.array(Id).max(6),
  createdAt: Timestamp,
});
export type GrowthCard = z.infer<typeof GrowthCard>;

/** 未获得的纪念卡 / 熟悉度卡（灰色剪影 + 获得条件，GRW-05 第 4 条）；瞬间卡不显示未获得项。 */
export const LockedCard = z.object({
  kind: tolerantEnum(CardKind),
  title: z.string().max(30),
  condition: z.string().max(60),
});

export const CardAlbum = z.object({
  characterId: Id,
  obtained: z.array(GrowthCard),
  locked: z.array(LockedCard),
});
export type CardAlbum = z.infer<typeof CardAlbum>;

export const CardAlbumSummary = z.object({
  characterId: Id,
  obtainedCount: z.number().int().nonnegative(),
  latestObtainedOn: LocalDate.nullable(),
});

// ---------- 成就 ----------

/** 成就分组（GRW-06 表「分组」列）。 */
export const AchievementGroup = z.enum(['acquaintance', 'chat_call', 'group_moments', 'collect', 'anniversary', 'play']);

/**
 * 成就键与编号（GRW-06 成就清单，唯一定义处是 PRD；此处只是编号到键的映射）。
 * 新增成就是次版本变更；客户端读时容错。
 */
export const AchievementKey = z.enum([
  'first_contact', // 1 初次见面
  'first_message', // 2 第一句话
  'introduced', // 3 被介绍认识
  'small_circle', // 4 小圈子
  'many_friends', // 5 朋友很多
  'first_nudge', // 6 拍一拍
  'first_proactive', // 7 TA 想起我
  'first_memory', // 8 TA 记得
  'first_image_sent', // 9 给你看看
  'first_voice_sent', // 10 我也想说
  'first_voice_received', // 11 声音的温度
  'first_call', // 12 第一通电话
  'first_incoming_call', // 13 TA 打来了
  'first_group', // 14 热闹起来
  'pulled_into_group', // 15 被拉进群
  'first_moment', // 16 第一条动态
  'first_moment_comment', // 17 留个言
  'popular', // 18 人气王
  'first_favorite', // 19 小小收藏家
  'favorites_50', // 20 珍藏满满
  'first_share_image', // 21 晒一晒
  'first_card', // 22 第一张卡
  'cards_50', // 23 卡册渐满
  'days_7', // 24 一周啦
  'days_100', // 25 一百天
  'days_365', // 26 一周年
  'familiarity_l3', // 27 熟络起来
  'familiarity_l5', // 28 知己
  'first_pet', // 29 一起养了只小家伙
  'pet_grown_up', // 30 长大啦
  'first_wish_done', // 31 一起列心愿
  'first_daily_question', // 32 今天的问题
  'first_letter_reply', // 33 见字如面
  'first_focus', // 34 有人陪着
]);
export type AchievementKey = z.infer<typeof AchievementKey>;

export const Achievement = z.object({
  /** PRD 编号 1～34。 */
  no: z.number().int().positive(),
  key: tolerantEnum(AchievementKey),
  name: z.string().max(20),
  condition: z.string().max(60),
  group: tolerantEnum(AchievementGroup),
  type: z.enum(['first', 'cumulative']),
  /** 获得时间；未获得为 null。已获得的永不收回（GRW-06 第 5 条）。 */
  unlockedAt: Timestamp.nullable(),
  /** 累计类的进度（例 37 / 50）；第一次类为 null。 */
  progress: z.object({ current: z.number().int().nonnegative(), target: z.number().int().positive() }).nullable(),
});
export type Achievement = z.infer<typeof Achievement>;

export const GrowthCardEndpoints = {
  listAlbums: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/growth/cards`,
    auth: 'user',
    response: z.object({ items: z.array(CardAlbumSummary) }),
    summary: '「我 → 服务 → 卡册」：所有角色的卡册（已收集张数）',
  }),
  getAlbum: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/growth/:characterId/cards`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: CardAlbum,
    summary: '某角色的卡册：已获得（按编号）+ 未获得的纪念卡 / 熟悉度卡及获得条件',
  }),
  getCard: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/growth/card/:cardId`,
    auth: 'user',
    params: z.object({ cardId: Id }),
    response: GrowthCard,
    summary: '卡片详情（生成分享图入口，EXP-01）',
  }),
  listAchievements: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/growth/achievements`,
    auth: 'user',
    response: z.object({ items: z.array(Achievement) }),
    summary: '成就页（跨角色汇总，GRW-06）：全部成就及获得状态',
  }),
  listFamiliarity: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/growth/familiarity`,
    auth: 'user',
    response: z.object({ items: z.array(FamiliarityInfo) }),
    summary: '「我 → 服务 → 熟悉度」：所有角色的熟悉度，按等级从高到低',
  }),
} as const;
