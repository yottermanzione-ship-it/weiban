import { expect, it } from 'vitest';
import { FAMILIARITY_STAGE_NAMES } from '@weiban/contracts';
import { relationshipStageText, type RelationshipStageInput } from './relationship-stage.js';

const base: RelationshipStageInput = {
  level: 1,
  romancePaused: false,
  preferredTitle: null,
  romanceAllowed: true,
  explicitRomance: false,
};
const normalLevel1 =
  "【你们的关系阶段：粉丝】\n你们刚认识不久：亲切、热情、有来有回。对方示好或说想你、抱抱这类话时，自然温暖地接住（可以笑、可以调侃一下、可以说点软话），别冷淡打发、别转移话题、别端着。只是关系还没到恋人，先不主动用'宝贝''老公'这类恋爱专属称呼、也不自称是男女朋友。".replace(
    '可以调侃一下',
    '可以调侃',
  );
it.each([1, 4])('低进度%d的私密口吻不伪造已经成为恋人', (level) => {
  const text = relationshipStageText({ ...base, level, explicitRomance: true });
  expect(text).toContain(`【关系进度：${FAMILIARITY_STAGE_NAMES[level - 1]}】`);
  expect(text).toContain('【本轮语气】');
  expect(text).toContain('不等于已经确立恋爱关系');
  expect(text).not.toContain('你们是恋人：明确的恋爱关系');
  expect(text).toContain('不因为切换情景就强行改称呼');
});
it('真实第五阶段的原文保持一致', () => {
  expect(relationshipStageText({ ...base, level: 5, explicitRomance: true })).toBe(
    "【你们的关系阶段：恋人】\n你们是恋人：明确的恋爱关系，可以自然使用'宝贝''亲爱的'等恋爱称呼，直接表达爱意和依恋。\n对方还没说过想被怎么称呼，先用亲昵中性的称呼（宝贝 / 亲爱的），别自作主张叫老公 / 老婆。",
  );
});
it('暂停优先，私密不能重新开启亲密口吻', () => {
  const text = relationshipStageText({ ...base, romancePaused: true, explicitRomance: true });
  expect(text).toBe(
    '【你们的关系阶段：粉丝（亲密表达已暂停）】\n分数和共同经历保留，但对方明确要求暂停恋爱或暧昧表达。现在按普通朋友相处；不得使用恋爱称呼、表白、占有欲或伴侣身份暗示。只有对方明确表示恢复后才能重新开始。',
  );
});
it('普通第一阶段与改前逐字相同', () => expect(relationshipStageText(base)).toBe(normalLevel1));
it('不允许恋爱时保留原朋友文案', () => {
  expect(relationshipStageText({ ...base, romanceAllowed: false, explicitRomance: true })).toBe(
    '【你们的关系阶段：粉丝】\n像朋友一样亲切、自然、有来有回地相处，主动关心对方；不涉及恋爱、暧昧或亲密称呼。',
  );
});
