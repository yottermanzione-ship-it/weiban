/** 唯一硬性分类派生公式。仅看结构化事实，不从自由文本读取资格。 */
import type {
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
