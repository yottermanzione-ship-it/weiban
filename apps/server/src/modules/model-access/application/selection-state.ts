import { unavailableReason } from '../domain/rules.js';
import type { ModelFacts } from './catalog.js';

export interface ModelRefStateOut {
  modelKey: string;
  available: boolean;
  unavailableReason: 'model_removed' | 'provider_unavailable' | null;
}

export function refState(f: ModelFacts): ModelRefStateOut {
  const reason = unavailableReason(f.entry, f.upstreamStatus);
  return { modelKey: f.modelKey, available: reason === null, unavailableReason: reason };
}
