/**
 * 情景预设的 AI 策略（docs/refactor/03 第 4 节；换壳设计 docs/refactor/02 第 5.3 节）。
 *
 * - 手动选的预设：风格写在前缀（personaPrompt 的「情景模式」一行），换预设才断一次缓存。
 * - 「自动」：每轮按规则在 日常 / 树洞 / 打气 / 傲娇 之间判断，风格提示放在请求末尾；
 *   **候选集合里没有恋爱和成人**——亲密程度只能由用户自己选（原则 6 不操纵）。
 * - 惯性：最近 3 个用户轮按 1 / 0.8 / 0.6 加权打分，刚倾诉完下一句闲聊仍保持倾听，不来回跳。
 * - 安全关怀触发时不加任何风格提示（由调用方判断后不调用）。
 * - 策略参数由代码执行：树洞关掉小巧思和主动语音 / 表情包；傲娇沿用傲娇的小巧思（仍受次数上限）。
 */
import type { ScenarioMode } from '@weiban/contracts';

/** 「自动」能落到的风格，也是三种新预设的实际表现。 */
export type ScenarioStyle = 'daily' | 'treehole' | 'cheer' | 'tsundere';

const TREEHOLE =
  /难过|伤心|委屈|心累|好累|累死|太累|烦死|好烦|烦躁|崩溃|想哭|哭了|在哭|失眠|睡不着|压力好?大|焦虑|孤独|好孤单|没人懂|郁闷|不开心|心情不好|心情很差|难受|emo|被骂|挨骂|吵架|分手|失恋|想不通|撑不住|好丧|丧气|没意思|吐槽一下|听我说/iu;
const CHEER =
  /考试|期末|复习|备考|考研|考公|面试|答辩|论文|背单词|健身|减肥|减脂|跑步|打卡|加班|赶工|截止|deadline|ddl|早起|自律|坚持|目标|冲刺|比赛|求职|找工作|学车|练琴|给我加油|鼓励我/iu;
const TEASE =
  /哼|切~?|你才|笨蛋|傻瓜|就你|略略略|嘴硬|不服|来啊|呵呵|你行你上|欠揍|损我|怼我|小气鬼|自恋|臭美|才不是/u;

const WEIGHTS = [1, 0.8, 0.6];
const THRESHOLD = 1.5;

function turnScore(text: string, tsundereAllowed: boolean): Record<ScenarioStyle, number> {
  const long = [...text].length >= 80;
  return {
    daily: 0,
    treehole: (TREEHOLE.test(text) ? 2 : 0) + (long ? 1 : 0),
    cheer: CHEER.test(text) ? 2 : 0,
    tsundere: tsundereAllowed && TEASE.test(text) ? 2 : 0,
  };
}

/**
 * 「自动」本轮风格。userTurns：最近的用户轮文字（旧 → 新，只看最后 3 个）。
 * 深夜（23:00–5:00）给倾听加 0.5 分，但单靠深夜不会进入树洞。
 */
export function autoScenarioStyle(input: {
  userTurns: string[];
  localHour: number;
  tsundereAllowed: boolean;
}): ScenarioStyle {
  const turns = input.userTurns.slice(-3).reverse();
  const total: Record<ScenarioStyle, number> = { daily: 0, treehole: 0, cheer: 0, tsundere: 0 };
  turns.forEach((text, i) => {
    const s = turnScore(text, input.tsundereAllowed);
    const w = WEIGHTS[i] ?? 0;
    total.treehole += s.treehole * w;
    total.cheer += s.cheer * w;
    total.tsundere += s.tsundere * w;
  });
  if (total.treehole > 0 && (input.localHour >= 23 || input.localHour < 5)) total.treehole += 0.5;
  // 同分时：倾听 > 打气 > 斗嘴（难过时不能被当成在斗嘴）。
  const order: ScenarioStyle[] = ['treehole', 'cheer', 'tsundere'];
  let best: ScenarioStyle = 'daily';
  for (const style of order)
    if (total[style] >= THRESHOLD && total[style] > total[best]) best = style;
  return best;
}

/** 本轮实际表现出的风格：自动按判断结果，三个新预设与傲娇按自身，其余视为日常。 */
export function effectiveStyle(mode: ScenarioMode, auto: ScenarioStyle | null): ScenarioStyle {
  if (mode === 'auto') return auto ?? 'daily';
  if (mode === 'treehole' || mode === 'cheer' || mode === 'tsundere') return mode;
  return 'daily';
}

/** 风格补丁（意思自拟，不照抄任何产品文案）。 */
export const STYLE_TEXT: Record<Exclude<ScenarioStyle, 'daily'>, string> = {
  treehole:
    '倾听：多听少说。先接住对方的情绪，回应对方说到的具体事情；不评判、不急着讲道理或给建议（对方开口问时再给）、不转移话题、不拿玩笑带过、少讲自己的事。可以比平时多说一两句，语气轻一点；对方说完时可以轻轻问一句还想不想接着说。',
  cheer:
    '打气：语气有劲、真诚。具体夸对方已经做到的部分，关心进度和下一步；对方想偷懒或放弃时可以温和地催一下。不威胁、不让对方愧疚、不拿对方和别人比较。',
  tsundere:
    '斗嘴：顺着对方的玩笑嘴硬地回几句，嘴硬心软；对方真需要帮忙时照样认真帮。不贬低对方的外貌、能力或家人。',
};

/** 「自动」放在请求末尾的本轮风格提示；日常不加提示（省 token）。 */
export function autoStylePrompt(style: ScenarioStyle): string | null {
  if (style === 'daily') return null;
  return `【本轮风格】${STYLE_TEXT[style]}自然地体现，不要说出「风格」「模式」之类的词，也不要解释自己为什么换了语气。`;
}

/** 界面「现在：…」用的中性说法（换壳设计 5.4，不写判断理由）。 */
export const STYLE_LABEL: Record<ScenarioStyle, string> = {
  daily: '日常',
  treehole: '偏向倾听',
  cheer: '给你打气',
  tsundere: '斗斗嘴',
};
