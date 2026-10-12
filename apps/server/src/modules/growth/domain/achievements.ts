/**
 * 成就清单（GRW-06）。名称与条件抄自 PRD `09-relationship-growth.md` GRW-06 表（唯一定义处），不得增删改名。
 * 只有「第一次」和「累计」两类；没有「连续 N 天」类，也没有按时长 / 条数鼓励花费的成就。
 */
import type { AchievementKey } from '@weiban/contracts';

export type AchievementGroupKey =
  'acquaintance' | 'chat_call' | 'group_moments' | 'collect' | 'anniversary' | 'play';

export interface AchievementDef {
  no: number;
  key: AchievementKey;
  name: string;
  condition: string;
  group: AchievementGroupKey;
  type: 'first' | 'cumulative';
  /** 累计类：进度来源计数器与目标值。 */
  counter?: { key: CounterKey; target: number };
}

/** 累计计数器。active_contacts 是「同时有」（取当前值，不累加）；其余只增不减。 */
export type CounterKey = 'active_contacts' | 'favorites_total' | 'cards_total';

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    no: 1,
    key: 'first_contact',
    name: '初次见面',
    condition: '第一次添加角色',
    group: 'acquaintance',
    type: 'first',
  },
  {
    no: 2,
    key: 'first_message',
    name: '第一句话',
    condition: '第一次给角色发消息',
    group: 'acquaintance',
    type: 'first',
  },
  {
    no: 3,
    key: 'introduced',
    name: '被介绍认识',
    condition: '第一次通过名片推荐添加角色',
    group: 'acquaintance',
    type: 'first',
  },
  {
    no: 4,
    key: 'small_circle',
    name: '小圈子',
    condition: '通讯录里同时有 5 个角色',
    group: 'acquaintance',
    type: 'cumulative',
    counter: { key: 'active_contacts', target: 5 },
  },
  {
    no: 5,
    key: 'many_friends',
    name: '朋友很多',
    condition: '通讯录里同时有 20 个角色',
    group: 'acquaintance',
    type: 'cumulative',
    counter: { key: 'active_contacts', target: 20 },
  },
  {
    no: 6,
    key: 'first_nudge',
    name: '拍一拍',
    condition: '第一次拍一拍角色',
    group: 'chat_call',
    type: 'first',
  },
  {
    no: 7,
    key: 'first_proactive',
    name: 'TA 想起我',
    condition: '第一次收到角色的主动消息',
    group: 'chat_call',
    type: 'first',
  },
  {
    no: 8,
    key: 'first_memory',
    name: 'TA 记得',
    condition: '记忆页里第一次出现角色自动记下的事',
    group: 'chat_call',
    type: 'first',
  },
  {
    no: 9,
    key: 'first_image_sent',
    name: '给你看看',
    condition: '第一次给角色发图片',
    group: 'chat_call',
    type: 'first',
  },
  {
    no: 10,
    key: 'first_voice_sent',
    name: '我也想说',
    condition: '第一次给角色发语音消息',
    group: 'chat_call',
    type: 'first',
  },
  {
    no: 11,
    key: 'first_voice_received',
    name: '声音的温度',
    condition: '第一次收到角色发来的语音消息',
    group: 'chat_call',
    type: 'first',
  },
  {
    no: 12,
    key: 'first_call',
    name: '第一通电话',
    condition: '第一次和角色语音通话（接通即算）',
    group: 'chat_call',
    type: 'first',
  },
  {
    no: 13,
    key: 'first_incoming_call',
    name: 'TA 打来了',
    condition: '第一次接到角色来电',
    group: 'chat_call',
    type: 'first',
  },
  {
    no: 14,
    key: 'first_group',
    name: '热闹起来',
    condition: '第一次建群',
    group: 'group_moments',
    type: 'first',
  },
  {
    no: 15,
    key: 'pulled_into_group',
    name: '被拉进群',
    condition: '第一次被角色拉进群',
    group: 'group_moments',
    type: 'first',
  },
  {
    no: 16,
    key: 'first_moment',
    name: '第一条动态',
    condition: '第一次发朋友圈',
    group: 'group_moments',
    type: 'first',
  },
  {
    no: 17,
    key: 'first_moment_comment',
    name: '留个言',
    condition: '第一次评论角色的朋友圈',
    group: 'group_moments',
    type: 'first',
  },
  {
    no: 18,
    key: 'popular',
    name: '人气王',
    condition: '一条朋友圈收到 10 个角色点赞',
    group: 'group_moments',
    type: 'first',
  },
  {
    no: 19,
    key: 'first_favorite',
    name: '小小收藏家',
    condition: '第一次收藏消息',
    group: 'collect',
    type: 'first',
  },
  {
    no: 20,
    key: 'favorites_50',
    name: '珍藏满满',
    condition: '累计收藏 50 条',
    group: 'collect',
    type: 'cumulative',
    counter: { key: 'favorites_total', target: 50 },
  },
  {
    no: 21,
    key: 'first_share_image',
    name: '晒一晒',
    condition: '第一次生成分享图',
    group: 'collect',
    type: 'first',
  },
  {
    no: 22,
    key: 'first_card',
    name: '第一张卡',
    condition: '获得第一张卡片',
    group: 'collect',
    type: 'first',
  },
  {
    no: 23,
    key: 'cards_50',
    name: '卡册渐满',
    condition: '累计获得 50 张卡片（所有角色合计）',
    group: 'collect',
    type: 'cumulative',
    counter: { key: 'cards_total', target: 50 },
  },
  {
    no: 24,
    key: 'days_7',
    name: '一周啦',
    condition: '和任一角色认识满 7 天',
    group: 'anniversary',
    type: 'first',
  },
  {
    no: 25,
    key: 'days_100',
    name: '一百天',
    condition: '和任一角色认识满 100 天',
    group: 'anniversary',
    type: 'first',
  },
  {
    no: 26,
    key: 'days_365',
    name: '一周年',
    condition: '和任一角色认识满 365 天',
    group: 'anniversary',
    type: 'first',
  },
  {
    no: 27,
    key: 'familiarity_l3',
    name: '熟络起来',
    condition: '和任一角色熟悉度第一次达到 L3',
    group: 'anniversary',
    type: 'first',
  },
  {
    no: 28,
    key: 'familiarity_l5',
    name: '知己',
    condition: '和任一角色熟悉度达到 L5',
    group: 'anniversary',
    type: 'first',
  },
  {
    no: 29,
    key: 'first_pet',
    name: '一起养了只小家伙',
    condition: '第一次和角色共同领养宠物',
    group: 'play',
    type: 'first',
  },
  {
    no: 30,
    key: 'pet_grown_up',
    name: '长大啦',
    condition: '共同领养的宠物第一次长到成年阶段',
    group: 'play',
    type: 'first',
  },
  {
    no: 31,
    key: 'first_wish_done',
    name: '一起列心愿',
    condition: '心愿清单中第一次完成一项',
    group: 'play',
    type: 'first',
  },
  {
    no: 32,
    key: 'first_daily_question',
    name: '今天的问题',
    condition: '第一次和角色一起答完每日一问',
    group: 'play',
    type: 'first',
  },
  {
    no: 33,
    key: 'first_letter_reply',
    name: '见字如面',
    condition: '第一次收到角色的回信',
    group: 'play',
    type: 'first',
  },
  {
    no: 34,
    key: 'first_focus',
    name: '有人陪着',
    condition: '第一次完成一次陪你专注，提前结束也算',
    group: 'play',
    type: 'first',
  },
];

export const ACHIEVEMENT_BY_KEY: ReadonlyMap<string, AchievementDef> = new Map(
  ACHIEVEMENTS.map((a) => [a.key, a]),
);
