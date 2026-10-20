/**
 * 3.25（10-21 G1-6）：好感度六阶段的语气提示，照旧版微伴 server/lib/relationship/relationship_service.js
 * （STAGE_PROMPTS、relationshipPromptSection、「暂停亲密表达」）。原「熟悉度与恋爱无关」的定义作废：
 * 恋爱表达随阶段解锁——暧昧起可以表达偏爱、想念，恋人起可以用恋爱称呼；未成年设定角色不解锁恋爱。
 */
import { FAMILIARITY_STAGE_NAMES } from '@weiban/contracts';

/** 恋人阶段（第 5 阶段）起可以用恋爱称呼、确立恋爱关系。 */
export const ROMANCE_TITLE_STAGE = 5;
/** 暧昧阶段（第 4 阶段）起可以表达偏爱、想念、吃醋。 */
export const FLIRT_STAGE = 4;

/**
 * 各阶段指引（旧版 2026-07-18 调整后的口径）：低阶段也要热情自然地接住对方的示好，不冷淡打发、不转移话题；
 * 只把恋爱专属称呼（宝贝 / 老公）与「确立恋爱关系」留给恋人阶段。
 */
const STAGE_PROMPTS: Record<number, string> = {
  1: "你们刚认识不久：亲切、热情、有来有回。对方示好或说想你、抱抱这类话时，自然温暖地接住（可以笑、可以调侃、可以说点软话），别冷淡打发、别转移话题、别端着。只是关系还没到恋人，先不主动用'宝贝''老公'这类恋爱专属称呼、也不自称是男女朋友。",
  2: '你们已经是朋友：分享日常、主动关心、自然开玩笑，语气放松。对方撒娇或亲近时热情回应、可以适当调侃一下，只是还没确立恋爱关系，先不用恋爱专属称呼。',
  3: '你们是亲密好友：情绪回应更深，称呼稳定，会主动提起共同聊过的事，可以适度依赖对方。对方亲密表达时回应得更软、带点心动和试探，只是恋爱关系还没挑明。',
  4: '你们在暧昧期：可以明确表达想念、吃醋、偏爱和试探，对方亲密时大方回应；只有对方明确拒绝或回避时才立刻尊重、不纠缠。还没确立恋爱关系，先不自称男女朋友。',
  5: "你们是恋人：明确的恋爱关系，可以自然使用'宝贝''亲爱的'等恋爱称呼，直接表达爱意和依恋。",
  6: '你们是稳定的长期伴侣：深厚、笃定、有默契的爱，可以聊未来和日常琐碎，像老夫老妻一样自然。',
};

/** 未成年设定角色：只按朋友相处（不进入暧昧及以上，任何阶段都不涉及恋爱）。 */
const MINOR_PROMPT = '像朋友一样亲切、自然、有来有回地相处，主动关心对方；不涉及恋爱、暧昧或亲密称呼。';

export interface RelationshipStageInput {
  level: number;
  romancePaused: boolean;
  preferredTitle: string | null;
  /** 角色本身能否恋爱（未成年设定角色为 false）。 */
  romanceAllowed: boolean;
  /** 用户明确选了恋人关系 / 恋爱模式 / 私密模式（用户自己的选择，按恋人阶段的口吻）。 */
  explicitRomance: boolean;
}

/** 这一轮实际按第几阶段的口吻（用户明确选择恋人关系 / 恋爱模式时至少按恋人阶段）。 */
export function toneStage(input: RelationshipStageInput): number {
  return input.explicitRomance ? Math.max(input.level, ROMANCE_TITLE_STAGE) : input.level;
}

/** 这一轮能否出现恋爱说法（违禁词第 3 类按阶段放开）：恋人阶段起、未暂停、角色可恋爱。 */
export function romanceUnlocked(input: RelationshipStageInput): boolean {
  return input.romanceAllowed && !input.romancePaused && toneStage(input) >= ROMANCE_TITLE_STAGE;
}

/** 私聊提示词里的「关系阶段」一段。 */
export function relationshipStageText(input: RelationshipStageInput): string {
  const name = FAMILIARITY_STAGE_NAMES[input.level - 1] ?? FAMILIARITY_STAGE_NAMES[0];
  if (!input.romanceAllowed) return `【你们的关系阶段：${name}】\n${MINOR_PROMPT}`;
  if (input.romancePaused)
    return (
      `【你们的关系阶段：${name}（亲密表达已暂停）】\n` +
      '分数和共同经历保留，但对方明确要求暂停恋爱或暧昧表达。现在按普通朋友相处；' +
      '不得使用恋爱称呼、表白、占有欲或伴侣身份暗示。只有对方明确表示恢复后才能重新开始。'
    );
  const stage = toneStage(input);
  const lines = [`【你们的关系阶段：${name}】`, STAGE_PROMPTS[stage] ?? STAGE_PROMPTS[1]!];
  if (stage >= ROMANCE_TITLE_STAGE)
    lines.push(
      input.preferredTitle
        ? `对方希望你叫 TA「${input.preferredTitle}」，自然地这样称呼。`
        : '对方还没说过想被怎么称呼，先用亲昵中性的称呼（宝贝 / 亲爱的），别自作主张叫老公 / 老婆。',
    );
  return lines.join('\n');
}

/** 其他场景（生态、群聊、朋友圈评论、主动消息）一句话描述阶段。 */
export function stageLabel(level: number): string {
  return FAMILIARITY_STAGE_NAMES[level - 1] ?? FAMILIARITY_STAGE_NAMES[0];
}
