/** 唯一硬性分类派生公式。仅看结构化事实，不从自由文本读取资格。 */
import type {
  ClassificationComparison,
  ClassificationFacts,
  CharacterClassificationInput,
  CharacterClassification,
  CharacterKind,
  PolicyDecision,
  ScenarioModeTraits,
  PortraitPolicy,
} from '@weiban/contracts';
export function deriveClassification(
  input: CharacterClassificationInput,
  kind: CharacterKind,
  childFeaturesDetected: boolean,
): CharacterClassification {
  const isMinor = input.ageSetting === 'minor' || input.childAppearance || childFeaturesDetected;
  const isReal = input.basis === 'real_person';
  const portraitPolicy: PortraitPolicy = isReal
    ? input.realPersonKind === 'historical' && kind === 'preset'
      ? 'classical_art_only'
      : 'forbidden'
    : 'allowed';
  return {
    ...input,
    childFeaturesDetected,
    derived: {
      isMinor,
      adultModeEligible: !isReal && !isMinor,
      romanceAllowed: !isMinor,
      portraitPolicy,
      publicStatementGuard: isReal,
    },
  };
}
export function checkMode(
  classification: CharacterClassification,
  mode: ScenarioModeTraits,
): PolicyDecision {
  if (mode.containsAdultContent && !classification.derived.adultModeEligible)
    return { allowed: false, reason: 'adult_mode_not_eligible' };
  if (mode.containsRomance && !classification.derived.romanceAllowed)
    return { allowed: false, reason: 'romance_not_allowed' };
  return { allowed: true };
}
export function classificationCanChange(
  before: CharacterClassificationInput,
  after: CharacterClassificationInput,
  kind: CharacterKind,
): boolean {
  if (kind === 'preset') return true;
  return !(
    (before.basis === 'real_person' && after.basis !== 'real_person') ||
    (before.ageSetting === 'minor' && after.ageSetting !== 'minor') ||
    (before.childAppearance && !after.childAppearance)
  );
}

/**
 * 「分类 next 是否不比 previous 宽」的唯一判定处（PolicyExtensionPort.compareClassification，
 * hard-boundaries.md 第 6 节第 2、3 条）。plaza 发布新版本 / 管理员更正、characters 更新复制品时调用。
 * 规则：original / fictional → real_person 为更严；adult → minor 为更严；childAppearance、childFeaturesDetected、
 * everPrivatePerson 只能 false → true；其余变化（虚构 ↔ 原创、真人子类互换、离开真人）视为 looser。
 */
export function compareClassification(
  previous: ClassificationFacts,
  next: ClassificationFacts,
): ClassificationComparison {
  const looser =
    (previous.basis === 'real_person' &&
      (next.basis !== 'real_person' || previous.realPersonKind !== next.realPersonKind)) ||
    (previous.basis !== 'real_person' &&
      next.basis !== 'real_person' &&
      previous.basis !== next.basis) ||
    (previous.ageSetting === 'minor' && next.ageSetting !== 'minor') ||
    (previous.childAppearance && !next.childAppearance) ||
    (!!previous.childFeaturesDetected && !next.childFeaturesDetected) ||
    (!!previous.everPrivatePerson && !next.everPrivatePerson);
  return looser ? 'looser' : 'stricter_or_equal';
}
