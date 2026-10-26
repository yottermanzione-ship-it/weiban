import type { ModelInfo, ModelScenario } from '@weiban/contracts';

const USER_PRICE_SCENARIOS: readonly ModelScenario[] = [
  'chat',
  'private',
  'voice_message',
  'speech_recognition',
  'voice_call',
  'image_generation',
];

/** 内部决策/搜索条目不是用户可选模型；混合用途的正常聊天模型仍保留。 */
export function isUserPriceModel(model: Pick<ModelInfo, 'scenarios'>): boolean {
  return (model.scenarios ?? []).some((scenario) =>
    USER_PRICE_SCENARIOS.some((candidate) => candidate === scenario),
  );
}
