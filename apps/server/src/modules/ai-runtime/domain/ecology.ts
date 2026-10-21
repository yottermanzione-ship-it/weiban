/**
 * 角色生态 v1 的纯规则：动作清单、四档默认次数、默认平台参数、当天唤醒时刻、决策输出解析。
 * 唯一定义处：用户可见的设置与动作清单见 docs/refactor/17-ecology-settings.md；本文件只是代码里的取值。
 * 说明见 docs/ai/ecology-v1.md。
 */
import { z } from 'zod';
import {
  ECOLOGY_ACTION_KEYS,
  type EcologyActionGroup,
  type EcologyActionKey,
  type EcologyActivityLevel,
  type EcologyConfig,
} from '@weiban/contracts';

/**
 * 执行方式：
 * - decision：生态唤醒时由决策模型从工具里挑；
 * - flow：由已有的专门流程自己触发，开关只决定流程是否运行（经期关怀：隐私规则更严，沿用 health-care）；
 * - reserved：留口子，v1 未接通（界面置灰「即将上线」）。
 */
export type EcologyExecMode = 'decision' | 'flow' | 'reserved';

export interface EcologyActionDef {
  key: EcologyActionKey;
  group: EcologyActionGroup;
  label: string;
  /** 给决策模型看的工具说明。 */
  tool: string;
  mode: EcologyExecMode;
  /** 需要的平台服务；未开通时不可用。 */
  needs?: 'speech_synthesis' | 'image_generation' | 'web_search';
  /** reserved 时的说明。 */
  reservedReason?: string;
  /** 碎碎念下方灰字「做了什么」。 */
  summary: string;
}

export const ECOLOGY_ACTIONS: readonly EcologyActionDef[] = [
  {
    key: 'weibo_sync',
    group: 'moments',
    label: '同步微博动态',
    tool: '查看自己有微博标记的公开账号是否有新微博，并同步到开启生态的用户的私人朋友圈。有新作品或公开信息线索、想起一阵没看微博时才选；没有必要就不选。查询只用已标记的公开账号，不查私人生活。费用由当时开启该角色生态且有积分的用户平摊。',
    mode: 'decision',
    needs: 'web_search',
    summary: '查看并同步了公开微博动态',
  },
  {
    key: 'message',
    group: 'chat',
    label: '主动发消息',
    tool: '主动给对方发私聊消息：分享一件事、接着上次的话题、想到对方了。brief 写清这次想说什么（具体内容，不要空洞问候）。',
    mode: 'decision',
    summary: '给你发了条消息',
  },
  {
    key: 'greeting',
    group: 'chat',
    label: '早安 / 晚安',
    tool: '早上或睡前跟对方道早安 / 晚安（要结合今天的具体情况，不要套话）。只在合适的时间用。',
    mode: 'decision',
    summary: '跟你道了早安 / 晚安',
  },
  {
    key: 'voice',
    group: 'chat',
    label: '发语音消息',
    tool: '用语音消息说一两句话（短，口语）。brief 写要说的意思。',
    mode: 'decision',
    needs: 'speech_synthesis',
    summary: '给你发了条语音',
  },
  {
    key: 'photo',
    group: 'chat',
    label: '发照片 / 自拍',
    tool: '拍一张 TA 视角的照片发给对方（景物、食物、身边的东西），配一句话。brief 写照片内容和想说的话。',
    mode: 'decision',
    needs: 'image_generation',
    summary: '给你发了张照片',
  },
  {
    key: 'sticker',
    group: 'chat',
    label: '发表情包',
    tool: '发一个表情包（可配一句很短的话）。brief 写想表达的情绪。',
    mode: 'decision',
    summary: '给你发了个表情',
  },
  {
    key: 'nudge',
    group: 'chat',
    label: '拍一拍你',
    tool: '在聊天里「拍一拍」对方，轻轻戳一下，不说话。',
    mode: 'decision',
    summary: '拍了拍你',
  },
  {
    key: 'share_link',
    group: 'chat',
    label: '分享歌曲 / 链接',
    tool: '把自己作品库里的一首歌 / 一个链接分享给对方，配一句为什么想分享。brief 写想分享的理由。',
    mode: 'decision',
    summary: '给你分享了一个链接',
  },
  {
    key: 'moment_post',
    group: 'moments',
    label: '发朋友圈',
    tool: '发一条私人朋友圈（只有对方能看到），可以和你们最近聊的事或 TA 今天的生活有关。brief 写这条朋友圈的素材。',
    mode: 'decision',
    summary: '发了一条朋友圈',
  },
  {
    key: 'moment_interact',
    group: 'moments',
    label: '给你的朋友圈点赞、评论',
    tool: '给对方最近的一条朋友圈点赞或评论。target 填快照里对方动态的编号；brief 写 like 或想评论的意思。',
    mode: 'decision',
    summary: '给你的朋友圈点了赞 / 评论',
  },
  {
    key: 'moment_reply',
    group: 'moments',
    label: '回复 TA 朋友圈下的评论',
    tool: '回复自己朋友圈下还没回的评论。target 填快照里评论的编号。',
    mode: 'decision',
    summary: '回复了朋友圈评论',
  },
  {
    key: 'moment_peer',
    group: 'moments',
    label: '去其他角色的朋友圈互动',
    tool: '去其他认识的角色的朋友圈点赞或评论（对方能在共同好友处看到）。target 填快照里动态的编号；brief 写 like 或评论的意思。',
    mode: 'decision',
    summary: '去朋友的朋友圈互动了',
  },
  {
    key: 'status',
    group: 'life',
    label: '更新状态',
    tool: '更新自己的状态，例「在忙」「在听歌」「刚下班」。text 填状态（不超过 12 个字）。',
    mode: 'decision',
    summary: '更新了状态',
  },
  {
    key: 'signature',
    group: 'life',
    label: '改个性签名',
    tool: '改个性签名（偶尔才改）。text 填新签名（不超过 30 个字）。',
    mode: 'decision',
    summary: '改了个性签名',
  },
  {
    key: 'care_period',
    group: 'care',
    label: '经期前后关心',
    tool: '',
    mode: 'flow',
    summary: '关心了你的身体',
  },
  {
    key: 'care_weather',
    group: 'care',
    label: '天气变化提醒',
    tool: '',
    mode: 'reserved',
    reservedReason: '暂无天气数据',
    summary: '提醒你注意天气',
  },
  {
    key: 'care_anniversary',
    group: 'care',
    label: '生日、纪念日、约定的日子',
    tool: '快照里今天有生日 / 纪念日 / 节日 / 约定的日子时，发消息表达心意。brief 写是哪个日子、想说什么。',
    mode: 'decision',
    summary: '记得今天是特别的日子',
  },
  {
    key: 'care_absence',
    group: 'care',
    label: '很久没说话时问候',
    tool: '对方很久没来聊天时问候一句（不让对方愧疚、不追问）。',
    mode: 'decision',
    summary: '问候了很久没说话的你',
  },
  {
    key: 'care_late_night',
    group: 'care',
    label: '熬夜了催你睡',
    tool: '对方深夜还在活跃（快照里有最近活跃时间）时，催对方早点睡。',
    mode: 'decision',
    summary: '催你早点睡',
  },
  {
    key: 'care_follow_up',
    group: 'care',
    label: '跟进你说过的事',
    tool: '跟进对方之前提过的事（快照记忆里的约定、计划），问问结果怎么样。brief 写是哪件事。',
    mode: 'decision',
    summary: '问了问你说过的事',
  },
  {
    key: 'play_letter',
    group: 'play',
    label: '寄一封慢信',
    tool: '',
    mode: 'reserved',
    reservedReason: '即将上线',
    summary: '给你寄了一封信',
  },
  {
    key: 'play_wish',
    group: 'play',
    label: '心愿清单',
    tool: '提议和对方一起完成一个小心愿（每周最多一次）。',
    mode: 'decision',
    summary: '提了一个心愿',
  },
  {
    key: 'play_focus',
    group: 'play',
    label: '邀请你一起专注',
    tool: '',
    mode: 'reserved',
    reservedReason: '即将上线',
    summary: '邀请你一起专注',
  },
  {
    key: 'play_daily_question',
    group: 'play',
    label: '出今天的每日一问',
    tool: '',
    mode: 'reserved',
    reservedReason: '即将上线',
    summary: '出了今天的每日一问',
  },
  {
    key: 'play_pet',
    group: 'play',
    label: '照顾宠物',
    tool: '',
    mode: 'reserved',
    reservedReason: '即将上线',
    summary: '照顾了宠物',
  },
  {
    key: 'play_reminder',
    group: 'play',
    label: '帮你记下约好的事',
    tool: '',
    mode: 'reserved',
    reservedReason: '即将上线',
    summary: '帮你记下了约好的事',
  },
  {
    key: 'group_talk',
    group: 'group',
    label: '在群里主动说话',
    tool: '在你和对方都在的群里起个话头，其他角色会接话。target 填快照里群的编号；brief 写话题。',
    mode: 'decision',
    summary: '在群里聊了起来',
  },
];

export const ACTION_DEF = new Map(ECOLOGY_ACTIONS.map((a) => [a.key, a]));
// 编译期保证契约里的每个动作都有定义。
const _all: Record<EcologyActionKey, true> = Object.fromEntries(
  ECOLOGY_ACTION_KEYS.map((k) => [k, true]),
) as Record<EcologyActionKey, true>;
void _all;

export const LEVEL_LABELS: Record<EcologyActivityLevel, string> = {
  occasional: '偶尔冒泡',
  often: '时常出现',
  close: '常伴左右',
  inseparable: '形影不离',
};
export const LEVEL_ORDER: readonly EcologyActivityLevel[] = [
  'occasional',
  'often',
  'close',
  'inseparable',
];

/** 默认平台参数（17 号 §2 四档；后台可调）。决策模型默认不配置：未配置时生态不运行。 */
export const DEFAULT_ECOLOGY_CONFIG: EcologyConfig = {
  decisionModelKey: null,
  levels: {
    occasional: { min: 1, max: 2 },
    often: { min: 3, max: 5 },
    close: { min: 6, max: 9 },
    inseparable: { min: 10, max: 15 },
  },
  disabledActions: [],
  wakeWindow: { startHour: 8, endHour: 24 },
  decisionMaxOutputTokens: 500,
};

/** 稳定伪随机（0–1）：同一输入每次相同。 */
export function ecoRandom(...keys: string[]): number {
  let h = 2166136261;
  for (const ch of keys.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * 当天的唤醒时刻（当地分钟数，升序）：次数在 [min,max] 里按「用户+角色+日期」稳定抽；
 * 时段等分后在每段内稳定随机，避免多个角色同一时刻一起动。
 */
export function wakeSlots(
  userId: string,
  characterId: string,
  localDate: string,
  range: { min: number; max: number },
  window: { startHour: number; endHour: number },
): number[] {
  const span = Math.max(1, range.max - range.min + 1);
  const n = range.min + Math.floor(ecoRandom(userId, characterId, localDate, 'n') * span);
  if (n <= 0) return [];
  const start = window.startHour * 60;
  const width = (window.endHour - window.startHour) * 60;
  const seg = width / n;
  const out: number[] = [];
  for (let i = 0; i < n; i++)
    out.push(
      Math.floor(start + seg * i + ecoRandom(userId, characterId, localDate, `s${i}`) * seg * 0.9),
    );
  return out;
}

/** 平均每天唤醒次数（估算用）。 */
export function averageWakes(range: { min: number; max: number }): number {
  return (range.min + range.max) / 2;
}

/** 决策模型输出。 */
export const EcologyDecision = z.object({
  action: z.string().max(40),
  brief: z.string().max(500).optional().default(''),
  target: z.union([z.string().max(10), z.number().int()]).optional(),
  text: z.string().max(80).optional(),
  murmur: z.string().min(1).max(200),
});
export type EcologyDecision = z.infer<typeof EcologyDecision>;

/** 从模型输出里取 JSON（容忍 ```json 包裹和前后多余文字）。 */
export function parseDecision(raw: string): EcologyDecision | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = EcologyDecision.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 1 积分 = 10000 微元，保留 2 位小数。 */
export function microsToPoints(micros: number): number {
  return Math.round(Math.max(0, micros) / 100) / 100;
}

/**
 * 用户在聊天里让角色做的动作（17 号 §7「说到做到」）。语音、照片、链接已由回复流程本身执行（media-ai），
 * 这里只认回复流程做不了的：发朋友圈、拍一拍、改状态、改签名。
 */
export const USER_REQUEST_PATTERNS: ReadonlyArray<{ key: EcologyActionKey; re: RegExp }> = [
  { key: 'moment_post', re: /(你|去|帮我)?.{0,4}发(个|条|一条|一个)?朋友圈/u },
  { key: 'nudge', re: /拍(一)?拍我|拍我一下/u },
  { key: 'signature', re: /(改|换)(个|一下)?(个性)?签名/u },
  { key: 'status', re: /(改|换|更新)(个|一下)?(你的)?状态/u },
];

export function detectUserRequest(text: string): EcologyActionKey | null {
  if (text.length > 200) return null;
  if (/别|不要|不用|不想/u.test(text)) return null;
  for (const p of USER_REQUEST_PATTERNS) if (p.re.test(text)) return p.key;
  return null;
}
