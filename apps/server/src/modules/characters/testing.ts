export { CharacterService } from './application/characters.js';
export { LegacyPersonaService } from './application/legacy-persona.js';
export {
  LegacyPersonaImport,
  personaDigest,
  bytesDigest,
  targetPersonaPackage,
  editablePersonaDocument,
  applyPersonaMergePatch,
  materializePersonaCard,
  projectPersonalPersona,
} from './domain/legacy-persona.js';
export { ScenarioModeService } from './application/scenario-modes.js';
export { CustomCharacterService } from './application/custom-character.js';
export { GatewayCharacterEvaluator, type CharacterEvaluator } from './application/evaluator.js';
export { CHARACTER_EVALUATOR, CHARACTER_CONTACT_ACCESS } from './tokens.js';
export { childFeaturesIn } from './domain/child-features.js';

export { CharacterCheckWorker } from './application/check-worker.js';
export { CharacterTrialService } from './application/trials.js';

// 5.6（T-20261104e）：后台搜索实体 / 别名修正（集成测试直接调用）。
export { SearchEntityService } from './application/search-entities.js';
