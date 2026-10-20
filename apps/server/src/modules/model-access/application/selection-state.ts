import type { ModelUnavailableDetail } from '@weiban/contracts';
import { unavailableReason } from '../domain/rules.js';
import type { ModelFacts } from './catalog.js';

export interface ModelRefStateOut {
  modelKey: string;
  available: boolean;
  unavailableReason: 'model_removed' | 'provider_unavailable' | null;
  /** 3.24：不可用的具体原因（facts 带 detail 时才有）。 */
  unavailableDetail?: ModelUnavailableDetail | null;
}

/**
 * 模型选择的可用状态。facts 带 detail（catalog.facts(keys, { detail: true })）时，
 * 线路层面的原因（缺计费上限、上游暂停等）也算不可用，并写出具体原因。
 */
export function refState(f: ModelFacts): ModelRefStateOut {
  const reason = unavailableReason(f.entry, f.upstreamStatus);
  if (f.detail === undefined)
    return { modelKey: f.modelKey, available: reason === null, unavailableReason: reason };
  const detail = f.detail ?? (reason === 'model_removed' ? 'model_removed' : null);
  const merged =
    reason ?? (detail ? (detail === 'model_removed' ? 'model_removed' : 'provider_unavailable') : null);
  return {
    modelKey: f.modelKey,
    available: merged === null,
    unavailableReason: merged,
    unavailableDetail: detail,
  };
}
