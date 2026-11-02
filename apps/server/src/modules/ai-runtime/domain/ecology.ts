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
import {
  MAIN_UNREPLIED_LIMIT,
  type EcologyInternalKind,
  type EcologyRunKind,
} from './ecology-counters.js';

/**
 * 执行方式：
 * - decision：生态唤醒时由决策模型从工具里挑；
 * - flow：由已有的专门流程自己触发，开关只决定流程是否运行（经期关怀：隐私规则更严，沿用 health-care）；
 * - reserved：留口子，v1 未接通（界面置灰「即将上线」）；
 * - base：基础层（对照表 v3）：所有人默认都有，不展示开关、不进生态候选、不看生态闸门。
 *   聊天里的语音 / 图片 / 表情包 / 拍一拍 / 熬夜催睡由聊天流程自己判断（用户说过不要某种形式就不发，
 *   见 chat-form-suppression），朋友圈三种互动由朋友圈事件按旧版机制排期（moments-ai）。
 *   定义留着：旧运行记录的摘要、用户在聊天里点名「拍拍我」等仍要用。
 */
export type EcologyExecMode = 'decision' | 'flow' | 'reserved' | 'base';

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

/**
 * 动作目录（运行 kind 里属于契约 key 的部分，17 个）。2026-11-02 清理：greeting / care_anniversary /
 * care_period 已并入 message（见 ecology-counters.ts 的 EcologyInternalKind 与下面的
 * INTERNAL_ACTION_INFO），不再出现在这张表里；share_link / care_weather / play_letter /
 * play_wish / play_focus / play_daily_question / play_reminder 已删除。
 * 2026-11-03 按对照表 v3：这张表不再等于用户开关（开关见下面的 ECOLOGY_SWITCHES，只有 6 个）；
 * 基础层动作改为 mode = 'base'。private_moments 只是开关、不是动作，不在这张表里。
 */
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
    key: 'voice',
    group: 'chat',
    label: '发语音消息',
    tool: '用语音消息说一两句话（短，口语）。brief 写要说的意思。',
    mode: 'base',
    needs: 'speech_synthesis',
    summary: '给你发了条语音',
  },
  {
    key: 'photo',
    group: 'chat',
    label: '分享图片',
    tool: '分享这张角色微博里的一张公开图片，配一句话；不得声称是刚拍的照片或自拍。',
    mode: 'base',
    summary: '给你分享了张图片',
  },
  {
    key: 'sticker',
    group: 'chat',
    label: '发表情包',
    tool: '发一个表情包（可配一句很短的话）。brief 写想表达的情绪。',
    mode: 'base',
    summary: '给你发了个表情',
  },
  {
    key: 'nudge',
    group: 'chat',
    label: '拍一拍你',
    // 10-28 总经理：拍一拍是夹在聊天里的小动作，不单独发——执行时先发一句话再拍。
    tool: '在聊天里「拍一拍」对方，并顺带说一句话（拍一拍不单独发）。',
    mode: 'base',
    summary: '拍了拍你，还说了句话',
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
    mode: 'base',
    summary: '给你的朋友圈点了赞 / 评论',
  },
  {
    key: 'moment_reply',
    group: 'moments',
    label: '回复 TA 朋友圈下的评论',
    tool: '回复自己朋友圈下还没回的评论。target 填快照里评论的编号。',
    mode: 'base',
    summary: '回复了朋友圈评论',
  },
  {
    key: 'moment_peer',
    group: 'moments',
    label: '去其他角色的朋友圈互动',
    tool: '去其他认识的角色的朋友圈点赞或评论（对方能在共同好友处看到）。target 填快照里动态的编号；brief 写 like 或评论的意思。',
    mode: 'base',
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
    mode: 'base',
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
    key: 'play_pet',
    group: 'play',
    label: '照顾宠物',
    tool: '',
    mode: 'reserved',
    reservedReason: '即将上线',
    summary: '照顾了宠物',
  },
  {
    key: 'group_talk',
    group: 'group',
    label: '群聊主动话题',
    tool: '在你和对方都在的群里起个话头，其他角色会接话。target 填快照里群的编号；brief 写话题。',
    mode: 'decision',
    summary: '在群里聊了起来',
  },
];

export const ACTION_DEF = new Map(ECOLOGY_ACTIONS.map((a) => [a.key, a]));

// ===========================================================================
// 用户开关（对照表 v3，总经理 2026-11-03 确认；docs/product/ecology-display-v3.md）
// ===========================================================================

export interface EcologySwitchDef {
  key: EcologyActionKey;
  group: EcologyActionGroup;
  label: string;
  /** 这个开关管的运行 kind（执行、计数仍按各自的 kind 记）。 */
  covers: readonly EcologyRunKind[];
}

/**
 * 设置页「按动作」只展示这 6 个开关（顺序即展示顺序，分组沿用原分组）。碎碎念没有开关。
 * 存储沿用 ecology_settings.disabled_actions，不迁移数据：
 * - private_moments 不单独存，关掉 = 同时写入 weibo_sync 与 moment_post，打开 = 两个都去掉；
 * - care_absence / care_follow_up 改由 message 管，旧数据里单独关掉的这两项读取时忽略。
 * 基础层动作（mode = 'base'）不属于任何开关。
 */
export const ECOLOGY_SWITCHES: readonly EcologySwitchDef[] = [
  {
    key: 'message',
    group: 'chat',
    label: '主动消息',
    covers: ['message', 'greeting', 'care_anniversary', 'care_absence', 'care_follow_up'],
  },
  {
    key: 'private_moments',
    group: 'moments',
    label: '私人朋友圈',
    covers: ['weibo_sync', 'moment_post'],
  },
  { key: 'status', group: 'life', label: '更新状态', covers: ['status'] },
  { key: 'signature', group: 'life', label: '改个性签名', covers: ['signature'] },
  { key: 'play_pet', group: 'play', label: '照顾宠物', covers: ['play_pet'] },
  { key: 'group_talk', group: 'group', label: '群聊主动话题', covers: ['group_talk'] },
];

const SWITCH_OF = new Map<EcologyRunKind, EcologyActionKey>(
  ECOLOGY_SWITCHES.flatMap((s) => s.covers.map((kind) => [kind, s.key] as const)),
);
const SWITCH_KEYS: ReadonlySet<EcologyActionKey> = new Set(ECOLOGY_SWITCHES.map((s) => s.key));
/** private_moments 在 disabled_actions 里的落地形式。 */
const PRIVATE_MOMENTS_STORAGE: readonly EcologyActionKey[] = ['weibo_sync', 'moment_post'];

/**
 * 运行 kind 的门控开关：返回管它的那个开关 key；基础层动作（或不认识的 kind）返回 null，
 * 表示不走生态闸门。绝不能把内部 kind（greeting 等）直接当开关查。
 */
export function gateKeyForRunKind(kind: EcologyRunKind): EcologyActionKey | null {
  return SWITCH_OF.get(kind) ?? null;
}

/**
 * 某个开关在用户设置里是否打开（只看 disabled_actions，不看平台、会员、总开关）。
 * private_moments：weibo_sync 与 moment_post 都被关才算关；旧数据只关了其中一个时显示为开
 * （任务卡 T-20261103b），下次切换时两个一起写。
 */
export function switchEnabled(disabled: readonly string[], key: EcologyActionKey): boolean {
  if (key === 'private_moments') return !PRIVATE_MOMENTS_STORAGE.every((k) => disabled.includes(k));
  return !disabled.includes(key);
}

/**
 * 合并用户开关变更，返回新的 disabled_actions（排序后写回）：
 * - private_moments 一次写两个存储 key；
 * - 不是开关的 key（已收进别的开关或已归基础层，旧客户端可能还会发）照收但不起作用；
 * - 存量里契约已删的未知 key 剥掉，避免垃圾永久累积；其余存量原样保留（读取时会被忽略）。
 */
export function mergeDisabledActions(
  current: readonly string[],
  changes: ReadonlyArray<{ key: EcologyActionKey; enabled: boolean }>,
): string[] {
  const disabled = new Set(current);
  for (const change of changes) {
    if (!SWITCH_KEYS.has(change.key)) continue;
    const keys = change.key === 'private_moments' ? PRIVATE_MOMENTS_STORAGE : [change.key];
    for (const key of keys) {
      if (change.enabled) disabled.delete(key);
      else disabled.add(key);
    }
  }
  return [...disabled]
    .filter((k): k is EcologyActionKey => (ECOLOGY_ACTION_KEYS as readonly string[]).includes(k))
    .sort();
}

/**
 * 并入 message 的内部 kind 的展示信息（只给决策模型题干与运行记录摘要用，不进用户开关）。
 * 门控一律查 message 开关：调用方用 gateKeyForRunKind() 取门控开关；平台可用性按 message 的定义查
 * （见 EcologySettingsService.actionAvailable）。
 */
export const INTERNAL_ACTION_INFO: Record<
  EcologyInternalKind,
  { label: string; hint: string; summary: string }
> = {
  greeting: {
    label: '早安 / 晚安',
    hint: '只在早上或睡前合适。',
    summary: '跟你道了早安 / 晚安',
  },
  care_anniversary: {
    label: '生日、纪念日、约定的日子',
    hint: '今天是特别的日子时表达心意。',
    summary: '记得今天是特别的日子',
  },
};

/** 候选 / 运行的展示 label：先查动作表，再查内部 kind。 */
export function ecologyRunLabel(kind: EcologyRunKind): string {
  return (
    ACTION_DEF.get(kind as EcologyActionKey)?.label ??
    INTERNAL_ACTION_INFO[kind as EcologyInternalKind]?.label ??
    kind
  );
}

/** 运行记录摘要（碎碎念灰字）：先查动作表，再查内部 kind。 */
export function ecologyRunSummary(kind: EcologyRunKind): string {
  return (
    ACTION_DEF.get(kind as EcologyActionKey)?.summary ??
    INTERNAL_ACTION_INFO[kind as EcologyInternalKind]?.summary ??
    kind
  );
}

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
  'voice',
  'photo',
  'sticker',
  'care_absence',
  'care_late_night',
  'care_follow_up',
  'moment_reply',
  'status',
  'signature',
  'group_talk',
]);

/** 给 Jev 的每题补充说明（固定程序文字，不含任何用户或角色原文）。 */
const JEV_HINT: Partial<Record<EcologyRunKind, string>> = {
  weibo_sync: '看 state.features.weiboLeadAvailable：有新公开线索时才适合；没有必要就不做。',
  message: '主动发一条有具体内容的私聊消息。对方刚聊过或有未回复消息时克制。',
  greeting: '只在早上或睡前合适。',
  voice: '用一两句语音代替文字。对方可能不方便听时不做。',
  photo: '分享角色微博里的一张公开图片。',
  sticker: '发一个表情包。',
  nudge: '拍一拍对方并顺带说一句话。',
  moment_post: '把已同步的公开微博转到私人朋友圈。',
  moment_interact: '给对方最近的朋友圈点赞或评论（点赞和评论是分开的两件事，都做也可以）。',
  moment_reply: '回复自己朋友圈下还没回的评论。',
  moment_peer: '给认识的其他角色的朋友圈点赞或评论（点赞和评论是分开的两件事，都做也可以）。',
  status: '更新自己的状态，偶尔才做。',
  signature: '改个性签名，很少才做。',
  care_anniversary: '今天是特别的日子时表达心意。',
  care_absence: '对方很久没来时问候一句，不制造愧疚。',
  care_late_night: '对方深夜还活跃时催对方早点睡。',
  care_follow_up: '跟进对方之前提过的事。',
  group_talk: '在共同的群里起一个话头。',
};

/** 每个候选的判定题干：只问做不做，不让 Jev 写内容。 */
export function jevPrompt(action: EcologyRunKind): string {
  const label = ecologyRunLabel(action);
  return `陪伴应用里的角色此刻是否适合「${label}」？${JEV_HINT[action] ?? ''}依据 state.summary 的对话现状和 state.features 中的时间、活跃情况、未回复条数、今天已做过的次数独立判断这一项（与其他题互不影响）；state.features.userActivityLevel 是用户主动选择的活跃程度（1 偶尔冒泡、2 时常出现、3 常伴左右、4 形影不离），这次唤醒本身就是按用户期望安排的主动机会：档位越高越应该主动，3、4 档时只要不会明显打扰（深夜、对方刚说要忙或已有多条未回复）就倾向 act；1 档时更克制。act 表示现在适合做；defer 表示会打扰或明显不合时宜。`;
}

export interface JevVerdict {
  approved: Array<{ action: EcologyRunKind; confidence: number }>;
  /** 选了 act 但把握不足（不做）。 */
  lowConfidence: EcologyRunKind[];
  /** 明确 defer。 */
  declined: EcologyRunKind[];
  /** 返回里不认识的题号个数（忽略，不做任何事）。 */
  unknownIds: number;
  /** 重复题号 / 选项不合法 / 把握值不合法 / 缺答案：一律不做。 */
  invalid: EcologyRunKind[];
}

/**
 * 解读 Jev 的批量答案。每个候选独立：只有选 act 且把握 ≥ 门槛才算通过；
 * 陌生 ID 忽略、重复 ID / 缺答案 / 非法值都不做，绝不用概率抽签或规则补批。
 */
export function interpretJevAnswers(
  candidates: readonly EcologyRunKind[],
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

/**
 * 保底（总经理 10-27「加保底」；10-28 改为「起码得有个主动消息」）：Jev 一项都没通过时，只要此刻不打扰、
 * 且「主动消息」在候选里，就发一条主动消息，让活跃程度 ≈ 实际动静次数。
 * 10-28 生产上保底按「想做可能性最高」挑中过拍一拍（只拍不说话）、表情包、心愿（都没做成），所以只认主动消息。
 * 分数只用于运行记录：message 一题选 act = 把握值，选 defer = 1 − 把握值；缺答案 / 重复 / 非法值记 0，照样发。
 * 打扰的情形不保底：深夜、已有 3 条以上未回（主线次数，见 ecology-counters）、对方在用应用却没回。
 */
export function ecologyFallback(
  candidates: readonly EcologyRunKind[],
  answers: ReadonlyArray<{ questionId: string; choice: string; confidence: number }>,
  context: { lateNight: boolean; unansweredCount: number; userActiveInApp30m: boolean },
): { action: EcologyActionKey; score: number } | null {
  if (
    context.lateNight ||
    context.unansweredCount >= MAIN_UNREPLIED_LIMIT ||
    (context.unansweredCount >= 1 && context.userActiveInApp30m) ||
    !candidates.includes('message')
  )
    return null;
  const matches = answers.filter((a) => a.questionId === 'message');
  const answer = matches[0];
  const valid =
    !!answer &&
    matches.length === 1 &&
    (JEV_OPTIONS as readonly string[]).includes(answer.choice) &&
    Number.isFinite(answer.confidence) &&
    answer.confidence >= 0 &&
    answer.confidence <= 1;
  const score = !valid ? 0 : answer.choice === 'act' ? answer.confidence : 1 - answer.confidence;
  return { action: 'message', score };
}

/** 同一轮最多一个「给对方发聊天」的动作（拍一拍也算），避免连发打扰。 */
const CHAT_FAMILY: ReadonlySet<EcologyRunKind> = new Set([
  'message',
  'greeting',
  'voice',
  'photo',
  'sticker',
  'nudge',
  'care_anniversary',
  'care_absence',
  'care_late_night',
  'care_follow_up',
]);
/** 互斥组：组内同一轮只做一个。 */
const EXCLUSIVE_GROUPS: ReadonlyArray<ReadonlySet<EcologyRunKind>> = [
  CHAT_FAMILY,
  new Set(['status', 'signature']),
  // 微博同步本身会推到私人朋友圈，和「转发已同步素材」重复。
  new Set(['weibo_sync', 'moment_post']),
];
/** 把握相同时的先后（关怀与特别日子优先，拍一拍最后）。 */
const PRIORITY: readonly EcologyRunKind[] = [
  'care_anniversary',
  'care_follow_up',
  'care_late_night',
  'care_absence',
  'greeting',
  'message',
  'voice',
  'photo',
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
  approved: ReadonlyArray<{ action: EcologyRunKind; confidence: number }>,
  max: number,
): { selected: EcologyRunKind[]; dropped: EcologyRunKind[] } {
  const rank = (a: EcologyRunKind) => {
    const i = PRIORITY.indexOf(a);
    return i < 0 ? PRIORITY.length : i;
  };
  const ordered = [...approved].sort(
    (x, y) => y.confidence - x.confidence || rank(x.action) - rank(y.action),
  );
  const selected: EcologyRunKind[] = [];
  const dropped: EcologyRunKind[] = [];
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
