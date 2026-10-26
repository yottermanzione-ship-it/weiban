/**
 * 角色生态 v1 的纯规则：动作清单、四档默认次数、默认平台参数、当天唤醒时刻、Jev 判定解读与冲突排除。
 * 唯一定义处：用户可见的设置与动作清单见 docs/refactor/17-ecology-settings.md；本文件只是代码里的取值。
 * 说明见 docs/ai/ecology-v1.md。
 */
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
  needs?: 'speech_synthesis' | 'web_search';
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
    label: '分享图片',
    tool: '分享这张角色微博里的一张公开图片，配一句话；不得声称是刚拍的照片或自拍。',
    mode: 'decision',
    summary: '给你分享了张图片',
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

// ===========================================================================
// 批 EJ：Jev 原生判定（docs/ai/2026-10-23-ecology-native-decision-spec.md §四）
// ===========================================================================

/** 低于此把握不做（沿用 planner 默认门槛 0.55，不为提高触发率而下调）。 */
export const ECOLOGY_JEV_MIN_CONFIDENCE = 0.55;
/** 每个候选的固定选项：act = 现在适合做；defer = 不适合、会打扰或不确定（等下一次正常唤醒再看）。 */
export const JEV_OPTIONS = ['act', 'defer'] as const;

/**
 * 执行时需要用户自己选的文字模型（角色覆盖优先，其次场景设置；私密模式用私密模型）的动作。
 * 缺模型就不进候选，不换别的模型。拍一拍、点赞、转发已同步的微博素材、微博同步不需要写手。
 */
export const TEXT_MODEL_ACTIONS: ReadonlySet<EcologyActionKey> = new Set([
  'message',
  'greeting',
  'voice',
  'photo',
  'sticker',
  'share_link',
  'care_anniversary',
  'care_absence',
  'care_late_night',
  'care_follow_up',
  'play_wish',
  'moment_reply',
  'status',
  'signature',
  'group_talk',
]);

/** 给 Jev 的每题补充说明（固定程序文字，不含任何用户或角色原文）。 */
const JEV_HINT: Partial<Record<EcologyActionKey, string>> = {
  weibo_sync: '看 state.features.weiboLeadAvailable：有新公开线索时才适合；没有必要就不做。',
  message: '主动发一条有具体内容的私聊消息。对方刚聊过或有未回复消息时克制。',
  greeting: '只在早上或睡前合适。',
  voice: '用一两句语音代替文字。对方可能不方便听时不做。',
  photo: '分享角色微博里的一张公开图片。',
  sticker: '发一个表情包。',
  nudge: '轻轻拍一拍对方，不说话。',
  share_link: '分享自己作品库里的一首歌或链接。',
  moment_post: '把已同步的公开微博转到私人朋友圈。',
  moment_interact: '给对方最近的朋友圈点赞。',
  moment_reply: '回复自己朋友圈下还没回的评论。',
  moment_peer: '给认识的其他角色的朋友圈点赞。',
  status: '更新自己的状态，偶尔才做。',
  signature: '改个性签名，很少才做。',
  care_anniversary: '今天是特别的日子时表达心意。',
  care_absence: '对方很久没来时问候一句，不制造愧疚。',
  care_late_night: '对方深夜还活跃时催对方早点睡。',
  care_follow_up: '跟进对方之前提过的事。',
  play_wish: '提议一起完成一个小心愿（每周最多一次）。',
  group_talk: '在共同的群里起一个话头。',
};

/** 每个候选的判定题干：只问做不做，不让 Jev 写内容。 */
export function jevPrompt(action: EcologyActionKey): string {
  const label = ACTION_DEF.get(action)?.label ?? action;
  return `陪伴应用里的角色此刻是否适合「${label}」？${JEV_HINT[action] ?? ''}依据 state.summary 的对话现状和 state.features 中的时间、活跃情况、未回复条数、今天已做过的次数独立判断这一项（与其他题互不影响）；像真人一样克制，深夜一般不打扰。act 表示现在适合做；defer 表示不适合、会打扰或不确定。`;
}

export interface JevVerdict {
  approved: Array<{ action: EcologyActionKey; confidence: number }>;
  /** 选了 act 但把握不足（不做）。 */
  lowConfidence: EcologyActionKey[];
  /** 明确 defer。 */
  declined: EcologyActionKey[];
  /** 返回里不认识的题号个数（忽略，不做任何事）。 */
  unknownIds: number;
  /** 重复题号 / 选项不合法 / 把握值不合法 / 缺答案：一律不做。 */
  invalid: EcologyActionKey[];
}

/**
 * 解读 Jev 的批量答案。每个候选独立：只有选 act 且把握 ≥ 门槛才算通过；
 * 陌生 ID 忽略、重复 ID / 缺答案 / 非法值都不做，绝不用概率抽签或规则补批。
 */
export function interpretJevAnswers(
  candidates: readonly EcologyActionKey[],
  answers: ReadonlyArray<{ questionId: string; choice: string; confidence: number }>,
  threshold = ECOLOGY_JEV_MIN_CONFIDENCE,
): JevVerdict {
  const verdict: JevVerdict = {
    approved: [],
    lowConfidence: [],
    declined: [],
    unknownIds: 0,
    invalid: [],
  };
  const known = new Set<string>(candidates);
  const seen = new Map<string, number>();
  for (const a of answers) {
    if (!known.has(a.questionId)) verdict.unknownIds++;
    else seen.set(a.questionId, (seen.get(a.questionId) ?? 0) + 1);
  }
  for (const action of candidates) {
    const matches = answers.filter((a) => a.questionId === action);
    const answer = matches[0];
    if (!answer || matches.length !== 1) {
      verdict.invalid.push(action);
      continue;
    }
    if (
      !(JEV_OPTIONS as readonly string[]).includes(answer.choice) ||
      typeof answer.confidence !== 'number' ||
      !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 ||
      answer.confidence > 1
    ) {
      verdict.invalid.push(action);
      continue;
    }
    if (answer.choice === 'defer') verdict.declined.push(action);
    else if (answer.confidence < threshold) verdict.lowConfidence.push(action);
    else verdict.approved.push({ action, confidence: answer.confidence });
  }
  return verdict;
}

/** 同一轮最多一个「给对方发聊天」的动作（拍一拍也算），避免连发打扰。 */
const CHAT_FAMILY: ReadonlySet<EcologyActionKey> = new Set([
  'message',
  'greeting',
  'voice',
  'photo',
  'sticker',
  'nudge',
  'share_link',
  'care_anniversary',
  'care_absence',
  'care_late_night',
  'care_follow_up',
  'play_wish',
]);
/** 互斥组：组内同一轮只做一个。 */
const EXCLUSIVE_GROUPS: ReadonlyArray<ReadonlySet<EcologyActionKey>> = [
  CHAT_FAMILY,
  new Set(['status', 'signature']),
  // 微博同步本身会推到私人朋友圈，和「转发已同步素材」重复。
  new Set(['weibo_sync', 'moment_post']),
];
/** 把握相同时的先后（关怀与特别日子优先，拍一拍最后）。 */
const PRIORITY: readonly EcologyActionKey[] = [
  'care_anniversary',
  'care_follow_up',
  'care_late_night',
  'care_absence',
  'greeting',
  'message',
  'voice',
  'share_link',
  'photo',
  'play_wish',
  'sticker',
  'nudge',
  'moment_reply',
  'moment_interact',
  'moment_peer',
  'weibo_sync',
  'moment_post',
  'group_talk',
  'status',
  'signature',
];

/**
 * 程序排冲突：按把握从高到低取，互斥组内只留一个，同一动作不重复，总数不超过 max。
 * 返回被选中的动作与因冲突放弃的动作。
 */
export function resolveEcologyConflicts(
  approved: ReadonlyArray<{ action: EcologyActionKey; confidence: number }>,
  max: number,
): { selected: EcologyActionKey[]; dropped: EcologyActionKey[] } {
  const rank = (a: EcologyActionKey) => {
    const i = PRIORITY.indexOf(a);
    return i < 0 ? PRIORITY.length : i;
  };
  const ordered = [...approved].sort(
    (x, y) => y.confidence - x.confidence || rank(x.action) - rank(y.action),
  );
  const selected: EcologyActionKey[] = [];
  const dropped: EcologyActionKey[] = [];
  for (const { action } of ordered) {
    const clash =
      selected.includes(action) ||
      selected.length >= max ||
      EXCLUSIVE_GROUPS.some((group) => group.has(action) && selected.some((s) => group.has(s)));
    if (clash) {
      if (!dropped.includes(action) && !selected.includes(action)) dropped.push(action);
    } else selected.push(action);
  }
  return { selected, dropped };
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
